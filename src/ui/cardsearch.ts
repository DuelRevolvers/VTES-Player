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

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** How the results are drawn. Card pictures, or card facts. */
export type CardView = "grid" | "list";

export type SortKey = "name" | "capacity" | "cost" | "oldest" | "newest";

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
export function filtersAreDefault(q: CardQuery): boolean {
  const base = emptyQuery();
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
    q.status === base.status
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

    return matchesText(c, q);
  });

  const byName = (a: CatalogCard, b: CatalogCard): number => a.name.localeCompare(b.name, "en");
  // Every sort falls back to the name, so the order is TOTAL: two cards
  // of the same capacity keep the same relative order between repaints,
  // and a list that reshuffles under the cursor is a bug report.
  switch (q.sort) {
    case "capacity":
      return out.sort((a, b) => (a.capacity ?? 99) - (b.capacity ?? 99) || byName(a, b));
    case "cost":
      return out.sort((a, b) => (costOf(a) ?? 99) - (costOf(b) ?? 99) || byName(a, b));
    case "oldest":
      return out.sort((a, b) => a.firstPrinted.localeCompare(b.firstPrinted) || byName(a, b));
    case "newest":
      return out.sort((a, b) => b.firstPrinted.localeCompare(a.firstPrinted) || byName(a, b));
    default:
      return out.sort(byName);
  }
}

/**
 * How many results are DRAWN at once.
 *
 * The grid draws a card scan per row, and 4,149 of them is 4,149 image
 * requests the moment somebody clears the search box. The count is shown
 * beside the cap, so a truncated list says so rather than looking like
 * the whole answer.
 */
export const RESULT_LIMIT = 120;

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<CatalogStatus, string> = {
  playable: "Playable",
  pool: "Partly implemented",
  absent: "Not in the player",
};

const STATUS_TITLE: Record<CatalogStatus, string> = {
  playable: "This card does everything it prints, at a table, today.",
  pool: "This card is dealt, but something it prints is not implemented.",
  absent: "A real card, not yet added to this platform.",
};

