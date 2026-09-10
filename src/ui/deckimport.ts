/**
 * The deck importer (docs/deck-import-design.md) — phase 7.
 *
 * Takes a deck list pasted from a deck-building site and turns it into a
 * `DeckList` this client can deal, or tells the player exactly why it
 * cannot. The standing rule from CLAUDE.md is the whole brief: *"Deck
 * import must validate against the registry and report unsupported cards
 * to the user — never silently drop or break."*
 *
 * ONE PARSER FOR EVERY SITE. VDB, Amaranth, ARDB, JOL, Lackey and the TWD
 * archive all export the same thing underneath — a count and a name per
 * line, with headers and stat columns around it — and they disagree only
 * about the decoration. So instead of a parser per site, this reads the
 * count, then finds the LONGEST PREFIX of the rest that is a card in the
 * V5 pool. The registry does the work no format-specific parser could do
 * anyway: it says whether a name is a crypt card or a library card, so
 * section headers are optional rather than load-bearing.
 *
 * That also decides the failure mode. A line that resolves to nothing is
 * REPORTED with its text and its line number, never skipped — a deck that
 * silently lost a card would be a deck the player did not build.
 */

import registry from "../cards/registry.json";
import type { CardDef, CardRegistry, CryptCardDef, PreconDeck } from "../cards/types.ts";
import { importCryptCard } from "./cardinfo.ts";
import type { DeckList } from "./decks.ts";
import { cryptGroupProblem, MAX_LIBRARY, MIN_CRYPT, MIN_LIBRARY } from "./decks.ts";

const reg = registry as unknown as CardRegistry;

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/**
 * Names as a comparison sees them.
 *
 * Deck exports are typed, translated, copied through spreadsheets and
 * mangled by fonts, so a match cannot depend on any of that surviving:
 * case, accents (`Kuyén`, `Día de los Muertos`), curly quotes, the `™` on
 * Pentex, or how many spaces someone left in. What it MUST keep is the
 * letters, because two card names can differ by nothing else.
 */
function normalise(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents, after NFD splits them off
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[™®]/g, "") // ™ and ®: decoration, never meaning
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * KRCG suffixes a crypt name with its group, and marks an advanced
 * printing in the same parenthetical — "Ariane (G5)", "Alan Sovereign
 * (G3 ADV)". Deck lists usually print the group in its own column
 * instead, so the bare spelling has to resolve too.
 */
function stripCryptSuffix(name: string): string {
  return name.replace(/\s*\((?:g\s*\d+(?:\s+adv)?|adv)\)\s*$/i, "").trim();
}

/**
 * Does this written name ask for the ADVANCED printing?
 *
 * A BARE NAME MEANS THE BASE CARD, always. The advanced printing is a
 * separate card that every deck list marks explicitly (p. 6: "an advanced
 * card … has an Advanced icon under the clan icon"), and the two share a
 * group — so no amount of deck context could tell them apart. Treating a
 * bare name as ambiguous would reject lists that are perfectly clear;
 * treating it as the base card is what the writer meant.
 */
function wantsAdvanced(name: string): boolean {
  return /\badv\)?\s*$/i.test(name.trim());
}

const byName = new Map<string, CardDef>();
/**
 * Bare crypt name → every printing that could be meant.
 *
 * ONE NAME IS NO LONGER ONE CARD. While the pool was a single group range
 * a bare name was unique, and this map was a `CardDef` with a test
 * asserting no collisions. Widening the crypt past one group range breaks
 * that — 73 bare names cover 148 cards — so the ambiguity is carried
 * here and resolved against the deck being imported.
 * docs/pool-widening-design.md §5
 */
const cryptByBare = new Map<string, CryptCardDef[]>();
for (const entry of Object.values(reg.entries)) {
  const card = entry.card;
  byName.set(normalise(card.name), card);
  if (card.kind === "crypt") {
    const base = normalise(stripCryptSuffix(card.name));
    cryptByBare.set(base, [...(cryptByBare.get(base) ?? []), card]);
    if (!byName.has(base)) byName.set(base, card);
  }
}

