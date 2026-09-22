/**
 * THE CARD CATALOGUE — every card in the game, for looking at.
 *
 * This is NOT the registry and must never be confused with it. The
 * registry (`registry.json`) is the POOL: the cards the engine can deal,
 * ~1,000 of them, carrying the parsed traits the rules kernel reads. The
 * catalogue is all 4,149 KRCG cards, carrying only what a person wants to
 * READ about a card — it is browsing data, and nothing in `src/engine/`
 * may import it.
 *
 * Two rules keep the second copy from becoming a second SOURCE OF TRUTH
 * (docs/deck-builder-design.md §2):
 *
 *  1. It is GENERATED, by `scripts/build-catalog.mts`, from the same
 *     `data/vtes-raw.json` snapshot the registry is built from — and from
 *     the registry itself, for `supported`. `npm run cards:registry` runs
 *     both, in that order, so they cannot drift.
 *  2. It is LOADED LAZILY. 1.6MB of card text has no business in the
 *     first paint of a menu screen (docs/pages-design.md counts every
 *     byte of it), so `loadCatalog` is a dynamic import and the Deck
 *     Builder is the only thing that ever asks for it.
 */

/** Which pile a card belongs to. Imbued sit in the crypt. */
export type CatalogKind = "crypt" | "library";

/**
 * How completely this platform plays a card — the honest three states,
 * because `supported` alone lies about the crypt.
 *
 * `config/supported.json` is flipped when a card has an IMPLEMENTATION,
 * and 118 V5 vampires need none: their text is a bare sect/title clause,
 * so they already do everything they print (CLAUDE.md, "No partial
 * cards"). Calling those unsupported on screen would report the pool as
 * broken where it is whole. So the badge asks the question the player
 * actually has:
 *
 * - `playable` — this card does everything it prints, at a table, today.
 * - `pool` — it is dealt, but something it prints is not implemented.
 *   **Nothing is in this state right now** and the assertion in
 *   `tests/cards/no-partial-cards.test.ts` is what keeps it that way; it
 *   exists so that a regression is VISIBLE rather than unrepresentable.
 * - `absent` — not in the pool. Real card, real text, not dealt here.
 */
export type CatalogStatus = "playable" | "pool" | "absent";

export interface CatalogCard {
  /** KRCG numeric id — the same id the registry and deck lists use. */
  id: number;
  /** KRCG's display name, which disambiguates groups: "Anarch Revolt". */
  name: string;
  /** The name as printed, without the "(G2)"/"(ADV)" disambiguator. */
  printedName: string;
  kind: CatalogKind;
  /** "Vampire", "Imbued", or the library types — verbatim from KRCG. */
  types: string[];
  clans: string[];
  /**
   * Discipline/virtue codes, lowercased ("dom", "obf", "viz").
   *
   * CODES, not names, because a code is what both halves of the game
   * speak: the registry stores library requirements as codes and a
   * crypt's levels are a code's case. `DISCIPLINE_NAMES` turns one into
   * English for the screen, and the search matches either.
   */
  disciplines: string[];
  /**
   * Crypt only: code → level, where superior is the diamond.
   *
   * Empty for a library card, which has a REQUIREMENT rather than a
   * level — a card asking for `dom` is asking for any, and asking for
   * superior is written into its text, not its data.
   */
  levels: Record<string, "basic" | "superior">;
  capacity: number | null;
  /** "1".."7", or "ANY" for the groupless. Null on a library card. */
  group: string | null;
  /** Camarilla / Sabbat / Anarch / Independent / Laibon, or null. */
  sect: string | null;
  /** "Prince", "Justicar", "1 vote"… A printed KRCG field, not parsed. */
  title: string | null;
  /** Path of Enlightenment, on the Sabbat V5 crypt and nowhere else. */
  path: string | null;
  advanced: boolean;
  poolCost: number | null;
  bloodCost: number | null;
  convictionCost: number | null;
  /** The cost when it is not a number — "X". */
  rawCost: string | null;
  burnOption: boolean;
  /** The date it was banned, when it was. */
  banned: string | null;
  text: string;
  flavor: string | null;
  artists: string[];
  /** Every set it has been printed in, oldest first. */
  sets: string[];
  /** ISO date of the earliest printing — what "sort by oldest" reads. */
  firstPrinted: string;
  /** static.krcg.org scan. */
  image: string;
  status: CatalogStatus;
}

/**
 * Code → English, for all 39 codes KRCG uses.
 *
 * The last seven are the imbued VIRTUES (Defense, Innocence, Judgment,
 * Martialism, Redemption, Vengeance, Vision), which share the field with
 * disciplines and are easy to misread as one: `ven` is Vengeance, not
 * Ventrue, and `viz` is Vision while `vis` is Visceratika. Getting either
 * pair backwards would silently mislabel a card and match the wrong
 * search, which is exactly the kind of near-miss no test would think to
 * look for.
 */
export const DISCIPLINE_NAMES: Record<string, string> = {
  abo: "Abombwe",
  ani: "Animalism",
  aus: "Auspex",
  cel: "Celerity",
  chi: "Chimerstry",
  dai: "Daimoinon",
  dem: "Dementation",
  dom: "Dominate",
  flight: "Flight",
  for: "Fortitude",
  mal: "Maleficia",
  mel: "Melpominee",
  myt: "Mytherceria",
  nec: "Necromancy",
  obe: "Obeah",
  obf: "Obfuscate",
  obl: "Oblivion",
  obt: "Obtenebration",
  pot: "Potence",
  pre: "Presence",
  pro: "Protean",
  qui: "Quietus",
  san: "Sanguinus",
  ser: "Serpentis",
  spi: "Spiritus",
  str: "Striga",
  tem: "Temporis",
  tha: "Thaumaturgy",
  thn: "Thanatosis",
  val: "Valeren",
  vic: "Vicissitude",
  vis: "Visceratika",
  def: "Defense",
  inn: "Innocence",
  jud: "Judgment",
  mar: "Martialism",
  red: "Redemption",
  ven: "Vengeance",
  viz: "Vision",
};

/** The seven imbued virtues, which are not disciplines (p. 6). */
export const VIRTUE_CODES = ["def", "inn", "jud", "mar", "red", "ven", "viz"];

export function disciplineName(code: string): string {
  return DISCIPLINE_NAMES[code] ?? code;
}

/**
 * What `catalog.json` holds: the cards, and the SETS as their own fact.
 *
 * The set dates are here rather than being derived from the cards
 * because they are not the same question, and the difference is
 * invisible until a set contains a reprint. A card's `firstPrinted` is
 * its earliest printing anywhere; a set's date is the set's. New Blood
 * III (2025) holds cards from 1994, so a "newest set first" list built
 * from the cards filed it behind a 2023 promo — correct-looking, wrong,
 * and caught only by asserting the ordering rather than eyeballing it.
 */
export interface CatalogFile {
  cards: CatalogCard[];
  /** Set name → its release date, ISO. */
  sets: Record<string, string>;
}

/**
 * The catalogue, fetched once and kept.
 *
 * The import is dynamic and the PROMISE is cached rather than its value:
 * two panels opening at once must not start two downloads, and a caller
 * that awaits twice must not see two arrays.
 */
let pending: Promise<CatalogFile> | null = null;

export function loadCatalog(): Promise<CatalogFile> {
  pending ??= import("./catalog.json").then((m) => (m.default ?? m) as unknown as CatalogFile);
  return pending;
}
