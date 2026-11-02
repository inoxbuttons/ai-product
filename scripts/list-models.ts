/** Показывает модели, доступные по LLM_BASE_URL с текущим ключом: npm run models */
import { readLlmConfig } from "../src/config.ts";

const { config } = readLlmConfig();
if (!config.baseUrl || !config.apiKey) {
  console.error("Задайте LLM_BASE_URL и LLM_API_KEY в .env");
  process.exit(1);
}
try {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) {
    console.error(`Ошибка ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  const body = (await res.json()) as { data?: { id: string }[] };
  for (const m of body.data ?? []) console.log(m.id === config.model ? `* ${m.id}  ← LLM_MODEL` : `  ${m.id}`);
} catch (e) {
  console.error(`Не удалось подключиться к ${config.baseUrl}: ${(e as Error).message}`);
  process.exit(1);
}
