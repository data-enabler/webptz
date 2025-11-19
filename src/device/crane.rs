use async_trait::async_trait;
use btleplug::{
    api::{Central as _, Characteristic, Peripheral as _, ScanFilter, WriteType},
    platform::{Adapter, Peripheral},
};
use futures::TryFutureExt as _;
use itertools::Itertools;
use std::{
    collections::HashSet,
    error::Error,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{sync::watch, time::timeout};
use uuid::uuid;

use crate::config::{all_capabilities, Capability, CraneConfig, CraneOption};

const COMMAND_UUID: uuid::Uuid = uuid!("d44bc439-abfd-45a2-b575-925416129600");
const CUSTOM_ALG: crc::Algorithm<u16> = crc::Algorithm {
    width: 16,
    poly: 0x1021,
    init: 0x0000,
    refin: false,
    refout: false,
    xorout: 0x25b1,
    check: 0x0000,
    residue: 0x0000,
};
const CRC: crc::Crc<u16> = crc::Crc::<u16>::new(&CUSTOM_ALG);
const PTR_BASE: u16 = 2048;
const PTR_MIN: u16 = 2;

pub fn add_checksum(b: &[u8]) -> Vec<u8> {
    let checksum = CRC.checksum(b).to_le_bytes();
    [b, &checksum].concat()
}

fn scale_ptr_value(val: f64) -> i16 {
    // Scale value to the correct range and make it easier to hit smaller values
    const MIN: i16 = PTR_MIN as i16;
    const MAX: i16 = (PTR_BASE as i16) - 1;
    if val == 0.0 {
        return 0;
    }
    let magnitude = (val.powi(3).abs() * PTR_BASE as f64) as i16;
    magnitude.clamp(MIN, MAX) * val.signum() as i16
}

fn encode_value(val: i16) -> Vec<u8> {
    PTR_BASE
        .checked_add_signed(val)
        .expect("value outside allowed range")
        .to_le_bytes()
        .to_vec()
}

fn create_tilt_packet(seq_num: u8, tilt: f64) -> Vec<u8> {
    let tilt_int = scale_ptr_value(tilt);

    let prefix = vec![0x24, 0x3c, 0x08, 0x00, 0x18, 0x12];
    let midfix = vec![0x01, 0x01, 0x10];

    let seq_bytes = vec![seq_num];
    let tilt_bytes = encode_value(tilt_int);

    let concat = [prefix, seq_bytes, midfix, tilt_bytes].concat();
    add_checksum(&concat)
}

fn create_roll_packet(seq_num: u8, roll: f64) -> Vec<u8> {
    let roll_int = scale_ptr_value(roll);

    let prefix = vec![0x24, 0x3c, 0x08, 0x00, 0x18, 0x12];
    let midfix = vec![0x01, 0x02, 0x10];

    let seq_bytes = vec![seq_num];
    let roll_bytes = encode_value(roll_int);

    let concat = [prefix, seq_bytes, midfix, roll_bytes].concat();
    add_checksum(&concat)
}

fn create_pan_packet(seq_num: u8, pan: f64) -> Vec<u8> {
    let pan_int = scale_ptr_value(pan);

    let prefix = vec![0x24, 0x3c, 0x08, 0x00, 0x18, 0x12];
    let midfix = vec![0x01, 0x03, 0x10];

    let seq_bytes = vec![seq_num];
    let pan_bytes = encode_value(pan_int);

    let concat = [prefix, seq_bytes, midfix, pan_bytes].concat();
    add_checksum(&concat)
}

fn get_seq(next_seq: &watch::Sender<u8>) -> u8 {
    let mut seq = 0;
    next_seq.send_modify(|s| {
        seq = *s;
        *s = s.wrapping_add(1);
    });
    seq
}

pub struct Crane {
    id: String,
    name: String,
    next_seq: watch::Sender<u8>,
    adapter: Adapter,
    connection: Option<Connection>,
    capabilities: HashSet<Capability>,
    options: HashSet<CraneOption>,
}

struct Connection {
    peripheral: Peripheral,
    characteristic: Arc<Mutex<Characteristic>>,
}

impl Connection {
    pub async fn try_resume_connection(&mut self, name: &str) -> Result<(), Box<dyn Error>> {
        if self.peripheral.is_connected().await? {
            return Ok(());
        }
        println!("{}: Lost connection, reconnecting...", name);
        let timer = Instant::now();
        self.peripheral.disconnect().await?;

        timeout(Duration::from_millis(200), self.peripheral.connect())
            .map_err(|_| -> Box<dyn Error> {
                format!("{}: timed out while trying to reconnect", name).into()
            })
            .await??;

        let command_characteristic = get_characteristic(&self.peripheral, COMMAND_UUID).await?;
        *self.characteristic.lock().unwrap() = command_characteristic;
        println!("{}: Reconnected in {:?}", name, timer.elapsed());
        Ok(())
    }
}

impl std::fmt::Display for Crane {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Crane[{}]", self.name)
    }
}

