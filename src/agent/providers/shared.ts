import type {
  HttpJsonResponse,
  JsonObject,
  JsonValue,
  ProviderConfig,
} from "../types";

export function buildEndpoint(baseUrl: string, route: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("Provider base URL is required");
  }

  const url = new URL(trimmed);
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  const pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith(normalizedRoute)) {
    return url.toString();
  }

  const versionedRoute = `/v1${normalizedRoute}`;
  if (pathname.endsWith(versionedRoute)) {
    return url.toString();
  }

  url.pathname = pathname.endsWith("/v1")
    ? `${pathname}${normalizedRoute}`
    : `${pathname}${versionedRoute}`;
  return url.toString();
}

export function validateProviderConfig(config: ProviderConfig): void {
  if (!config.model.trim()) {
    throw new Error("Provider model is required");
  }
  buildEndpoint(config.baseUrl, "/health");
}

export function authHeaders(config: ProviderConfig): Record<string, string> {
  return config.apiKey.trim()
    ? { Authorization: `Bearer ${config.apiKey.trim()}` }
    : {};
}

export function asObject(value: JsonValue, label: string): JsonObject {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

export function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function assertSuccess(response: HttpJsonResponse): JsonObject {
  const body = asObject(response.body, "Provider response");
  if (response.status >= 200 && response.status < 300) {
    return body;
  }

  const error = body.error;
  if (error && !Array.isArray(error) && typeof error === "object") {
    const message = error.message;
    if (typeof message === "string" && message) {
      throw new Error(`Provider request failed (${response.status}): ${message}`);
    }
  }
  throw new Error(`Provider request failed with HTTP ${response.status}`);
}

export function extractTextContent(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((part) => {
      if (!part || Array.isArray(part) || typeof part !== "object") {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function jsonString(value: JsonValue): string {
  return JSON.stringify(value);
}
