import "dotenv/config";

/** Настройки LLM читаются только из окружения — код не зависит от конкретной модели/провайдера. */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Переменная ${name} должна быть числом, получено: "${raw}"`);
  }
  return value;
}

/** Возвращает конфиг или список проблем — сервер стартует в любом случае и показывает их в UI. */
export function readLlmConfig(): { config: LlmConfig; problems: string[] } {
  const problems: string[] = [];
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim();
  const apiKey = (process.env.LLM_API_KEY ?? "").trim();
  const model = (process.env.LLM_MODEL ?? "").trim();

  if (!baseUrl) problems.push("Не задана переменная LLM_BASE_URL (адрес OpenAI-совместимого API).");
  if (!apiKey) problems.push("Не задана переменная LLM_API_KEY (ключ доступа к API модели).");
  if (!model) problems.push("Не задана переменная LLM_MODEL (идентификатор модели).");

  let temperature = 0.3;
  let maxTokens = 3000;
  let timeoutMs = 90_000;
  try {
    temperature = num("LLM_TEMPERATURE", temperature);
    maxTokens = num("LLM_MAX_TOKENS", maxTokens);
    timeoutMs = num("LLM_TIMEOUT_MS", timeoutMs);
  } catch (e) {
    problems.push((e as Error).message);
  }

  return {
    config: {
      baseUrl,
      apiKey,
      model,
      temperature,
      maxTokens,
      timeoutMs,
      jsonMode: process.env.LLM_JSON_MODE === "true",
    },
    problems,
  };
}

export const PORT = num("PORT", 3000);
