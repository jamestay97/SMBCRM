import type {
  OllamaChatMessage,
  OllamaChatResponse,
  OllamaToolCall,
  OllamaToolDefinition,
} from "@/lib/ollama/client";

function stringifyArguments(args: Record<string, unknown> | string): string {
  if (typeof args === "string") return args;
  return JSON.stringify(args ?? {});
}

function toOpenAiMessages(messages: OllamaChatMessage[]): unknown[] {
  const result: unknown[] = [];
  let pendingToolCallIds: string[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const entry: Record<string, unknown> = {
        role: "assistant",
        content: msg.content || null,
      };

      if (msg.tool_calls?.length) {
        pendingToolCallIds = msg.tool_calls.map(
          (toolCall, index) => toolCall.id ?? `call_${index}`
        );
        entry.tool_calls = msg.tool_calls.map((toolCall, index) => ({
          id: toolCall.id ?? `call_${index}`,
          type: "function",
          function: {
            name: toolCall.function.name,
            arguments: stringifyArguments(toolCall.function.arguments),
          },
        }));
      }

      result.push(entry);
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId =
        msg.tool_call_id ??
        pendingToolCallIds.shift() ??
        `call_unknown_${result.length}`;
      result.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: msg.content,
      });
      continue;
    }

    result.push({ role: msg.role, content: msg.content });
  }

  return result;
}

function fromOpenAiResponse(data: unknown): OllamaChatResponse {
  const choices = (
    data as { choices?: { message?: Record<string, unknown> }[] }
  ).choices;
  const message = choices?.[0]?.message;

  if (!message) {
    throw new Error("OpenAI response missing message");
  }

  const toolCalls: OllamaToolCall[] | undefined = Array.isArray(
    message.tool_calls
  )
    ? message.tool_calls.map((toolCall) => {
        const fn = toolCall.function as Record<string, unknown>;
        let args: Record<string, unknown> | string =
          (fn.arguments as string) ?? "{}";
        if (typeof args === "string" && args.trim().startsWith("{")) {
          try {
            args = JSON.parse(args) as Record<string, unknown>;
          } catch {
            // keep raw string
          }
        }

        return {
          id: String(toolCall.id),
          function: {
            name: String(fn.name),
            arguments: args,
          },
        };
      })
    : undefined;

  return {
    message: {
      role: "assistant",
      content: String(message.content ?? ""),
      tool_calls: toolCalls,
    },
    done: true,
  };
}

export function getOpenAiBaseUrl(): string {
  return process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
}

export async function openaiChat(params: {
  messages: OllamaChatMessage[];
  tools?: OllamaToolDefinition[];
  model?: string;
  apiKey?: string | null;
  responseFormat?: "json_object" | "text";
}): Promise<OllamaChatResponse> {
  const apiKey = params.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for OpenAI provider");
  }

  const body: Record<string, unknown> = {
    model: params.model ?? process.env.OPENAI_MODEL ?? "gpt-4o",
    messages: toOpenAiMessages(params.messages),
  };

  if (params.tools?.length) {
    body.tools = params.tools;
    body.tool_choice = "auto";
  }

  if (params.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI chat failed (${response.status}): ${text}`);
  }

  return fromOpenAiResponse(await response.json());
}

export async function openaiJsonCompletion(params: {
  systemPrompt: string;
  userContent: string;
  model?: string;
  apiKey?: string | null;
}): Promise<string | null> {
  const response = await openaiChat({
    messages: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userContent },
    ],
    model: params.model,
    apiKey: params.apiKey,
    responseFormat: "json_object",
  });

  return response.message.content?.trim() || null;
}