const byId = new Map<number, CardDef>();
for (const entry of Object.values(reg.entries)) byId.set(entry.card.id, entry.card);

/**
 * Every card a written name could mean, best first.
 *
 * An exact spelling ("Ariane (G5)") names one card and is returned alone.
 * A bare name returns every printing of it that matches the advanced
 * marker the writer used — which is one card most of the time, and more
 * when the pool holds the same vampire in several groups.
 */
export function findCards(name: string): CardDef[] {
  const exact = byName.get(normalise(name));
  // An exact hit on the FULL name is unambiguous by construction: the
  // group (and the ADV marker) are part of it.
  if (exact && normalise(name) === normalise(exact.name)) return [exact];
  const bare = cryptByBare.get(normalise(stripCryptSuffix(name)));
  if (bare) {
    const adv = wantsAdvanced(name);
    const matching = bare.filter((c) => wantsAdvanced(c.name) === adv);
    if (matching.length > 0) return matching;
  }
  return exact ? [exact] : [];
}

/** Look up one exact name, in any of the spellings a site might use.
 *  Returns the first candidate when a bare name covers several — callers
 *  that need to know about the ambiguity use `findCards`. */
export function findCard(name: string): CardDef | null {
  return findCards(name)[0] ?? null;
}

/**
 * The longest run of leading words that names a card.
 *
 * This is what lets one parser read every format: ARDB and VDB pad a crypt
 * line out with capacity, disciplines and clan (`Ariane  3  cel pot pre
 * Brujah:5`), JOL and Lackey print the name alone, and none of them agree
 * on the separator. Matching longest-first matters — a shorter card name
 * can be the prefix of a longer one, and the longer one is the real card.
 */
function resolveLine(rest: string): CardDef[] {
  const words = rest.split(/\s+/).filter(Boolean);
  for (let take = words.length; take > 0; take--) {
    const hits = findCards(words.slice(0, take).join(" "));
    if (hits.length > 0) return hits;
  }
  return [];
}

/**
 * Pick one printing out of several, using the crypt already resolved.
 *
 * The rule that makes this safe is the group rule itself (p. 4): a crypt
 * uses one group or two consecutive ones, so once any unambiguous vampire
 * has been read, the deck's group range is known and a bare name that
 * only fits one of its printings is not a guess — it is the only reading
 * that produces a legal deck.
 *
 * Returns null when the context does not settle it, and the caller
 * reports the ambiguity rather than choosing. A deck importer that
 * guesses builds a deck the player did not.
 */