#[async_trait]
impl super::Device for Crane {
    fn id(&self) -> String {
        self.id.clone()
    }

    async fn connect(&mut self) -> Result<(), Box<dyn Error>> {
        let name = format!("{}", self);
        println!("{}: Connecting", name);

        let peripheral = find_peripheral(&self.adapter, &self.name).await?;
        peripheral.connect().await?;
        let cmd_characteristic = Arc::new(Mutex::new(
            get_characteristic(&peripheral, COMMAND_UUID).await?,
        ));

        self.connection = Some(Connection {
            peripheral,
            characteristic: cmd_characteristic,
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

    async fn reconnect(&mut self) -> Result<(), Box<dyn Error>> {
        self.disconnect().await?;
        self.connect().await?;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connection.is_some()
    }

    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn Error>> {
        let name = format!("{}", self);
        println!("{}: Received command {:?}", name, command);
        match &mut self.connection {
            None => {
                println!("{}: Not connected", name);
            }
            Some(ref mut c) => {
                let pan = if self.options.contains(&CraneOption::ReversePan) {
                    -command.pan
                } else {
                    command.pan
                };
                let tilt = if self.options.contains(&CraneOption::ReverseTilt) {
                    -command.tilt
                } else {
                    command.tilt
                };
                let roll = if self.options.contains(&CraneOption::ReverseRoll) {
                    -command.roll
                } else {
                    command.roll
                };

                let send_ptr = self.capabilities.contains(&Capability::Ptr)
                    && (pan != 0.0 || tilt != 0.0 || roll != 0.0);
                if !send_ptr {
                    return Ok(());
                }

                c.try_resume_connection(&name).await?;

                let packets = vec![
                    create_tilt_packet(get_seq(&self.next_seq), tilt),
                    create_roll_packet(get_seq(&self.next_seq), roll),
                    create_pan_packet(get_seq(&self.next_seq), pan),
                ];
                print!(
                    "{}: Sending PTR commands {}",
                    name,
                    packets.iter().map(hex::encode).join(" ")
                );
                let cmd_characteristic = c.characteristic.lock().unwrap().clone();
                for packet in packets {
                    c.peripheral
                        .write(&cmd_characteristic, &packet, WriteType::WithoutResponse)
                        .await
                        .unwrap();
                }
                println!(" ...sent");
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

async fn get_characteristic(
    peripheral: &Peripheral,
    uuid: uuid::Uuid,
) -> Result<Characteristic, Box<dyn Error>> {
    peripheral.discover_services().await?;
    match peripheral.characteristics().iter().find(|c| c.uuid == uuid) {
        None => Err("characteristic not found".into()),
        Some(x) => Ok(x.to_owned()),
    }
}

pub fn create(id: &str, adapter: Adapter, config: &CraneConfig) -> Crane {
    let (next_seq, _) = watch::channel(0);
    Crane {
        id: id.to_owned(),
        name: config.name.to_owned(),
        next_seq,
        adapter,
        connection: None,
        capabilities: config
            .capabilities
            .clone()
            .map(HashSet::from_iter)
            .unwrap_or_else(all_capabilities),
        options: config
            .options
            .clone()
            .map(HashSet::from_iter)
            .unwrap_or_default(),
    }
}

#[test]
fn test_checksum() {
    let values = vec![
        "243c080018122801011000083252",
        "243c080018122901021000084e8c",
        "243c080018122a010310d40e3f8d",
        "243c080018122b0101100008d29c",
        "243c080018122c01021000084fcf",
        "243c080018122d010310d40e7e45",
        "243c080018122e0101100008d3df",
        "243c080018122f0102100008af01",
        "243c0800181230010310d40eb911",
        "243c08001812310101102c01f6d2",
        "243c080018123201021000086855",
        "243c0800181233010310d40e59df",
        "243c080018123401011000085543",
        "243c08001812350102100008299d",
        "243c08001812360103102c01dff7",
        "243c08001812370101100008b58d",
        "243c080018123801021000086ad3",
        "243c08001812390103102c01dc32",
        "243c080018123a0101100008f6c3",
        "243c080018123b01021000088a1d",
        "243c080018123c0103102c01dd71",
        "243c080018123d0101100008b70b",
        "243c080018123e01021000088b5e",
        "243c080018123f0103102c013dbf",
        "243c080018124001011000086800",
        "243c0800181241010210000814de",
        "243c08001812420103102c01e2b4",
        "243c0800181243010110000888ce",
        "243c08001812440102100008159d",
    ];
    for v in values {
        let bytes = &hex::decode(v).unwrap()[0..12];
        let with_checksum = add_checksum(bytes);
        assert_eq!(hex::encode(with_checksum), v,);
    }
}
