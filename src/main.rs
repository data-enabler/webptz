use axum::extract::ws::{Message, WebSocket};
use axum::extract::{ConnectInfo, WebSocketUpgrade};
use axum::http::{header, HeaderValue};
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;
use axum_extra::{headers, TypedHeader};
use btleplug::api::{Central, Manager as _};
use btleplug::platform::Manager;
use device::Device;
use futures::{future, SinkExt as _, StreamExt};
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::net::SocketAddr;
use std::ops::{ControlFlow, Deref};
use std::path::PathBuf;
use tokio::signal;
use tokio::sync::mpsc;
use tokio::sync::watch;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

mod config;
mod device;

enum Operation {
    Command(CommandRequest),
    Disconnect(DisconnectRequest),
    Reconnect(ReconnectRequest),
    Shutdown,
}

#[derive(Serialize, Debug)]
struct State {
    groups: Vec<Vec<String>>,
    devices: HashMap<String, DeviceStatus>,
}

#[derive(Serialize, Debug)]
struct DeviceStatus {
    id: String,
    name: String,
    connected: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let config = config::load_config().await?;
    println!("Config: {:?}", config);

    let manager = Manager::new().await?;

    let adapters = manager.adapters().await?;
    let central = match adapters.into_iter().nth(0) {
        None => return Err("no bluetooth adapter found".into()),
        Some(x) => x,
    };
    let info = central.adapter_info().await?;
    println!("Using adapter: {}", info);

    let (command_tx, mut command_rx) = mpsc::unbounded_channel::<Operation>();

    let used_device_ids: Vec<&String> = config.groups.iter().flatten().unique().sorted().collect();
    let mut devices: Vec<Box<dyn Device>> = used_device_ids
        .iter()
        .map(|&id| (id, config.devices.get(id).unwrap()))
        .map(|(id, device_config)| {
            let device: Box<dyn Device> = match device_config {
                config::DeviceConfig::Dummy(dummy_config) => {
                    let dummy = device::dummy::create_with_id_and_name(id, &dummy_config.name);
                    Box::new(dummy)
                }
                config::DeviceConfig::Ronin(ronin_config) => {
                    let ronin = device::ronin::create(id, central.clone(), &ronin_config.name);
                    Box::new(ronin)
                }
                config::DeviceConfig::Lumix(lumix_config) => {
                    let lumix = device::lumix::create(
                        id,
                        &lumix_config.address.clone(),
                        lumix_config.password.clone(),
                    );
                    Box::new(lumix)
                }
            };
            return device;
        })
        .collect();

    match connect_devices(&mut devices).await {
        Err(e) => {
            println!("{}", e);
            disconnect_devices(&mut devices).await;
            return Err(e);
        }
        _ => (),
    }

    let (state_tx, state_rx) = watch::channel::<State>(State {
        groups: config.groups.clone(),
        devices: get_device_status(&devices),
    });

    tokio::spawn(web_server(command_tx, state_rx));

    while let Some(operation) = command_rx.recv().await {
        match operation {
            Operation::Command(request) => {
                println!(
                    "Sending command {:?} to cameras {:?}",
                    request.command, request.devices
                );
                for device in devices.iter_mut() {
                    let id = device.id();
                    if !request.devices.iter().any(|x| x == &id) {
                        continue;
                    }
                    match device.send_command(request.command).await {
                        Err(e) => println!("Error sending command: {}", e),
                        _ => (),
                    }
                }
            }
            Operation::Disconnect(request) => {
                println!("Disconnecting cameras {:?}", request.devices);
                for device in devices.iter_mut() {
                    let id = device.id();
                    if !request.devices.iter().any(|x| x == &id) {
                        continue;
                    }
                    match device.disconnect().await {
                        Err(e) => println!("Error disconnecting device: {}", e),
                        _ => (),
                    }
                }
                state_tx.send_modify(|s| {
                    s.groups = config.groups.clone();
                    s.devices = get_device_status(&devices);
                });
            }
            Operation::Reconnect(request) => {
                println!("Reconnecting cameras {:?}", request.devices);
                for device in devices.iter_mut() {
                    let id = device.id();
                    if !request.devices.iter().any(|x| x == &id) {
                        continue;
                    }
                    match device.reconnect().await {
                        Err(e) => println!("Error reconnecting device: {}", e),
                        _ => (),
                    }
                }
                state_tx.send_modify(|s| {
                    s.groups = config.groups.clone();
                    s.devices = get_device_status(&devices);
                });
            }
            Operation::Shutdown => {
                println!("Shutting down...");
                disconnect_devices(&mut devices).await;
                state_tx.send_modify(|s| {
                    s.groups = vec![];
                    s.devices = HashMap::new();
                });
                break;
            }
        }
    }
    Ok(())
}

async fn connect_devices(devices: &mut Vec<Box<dyn Device>>) -> Result<(), Box<dyn Error>> {
    for device in devices.iter_mut() {
        device.connect().await.map_err(|e| -> Box<dyn Error> {
            format!("error connecting to {}: {}", device, e).into()
        })?;
    }
    Ok(())
}

async fn disconnect_devices(devices: &mut Vec<Box<dyn Device>>) {
    match future::try_join_all(
        devices
            .iter_mut()
            .filter(|d| d.is_connected())
            .map(|d| d.disconnect()),
    )
    .await
    {
        Err(e) => println!("Error disconnecting devices: {}", e),
        _ => (),
    }
}

