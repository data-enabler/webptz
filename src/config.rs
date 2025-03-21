use indexmap::IndexMap;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, env, error::Error};

#[derive(Deserialize, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub groups: Vec<Group>,
    pub devices: IndexMap<String, DeviceConfig>,
    pub default_controls: Option<Vec<Mappings>>,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub name: String,
    pub devices: Vec<String>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DeviceConfig {
    Dummy(DummyConfig),
    Ronin(RoninConfig),
    Lumix(LumixConfig),
    Lanc(LancConfig),
}

#[derive(Deserialize, Serialize, Debug, PartialEq, Eq, Hash, Clone)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Ptr,
    Zoom,
    Focus,
    Autofocus,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DummyConfig {
    pub capabilities: Option<Vec<Capability>>,
    pub name: String,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RoninConfig {
    pub capabilities: Option<Vec<Capability>>,
    pub name: String,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LumixConfig {
    pub capabilities: Option<Vec<Capability>>,
    pub address: String,
    pub password: Option<String>,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LancConfig {
    pub capabilities: Option<Vec<Capability>>,
    pub port: String,
}

#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Mappings {
    pub pan_l: Option<Vec<PadInput>>,
    pub pan_r: Option<Vec<PadInput>>,
    pub tilt_u: Option<Vec<PadInput>>,
    pub tilt_d: Option<Vec<PadInput>>,
    pub roll_l: Option<Vec<PadInput>>,
    pub roll_r: Option<Vec<PadInput>>,
    pub zoom_i: Option<Vec<PadInput>>,
    pub zoom_o: Option<Vec<PadInput>>,
    pub focus_f: Option<Vec<PadInput>>,
    pub focus_n: Option<Vec<PadInput>>,
    pub focus_a: Option<Vec<PadInput>>,
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

pub fn all_capabilities() -> HashSet<Capability> {
    HashSet::from([
        Capability::Ptr,
        Capability::Zoom,
        Capability::Focus,
        Capability::Autofocus,
    ])
}

pub async fn load_config() -> Result<Config, Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    let config_path = match args.get(1) {
        Some(path) => path,
        None => {
            println!("No config path provided, defaulting to config.json");
            "config.json"
        }
    };
    let content = tokio::fs::read_to_string(config_path).await?;
    let config: Config = serde_json::from_str(&content)?;
    check_duplicate_group_names(&config)?;
    detect_undefined_devices(&config)?;
    Ok(config)
}

pub async fn save_config(config: &Config) -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().collect();
    let config_path = match args.get(1) {
        Some(path) => path,
        None => "config.json",
    };
    let content = serde_json::to_string_pretty(config)?;
    tokio::fs::write(config_path, content).await?;
    Ok(())
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
        devices: IndexMap::new(),
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
        devices: IndexMap::from([
            (
                "device1".to_string(),
                DeviceConfig::Dummy(DummyConfig {
                    capabilities: None,
                    name: "dummy".to_string(),
                }),
            ),
            (
                "device3".to_string(),
                DeviceConfig::Dummy(DummyConfig {
                    capabilities: None,
                    name: "dummy".to_string(),
                }),
            ),
        ]),
        default_controls: None,
    };
    assert!(detect_undefined_devices(&config).is_err());
}
