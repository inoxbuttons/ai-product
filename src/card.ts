import { z } from "zod";
import { NO_DATA } from "./prompt.ts";

/* Схема ответа модели. Сделана «терпимой»: модели нередко возвращают строку вместо массива и т. п. */

const str = z.preprocess((v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v)), z.string());
const strList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/\n+/).map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean) : v ?? []),
  z.array(str),
);

export const LlmCardSchema = z.object({
  seo_title: str.pipe(z.string().min(1, "пустой seo_title")),
  seo_description: str.pipe(z.string().min(1, "пустой seo_description")),
  characteristics: z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v)
      ? Object.entries(v as Record<string, unknown>).map(([name, value]) => ({ name, value }))
      : v),
    z.array(z.object({ name: str, value: str })),
  ),
  search_queries: strList,
  commercial: z.preprocess(
    (v) => (typeof v === "string" ? { audience: [], tasks: [v] } : v ?? {}),
    z.object({ audience: strList.default([]), tasks: strList.default([]) }),
  ),
  missing_data: z.preprocess(
    (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? { field: x, comment: "" } : x)) : v ?? []),
    z.array(z.object({ field: str, comment: str.default("") })),
  ).default([]),
});

export type LlmCard = z.infer<typeof LlmCardSchema>;

export type CharacteristicStatus = "ok" | "no_data" | "unverified";

export interface ProductCard {
  seo_title: string;
  seo_description: string;
  characteristics: { name: string; value: string; status: CharacteristicStatus }[];
  search_queries: string[];
  commercial: { audience: string[]; tasks: string[] };
}

export interface MissingItem {
  field: string;
  comment: string;
}

export const isNoData = (v: string) => /^(данных нет|нет данных|не указан[оа]?|—|-|)$/i.test(v.trim());
export { NO_DATA };

/** Достаёт JSON из ответа модели: убирает ```json-обрамление и текст вокруг объекта. */
export function extractJson(text: string): unknown {
  let t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("в ответе нет JSON-объекта");
  t = t.slice(start, end + 1);
  return JSON.parse(t);
}
