use std::{fmt::Display, time::Duration};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::{io::{self, AsyncReadExt as _, AsyncWriteExt as _}, net::TcpStream};

const APP_UUID: &str = "52D5842E-90C6-4846-9665-C238229D22E9";
const APP_NAME: &str = "LUMIXTether";

trait WriteExt {
    async fn write_data(&mut self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>>;

    async fn write_and_read_resp(&mut self, data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>>;
}

impl WriteExt for TcpStream {
    async fn write_data(&mut self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        self.write_all(data).await?;
        Ok(())
    }

    async fn write_and_read_resp(&mut self, data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        self.write_data(data).await?;
        let mut buffer: [u8; 1024] = [0; 1024];
        let len = self.read(&mut buffer).await?;
        let rec_buf = &buffer[..len];
        Ok(rec_buf.to_vec())
    }
}

#[derive(Debug, Serialize)]
pub struct CommandPacket {
    length: u32,
    packet_type: u32,
    phase_info: u32,
    opcode: u16,
    transaction_id: u32,
    pub param1: u32,
    param2: u32,
    param3: u32,
    param4: u32,
    param5: u32,
}

impl Display for CommandPacket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let cmd_hex = hex::encode(bincode::serialize(&self).unwrap());
        write!(f, "{} {} {} {} {} {} {}", &cmd_hex[0..8], &cmd_hex[8..16], &cmd_hex[16..24], &cmd_hex[24..28], &cmd_hex[28..36], &cmd_hex[36..44], &cmd_hex[44..])
    }
}

impl CommandPacket {
    const fn open_session(transaction_id: u32) -> CommandPacket {
        CommandPacket {
            length: 0x26,
            packet_type: 0x06,
            phase_info: 0x01,
            opcode: 0x1002,
            transaction_id,
            param1: 0x00010001,
            param2: 0x00000000,
            param3: 0x00000000,
            param4: 0x00000000,
            param5: 0x00000000,
        }
    }

    pub const fn start_zoom(transaction_id: u32) -> CommandPacket {
        CommandPacket {
            length: 0x26,
            packet_type: 0x06,
            phase_info: 0x02,
            opcode: 0x9416,
            transaction_id,
            param1: 0x03000081,
            param2: 0x00000000,
            param3: 0x00000000,
            param4: 0x00000000,
            param5: 0x00000000,
        }
    }

    const fn stop_zoom(transaction_id: u32) -> CommandPacket {
        CommandPacket {
            length: 0x26,
            packet_type: 0x06,
            phase_info: 0x02,
            opcode: 0x9416,
            transaction_id,
            param1: 0x03000082,
            param2: 0x00000000,
            param3: 0x00000000,
            param4: 0x00000000,
            param5: 0x00000000,
        }
    }
}

enum DataPacket {
    ZoomStart(ZoomStartDataPacket),
    ZoomStop(ZoomStopDataPacket),
}

#[derive(Debug, Serialize)]
pub struct ZoomStartDataPacket {
    length: u32,
    packet_type: u32,
    transaction_id: u32,
    data_length: u64,
    unknown1: u64,
    transaction_id2: u32,
    param1: u32,
    unknown2: u32,
    dir: u16,
    // Values are 0 (stop), 1 (low), 2 (high)
    speed: u16,
}

impl Display for ZoomStartDataPacket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let data_hex = hex::encode(bincode::serialize(&self).unwrap());
        write!(f, "{} {} {} {} {} {} {}", &data_hex[0..8], &data_hex[8..16], &data_hex[16..24], &data_hex[24..40], &data_hex[40..56], &data_hex[56..64], &data_hex[64..])
    }
}

impl ZoomStartDataPacket {
    pub const fn create(transaction_id: u32, param1: u32, dir: u16, speed: u16) -> Self {
        ZoomStartDataPacket {
            length: 0x14,
            packet_type: 0x09,
            transaction_id,
            data_length: 0x0C,
            unknown1: 0x0000000C_00000018,
            transaction_id2: transaction_id,
            param1,
            unknown2: 0x04,
            dir,
            speed,
        }
    }
}

#[derive(Debug, Serialize)]
struct ZoomStopDataPacket {
    length: u32,
    packet_type: u32,
    transaction_id: u32,
    data_length: u64,
    unknown1: u64,
    transaction_id2: u32,
    param1: u32,
    unknown2: u32,
}

impl Display for ZoomStopDataPacket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let data_hex = hex::encode(bincode::serialize(&self).unwrap());
        write!(f, "{} {} {} {} {} {} {}", &data_hex[0..8], &data_hex[8..16], &data_hex[16..24], &data_hex[24..40], &data_hex[40..56], &data_hex[56..64], &data_hex[64..])
    }
}

impl ZoomStopDataPacket {
    const fn create(transaction_id: u32, param1: u32) -> Self {
        ZoomStopDataPacket {
            length: 0x14,
            packet_type: 0x09,
            transaction_id,
            data_length: 0x08,
            unknown1: 0x0000000C_00000014,
            transaction_id2: transaction_id,
            param1,
            unknown2: 0x00,
        }
    }
}

pub struct Lumix {
    #[allow(unused)]
    address: String,
    #[allow(unused)]
    password: Option<String>,
    #[allow(unused)]
    port: u16,
    name: String,
    socket: TcpStream,
    event_socket: TcpStream,
    curr_transaction_id: u32,
    curr_dir: u16,
    curr_speed: u16,
}

