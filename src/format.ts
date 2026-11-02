import type { MissingItem, ProductCard } from "./card.ts";

/** Markdown — для вставки в CMS/документы. */
export function toMarkdown(card: ProductCard, missing: MissingItem[]): string {
  const out: string[] = [];
  out.push(`# ${card.seo_title}`, "");
  out.push("## SEO-описание", "", card.seo_description, "");
  out.push("## Характеристики", "", "| Параметр | Значение |", "|---|---|");
  for (const c of card.characteristics) out.push(`| ${esc(c.name)} | ${esc(c.value)} |`);
  out.push("", "## Поисковые запросы", "");
  for (const q of card.search_queries) out.push(`- ${q}`);
  out.push("", "## Для менеджера", "", "**Кому подходит:**", "");
  for (const a of card.commercial.audience) out.push(`- ${a}`);
  out.push("", "**Какие задачи решает:**", "");
  for (const t of card.commercial.tasks) out.push(`- ${t}`);
  if (missing.length) {
    out.push("", "## Требует уточнения", "");
    for (const m of missing) out.push(`- **${m.field}**${m.comment ? ` — ${m.comment}` : ""}`);
  }
  return out.join("\n") + "\n";
}

/** Плоский текст — для мессенджеров и полей без разметки. */
export function toText(card: ProductCard, missing: MissingItem[]): string {
  const out: string[] = [];
  out.push(`SEO-заголовок: ${card.seo_title}`, "");
  out.push("SEO-описание:", card.seo_description, "");
  out.push("Характеристики:");
  for (const c of card.characteristics) out.push(`${c.name}: ${c.value}`);
  out.push("", "Поисковые запросы:");
  for (const q of card.search_queries) out.push(`- ${q}`);
  out.push("", "Кому подходит:");
  for (const a of card.commercial.audience) out.push(`- ${a}`);
  out.push("", "Какие задачи решает:");
  for (const t of card.commercial.tasks) out.push(`- ${t}`);
  if (missing.length) {
    out.push("", "Требует уточнения:");
    for (const m of missing) out.push(`- ${m.field}${m.comment ? `: ${m.comment}` : ""}`);
  }
  return out.join("\n") + "\n";
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
