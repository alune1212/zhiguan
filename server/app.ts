import { Hono } from "hono";

import { PERSONA_INSTRUCTION, SYNTHESIS_INSTRUCTION, personaTurnPayload, synthesisPayload } from "../src/domain/discussion-payload";
import { factCardForModel, isFactCard } from "../src/domain/fact-card";
import { parsePersonaOutput, parseSynthesisOutput } from "../src/domain/model-output";
import { isPersona, type Persona } from "../src/domain/personas";
import type { CitedSpeech } from "../src/domain/discussion-payload";

const HOSTS = new Set(["127.0.0.1:4173", "localhost:4173", "127.0.0.1:4174", "localhost:4174"]);
const MAX_BODY = 48_000;
const MODEL = "deepseek-chat";

export interface ServerEnv {
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_API_BASE?: string;
}

export interface ServerOptions {
  readonly env: ServerEnv;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (category: string) => void;
}

export function createApp(options: ServerOptions): Hono {
  const log = options.log ?? (() => undefined);
  const fetchImpl = options.fetchImpl ?? fetch;
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const host = c.req.header("host") ?? "";
    const origin = c.req.header("origin");
    const originMatches = origin === `http://${host}`;
    // Same-origin GET often omits Origin. POST from a browser includes it.
    if (!HOSTS.has(host) || (c.req.method === "GET" ? origin !== undefined && !originMatches : !originMatches)) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

  app.get("/api/provider", (c) => {
    const resolved = resolveProvider(options.env);
    return c.json({ provider: "DeepSeek", host: resolved.host, available: resolved.available });
  });

  app.post("/api/parse", async (c) => {
    const resolved = resolveProvider(options.env);
    if (!resolved.available || !resolved.base || !resolved.key) return c.json({ error: "unavailable" }, 503);
    const body = await readJson(c);
    if (!body || !hasExactKeys(body, ["text"]) || typeof body.text !== "string") return c.json({ error: "invalid_input" }, 400);
    const text = body.text.trim();
    if (!text || [...text].length > 1000) return c.json({ error: "invalid_input" }, 400);
    const model = await complete(resolved, fetchImpl, log, "parse_service_failed", PARSE_SYSTEM, { text });
    const parsed = model ? sanitizeParse(model) : null;
    if (!parsed) return c.json({ error: "service_failed" }, 502);
    return c.json(parsed);
  });

  app.post("/api/discussion/persona", async (c) => {
    const resolved = resolveProvider(options.env);
    if (!resolved.available || !resolved.base || !resolved.key) return c.json({ error: "unavailable" }, 503);
    const body = await readJson(c);
    const turn = body ? personaRequest(body) : null;
    if (!turn) return c.json({ error: "invalid_input" }, 400);
    const model = await complete(resolved, fetchImpl, log, "discussion_service_failed", `${PERSONA_INSTRUCTION}\n${PERSONA_SCHEMA}`, turn.payload);
    const parsed = model ? parsePersonaOutput(model, turn.payload.persona.id) : null;
    if (!parsed) return c.json({ error: "service_failed" }, 502);
    return c.json(parsed);
  });

  app.post("/api/discussion/synthesis", async (c) => {
    const resolved = resolveProvider(options.env);
    if (!resolved.available || !resolved.base || !resolved.key) return c.json({ error: "unavailable" }, 503);
    const body = await readJson(c);
    const payload = body ? synthesisRequest(body) : null;
    if (!payload) return c.json({ error: "invalid_input" }, 400);
    const model = await complete(resolved, fetchImpl, log, "discussion_service_failed", `${SYNTHESIS_INSTRUCTION}\n${SYNTHESIS_SCHEMA}`, payload);
    const parsed = model ? parseSynthesisOutput(model) : null;
    if (!parsed) return c.json({ error: "service_failed" }, 502);
    return c.json(parsed);
  });

  return app;
}

const PARSE_SYSTEM = [
  "你只从用户的一句话里提取想买的物品、价格和类别。",
  "不要给出购买建议，不要追问收入、税口径或作息，不要计算。",
  "找不到的字段用 null，不要猜测。",
  "价格保留用户说出的数字原文，不要换算。用户表示大概时 priceApproximate 为 true。",
  '只输出 JSON：{"item":string|null,"price":string|null,"category":string|null,"priceApproximate":boolean}',
].join("");

const PERSONA_SCHEMA = '只输出 JSON：{"personaId":"与请求一致","points":["短句"],"pushback":"仅反对角色需要，否则省略"}';
const SYNTHESIS_SCHEMA = '只输出 JSON：{"leaning":"lean-buy|lean-wait|lean-skip|lean-adjust|unclear","reasons":["句子"],"risks":["句子"],"changeConditions":["如果……就买/就等/就先不买/就换条件"],"disagreements":["句子"]}';

