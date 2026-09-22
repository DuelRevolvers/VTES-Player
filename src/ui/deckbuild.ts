/**
 * The deck builder (docs/deck-builder-design.md §5).
 *
 * A draft is a BAG OF COUNTS — card id to copies — and nothing else. It
 * is not a `DeckList`, not a `SnapshotDeck` and not a third model of a
 * deck: it serialises to the very text `importDeck` already reads, so a
 * deck built here is saved by the same `saveDeck`, into the same store,
 * and is picked in the lobby exactly like one that was pasted in. That is
 * the whole architectural trick, and it is what keeps this file free of
 * engine concerns.
 *
 * Everything here is pure. The rules it applies are NOT restated: the
 * minimums and the group rule live in `decks.ts` and are imported, so the
 * builder cannot come to a different answer about legality than the
 * lobby does (CLAUDE.md, "one question asked in two places will drift").
 */

import type { CatalogCard, CatalogFile } from "../cards/catalog.ts";
import { cryptGroupProblem, MAX_LIBRARY, MIN_CRYPT, MIN_LIBRARY } from "./decks.ts";
import { findHalfDeck } from "./deckimport.ts";
import { withinScope } from "./cardsearch.ts";

/**
 * A deck being edited.
 *
 * `counts` never holds a zero — removing the last copy deletes the key,
 * so "is this card in the deck" is one question (`id in counts`) rather
 * than two.
 */
export interface DeckDraft {
  name: string;
  counts: Record<number, number>;
  /**
   * Half a deck ON PURPOSE (owner request, 2026-09-22).
   *
   * A New Blood starter prints six crypt cards and about fifty library
   * cards, and the platform has always been able to DEAL one. What it
   * could not do was let you BUILD one: the exemption was matched on
   * `kind === "precon"`, so anything you made yourself was measured
   * against p. 14's minimums whatever you meant by it.
   *
   * It is a DECLARATION, not a deduction. A deck that is short because
   * it is a starter and a deck that is short because it is unfinished
   * look exactly the same from the counts, and guessing would silently
   * excuse the second. So the builder asks, the answer is written into
   * the deck's own text, and the screen labels it everywhere.
   */
  halfDeck: boolean;
  /**
   * The saved deck this was opened from, so Save overwrites it instead of
   * leaving a second copy behind. Null for a deck that has never been
   * saved — including one started from a precon, because a precon is a
   * PRINTED deck and editing it makes something new rather than changing
   * what came in the box.
   */
  savedAs: string | null;
}

export function emptyDraft(name = "", halfDeck = false): DeckDraft {
  return { name, counts: {}, halfDeck, savedAs: null };
}

/** Total copies in the draft, crypt and library kept apart. */
export interface DraftCounts {
  crypt: number;
  library: number;
}

/**
 * How a library card list is ordered on screen.
 *
 * The conventional VTES decklist order, which is neither alphabetical nor
 * the registry's: a reader scanning a list wants the engine of the deck
 * (masters, then what it DOES) before its defences.
 */
export const LIBRARY_TYPE_ORDER = [
  "Master",
  "Action",
  "Political Action",
  "Action Modifier",
  "Combat",
  "Reaction",
  "Ally",
  "Equipment",
  "Retainer",
  "Event",
];

/**
 * The one type a library card is filed under.
 *
 * A card can print two ("Action Modifier/Reaction" is common), and a
 * decklist files it once. The FIRST match in the conventional order wins,
 * so a card is always in the same section rather than moving depending on
 * which type the data happened to list first.
 */
