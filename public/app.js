"use strict";

const $ = (sel) => document.querySelector(sel);
const STD_KEYS = ["name", "manufacturer", "specs", "description"];

const state = {
  tab: "json",
  result: null,      // последний успешный ответ API
  extraFields: {},   // поля JSON, которых нет в форме — сохраняем при переключении
  formTouched: false,
};

/* ---------- Утилиты ---------- */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 1600);
}

async function copyText(text, btn, label = "Скопировано") {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // запасной вариант для http не на localhost
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(label);
    if (btn) {
      const original = btn.textContent;
      btn.classList.add("is-copied");
      btn.textContent = "✓ Скопировано";
      setTimeout(() => { btn.classList.remove("is-copied"); btn.textContent = original; }, 1400);
    }
  } catch {
    toast("Не удалось скопировать — выделите текст вручную");
  }
}

/** Разбор JSON с понятным сообщением об ошибке (строка и столбец). */
function parseJsonFriendly(text) {
  if (!text.trim()) return { error: "Введите данные товара" };
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const pos = Number(m[1]);
      const before = text.slice(0, pos);
      const line = before.split("\n").length;
      const col = pos - before.lastIndexOf("\n");
      return { error: `Ошибка JSON в строке ${line}, столбце ${col}: проверьте кавычки, запятые и скобки` };
    }
    return { error: "Некорректный JSON: проверьте кавычки, запятые и скобки" };
  }
}

/* ---------- Статус подключения к LLM ---------- */

async function loadStatus() {
  const el = $("#status");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.ok) {
      el.className = "status status--ok";
      el.textContent = `● ${data.model}`;
      el.title = "Модель задаётся переменной LLM_MODEL в .env";
    } else {
      el.className = "status status--err";
      el.textContent = "● LLM не настроена";
      el.title = data.problems.join("\n");
    }
  } catch {
    el.className = "status status--err";
    el.textContent = "● Сервер недоступен";
  }
}

/* ---------- Ввод: JSON ---------- */

const jsonEl = $("#json");

function validateJsonInput() {
  const stateEl = $("#json-state");
  if (!jsonEl.value.trim()) {
    stateEl.textContent = "";
    jsonEl.classList.remove("is-invalid");
    return;
  }
  const r = parseJsonFriendly(jsonEl.value);
  if (r.error) {
    stateEl.className = "json-state err";
    stateEl.textContent = "✕ " + r.error;
    jsonEl.classList.add("is-invalid");
  } else {
    stateEl.className = "json-state ok";
    stateEl.textContent = "✓ JSON корректен";
    jsonEl.classList.remove("is-invalid");
  }
}

let validateTimer;
jsonEl.addEventListener("input", () => {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(validateJsonInput, 250);
});

$("#btn-format").addEventListener("click", () => {
  const r = parseJsonFriendly(jsonEl.value);
  if (r.error) return toast(r.error);
  jsonEl.value = JSON.stringify(r.value, null, 2);
  validateJsonInput();
});

$("#btn-clear").addEventListener("click", () => {
  jsonEl.value = "";
  fillForm({});
  validateJsonInput();
  jsonEl.focus();
});

document.querySelectorAll("[data-example]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    try {
      const res = await fetch(`/examples/${btn.dataset.example}.json`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      jsonEl.value = JSON.stringify(data, null, 2);
      validateJsonInput();
      if (state.tab === "form") syncJsonToForm();
    } catch {
      toast("Не удалось загрузить пример");
    }
  }),
);

/* ---------- Ввод: форма ---------- */

function addSpecRow(name = "", value = "") {
  const row = document.createElement("div");
  row.className = "spec-row";
  row.innerHTML = `
    <input type="text" placeholder="Параметр" value="${esc(name)}">
    <input type="text" placeholder="Значение" value="${esc(value)}">
    <button type="button" class="icon-btn" title="Удалить">×</button>`;
  row.querySelector("button").addEventListener("click", () => { row.remove(); state.formTouched = true; });
  $("#f-specs").appendChild(row);
  return row;
}

$("#btn-add-spec").addEventListener("click", () => {
  addSpecRow().querySelector("input").focus();
  state.formTouched = true;
});
$("#tab-form").addEventListener("input", () => { state.formTouched = true; });

function fillForm(obj) {
  $("#f-name").value = typeof obj.name === "string" ? obj.name : "";
  $("#f-manufacturer").value = typeof obj.manufacturer === "string" ? obj.manufacturer : "";
  $("#f-description").value = typeof obj.description === "string" ? obj.description : "";
  $("#f-specs").innerHTML = "";
  const specs = obj.specs && typeof obj.specs === "object" && !Array.isArray(obj.specs) ? obj.specs : {};
  for (const [k, v] of Object.entries(specs)) addSpecRow(k, typeof v === "string" ? v : JSON.stringify(v));
  if (!Object.keys(specs).length) addSpecRow();
  state.extraFields = {};
  for (const [k, v] of Object.entries(obj)) if (!STD_KEYS.includes(k)) state.extraFields[k] = v;
}

