use std::error::Error;

use async_trait::async_trait;
use serde::Deserialize;

pub mod dummy;
pub mod ronin;

#[derive(Deserialize, Debug, Copy, Clone)]
pub struct Command {
    pub pan: f64,
    pub tilt: f64,
    pub roll: f64,
}

#[async_trait]
pub trait Device: std::fmt::Display {
    async fn connect(self: &mut Self) -> Result<(), Box<dyn Error>>;
    async fn send_command(self: &mut Self, command: Command) -> Result<(), Box<dyn Error>>;
    async fn disconnect(self: &mut Self) -> Result<(), Box<dyn Error>>;
}