impl Lumix {
    async fn transaction(&mut self, cmd: CommandPacket, data: DataPacket) -> Result<(), Box<dyn std::error::Error>> {
        println!("{}: Sending {}", self, cmd);
        self.socket.write_data(&bincode::serialize(&cmd).unwrap()).await?;
        let serialized_data = match data {
            DataPacket::ZoomStart(data) => {
                println!("{}: Sending {}", self, data);
                bincode::serialize(&data).unwrap()
            },
            DataPacket::ZoomStop(data) => {
                println!("{}: Sending {}", self, data);
                bincode::serialize(&data).unwrap()
            },
        };
        let resp = self.socket.write_and_read_resp(&serialized_data).await?;
        println!("{}: Received {}", self, hex::encode(resp));
        self.curr_transaction_id += 1;
        Ok(())
    }
}

impl std::fmt::Display for Lumix {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Lumix[{}]", self.name)
    }
}

#[async_trait]
impl super::Device for Lumix {

    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn std::error::Error>> {
        println!("{}: Received command {:?}", self, command);
        let dir = match command.zoom {
            x if x < 0.0 => 0x00,
            x if x > 0.0 => 0x01,
            _ => self.curr_dir,
        };
        let speed = match command.zoom {
            x if x < -0.75 => 0x02,
            x if x < 0.0 => 0x01,
            x if x > 0.75 => 0x02,
            x if x > 0.0 => 0x01,
            _ => 0x00,
        };
        if (dir == self.curr_dir) && (speed == self.curr_speed) {
            return Ok(());
        }

        if self.curr_speed != 0 {
            let stop_cmd = CommandPacket::stop_zoom(self.curr_transaction_id);
            let stop_data = ZoomStopDataPacket::create(self.curr_transaction_id, stop_cmd.param1);
            self.transaction(stop_cmd, DataPacket::ZoomStop(stop_data)).await?;
        }

        if speed != 0 {
            let start_cmd = CommandPacket::start_zoom(self.curr_transaction_id);
            let start_data = ZoomStartDataPacket::create(self.curr_transaction_id, start_cmd.param1, dir, speed);
            self.transaction(start_cmd, DataPacket::ZoomStart(start_data)).await?;
        }

        self.curr_dir = dir;
        self.curr_speed = speed;
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("{}: Disconnecting", self);
        self.socket.shutdown().await?;
        self.event_socket.shutdown().await?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct DeviceInfo {
    #[serde(rename="friendlyName")]
    friendly_name: String,
    // quick-xml + serde doesn't support namespaces
    // #[serde(name="pana:X_PTPPortNo")]
    // ptp_port_no: u16,
}

#[derive(Debug, Deserialize)]
struct CameraInfo {
    device: DeviceInfo,
}

pub async fn connect(address: String, password: Option<String>) -> Result<Lumix, Box<dyn std::error::Error>> {
    println!("Lumix[{}]: Connecting", address);

    let info_resp = reqwest::get(format!("http://{}:60606/PTPRemote/Server0/ddd", address))
        .await?
        .text()
        .await?;
    let camera_info: CameraInfo = quick_xml::de::from_str(&info_resp)?;
    let name = camera_info.device.friendly_name.clone();
    // TODO: Get port from camera (requires being able to parse namespaced tags)
    let port: u16 = 15740;

    let acc_resp = reqwest::get(format!(
        "http://{}/cam.cgi?mode=accctrl&type=req_acc_a&value={}&value2={}{}",
        address,
        APP_UUID,
        APP_NAME,
        password.clone().map(|p| format!("&value3={}", p)).unwrap_or_default(),
    ))
    .await?
    .text()
    .await?;

    if !acc_resp.contains("<result>ok</result>") {
        return Err(acc_resp.into());
    }

    let mut socket = create_socket(address.to_string(), port).await?;

    let init_cmd = hex::decode("34000000_01000000_ffffffffffffffffffffffffffffffff_4c0055004d00490058005400650074006800650072000000_00000100".replace("_", "")).unwrap();
    socket.write_and_read_resp(&init_cmd).await?;

    let mut event_socket = create_socket(address.to_string(), port).await?;

    let init_event = hex::decode("0c000000_03000000_01000000".replace("_", "")).unwrap();
    event_socket.write_and_read_resp(&init_event).await?;

    let open_session_cmd = CommandPacket::open_session(0);
    socket.write_and_read_resp(&bincode::serialize(&open_session_cmd).unwrap()).await?;

    let lumix = Lumix {
        address,
        password,
        port,
        name,
        socket,
        event_socket,
        curr_transaction_id: 1,
        curr_dir: 0,
        curr_speed: 0,
    };
    println!("{}: Connected", lumix);
    Ok(lumix)
}

async fn create_socket(address: String, port: u16) -> io::Result<TcpStream> {
    let stream = TcpStream::connect((address, port)).await?;

    let sock_ref = socket2::SockRef::from(&stream);

    let mut ka = socket2::TcpKeepalive::new();
    ka = ka.with_time(Duration::from_secs(20));
    ka = ka.with_interval(Duration::from_secs(20));

    sock_ref.set_tcp_keepalive(&ka)?;
    Ok(stream)
}
