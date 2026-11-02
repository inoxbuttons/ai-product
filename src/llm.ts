import { ChatOpenAI } from "@langchain/openai";
import type { LlmConfig } from "./config.ts";

/**
 * Клиент для любого OpenAI-совместимого API (cloud.ru, OpenAI, Ollama, vLLM, OpenRouter...).
 * Провайдер и модель задаются только переменными окружения.
 */
export function createChatModel(cfg: LlmConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeout: cfg.timeoutMs,
    maxRetries: 1,
    configuration: { baseURL: cfg.baseUrl },
    ...(cfg.jsonMode ? { modelKwargs: { response_format: { type: "json_object" } } } : {}),
  });
}
