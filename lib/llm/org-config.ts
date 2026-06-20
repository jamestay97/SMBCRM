import type { LlmProvider, Organization } from "@/types/database";
import { getOllamaBaseUrl } from "@/lib/ollama/client";
import { getOpenAiBaseUrl } from "@/lib/llm/openai-client";

export type OrgLlmConfig = {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  systemPrompt: string;
  slaTargetSeconds: number;
};

function resolveProvider(
  org: Pick<Organization, "llm_provider">
): LlmProvider {
  const envProvider = process.env.LLM_PROVIDER as LlmProvider | undefined;
  if (envProvider) return envProvider;
  return org.llm_provider ?? "openai";
}

function resolveModel(
  provider: LlmProvider,
  org: Pick<Organization, "llm_model">
): string {
  if (org.llm_model) return org.llm_model;

  if (provider === "openai") {
    return process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o";
  }

  return process.env.OLLAMA_MODEL ?? "llama3.2";
}

export function resolveOrgLlmConfig(org: Pick<
  Organization,
  | "llm_provider"
  | "llm_model"
  | "llm_api_key_encrypted"
  | "ai_system_prompt"
  | "sla_target_seconds"
>): OrgLlmConfig {
  const provider = resolveProvider(org);
  const model = resolveModel(provider, org);

  return {
    provider,
    model,
    baseUrl:
      provider === "openai" ? getOpenAiBaseUrl() : getOllamaBaseUrl(),
    apiKey:
      provider === "openai"
        ? org.llm_api_key_encrypted ?? process.env.OPENAI_API_KEY ?? null
        : org.llm_api_key_encrypted,
    systemPrompt: org.ai_system_prompt,
    slaTargetSeconds: org.sla_target_seconds ?? 300,
  };
}
