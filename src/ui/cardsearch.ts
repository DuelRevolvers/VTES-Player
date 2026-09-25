/**
 * The card search (docs/deck-builder-design.md §3).
 *
 * Every card in the game, findable, with what this platform can do with
 * it written on it. It is the reference half of the Deck Builder; the
 * building half is §5 and is not built yet.
 *
 * SHAPE, and why: this file is a pure function of a catalogue and a
 * query, plus functions that turn the answer into markup. Nothing here
 * touches the DOM or `localStorage`, for the same reason `render.ts`
 * does not — the shell has no jsdom in its tests, so anything that
 * reaches for a document is a thing that cannot be tested, and the
 * interesting half of a search is exactly the half a screenshot would
 * not show you: what it EXCLUDES. `tests/ui/cardsearch.test.ts` asserts
 * the negative space (CLAUDE.md, "Tests that lie").
 */

import type { CatalogCard, CatalogFile, CatalogStatus } from "../cards/catalog.ts";
import { disciplineName, VIRTUE_CODES } from "../cards/catalog.ts";
import { scanUrl } from "./localcards.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** How the results are drawn. Card pictures, or card facts. */
export type CardView = "grid" | "list";

export type SortKey = "name" | "capacity" | "cost" | "oldest" | "newest";

/** Which way a NUMERIC sort runs. Ignored by the others — see `SORTS_WITH_DIRECTION`. */
export type SortDir = "asc" | "desc";

/**
 * The sorts a direction means anything for.
 *
 * Name has a conventional direction and "oldest"/"newest" ARE the two
 * directions of one sort, so offering a second control for them would be
 * offering the same choice twice and letting the two disagree.
 */
export const SORTS_WITH_DIRECTION: SortKey[] = ["capacity", "cost"];

/** Which part of a card the typed words are matched against. */
export type SearchScope = "any" | "name" | "text";

export interface CardQuery {
  /** What was typed in the bar. Empty means "everything". */
  text: string;
  scope: SearchScope;
  /** "any" | "crypt" | "library" — the pile, not the type. */
  pile: "any" | "crypt" | "library";
  /** Card types, verbatim: "Vampire", "Master", "Political Action"… */
  types: string[];
  clans: string[];
  /** Discipline/virtue CODES. */
  disciplines: string[];
  /** Must a card have all the ticked disciplines, or any one of them? */
  disciplineMode: "any" | "all";
  sects: string[];
  titles: string[];
  sets: string[];
  /** Crypt groups, as strings, because "ANY" is one of them. */
  groups: string[];
  capacityMin: number | null;
  capacityMax: number | null;
  /** Pool or blood — whichever the card charges. */
  costMin: number | null;
  costMax: number | null;
  /** "any", or only what this platform plays, or only what it does not. */
  status: "any" | CatalogStatus;
  sort: SortKey;
  sortDir: SortDir;
  /**
   * Keep library cards to what a crypt can actually play — its
   * disciplines, its clans and its sects.
   *
   * Null means "do not". The deck builder sets it from the vampires in
   * the draft (owner request, 2026-09-22; clans and sects added the same
   * day). It is NOT the same question as the `disciplines`/`clans`
   * filters above: those keep cards that REQUIRE one of the ticked
   * values, this keeps cards that require NOTHING YOU HAVEN'T GOT —
   * which includes every card that requires nothing at all.
   */
  withinCrypt: { disciplines: string[]; clans: string[]; sects: string[] } | null;
}

/** The Build tab's starting query: only cards this player can deal. */
export function builderDefaultQuery(): CardQuery {
  return { ...emptyQuery(), status: "playable" };
}

export function emptyQuery(): CardQuery {
  return {
    text: "",
    scope: "any",
    pile: "any",
    types: [],
    clans: [],
    disciplines: [],
    disciplineMode: "any",
    sects: [],
    titles: [],
    sets: [],
    groups: [],
    capacityMin: null,
    capacityMax: null,
    costMin: null,
    costMax: null,
    status: "any",
    sort: "name",
    sortDir: "asc",
    withinCrypt: null,
  };
}

/**
 * What a crypt can bring to a library card: its disciplines, its clans
 * and its sects.
 */
export interface CryptScope {
  disciplines: ReadonlySet<string>;
  clans: ReadonlySet<string>;
  sects: ReadonlySet<string>;
}

/** Why a card is out of scope, in the words the screen uses. */
export type ScopeMiss = "discipline" | "clan" | "sect";

