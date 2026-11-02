import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AppError } from "./errors.ts";
import { looksLikeInjection, normalizeProduct, productToPromptText, type InputIssue } from "./input.ts";
import { buildFixMessage, cardPrompt, DESC_MAX, DESC_MIN, NO_DATA, TITLE_MAX } from "./prompt.ts";
import { extractJson, isNoData, LlmCardSchema, type LlmCard, type MissingItem, type ProductCard } from "./card.ts";
import { numbersIn, unknownNumbers } from "./factcheck.ts";
import { toMarkdown, toText } from "./format.ts";

const MAX_ATTEMPTS = 3; // первая попытка + до двух попыток исправления
/** Поля карточки, которые не являются характеристиками прибора (их не добавляем в таблицу). */
const NOT_SPECS = new Set(["название", "описание", "характеристики", "name", "description", "specs"]); // первая попытка + одна попытка исправления

export interface GenerateResult {
  card: ProductCard;
  missing_data: (MissingItem & { source: "input" | "llm" })[];
  warnings: string[];
  markdown: string;
  text: string;
  meta: { model: string; attempts: number; duration_ms: number };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("");
  return "";
}

interface LimitProblem {
  forModel: string; // что сказать модели при повторной попытке
  forUser: string;  // что показать пользователю, если исправить не удалось
}

/** Проверки, которые стоит отдать модели на исправление (формат, объёмы). */
function checkLimits(card: LlmCard): LimitProblem[] {
  const problems: LimitProblem[] = [];
  const t = card.seo_title.trim().length;
  const d = card.seo_description.trim().length;
  if (t > TITLE_MAX) problems.push({
    forModel: `seo_title длиной ${t} символов — сократи до ${TITLE_MAX} и меньше.`,
    forUser: `SEO-заголовок длиннее ${TITLE_MAX} символов (${t}) — сократите вручную.`,
  });
  if (d < DESC_MIN) problems.push({
    forModel: `seo_description длиной ${d} символов — расширь до ${DESC_MIN}–${DESC_MAX} символов (добавь примерно ${Math.ceil((1050 - d) / 6)} слов). Не добавляй новых фактов и оценок вроде «высокая точность», «надёжный», «гарантирует»: расширь за счёт областей применения из описания и абзаца о том, какие параметры уточнить при подборе.`,
    forUser: `SEO-описание короче нормы: ${d} символов вместо ${DESC_MIN}–${DESC_MAX}. Вероятно, во входных данных мало информации — добавьте описание или характеристики и повторите.`,
  });
  if (d > DESC_MAX) problems.push({
    forModel: `seo_description длиной ${d} символов — сократи до ${DESC_MIN}–${DESC_MAX} символов.`,
    forUser: `SEO-описание длиннее нормы: ${d} символов вместо ${DESC_MIN}–${DESC_MAX} — сократите вручную.`,
  });
  const q = card.search_queries.length;
  if (q < 3 || q > 5) problems.push({
    forModel: `search_queries содержит ${q} запросов — нужно от 3 до 5.`,
    forUser: `Поисковых запросов ${q} вместо 3–5.`,
  });
  return problems;
}

export async function generateCard(rawInput: unknown, model: BaseChatModel, modelName: string): Promise<GenerateResult> {
  const started = Date.now();
  const { product, issues } = normalizeProduct(rawInput);
  const productText = productToPromptText(product);

  const messages: BaseMessage[] = await cardPrompt.formatMessages({ product: productText });

  let card: LlmCard | undefined;
  let problems: LimitProblem[] = [];
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    const response = await model.invoke(messages);
    const raw = messageText(response.content);

    let parsed: LlmCard | undefined;
    try {
      const result = LlmCardSchema.safeParse(extractJson(raw));
      if (result.success) parsed = result.data;
      else problems = result.error.issues.map((i) => {
        const text = `поле ${i.path.join(".") || "(корень)"}: ${i.message}`;
        return { forModel: text, forUser: text };
      });
    } catch (e) {
      const text = `ответ не является корректным JSON (${(e as Error).message}).`;
      problems = [{ forModel: text, forUser: text }];
    }

    if (parsed) {
      card = parsed; // запоминаем последний валидный вариант, даже если лимиты не соблюдены
      problems = checkLimits(parsed);
    }
    if (problems.length === 0) break;

    console.warn(`[generate] попытка ${attempts}: ${problems.map((p) => p.forModel.split(" — ")[0]).join(" | ")}`);
    messages.push(new AIMessage(raw), new HumanMessage(buildFixMessage(problems.map((p) => p.forModel))));
  }

  if (!card) {
    throw new AppError(502, "LLM_BAD_OUTPUT", "Модель вернула ответ в неожиданном формате.",
      "Повторите запрос. Если ошибка повторяется — попробуйте другую модель (LLM_MODEL) или включите LLM_JSON_MODE=true.",
      problems.map((p) => p.forUser));
  }

  return finalize(card, product.specs, issues, rawInput, productText, problems.map((p) => p.forUser), {
    model: modelName,
    attempts,
    duration_ms: Date.now() - started,
  });
}

