use async_trait::async_trait;
use btleplug::{
    api::{
        bleuuid::uuid_from_u16, Central as _, Characteristic, Peripheral as _, ScanFilter,
        WriteType,
    },
    platform::{Adapter, Peripheral},
};
use futures::{StreamExt, TryFutureExt as _};
use std::{
    error::Error,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{sync::watch, time::timeout};

#[allow(unused)]
pub const SERVICE_UUID: uuid::Uuid = uuid_from_u16(0xfff0);
pub const COMMAND_UUID: uuid::Uuid = uuid_from_u16(0xfff5);
pub const NOTIFICATION_UUID: uuid::Uuid = uuid_from_u16(0xfff4);
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
const ZOOM_MIN: u16 = 0;
const ZOOM_MAX: u16 = 4095;
const ZOOM_ENDPOINT_TOLERANCE: u16 = 20;
const ZOOM_SPEED_MIN: f64 = 3.0;
const ZOOM_SPEED_MAX: f64 = 1000.0;

fn add_checksum(b: &[u8]) -> Vec<u8> {
    let checksum = CRC.checksum(b).to_le_bytes();
    [b, &checksum].concat()
}

// Expects a value in the range [-1024, 1024]
fn encode_value(val: i16) -> Vec<u8> {
    const BASE: u16 = 1024;
    BASE.checked_add_signed(val)
        .expect("value outside allowed range")
        .to_le_bytes()
        .to_vec()
}

fn create_packet(seq_num: u16, pan: f64, tilt: f64, roll: f64) -> Vec<u8> {
    let pan_int = scale_ptr_value(pan);
    let tilt_int = scale_ptr_value(tilt);
    let roll_int = scale_ptr_value(roll);

    let prefix = vec![0x55, 0x16, 0x04, 0xfc, 0x02, 0x04];
    let midfix = vec![0x40, 0x04, 0x01];
    let suffix = vec![0x00, 0x00, 0x02];

    let seq_bytes = seq_num.to_le_bytes().to_vec();
    let pan_bytes = encode_value(pan_int);
    let tilt_bytes = encode_value(tilt_int);
    let roll_bytes = encode_value(roll_int);

    let concat = [
        prefix, seq_bytes, midfix, tilt_bytes, roll_bytes, pan_bytes, suffix,
    ]
    .concat();
    add_checksum(&concat)
}

fn scale_ptr_value(val: f64) -> i16 {
    // Scale value to [-1024, 1024] and make it easier to hit smaller values
    (val * val.abs() * 256.0) as i16
}

fn scale_zoom_value(val: f64) -> i32 {
    (val.signum() * (ZOOM_SPEED_MAX * val.abs().powf(2.5)).clamp(ZOOM_SPEED_MIN, ZOOM_SPEED_MAX))
        as i32
}

fn get_seq(next_seq: &watch::Sender<u16>) -> u16 {
    let mut seq = 0;
    next_seq.send_modify(|s| {
        seq = *s;
        *s = s.wrapping_add(1);
    });
    seq
}

pub struct Ronin {
    id: String,
    name: String,
    next_seq: watch::Sender<u16>,
    adapter: Adapter,
    connection: Option<Connection>,
}

struct Connection {
    peripheral: Peripheral,
    characteristic: Arc<Mutex<Characteristic>>,
    _event_task: tokio::task::JoinHandle<()>,
    _zoom_task: tokio::task::JoinHandle<()>,
    zoom_speed: watch::Sender<f64>,
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
        let notification_characteristic =
            get_characteristic(&self.peripheral, NOTIFICATION_UUID).await?;
        *self.characteristic.lock().unwrap() = command_characteristic;
        self.peripheral
            .subscribe(&notification_characteristic)
            .await?;
        println!("{}: Reconnected in {:?}", name, timer.elapsed());
        Ok(())
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
        let name = format!("{}", self);
        println!("{}: Connecting", name);
        let (current_zoom_tx, current_zoom_rx) = watch::channel::<u16>(0);
        let (zoom_speed_tx, zoom_speed_rx) = watch::channel::<f64>(0.0);
        let (zoom_movement_tx, zoom_movement_rx) = watch::channel::<Instant>(Instant::now());

        let peripheral = find_peripheral(&self.adapter, &self.name).await?;
        peripheral.connect().await?;
        let cmd_characteristic = Arc::new(Mutex::new(
            get_characteristic(&peripheral, COMMAND_UUID).await?,
        ));
        let notif_characteristic = get_characteristic(&peripheral, NOTIFICATION_UUID).await?;
        peripheral.subscribe(&notif_characteristic).await?;
        let event_task = create_event_task(peripheral.clone(), current_zoom_tx, zoom_movement_tx);

        let zoom_task = create_zoom_task(
            &name,
            peripheral.clone(),
            cmd_characteristic.clone(),
            self.next_seq.clone(),
            current_zoom_rx,
            zoom_movement_rx,
            zoom_speed_rx,
        );

        self.connection = Some(Connection {
            peripheral,
            characteristic: cmd_characteristic,
            _event_task: event_task,
            _zoom_task: zoom_task,
            zoom_speed: zoom_speed_tx,
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
                let ptr_unchanged =
                    command.pan == 0.0 && command.tilt == 0.0 && command.roll == 0.0;
                let zoom_unchanged = command.zoom == 0.0 && *c.zoom_speed.borrow() == 0.0;
                if ptr_unchanged && zoom_unchanged {
                    return Ok(());
                }

                c.try_resume_connection(&name).await?;

                if !ptr_unchanged {
                    let content = create_packet(
                        get_seq(&self.next_seq),
                        command.pan,
                        command.tilt,
                        command.roll,
                    );
                    print!("{}: Sending PTR command {}", name, hex::encode(&content));
                    let cmd_characteristic = c.characteristic.lock().unwrap().clone();
                    c.peripheral
                        .write(&cmd_characteristic, &content, WriteType::WithoutResponse)
                        .await
                        .unwrap();
                    println!(" ...sent");
                }

                if !zoom_unchanged {
                    c.zoom_speed.send_replace(command.zoom);
                }
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

fn create_event_task(
    peripheral: Peripheral,
    current_zoom_tx: watch::Sender<u16>,
    zoom_movement_tx: watch::Sender<Instant>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = peripheral.notifications().await.unwrap();
        let mut last_zoom: Option<u16> = None;
        loop {
            let val = stream.next().await;
            if let Some(v) = val {
                if v.value.len() > 6 && v.value[0..6] == [0x55, 0x1c, 0x04, 0x1b, 0xdf, 0x02] {
                    let zoom_level = u16::from_le_bytes([v.value[14], v.value[15]]);
                    current_zoom_tx.send_replace(zoom_level);
                    if last_zoom.is_some_and(|z| z != zoom_level) {
                        zoom_movement_tx.send_replace(Instant::now());
                    }
                    last_zoom = Some(zoom_level);
                }
            }
        }
    })
}

fn create_zoom_task(
    name: &str,
    peripheral: Peripheral,
    cmd_characteristic: Arc<Mutex<Characteristic>>,
    next_seq: watch::Sender<u16>,
    current_zoom_rx: watch::Receiver<u16>,
    zoom_movement_rx: watch::Receiver<Instant>,
    mut zoom_speed_rx: watch::Receiver<f64>,
) -> tokio::task::JoinHandle<()> {
    let name = name.to_owned();
    tokio::spawn(async move {
        loop {
            zoom_speed_rx.changed().await.unwrap();
            let mut speed = *zoom_speed_rx.borrow_and_update();
            let mut prev_speed: f64 = 0.0;
            let mut target_zoom = -1;
            while speed != 0.0 {
                let increment = scale_zoom_value(speed);
                let curr_zoom = *current_zoom_rx.borrow();
                if prev_speed == 0.0 || prev_speed.is_sign_positive() != speed.is_sign_positive() {
                    println!(
                        "{}: Starting zoom. Step: {}, Current zoom level: {}",
                        name, increment, curr_zoom
                    );
                    target_zoom = curr_zoom as i32 + increment;
                } else if zoom_movement_rx.borrow().elapsed() < Duration::from_millis(200) {
                    target_zoom += increment;
                }

                let clamped_target_zoom =
                    target_zoom.clamp(ZOOM_MIN as i32, ZOOM_MAX as i32) as u16;
                let at_min_endpoint = clamped_target_zoom <= curr_zoom
                    && curr_zoom < ZOOM_MIN + ZOOM_ENDPOINT_TOLERANCE;
                let at_max_endpoint = clamped_target_zoom >= curr_zoom
                    && curr_zoom > ZOOM_MAX - ZOOM_ENDPOINT_TOLERANCE;
                if !(at_min_endpoint || at_max_endpoint) {
                    let content = add_checksum(
                        &[
                            hex::decode("551204c702df").unwrap(),
                            get_seq(&next_seq).to_le_bytes().to_vec(),
                            hex::decode("00042f010002").unwrap(),
                            clamped_target_zoom.to_le_bytes().to_vec(),
                        ]
                        .concat(),
                    );

                    let cmd_characteristic = cmd_characteristic.lock().unwrap().clone();
                    peripheral
                        .write(&cmd_characteristic, &content, WriteType::WithoutResponse)
                        .await
                        .unwrap();
                }

                tokio::time::sleep(Duration::from_millis(50)).await;
                prev_speed = speed;
                speed = *zoom_speed_rx.borrow_and_update();
            }
            println!(
                "{}: Ending zoom. Current zoom level: {}",
                name,
                *current_zoom_rx.borrow(),
            );
        }
    })
}

pub fn create(id: &str, adapter: Adapter, name: &str) -> Ronin {
    let (next_seq, _) = watch::channel(0);
    Ronin {
        id: id.to_owned(),
        name: name.to_owned(),
        next_seq,
        adapter,
        connection: None,
    }
}

#[test]
fn test_checksum() {
    let bytes = vec![
        0x55, 0x11, 0x04, 0x92, 0x02, 0xdf, 0x20, 0x02, 0x00, 0x04, 0x2f, 0x0b, 0x00, 0x01, 0xc5,
    ];
    let with_checksum = add_checksum(&bytes);
    assert_eq!(
        hex::encode(with_checksum),
        "5511049202df200200042f0b0001c5f5a7"
    );
}