/**
 * What this card needs that the crypt has not got — or null if it can be
 * played.
 *
 * EVERY REQUIREMENT IS "ANY ONE OF", and each is checked separately.
 * A card's disciplines, clans and sects are three independent gates
 * (p. 10): a card listing three disciplines is satisfied by any one of
 * them, and a card that also names a clan must satisfy that too.
 *
 * An EMPTY requirement is not a gate. That is the case that makes this a
 * filter rather than a way of hiding most of the library — the majority
 * of cards ask for nothing, and `requiresClans` is deliberately empty on
 * all 179 masters that merely carry a clan icon.
 *
 * An empty SCOPE is not a gate either: a crypt with no sects (or a
 * search run before any vampire is added) must not hide every card that
 * names one.
 */
export function scopeMiss(card: CatalogCard, scope: CryptScope): ScopeMiss | null {
  if (card.kind === "crypt") return null;
  const missing = (need: string[], have: ReadonlySet<string>): boolean =>
    need.length > 0 && have.size > 0 && !need.some((n) => have.has(n));
  if (missing(card.disciplines, scope.disciplines)) return "discipline";
  if (missing(card.requiresClans, scope.clans)) return "clan";
  if (missing(card.requiresSects, scope.sects)) return "sect";
  return null;
}

export function withinScope(card: CatalogCard, scope: CryptScope): boolean {
  return scopeMiss(card, scope) === null;
}

/** The query's plain-array scope as the sets `scopeMiss` compares against. */
export function asScope(lists: {
  disciplines: string[];
  clans: string[];
  sects: string[];
}): CryptScope {
  return {
    disciplines: new Set(lists.disciplines),
    clans: new Set(lists.clans),
    sects: new Set(lists.sects),
  };
}

/** The scope a set of crypt cards provides. */
export function scopeOf(crypt: CatalogCard[]): CryptScope {
  return {
    disciplines: new Set(crypt.flatMap((c) => c.disciplines)),
    clans: new Set(crypt.flatMap((c) => c.clans)),
    // A vampire's sect is a single value, and some legacy vampires print
    // none at all.
    sects: new Set(crypt.map((c) => c.sect).filter((s): s is string => s !== null)),
  };
}

/** True when nothing at all is set — neither the text nor a filter. */
export function queryIsEmpty(q: CardQuery): boolean {
  return q.text.trim() === "" && filtersAreDefault(q);
}

/**
 * True when no FILTER is set, whatever has been typed.
 *
 * A separate question from `queryIsEmpty`, and the "Clear filters" button
 * asks this one. It has to: typing does not repaint the screen (the caret
 * would not survive it), so a button whose visibility depended on the
 * text would only appear on the NEXT interaction — present, correct and
 * a beat late, which reads as broken.
 */
export function filtersAreDefault(q: CardQuery, base: CardQuery = emptyQuery()): boolean {
  // `base` is the TAB's default: the builder starts on "Playable here".
  return (
    q.scope === base.scope &&
    q.pile === base.pile &&
    q.types.length === 0 &&
    q.clans.length === 0 &&
    q.disciplines.length === 0 &&
    q.sects.length === 0 &&
    q.titles.length === 0 &&
    q.sets.length === 0 &&
    q.groups.length === 0 &&
    q.capacityMin === null &&
    q.capacityMax === null &&
    q.costMin === null &&
    q.costMax === null &&
    q.status === base.status &&
    q.withinCrypt === null
  );
}

/**
 * Fold a string down to what a person means by it.
 *
 * Lowercase and, crucially, STRIP THE ACCENTS: a pool with Alabástrom,
 * Béatrice and Muaziz in it is a pool where typing the name on an English
 * keyboard finds nothing. NFD splits a letter from its mark and the
 * range below deletes the marks, which is the whole trick.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * What the catalogue actually contains, for the filter menus.
 *
 * DERIVED, never written down. A hand-kept list of clans is a list that
 * is wrong the first time a set adds one, and silently: the missing clan
 * simply cannot be searched for and nothing looks broken. Same reason the
 * card counts in the docs are re-derived rather than quoted (CLAUDE.md,
 * "ALL COUNTS ARE DERIVED").
 */
export interface Facets {
  types: string[];
  clans: string[];
  /** Codes, disciplines first and the seven virtues after them. */
  disciplines: string[];
  sects: string[];
  titles: string[];
  /** Newest set first — which is the one most people are looking for. */
  sets: string[];
  groups: string[];
  capacityMax: number;
  costMax: number;
}

