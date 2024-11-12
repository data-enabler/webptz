use std::error::Error;

use async_trait::async_trait;
use btleplug::{
    api::{bleuuid::uuid_from_u16, Characteristic, Peripheral as _, WriteType},
    platform::Peripheral,
};

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

pub fn create_packet(seq_num: u16, pan: i16, tilt: i16, roll: i16) -> Vec<u8> {
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
    name: String,
    seq: u16,
    peripheral: Peripheral,
    characteristic: Option<Characteristic>,
}

impl Ronin {
    pub fn new(peripheral: Peripheral) -> Self {
        Self {
            name: peripheral.id().to_string(),
            seq: 0,
            peripheral,
            characteristic: None,
        }
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }

    pub fn reset_seq(&mut self) {
        self.seq = 0;
    }

    pub fn inc_seq(&mut self) {
        self.seq = self.seq.wrapping_add(1);
    }

    pub fn set_characteristic(&mut self, characteristic: Characteristic) {
        self.characteristic = Some(characteristic);
    }
}

impl std::fmt::Display for Ronin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Ronin[{}]", self.name)
    }
}

#[async_trait]
impl super::Device for Ronin {
    async fn connect(&mut self) -> Result<(), Box<dyn Error>> {
        match self
            .peripheral
            .properties()
            .await?
            .and_then(|p| p.local_name)
        {
            Some(x) => self.set_name(x),
            None => (),
        }
        println!("{}: Connecting", self);
        self.peripheral.connect().await?;
        self.peripheral.discover_services().await?;
        let chars = self.peripheral.characteristics();
        self.set_characteristic(match chars.iter().find(|c| c.uuid == CHARACTERISTIC_UUID) {
            None => return Err("characteristic not found".into()),
            Some(x) => x.to_owned(),
        });
        self.reset_seq();
        println!("{}: Connected", self);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn Error>> {
        println!("{}: Disconnecting", self);
        self.peripheral.disconnect().await?;
        Ok(())
    }

    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn Error>> {
        let char = match &self.characteristic {
            None => return Err("device not connected".into()),
            Some(x) => x,
        };
        let pan_int = scale_value(command.pan);
        let tilt_int = scale_value(command.tilt);
        let roll_int = scale_value(command.roll);
        let content = create_packet(self.seq, pan_int, tilt_int, roll_int);
        println!("{}: Sending {}", self, hex::encode(&content));
        self.peripheral
            .write(&char, &content, WriteType::WithoutResponse)
            .await?;
        self.inc_seq();
        Ok(())
    }
}
