import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateDecision, type DecisionInput } from "../src/domain/calculation";
import { createPurchaseSnapshot } from "../src/domain/purchase-snapshot";
import {
  addFavorite,
  clearInvalidLocalData,
  clearLocalData,
  commitLocalData,
  createLocalBackup,
  deleteFavorite,
  LOCAL_DATA_FORMAT,
  LOCAL_DATA_STORAGE_KEY,
  parseLocalBackup,
  readLocalData,
  restoreInvalidLocalData,
  restoreLocalData,
  type LocalDataContent,
} from "../src/domain/local-data";
import type { IncomeProfile } from "../src/domain/income";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null {
    if (this.failGet) throw new Error("storage-blocked");
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void {
    if (this.failRemove) throw new Error("storage-blocked");
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("quota-exceeded");
    this.values.set(key, String(value));
  }
}

const profile: IncomeProfile = {
  income: "8000",
  timeZone: "Asia/Shanghai",
  workDays: [1, 2, 3, 4, 5],
  periods: [
    { start: "09:00", end: "12:00", endDayOffset: 0 },
    { start: "13:00", end: "18:00", endDayOffset: 0 },
  ],
  exceptions: {},
  updatedAt: "2026-09-22T00:00:00.000Z",
  scheduleSource: "default",
};

const input: DecisionInput = {
  income: "8000",
  workHours: "160",
  fixedExpenses: "3000",
  purchaseAmount: "800",
  taxBasis: "after-tax",
  fixedCostCoverage: "complete",
  purchaseIncluded: "included",
  valueExpectation: "减少通勤时间",
  evidence: { income: "estimated", workHours: "user-confirmed", fixedExpenses: "user-confirmed", purchaseAmount: "user-confirmed" },
};

const snapshot = createPurchaseSnapshot(input, calculateDecision(input), { code: "", rationale: "", reviewCondition: "" }, {
  comparisonMonth: "2026-09",
  timeZone: "Asia/Shanghai",
}, new Date("2026-09-22T10:00:00.000Z"));

let storage: MemoryStorage;
let revision = 0;

function resetEnvironment(): void {
  storage = new MemoryStorage();
  revision = 0;
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, _options: { mode: "exclusive" }, callback: () => Promise<unknown>) => callback(),
    },
  });
  vi.stubGlobal("crypto", { randomUUID: () => `revision-${++revision}` });
}

function validContent(overrides: Partial<LocalDataContent> = {}): LocalDataContent {
  return { profile, favorites: [], ...overrides };
}

function writeRaw(value: unknown): string {
  const raw = JSON.stringify(value);
  storage.setItem(LOCAL_DATA_STORAGE_KEY, raw);
  return raw;
}

