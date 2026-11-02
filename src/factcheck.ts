/**
 * Простая автоматическая проверка «не выдумала ли модель числа»:
 * каждое число в сгенерированном тексте должно встречаться во входных данных.
 * Это не гарантия, но хорошо ловит самые опасные галлюцинации — выдуманные параметры.
 */

const NUM_RE = /\d+(?:[.,]\d+)?/g;

const normNum = (s: string) => {
  const n = s.replace(",", ".");
  // 1.50 -> 1.5, 007 -> 7
  return String(Number(n));
};

export function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUM_RE) ?? []).map(normNum));
}

/** Числа из `generated`, которых нет в `source`. */
export function unknownNumbers(generated: string, source: Set<string>): string[] {
  return [...numbersIn(generated)].filter((n) => !source.has(n));
}