export function facetsOf(file: CatalogFile): Facets {
  const cards = file.cards;
  const types = new Set<string>();
  const clans = new Set<string>();
  const disciplines = new Set<string>();
  const sects = new Set<string>();
  const titles = new Set<string>();
  const groups = new Set<string>();
  let capacityMax = 0;
  let costMax = 0;

  for (const c of cards) {
    for (const t of c.types) types.add(t);
    for (const cl of c.clans) clans.add(cl);
    for (const d of c.disciplines) disciplines.add(d);
    if (c.sect) sects.add(c.sect);
    if (c.title) titles.add(c.title);
    if (c.group) groups.add(c.group);
    if (c.capacity !== null && c.capacity > capacityMax) capacityMax = c.capacity;
    const cost = c.poolCost ?? c.bloodCost ?? 0;
    if (cost > costMax) costMax = cost;
  }

  const byName = (a: string, b: string): number => a.localeCompare(b, "en");
  return {
    types: [...types].sort(byName),
    // Virtues last: they are a different thing that shares the field, and
    // an alphabetical mix puts Vision between Visceratika and Vicissitude
    // where it reads as a discipline (src/cards/catalog.ts).
    disciplines: [...disciplines].sort((a, b) => {
      const va = VIRTUE_CODES.includes(a) ? 1 : 0;
      const vb = VIRTUE_CODES.includes(b) ? 1 : 0;
      return va !== vb ? va - vb : byName(disciplineName(a), disciplineName(b));
    }),
    clans: [...clans].sort(byName),
    sects: [...sects].sort(byName),
    titles: [...titles].sort(byName),
    // Newest set first — the one most people are looking for. The dates
    // come from the FILE, which read them off each set's own printing
    // row; deriving them from the cards dated a reprint set by its
    // oldest card (src/cards/catalog.ts, `CatalogFile`).
    sets: Object.keys(file.sets).sort((a, b) => {
      const da = file.sets[a]!;
      const db = file.sets[b]!;
      return da === db ? byName(a, b) : da < db ? 1 : -1;
    }),
    groups: [...groups].sort((a, b) => {
      // "ANY" is not a number and sorts after the numbered groups.
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return Number.isFinite(na) ? -1 : Number.isFinite(nb) ? 1 : byName(a, b);
    }),
    capacityMax,
    costMax,
  };
}

/** The number a cost filter compares against — pool, else blood, else none. */
function costOf(c: CatalogCard): number | null {
  return c.poolCost ?? c.bloodCost ?? null;
}

/**
 * Does the typed text match?
 *
 * Every word must appear SOMEWHERE in the chosen scope — not the whole
 * phrase in order. "bram stoker" finds the card regardless of which way
 * round the name is written, and "burn blood" finds a card whose text
 * says "burn 1 blood" without anyone having to type the 1.
 */
