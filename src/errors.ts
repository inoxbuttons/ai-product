/** Ошибка с понятным пользователю сообщением и HTTP-статусом. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly hint?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, hint: this.hint, details: this.details } };
  }
}

/**
 * Переводит ошибки LLM-клиента (LangChain/OpenAI SDK, сеть, таймауты) в понятные сообщения.
 * Технические подробности уходят в лог сервера, пользователю — суть и что делать.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const e = err as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
    lc_error_code?: string;
    cause?: { code?: string };
    error?: { message?: string };
  };
  const status = e?.status;
  const msg = String(e?.error?.message ?? e?.message ?? err ?? "");
  const netCode = e?.code ?? e?.cause?.code ?? "";

  if (status === 401 || status === 403 || e?.lc_error_code === "MODEL_AUTHENTICATION") {
    return new AppError(502, "LLM_AUTH", "LLM API отклонил ключ доступа.",
      "Проверьте LLM_API_KEY в файле .env и права ключа на выбранную модель.");
  }
  if (status === 404 || e?.lc_error_code === "MODEL_NOT_FOUND") {
    return new AppError(502, "LLM_MODEL_NOT_FOUND", "Модель или адрес API не найдены.",
      "Проверьте LLM_MODEL и LLM_BASE_URL. Список доступных моделей: npm run models.");
  }
  if (status === 429 || e?.lc_error_code === "MODEL_RATE_LIMIT") {
    return new AppError(429, "LLM_RATE_LIMIT", "Превышен лимит запросов или исчерпана квота LLM API.",
      "Подождите немного и повторите запрос, либо проверьте баланс/квоты в кабинете провайдера.");
  }
  if (status === 400 || status === 422) {
    return new AppError(502, "LLM_BAD_REQUEST", "LLM API отклонил запрос.",
      "Возможно, модель не поддерживает один из параметров (например, LLM_JSON_MODE) или вход слишком длинный.",
      msg.slice(0, 300));
  }
  if (typeof status === "number" && status >= 500) {
    return new AppError(502, "LLM_UNAVAILABLE", "Сервис LLM временно недоступен.",
      "Повторите запрос через минуту.");
  }
  if (/timeout|timed out|aborted/i.test(msg) || e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new AppError(504, "LLM_TIMEOUT", "LLM не ответила за отведённое время.",
      "Повторите запрос или увеличьте LLM_TIMEOUT_MS в .env.");
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT/.test(netCode + " " + msg) || /fetch failed|Connection error/i.test(msg)) {
    return new AppError(502, "LLM_NETWORK", "Не удалось подключиться к LLM API.",
      "Проверьте подключение к интернету и адрес LLM_BASE_URL.");
  }
  return new AppError(500, "INTERNAL", "Внутренняя ошибка сервиса.", "Подробности — в логе сервера.");
}
