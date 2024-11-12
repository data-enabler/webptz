use async_trait::async_trait;

pub struct Dummy {}

impl std::fmt::Display for Dummy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "Dummy");
    }
}

#[async_trait]
impl super::Device for Dummy {
    async fn connect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("Dummy: Connecting");
        Ok(())
    }

    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn std::error::Error>> {
        println!("Dummy: Sending command {:?}", command);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("Dummy: Disconnecting");
        Ok(())
    }
}