function matchesText(c: CatalogCard, q: CardQuery): boolean {
  const words = fold(q.text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const name = fold(`${c.name} ${c.printedName}`);
  const body = fold(c.text);
  const hay = q.scope === "name" ? name : q.scope === "text" ? body : `${name} ${body}`;
  return words.every((w) => hay.includes(w));
}

/**
 * The search. Pure, total, and the only place a filter is applied.
 *
 * AN EMPTY LIST IN A FILTER MEANS "DO NOT FILTER", not "match nothing" —
 * which is the difference between a menu with nothing ticked showing
 * everything and showing an empty screen. It is written once here rather
 * than at each of the eight call sites, because a filter that is
 * accidentally exclusive looks exactly like a filter that is correctly
 * finding nothing (CLAUDE.md, "Empty for the wrong reason").
 */
export function searchCards(cards: CatalogCard[], q: CardQuery): CatalogCard[] {
  const out = cards.filter((c) => {
    if (q.pile !== "any" && c.kind !== q.pile) return false;
    if (q.status !== "any" && c.status !== q.status) return false;
    if (q.types.length > 0 && !q.types.some((t) => c.types.includes(t))) return false;
    if (q.clans.length > 0 && !q.clans.some((t) => c.clans.includes(t))) return false;
    if (q.sects.length > 0 && (c.sect === null || !q.sects.includes(c.sect))) return false;
    if (q.titles.length > 0 && (c.title === null || !q.titles.includes(c.title))) return false;
    if (q.sets.length > 0 && !q.sets.some((s) => c.sets.includes(s))) return false;
    if (q.groups.length > 0 && (c.group === null || !q.groups.includes(c.group))) return false;

    if (q.disciplines.length > 0) {
      const has = (d: string): boolean => c.disciplines.includes(d);
      if (!(q.disciplineMode === "all" ? q.disciplines.every(has) : q.disciplines.some(has))) {
        return false;
      }
    }

    // A CARD WITHOUT THE NUMBER IS EXCLUDED BY A BOUND ON IT, rather than
    // passing it. A library card has no capacity, so "capacity 4 to 6"
    // must not quietly return the whole library alongside the vampires.
    if (q.capacityMin !== null && (c.capacity === null || c.capacity < q.capacityMin)) return false;
    if (q.capacityMax !== null && (c.capacity === null || c.capacity > q.capacityMax)) return false;
    const cost = costOf(c);
    if (q.costMin !== null && (cost === null || cost < q.costMin)) return false;
    if (q.costMax !== null && (cost === null || cost > q.costMax)) return false;

    // AN EMPTY SCOPE IS NOT A FILTER. A draft with no vampires yet has
    // no disciplines, clans or sects, and applying that literally would
    // hide most of the library the moment somebody started a deck from
    // scratch — a blank screen that looks like a broken search
    // (CLAUDE.md, "empty for the wrong reason"). The caller switches it
    // off by passing null; `scopeMiss` ignores each empty half of the
    // scope, which is the emptied-crypt case the caller cannot see
    // coming.
    if (q.withinCrypt !== null && !withinScope(c, asScope(q.withinCrypt))) return false;

    return matchesText(c, q);
  });

  const byName = (a: CatalogCard, b: CatalogCard): number => a.name.localeCompare(b.name, "en");
  /**
   * Sort on a number some cards do not have.
   *
   * A CARD WITHOUT THE NUMBER SORTS LAST IN BOTH DIRECTIONS. It is not
   * zero and it is not huge — it is absent, and "cheapest first" should
   * not open with three hundred cards that have no cost. The old code
   * used `?? 99`, which did the right thing ascending by accident and
   * would have put every costless card FIRST the moment a descending
   * option existed.
   */
  const numeric =
    (pick: (c: CatalogCard) => number | null) =>
    (a: CatalogCard, b: CatalogCard): number => {
      const va = pick(a);
      const vb = pick(b);
      if (va === null || vb === null) {
        if (va === vb) return byName(a, b);
        return va === null ? 1 : -1;
      }
      const dir = q.sortDir === "desc" ? -1 : 1;
      return dir * (va - vb) || byName(a, b);
    };

  // Every sort falls back to the name, so the order is TOTAL: two cards
  // of the same capacity keep the same relative order between repaints,
  // and a list that reshuffles under the cursor is a bug report.
  switch (q.sort) {
    case "capacity":
      return out.sort(numeric((c) => c.capacity));
    case "cost":
      return out.sort(numeric(costOf));
    case "oldest":
      return out.sort((a, b) => a.firstPrinted.localeCompare(b.firstPrinted) || byName(a, b));
    case "newest":
      return out.sort((a, b) => b.firstPrinted.localeCompare(a.firstPrinted) || byName(a, b));
    default:
      return out.sort(byName);
  }
}

/**
 * How many results a page may hold (owner request, 2026-09-22).
 *
 * The grid draws a card scan per result, so the page size is also the
 * number of images requested at once — which is why the default is the
 * smallest of the four rather than the largest.
 */
export const PAGE_SIZES = [30, 50, 75, 100];
export const DEFAULT_PAGE_SIZE = 30;

export interface Page {
  /** The results on this page. */
  cards: CatalogCard[];
  /** The page actually shown, 1-based and CLAMPED — see `paginate`. */
  page: number;
  /** How many pages there are. 1 when there are no results at all. */
  pages: number;
  /** 1-based inclusive range of results on this page, for "31–60 of 1,730". */
  from: number;
  to: number;
  total: number;
  /** The page size actually used — the requested one, or the default if
   *  it was not one of `PAGE_SIZES`. The dropdown ticks THIS, not what
   *  was asked for, and not `cards.length`: a last page of 30 out of 50
   *  would otherwise tick the wrong row. */
  size: number;
}

/**
 * Cut the results into a page, and CLAMP rather than trusting the caller.
 *
 * The page number outlives the thing it indexes: it is held on the shell
 * across repaints, and the result list under it changes every time
 * somebody types a letter. So page 40 of a 3,000-card search is page 1
 * of a two-card one a keystroke later, and the honest answer is the last
 * page that exists, not an empty screen that looks like "no matches".
 *
 * Clamping lives HERE, in the one function that knows how many pages
 * there are, rather than at each of the four places that set the page —
 * the typing handler, the size dropdown, the pager and the filters. Four
 * clamps would be four chances to forget one, and the symptom (a blank
 * result area) is indistinguishable from a search that genuinely found
 * nothing.
 */
export function paginate(results: CatalogCard[], page: number, pageSize: number): Page {
  const size = PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(results.length / size));
  const shown = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (shown - 1) * size;
  const cards = results.slice(start, start + size);
  return {
    cards,
    page: shown,
    pages,
    from: results.length === 0 ? 0 : start + 1,
    to: start + cards.length,
    total: results.length,
    size,
  };
}