interface ResolvedProvider {
  readonly host: string;
  readonly available: boolean;
  readonly base: URL | null;
  readonly key: string | null;
}

export function resolveProvider(env: ServerEnv): ResolvedProvider {
  const key = env.DEEPSEEK_API_KEY?.trim() || null;
  let base: URL | null = null;
  try {
    const url = new URL(env.DEEPSEEK_API_BASE?.trim() || "https://api.deepseek.com");
    if (url.protocol === "https:" && url.username === "" && url.password === "") base = url;
  } catch {
    base = null;
  }
  return {
    host: base?.host ?? "api.deepseek.com",
    available: Boolean(key && base),
    base,
    key,
  };
}

async function complete(
  provider: ResolvedProvider,
  fetchImpl: typeof fetch,
  log: (category: string) => void,
  failureCategory: string,
  system: string,
  user: unknown,
): Promise<unknown | null> {
  if (!provider.base || !provider.key) return null;
  const endpoint = chatUrl(provider.base);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      log(failureCategory);
      return null;
    }
    const payload: unknown = await response.json();
    const content = extractContent(payload);
    if (!content) {
      log(failureCategory);
      return null;
    }
    return JSON.parse(content) as unknown;
  } catch {
    log(failureCategory);
    return null;
  }
}

function chatUrl(base: URL): string {
  const path = base.pathname.replace(/\/$/u, "");
  return `${base.origin}${path}/chat/completions`;
}

function personaRequest(body: Record<string, unknown>): { payload: ReturnType<typeof personaTurnPayload> } | null {
  const round = body.round;
  const roundOne = round === 1 && hasExactKeys(body, ["factCard", "category", "reason", "persona", "round"]);
  const roundTwo = round === 2 && hasExactKeys(body, ["factCard", "category", "reason", "persona", "round", "ownSpeech", "otherSpeeches"]);
  if (!roundOne && !roundTwo) return null;
  if (!isFactCard(body.factCard) || !isPersona(body.persona) || !body.persona.enabled) return null;
  const category = cleanText(body.category, 40);
  const reason = cleanText(body.reason, 500);
  if (!category || !reason) return null;
  const card = factCardForModel(body.factCard);
  if (round === 1) {
    return { payload: personaTurnPayload(card, category, reason, body.persona, [body.persona], 1) };
  }
  if (typeof body.ownSpeech !== "string" || [...body.ownSpeech].length > 4000) return null;
  const speeches = speechList(body.otherSpeeches);
  if (!speeches) return null;
  return { payload: personaTurnPayload(card, category, reason, body.persona, [body.persona], 2, body.ownSpeech, speeches) };
}

function synthesisRequest(body: Record<string, unknown>): ReturnType<typeof synthesisPayload> | null {
  if (!hasExactKeys(body, ["factCard", "category", "reason", "personas", "speeches"])) return null;
  if (!isFactCard(body.factCard) || !Array.isArray(body.personas) || body.personas.length > 5) return null;
  const personas = body.personas.filter(isPersona);
  if (personas.length !== body.personas.length) return null;
  const category = cleanText(body.category, 40);
  const reason = cleanText(body.reason, 500);
  const speeches = speechList(body.speeches);
  if (!category || !reason || !speeches) return null;
  return synthesisPayload(factCardForModel(body.factCard), category, reason, personas, speeches);
}

function speechList(value: unknown): CitedSpeech[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const speeches: CitedSpeech[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.personaId !== "string" || typeof item.name !== "string" || typeof item.text !== "string") return null;
    if ([...item.text].length > 4000 || [...item.name].length > 80) return null;
    speeches.push({ personaId: item.personaId, name: item.name, text: item.text });
  }
  return speeches;
}

function sanitizeParse(value: unknown): { item: string | null; price: string | null; category: string | null; priceApproximate: boolean } | null {
  if (!isRecord(value)) return null;
  return {
    item: optionalText(value.item, 80),
    price: optionalText(value.price, 32),
    category: optionalText(value.category, 40),
    priceApproximate: value.priceApproximate === true,
  };
}

async function readJson(c: { req: { header: (name: string) => string | undefined; text: () => Promise<string> } }): Promise<Record<string, unknown> | null> {
  const contentType = c.req.header("content-type")?.split(";")[0]?.trim();
  if (contentType !== "application/json") return null;
  let raw = "";
  try {
    raw = await c.req.text();
  } catch {
    return null;
  }
  if (raw.length === 0 || raw.length > MAX_BODY) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function extractContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== "string") return null;
  const trimmed = choice.message.content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  return cleanText(value, max);
}

function hasExactKeys<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { Persona };
