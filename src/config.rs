use std::{
    collections::{HashMap, HashSet},
    env,
    error::Error,
};

use serde::Deserialize;

#[derive(Deserialize, Debug, Default)]
pub struct Config {
    pub groups: Vec<Vec<String>>,
    pub devices: HashMap<String, DeviceConfig>,
}

#[derive(Deserialize, Debug)]
pub enum DeviceConfig {
    #[serde(rename = "dummy")]
    Dummy(DummyConfig),
    #[serde(rename = "ronin")]
    Ronin(RoninConfig),
    #[serde(rename = "lumix")]
    Lumix(LumixConfig),
}

#[derive(Deserialize, Debug)]
pub struct DummyConfig {
    pub name: String,
}

#[derive(Deserialize, Debug)]
pub struct RoninConfig {
    pub name: String,
}

#[derive(Deserialize, Debug)]
pub struct LumixConfig {
    pub address: String,
    pub password: Option<String>,
}

pub async fn load_config() -> Result<Config, Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    let config_path = match args.get(1) {
        Some(path) => path,
        None => {
            return Err("no config path provided".into());
        }
    };
    let content = tokio::fs::read_to_string(config_path).await?;
    let config: Config = serde_json::from_str(&content)?;
    detect_undefined_devices(&config)?;
    Ok(config)
}

fn detect_undefined_devices(config: &Config) -> Result<(), Box<dyn Error>> {
    let device_ids: HashSet<&String> = config.devices.keys().collect();
    let used_ids: HashSet<&String> = config.groups.iter().flatten().collect();
    let undefined_ids: Vec<&str> = used_ids
        .difference(&device_ids)
        .map(|&x| x.as_str())
        .collect();
    if !undefined_ids.is_empty() {
        return Err(format!("devices not defined: {}", undefined_ids.join(", ")).into());
    }
    Ok(())
}
