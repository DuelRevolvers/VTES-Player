/**
 * Registry lookups for the debug UI: card scans, card text, and the crypt
 * side of deck building.
 *
 * Card images are the official KRCG scans (static.krcg.org) already
 * recorded in the registry by the phase-1 pipeline — the same source and
 * the same permission the card data comes under (CLAUDE.md, "What this
 * is"). Nothing is fetched at build time; the browser loads them directly.
 */

import registry from "../cards/registry.json";
import type { CardRegistry, CryptCardDef } from "../cards/types.ts";
import type { DisciplineLevel, Sect, VampireTitle } from "../engine/index.ts";

const reg = registry as unknown as CardRegistry;

const byName = new Map<string, { image: string; cardText: string; supported: boolean }>();
const cryptById = new Map<number, CryptCardDef>();

for (const entry of Object.values(reg.entries)) {
  byName.set(entry.card.name, {
    image: entry.card.image,
    cardText: entry.card.cardText,
    supported: entry.supported,
  });
  if (entry.card.kind === "crypt") cryptById.set(entry.card.id, entry.card);
}

/** KRCG scan URL for a card, by exact registry name. */
export function imageFor(name: string): string | null {
  return byName.get(name)?.image ?? null;
}

export function cardText(name: string): string | null {
  return byName.get(name)?.cardText ?? null;
}

export function isSupported(name: string): boolean {
  return byName.get(name)?.supported ?? false;
}

// ---------------------------------------------------------------------------
// Crypt import (the parse phase 7 needs, minus the abilities)
// ---------------------------------------------------------------------------

const SECTS: Record<string, Sect> = {
  Camarilla: "camarilla",
  Sabbat: "sabbat",
  Anarch: "anarch",
  Independent: "independent",
};

const TITLES: Record<string, VampireTitle> = {
  primogen: "primogen",
  prince: "prince",
  baron: "baron",
  justicar: "justicar",
  bishop: "bishop",
  archbishop: "archbishop",
  priscus: "priscus",
  cardinal: "cardinal",
  regent: "regent",
};

export interface CryptImport {
  id: number;
  name: string;
  capacity: number;
  clan: string;
  /** Lowercased to the engine's 3-letter codes — the registry stores crypt
   *  disciplines capitalised ("Dom"), the card specs use "dom". */
  disciplines: Record<string, DisciplineLevel>;
  sect: Sect | null;
  title: VampireTitle | null;
  /** The Path of Enlightenment, for the six library cards that filter on
   *  one. A PRINTED trait read straight off the card, exactly like clan and
   *  sect — undefined for every vampire outside the Sabbat V5 crypt, which
   *  is most of the pool (docs/path-cards-design.md §1). */
  path?: string;
  image: string;
  cardText: string;
  /** True when the card has rules text beyond its sect/title line. Those
   *  abilities are NOT implemented (crypt is 0/217, phase 7), so the UI
   *  marks the vampire rather than letting a playtest silently assume it
   *  works. */
  hasUnimplementedAbility: boolean;
}

/**
 * Read a real V5 crypt card into the fields `MinionState` needs. Sect and
 * title come from the card text prefix — "Camarilla Prince of Melbourne:",
 * "Sabbat bishop:", "Anarch Baron of Columbus." — which every card in the
 * V5 crypt carries.
 */
export function importCryptCard(id: number): CryptImport {
  const card = cryptById.get(id);
  if (!card) throw new Error(`no crypt card with id ${id} in the V5 pool`);

  const disciplines: Record<string, DisciplineLevel> = {};
  for (const [key, level] of Object.entries(card.disciplines)) {
    disciplines[key.toLowerCase()] = level;
  }

  const text = card.cardText.trim();
  const prefix = /^(Camarilla|Sabbat|Anarch|Independent|Laibon)\b([^.:]*)/.exec(text);
  const sect = prefix ? (SECTS[prefix[1]!] ?? null) : null;

  let title: VampireTitle | null = null;
  if (prefix?.[2]) {
    // "Prince of Melbourne" / "bishop" / "Assamite Justicar" → the title word.
    const words = prefix[2].replace(/\s+of\s+.*$/i, "").trim().split(/\s+/);
    for (const w of words) {
      const found = TITLES[w.toLowerCase()];
      if (found) {
        title = found;
        break;
      }
    }
  }

  // Anything after the sect/title clause is a real ability.
  // Ability text beyond the sect/title line — AND no implementation for
  // it. Until the crypt waves this was simply "has ability text", because
  // no crypt card had an implementation; a supported vampire now carries
  // its ability for real and must not be reported as inert
  // (docs/crypt-wave-2.md §5).
  const hasText = !/^[^.:]*\.\s*$/.test(text);
  const hasUnimplementedAbility = hasText && !isSupported(card.name);

  const out: CryptImport = {
    id: card.id,
    name: card.name,
    capacity: card.capacity,
    clan: card.clan,
    disciplines,
    sect,
    title,
    image: card.image,
    cardText: card.cardText,
    hasUnimplementedAbility,
  };
  if (card.path !== undefined) out.path = card.path;
  return out;
}
