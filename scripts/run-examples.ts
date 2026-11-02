/**
 * Прогоняет все examples/*.json через LLM и сохраняет результаты в examples/results/.
 * Запуск: npm run examples
 */
import fs from "node:fs/promises";
import path from "node:path";
import { readLlmConfig } from "../src/config.ts";
import { toAppError } from "../src/errors.ts";
import { generateCard } from "../src/generate.ts";
import { createChatModel } from "../src/llm.ts";

const { config, problems } = readLlmConfig();
if (problems.length) {
  console.error("LLM не настроена:\n  - " + problems.join("\n  - "));
  process.exit(1);
}
const model = createChatModel(config);
const dir = path.resolve("examples");
const outDir = path.join(dir, "results");
await fs.mkdir(outDir, { recursive: true });

for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
  const base = file.replace(/\.json$/, "");
  process.stdout.write(`${file} ... `);
  try {
    const input = JSON.parse(await fs.readFile(path.join(dir, file), "utf8"));
    const result = await generateCard(input, model, config.model);
    await fs.writeFile(path.join(outDir, `${base}.json`), JSON.stringify(result, null, 2) + "\n");
    const md = result.markdown + (result.warnings.length ? `\n## Предупреждения автопроверки\n\n${result.warnings.map((w) => `- ${w}`).join("\n")}\n` : "");
    await fs.writeFile(path.join(outDir, `${base}.md`), md);
    console.log(`ok (${result.meta.duration_ms} мс, попыток: ${result.meta.attempts}, предупреждений: ${result.warnings.length})`);
  } catch (err) {
    const e = toAppError(err);
    console.log(`ошибка: ${e.message}${e.hint ? ` ${e.hint}` : ""}`);
  }
}
