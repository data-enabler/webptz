use std::error::Error;

use async_trait::async_trait;
use serde::Deserialize;

pub mod dummy;
pub mod ronin;
pub mod lumix;

#[derive(Deserialize, Debug, Copy, Clone)]
pub struct Command {
    pub pan: f64,
    pub tilt: f64,
    pub roll: f64,
    pub zoom: f64,
}

#[async_trait]
pub trait Device: std::fmt::Display {
    async fn send_command(self: &mut Self, command: Command) -> Result<(), Box<dyn Error>>;

    async fn connect(self: &mut Self) -> Result<(), Box<dyn Error>>;

    async fn disconnect(self: &mut Self) -> Result<(), Box<dyn Error>>;

    async fn reconnect(self: &mut Self) -> Result<(), Box<dyn Error>>;

    fn name(self: &Self) -> String {
        format!("{}", self)
    }

    fn id(self: &Self) -> String;
}