/**
 * Which page buttons to draw: first, last, and a window round the
 * current one, with gaps marked.
 *
 * 4,149 cards at 30 a page is 139 pages, and 139 buttons is not a pager,
 * it is a wall. `null` is a gap — the caller draws an ellipsis.
 */
export function pageWindow(page: number, pages: number): Array<number | null> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | null> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push(null);
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push(null);
  out.push(pages);
  return out;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<CatalogStatus, string> = {
  playable: "Playable",
  pool: "Partly implemented",
  absent: "Not in the player",
};

/**
 * The badge is the label and nothing else (owner request, 2026-09-22).
 *
 * It used to carry an explanatory sentence — as a tooltip on every badge
 * and as a line under every card's detail — and the owner asked for both
 * gone. The label already says it: "Playable", "Not in the player".
 */
export function statusBadge(c: CatalogCard): string {
  return `<span class="cstat ${c.status}">${esc(STATUS_LABEL[c.status])}</span>`;
}

/** "Dominate, Obfuscate" — or, on a vampire, with the superior marked. */
export function disciplineLine(c: CatalogCard): string {
  return c.disciplines
    .map((d) => {
      const name = disciplineName(d);
      return c.levels[d] === "superior" ? `${name.toUpperCase()}` : name;
    })
    .join(", ");
}

/** The cost as a card prints it: "2 pool", "1 blood", "X blood". */
export function costLine(c: CatalogCard): string {
  const parts: string[] = [];
  if (c.poolCost !== null) parts.push(`${c.poolCost} pool`);
  if (c.bloodCost !== null) parts.push(`${c.bloodCost} blood`);
  if (c.convictionCost !== null) parts.push(`${c.convictionCost} conviction`);
  if (parts.length === 0 && c.rawCost) parts.push(`${c.rawCost} (variable)`);
  return parts.join(" + ");
}

/** The one-line summary under a name: what kind of card this is. */
export function traitLine(c: CatalogCard): string {
  const bits: string[] = [];
  if (c.kind === "crypt") {
    if (c.capacity !== null) bits.push(`capacity ${c.capacity}`);
    if (c.group) bits.push(`group ${c.group}`);
    if (c.clans.length > 0) bits.push(c.clans.join(" / "));
    if (c.sect) bits.push(c.sect);
    if (c.title) bits.push(c.title);
    if (c.path) bits.push(`Path of ${c.path}`);
    if (c.advanced) bits.push("advanced");
  } else {
    bits.push(c.types.join(" / "));
    if (c.clans.length > 0) bits.push(c.clans.join(" / "));
    const cost = costLine(c);
    if (cost) bits.push(cost);
    if (c.burnOption) bits.push("burn option");
  }
  return bits.join(" · ");
}

/**
 * The add control, when a deck is open.
 *
 * It sits OUTSIDE the card button rather than inside it: a `<button>`
 * inside a `<button>` is invalid HTML and browsers unnest it, which in
 * practice means the inner one stops receiving clicks. So the cell
 * becomes a wrapper holding the card button and the adder side by side.
 */
function adder(c: CatalogCard, copies: number): string {
  return `
    <span class="csadd">
      ${copies > 0 ? `<button class="csless" data-card="${c.id}" aria-label="One fewer">−</button>` : ""}
      ${copies > 0 ? `<span class="cscount">${copies}</span>` : ""}
      <button class="csmore" data-card="${c.id}" aria-label="Add ${esc(c.name)}">+</button>
    </span>`;
}

