import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../server/app";
import { PERSONA_INSTRUCTION, SYNTHESIS_INSTRUCTION, personaTurnPayload, renderPreview, synthesisPayload, cardForDiscussion } from "../src/domain/discussion-payload";
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

function readTextFiles(dir: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) parts.push(readTextFiles(path));
    else if (entry.isFile()) parts.push(readFileSync(path, "utf8"));
  }
  return parts.join("\n");
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

  it("logs output_invalid when the model content is not json", async () => {
    const logs: string[] = [];
    const hidden = "格式坏了的正文标记";
    const steps = [
      () => new Response(chatCompletion(null, { raw: `{"broken":${hidden}` }), { status: 200, headers: { "content-type": "application/json" } }),
      () => {
        throw new Error("network down");
      },
    ];
    const fetchImpl: typeof fetch = async () => {
      const next = steps.shift();
      if (!next) throw new Error("missing response");
      return next();
    };
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: (category) => logs.push(category) });
    const invalid = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "想买一台吸尘器" }));
    const network = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "想买一台吸尘器" }));
    expect(invalid.status).toBe(502);
    expect(network.status).toBe(502);
    expect(await invalid.json()).toEqual({ error: "service_failed" });
    expect(await network.json()).toEqual({ error: "service_failed" });
    expect(logs).toEqual(["parse_output_invalid", "parse_service_failed"]);
    expect(logs.join("")).not.toContain(hidden);
    expect(logs.join("")).not.toContain(secret);
  });

  it("accepts a versioned flash name and still rejects chat and pro", async () => {
    const logs: string[] = [];
    const models = ["DeepSeek-V4.1-Flash-1017", "deepseek-v4-flash", "deepseek-chat", "DeepSeek-V4-Pro", "deepseek-v4-pro"];
    const sent: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = sentChat(String(init?.body ?? ""));
      sent.push(body.model);
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.temperature).toBe(0);
      expect(body.max_tokens).toBe(256);
      const model = models.shift() ?? "";
      return new Response(chatCompletion(
        { item: "吸尘器", price: null, category: null, priceApproximate: false },
        { model },
      ), { status: 200, headers: { "content-type": "application/json" } });
    };
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: (category) => logs.push(category) });
    const accepted = ["DeepSeek-V4.1-Flash-1017", "deepseek-v4-flash"];
    for (const model of accepted) {
      const response = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "想买一台吸尘器" }));
      expect(response.status, model).toBe(200);
      expect(await response.json()).toEqual({ item: "吸尘器", price: null, category: null, priceApproximate: false });
    }
    for (const model of ["deepseek-chat", "DeepSeek-V4-Pro", "deepseek-v4-pro"]) {
      const response = await app.request("http://127.0.0.1:4174/api/parse", request("/api/parse", { text: "想买一台吸尘器" }));
      expect(response.status, model).toBe(502);
      expect(await response.json()).toEqual({ error: "service_failed" });
    }
    expect(logs).toEqual(["model_mismatch", "model_mismatch", "model_mismatch"]);
    expect(sent).toEqual(["deepseek-flash", "deepseek-flash", "deepseek-flash", "deepseek-flash", "deepseek-flash"]);
    expect(logs.join("")).not.toContain(secret);
  });

  it("sends each instruction once and the preview shows those messages", async () => {
    const personas = defaultPersonas();
    const enabled = personas.filter((persona) => persona.enabled);
    const family = enabled[0]!;
    const speeches = [
      { personaId: family.id, name: family.name, text: "旧的坏了" },
      { personaId: "future-self", name: "5 年后的你", text: "先看工时" },
    ];
    const sharedCard = cardForDiscussion(card(), enabled);
    let personaRaw = "";
    let synthesisRaw = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      const raw = String(init?.body ?? "");
      const body = sentChat(raw);
      if (body.max_tokens === 1024) personaRaw = raw;
      else synthesisRaw = raw;
      const content = body.max_tokens === 1024
        ? { personaId: family.id, points: ["先看余量"] }
        : {
          leaning: "lean-wait",
          reasons: ["再看一次"],
          risks: ["可能用不上"],
          changeConditions: ["如果现有的彻底不能用，就买"],
          disagreements: ["还没对齐"],
        };
      return new Response(chatCompletion(content), { status: 200, headers: { "content-type": "application/json" } });
    };
    const app = createApp({ env: { DEEPSEEK_API_KEY: secret }, fetchImpl, log: () => undefined });
    const personaResponse = await app.request("http://127.0.0.1:4174/api/discussion/persona", request("/api/discussion/persona", {
      factCard: sharedCard,
      category: "家电",
      reason: "旧的坏了",
      persona: family,
      round: 1,
    }));
    expect(personaResponse.status).toBe(200);
    const synthesisInput = synthesisPayload(card(), "家电", "旧的坏了", personas, speeches);
    const synthesisResponse = await app.request("http://127.0.0.1:4174/api/discussion/synthesis", request("/api/discussion/synthesis", {
      factCard: synthesisInput.factCard,
      category: synthesisInput.category,
      reason: synthesisInput.reason,
      personas: synthesisInput.personas,
      speeches: synthesisInput.speeches,
    }));
    expect(synthesisResponse.status).toBe(200);

    const personaBody = sentChat(personaRaw);
    const synthesisBody = sentChat(synthesisRaw);
    const personaUser = JSON.parse(personaBody.messages[1]?.content ?? "") as Record<string, unknown>;
    const synthesisUser = JSON.parse(synthesisBody.messages[1]?.content ?? "") as Record<string, unknown>;
    expect(personaBody.model).toBe("deepseek-flash");
    expect(personaBody.thinking).toEqual({ type: "disabled" });
    expect(personaBody.messages).toHaveLength(2);
    expect(personaBody.messages[0]).toEqual({ role: "system", content: PERSONA_INSTRUCTION });
    expect(personaBody.messages[1]?.content).not.toContain(PERSONA_INSTRUCTION);
    expect(personaUser).not.toHaveProperty("instruction");
    expect(synthesisBody.messages).toHaveLength(2);
    expect(synthesisBody.messages[0]).toEqual({ role: "system", content: SYNTHESIS_INSTRUCTION });
    expect(synthesisBody.messages[1]?.content).not.toContain(SYNTHESIS_INSTRUCTION);
    expect(synthesisUser).not.toHaveProperty("instruction");
    expect(synthesisUser).toEqual(synthesisInput);

    const round1Turn = personaTurnPayload(card(), "家电", "旧的坏了", family, enabled, 1);
    expect(personaUser).toEqual(round1Turn);
    const round1Preview = renderPreview({
      round: 1,
      card: card(),
      category: "家电",
      reason: "旧的坏了",
      personas,
      providerHost: "api.deepseek.com",
    });
    expect(round1Preview.split(PERSONA_INSTRUCTION).length - 1).toBe(1);
    expect(round1Preview.split(SYNTHESIS_INSTRUCTION).length - 1).toBe(1);
    expect(round1Preview).toContain(JSON.stringify(round1Turn, null, 2));

    const round2Preview = renderPreview({
      round: 2,
      card: card(),
      category: "家电",
      reason: "旧的坏了",
      personas,
      providerHost: "api.deepseek.com",
      validatedSpeeches: speeches,
    });
    expect(round2Preview.split(PERSONA_INSTRUCTION).length - 1).toBe(1);
    expect(round2Preview.split(SYNTHESIS_INSTRUCTION).length - 1).toBe(1);
    expect(round2Preview).toContain(JSON.stringify(synthesisInput, null, 2));
    for (const persona of enabled) {
      const turn = personaTurnPayload(
        card(),
        "家电",
        "旧的坏了",
        persona,
        enabled,
        2,
        speeches.find((speech) => speech.personaId === persona.id)?.text ?? "",
        speeches.filter((speech) => speech.personaId !== persona.id),
      );
      expect(turn).not.toHaveProperty("instruction");
      expect(round2Preview).toContain(JSON.stringify(turn, null, 2));
    }
  });

  it("reads server files recursively and does not keep the discontinued deepseek-chat id", () => {
    const root = mkdtempSync(join(tmpdir(), "zhiguan-server-"));
    try {
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, "root.ts"), "deepseek-flash\n");
      writeFileSync(join(root, "nested", "child.ts"), "still flash\n");
      expect(readTextFiles(root)).toContain("still flash");
      const source = readTextFiles(fileURLToPath(new URL("../server/", import.meta.url)));
      expect(source).not.toContain("deepseek-chat");
      expect(source).toContain("deepseek-flash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
