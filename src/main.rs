use axum::extract::ws::{Message, WebSocket};
use axum::extract::{ConnectInfo, WebSocketUpgrade};
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;
use axum_extra::{headers, TypedHeader};
use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Adapter, Manager, Peripheral};
use device::Device;
use futures::{future, StreamExt};
use serde::Deserialize;
use tokio::signal;
use tokio::sync::mpsc;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use std::error::Error;
use std::net::SocketAddr;
use std::ops::ControlFlow;
use std::path::PathBuf;
use tower_http::services::ServeDir;

mod device;

enum Operation {
    Command(ControlRequest),
    Shutdown,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let (command_tx, mut command_rx) = mpsc::unbounded_channel::<Operation>();

    tokio::spawn(web_server(command_tx));

    let mut devices: Vec<Box<dyn Device>> = vec![];
    get_devices(&mut devices).await.unwrap();
    while let Some(operation) = command_rx.recv().await {
        match operation {
            Operation::Command(request) => {
                println!("Sending command: {:?} to cameras {:?}", request.command, request.devices);
                // for now, just send to all devices
                for device in devices.iter_mut() {
                    match device.send_command(request.command).await {
                        Ok(_) => println!("Command sent successfully"),
                        Err(e) => println!("Error sending command: {}", e),
                    }
                }
            }
            Operation::Shutdown => {
                println!("Shutting down...");
                match future::try_join_all(devices.iter_mut().map(|d| d.disconnect())).await {
                    Err(e) => println!("Error disconnecting devices: {}", e),
                    _ => ()
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

async fn get_devices(devices: &mut Vec<Box<dyn Device>>) -> Result<(), Box<dyn Error>> {
    let manager = Manager::new().await?;

    let adapters = manager.adapters().await?;
    let central = match adapters.into_iter().nth(0) {
        None => return Err("no bluetooth adapter found".into()),
        Some(x) => x,
    };
    let info = central.adapter_info().await?;
    println!("Using adapter: {}", info);

    central.start_scan(ScanFilter::default()).await?;
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    central.stop_scan().await?;

    let mut device: Box<dyn device::Device> = match find_gimbal(&central).await {
        // None => return Err("no gimbal found".into()),
        None => Box::new(device::dummy::Dummy{}),
        Some(x) => Box::new(device::ronin::Ronin::new(x)),
    };

    device.connect().await?;
    devices.push(device);
    Ok(())
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
            let r: ControlRequest = match serde_json::from_str(&t) {
                Ok(x) => x,
                Err(e) => {
                    println!(">>> {who} sent invalid json: {e}");
                    return ControlFlow::Continue(());
                }
            };
            println!(">>> {who} sent command: {r:?}");
            match command_tx.send(Operation::Command(r)) {
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
struct ControlRequest {
    devices: Vec<String>,
    #[serde(flatten)]
    command: device::Command,
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

async fn find_gimbal(central: &Adapter) -> Option<Peripheral> {
    for p in central.peripherals().await.unwrap() {
        if p.properties()
            .await
            .unwrap()
            .unwrap()
            .local_name
            .iter()
            .any(|name| name.contains("DJI"))
        {
            return Some(p);
        }
    }
    None
}
