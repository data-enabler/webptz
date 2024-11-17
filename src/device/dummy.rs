use async_trait::async_trait;

pub struct Dummy {}

impl std::fmt::Display for Dummy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Dummy")
    }
}

#[async_trait]
impl super::Device for Dummy {
    async fn send_command(&mut self, command: super::Command) -> Result<(), Box<dyn std::error::Error>> {
        println!("{}: Received command {:?}", self, command);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        println!("{}: Disconnecting", self);
        Ok(())
    }
}

pub async fn connect() -> Result<Dummy, Box<dyn std::error::Error>> {
    let dummy = Dummy{};
    println!("{}: Connected", dummy);
    Ok(dummy)
}