function cardCell(
  c: CatalogCard,
  view: CardView,
  selected: boolean,
  counts: Record<number, number> | null,
): string {
  const sel = selected ? " selected" : "";
  const copies = counts?.[c.id] ?? 0;
  const inDeck = copies > 0 ? " indeck" : "";
  const add = counts ? adder(c, copies) : "";
  if (view === "grid") {
    return `
      <span class="cscell${inDeck}">
        <button class="cscard ${c.status}${sel}" data-card="${c.id}" data-zoomid="${c.id}">
          <img loading="lazy" src="${esc(scanUrl(c.image))}" alt="${esc(c.name)}" />
          <span class="csname">${esc(c.name)}</span>
          ${statusBadge(c)}
        </button>
        ${add}
      </span>`;
  }
  return `
    <span class="cscell${inDeck}">
      <button class="csrow ${c.status}${sel}" data-card="${c.id}" data-zoomid="${c.id}">
        <span class="csname">${esc(c.name)}</span>
        <span class="cstraits">${esc(traitLine(c))}</span>
        ${statusBadge(c)}
      </button>
      ${add}
    </span>`;
}

/**
 * The results, and the one place they are drawn.
 *
 * Called from the full repaint AND from the typing handler, which
 * replaces only this block so the search box keeps its cursor. Two
 * renderers would drift (CLAUDE.md, "One question asked in two places");
 * one function called twice cannot.
 */
export interface ResultsOptions {
  view: CardView;
  selectedId: number | null;
  /** How many cards were searched, for "…out of 4,149 cards". */
  total: number;
  page: number;
  pageSize: number;
  /**
   * The open draft's counts, or null when no deck is being edited.
   *
   * Null is what turns the add controls OFF, so "is a deck open" is one
   * question asked in one place. Passing `{}` would mean "a deck is open
   * and empty", which is a different thing and draws a + on every card.
   */
  counts?: Record<number, number> | null;
}

export function resultsMarkup(results: CatalogCard[], o: ResultsOptions): string {
  const { view, selectedId, total, page, pageSize } = o;
  const counts = o.counts ?? null;
  if (results.length === 0) {
    return `<p class="note dim csempty">
      No card matches that. ${total} cards were searched.
    </p>`;
  }
  const p = paginate(results, page, pageSize);
  const count =
    p.pages === 1
      ? `${p.total} of ${total} cards.`
      : `Showing ${p.from}–${p.to} of ${p.total} matches, out of ${total} cards.`;
  // The pager at the TOP as well as the bottom (owner request,
  // 2026-09-25): at 100 a page the bottom one is a long scroll away.
  return `
    ${pagerMarkup(p, "top")}
    <div class="row cscount">
      <p class="note dim csmore">${count}</p>
      <label class="cssize"><span>Per page</span>
        <select id="cs-size">
          ${PAGE_SIZES.map(
            (n) => `<option value="${n}"${n === p.size ? " selected" : ""}>${n}</option>`,
          ).join("")}
        </select></label>
    </div>
    <div class="csresults ${view}">
      ${p.cards.map((c) => cardCell(c, view, c.id === selectedId, counts)).join("")}
    </div>
    ${pagerMarkup(p)}`;
}

/**
 * The pager. Nothing at all when there is only one page — a "1 of 1"
 * with two dead arrows is furniture, not information.
 */
export function pagerMarkup(p: Page, where: "top" | "bottom" = "bottom"): string {
  if (p.pages <= 1) return "";
  const step = (to: number, label: string, on: boolean): string =>
    `<button class="cspage${on ? "" : " off"}" data-page="${to}"${
      on ? "" : " disabled"
    }>${label}</button>`;
  return `
    <div class="row cspager cspager-${where}">
      ${step(p.page - 1, "‹ Previous", p.page > 1)}
      ${pageWindow(p.page, p.pages)
        .map((n) =>
          n === null
            ? `<span class="csgap">…</span>`
            : `<button class="cspage${n === p.page ? " on" : ""}" data-page="${n}">${n}</button>`,
        )
        .join("")}
      ${step(p.page + 1, "Next ›", p.page < p.pages)}
    </div>`;
}