export function sectionOf(card: CatalogCard): string {
  for (const t of LIBRARY_TYPE_ORDER) if (card.types.includes(t)) return t;
  return card.types[0] ?? "Other";
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Add or remove copies, and never go below zero.
 *
 * THERE IS NO UPPER BOUND, and that is the rule, not an omission: p. 14
 * says "A Methuselah can include any number of copies of a given card in
 * either their library or crypt". Deck builders routinely invent a limit
 * here — this one must not, because a Ventrue deck really does run twelve
 * Govern the Unaligned.
 */
export function withCard(draft: DeckDraft, id: number, delta: number): DeckDraft {
  const now = (draft.counts[id] ?? 0) + delta;
  const counts = { ...draft.counts };
  if (now > 0) counts[id] = now;
  else delete counts[id];
  return { ...draft, counts };
}

export function setCount(draft: DeckDraft, id: number, copies: number): DeckDraft {
  return withCard(draft, id, copies - (draft.counts[id] ?? 0));
}

/** Every card in the draft, resolved, with its copies. Unknown ids drop. */
export function draftCards(
  draft: DeckDraft,
  byId: Map<number, CatalogCard>,
): Array<{ card: CatalogCard; copies: number }> {
  const out: Array<{ card: CatalogCard; copies: number }> = [];
  for (const [key, copies] of Object.entries(draft.counts)) {
    const card = byId.get(Number(key));
    if (card) out.push({ card, copies });
  }
  return out;
}

export function countsOf(rows: Array<{ card: CatalogCard; copies: number }>): DraftCounts {
  let crypt = 0;
  let library = 0;
  for (const { card, copies } of rows) {
    if (card.kind === "crypt") crypt += copies;
    else library += copies;
  }
  return { crypt, library };
}

// ---------------------------------------------------------------------------
// Is it legal? Is it playable HERE? Two different questions.
// ---------------------------------------------------------------------------

export interface DraftReview {
  counts: DraftCounts;
  /**
   * Rules failures (p. 14, p. 4). This deck cannot be played at a table
   * by anybody, with any software.
   */
  illegal: string[];
  /**
   * Legal, but worth knowing. The rulebook's OWN word for the duplicate-
   * unique case is "CAUTION" (p. 14), and a tournament ban is not a rule
   * of the game at all — the word "banned" appears nowhere in the
   * rulebook. Neither may be reported as illegality.
   */
  cautions: string[];
  /** Cards this platform cannot deal, with how many copies. */
  unplayable: Array<{ card: CatalogCard; copies: number }>;
  /** Vampires whose printed ability is not implemented. Never fatal. */
  inert: string[];
  /** Every discipline the crypt actually has, as codes. */
  cryptDisciplines: string[];
  /**
   * Library cards in the deck that NO vampire in the crypt can play
   * (owner request, 2026-09-22).
   *
   * Never illegal — the rules do not stop you putting a Dominate card in
   * a Gangrel deck, they just make sure you regret it. It is the single
   * most common way a real deck is quietly broken, which is why it is
   * reported by name rather than left for a playtest to discover.
   */
  offDiscipline: Array<{ card: CatalogCard; copies: number }>;
  /**
   * The two minimums were waived because this deck declares itself half
   * a deck. Carried on the review so the screen can SAY so — "legal"
   * with the minimums silently skipped would be the one reading nobody
   * should have to guess at.
   */
  halfDeck: boolean;
  /** Legal by the rules of the game. */
  legal: boolean;
  /** …and this platform can actually deal every card in it. */
  dealable: boolean;
}

/**
 * Is a duplicated card one the rulebook cautions about?
 *
 * A vampire is unique unless it says otherwise — five in the whole game
 * print "Non-unique" (Aabbt Kindred, Fida'i, Grotesque, The Horde and
 * one more), which is why this is a negative test rather than a list. A
 * library card is unique only when it says "Unique." (554 of them).
 */
export function isUnique(card: CatalogCard): boolean {
  if (card.kind === "crypt") return !/non-unique/i.test(card.text);
  return /(^|[^-\w])unique\b/i.test(card.text);
}

export function reviewDraft(draft: DeckDraft, byId: Map<number, CatalogCard>): DraftReview {
  const rows = draftCards(draft, byId);
  const counts = countsOf(rows);
  const illegal: string[] = [];
  const cautions: string[] = [];

  // p. 14. There is deliberately NO upper bound on the crypt: "There is
  // no maximum limit on the number of cards Methuselahs can have in
  // their crypt."
  //
  // A HALF DECK IS EXEMPT FROM THE TWO MINIMUMS AND NOTHING ELSE. The
  // maximum below, the group rule and every playability check still
  // apply — the same list of what the exemption does not cover that
  // `validateDecks` states for a half-deck seat (decks.ts).
  if (counts.crypt < MIN_CRYPT && !draft.halfDeck) {
    illegal.push(
      `The crypt has ${counts.crypt} card${counts.crypt === 1 ? "" : "s"}; ` +
        `at least ${MIN_CRYPT} are needed (p. 14).`,
    );
  }
  if (counts.library < MIN_LIBRARY && !draft.halfDeck) {
    illegal.push(
      `The library has ${counts.library} cards; at least ${MIN_LIBRARY} are needed (p. 14).`,
    );
  } else if (counts.library > MAX_LIBRARY) {
    illegal.push(
      `The library has ${counts.library} cards; at most ${MAX_LIBRARY} are allowed (p. 14).`,
    );
  }

  // p. 4, through the SAME helper the lobby validates with.
  const groupProblem = cryptGroupProblem(
    rows
      .filter((r) => r.card.kind === "crypt" && r.card.group !== null)
      .map((r) => r.card.group!),
  );
  if (groupProblem) illegal.push(`${groupProblem[0]!.toUpperCase()}${groupProblem.slice(1)}.`);

  const dupes = rows.filter((r) => r.copies > 1 && isUnique(r.card));
  if (dupes.length > 0) {
    cautions.push(
      `${dupes.length} unique card${dupes.length === 1 ? " is" : "s are"} in here more than ` +
        `once (${dupes.map((d) => `${d.card.name} ×${d.copies}`).join(", ")}). ` +
        `That is legal, but you can only control one at a time (p. 14).`,
    );
  }

  const banned = rows.filter((r) => r.card.banned);
  if (banned.length > 0) {
    cautions.push(
      `${banned.map((b) => b.card.name).join(", ")} ` +
        `${banned.length === 1 ? "is" : "are"} banned in VEKN tournament play. ` +
        `That is a tournament restriction, not a rule of the game — this deck is ` +
        `still legal and still plays here.`,
    );
  }

  // WHAT THE CRYPT CAN ACTUALLY PLAY. Read off the vampires in the deck,
  // never from their clans: a Malkavian with Dominate is a real card and
  // a clan's "usual" disciplines are a guideline, not a fact about this
  // crypt.
  const scope = new Set(
    rows.filter((r) => r.card.kind === "crypt").flatMap((r) => r.card.disciplines),
  );
  // Only worth asking once there IS a crypt — with none, every
  // discipline card in the deck would be reported and the warning would
  // be noise on a deck that is simply unfinished.
  const offDiscipline =
    scope.size === 0
      ? []
      : rows.filter((r) => r.card.kind === "library" && !withinScope(r.card, scope));
  // NOT pushed onto `cautions`. It stays structured because the screen
  // offers a button that acts on it, and because the alternative — the
  // screen fishing this one sentence back out of a list of strings by
  // matching on its words — is a vocabulary kept in a regex, which is a
  // list nobody greps (CLAUDE.md).

  const unplayable = rows.filter((r) => r.card.status !== "playable");
  const inert = rows
    .filter((r) => r.card.kind === "crypt" && r.card.status === "pool")
    .map((r) => r.card.name);

  return {
    counts,
    illegal,
    cautions,
    unplayable,
    inert,
    cryptDisciplines: [...scope].sort(),
    offDiscipline,
    halfDeck: draft.halfDeck,
    legal: illegal.length === 0,
    dealable: illegal.length === 0 && unplayable.length === 0,
  };
}

// ---------------------------------------------------------------------------
// To text and back
// ---------------------------------------------------------------------------

/**
 * The draft as a deck list — the format `importDeck` reads.
 *
 * Section headers and counts in brackets are written for a HUMAN reading
 * the saved text; the importer ignores every line that does not start
 * with a number, so they cost nothing. The card name is written exactly
 * as the catalogue holds it, disambiguator and all ("Anneke (G4)"),
 * because that is also exactly what the registry holds — so the round
 * trip is an identity rather than a re-resolution that could pick a
 * different vampire of the same name.
 */
export function draftToText(draft: DeckDraft, byId: Map<number, CatalogCard>): string {
  const rows = draftCards(draft, byId);
  const counts = countsOf(rows);
  const lines: string[] = [];
  if (draft.name.trim() !== "") lines.push(`Deck Name: ${draft.name.trim()}`);
  // THE DECLARATION TRAVELS WITH THE DECK. It is written next to the
  // name because that is the only place it survives everything a deck
  // goes through — saved as text, re-read as text, handed to the lobby
  // as text, pasted into a forum post and back. `findHalfDeck` in
  // deckimport.ts is what reads it at the other end.
  if (draft.halfDeck) lines.push(`Half deck: yes`);
  if (lines.length > 0) lines.push("");

  const crypt = rows
    .filter((r) => r.card.kind === "crypt")
    .sort(
      (a, b) =>
        (b.card.capacity ?? 0) - (a.card.capacity ?? 0) ||
        a.card.name.localeCompare(b.card.name, "en"),
    );
  lines.push(`Crypt (${counts.crypt} cards)`);
  for (const r of crypt) lines.push(`${r.copies}x ${r.card.name}`);

  lines.push("", `Library (${counts.library} cards)`);
  const library = rows.filter((r) => r.card.kind === "library");
  for (const type of LIBRARY_TYPE_ORDER) {
    const inType = library
      .filter((r) => sectionOf(r.card) === type)
      .sort((a, b) => a.card.name.localeCompare(b.card.name, "en"));
    if (inType.length === 0) continue;
    const n = inType.reduce((acc, r) => acc + r.copies, 0);
    lines.push("", `${type} (${n})`);
    for (const r of inType) lines.push(`${r.copies}x ${r.card.name}`);
  }
  return lines.join("\n");
}

/**
 * Read a deck list back into a draft, AGAINST THE CATALOGUE.
 *
 * Deliberately not `importDeck`, which resolves against the REGISTRY —
 * it would report every card this platform cannot deal as an unknown
 * line and drop it. A draft may legitimately contain those (the owner's
 * call, 2026-09-22: build your real paper deck and be told what is
 * missing), so reopening a saved deck must not silently delete them.
 *
 * Lines that name nothing are returned rather than thrown away, so the
 * screen can say which ones it could not read.
 */
export function parseDraft(
  text: string,
  byName: Map<string, CatalogCard>,
): { draft: DeckDraft; unreadable: string[] } {
  const draft = emptyDraft();
  const unreadable: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const named = /^Deck Name:\s*(.+)$/i.exec(line);
    if (named) {
      draft.name = named[1]!.trim();
      continue;
    }
    // Read through the SAME function the importer uses, on this one
    // line, rather than a second regex that agrees with it today. The
    // two must never disagree about what declares a half deck.
    if (/^half[\s-]*deck\s*[:=]/i.test(line)) {
      draft.halfDeck = findHalfDeck([line]);
      continue;
    }
    // The same shapes the importer accepts: "2 Name", "2x Name",
    // "2 x Name", "2. Name", "2 - Name", "2<tab>Name".
    const m = /^(\d+)\s*(?:x|\.|-)?\s+(.+)$/i.exec(line);
    // Not a claim to be a card — a section header, a title, a note.
    if (!m) continue;
    const copies = Number(m[1]);
    const name = m[2]!.trim();
    const card = byName.get(name.toLowerCase());
    if (!card) {
      unreadable.push(line);
      continue;
    }
    draft.counts[card.id] = (draft.counts[card.id] ?? 0) + copies;
  }
  return { draft, unreadable };
}

/** Index the catalogue once, for everything above. */
export function indexCatalog(file: CatalogFile): {
  byId: Map<number, CatalogCard>;
  byName: Map<string, CatalogCard>;
} {
  const byId = new Map<number, CatalogCard>();
  const byName = new Map<string, CatalogCard>();
  for (const c of file.cards) {
    byId.set(c.id, c);
    byName.set(c.name.toLowerCase(), c);
    // The printed name too, so a list written by hand ("Anneke") finds a
    // card the catalogue calls "Anneke (G4)" — but never OVERWRITING a
    // full name, which is the more specific answer.
    const printed = c.printedName.toLowerCase();
    if (!byName.has(printed)) byName.set(printed, c);
  }
  return { byId, byName };
}
