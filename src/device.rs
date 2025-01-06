use std::error::Error;

use async_trait::async_trait;
use serde::Deserialize;

pub mod dummy;
pub mod lanc;
pub mod lumix;
pub mod ronin;

#[derive(Deserialize, Debug, Copy, Clone)]
pub struct Command {
    pub pan: f64,
    pub tilt: f64,
    pub roll: f64,
    pub zoom: f64,
}

#[async_trait]
pub trait Device: std::fmt::Display {
    async fn send_command(&mut self, command: Command) -> Result<(), Box<dyn Error>>;

    async fn connect(&mut self) -> Result<(), Box<dyn Error>>;

    async fn disconnect(&mut self) -> Result<(), Box<dyn Error>>;

    async fn reconnect(&mut self) -> Result<(), Box<dyn Error>>;

    fn is_connected(&self) -> bool;

    fn name(&self) -> String {
        format!("{}", self)
    }

    fn id(&self) -> String;
}