/** Everything the card says, for the panel that opens when one is picked. */
export function cardDetailMarkup(c: CatalogCard): string {
  const rows: Array<[string, string]> = [];
  const push = (k: string, v: string | number | null | undefined): void => {
    if (v !== null && v !== undefined && String(v) !== "") rows.push([k, String(v)]);
  };

  push("Type", c.types.join(" / "));
  if (c.kind === "crypt") {
    push("Capacity", c.capacity);
    push("Group", c.group);
    push("Clan", c.clans.join(" / "));
    push("Sect", c.sect);
    push("Title", c.title);
    push("Path", c.path ? `Path of ${c.path}` : null);
    push("Advanced", c.advanced ? "yes" : null);
  } else {
    push("Clan", c.clans.join(" / "));
    push("Cost", costLine(c));
    push("Burn option", c.burnOption ? "yes" : null);
  }
  push(c.kind === "crypt" ? "Disciplines" : "Requires", disciplineLine(c));
  push("Sets", c.sets.join(", "));
  push("Artist", c.artists.join(", "));
  // A BANNED CARD IS STILL A CARD, and hiding the fact would be the one
  // thing a deck builder most needs to know before it is too late.
  push("Banned", c.banned);

  return `
    <div class="csdetail">
      <div class="csdetailhead">
        <h2>${esc(c.name)}</h2>
        ${statusBadge(c)}
        <button id="cs-close" class="csclose" aria-label="Close">&times;</button>
      </div>
      <div class="csdetailbody">
        <img class="csbig" src="${esc(scanUrl(c.image))}" alt="${esc(c.name)}" />
        <div class="csfacts">
          <table class="csfacttable">
            ${rows
              .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
              .join("")}
          </table>
          <div class="cstext">${esc(c.text).replace(/\n/g, "<br />")}</div>
          ${c.flavor ? `<p class="csflavor">${esc(c.flavor).replace(/\n/g, "<br />")}</p>` : ""}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// The filter controls
// ---------------------------------------------------------------------------

function options(values: string[], chosen: string[], label?: (v: string) => string): string {
  return values
    .map(
      (v) =>
        `<option value="${esc(v)}"${chosen.includes(v) ? " selected" : ""}>${esc(
          label ? label(v) : v,
        )}</option>`,
    )
    .join("");
}

function num(id: string, label: string, value: number | null, max: number): string {
  return `<label class="csnum"><span>${esc(label)}</span>
    <input id="${id}" type="number" min="0" max="${max}"
           value="${value === null ? "" : String(value)}" /></label>`;
}

/**
 * Sort by, and the direction beside it when the sort has one.
 *
 * OUTSIDE the advanced panel (owner request, 2026-09-25): the order the
 * results come in is not a filter, and a sort you cannot see is a list
 * that looks shuffled. It sits on the right of the advanced row, under
 * the Grid/List toggle, whether or not the panel is open.
 */
export function sortMarkup(q: CardQuery): string {
  return `
    <div class="cssort">
      <label class="cssortfield"><span>Sort by</span>
        <select id="cs-sort">
          <option value="name"${q.sort === "name" ? " selected" : ""}>Name</option>
          <option value="capacity"${q.sort === "capacity" ? " selected" : ""}>Capacity</option>
          <option value="cost"${q.sort === "cost" ? " selected" : ""}>Cost</option>
          <option value="newest"${q.sort === "newest" ? " selected" : ""}>Newest set</option>
          <option value="oldest"${q.sort === "oldest" ? " selected" : ""}>Oldest set</option>
        </select></label>
      ${
        // Only for the sorts it means something for. Offering it beside
        // "Oldest set" would be offering the same choice twice and
        // letting the two contradict each other.
        SORTS_WITH_DIRECTION.includes(q.sort)
          ? `<select id="cs-sortdir" aria-label="Order">
               <option value="asc"${q.sortDir === "asc" ? " selected" : ""}>Lowest first</option>
               <option value="desc"${q.sortDir === "desc" ? " selected" : ""}>Highest first</option>
             </select>`
          : ""
      }
    </div>`;
}

/**
 * The advanced panel. Multi-selects rather than checkbox walls: there are
 * 47 clans and 110 sets, and a wall of 110 checkboxes is a screen nobody
 * reads. Each one says how many are chosen in its own label, because a
 * collapsed multi-select otherwise hides the filter that is making the
 * results look wrong.
 *
 * NINE GROUPS, in reading order, so the same markup lays out as a 3×3 in
 * the builder's narrow column and as a row of fitted columns on the Card
 * search tab (the CSS decides which): the general questions first, then
 * what a card IS (type, clan, discipline), then who can use it (sect,
 * title), then where it was printed and the crypt numbers.
 */
export function filtersMarkup(q: CardQuery, f: Facets, open: boolean, base?: CardQuery): string {
  const count = (n: number): string => (n > 0 ? ` <span class="csn">${n}</span>` : "");
  const head = `
    <div class="row csadvrow">
      <button id="cs-adv" class="csadv${open ? " open" : ""}">Advanced search ${open ? "▴" : "▾"}</button>
      ${filtersAreDefault(q, base) ? "" : `<button id="cs-reset">Clear filters</button>`}
      ${sortMarkup(q)}
    </div>`;
  if (!open) return head;
  return `${head}
    <div class="csfilters">
      <div class="csgroup">
        <label class="csfield"><span>Pile</span>
          <select id="cs-pile">
            <option value="any"${q.pile === "any" ? " selected" : ""}>Any</option>
            <option value="crypt"${q.pile === "crypt" ? " selected" : ""}>Crypt</option>
            <option value="library"${q.pile === "library" ? " selected" : ""}>Library</option>
          </select></label>
        <label class="csfield"><span>Search in</span>
          <select id="cs-scope">
            <option value="any"${q.scope === "any" ? " selected" : ""}>Name and text</option>
            <option value="name"${q.scope === "name" ? " selected" : ""}>Name only</option>
            <option value="text"${q.scope === "text" ? " selected" : ""}>Card text only</option>
          </select></label>
        <label class="csfield"><span>In this player</span>
          <select id="cs-status">
            <option value="any"${q.status === "any" ? " selected" : ""}>Any</option>
            <option value="playable"${q.status === "playable" ? " selected" : ""}>Playable here</option>
            <option value="absent"${q.status === "absent" ? " selected" : ""}>Not added yet</option>
            <option value="pool"${q.status === "pool" ? " selected" : ""}>Partly implemented</option>
          </select></label>
      </div>

      <div class="csgroup">
        <label class="csfield"><span>Type${count(q.types.length)}</span>
          <select id="cs-types" multiple size="7">${options(f.types, q.types)}</select></label>
      </div>

      <div class="csgroup">
        <label class="csfield"><span>Clan${count(q.clans.length)}</span>
          <select id="cs-clans" multiple size="7">${options(f.clans, q.clans)}</select></label>
      </div>

      <div class="csgroup">
        <label class="csfield"><span>Discipline${count(q.disciplines.length)}</span>
          <select id="cs-disc" multiple size="5">
            ${options(f.disciplines, q.disciplines, disciplineName)}
          </select></label>
        <label class="csfield"><span>Discipline match</span>
          <select id="cs-discmode">
            <option value="any"${q.disciplineMode === "any" ? " selected" : ""}>Any of them</option>
            <option value="all"${q.disciplineMode === "all" ? " selected" : ""}>All of them</option>
          </select></label>
      </div>

      <div class="csgroup">
        <label class="csfield"><span>Sect${count(q.sects.length)}</span>
          <select id="cs-sects" multiple size="7">${options(f.sects, q.sects)}</select></label>
      </div>

      <div class="csgroup">
        <label class="csfield"><span>Title${count(q.titles.length)}</span>
          <select id="cs-titles" multiple size="7">${options(f.titles, q.titles)}</select></label>
      </div>

      <div class="csgroup csgroup-set">
        <label class="csfield"><span>Set${count(q.sets.length)}</span>
          <select id="cs-sets" multiple size="7">${options(f.sets, q.sets)}</select></label>
      </div>

      <div class="csgroup">
        <label class="csfield"><span>Group${count(q.groups.length)}</span>
          <select id="cs-groups" multiple size="7">${options(f.groups, q.groups)}</select></label>
      </div>

      <div class="csgroup csgroup-range">
        <div class="csrange">
          <span class="cslabel">Capacity</span>
          ${num("cs-capmin", "from", q.capacityMin, f.capacityMax)}
          ${num("cs-capmax", "to", q.capacityMax, f.capacityMax)}
        </div>
        <div class="csrange">
          <span class="cslabel">Cost</span>
          ${num("cs-costmin", "from", q.costMin, f.costMax)}
          ${num("cs-costmax", "to", q.costMax, f.costMax)}
        </div>
      </div>
    </div>`;
}

/** The search bar, the view toggle, and the panel of filters under them. */
export function searchPanelMarkup(
  q: CardQuery,
  f: Facets,
  advancedOpen: boolean,
  view: CardView,
  base?: CardQuery,
): string {
  return `
    <div class="row csbar">
      <input id="cs-q" class="csq" type="search" value="${esc(q.text)}"
             placeholder="Search every card — name or text…" />
      <button id="cs-grid" class="csview${view === "grid" ? " on" : ""}">Grid</button>
      <button id="cs-list" class="csview${view === "list" ? " on" : ""}">List</button>
    </div>
    ${filtersMarkup(q, f, advancedOpen, base)}`;
}
