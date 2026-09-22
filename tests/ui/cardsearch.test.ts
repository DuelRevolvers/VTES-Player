/**
 * The card search, and the catalogue under it
 * (docs/deck-builder-design.md).
 *
 * TWO THINGS ARE BEING TESTED AND THEY FAIL DIFFERENTLY.
 *
 * The catalogue is GENERATED, so what can go wrong with it is drift: it
 * and the registry are built from the same snapshot by two scripts, and
 * the day somebody runs one without the other, `status` starts lying
 * about which cards this platform plays. Those assertions pin the
 * RELATIONSHIP between the two files, not a count in either.
 *
 * The search is pure, so what can go wrong with it is the thing no
 * screenshot shows: a filter that excludes too much, or one that excludes
 * nothing at all. Both look like a plausible list of cards. So nearly
 * every case here asserts the NEGATIVE SPACE — what is missing from the
 * answer and why — because "the filter returned some cards" is the
 * assertion that has cost this project the most time (CLAUDE.md, "Tests
 * that lie").
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import catalog from "../../src/cards/catalog.json";
import registry from "../../src/cards/registry.json";
import type { CatalogCard, CatalogFile } from "../../src/cards/catalog.ts";
import { DISCIPLINE_NAMES, VIRTUE_CODES } from "../../src/cards/catalog.ts";
import type { CardRegistry } from "../../src/cards/types.ts";
import {
  cardDetailMarkup,
  costLine,
  DEFAULT_PAGE_SIZE,
  emptyQuery,
  facetsOf,
  filtersAreDefault,
  fold,
  PAGE_SIZES,
  pagerMarkup,
  pageWindow,
  paginate,
  queryIsEmpty,
  resultsMarkup,
  searchCards,
  statusBadge,
  traitLine,
} from "../../src/ui/cardsearch.ts";

const file = catalog as unknown as CatalogFile;
const cards = file.cards;
const reg = registry as unknown as CardRegistry;
const facets = facetsOf(file);
const byName = (name: string): CatalogCard => {
  const found = cards.find((c) => c.name === name);
  // A FIXTURE A TEST NEEDS, THE TEST ASSERTS IS THERE. A `?? cards[0]`
  // here would turn "that card left the catalogue" into a test about a
  // completely different card, and it would still pass.
  if (!found) throw new Error(`no card named "${name}" in the catalogue`);
  return found;
};

describe("the catalogue", () => {
  it("holds every card in the game, not just the pool", () => {
    // The registry is the POOL and is an order of magnitude smaller. If
    // these two are ever the same number, the catalogue has been built
    // from the wrong source and the search silently stops being able to
    // answer "what am I missing?".
    expect(cards.length).toBeGreaterThan(4000);
    expect(cards.length).toBeGreaterThan(Object.keys(reg.entries).length * 3);
  });

  it("agrees with the registry about what is in the pool", () => {
    // The relationship, not the count: every card the registry knows is
    // in the catalogue and is not marked absent, and every card marked
    // NOT absent is in the registry. Drift in either direction fails.
    const inRegistry = new Set(Object.keys(reg.entries).map(Number));
    const notAbsent = new Set(cards.filter((c) => c.status !== "absent").map((c) => c.id));
    for (const id of inRegistry) expect(notAbsent.has(id)).toBe(true);
    for (const id of notAbsent) expect(inRegistry.has(id)).toBe(true);
  });

  it("has nothing in the half-implemented state", () => {
    // "No partial cards" is a binding rule (CLAUDE.md), and this is the
    // same assertion `tests/cards/no-partial-cards.test.ts` makes, stated
    // where a PLAYER would see it break: a `pool` badge on screen.
    expect(cards.filter((c) => c.status === "pool")).toEqual([]);
  });

  it("does not call an abilityless vampire unsupported", () => {
    // 118 V5 vampires print no ability, so nothing flips them in
    // config/supported.json — and reading that flag alone would badge
    // every one of them as broken. This is the case that made `status` a
    // three-state derivation rather than a boolean.
    const flagless = cards.filter(
      (c) => c.kind === "crypt" && reg.entries[c.id] && !reg.entries[c.id]!.supported,
    );
    expect(flagless.length).toBeGreaterThan(0);
    for (const c of flagless) expect(c.status).toBe("playable");
  });

  it("names every discipline code it uses", () => {
    // A code with no entry in the map is drawn as the raw code and
    // matches no search for its name — invisible, because the card still
    // appears and still looks right.
    for (const c of cards) {
      for (const d of c.disciplines) expect(DISCIPLINE_NAMES[d]).toBeTruthy();
    }
  });

  it("keeps `ven`/`viz` as virtues and `vis` as a discipline", () => {
    // The near-miss this pair invites: `ven` reads as Ventrue and `viz`
    // as Visceratika, and either mistake mislabels a card while leaving
    // the screen looking entirely normal.
    expect(DISCIPLINE_NAMES["ven"]).toBe("Vengeance");
    expect(DISCIPLINE_NAMES["viz"]).toBe("Vision");
    expect(DISCIPLINE_NAMES["vis"]).toBe("Visceratika");
    expect(VIRTUE_CODES).toContain("ven");
    expect(VIRTUE_CODES).not.toContain("vis");
  });

  it("records the level of a crypt discipline and not of a library one", () => {
    const vampire = cards.find((c) => c.kind === "crypt" && c.disciplines.length > 0)!;
    expect(Object.keys(vampire.levels).length).toBe(vampire.disciplines.length);
    const libWithDisc = cards.find((c) => c.kind === "library" && c.disciplines.length > 0)!;
    // A library card's discipline is a REQUIREMENT, not a level — storing
    // one would make "superior" mean two different things in one field.
    expect(libWithDisc.levels).toEqual({});
  });
});

describe("the facets", () => {
  it("are derived from the cards, so nothing is unsearchable", () => {
    // A hand-kept clan list is wrong the first time a set adds one, and
    // wrong SILENTLY: the clan simply cannot be picked.
    const clans = new Set(cards.flatMap((c) => c.clans));
    expect(new Set(facets.clans)).toEqual(clans);
    const types = new Set(cards.flatMap((c) => c.types));
    expect(new Set(facets.types)).toEqual(types);
  });

  it("put the virtues after the disciplines", () => {
    const firstVirtue = facets.disciplines.findIndex((d) => VIRTUE_CODES.includes(d));
    const lastDiscipline = facets.disciplines.reduce(
      (acc, d, i) => (VIRTUE_CODES.includes(d) ? acc : i),
      -1,
    );
    expect(firstVirtue).toBeGreaterThan(lastDiscipline);
  });

  it("list the sets newest first, by the SET's date and not a card's", () => {
    // THE BUG THIS CAUGHT. Deriving a set's date from its cards' earliest
    // printing put New Blood III (2025) behind a 2023 promo, because New
    // Blood III reprints cards from 1994. The assertion is the ORDERING,
    // not a name: pinning "New Blood III is first" would be a hostage to
    // the next set KRCG adds (CLAUDE.md, "an assertion about a total set
    // is a hostage to every future change").
    for (let i = 1; i < facets.sets.length; i++) {
      const prev = file.sets[facets.sets[i - 1]!]!;
      const here = file.sets[facets.sets[i]!]!;
      expect(prev >= here).toBe(true);
    }
    // And the concrete case, stated as the relation it is.
    expect(facets.sets.indexOf("New Blood III")).toBeLessThan(
      facets.sets.indexOf("2023 Chapters Promo"),
    );
  });

  it("sorts ANY after the numbered crypt groups", () => {
    expect(facets.groups[facets.groups.length - 1]).toBe("ANY");
    expect(facets.groups[0]).toBe("1");
  });
});

describe("searching by text", () => {
  it("finds a card by any of its words, in any order", () => {
    const q = { ...emptyQuery(), text: "magnum 44", scope: "name" as const };
    expect(searchCards(cards, q).map((c) => c.name)).toContain(".44 Magnum");
  });

  it("ignores accents, so an English keyboard can find the card", () => {
    // Alabástrom, Béatrice, Muaziz: typed without the accent, a plain
    // substring match returns nothing and the card looks absent.
    expect(fold("Alabástrom")).toBe("alabastrom");
    const hits = searchCards(cards, { ...emptyQuery(), text: "alabastrom" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.name).toContain("Alab");
  });

  it("scopes to the name, and the scope actually excludes", () => {
    // The positive AND the negative: a word that appears in many cards'
    // TEXT must vanish when the scope is the name. Without the second
    // half, a scope that was never applied would pass.
    const inText = searchCards(cards, { ...emptyQuery(), text: "torpor", scope: "text" });
    const inName = searchCards(cards, { ...emptyQuery(), text: "torpor", scope: "name" });
    expect(inText.length).toBeGreaterThan(inName.length);
    for (const c of inName) expect(fold(c.name)).toContain("torpor");
  });

  it("tells 'no filters' from 'nothing at all', so Clear can appear", () => {
    // Two questions, because typing does not repaint: the Clear button
    // asks about FILTERS only, so it shows the moment one is set rather
    // than one interaction later.
    const typed = { ...emptyQuery(), text: "blood" };
    expect(filtersAreDefault(typed)).toBe(true);
    expect(queryIsEmpty(typed)).toBe(false);
    const filtered = { ...emptyQuery(), clans: ["Brujah"] };
    expect(filtersAreDefault(filtered)).toBe(false);
  });

  it("returns everything when nothing is typed", () => {
    // An empty search meaning "no cards" is the classic empty-for-the-
    // wrong-reason: a blank screen on arrival that looks like a load
    // failure.
    expect(searchCards(cards, emptyQuery()).length).toBe(cards.length);
    expect(queryIsEmpty(emptyQuery())).toBe(true);
  });
});

describe("the filters", () => {
  it("treat an empty list as 'do not filter', never as 'match nothing'", () => {
    const q = emptyQuery();
    expect(q.clans).toEqual([]);
    expect(searchCards(cards, q).length).toBe(cards.length);
  });

  it("filter by clan, and exclude the other clans", () => {
    const hits = searchCards(cards, { ...emptyQuery(), clans: ["Tremere"] });
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) expect(c.clans).toContain("Tremere");
    // The negative: a Nosferatu is gone.
    expect(hits.some((c) => c.clans.includes("Nosferatu") && !c.clans.includes("Tremere"))).toBe(
      false,
    );
  });

  it("tell 'any of these disciplines' from 'all of them'", () => {
    const both = ["dom", "obf"];
    const any = searchCards(cards, { ...emptyQuery(), disciplines: both });
    const all = searchCards(cards, {
      ...emptyQuery(),
      disciplines: both,
      disciplineMode: "all",
    });
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThan(any.length);
    for (const c of all) {
      expect(c.disciplines).toContain("dom");
      expect(c.disciplines).toContain("obf");
    }
  });

  it("exclude a card that has no number when a bound is set on it", () => {
    // THE CASE THAT LOOKS RIGHT WHILE BEING WRONG: most library cards
    // have no capacity, so a "capacity 4 to 6" that let a null through
    // would return the whole library alongside the vampires and still
    // look like a sensible list of cards.
    const hits = searchCards(cards, { ...emptyQuery(), capacityMin: 4, capacityMax: 6 });
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) {
      expect(c.capacity).not.toBeNull();
      expect(c.capacity!).toBeGreaterThanOrEqual(4);
      expect(c.capacity!).toBeLessThanOrEqual(6);
    }
    // And the library IS excluded, apart from the cards that genuinely
    // print a capacity — see below.
    expect(hits.filter((c) => c.kind === "library").length).toBeLessThan(hits.length / 10);
  });

  it("keeps the fifteen LIBRARY cards that print a capacity", () => {
    // A find, not an accident (2026-09-22). Abomination, Create
    // Gargoyle, Childe of the Revolution and their kin are Action cards
    // that put a vampire into play, and the capacity on them is that
    // vampire's (docs/token-vampire-design.md). "Only the crypt has a
    // capacity" is the obvious assumption and it is wrong; a search that
    // acted on it would hide exactly the cards somebody hunting for a
    // capacity-4 vampire wants to know about.
    const withCapacity = cards.filter((c) => c.kind === "library" && c.capacity !== null);
    expect(withCapacity.length).toBeGreaterThan(0);
    for (const c of withCapacity) {
      // Fourteen Actions and one Master (Trophy: Progeny), and Create
      // Gargoyle says "gargoyle" where the rest say "vampire" — so the
      // test pins the one thing all fifteen share, which is that the
      // number in the field is a capacity the CARD TEXT is talking
      // about. The card type is nearly but not quite uniform, and the
      // creature's name is not uniform at all.
      expect(fold(c.text)).toContain("capacity");
    }
    const hits = searchCards(cards, { ...emptyQuery(), capacityMin: 4, capacityMax: 4 });
    expect(hits.map((c) => c.name)).toContain("Abomination");
  });

  it("filter on what this platform can play", () => {
    const playable = searchCards(cards, { ...emptyQuery(), status: "playable" });
    const absent = searchCards(cards, { ...emptyQuery(), status: "absent" });
    expect(playable.length + absent.length).toBe(cards.length);
    for (const c of playable) expect(reg.entries[c.id]).toBeDefined();
    for (const c of absent) expect(reg.entries[c.id]).toBeUndefined();
  });

  it("combine, rather than one filter winning", () => {
    // Two filters that are each satisfiable but whose INTERSECTION is
    // narrower than either — the tell for a filter chain that stops at
    // the first match.
    const q = { ...emptyQuery(), pile: "crypt" as const, clans: ["Malkavian"], sects: ["Camarilla"] };
    const hits = searchCards(cards, q);
    expect(hits.length).toBeGreaterThan(0);
    for (const c of hits) {
      expect(c.kind).toBe("crypt");
      expect(c.clans).toContain("Malkavian");
      expect(c.sect).toBe("Camarilla");
    }
    expect(hits.length).toBeLessThan(searchCards(cards, { ...emptyQuery(), clans: ["Malkavian"] }).length);
  });

  it("finds nothing when nothing matches, rather than everything", () => {
    const hits = searchCards(cards, { ...emptyQuery(), text: "qqzzxx no such card" });
    expect(hits).toEqual([]);
  });
});

describe("sorting", () => {
  it("is total, so equal cards keep a stable order", () => {
    // Two cards of the same capacity must not swap places between
    // repaints; the name is the tie-break that stops the list reshuffling
    // under the cursor.
    const hits = searchCards(cards, { ...emptyQuery(), pile: "crypt", sort: "capacity" });
    for (let i = 1; i < hits.length; i++) {
      const a = hits[i - 1]!;
      const b = hits[i]!;
      const ca = a.capacity ?? 99;
      const cb = b.capacity ?? 99;
      expect(ca <= cb).toBe(true);
      if (ca === cb) expect(a.name.localeCompare(b.name, "en") <= 0).toBe(true);
    }
  });

  it("orders by printing date both ways", () => {
    const q = { ...emptyQuery(), clans: ["Brujah"] };
    const oldest = searchCards(cards, { ...q, sort: "oldest" });
    const newest = searchCards(cards, { ...q, sort: "newest" });
    expect(oldest[0]!.firstPrinted <= oldest[oldest.length - 1]!.firstPrinted).toBe(true);
    expect(newest[0]!.firstPrinted >= newest[newest.length - 1]!.firstPrinted).toBe(true);
  });
});

describe("what the screen says about a card", () => {
  it("badges a playable card and an absent one differently", () => {
    const playable = cards.find((c) => c.status === "playable")!;
    const absent = cards.find((c) => c.status === "absent")!;
    expect(statusBadge(playable)).toContain("Playable");
    expect(statusBadge(absent)).toContain("Not in the player");
  });

  it("writes a vampire's traits and a library card's cost", () => {
    const gun = byName(".44 Magnum");
    // Equipment is bought with POOL (p. 11); the gun costs 2.
    expect(costLine(gun)).toBe("2 pool");
    expect(traitLine(gun)).toContain("Equipment");
    // And a card that costs blood says blood, so the line is not simply
    // printing one word for everything.
    const bloodCard = cards.find((c) => c.bloodCost !== null && c.poolCost === null)!;
    expect(costLine(bloodCard)).toContain("blood");

    const vampire = cards.find((c) => c.kind === "crypt" && c.title !== null)!;
    const line = traitLine(vampire);
    expect(line).toContain(`capacity ${vampire.capacity}`);
    expect(line).toContain(vampire.title!);
  });

  it("puts the whole card in the detail panel, escaped", () => {
    const gun = byName(".44 Magnum");
    const html = cardDetailMarkup(gun);
    expect(html).toContain("Equipment");
    expect(html).toContain(gun.image);
    // Card text arrives from a data file and is written into innerHTML.
    expect(cardDetailMarkup({ ...gun, text: "<script>x</script>" })).not.toContain("<script>");
  });

  it("draws only one page of results, and says which", () => {
    // 4,149 card scans requested at once is what clearing the search box
    // would otherwise do.
    const all = searchCards(cards, emptyQuery());
    const html = resultsMarkup(all, { view: "grid", selectedId: null, total: cards.length, page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect((html.match(/class="cscard/g) ?? []).length).toBe(DEFAULT_PAGE_SIZE);
    expect(html).toContain(`Showing 1–${DEFAULT_PAGE_SIZE} of ${all.length}`);
  });

  it("says how many were searched when nothing matched", () => {
    const html = resultsMarkup([], { view: "list", selectedId: null, total: cards.length, page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(html).toContain("No card matches");
    expect(html).toContain(String(cards.length));
  });

  it("ticks the page size in use, not the number of cards on the page", () => {
    // A last page of 30 out of 50 would otherwise tick "30", and the
    // dropdown would silently disagree with the paging it describes.
    const all = searchCards(cards, emptyQuery());
    const last = Math.ceil(all.length / 50);
    const html = resultsMarkup(all, { view: "list", selectedId: null, total: cards.length, page: last, pageSize: 50 });
    expect(html).toContain(`<option value="50" selected>`);
    expect(html).not.toContain(`<option value="30" selected>`);
  });
});

describe("paging", () => {
  const all = searchCards(cards, emptyQuery());

  it("offers exactly the four sizes asked for, smallest by default", () => {
    expect(PAGE_SIZES).toEqual([30, 50, 75, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(30);
  });

  it("cuts the results into pages that tile them exactly", () => {
    // Every card appears on exactly one page: no gap at a boundary and
    // no card shown twice. An off-by-one here is invisible on screen —
    // page 2 simply starts one card late and nothing looks wrong.
    const seen: number[] = [];
    const pages = Math.ceil(all.length / 50);
    for (let i = 1; i <= pages; i++) {
      const p = paginate(all, i, 50);
      expect(p.from).toBe(seen.length + 1);
      seen.push(...p.cards.map((c) => c.id));
      expect(p.to).toBe(seen.length);
    }
    expect(seen.length).toBe(all.length);
    expect(new Set(seen).size).toBe(all.length);
  });

  it("clamps a page past the end to the last one that exists", () => {
    // THE CASE THAT MATTERS: the page number outlives the list it
    // indexes. On page 40, typing a narrower search leaves 40 pointing
    // past the end — and an unclamped slice returns [], which looks
    // exactly like "nothing matched".
    const few = searchCards(cards, { ...emptyQuery(), clans: ["Salubri"] });
    expect(few.length).toBeGreaterThan(0);
    const p = paginate(few, 999, 30);
    expect(p.page).toBe(p.pages);
    expect(p.cards.length).toBeGreaterThan(0);
  });

  it("clamps a nonsense page rather than throwing", () => {
    for (const bad of [0, -5, Number.NaN]) {
      expect(paginate(all, bad, 30).page).toBe(1);
    }
    // An unknown size falls back to the default rather than slicing by NaN.
    expect(paginate(all, 1, 999).size).toBe(DEFAULT_PAGE_SIZE);
  });

  it("reports one page, and draws no pager, when everything fits", () => {
    const p = paginate(all.slice(0, 5), 1, 30);
    expect(p.pages).toBe(1);
    expect(pagerMarkup(p)).toBe("");
  });

  it("says nothing is there without pretending there is a page 0", () => {
    const p = paginate([], 1, 30);
    expect(p).toMatchObject({ page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });

  it("windows the page buttons instead of drawing 139 of them", () => {
    // 4,149 cards at 30 a page really is 139 pages.
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(70, 139)).toEqual([1, null, 69, 70, 71, null, 139]);
    // The first and last page are always reachable in one click.
    for (const at of [1, 2, 70, 138, 139]) {
      const w = pageWindow(at, 139);
      expect(w[0]).toBe(1);
      expect(w[w.length - 1]).toBe(139);
      expect(w).toContain(at);
    }
  });

  it("disables the arrow that would walk off the end", () => {
    const pages = Math.ceil(all.length / 30);
    const first = pagerMarkup(paginate(all, 1, 30));
    // Previous points at page 0 and is disabled; Next is live.
    expect(first).toMatch(/data-page="0" disabled>‹ Previous/);
    expect(first).toMatch(/data-page="2">Next ›/);

    const last = pagerMarkup(paginate(all, 9999, 30));
    // …and the mirror image on the clamped last page. Both halves, or a
    // pager that disabled BOTH arrows would pass the first check alone.
    expect(last).toMatch(new RegExp(`data-page="${pages + 1}" disabled>Next ›`));
    expect(last).toMatch(new RegExp(`data-page="${pages - 1}">‹ Previous`));
  });
});

describe("the deck builder screen", () => {
  // Source-level, in the manner of tests/ui/pages-ready.test.ts: the
  // shell has no jsdom, and these are the three structural facts the
  // owner asked for — a way in, the deck things having MOVED rather than
  // been copied, and a reserved place for the builder proper.
  const shell = readShell();

  it("has a Deck Builder button on the main menu", () => {
    expect(shell).toContain(`id="m-decks"`);
    expect(shell).toContain("Deck Builder");
  });

  it("holds the deck library and the importer, and the profile no longer does", () => {
    // MOVED, not copied: two deck libraries would be two places to save a
    // deck and one of them would drift out of the other's sight.
    const builder = section(shell, "private deckBuilderScreen", "private buildPanel");
    expect(builder).toContain("this.deckLibrary()");
    const profile = section(shell, "private profileScreen", "The games this browser is holding");
    expect(profile).not.toContain("this.deckLibrary()");
    expect(profile).toContain(`id="p-decks"`);
  });

  it("offers both ways to start a deck (owner request)", () => {
    // From a precon, and from nothing. The panel that used to be a
    // reserved placeholder is the real builder as of 0.11.09.
    expect(shell).toContain("private buildPanel");
    expect(shell).toContain("Build a deck");
    expect(shell).toContain(`id="db-precon"`);
    expect(shell).toContain(`id="db-scratch"`);
  });

  it("has three tabs, in the order the owner asked for", () => {
    const order = shell.slice(
      shell.indexOf("const DECK_TABS"),
      shell.indexOf("export class Shell"),
    );
    expect(order.indexOf("My decks")).toBeGreaterThan(-1);
    expect(order.indexOf("My decks")).toBeLessThan(order.indexOf("Build a deck"));
    expect(order.indexOf("Build a deck")).toBeLessThan(order.indexOf("Card search"));
  });

  it("draws one tab's body rather than hiding two with CSS", () => {
    // The search tab is up to a hundred card scans. Building it and then
    // setting display:none would cost every one of those requests to
    // show somebody their deck list.
    const css = readFileSync(
      join(import.meta.dirname, "..", "..", "src", "ui", "style.css"),
      "utf8",
    );
    expect(css).not.toMatch(/\.dbtab[^{]*\{[^}]*display:\s*none/);
    const screen = section(shell, "private deckBuilderScreen", "private buildPanel");
    expect(screen).toContain("this.deckTab ===");
  });

  it("loads the catalogue lazily, off the first paint", () => {
    // 3MB of card text imported statically would land in the menu's first
    // paint, which docs/pages-design.md counts to the kilobyte.
    const catalogSrc = readFileSync(
      join(import.meta.dirname, "..", "..", "src", "cards", "catalog.ts"),
      "utf8",
    );
    expect(catalogSrc).toMatch(/import\("\.\/catalog\.json"\)/);
    expect(shell).not.toMatch(/^import .*catalog\.json/m);
  });
});

function readShell(): string {
  return readFileSync(join(import.meta.dirname, "..", "..", "src", "ui", "shell.ts"), "utf8");
}

/** The slice of the source between two markers — the body of one method. */
function section(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}
