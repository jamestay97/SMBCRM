export const DEPOSIT_TOOL_NAME = "create_deposit_payment";

export type OllamaToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const DEPOSIT_TOOL_DEFINITION: OllamaToolDefinition = {
  type: "function" as const,
  function: {
    name: DEPOSIT_TOOL_NAME,
    description:
      "Generate a Stripe deposit payment link AFTER the customer confirms their scheduled appointment. Requires schedule_appointment first. Share the payment_url with the customer.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export type OllamaToolCall = {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
};

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
};

export type OllamaChatResponse = {
  message: OllamaChatMessage;
  done: boolean;
  error?: string;
};

export function getOllamaBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
}

export function getOllamaModel(): string {
  const model = process.env.OLLAMA_MODEL;
  if (!model) {
    throw new Error("Missing OLLAMA_MODEL");
  }
  return model;
}

export async function ollamaChat(params: {
  messages: OllamaChatMessage[];
  tools?: OllamaToolDefinition[];
  model?: string;
  baseUrl?: string;
}): Promise<OllamaChatResponse> {
  const response = await fetch(
    `${params.baseUrl ?? getOllamaBaseUrl()}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: params.model ?? getOllamaModel(),
        messages: params.messages,
        tools: params.tools,
        stream: false,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 404 && body.includes("not found")) {
      throw new Error(
        `Ollama model "${getOllamaModel()}" is not installed. Run: ollama pull ${getOllamaModel()} — or set OLLAMA_MODEL to an installed model (check with: ollama list)`
      );
    }
    throw new Error(`Ollama chat failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OllamaChatResponse;

  if (data.error) {
    throw new Error(`Ollama error: ${data.error}`);
  }

  return data;
}

export function parseToolArguments(
  _args: Record<string, unknown> | string
): Record<string, string> {
  return {};
}
