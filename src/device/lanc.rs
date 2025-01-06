use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc::UnboundedSender,
    task::JoinHandle,
};
use tokio_serial::SerialPortBuilderExt as _;

const INTERVAL: Duration = Duration::from_millis(200);

pub struct Lanc {
    id: String,
    port: String,
    connection: Option<Connection>,
}

struct Connection {
    communication_channel: UnboundedSender<[u8; 5]>,
    #[allow(unused)]
    communication_thread: JoinHandle<()>,
}

impl std::fmt::Display for Lanc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LANC[{}]", self.port)
    }
}

#[async_trait]
impl super::Device for Lanc {
    fn id(&self) -> String {
        self.id.clone()
    }

    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let name = format!("{}", self);
        println!("{}: Connecting", name);
        let mut stream = tokio_serial::new(&self.port, 115200)
            .data_bits(tokio_serial::DataBits::Eight)
            .parity(tokio_serial::Parity::None)
            .stop_bits(tokio_serial::StopBits::One)
            .open_native_async()?;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<[u8; 5]>();
        let communication_thread = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                println!(
                    "{}: Writing command {:?}",
                    name,
                    std::str::from_utf8(&data).unwrap(),
                );
                let mut buf = [0; 32];
                let mut counter = 0;
                let timer = Instant::now();
                while timer.elapsed() < INTERVAL * 9 / 10 {
                    loop {
                        let read = match stream.read(&mut buf).await {
                            Ok(read) => read,
                            Err(e) => {
                                eprintln!("{}: Failed to read from stream: {}", name, e);
                                break;
                            }
                        };
                        // Signal from the Arduino that it has just finished sending a LANC command
                        if read > 0 && buf[read - 1] == 0xA {
                            break;
                        }
                    }

                    if let Err(e) = stream.write_all(&data).await {
                        eprintln!("{}: Failed to write to stream: {}", name, e);
                    }
                    counter += 1;
                }
                println!(
                    "{}: Wrote {} commands over {:?}",
                    name,
                    counter,
                    timer.elapsed(),
                );
            }
            println!("{}: Communication channel closed", name);
        });
        self.connection = Some(Connection {
            communication_channel: tx,
            communication_thread,
        });
        println!("{}: Connected", self);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let name = format!("{}", self);
        match &mut self.connection {
            None => {
                println!("{}: Already disconnected", name);
            }
            Some(ref mut _c) => {
                println!("{}: Disconnecting", name);
                self.connection = None;
                println!("{}: Disconnected", name);
            }
        }
        Ok(())
    }

    async fn reconnect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.disconnect().await?;
        self.connect().await?;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connection.is_some()
    }

    async fn send_command(
        &mut self,
        command: super::Command,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let name = format!("{}", self);
        if self.connection.is_none() {
            println!("{}: Not connected", name);
            return Ok(());
        }
        let connection = self.connection.as_mut().unwrap();

        println!("{}: Received command {:?}", name, command);
        if command.zoom == 0.0 {
            return Ok(());
        }

        // Other potentially useful commands:
        // 2835: Zoom Tele slow
        // 2837: Zoom Wide slow
        // 2845: Focus Far
        // 2847: Focus Near
        let command = match command.zoom {
            x if x >= 0.8 => b"280E\n",
            x if x >= 0.7 => b"280C\n",
            x if x >= 0.6 => b"280A\n",
            x if x >= 0.5 => b"2808\n",
            x if x >= 0.4 => b"2806\n",
            x if x >= 0.3 => b"2804\n",
            x if x >= 0.2 => b"2802\n",
            x if x >= 0.0 => b"2800\n",
            x if x <= -0.8 => b"281E\n",
            x if x <= -0.7 => b"281C\n",
            x if x <= -0.6 => b"281A\n",
            x if x <= -0.5 => b"2818\n",
            x if x <= -0.4 => b"2816\n",
            x if x <= -0.3 => b"2814\n",
            x if x <= -0.2 => b"2812\n",
            x if x <= -0.0 => b"2810\n",
            _ => b"0000\n",
        };
        connection.communication_channel.send(*command)?;

        Ok(())
    }
}

pub fn create(id: &str, port: &str) -> Lanc {
    Lanc {
        id: id.to_string(),
        port: port.to_string(),
        connection: None,
    }
}