export function statusBadge(c: CatalogCard): string {
  return `<span class="cstat ${c.status}" title="${esc(STATUS_TITLE[c.status])}">${esc(
    STATUS_LABEL[c.status],
  )}</span>`;
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

function cardCell(c: CatalogCard, view: CardView, selected: boolean): string {
  const sel = selected ? " selected" : "";
  if (view === "grid") {
    return `
      <button class="cscard ${c.status}${sel}" data-card="${c.id}" title="${esc(c.name)}">
        <img loading="lazy" src="${esc(c.image)}" alt="${esc(c.name)}" />
        <span class="csname">${esc(c.name)}</span>
        ${statusBadge(c)}
      </button>`;
  }
  return `
    <button class="csrow ${c.status}${sel}" data-card="${c.id}">
      <span class="csname">${esc(c.name)}</span>
      <span class="cstraits">${esc(traitLine(c))}</span>
      ${statusBadge(c)}
    </button>`;
}

/**
 * The results, and the one place they are drawn.
 *
 * Called from the full repaint AND from the typing handler, which
 * replaces only this block so the search box keeps its cursor. Two
 * renderers would drift (CLAUDE.md, "One question asked in two places");
 * one function called twice cannot.
 */
export function resultsMarkup(
  results: CatalogCard[],
  view: CardView,
  selectedId: number | null,
  total: number,
): string {
  if (results.length === 0) {
    return `<p class="note dim csempty">
      No card matches that. ${total} cards were searched.
    </p>`;
  }
  const shown = results.slice(0, RESULT_LIMIT);
  const more =
    results.length > shown.length
      ? `<p class="note dim csmore">
           Showing the first ${shown.length} of ${results.length} matches —
           narrow the search to see the rest.
         </p>`
      : `<p class="note dim csmore">${results.length} of ${total} cards.</p>`;
  return `
    ${more}
    <div class="csresults ${view}">
      ${shown.map((c) => cardCell(c, view, c.id === selectedId)).join("")}
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
        <img class="csbig" src="${esc(c.image)}" alt="${esc(c.name)}" />
        <div class="csfacts">
          <table class="csfacttable">
            ${rows
              .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
              .join("")}
          </table>
          <div class="cstext">${esc(c.text).replace(/\n/g, "<br />")}</div>
          ${c.flavor ? `<p class="csflavor">${esc(c.flavor).replace(/\n/g, "<br />")}</p>` : ""}
          <p class="note dim">${esc(STATUS_TITLE[c.status])}</p>
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
 * The advanced panel. Multi-selects rather than checkbox walls: there are
 * 47 clans and 110 sets, and a wall of 110 checkboxes is a screen nobody
 * reads. Each one says how many are chosen in its own label, because a
 * collapsed multi-select otherwise hides the filter that is making the
 * results look wrong.
 */
export function filtersMarkup(q: CardQuery, f: Facets, open: boolean): string {
  const count = (n: number): string => (n > 0 ? ` <span class="csn">${n}</span>` : "");
  if (!open) {
    return `<div class="row csadvrow">
      <button id="cs-adv" class="csadv">Advanced search ▾</button>
      ${filtersAreDefault(q) ? "" : `<button id="cs-reset">Clear filters</button>`}
    </div>`;
  }
  return `
    <div class="row csadvrow">
      <button id="cs-adv" class="csadv open">Advanced search ▴</button>
      ${filtersAreDefault(q) ? "" : `<button id="cs-reset">Clear filters</button>`}
    </div>
    <div class="csfilters">
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

      <label class="csfield"><span>Sort by</span>
        <select id="cs-sort">
          <option value="name"${q.sort === "name" ? " selected" : ""}>Name</option>
          <option value="capacity"${q.sort === "capacity" ? " selected" : ""}>Capacity</option>
          <option value="cost"${q.sort === "cost" ? " selected" : ""}>Cost</option>
          <option value="newest"${q.sort === "newest" ? " selected" : ""}>Newest set</option>
          <option value="oldest"${q.sort === "oldest" ? " selected" : ""}>Oldest set</option>
        </select></label>

      <label class="csfield wide"><span>Type${count(q.types.length)}</span>
        <select id="cs-types" multiple size="6">${options(f.types, q.types)}</select></label>

      <label class="csfield wide"><span>Clan${count(q.clans.length)}</span>
        <select id="cs-clans" multiple size="6">${options(f.clans, q.clans)}</select></label>

      <label class="csfield wide"><span>Discipline${count(q.disciplines.length)}</span>
        <select id="cs-disc" multiple size="6">
          ${options(f.disciplines, q.disciplines, disciplineName)}
        </select></label>

      <label class="csfield"><span>Discipline match</span>
        <select id="cs-discmode">
          <option value="any"${q.disciplineMode === "any" ? " selected" : ""}>Any of them</option>
          <option value="all"${q.disciplineMode === "all" ? " selected" : ""}>All of them</option>
        </select></label>

      <label class="csfield"><span>Sect${count(q.sects.length)}</span>
        <select id="cs-sects" multiple size="5">${options(f.sects, q.sects)}</select></label>

      <label class="csfield"><span>Title${count(q.titles.length)}</span>
        <select id="cs-titles" multiple size="5">${options(f.titles, q.titles)}</select></label>

      <label class="csfield"><span>Group${count(q.groups.length)}</span>
        <select id="cs-groups" multiple size="5">${options(f.groups, q.groups)}</select></label>

      <label class="csfield wide"><span>Set${count(q.sets.length)}</span>
        <select id="cs-sets" multiple size="6">${options(f.sets, q.sets)}</select></label>

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
    </div>`;
}

/** The search bar, the view toggle, and the panel of filters under them. */
export function searchPanelMarkup(
  q: CardQuery,
  f: Facets,
  advancedOpen: boolean,
  view: CardView,
): string {
  return `
    <div class="row csbar">
      <input id="cs-q" class="csq" type="search" value="${esc(q.text)}"
             placeholder="Search every card — name or text…" />
      <button id="cs-grid" class="csview${view === "grid" ? " on" : ""}">Grid</button>
      <button id="cs-list" class="csview${view === "list" ? " on" : ""}">List</button>
    </div>
    ${filtersMarkup(q, f, advancedOpen)}`;
}
