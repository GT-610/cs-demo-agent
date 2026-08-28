use std::{collections::HashMap, time::Duration};

use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADERS: usize = 32;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpJsonRequest {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Value,
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct HttpJsonResponse {
    pub status: u16,
    pub body: Value,
}

#[tauri::command]
pub async fn send_http_json(request: HttpJsonRequest) -> Result<HttpJsonResponse, String> {
    send_http_json_inner(request)
        .await
        .map_err(|error| error.to_string())
}

async fn send_http_json_inner(request: HttpJsonRequest) -> AppResult<HttpJsonResponse> {
    let url = validate_url(&request.url)?;
    let headers = validate_headers(request.headers)?;
    let request_bytes = serde_json::to_vec(&request.body)
        .map_err(|error| AppError::Serialization(error.to_string()))?;
    if request_bytes.len() > MAX_REQUEST_BYTES {
        return Err(AppError::InvalidInput(format!(
            "provider request exceeds {MAX_REQUEST_BYTES} bytes"
        )));
    }

    let timeout_ms = request.timeout_ms.clamp(1_000, 180_000);
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| AppError::Provider(error.to_string()))?;
    let response = client
        .post(url)
        .headers(headers)
        .body(request_bytes)
        .send()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::Provider(format!(
            "provider response exceeds {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    let body = serde_json::from_slice(&bytes).unwrap_or_else(|_| {
        Value::String(
            String::from_utf8_lossy(&bytes)
                .chars()
                .take(2_000)
                .collect(),
        )
    });

    Ok(HttpJsonResponse { status, body })
}

fn validate_url(value: &str) -> AppResult<Url> {
    let url = Url::parse(value)
        .map_err(|error| AppError::InvalidInput(format!("invalid provider URL: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::InvalidInput(
            "provider URL must use http or https".to_string(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::InvalidInput(
            "provider URL must not contain credentials".to_string(),
        ));
    }
    if url.host_str().is_none() {
        return Err(AppError::InvalidInput(
            "provider URL must include a host".to_string(),
        ));
    }
    Ok(url)
}

fn validate_headers(values: HashMap<String, String>) -> AppResult<HeaderMap> {
    if values.len() > MAX_HEADERS {
        return Err(AppError::InvalidInput(format!(
            "provider request has more than {MAX_HEADERS} headers"
        )));
    }

    let mut headers = HeaderMap::new();
    for (name, value) in values {
        let normalized = name.to_ascii_lowercase();
        if matches!(
            normalized.as_str(),
            "host" | "content-length" | "connection" | "transfer-encoding"
        ) {
            return Err(AppError::InvalidInput(format!(
                "header {name} is managed by the host"
            )));
        }
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| AppError::InvalidInput(format!("invalid header name: {error}")))?;
        let value = HeaderValue::from_str(&value)
            .map_err(|error| AppError::InvalidInput(format!("invalid header value: {error}")))?;
        headers.insert(name, value);
    }
    Ok(headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_urls_must_be_http() {
        assert!(validate_url("https://api.openai.com/v1/responses").is_ok());
        assert!(validate_url("http://127.0.0.1:1234/v1/chat/completions").is_ok());
        assert!(validate_url("file:///tmp/secret").is_err());
        assert!(validate_url("https://user:pass@example.com").is_err());
    }

    #[test]
    fn transport_managed_headers_are_rejected() {
        let headers = HashMap::from([("Host".to_string(), "example.com".to_string())]);
        assert!(validate_headers(headers).is_err());
    }
}
