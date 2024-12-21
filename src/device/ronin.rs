use std::{error::Error, time::Duration};

use async_trait::async_trait;
use btleplug::{
    api::{
        bleuuid::uuid_from_u16, Central as _, Characteristic, Peripheral as _, ScanFilter,
        WriteType,
    },
    platform::{Adapter, Peripheral},
};

#[allow(unused)]
pub const SERVICE_UUID: uuid::Uuid = uuid_from_u16(0xfff0);
pub const CHARACTERISTIC_UUID: uuid::Uuid = uuid_from_u16(0xfff5);
const CUSTOM_ALG: crc::Algorithm<u16> = crc::Algorithm {
    width: 16,
    poly: 0x1021,
    init: 0x496c,
    refin: true,
    refout: true,
    xorout: 0x0000,
    check: 0x7109,
    residue: 0x0000,
};
const CRC: crc::Crc<u16> = crc::Crc::<u16>::new(&CUSTOM_ALG);

fn add_checksum(b: &[u8]) -> Vec<u8> {
    let checksum = CRC.checksum(b).to_le_bytes();
    let concat = [b, &checksum].concat();
    return concat;
}

// Expects a value in the range [-1024, 1024]
fn encode_value(val: i16) -> Vec<u8> {
    const BASE: u16 = 1024;
    return BASE
        .checked_add_signed(val)
        .expect("value outside allowed range")
        .to_le_bytes()
        .to_vec();
}

fn create_packet(seq_num: u16, pan: i16, tilt: i16, roll: i16) -> Vec<u8> {
    let prefix = vec![0x55, 0x16, 0x04, 0xfc, 0x02, 0x04];
    let midfix = vec![0x40, 0x04, 0x01];
    let suffix = vec![0x00, 0x00, 0x02];

    let seq_bytes = seq_num.to_le_bytes().to_vec();
    let pan_bytes = encode_value(pan);
    let tilt_bytes = encode_value(tilt);
    let roll_bytes = encode_value(roll);

    let concat = [
        prefix, seq_bytes, midfix, tilt_bytes, roll_bytes, pan_bytes, suffix,
    ]
    .concat();
    return add_checksum(&concat);
}

fn scale_value(val: f64) -> i16 {
    // Scale value to [-1024, 1024] and make it easier to hit smaller values
    return (val * val.abs() * 256.0) as i16;
}

pub struct Ronin {
    id: String,
    name: String,
    seq: u16,
    adapter: Adapter,
    connection: Option<Connection>,
}

struct Connection {
    peripheral: Peripheral,
    characteristic: Characteristic,
}

impl Ronin {
    pub fn inc_seq(&mut self) {
        self.seq = self.seq.wrapping_add(1);
    }
}

impl std::fmt::Display for Ronin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Ronin[{}]", self.name)
    }
}

#[async_trait]
impl super::Device for Ronin {
    fn id(&self) -> String {
        self.id.clone()
    }

    async fn connect(&mut self) -> Result<(), Box<dyn Error>> {
        println!("{}: Connecting", self);
        let peripheral = find_peripheral(&self.adapter, &self.name).await?;
        peripheral.connect().await?;
        peripheral.discover_services().await?;
        let characteristic = match peripheral
            .characteristics()
            .iter()
            .find(|c| c.uuid == CHARACTERISTIC_UUID)
        {
            None => return Err("characteristic not found".into()),
            Some(x) => x.to_owned(),
        };
        self.connection = Some(Connection {
            peripheral,
            characteristic,
        });
        println!("{}: Connected", self);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn Error>> {
        match &self.connection {
            None => {
                println!("{}: Already disconnected", self);
            }
            Some(c) => {
                println!("{}: Disconnecting", self);
                c.peripheral.disconnect().await?;
                self.connection = None;
                println!("{}: Disconnected", self);
            }
        }
        Ok(())
    }

    async fn reconnect(self: &mut Self) -> Result<(), Box<dyn Error>> {
        self.disconnect().await?;
        self.connect().await?;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connection.is_some()
    }

    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn Error>> {
        println!("{}: Received command {:?}", self, command);
        match &self.connection {
            None => {
                println!("{}: Not connected", self);
            }
            Some(c) => {
                if command.pan == 0.0 && command.tilt == 0.0 && command.roll == 0.0 {
                    return Ok(());
                }
                let pan_int = scale_value(command.pan);
                let tilt_int = scale_value(command.tilt);
                let roll_int = scale_value(command.roll);
                let content = create_packet(self.seq, pan_int, tilt_int, roll_int);
                println!("{}: Sending {}", self, hex::encode(&content));
                c.peripheral
                    .write(&c.characteristic, &content, WriteType::WithoutResponse)
                    .await?;
                self.inc_seq();
            }
        }
        Ok(())
    }
}

async fn find_peripheral(adapter: &Adapter, name: &str) -> Result<Peripheral, Box<dyn Error>> {
    adapter.start_scan(ScanFilter::default()).await?;

    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let peripherals = adapter.peripherals().await?;
        for p in peripherals {
            if p.properties()
                .await?
                .and_then(|p| p.local_name)
                .map(|n| n == name)
                .unwrap_or(false)
            {
                adapter.stop_scan().await?;
                return Ok(p);
            }
        }
    }

    adapter.stop_scan().await?;
    Err(format!("unable to find peripheral {}", name).into())
}

pub fn create(id: &str, adapter: Adapter, name: &str) -> Ronin {
    Ronin {
        id: id.to_owned(),
        name: name.to_owned(),
        seq: 0,
        adapter,
        connection: None,
    }
}
