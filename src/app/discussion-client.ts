import { parsePersonaOutput, parseSynthesisOutput, type PersonaModelOutput, type SynthesisModelOutput } from "../domain/model-output";

export interface ProviderStatus {
  readonly provider: "DeepSeek";
  readonly host: string;
  readonly available: boolean;
}

export interface ParseResult {
  readonly item: string | null;
  readonly price: string | null;
  readonly category: string | null;
  readonly priceApproximate: boolean;
}

export async function loadProvider(signal?: AbortSignal): Promise<ProviderStatus | null> {
  const response = await fetch("/api/provider", { signal });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!isRecord(body) || body.provider !== "DeepSeek" || typeof body.host !== "string" || typeof body.available !== "boolean") return null;
  return { provider: "DeepSeek", host: body.host, available: body.available };
}

export async function parsePurchaseSentence(text: string, signal?: AbortSignal): Promise<ParseResult | null> {
  const response = await postJson("/api/parse", { text }, signal);
  if (!response) return null;
  if (!isRecord(response)) return null;
  return {
    item: response.item === null ? null : typeof response.item === "string" ? response.item : null,
    price: response.price === null ? null : typeof response.price === "string" ? response.price : null,
    category: response.category === null ? null : typeof response.category === "string" ? response.category : null,
    priceApproximate: response.priceApproximate === true,
  };
}

export async function requestPersona(body: unknown, signal?: AbortSignal): Promise<PersonaModelOutput | "failed"> {
  const response = await postJson("/api/discussion/persona", body, signal);
  if (!response || !isRecord(response) || typeof response.personaId !== "string") return "failed";
  const stance = isRecord(body) && isRecord(body.persona) && body.persona.stance === "pushback" ? "pushback" : "ordinary";
  return parsePersonaOutput(response, response.personaId, stance) ?? "failed";
}

export async function requestSynthesis(body: unknown, signal?: AbortSignal): Promise<SynthesisModelOutput | "failed"> {
  const response = await postJson("/api/discussion/synthesis", body, signal);
  if (!response) return "failed";
  return parseSynthesisOutput(response) ?? "failed";
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return null;
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
