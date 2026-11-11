import { describe, expect, it, vi } from "vitest";

import { createApp } from "../server/app";
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
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ personaId: family.id, points: ["相当于 16.00 小时"] }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
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
  });

  it("keeps parse separate and refuses an income profile", async () => {
    let outbound = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      outbound = `${String(input)}\n${String(init?.body ?? "")}`;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ item: "吸尘器", price: "1000", category: "家电", priceApproximate: false, advice: "应该买" }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
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
  });
});
