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
use futures::{future, StreamExt};
use serde::Deserialize;
use tokio::signal;
use tokio::sync::mpsc;
use tower_http::set_header::SetResponseHeaderLayer;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use std::error::Error;
use std::net::SocketAddr;
use std::ops::ControlFlow;
use std::path::PathBuf;
use tower_http::services::ServeDir;

mod device;
mod config;

enum Operation {
    Command(CommandRequest),
    Disconnect(DisconnectRequest),
    Reconnect(ReconnectRequest),
    Shutdown,
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

    let mut devices = config.devices.iter().map(|(id, device_config)| {
        let device: Box<dyn Device> = match device_config {
            config::DeviceConfig::Ronin(ronin_config) => {
                let ronin = device::ronin::create(id, central.clone(), &ronin_config.name);
                Box::new(ronin)
            },
            config::DeviceConfig::Lumix(lumix_config) => {
                let lumix = device::lumix::create(id, &lumix_config.address.clone(), lumix_config.password.clone());
                Box::new(lumix)
            },
        };
        return device;
    }).collect::<Vec<Box<dyn Device>>>();

    for device in devices.iter_mut() {
        device.connect().await?;
    }

    tokio::spawn(web_server(command_tx));

    while let Some(operation) = command_rx.recv().await {
        match operation {
            Operation::Command(request) => {
                println!("Sending command {:?} to cameras {:?}", request.command, request.devices);
                // for now, just send to all devices
                for device in devices.iter_mut() {
                    match device.send_command(request.command).await {
                        Err(e) => println!("Error sending command: {}", e),
                        _ => (),
                    }
                }
            }
            Operation::Disconnect(request) => {
                println!("Disconnecting cameras {:?}", request.devices);
                // for now, just disconnect all Lumix devices
                for device in devices.iter_mut() {
                    if !device.name().starts_with("Lumix") {
                        continue;
                    }
                    match device.disconnect().await {
                        Err(e) => println!("Error disconnecting device: {}", e),
                        _ => (),
                    }
                }
            }
            Operation::Reconnect(request) => {
                println!("Reconnecting cameras {:?}", request.devices);
                // for now, just reconnect all Lumix devices
                for device in devices.iter_mut() {
                    if !device.name().starts_with("Lumix") {
                        continue;
                    }
                    match device.reconnect().await {
                        Err(e) => println!("Error reconnecting device: {}", e),
                        _ => (),
                    }
                }
            }
            Operation::Shutdown => {
                println!("Shutting down...");
                match future::try_join_all(devices.iter_mut().map(|d| d.disconnect())).await {
                    Err(e) => println!("Error disconnecting devices: {}", e),
                    _ => (),
                }
                break;
            }
        }
    }
    Ok(())
}

async fn web_server(
    command_tx: mpsc::UnboundedSender<Operation>,
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
    let app = Router::new()
        .fallback_service(ServeDir::new(assets_dir).append_index_html_on_directories(true))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
        .route("/control", any(|ws, user_agent, info| ws_handler(cloned_tx, ws, user_agent, info)));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8000")
        .await
        .unwrap();
    println!("listening on {}", listener.local_addr().unwrap());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    ).with_graceful_shutdown(shutdown_signal())
    .await
    .unwrap();
    command_tx.send(Operation::Shutdown).unwrap();
}

async fn ws_handler(
    command_tx: mpsc::UnboundedSender<Operation>,
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
    ws.on_upgrade(move |socket| handle_socket(command_tx, socket, addr))
}

async fn handle_socket(
    command_tx: mpsc::UnboundedSender<Operation>,
    socket: WebSocket,
    who: SocketAddr,
) {
    let (_, mut receiver) = socket.split();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if process_message(command_tx.clone(), msg, who).is_break() {
                break;
            }
        }
    });

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
        _ => ()
    }
    ControlFlow::Continue(())
}

#[derive(Deserialize, Debug)]
enum Request {
    #[serde(rename="command")]
    Command(CommandRequest),
    #[serde(rename="disconnect")]
    Disconnect(DisconnectRequest),
    #[serde(rename="reconnect")]
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
