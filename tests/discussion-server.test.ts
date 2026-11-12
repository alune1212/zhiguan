import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../server/app";
import { PERSONA_INSTRUCTION, SYNTHESIS_INSTRUCTION } from "../src/domain/discussion-payload";
import { buildFactCard } from "../src/domain/fact-card";
import { defaultProfile } from "../src/domain/income";
import { defaultPersonas } from "../src/domain/personas";

const now = new Date("2026-09-23T01:00:00.000Z");
const secret = "sk-test-secret";

function card() {
  const result = buildFactCard({
    profile: { ...defaultProfile(now), income: "10000", timeZone: "Asia/Shanghai" },
    now,
    price: "1000",
    priceEvidence: "user-confirmed",
    frequency: null,
    holdingDays: null,
    fixedExpenses: null,
    emergencyFund: null,
    otherSavings: null,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.card;
}

function chatCompletion(content: unknown, extras?: { readonly model?: string; readonly finishReason?: string; readonly raw?: string }): string {
  return JSON.stringify({
    model: extras?.model ?? "deepseek-flash",
    choices: [{
      finish_reason: extras?.finishReason ?? "stop",
      message: { content: extras?.raw ?? JSON.stringify(content) },
    }],
  });
}

function sentChat(raw: string) {
  return JSON.parse(raw) as {
    model: string;
    thinking: { type: string };
    stream: boolean;
    temperature: number;
    max_tokens: number;
    response_format: { type: string };
    messages: { role: string; content: string }[];
  };
}

function request(_path: string, body: unknown, headers?: HeadersInit) {
  return {
    method: "POST",
    headers: {
      host: "127.0.0.1:4174",
      origin: "http://127.0.0.1:4174",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  } as const;
}

describe("discussion server", () => {
  it("does not call DeepSeek or log the body when the key is missing", async () => {
    const fetchImpl = vi.fn();
    const logs: string[] = [];
    const app = createApp({ env: {}, fetchImpl, log: (category) => logs.push(category) });
    const response = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", {
      factCard: card(),
      category: "家电",
      reason: "旧的坏了，这句话不能出现在日志里",
      persona: defaultPersonas()[0],
      round: 1,
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
    const provider = await app.request("http://127.0.0.1:4174/api/provider", {
      headers: { host: "127.0.0.1:4174", origin: "http://127.0.0.1:4174" },
    });
    expect(await provider.json()).toEqual({ provider: "DeepSeek", host: "api.deepseek.com", available: false });
    const sameOriginGet = await app.request("http://127.0.0.1:4173/api/provider", {
      headers: { host: "127.0.0.1:4173" },
    });
    expect(sameOriginGet.status).toBe(200);
    const missingOrigin = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "吸尘器" }, { origin: "" }));
    expect(missingOrigin.status).toBe(403);
  });

  it("forwards one persona to DeepSeek and keeps the key out of the body and response", async () => {
    const logs: string[] = [];
    let outbound = "";
    let requestUrl = "";
    let authorization = "";
    const family = defaultPersonas()[0]!;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      outbound = String(init?.body ?? "");
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(chatCompletion({ personaId: family.id, points: ["相当于 16.00 小时"] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const app = createApp({
      env: { DEEPSEEK_API_KEY: secret, DEEPSEEK_API_BASE: "https://api.deepseek.com" },
      fetchImpl,
      log: (category) => logs.push(category),
    });
    const leaked = "设定泄漏标记";
    const rejected = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", {
      factCard: { ...card(), holdingSuggestion: 1825 },
      category: "家电",
      reason: "旧的坏了",
      persona: family,
      round: 1,
      otherPersona: { name: "伴侣", personality: leaked },
    }));
    expect(rejected.status).toBe(400);
    expect(outbound).toBe("");

    const response = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", {
      factCard: card(),
      category: "家电",
      reason: "旧的坏了",
      persona: family,
      round: 1,
    }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("相当于 16.00 小时");
    expect(text).not.toContain(secret);
    expect(requestUrl).toBe("https://api.deepseek.com/chat/completions");
    expect(outbound).not.toContain(secret);
    expect(outbound).not.toContain(leaked);
    expect(outbound).not.toContain("一起商量，不替对方做主");
    expect(authorization).toBe(`Bearer ${secret}`);
    expect(logs).toEqual([]);
    const body = sentChat(outbound);
    expect(body.model).toBe("deepseek-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1024);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: PERSONA_INSTRUCTION });
  });

  it("keeps parse separate and refuses an income profile", async () => {
    let outbound = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      outbound = `${String(input)}\n${String(init?.body ?? "")}`;
      return new Response(chatCompletion({ item: "吸尘器", price: "1000", category: "家电", priceApproximate: false, advice: "应该买" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: () => undefined });
    const rejected = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", {
      text: "想买一台吸尘器，1000 元，家电",
      income: "10000",
      factCard: card(),
    }));
    expect(rejected.status).toBe(400);
    expect(outbound).toBe("");

    const response = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", {
      text: "想买一台吸尘器，1000 元，家电",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item: "吸尘器", price: "1000", category: "家电", priceApproximate: false });
    expect(outbound).toContain("https://api.deepseek.com/chat/completions");
    expect(outbound).not.toContain("/api/parse");
    expect(outbound).not.toContain("10000");
    expect(outbound).not.toContain(secret);
    expect(outbound).not.toContain("应该买");
    const body = sentChat(outbound.split("\n")[1] ?? "");
    expect(body.model).toBe("deepseek-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(256);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.content).toContain("输出 JSON");
    expect(body.messages[0]?.content).toContain("\n");
  });

  it("logs only a failure category when DeepSeek fails", async () => {
    const logs: string[] = [];
    let outbound = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      outbound = String(init?.body ?? "");
      return new Response("provider down", { status: 500 });
    };
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: (category) => logs.push(category) });
    const response = await app.request("http://127.0.0.1:4174/api/discussion/synthesis", request("/api/discussion/synthesis", {
      factCard: card(),
      category: "家电",
      reason: "旧的坏了，不要写进日志",
      personas: defaultPersonas().filter((persona) => persona.enabled),
      speeches: [{ personaId: "family", name: "家人", text: "旧的坏了", personality: "设定泄漏标记" }],
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "service_failed" });
    expect(logs).toEqual(["discussion_service_failed"]);
    expect(logs.join("")).not.toContain("旧的坏了");
    expect(logs.join("")).not.toContain(secret);
    expect(outbound).not.toContain("设定泄漏标记");
    expect(outbound).not.toContain(secret);
    const body = sentChat(outbound);
    expect(body.model).toBe("deepseek-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1536);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: SYNTHESIS_INSTRUCTION });
  });

  it("does not accept a dissenter who gives no dissent", async () => {
    const logs: string[] = [];
    const fetchImpl: typeof fetch = async () => new Response(chatCompletion({ personaId: "future-self", points: ["先看工时"] }), { status: 200, headers: { "content-type": "application/json" } });
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: (category) => logs.push(category) });
    const dissenter = defaultPersonas().find((persona) => persona.id === "future-self");
    const response = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", {
      factCard: card(),
      category: "家电",
      reason: "旧的坏了",
      persona: dissenter,
      round: 1,
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "service_failed" });
    expect(logs).toEqual(["discussion_output_invalid"]);
  });

  it("rejects truncated, blank, mismatched and ordinary pushback output without logging the body", async () => {
    const logs: string[] = [];
    const hidden = "不要把这句话写进日志";
    const replies = [
      chatCompletion(null, { finishReason: "length", raw: hidden }),
      chatCompletion(null, { raw: " \n\t " }),
      chatCompletion({ item: "吸尘器", price: "1000", category: "家电", priceApproximate: false }, { model: "deepseek-chat" }),
      chatCompletion({ personaId: "family", points: ["先看余量"], pushback: hidden }),
    ];
    const fetchImpl: typeof fetch = async () => new Response(replies.shift() ?? "", { status: 200, headers: { "content-type": "application/json" } });
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: (category) => logs.push(category) });
    const family = defaultPersonas()[0]!;
    const personaBody = {
      factCard: card(),
      category: "家电",
      reason: hidden,
      persona: family,
      round: 1,
    };
    const truncated = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", personaBody));
    const blank = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: hidden }));
    const mismatched = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "想买一台吸尘器" }));
    const pushback = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", personaBody));
    for (const response of [truncated, blank, mismatched, pushback]) {
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "service_failed" });
    }
    expect(logs).toEqual(["discussion_truncated", "parse_empty", "model_mismatch", "discussion_output_invalid"]);
    expect(logs.join("")).not.toContain(hidden);
    expect(logs.join("")).not.toContain(secret);
  });

  it("does not keep the discontinued deepseek-chat id in the server", () => {
    const dir = fileURLToPath(new URL("../server/", import.meta.url));
    const source = readdirSync(dir).map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
    expect(source).not.toContain("deepseek-chat");
    expect(source).toContain("deepseek-flash");
  });

  it("rejects a declared body larger than the limit", async () => {
    const fetchImpl = vi.fn();
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: () => undefined });
    const response = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "吸尘器" }, { "content-length": "48001" }));
    expect(response.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized parse body before calling DeepSeek", async () => {
    const fetchImpl = vi.fn();
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: () => undefined });
    const response = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", {
      text: "字".repeat(48_001),
    }));
    expect(response.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
