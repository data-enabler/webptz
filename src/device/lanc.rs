use std::{
    time::{Duration, Instant},
    vec,
};

use async_trait::async_trait;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::mpsc::UnboundedSender,
    task::JoinHandle,
};
use tokio_serial::SerialPortBuilderExt as _;

// Other potentially useful commands:
// 2835: Zoom Tele slow
// 2837: Zoom Wide slow
// 2845: Focus Far
// 2847: Focus Near
// 2853: Iris Close
// 2855: Iris Open

const INTERVAL: Duration = Duration::from_millis(200);

pub struct Lanc {
    id: String,
    port: String,
    connection: Option<Connection>,
}

type LancCommand = [u8; 5];

struct Connection {
    communication_channel: UnboundedSender<[LancCommand; 2]>,
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
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<[LancCommand; 2]>();
        let communication_thread = tokio::spawn(async move {
            while let Some(data) = rx.recv().await {
                println!(
                    "{}: Writing commands {:?} {:?}",
                    name,
                    std::str::from_utf8(&data[0]).unwrap(),
                    std::str::from_utf8(&data[1]).unwrap(),
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

                    if let Err(e) = stream.write_all(&data[counter % 2]).await {
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
        let mut commands: Vec<LancCommand> = vec![];

        if command.zoom != 0.0 {
            commands.push(match command.zoom {
                x if x >= 0.8 => *b"280E\n",
                x if x >= 0.7 => *b"280C\n",
                x if x >= 0.6 => *b"280A\n",
                x if x >= 0.5 => *b"2808\n",
                x if x >= 0.4 => *b"2806\n",
                x if x >= 0.3 => *b"2804\n",
                x if x >= 0.2 => *b"2802\n",
                x if x >= 0.0 => *b"2800\n",
                x if x <= -0.8 => *b"281E\n",
                x if x <= -0.7 => *b"281C\n",
                x if x <= -0.6 => *b"281A\n",
                x if x <= -0.5 => *b"2818\n",
                x if x <= -0.4 => *b"2816\n",
                x if x <= -0.3 => *b"2814\n",
                x if x <= -0.2 => *b"2812\n",
                x if x <= -0.0 => *b"2810\n",
                _ => *b"0000\n",
            });
        }

        if command.autofocus {
            commands.push(*b"2843\n");
        } else if command.focus != 0.0 {
            commands.push(match command.focus {
                x if x >= 0.80 => *b"28EB\n",
                x if x >= 0.65 => *b"28E9\n",
                x if x >= 0.50 => *b"28E7\n",
                x if x >= 0.35 => *b"28E5\n",
                x if x >= 0.20 => *b"28E3\n",
                x if x >= 0.00 => *b"28E1\n",
                x if x <= -0.80 => *b"28FB\n",
                x if x <= -0.65 => *b"28F9\n",
                x if x <= -0.50 => *b"28F7\n",
                x if x <= -0.35 => *b"28F5\n",
                x if x <= -0.20 => *b"28F3\n",
                x if x <= -0.00 => *b"28F1\n",
                _ => *b"0000\n",
            });
        }

        if !commands.is_empty() {
            // We're always sending two commands just for convenience reasons
            if commands.len() == 1 {
                commands.push(*commands.first().unwrap());
            }
            let arr: [LancCommand; 2] = commands.try_into().unwrap();
            connection.communication_channel.send(arr)?;
        }

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