function finalize(
  llm: LlmCard,
  inputSpecs: { name: string; value: string }[],
  inputIssues: InputIssue[],
  rawInput: unknown,
  productText: string,
  remainingProblems: string[],
  meta: GenerateResult["meta"],
): GenerateResult {
  const warnings = [...remainingProblems];
  if (looksLikeInjection(productText)) {
    warnings.push("Во входных данных есть текст, похожий на инструкцию для модели («игнорируй…», «напиши, что…»). Проверьте исходное описание и результат: такие фразы могли исказить карточку.");
  }
  const sourceNumbers = numbersIn(productText + " " + JSON.stringify(rawInput));

  // 1. Характеристики: проверяем числа и гарантируем, что ни одна входная характеристика не потерялась.
  const characteristics: ProductCard["characteristics"] = llm.characteristics
    .filter((c) => c.name.trim())
    .map((c) => {
      const value = c.value.trim() || NO_DATA;
      if (isNoData(value)) return { name: c.name.trim(), value: NO_DATA, status: "no_data" as const };
      const unknown = unknownNumbers(value, sourceNumbers);
      return { name: c.name.trim(), value, status: unknown.length ? ("unverified" as const) : ("ok" as const) };
    });

  const key = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "");
  const outKeys = new Set(characteristics.map((c) => key(c.name)));
  const outValues = new Set(characteristics.filter((c) => c.status !== "no_data").map((c) => key(c.value)));
  for (const s of inputSpecs) {
    // Модель могла переименовать параметр («Ду» → «Условный проход (Ду)»): тогда совпадёт значение.
    if (!outKeys.has(key(s.name)) && !(s.value && outValues.has(key(s.value)))) {
      outKeys.add(key(s.name));
      const name = s.name.charAt(0).toUpperCase() + s.name.slice(1);
      characteristics.push({ name, value: s.value || NO_DATA, status: s.value ? "ok" : "no_data" });
    }
  }

  // Параметры, которые модель назвала недостающими, но забыла в таблице, — добавляем как «данных нет».
  for (const m of llm.missing_data) {
    const k = key(m.field);
    if (k && !outKeys.has(k) && !NOT_SPECS.has(k) && m.field.trim().length <= 60) {
      outKeys.add(k);
      characteristics.push({ name: m.field.trim(), value: NO_DATA, status: "no_data" });
    }
  }

  const unverified = characteristics.filter((c) => c.status === "unverified");
  if (unverified.length) {
    warnings.push(`Значения не найдены во входных данных, проверьте вручную: ${unverified.map((c) => `«${c.name}: ${c.value}»`).join(", ")}.`);
  }

  // 2. Числа в текстах, которых не было во входе.
  const texts: [string, string][] = [
    ["SEO-заголовке", llm.seo_title],
    ["SEO-описании", llm.seo_description],
    ["блоке для менеджера", [...llm.commercial.audience, ...llm.commercial.tasks].join(" ")],
  ];
  for (const [where, text] of texts) {
    const unknown = unknownNumbers(text, sourceNumbers);
    if (unknown.length) warnings.push(`В ${where} есть числа, которых нет во входных данных: ${unknown.join(", ")}. Проверьте, не выдуманы ли они.`);
  }

  // 3. Чего не хватает: детерминированные проверки входа + мнение модели (без дублей).
  const missing: GenerateResult["missing_data"] = inputIssues.map((i) => ({ ...i, source: "input" as const }));
  const seen = new Set(missing.map((m) => key(m.field)));
  for (const m of llm.missing_data) {
    const k = key(m.field);
    if (!m.field.trim() || seen.has(k)) continue;
    seen.add(k);
    missing.push({ field: m.field.trim(), comment: m.comment.trim(), source: "llm" });
  }

  const card: ProductCard = {
    seo_title: llm.seo_title.trim(),
    seo_description: llm.seo_description.trim(),
    characteristics,
    search_queries: llm.search_queries.map((q) => q.trim()).filter(Boolean),
    commercial: llm.commercial,
  };

  return { card, missing_data: missing, warnings, markdown: toMarkdown(card, missing), text: toText(card, missing), meta };
}