describe("local data and backups", () => {
  beforeEach(resetEnvironment);
  afterEach(() => vi.unstubAllGlobals());

  it("distinguishes empty, valid, corrupt, unsupported, and unavailable reads", async () => {
    expect(readLocalData()).toEqual({ status: "empty", document: null, raw: null });

    const corruptRaw = "not-json";
    storage.setItem(LOCAL_DATA_STORAGE_KEY, corruptRaw);
    expect(readLocalData()).toEqual({ status: "invalid", document: null, raw: corruptRaw, reason: "malformed" });

    const unsupportedRaw = JSON.stringify({ format: "zhiguan-local-backup@99" });
    storage.setItem(LOCAL_DATA_STORAGE_KEY, unsupportedRaw);
    expect(readLocalData()).toEqual({ status: "invalid", document: null, raw: unsupportedRaw, reason: "unsupported-version" });

    storage.clear();
    const saved = await commitLocalData(validContent(), null);
    expect(saved.status).toBe("saved");
    expect(readLocalData()).toMatchObject({ status: "ready", document: saved.status === "saved" ? saved.document : null });

    storage.failGet = true;
    expect(readLocalData()).toEqual({ status: "unavailable", document: null, raw: null, reason: "storage-unavailable" });
  });

  it("commits under a revision check and leaves the previous record on conflict or write failure", async () => {
    const first = await commitLocalData(validContent(), null);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    const firstRaw = storage.getItem(LOCAL_DATA_STORAGE_KEY);

    expect(await commitLocalData(validContent({ profile: { ...profile, income: "9000" } }), "stale-revision")).toEqual({
      status: "conflict",
      currentRevision: first.document.revision,
    });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(firstRaw);

    storage.failSet = true;
    expect(await commitLocalData(validContent({ profile: { ...profile, income: "9000" } }), first.document.revision)).toEqual({
      status: "unavailable",
      reason: "write-failed",
    });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(firstRaw);
  });

  it("preserves existing bytes when favorite deletion, backup restore, or clearing fails", async () => {
    const saved = await commitLocalData(validContent(), null);
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    const favorited = await addFavorite(snapshot, saved.document.revision);
    expect(favorited.status).toBe("saved");
    if (favorited.status !== "saved") return;
    const beforeFailure = storage.getItem(LOCAL_DATA_STORAGE_KEY);

    storage.failSet = true;
    expect(await deleteFavorite(favorited.document.favorites[0]!.id, favorited.document.revision)).toEqual({
      status: "unavailable",
      reason: "write-failed",
    });
    expect(await restoreLocalData({ profile: null, favorites: [] }, favorited.document.revision)).toEqual({
      status: "unavailable",
      reason: "write-failed",
    });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(beforeFailure);

    storage.failSet = false;
    storage.failRemove = true;
    expect(await clearLocalData(favorited.document.revision)).toEqual({ status: "unavailable", reason: "write-failed" });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(beforeFailure);
  });

  it("preserves damaged bytes when explicit recovery or clearing fails", async () => {
    const damagedRaw = writeRaw({ format: "zhiguan-local-backup@99", data: "keep on failed recovery" });

    storage.failSet = true;
    expect(await restoreInvalidLocalData(validContent(), damagedRaw)).toEqual({ status: "unavailable", reason: "write-failed" });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(damagedRaw);

    storage.failSet = false;
    storage.failRemove = true;
    expect(await clearInvalidLocalData(damagedRaw)).toEqual({ status: "unavailable", reason: "write-failed" });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(damagedRaw);
  });

  it("refuses writes when Web Locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    expect(await commitLocalData(validContent(), null)).toEqual({ status: "unavailable", reason: "locks-unavailable" });
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBeNull();
  });

  it("keeps favorites immutable when profile data changes and deletes only the selected favorite", async () => {
    const first = await commitLocalData(validContent(), null);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    const added = await addFavorite(snapshot, first.document.revision, new Date("2026-09-22T10:01:00.000Z"));
    expect(added.status).toBe("saved");
    if (added.status !== "saved") return;

    const update = await commitLocalData({ profile: { ...profile, income: "9000" }, favorites: added.document.favorites }, added.document.revision);
    expect(update.status).toBe("saved");
    if (update.status !== "saved") return;
    expect(update.document.profile?.income).toBe("9000");
    expect(update.document.favorites[0]?.snapshot.inputs.income).toBe("8000");

    const removed = await deleteFavorite(update.document.favorites[0]!.id, update.document.revision);
    expect(removed.status).toBe("saved");
    if (removed.status === "saved") {
      expect(removed.document.profile?.income).toBe("9000");
      expect(removed.document.favorites).toEqual([]);
      expect(await deleteFavorite("missing", removed.document.revision)).toEqual({ status: "not-found" });
    }
  });

  it("allows favorites containing invalid input when calculation results honestly remain insufficient", async () => {
    const incomplete: DecisionInput = {
      ...input,
      income: "bad-income",
      purchaseAmount: "",
      evidence: { ...input.evidence, income: "", purchaseAmount: "" },
    };
    const insufficient = createPurchaseSnapshot(incomplete, calculateDecision(incomplete), { code: "", rationale: "", reviewCondition: "" }, {
      comparisonMonth: "2026-09",
      timeZone: "Asia/Shanghai",
    });
    expect(insufficient.results[0]?.availability).toBe("insufficient-data");
    const result = await addFavorite(insufficient, null);
    expect(result.status).toBe("saved");
    if (result.status === "saved") expect(result.document.favorites[0]?.snapshot.inputs.income).toBe("bad-income");
  });

  it("round-trips the versioned backup and rejects bad versions or extra fields", async () => {
    const first = await commitLocalData(validContent(), null);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    const added = await addFavorite(snapshot, first.document.revision);
    expect(added.status).toBe("saved");
    if (added.status !== "saved") return;

    const backup = createLocalBackup(added.document, new Date("2026-09-22T10:05:00.000Z"));
    const parsed = parseLocalBackup(backup);
    expect(parsed.status).toBe("valid");
    if (parsed.status === "valid") {
      expect(parsed.document.profile).toEqual(profile);
      expect(parsed.document.favorites).toEqual(added.document.favorites);
    }
    expect(parseLocalBackup(JSON.stringify({ format: "zhiguan-purchase-decision@1" }))).toEqual({ status: "invalid", reason: "unsupported-version" });
    expect(parseLocalBackup(JSON.stringify({ format: "zhiguan-local-backup@2" }))).toEqual({ status: "invalid", reason: "unsupported-version" });
    expect(parseLocalBackup("{")).toEqual({ status: "invalid", reason: "malformed" });

    const withUnknownField = JSON.parse(backup) as Record<string, unknown>;
    withUnknownField.transcript = "must not enter local data";
    expect(parseLocalBackup(JSON.stringify(withUnknownField))).toEqual({ status: "invalid", reason: "malformed" });

    const restored = await restoreLocalData(parsed.status === "valid" ? parsed.document : validContent(), added.document.revision);
    expect(restored.status).toBe("saved");
    if (restored.status === "saved") expect(restored.document.favorites).toEqual(added.document.favorites);
  });

  it("requires the exact damaged raw value before explicit restore or clear", async () => {
    const damagedRaw = writeRaw({ format: "zhiguan-local-backup@99", data: "keep until confirmed" });
    expect(readLocalData().status).toBe("invalid");
    expect(await commitLocalData(validContent(), null)).toMatchObject({ status: "invalid", reason: "unsupported-version" });

    const restored = await restoreInvalidLocalData(validContent(), damagedRaw);
    expect(restored.status).toBe("saved");
    if (restored.status !== "saved") return;

    const nextDamagedRaw = writeRaw({ format: "unknown-version" });
    const staleRestore = await restoreInvalidLocalData(validContent(), "different-raw");
    expect(staleRestore.status).toBe("conflict");
    expect(storage.getItem(LOCAL_DATA_STORAGE_KEY)).toBe(nextDamagedRaw);

    expect(await clearInvalidLocalData(nextDamagedRaw)).toEqual({ status: "cleared" });
    expect(readLocalData().status).toBe("empty");
  });

  it("clears valid data only when its current revision still matches", async () => {
    const saved = await commitLocalData(validContent(), null);
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    expect(await clearLocalData("stale-revision")).toEqual({ status: "conflict", currentRevision: saved.document.revision });
    expect(readLocalData().status).toBe("ready");
    expect(await clearLocalData(saved.document.revision)).toEqual({ status: "cleared" });
    expect(readLocalData().status).toBe("empty");
  });

  it("does not silently accept unknown stored document keys", () => {
    const raw = writeRaw({ format: LOCAL_DATA_FORMAT, revision: "r1", profile: null, favorites: [], conversation: "private" });
    expect(readLocalData()).toEqual({ status: "invalid", document: null, raw, reason: "malformed" });
  });
});
