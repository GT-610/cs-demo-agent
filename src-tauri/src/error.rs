use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("demo file error: {0}")]
    DemoFile(String),
    #[error("demo parse error: {0}")]
    DemoParse(String),
    #[error("provider request error: {0}")]
    Provider(String),
    #[error("serialization error: {0}")]
    Serialization(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("credential store error: {0}")]
    Credential(String),
}

pub type AppResult<T> = Result<T, AppError>;