function formToObject() {
  const specs = {};
  document.querySelectorAll("#f-specs .spec-row").forEach((row) => {
    const [k, v] = row.querySelectorAll("input");
    if (k.value.trim()) specs[k.value.trim()] = v.value.trim();
  });
  return {
    name: $("#f-name").value.trim(),
    manufacturer: $("#f-manufacturer").value.trim(),
    specs,
    description: $("#f-description").value.trim(),
    ...state.extraFields,
  };
}

function syncJsonToForm() {
  const note = $("#form-note");
  note.hidden = true;
  const r = jsonEl.value.trim() ? parseJsonFriendly(jsonEl.value) : { value: {} };
  if (r.error || typeof r.value !== "object" || r.value === null || Array.isArray(r.value)) {
    note.hidden = false;
    note.textContent = "JSON во вкладке «JSON» некорректен — форма начата с чистого листа.";
    fillForm({});
  } else {
    const v = r.value;
    const nonStd = (v.specs !== undefined && (typeof v.specs !== "object" || Array.isArray(v.specs))) ||
      (!("name" in v) && Object.keys(v).length > 0);
    if (nonStd) {
      note.hidden = false;
      note.textContent = "У JSON нестандартная структура — в форме показаны только распознанные поля, остальные сохранятся и будут отправлены как есть.";
    }
    fillForm(v);
  }
  state.formTouched = false;
}

/* ---------- Вкладки ---------- */

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    const next = tab.dataset.tab;
    if (next === state.tab) return;
    if (next === "form") syncJsonToForm();
    if (next === "json" && state.formTouched) {
      jsonEl.value = JSON.stringify(formToObject(), null, 2);
      validateJsonInput();
    }
    state.tab = next;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    $("#tab-json").hidden = next !== "json";
    $("#tab-form").hidden = next !== "form";
  }),
);

/* ---------- Генерация ---------- */

function getInput() {
  if (state.tab === "form") {
    const obj = formToObject();
    if (!obj.name && !obj.description && !Object.keys(obj.specs).length) {
      return { error: "Заполните хотя бы название, характеристики или описание" };
    }
    return { value: obj };
  }
  return parseJsonFriendly(jsonEl.value);
}

async function generate() {
  const input = getInput();
  if (input.error) {
    renderError({ message: input.error });
    return;
  }

  const btn = $("#btn-generate");
  btn.disabled = true;
  btn.textContent = "Генерация…";
  $("#copy-all").hidden = true;
  $("#result").innerHTML = `
    <div class="loading"><div class="spinner"></div>
    <p>Модель готовит карточку…</p><p class="muted">Обычно это занимает 10–60 секунд</p></div>`;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.value),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw { message: `Сервер вернул неожиданный ответ (HTTP ${res.status}).`, hint: "Проверьте, что сервер запущен, и посмотрите его лог." };
    }
    if (!res.ok) throw data.error ?? { message: `Ошибка HTTP ${res.status}` };
    state.result = data;
    renderResult(data);
  } catch (err) {
    if (err instanceof TypeError) {
      renderError({ message: "Нет связи с сервером.", hint: "Убедитесь, что сервис запущен (npm start), и обновите страницу." });
    } else {
      renderError(err);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Сгенерировать карточку";
  }
}

$("#btn-generate").addEventListener("click", generate);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    generate();
  }
});

/* ---------- Отрисовка ---------- */

function renderError(err) {
  $("#copy-all").hidden = true;
  const details = err.details ? (typeof err.details === "string" ? err.details : JSON.stringify(err.details, null, 2)) : "";
  $("#result").innerHTML = `
    <div class="alert alert--err">
      <h3>Не удалось сформировать карточку</h3>
      <div>${esc(err.message || "Неизвестная ошибка")}</div>
      ${err.hint ? `<div class="muted" style="margin-top:6px">${esc(err.hint)}</div>` : ""}
      ${details ? `<details><summary>Подробности</summary><pre>${esc(details)}</pre></details>` : ""}
    </div>`;
}

const block = (id, title, meta, body, copyLabel = "Копировать") => `
  <div class="block">
    <div class="block__head">
      <span class="block__title">${title}</span>
      ${meta}
      <span class="spacer"></span>
      <button class="btn btn--sm" data-copy="${id}">${copyLabel}</button>
    </div>
    <div class="block__body">${body}</div>
  </div>`;

