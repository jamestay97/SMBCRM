-- Default new tenants to OpenAI GPT-4o instead of local Ollama.
ALTER TABLE public.organizations
  ALTER COLUMN llm_provider SET DEFAULT 'openai';

UPDATE public.organizations
SET
  llm_provider = 'openai',
  llm_model = COALESCE(llm_model, 'gpt-4o')
WHERE llm_provider = 'ollama'
   OR llm_model IS NULL;
