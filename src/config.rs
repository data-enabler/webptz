use itertools::Itertools;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    error::Error,
};

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub groups: Vec<Group>,
    pub devices: HashMap<String, DeviceConfig>,
    pub default_controls: Option<Vec<Mappings>>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub name: String,
    pub devices: Vec<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DeviceConfig {
    Dummy(DummyConfig),
    Ronin(RoninConfig),
    Lumix(LumixConfig),
    Lanc(LancConfig),
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DummyConfig {
    pub name: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoninConfig {
    pub name: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LumixConfig {
    pub address: String,
    pub password: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LancConfig {
    pub port: String,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mappings {
    pub pan_l: Vec<PadInput>,
    pub pan_r: Vec<PadInput>,
    pub tilt_u: Vec<PadInput>,
    pub tilt_d: Vec<PadInput>,
    pub roll_l: Vec<PadInput>,
    pub roll_r: Vec<PadInput>,
    pub zoom_i: Vec<PadInput>,
    pub zoom_o: Vec<PadInput>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PadInput {
    pub pad_index: usize,
    #[serde(rename = "type")]
    pub input_type: String,
    pub input_index: usize,
    pub multiplier: f32,
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
    check_duplicate_group_names(&config)?;
    detect_undefined_devices(&config)?;
    Ok(config)
}

fn check_duplicate_group_names(config: &Config) -> Result<(), Box<dyn Error>> {
    let dupes: Vec<&String> = config.groups.iter().map(|g| &g.name).duplicates().collect();
    if !dupes.is_empty() {
        return Err(format!("duplicate group names: {}", dupes.iter().join(", ")).into());
    }
    Ok(())
}

#[test]
fn test_check_duplicate_group_names() {
    let config = Config {
        groups: vec![
            Group {
                name: "group1".to_string(),
                devices: vec![],
            },
            Group {
                name: "group2".to_string(),
                devices: vec![],
            },
            Group {
                name: "group1".to_string(),
                devices: vec![],
            },
        ],
        devices: HashMap::new(),
        default_controls: None,
    };
    assert!(check_duplicate_group_names(&config).is_err());
}

fn detect_undefined_devices(config: &Config) -> Result<(), Box<dyn Error>> {
    let device_ids: HashSet<&String> = config.devices.keys().collect();
    let used_ids: HashSet<&String> = config
        .groups
        .iter()
        .flat_map(|g| g.devices.iter())
        .collect();
    let undefined_ids: Vec<&str> = used_ids
        .difference(&device_ids)
        .map(|&x| x.as_str())
        .collect();
    if !undefined_ids.is_empty() {
        return Err(format!("devices not defined: {}", undefined_ids.join(", ")).into());
    }
    Ok(())
}

#[test]
fn test_detect_undefined_devices() {
    let config = Config {
        groups: vec![
            Group {
                name: "group1".to_string(),
                devices: vec!["device1".to_string()],
            },
            Group {
                name: "group2".to_string(),
                devices: vec!["device2".to_string()],
            },
        ],
        devices: HashMap::from([
            (
                "device1".to_string(),
                DeviceConfig::Dummy(DummyConfig {
                    name: "dummy".to_string(),
                }),
            ),
            (
                "device3".to_string(),
                DeviceConfig::Dummy(DummyConfig {
                    name: "dummy".to_string(),
                }),
            ),
        ]),
        default_controls: None,
    };
    assert!(detect_undefined_devices(&config).is_err());
}