function renderResult(data) {
  const { card, missing_data: missing, warnings, meta } = data;
  const tLen = card.seo_title.length;
  const dLen = card.seo_description.length;
  const tOk = tLen <= 70;
  const dOk = dLen >= 800 && dLen <= 1200;

  let html = "";

  if (missing.length) {
    html += `<div class="alert alert--warn"><h3>Требует уточнения (${missing.length})</h3><ul>
      ${missing.map((m) => `<li><b>${esc(m.field)}</b>${m.comment ? ` — ${esc(m.comment)}` : ""}
        <span class="tag">${m.source === "input" ? "проверка входа" : "оценка модели"}</span></li>`).join("")}
    </ul></div>`;
  }
  if (warnings.length) {
    html += `<div class="alert alert--warn"><h3>⚠ Автопроверка: обратите внимание</h3><ul>
      ${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`;
  }

  html += block("title", "SEO-заголовок",
    `<span class="block__meta ${tOk ? "ok" : "bad"}">${tLen} / 70</span>`,
    `<div class="seo-title">${esc(card.seo_title)}</div>`);

  html += block("description", "SEO-описание",
    `<span class="block__meta ${dOk ? "ok" : "bad"}">${dLen} симв. (норма 800–1200)</span>`,
    `<div class="seo-desc">${card.seo_description.split(/\n\s*\n|\n/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}</div>`);

  const noData = card.characteristics.filter((c) => c.status === "no_data").length;
  html += `
    <div class="block">
      <div class="block__head">
        <span class="block__title">Характеристики</span>
        <span class="block__meta">${card.characteristics.length} шт.${noData ? `, без данных: ${noData}` : ""}</span>
        <span class="spacer"></span>
        <button class="btn btn--sm" data-copy="specs-tsv" title="Табличный формат — вставляется в Excel/Google Таблицы по столбцам">Для таблицы</button>
        <button class="btn btn--sm" data-copy="specs">Копировать</button>
      </div>
      <div class="block__body">
        <table class="specs-table"><tbody>
          ${card.characteristics.map((c, i) => `
            <tr class="${c.status === "no_data" ? "no-data" : c.status === "unverified" ? "unverified" : ""}">
              <td>${esc(c.name)}</td>
              <td>${esc(c.value)}${c.status === "unverified" ? ' <span class="tag" title="Значение не найдено во входных данных">проверить</span>' : ""}</td>
              <td class="copy-cell"><button class="row-copy" data-copy-row="${i}" title="Копировать строку">⧉</button></td>
            </tr>`).join("")}
        </tbody></table>
      </div>
    </div>`;

  html += block("queries", "Поисковые запросы",
    `<span class="block__meta">нажмите на запрос, чтобы скопировать его</span>`,
    `<div class="queries">${card.search_queries.map((q, i) => `<button class="query" data-copy-query="${i}">${esc(q)}</button>`).join("")}</div>`,
    "Копировать все");

  html += block("commercial", "Для менеджера", "",
    `<div class="commercial">
      <h4>Кому подходит</h4><ul>${card.commercial.audience.map((a) => `<li>${esc(a)}</li>`).join("") || "<li class='muted'>—</li>"}</ul>
      <h4>Какие задачи решает</h4><ul>${card.commercial.tasks.map((t) => `<li>${esc(t)}</li>`).join("") || "<li class='muted'>—</li>"}</ul>
    </div>`);

  html += `<div class="meta-line">Модель: ${esc(meta.model)} · ${(meta.duration_ms / 1000).toFixed(1)} с · попыток: ${meta.attempts}</div>`;

  $("#result").innerHTML = html;
  $("#copy-all").hidden = false;
}

/** Тексты для копирования отдельных блоков. */
function sectionText(id) {
  const { card } = state.result;
  switch (id) {
    case "title": return card.seo_title;
    case "description": return card.seo_description;
    case "specs": return card.characteristics.map((c) => `${c.name}: ${c.value}`).join("\n");
    case "specs-tsv": return card.characteristics.map((c) => `${c.name}\t${c.value}`).join("\n");
    case "queries": return card.search_queries.join("\n");
    case "commercial":
      return `Кому подходит:\n${card.commercial.audience.map((a) => `- ${a}`).join("\n")}\n\nКакие задачи решает:\n${card.commercial.tasks.map((t) => `- ${t}`).join("\n")}`;
    default: return "";
  }
}

// Делегирование кликов по кнопкам копирования в результате
$("#result").addEventListener("click", (e) => {
  if (!state.result) return;
  const t = e.target.closest("button");
  if (!t) return;
  const { card } = state.result;
  if (t.dataset.copy) copyText(sectionText(t.dataset.copy), t);
  else if (t.dataset.copyRow) {
    const c = card.characteristics[Number(t.dataset.copyRow)];
    copyText(`${c.name}: ${c.value}`, null, "Строка скопирована");
  } else if (t.dataset.copyQuery) {
    copyText(card.search_queries[Number(t.dataset.copyQuery)], null, "Запрос скопирован");
  }
});

document.querySelectorAll("[data-copy-all]").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (!state.result) return;
    const kind = btn.dataset.copyAll;
    const r = state.result;
    const text = kind === "markdown" ? r.markdown
      : kind === "text" ? r.text
      : JSON.stringify({ ...r.card, missing_data: r.missing_data.map(({ field, comment }) => ({ field, comment })) }, null, 2);
    copyText(text, btn);
  }),
);

$("#btn-download").addEventListener("click", () => {
  if (!state.result) return;
  const blob = new Blob([state.result.markdown], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (state.result.card.seo_title || "card").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

loadStatus();
