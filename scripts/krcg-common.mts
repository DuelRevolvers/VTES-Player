/**
 * Shared helpers for the KRCG data pipeline.
 *
 * The raw KRCG schema is treated as untrusted/loose: we read it through a
 * minimal interface with runtime checks, so a KRCG format change produces a
 * clear pipeline error instead of a corrupt registry.
 */
import { readFile } from "node:fs/promises";

/** The subset of the KRCG card object the pipeline relies on. */
export interface RawKrcgCard {
  id: number;
  name: string;
  /** e.g. ["Vampire"] for crypt, ["Action"] / ["Action Modifier", "Reaction"] etc. for library */
  types?: string[];
  card_text?: string;
  /** set key -> printing info */
  sets?: Record<string, unknown>;
  /** crypt fields */
  capacity?: number;
  group?: number | string;
  clans?: string[];
  disciplines?: string[];
  /** Path of Enlightenment, printed on Sabbat V5 vampires (and used by KRCG
   *  to group the library cards of each Path deck, where it is a set label
   *  rather than a requirement — docs/path-cards-design.md §0). */
  path?: string;
  /** library fields */
  pool_cost?: number | string;
  blood_cost?: number | string;
  burn_option?: boolean;
  /** image url(s) */
  url?: string;
  _i18n?: unknown;
  [key: string]: unknown;
}

export async function loadRawCards(rawPath: string): Promise<RawKrcgCard[]> {
  const text = await readFile(rawPath, "utf-8");
  const parsed: unknown = JSON.parse(text);
  const arr = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.values(parsed)
      : null;
  if (!arr) throw new Error("Unexpected KRCG JSON shape (not array or object)");
  const cards: RawKrcgCard[] = [];
  for (const item of arr) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as RawKrcgCard).id === "number" &&
      typeof (item as RawKrcgCard).name === "string"
    ) {
      cards.push(item as RawKrcgCard);
    }
  }
  if (cards.length === 0) throw new Error("No cards recognized in KRCG JSON");
  return cards;
}

/** KRCG marks crypt cards with type Vampire (or Imbued in legacy sets). */
export function isCryptRaw(card: RawKrcgCard): boolean {
  const types = card.types ?? [];
  return types.includes("Vampire") || types.includes("Imbued");
}

/** Parse a KRCG cost field: number, numeric string, "X", or absent. */
export function parseCost(v: number | string | undefined): {
  value: number | null;
  raw?: string;
} {
  if (v === undefined || v === null || v === "") return { value: null };
  if (typeof v === "number") return { value: v };
  const n = Number(v);
  if (Number.isFinite(n)) return { value: n };
  return { value: null, raw: v }; // e.g. "X"
}

/**
 * KRCG encodes discipline levels by case: "dom" basic vs "DOM" superior in
 * some exports, or full names with an `inf`/superior marker in others. The
 * registry builder normalizes via this helper; if the snapshot uses a
 * different convention, fix it HERE and the printed warnings will say so.
 */
export function parseCryptDisciplines(
  raw: string[] | undefined
): Record<string, "basic" | "superior"> {
  const out: Record<string, "basic" | "superior"> = {};
  for (const d of raw ?? []) {
    if (!d) continue;
    const isUpper = d === d.toUpperCase() && d !== d.toLowerCase();
    out[normalizeDisciplineName(d)] = isUpper ? "superior" : "basic";
  }
  return out;
}

function normalizeDisciplineName(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
}
