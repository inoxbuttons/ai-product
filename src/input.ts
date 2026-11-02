import { AppError } from "./errors.ts";

/**
 * Нормализация входного JSON. Формат товара может отличаться от примера:
 * поля называются по-разному (name/title/название...), характеристики бывают
 * объектом, массивом пар или строкой, встречаются любые дополнительные поля.
 * Всё, что не распознано как основное поле, не теряется, а передаётся модели как «дополнительные данные».
 */

export interface Spec {
  name: string;
  value: string; // пустая строка = значение не указано
}

export interface NormalizedProduct {
  name: string;
  manufacturer: string;
  description: string;
  specs: Spec[];
  extra: Record<string, unknown>;
}

export interface InputIssue {
  field: string;
  comment: string;
}

const ALIASES = {
  name: ["name", "title", "product_name", "productname", "model", "название", "наименование", "модель"],
  manufacturer: ["manufacturer", "brand", "vendor", "producer", "maker", "производитель", "бренд", "изготовитель"],
  specs: ["specs", "specifications", "characteristics", "attributes", "params", "parameters", "properties",
    "features", "характеристики", "технические характеристики", "параметры", "свойства"],
  description: ["description", "desc", "text", "about", "passport", "описание", "паспорт", "текст"],
} as const;

type MainField = keyof typeof ALIASES;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "_");

function findField(obj: Record<string, unknown>, field: MainField): string | undefined {
  const wanted = ALIASES[field].map(norm);
  return Object.keys(obj).find((k) => wanted.includes(norm(k)));
}

/** Приводит любое примитивное/вложенное значение к читаемой строке. */
export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("; ");
  if (typeof value === "object") {
    // { value: 10, unit: "мм" } — частый формат
    const o = value as Record<string, unknown>;
    if ("value" in o && Object.keys(o).length <= 3) {
      return [stringify(o.value), stringify(o.unit ?? o.units ?? "")].filter(Boolean).join(" ");
    }
    return Object.entries(o)
      .map(([k, v]) => `${k}: ${stringify(v)}`)
      .filter((s) => !s.endsWith(": "))
      .join("; ");
  }
  return String(value);
}

function parseSpecs(raw: unknown): Spec[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item): Spec[] => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const name = stringify(o.name ?? o.key ?? o.title ?? o.param ?? o["название"] ?? o["параметр"]);
        const value = stringify(o.value ?? o.val ?? o["значение"]);
        if (name) return [{ name, value }];
        // объект без явного name — считаем, что это набор пар ключ-значение
        return Object.entries(o).map(([k, v]) => ({ name: k, value: stringify(v) }));
      }
      if (Array.isArray(item) && item.length >= 1) {
        return [{ name: stringify(item[0]), value: stringify(item.slice(1)) }];
      }
      const s = stringify(item);
      if (!s) return [];
      const m = s.match(/^([^:=]+)[:=](.*)$/);
      return [m ? { name: m[1].trim(), value: m[2].trim() } : { name: s, value: "" }];
    });
  }
  if (typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).map(([k, v]) => ({ name: k.trim(), value: stringify(v) }));
  }
  // строка вида "диапазон: 0-1,6 МПа; класс: 1,5"
  return String(raw)
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^([^:=]+)[:=](.*)$/);
      return m ? { name: m[1].trim(), value: m[2].trim() } : { name: s, value: "" };
    });
}

/** Значения-«заглушки», которые фактически означают отсутствие данных. */
const EMPTY_MARKERS = new Set(["", "-", "—", "–", "n/a", "na", "null", "none", "нет данных", "данных нет", "?", "уточнить", "tbd"]);
const isEmptyValue = (v: string) => EMPTY_MARKERS.has(v.trim().toLowerCase());

export function normalizeProduct(input: unknown): { product: NormalizedProduct; issues: InputIssue[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError(400, "INVALID_INPUT",
      Array.isArray(input)
        ? "Ожидается один товар (JSON-объект), а получен массив."
        : "Ожидается JSON-объект с данными товара.",
      'Пример: { "name": "...", "manufacturer": "...", "specs": { ... }, "description": "..." }');
  }

  let obj = input as Record<string, unknown>;
  // Обёртка вида { "product": { ... } } или { "item": { ... } }
  const keys = Object.keys(obj);
  if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === "object" && !Array.isArray(obj[keys[0]])) {
    const inner = obj[keys[0]] as Record<string, unknown>;
    if (findField(inner, "name") || findField(inner, "specs")) obj = inner;
  }

  const used = new Set<string>();
  const take = (field: MainField) => {
    const key = findField(obj, field);
    if (key) used.add(key);
    return key ? obj[key] : undefined;
  };

  const name = stringify(take("name"));
  const manufacturer = stringify(take("manufacturer"));
  const description = stringify(take("description"));
  const specs = parseSpecs(take("specs")).filter((s) => s.name);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!used.has(k) && stringify(v)) extra[k] = v;
  }

  const product: NormalizedProduct = {
    name,
    manufacturer,
    description,
    specs: specs.map((s) => ({ name: s.name, value: isEmptyValue(s.value) ? "" : s.value })),
    extra,
  };

  if (!name && product.specs.length === 0 && !description && Object.keys(extra).length === 0) {
    throw new AppError(422, "EMPTY_PRODUCT", "Во входных данных нет информации о товаре.",
      "Заполните хотя бы название, характеристики или описание.");
  }

  const issues: InputIssue[] = [];
  if (!name) issues.push({ field: "Название", comment: "Не указано название товара — SEO-заголовок будет неточным." });
  if (!manufacturer) issues.push({ field: "Производитель", comment: "Не указан производитель." });
  if (product.specs.length === 0) issues.push({ field: "Характеристики", comment: "Нет технических характеристик — список характеристик будет состоять из пометок «данных нет»." });
  if (!description) issues.push({ field: "Описание", comment: "Нет описания — назначение прибора определяется только по названию и характеристикам." });
  else if (description.length < 80) issues.push({ field: "Описание", comment: "Описание очень короткое — текст может получиться общим." });
  for (const s of product.specs) {
    if (!s.value) issues.push({ field: s.name.charAt(0).toUpperCase() + s.name.slice(1), comment: "Характеристика указана без значения." });
  }

  return { product, issues };
}

/** Текстовое представление товара для промпта — единственный источник фактов для модели. */
export function productToPromptText(p: NormalizedProduct): string {
  const lines: string[] = [];
  lines.push(`Название: ${p.name || "данных нет"}`);
  lines.push(`Производитель: ${p.manufacturer || "данных нет"}`);
  lines.push("Характеристики:");
  if (p.specs.length === 0) lines.push("  (не указаны)");
  for (const s of p.specs) lines.push(`  - ${s.name}: ${s.value || "данных нет"}`);
  lines.push(`Описание: ${p.description || "данных нет"}`);
  const extraKeys = Object.keys(p.extra);
  if (extraKeys.length) {
    lines.push("Дополнительные данные:");
    for (const k of extraKeys) lines.push(`  - ${k}: ${stringify(p.extra[k])}`);
  }
  return lines.join("\n");
}

/** Эвристика: фразы, характерные для попытки управлять моделью через данные товара. */
const INJECTION_RE = /(игнорируй|забудь|не обращай внимания на|ignore (all|previous|the)|disregard|system prompt|ты\s*[-—]\s*(модель|ассистент)|напиши,? что|укажи,? что|добавь,? что)/i;

export function looksLikeInjection(text: string): boolean {
  return INJECTION_RE.test(text);
}
