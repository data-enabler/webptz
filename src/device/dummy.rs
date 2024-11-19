use std::error::Error;

use async_trait::async_trait;

pub struct Dummy {
    id: String,
}

impl std::fmt::Display for Dummy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Dummy")
    }
}

#[async_trait]
impl super::Device for Dummy {
    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn Error>> {
        println!("{}: Received command {:?}", self, command);
        Ok(())
    }

    async fn connect(&mut self) -> Result<(), Box<dyn Error>> {
        println!("{}: Connected", self);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn Error>> {
        println!("{}: Disconnecting", self);
        Ok(())
    }

    async fn reconnect(self: &mut Self) -> Result<(), Box<dyn Error>> {
        self.disconnect().await?;
        self.connect().await?;
        Ok(())
    }

    fn id(&self) -> String {
        self.id.clone()
    }
}

#[allow(unused)]
pub fn create() -> Dummy {
    Dummy {
        id: uuid::Uuid::new_v4().to_string(),
    }
}
