import type {
  HttpTransport,
  ProviderAdapter,
  ProviderKind,
} from "../types";
import { AnthropicAdapter } from "./anthropic";
import { OpenAiChatAdapter } from "./openaiChat";
import { OpenAiResponsesAdapter } from "./openaiResponses";

export function createProviderAdapter(
  kind: ProviderKind,
  transport: HttpTransport,
): ProviderAdapter {
  switch (kind) {
    case "openai-chat":
      return new OpenAiChatAdapter(transport);
    case "openai-responses":
      return new OpenAiResponsesAdapter(transport);
    case "anthropic":
      return new AnthropicAdapter(transport);
  }
}

export { AnthropicAdapter } from "./anthropic";
export { OpenAiChatAdapter } from "./openaiChat";
export { OpenAiResponsesAdapter } from "./openaiResponses";