function narrowByGroup(candidates: CardDef[], known: Set<number>): CardDef | null {
  if (candidates.length === 1) return candidates[0]!;
  if (known.size === 0) return null;
  const fits = candidates.filter((c) => {
    if (c.kind !== "crypt" || typeof c.group !== "number") return true;
    // Legal beside every group already seen, which for a span of two
    // means within one of both ends.
    return [...known].every((g) => Math.abs(g - (c.group as number)) <= 1);
  });
  return fits.length === 1 ? fits[0]! : null;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface ImportedCard {
  id: number;
  name: string;
  copies: number;
}

export interface ImportProblem {
  /** 1-based line number in the pasted text, so the player can find it. */
  line: number;
  text: string;
  reason: string;
}

export interface ImportReport {
  /** True when the deck can actually be played as imported. */
  ok: boolean;
  deckName: string | null;
  crypt: ImportedCard[];
  library: ImportedCard[];
  cryptCount: number;
  libraryCount: number;
  /** Lines that named no card in the V5 pool. FATAL — a card that is not
   *  in the pool cannot be dealt, and dropping it would change the deck. */
  unknown: ImportProblem[];
  /** Cards in the pool whose effects are not implemented. FATAL: playing
   *  them would silently do nothing. (The library is at 444/444, so this
   *  only bites once the pool is widened.) */
  unsupported: ImportedCard[];
  /** Vampires whose printed ability is not implemented. NOT fatal — the
   *  vampire is a real card with real stats and the game plays fine; the
   *  player is told so a game is never misled. */
  inertAbilities: string[];
  /** Deck-construction problems (rulebook p. 4 and p. 14). FATAL. */
  illegal: string[];
  /** The crypt groups the deck uses, in order. */
  groups: Array<number | "ANY">;
}

/**
 * The group rule, for the report — the verdict comes from
 * `cryptGroupProblem` in decks.ts, which is the ONE place the rule lives.
 *
 * This used to carry its own copy of the arithmetic, and a second copy
 * was very nearly added beside `validateDecks`'s other p. 14 checks. One
 * question asked in two places will drift, and this one had already been
 * asked twice.
 */
function groupProblem(cards: CryptCardDef[]): { problem: string | null; groups: Array<number | "ANY"> } {
  const seen = new Set<number | "ANY">();
  for (const c of cards) seen.add(c.group);
  const groups = [...seen].sort((a, b) =>
    a === "ANY" ? 1 : b === "ANY" ? -1 : (a as number) - (b as number),
  );
  return { problem: cryptGroupProblem([...seen]), groups };
}

/** "Deck Name: X" / "Name: X", however the site spells it. */
function findDeckName(lines: string[]): string | null {
  for (const raw of lines) {
    const m = /^\s*(?:deck\s*)?name\s*[:=]\s*(.+?)\s*$/i.exec(raw);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Read a pasted deck list.
 *
 * `seat` is who will play it. A deck does not know where it sits — that is
 * the lobby's business — but `DeckList` carries the seat, so the caller
 * says which one.
 */
export function importDeck(text: string, seat: string): { deck: DeckList | null; report: ImportReport } {
  const lines = text.split(/\r?\n/);
  const crypt: ImportedCard[] = [];
  const library: ImportedCard[] = [];
  const cryptDefs: CryptCardDef[] = [];
  const unknown: ImportProblem[] = [];
  const unsupported: ImportedCard[] = [];
  const inert = new Set<string>();
  const counted = new Map<number, ImportedCard>();

  // TWO PASSES, because a bare crypt name can only be read once the
  // deck's group range is known, and that range comes from the lines that
  // were unambiguous. Pass one resolves everything it can and records the
  // groups; pass two settles what is left against them, and reports what
  // it still cannot settle. docs/pool-widening-design.md §5
  const deferred: Array<{ line: number; text: string; copies: number; candidates: CardDef[] }> = [];
  const knownGroups = new Set<number>();

  /** Record one resolved card. Shared by both passes so a deferred line
   *  lands exactly as an immediate one would. */
  const take = (card: CardDef, copies: number): void => {
    const already = counted.get(card.id);
    if (already) {
      already.copies += copies;
      return;
    }
    const item: ImportedCard = { id: card.id, name: card.name, copies };
    counted.set(card.id, item);
    if (card.kind === "crypt") {
      crypt.push(item);
      cryptDefs.push(card);
      if (typeof card.group === "number") knownGroups.add(card.group);
      if (importCryptCard(card.id).hasUnimplementedAbility) inert.add(card.name);
    } else {
      library.push(item);
      if (!(reg.entries[card.id]?.supported ?? false)) unsupported.push(item);
    }
  };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    // A deck line starts with a count. Everything else — titles, section
    // headers, "Crypt (12 cards)", author notes — does not, and is not a
    // failure to report: it was never claiming to be a card.
    // "2 Name", "2x Name", "2 x Name", "2. Name", "2 - Name", "2<tab>Name".
    // The punctuation separator must be FOLLOWED BY WHITESPACE, or the
    // pattern eats the first character of a card whose name begins with
    // one: `.44 Magnum` imported as "44 Magnum" and was reported as not
    // being in the pool. Found by round-tripping a real precon.
    const m = /^(\d+)\s*(?:x\b)?\s*(?:[:.\-]\s+)?\s*(.+)$/i.exec(line);
    if (!m) return;
    const copies = Number(m[1]);
    const rest = (m[2] ?? "").trim();
    if (!Number.isFinite(copies) || copies <= 0 || rest === "") return;

    const candidates = resolveLine(rest);
    if (candidates.length === 0) {
      unknown.push({
        line: i + 1,
        text: line,
        reason: "no card of that name is in the V5 pool",
      });
      return;
    }
    if (candidates.length > 1) {
      // Several printings share this name. Hold it for pass two, when the
      // deck's own group range is known.
      deferred.push({ line: i + 1, text: line, copies, candidates });
      return;
    }
    // The same card can be listed twice (some exports split by card type);
    // `take` folds the counts rather than emitting it twice.
    take(candidates[0]!, copies);
  });

  // Pass two: settle the held lines against the groups pass one found.
  for (const d of deferred) {
    const picked = narrowByGroup(d.candidates, knownGroups);
    if (picked) {
      take(picked, d.copies);
      continue;
    }
    unknown.push({
      line: d.line,
      text: d.text,
      reason: `several cards are called that — write the group, e.g. ${d.candidates
        .slice(0, 3)
        .map((c) => `"${c.name}"`)
        .join(" or ")}`,
    });
  }

  const cryptCount = crypt.reduce((n, c) => n + c.copies, 0);
  const libraryCount = library.reduce((n, c) => n + c.copies, 0);

  const illegal: string[] = [];
  if (cryptCount < MIN_CRYPT) {
    illegal.push(`crypt has ${cryptCount} cards; at least ${MIN_CRYPT} are needed (p. 14)`);
  }
  if (libraryCount < MIN_LIBRARY || libraryCount > MAX_LIBRARY) {
    illegal.push(
      `library has ${libraryCount} cards; it must hold between ${MIN_LIBRARY} and ${MAX_LIBRARY} (p. 14)`,
    );
  }
  const { problem, groups } = groupProblem(cryptDefs);
  if (problem) illegal.push(problem);

  const report: ImportReport = {
    ok: unknown.length === 0 && unsupported.length === 0 && illegal.length === 0,
    deckName: findDeckName(lines),
    crypt,
    library,
    cryptCount,
    libraryCount,
    unknown,
    unsupported,
    inertAbilities: [...inert].sort(),
    illegal,
    groups,
  };

  return { deck: report.ok ? toDeckList(seat, crypt, library) : null, report };
}

/** Expand counts into the one-entry-per-copy shape a `DeckList` holds. */
function toDeckList(seat: string, crypt: ImportedCard[], library: ImportedCard[]): DeckList {
  const out: DeckList = { kind: "deck", seat, crypt: [], library: [] };
  for (const c of crypt) {
    for (let i = 0; i < c.copies; i++) out.crypt.push({ id: c.id });
  }
  for (const c of library) {
    for (let i = 0; i < c.copies; i++) out.library.push(c.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What this client can play — the answer the importer screen has to show
// ---------------------------------------------------------------------------

/** The sets whose cards this client knows, straight from the registry. */
export function supportedSets(): string[] {
  return [...reg.pool];
}

export interface PreconSummary {
  set: string;
  name: string;
  cryptCount: number;
  libraryCount: number;
  /** Library cards in it that are not implemented. Empty today. */
  unsupported: string[];
  /** Legal as a standalone deck (p. 14). The New Blood starters are not:
   *  they are half-size on purpose. */
  playable: boolean;
  /** Why not, when it is not. */
  problems: string[];
}

/**
 * Every preconstructed deck in the pool, and whether this client can play
 * it as printed. Derived from the registry's precon table, which is itself
 * derived from the KRCG snapshot — so this list cannot drift from the
 * cards, and widening the pool grows it with no code change.
 */
export function supportedPrecons(): PreconSummary[] {
  return reg.precons.map((p) => summarisePrecon(p));
}

function summarisePrecon(p: PreconDeck): PreconSummary {
  let cryptCount = 0;
  let libraryCount = 0;
  const unsupported: string[] = [];
  const cryptDefs: CryptCardDef[] = [];
  for (const { id, copies } of p.cards) {
    const card = byId.get(id);
    if (!card) continue;
    if (card.kind === "crypt") {
      cryptCount += copies;
      cryptDefs.push(card);
    } else {
      libraryCount += copies;
      if (!(reg.entries[id]?.supported ?? false)) unsupported.push(card.name);
    }
  }
  const problems: string[] = [];
  if (cryptCount < MIN_CRYPT) problems.push(`only ${cryptCount} crypt cards`);
  if (libraryCount < MIN_LIBRARY) problems.push(`only ${libraryCount} library cards`);
  if (libraryCount > MAX_LIBRARY) problems.push(`${libraryCount} library cards`);
  const { problem } = groupProblem(cryptDefs);
  if (problem) problems.push(problem);
  if (unsupported.length > 0) problems.push(`${unsupported.length} cards not implemented`);
  return {
    set: p.set,
    name: p.name,
    cryptCount,
    libraryCount,
    unsupported: unsupported.sort(),
    playable: problems.length === 0,
    problems,
  };
}

/** A precon as a dealable deck, for a lobby that offers ready-made ones. */
export function preconDeck(set: string, name: string, seat: string): DeckList | null {
  const p = reg.precons.find((d) => d.set === set && d.name === name);
  if (!p) return null;
  const out: DeckList = { kind: "deck", seat, crypt: [], library: [] };
  for (const { id, copies } of p.cards) {
    const card = byId.get(id);
    if (!card) continue;
    for (let i = 0; i < copies; i++) {
      if (card.kind === "crypt") out.crypt.push({ id: card.id });
      else out.library.push(card.name);
    }
  }
  return out;
}

/**
 * A one-line play-style note for each preconstructed deck.
 *
 * Keyed on the deck's NAME rather than on set+name, because the New Blood
 * starters are the same clan and the same plan as their Fifth Edition
 * counterparts at half the size — so one line serves both, and a note
 * that drifted between the two would be worse than none.
 *
 * These describe how a deck WANTS to win, in the three verbs the game
 * actually has: bleed your prey's pool away, fight their minions, or call
 * referendums. Written against what is in each deck rather than clan
 * flavour; a player picking blind should be able to tell a combat deck
 * from a vote deck without reading 60 cards.
 */
const PRECON_STYLE: Record<string, string> = {
  // --- Fifth Edition ---
  Hecata: "Steady bleed backed by blood theft — drains your prey while topping its own vampires up.",
  Lasombra: "Stealth bleed with hard removal; slips past blockers and answers the ones it cannot.",
  Malkavian: "Bleed and misdirection — cheap stealth, and reactions that send bleeds somewhere else.",
  Nosferatu: "Defensive and grindy: high intercept, big blockers, and a slow squeeze on your prey.",
  Toreador: "Votes and presence — builds a titled crypt and wins referendums while bleeding for extra.",
  Tremere: "Blood magic control: unblockable damage, pool burn and answers to almost anything.",
  Ventrue: "The classic vote deck — princes and justicars, political actions, and a fat bleed behind them.",
  // --- Anarch ---
  "Banu Haqim": "Assassins: rushes your prey's minions down and bleeds through the gap they leave.",
  Brujah: "Aggressive Anarch beatdown — cheap vampires, rushes, and pressure from turn one.",
  Gangrel: "Animal-backed combat with a big ready crypt; fights well and blocks better.",
  Ministry: "Corruption and temptation — takes over minions, and bleeds hard once the way is clear.",
  // --- Companion ---
  Ravnos: "Trickery and swings of fortune: cheap effects, stolen resources, and a fast unpredictable bleed.",
  Salubri: "Healing and defence — survives the fights it is dragged into, then wins on attrition.",
  Tzimisce: "Fleshcraft and monsters: enormous combat vampires and allies that grind a table down.",
  // --- Sabbat V5 (the four Paths) ---
  "Path of Caine": "Sabbat scholars: blood magic, rituals and a patient bleed while the table fights.",
  "Path of Cathari": "Indulgence and pressure — corruption counters, stealth, and a bleed that grows.",
  // Read off the deck rather than the flavour: Govern, shadow stealth and
  // Telepathic Misdirection say "bleed", and the wraiths are the bodies
  // that block for it.
  "Path of Death":
    "Shadowed bleed with wraith allies — slips actions past blockers and blocks well in turn.",
  "Path of Power and the Inner Voice":
    "Sabbat politics — archbishops and cardinals calling referendums, with muscle to back them.",
};

/** The play-style line for a precon, or null if there is none written. */
export function preconStyle(name: string): string | null {
  return PRECON_STYLE[name] ?? null;
}
