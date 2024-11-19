use std::{collections::HashMap, env, error::Error};

use serde::Deserialize;

#[derive(Deserialize, Debug)]
pub struct Config {
  pub devices: HashMap<String, DeviceConfig>,
}

#[derive(Deserialize, Debug)]
pub enum DeviceConfig {
  #[serde(rename="ronin")]
  Ronin(RoninConfig),
  #[serde(rename="lumix")]
  Lumix(LumixConfig),
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
    },
  };
  let content = tokio::fs::read_to_string(config_path).await?;
  let config: Config = serde_json::from_str(&content)?;
  Ok(config)
}
