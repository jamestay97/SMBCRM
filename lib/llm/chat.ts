import type { LlmProvider } from "@/types/database";
import {
  ollamaChat,
  type OllamaChatMessage,
  type OllamaChatResponse,
  type OllamaToolDefinition,
} from "@/lib/ollama/client";
import { openaiChat, openaiJsonCompletion } from "@/lib/llm/openai-client";

export type LlmChatParams = {
  messages: OllamaChatMessage[];
  tools?: OllamaToolDefinition[];
  model?: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
};

export async function llmChat(params: LlmChatParams): Promise<OllamaChatResponse> {
  const provider = params.provider ?? "openai";

  if (provider === "openai") {
    return openaiChat({
      messages: params.messages,
      tools: params.tools,
      model: params.model,
      apiKey: params.apiKey,
    });
  }

  return ollamaChat({
    messages: params.messages,
    tools: params.tools,
    model: params.model,
    baseUrl: params.baseUrl,
  });
}

export async function llmJsonCompletion(params: {
  systemPrompt: string;
  userContent: string;
  model?: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
}): Promise<string | null> {
  const provider = params.provider ?? "openai";

  if (provider === "openai") {
    return openaiJsonCompletion({
      systemPrompt: params.systemPrompt,
      userContent: params.userContent,
      model: params.model,
      apiKey: params.apiKey,
    });
  }

  const response = await fetch(
    `${params.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userContent },
        ],
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { message?: { content?: string } };
  return data.message?.content?.trim() || null;
}
