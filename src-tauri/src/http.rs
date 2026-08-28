use std::{collections::HashMap, time::Duration};

use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
    Client, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::error::{AppError, AppResult};

const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_HEADERS: usize = 32;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const ERROR_PREVIEW_CHARS: usize = 2_000;

pub struct HttpState {
    client: Client,
}

impl HttpState {
    pub fn new() -> AppResult<Self> {
        let client = Client::builder()
            .redirect(Policy::none())
            .build()
            .map_err(|error| AppError::Provider(error.to_string()))?;
        Ok(Self { client })
    }
}

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
pub async fn send_http_json(
    state: State<'_, HttpState>,
    request: HttpJsonRequest,
) -> Result<HttpJsonResponse, String> {
    send_http_json_inner(&state.client, request)
        .await
        .map_err(|error| error.to_string())
}

async fn send_http_json_inner(
    client: &Client,
    request: HttpJsonRequest,
) -> AppResult<HttpJsonResponse> {
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
    let mut response = client
        .post(url)
        .headers(headers)
        .body(request_bytes)
        .timeout(Duration::from_millis(timeout_ms))
        .send()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?;
    let status = response.status();
    validate_content_length(response.content_length())?;
    let capacity = response
        .content_length()
        .unwrap_or_default()
        .min(MAX_RESPONSE_BYTES as u64) as usize;
    let mut bytes = Vec::with_capacity(capacity);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| AppError::Provider(error.to_string()))?
    {
        append_response_chunk(&mut bytes, &chunk)?;
    }
    let body = parse_response_body(status, &bytes)?;

    Ok(HttpJsonResponse {
        status: status.as_u16(),
        body,
    })
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
    let mut total_bytes = 0usize;
    for (name, value) in values {
        total_bytes = total_bytes
            .checked_add(name.len())
            .and_then(|size| size.checked_add(value.len()))
            .ok_or_else(|| {
                AppError::InvalidInput("provider request headers are too large".to_string())
            })?;
        if total_bytes > MAX_HEADER_BYTES {
            return Err(AppError::InvalidInput(format!(
                "provider request headers exceed {MAX_HEADER_BYTES} bytes"
            )));
        }
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

fn validate_content_length(content_length: Option<u64>) -> AppResult<()> {
    if content_length.is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) {
        return Err(AppError::Provider(format!(
            "provider response exceeds {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    Ok(())
}

fn append_response_chunk(bytes: &mut Vec<u8>, chunk: &[u8]) -> AppResult<()> {
    if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
        return Err(AppError::Provider(format!(
            "provider response exceeds {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

fn parse_response_body(status: StatusCode, bytes: &[u8]) -> AppResult<Value> {
    match serde_json::from_slice::<Value>(bytes) {
        Ok(value) if status.is_success() || value.is_object() => Ok(value),
        Ok(value) => Ok(json!({
            "error": {
                "message": format!("provider returned an error body: {value}")
            }
        })),
        Err(_) => {
            let preview = response_preview(bytes);
            if status.is_success() {
                Err(AppError::Provider(format!(
                    "provider returned a non-JSON response (HTTP {}): {preview}",
                    status.as_u16()
                )))
            } else {
                Ok(json!({
                    "error": {
                        "message": format!(
                            "provider returned a non-JSON error (HTTP {}): {preview}",
                            status.as_u16()
                        )
                    }
                }))
            }
        }
    }
}

fn response_preview(bytes: &[u8]) -> String {
    let preview: String = String::from_utf8_lossy(bytes)
        .chars()
        .take(ERROR_PREVIEW_CHARS)
        .collect();
    if preview.trim().is_empty() {
        "<empty response body>".to_string()
    } else {
        preview
    }
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

    #[test]
    fn total_header_bytes_are_bounded() {
        let headers = HashMap::from([("Authorization".to_string(), "x".repeat(MAX_HEADER_BYTES))]);
        assert!(validate_headers(headers).is_err());
    }

    #[test]
    fn response_length_is_checked_before_and_during_streaming() {
        assert!(validate_content_length(Some((MAX_RESPONSE_BYTES + 1) as u64)).is_err());
        assert!(validate_content_length(Some(MAX_RESPONSE_BYTES as u64)).is_ok());

        let mut bytes = vec![0; MAX_RESPONSE_BYTES];
        assert!(append_response_chunk(&mut bytes, &[0]).is_err());
    }

    #[test]
    fn non_json_error_bodies_are_structured() {
        let body = parse_response_body(StatusCode::BAD_GATEWAY, b"upstream unavailable")
            .expect("error body should be normalized");
        assert_eq!(
            body.pointer("/error/message").and_then(Value::as_str),
            Some("provider returned a non-JSON error (HTTP 502): upstream unavailable")
        );
        assert!(parse_response_body(StatusCode::OK, b"not json").is_err());
    }
}
