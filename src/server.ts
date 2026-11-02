import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, readLlmConfig } from "./config.ts";
import { AppError, toAppError } from "./errors.ts";
import { generateCard } from "./generate.ts";
import { createChatModel } from "./llm.ts";

const { config, problems: configProblems } = readLlmConfig();
const model = configProblems.length ? null : createChatModel(config);

const app = express();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

app.use(express.json({ limit: "200kb" }));
app.use(express.static(publicDir));
app.use("/examples", express.static(path.join(publicDir, "..", "examples")));

/** Состояние сервиса: UI показывает, настроена ли модель. */
app.get("/api/health", (_req, res) => {
  res.json({ ok: configProblems.length === 0, model: config.model || null, problems: configProblems });
});

/**
 * POST /api/generate
 * Тело: JSON товара (любая структура, см. README).
 * ?format=markdown|text — вернуть только готовый текст вместо JSON.
 */
app.post("/api/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!model) {
      throw new AppError(503, "NOT_CONFIGURED", "Сервис не настроен: не заданы параметры подключения к LLM.",
        "Создайте файл .env по образцу .env.example и перезапустите сервер.", configProblems);
    }
    if (req.body === undefined || (typeof req.body === "object" && req.body !== null && Object.keys(req.body).length === 0 && !Array.isArray(req.body))) {
      throw new AppError(400, "EMPTY_BODY", "Пустой запрос: передайте JSON с данными товара.",
        "Заголовок запроса должен быть Content-Type: application/json.");
    }

    const result = await generateCard(req.body, model, config.model);
    console.log(`[generate] «${result.card.seo_title}» — ${result.meta.duration_ms} мс, попыток: ${result.meta.attempts}`);

    const format = String(req.query.format ?? "json");
    if (format === "markdown") return res.type("text/markdown; charset=utf-8").send(result.markdown);
    if (format === "text") return res.type("text/plain; charset=utf-8").send(result.text);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use("/api", (_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Такого метода API нет.", "Доступно: POST /api/generate, GET /api/health.")));

// Единый обработчик ошибок: всегда JSON с понятным сообщением, без стектрейсов наружу.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { type?: string; message?: string; status?: number };
  let appErr: AppError;
  if (e?.type === "entity.parse.failed") {
    appErr = new AppError(400, "INVALID_JSON", "Некорректный JSON во входных данных.",
      "Проверьте кавычки, запятые и скобки.", e.message);
  } else if (e?.type === "entity.too.large") {
    appErr = new AppError(413, "TOO_LARGE", "Слишком большой объём данных (максимум 200 КБ).",
      "Сократите описание — достаточно ключевого фрагмента паспорта.");
  } else {
    appErr = toAppError(err);
  }
  if (err instanceof AppError) console.warn(`[error] ${appErr.code}: ${appErr.message}`);
  else console.error(`[error] ${appErr.code}:`, err);
  res.status(appErr.status).json(appErr.toJSON());
});

app.listen(PORT, () => {
  console.log(`Сервис запущен: http://localhost:${PORT}`);
  if (configProblems.length) {
    console.warn("⚠ LLM не настроена:\n  - " + configProblems.join("\n  - "));
  } else {
    console.log(`Модель: ${config.model} (${config.baseUrl})`);
  }
});
