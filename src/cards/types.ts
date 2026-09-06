/**
 * Card registry types.
 *
 * These are OUR types — the stable contract the engine, AI, and UI build
 * against. The KRCG JSON is transformed into this shape at build time by
 * scripts/build-registry.mts, so a KRCG schema change only ever touches
 * the pipeline, never the engine.
 */

/** Discipline levels: basic (square) or superior (diamond). */
export type DisciplineLevel = "basic" | "superior";

/** KRCG uses full discipline names; we keep them as strings but alias the type. */
export type Discipline = string; // e.g. "Dominate", "Obfuscate"
export type Clan = string; // e.g. "Malkavian", "Banu Haqim"

export type LibraryCardType =
  | "Master"
  | "Action"
  | "Action Modifier"
  | "Ally"
  | "Combat"
  | "Equipment"
  | "Event"
  | "Political Action"
  | "Reaction"
  | "Retainer";

export interface CryptCardDef {
  kind: "crypt";
  /** KRCG numeric id — stable, used in deck lists and imports. */
  id: number;
  name: string;
  clan: Clan;
  capacity: number;
  group: number | "ANY";
  /** Discipline name -> level. */
  disciplines: Record<Discipline, DisciplineLevel>;
  /** Sect + title + special abilities, verbatim. Parsed effects come later. */
  cardText: string;
  /** The Path of Enlightenment this vampire follows — "Cathari", "Death and
   *  the Soul", "Power and the Inner Voice", "Caine". A PRINTED trait, like
   *  clan and capacity, carried on the KRCG record; absent on every vampire
   *  outside the Sabbat V5 crypt. Six library cards filter on it, and no
   *  card in the game grants one, which is why it can only come from here
   *  (docs/path-cards-design.md §0). */
  path?: string;
  advanced: boolean;
  /** Card scan URL (static.krcg.org). */
  image: string;
  /** Sets (by KRCG set key) this card was printed in, within our pool. */
  sets: string[];
}

export interface LibraryCardDef {
  kind: "library";
  id: number;
  name: string;
  types: LibraryCardType[];
  /** Clan requirement(s), if any. */
  clans: Clan[];
  /** Discipline requirement(s), if any (any one of these unlocks the card). */
  disciplines: Discipline[];
  poolCost: number | null;
  bloodCost: number | null;
  /** "X" costs exist on a few cards; keep the raw string when non-numeric. */
  rawCost?: string;
  cardText: string;
  burnOption: boolean;
  image: string;
  sets: string[];
}

export type CardDef = CryptCardDef | LibraryCardDef;

/**
 * Implementation status. Every V5-pool card appears in the registry from day
 * one; `supported` flips to true only when the card has an effects
 * implementation AND a passing scenario test. Deck import validates against
 * this, so unsupported cards are reported to the user, never silently broken.
 */
export interface RegistryEntry {
  card: CardDef;
  supported: boolean;
  /** Optional note shown on import, e.g. "planned for Sabbat Paths phase". */
  note?: string;
}

/**
 * A preconstructed deck as printed in a product — the ready-made decks the
 * V5 boxes ship with.
 *
 * KRCG records this per card: each set a card appears in lists the precon
 * it belongs to and how many copies. So the precons are not a hand-kept
 * table, they are DERIVED by the pipeline from the same snapshot as
 * everything else, and they cannot drift from the card data.
 *
 * The importer needs them to answer "which precon decks are supported?",
 * and they double as ready-made decks for a lobby.
 */
export interface PreconDeck {
  /** KRCG set key, e.g. "Fifth Edition (Anarch)". */
  set: string;
  /** Precon name within that set, e.g. "Brujah". */
  name: string;
  /** Card ids and how many copies the printed deck holds. */
  cards: Array<{ id: number; copies: number }>;
}

export interface CardRegistry {
  /** ISO date the KRCG snapshot was fetched. */
  fetchedAt: string;
  /** Set keys included in this pool (from config/v5-sets.json). */
  pool: string[];
  entries: Record<number, RegistryEntry>;
  /** Preconstructed decks found in the pool's sets. Derived, never
   *  hand-edited — like the rest of the registry. */
  precons: PreconDeck[];
}

/** Convenience lookups used across engine/AI/UI. */
export function isCrypt(card: CardDef): card is CryptCardDef {
  return card.kind === "crypt";
}

export function isLibrary(card: CardDef): card is LibraryCardDef {
  return card.kind === "library";
}
