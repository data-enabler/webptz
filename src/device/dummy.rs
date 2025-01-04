use std::error::Error;

use async_trait::async_trait;

pub struct Dummy {
    id: String,
    name: String,
    connected: bool,
}

impl std::fmt::Display for Dummy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Dummy[{}]", self.name)
    }
}

#[async_trait]
impl super::Device for Dummy {
    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn Error>> {
        println!("{}: Received command {:?}", self, command);
        Ok(())
    }

    async fn connect(&mut self) -> Result<(), Box<dyn Error>> {
        self.connected = true;
        println!("{}: Connected", self);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn Error>> {
        self.connected = false;
        println!("{}: Disconnecting", self);
        Ok(())
    }

    async fn reconnect(&mut self) -> Result<(), Box<dyn Error>> {
        self.disconnect().await?;
        self.connect().await?;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn id(&self) -> String {
        self.id.clone()
    }
}

#[allow(unused)]
pub fn create() -> Dummy {
    Dummy {
        id: uuid::Uuid::new_v4().to_string(),
        name: "".to_string(),
        connected: false,
    }
}

#[allow(unused)]
pub fn create_with_id_and_name(id: &str, name: &str) -> Dummy {
    Dummy {
        id: id.to_string(),
        name: name.to_string(),
        connected: false,
    }
}
