import { LOCAL_DATA_FORMAT, parseLocalBackup, type LocalDataDocument } from "./local-data";
import { isDiscussionsDocument, type DiscussionsDocument } from "./discussion-store";
import { storageBytes } from "./storage-bytes";

export const PORTABLE_BACKUP_FORMAT = "zhiguan-local-backup@2" as const;

const MAX_DOCUMENT_CODE_UNITS = 5_000_000;
const MAX_DOCUMENT_STORAGE_BYTES = MAX_DOCUMENT_CODE_UNITS * 2;
const MAX_BACKUP_FILE_BYTES = MAX_DOCUMENT_CODE_UNITS * 3;

export type PortableBackup =
  | { readonly status: "valid"; readonly kind: "v1"; readonly document: LocalDataDocument }
  | { readonly status: "valid"; readonly kind: "v2"; readonly document: LocalDataDocument; readonly discussions: DiscussionsDocument | null }
  | { readonly status: "invalid"; readonly reason: "malformed" | "unsupported-version" };

export function createPortableBackup(
  document: LocalDataDocument,
  discussions: DiscussionsDocument | null,
  exportedAt = new Date(),
): string {
  if (discussions !== null && !isDiscussionsDocument(discussions)) throw new RangeError("invalid-discussions");
  if (!Number.isFinite(exportedAt.getTime())) throw new RangeError("invalid-local-data");
  const profile = parseLocalBackup(JSON.stringify(document));
  if (profile.status !== "valid") throw new RangeError("invalid-local-data");
  return `${JSON.stringify({
    format: PORTABLE_BACKUP_FORMAT,
    exported_at: exportedAt.toISOString(),
    profile: document,
    discussions,
  }, null, 2)}\n`;
}

export async function parsePortableBackupFile(file: Pick<File, "size" | "text">): Promise<PortableBackup> {
  if (file.size > MAX_BACKUP_FILE_BYTES) return { status: "invalid", reason: "malformed" };
  return parsePortableBackup(await file.text());
}

export function parsePortableBackup(raw: string): PortableBackup {
  if (storageBytes(raw) > MAX_DOCUMENT_STORAGE_BYTES) return { status: "invalid", reason: "malformed" };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "malformed" };
  }
  if (!isRecord(value) || typeof value.format !== "string") return { status: "invalid", reason: "malformed" };
  if (value.format === LOCAL_DATA_FORMAT) {
    const parsed = parseLocalBackup(raw);
    return parsed.status === "valid"
      ? { status: "valid", kind: "v1", document: parsed.document }
      : { status: "invalid", reason: parsed.reason };
  }
  if (value.format !== PORTABLE_BACKUP_FORMAT) return { status: "invalid", reason: "unsupported-version" };
  if (!hasExactKeys(value, ["format", "exported_at", "profile", "discussions"])) return { status: "invalid", reason: "malformed" };
  if (!isIsoDate(value.exported_at)) return { status: "invalid", reason: "malformed" };
  const profile = parseLocalBackup(JSON.stringify(value.profile));
  if (profile.status !== "valid") return { status: "invalid", reason: "malformed" };
  if (value.discussions !== null && !isDiscussionsDocument(value.discussions)) return { status: "invalid", reason: "malformed" };
  return { status: "valid", kind: "v2", document: profile.document, discussions: value.discussions };
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