fn get_device_status(devices: &Vec<Box<dyn Device>>) -> HashMap<String, DeviceStatus> {
    devices
        .iter()
        .map(|d| {
            (
                d.id(),
                DeviceStatus {
                    id: d.id(),
                    name: d.name(),
                    connected: d.is_connected(),
                },
            )
        })
        .collect()
}

async fn web_server(
    command_tx: mpsc::UnboundedSender<Operation>,
    state_rx: watch::Receiver<State>,
) {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                format!(
                    "{}=debug,tower_http=debug,axum=trace",
                    env!("CARGO_CRATE_NAME"),
                )
                .into()
            }),
        )
        .with(tracing_subscriber::fmt::layer().without_time())
        .init();

    let assets_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("http");

    let cloned_tx = command_tx.clone();
    let cloned_rx = state_rx.clone();
    let app = Router::new()
        .fallback_service(ServeDir::new(assets_dir).append_index_html_on_directories(true))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
        .route(
            "/control",
            any(|ws, user_agent, info| ws_handler(cloned_tx, cloned_rx, ws, user_agent, info)),
        );

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await.unwrap();
    println!("listening on {}", listener.local_addr().unwrap());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .unwrap();
    command_tx.send(Operation::Shutdown).unwrap();
}

async fn ws_handler(
    command_tx: mpsc::UnboundedSender<Operation>,
    state_rx: watch::Receiver<State>,
    ws: WebSocketUpgrade,
    user_agent: Option<TypedHeader<headers::UserAgent>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let user_agent = if let Some(TypedHeader(user_agent)) = user_agent {
        user_agent.to_string()
    } else {
        String::from("Unknown browser")
    };
    println!("`{user_agent}` at {addr} connected.");
    // finalize the upgrade process by returning upgrade callback.
    ws.on_upgrade(move |socket| handle_socket(command_tx, state_rx, socket, addr))
}

async fn handle_socket(
    command_tx: mpsc::UnboundedSender<Operation>,
    mut state_rx: watch::Receiver<State>,
    socket: WebSocket,
    who: SocketAddr,
) {
    let (mut sender, mut receiver) = socket.split();

    let mut send_task = tokio::spawn(async move {
        loop {
            let json = serde_json::to_string(state_rx.borrow_and_update().deref()).unwrap();
            match sender.send(Message::Text(json)).await {
                Ok(_) => (),
                Err(e) => {
                    println!("failed to send state update: {e}");
                    break;
                }
            }
            if state_rx.changed().await.is_err() {
                break;
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if process_message(command_tx.clone(), msg, who).is_break() {
                break;
            }
        }
    });

    tokio::select! {
        rv_a = (&mut send_task) => {
            match rv_a {
                Ok(_) => (),
                Err(a) => println!("Error sending messages {a:?}")
            }
            recv_task.abort();
        },
        rv_b = (&mut recv_task) => {
            match rv_b {
                Ok(_) => (),
                Err(b) => println!("Error receiving messages {b:?}")
            }
            send_task.abort();
        }
    }

    println!("Websocket context {who} destroyed");
}

fn process_message(
    command_tx: mpsc::UnboundedSender<Operation>,
    msg: Message,
    who: SocketAddr,
) -> ControlFlow<(), ()> {
    match msg {
        Message::Text(t) => {
            let r: Request = match serde_json::from_str(&t) {
                Ok(x) => x,
                Err(e) => {
                    println!(">>> {who} sent invalid json: {e}");
                    return ControlFlow::Continue(());
                }
            };
            println!(">>> {who} sent request: {r:?}");
            let op = match r {
                Request::Command(x) => Operation::Command(x),
                Request::Disconnect(x) => Operation::Disconnect(x),
                Request::Reconnect(x) => Operation::Reconnect(x),
            };
            match command_tx.send(op) {
                Ok(_) => (),
                Err(e) => {
                    println!("failed to queue command: {e}");
                    return ControlFlow::Break(());
                }
            };
        }
        Message::Close(c) => {
            if let Some(cf) = c {
                println!(
                    ">>> {} sent close with code {} and reason `{}`",
                    who, cf.code, cf.reason
                );
            } else {
                println!(">>> {who} somehow sent close message without CloseFrame");
            }
            return ControlFlow::Break(());
        }
        _ => (),
    }
    ControlFlow::Continue(())
}

#[derive(Deserialize, Debug)]
enum Request {
    #[serde(rename = "command")]
    Command(CommandRequest),
    #[serde(rename = "disconnect")]
    Disconnect(DisconnectRequest),
    #[serde(rename = "reconnect")]
    Reconnect(ReconnectRequest),
}

#[derive(Deserialize, Debug)]
struct CommandRequest {
    devices: Vec<String>,
    #[serde(flatten)]
    command: device::Command,
}

#[derive(Deserialize, Debug)]
struct DisconnectRequest {
    devices: Vec<String>,
}

#[derive(Deserialize, Debug)]
struct ReconnectRequest {
    devices: Vec<String>,
}

async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            println!("Ctrl+C received");
        },
        _ = terminate => {
            println!("Terminate received");
        },
    }
}
