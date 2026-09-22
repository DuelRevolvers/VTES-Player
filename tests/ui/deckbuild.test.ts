/**
 * The deck builder (docs/deck-builder-design.md §5).
 *
 * THE RULES ARE THE RISK HERE, not the arithmetic. A deck builder that
 * counts wrong is caught the first time somebody looks at it; a deck
 * builder that invents a rule is not, because an invented rule looks
 * exactly like a rule. VTES has three that builders routinely get
 * wrong, and each has a test below that would fail if this one drifted
 * into the common mistake:
 *
 *  1. There is NO per-card copy limit. "A Methuselah can include any
 *     number of copies of a given card in either their library or
 *     crypt" (p. 14). Builders love to cap this at 7 or 10.
 *  2. There is NO crypt maximum. "There is no maximum limit on the
 *     number of cards Methuselahs can have in their crypt" (p. 14).
 *  3. Duplicated unique cards are LEGAL. The rulebook's own word is
 *     "CAUTION" (p. 14) — you simply cannot control two at once.
 *
 * And one that is not a rule of the game at all: the word "banned"
 * appears NOWHERE in the V5 rulebook. It is a VEKN tournament
 * restriction, so it may never be reported as illegality.
 */

import { describe, expect, it } from "vitest";
import catalog from "../../src/cards/catalog.json";
import type { CatalogCard, CatalogFile } from "../../src/cards/catalog.ts";
import { MAX_LIBRARY, MIN_CRYPT, MIN_LIBRARY } from "../../src/ui/decks.ts";
import { importDeck } from "../../src/ui/deckimport.ts";
import { buildTable, defaultTable } from "../../src/ui/newgame.ts";
import {
  countsOf,
  draftCards,
  draftToText,
  emptyDraft,
  indexCatalog,
  isUnique,
  LIBRARY_TYPE_ORDER,
  parseDraft,
  reviewDraft,
  sectionOf,
  setCount,
  withCard,
} from "../../src/ui/deckbuild.ts";

const file = catalog as unknown as CatalogFile;
const { byId, byName } = indexCatalog(file);

/** A card by exact name, or a loud failure — never a silent substitute. */
function card(name: string): CatalogCard {
  const found = byName.get(name.toLowerCase());
  if (!found) throw new Error(`no card named "${name}" in the catalogue`);
  return found;
}

/**
 * A legal deck, built from real cards.
 *
 * THE FIXTURE BUILDS WHAT IT NEEDS rather than guarding on it: a test
 * that skipped when it could not find 12 vampires would pass forever
 * while testing nothing (CLAUDE.md, "a guard clause in a test is a
 * silent skip").
 */
function legalDeck(): ReturnType<typeof emptyDraft> {
  // One group, so the p. 4 rule is satisfied for a reason rather than by
  // luck — and enough capacity spread to be a real crypt.
  const vampires = file.cards
    .filter((c) => c.kind === "crypt" && c.group === "6" && c.status === "playable")
    .slice(0, 4);
  expect(vampires.length).toBe(4);
  const libs = file.cards
    .filter((c) => c.kind === "library" && c.status === "playable" && !isUnique(c) && !c.banned)
    .slice(0, 6);
  expect(libs.length).toBe(6);

  let draft = emptyDraft("Test deck");
  for (const v of vampires) draft = setCount(draft, v.id, 3); // 12 crypt
  for (const l of libs) draft = setCount(draft, l.id, 10); // 60 library
  return draft;
}

describe("editing a draft", () => {
  it("counts copies, and drops a card when the last one goes", () => {
    const gun = card(".44 Magnum");
    let d = emptyDraft();
    d = withCard(d, gun.id, 1);
    d = withCard(d, gun.id, 1);
    expect(d.counts[gun.id]).toBe(2);
    d = withCard(d, gun.id, -1);
    d = withCard(d, gun.id, -1);
    // GONE, not zero. "Is it in the deck" must be one question.
    expect(gun.id in d.counts).toBe(false);
  });

  it("never goes below zero, however hard you press minus", () => {
    const gun = card(".44 Magnum");
    let d = emptyDraft();
    for (let i = 0; i < 5; i++) d = withCard(d, gun.id, -1);
    expect(d.counts[gun.id]).toBeUndefined();
    expect(countsOf(draftCards(d, byId))).toEqual({ crypt: 0, library: 0 });
  });

  it("puts NO ceiling on copies of one card (p. 14)", () => {
    // The rule builders most often invent. A real Ventrue deck runs a
    // dozen Govern the Unaligned; a cap would make it unbuildable.
    const govern = card("Govern the Unaligned");
    let d = emptyDraft();
    d = setCount(d, govern.id, 40);
    expect(d.counts[govern.id]).toBe(40);
    expect(reviewDraft(d, byId).illegal.join(" ")).not.toMatch(/copies|too many|maximum/i);
  });

  it("drops an id the catalogue does not know rather than throwing", () => {
    const d = setCount(emptyDraft(), 99999999, 3);
    expect(draftCards(d, byId)).toEqual([]);
  });
});

describe("what the rules actually say", () => {
  it("accepts a deck at exactly the minimums", () => {
    const review = reviewDraft(legalDeck(), byId);
    expect(review.counts).toEqual({ crypt: MIN_CRYPT, library: MIN_LIBRARY });
    // A POSITIVE CASE. A suite of nothing but rejections tells you about
    // the fixture, not the rule (CLAUDE.md).
    expect(review.illegal).toEqual([]);
    expect(review.legal).toBe(true);
    expect(review.dealable).toBe(true);
  });

  it("refuses a crypt of 11 and accepts one of 12", () => {
    const base = legalDeck();
    // A CRYPT card, named explicitly. `Object.keys(counts)[0]` would be
    // the lowest ID — and JS orders numeric-like keys ascending, so that
    // is a LIBRARY card (100xxx sorts below 200xxx). The test would then
    // have removed the wrong card and asserted the wrong message.
    const vampire = draftCards(base, byId).find((r) => r.card.kind === "crypt")!.card;
    const short = withCard(base, vampire.id, -1);
    expect(reviewDraft(short, byId).counts.crypt).toBe(MIN_CRYPT - 1);
    expect(reviewDraft(short, byId).illegal.join(" ")).toContain("crypt");
    expect(reviewDraft(short, byId).legal).toBe(false);
    expect(reviewDraft(base, byId).legal).toBe(true);
  });

  it("puts NO ceiling on the crypt (p. 14)", () => {
    // "There is no maximum limit on the number of cards Methuselahs can
    // have in their crypt." A 60-card crypt is legal and daft.
    let d = legalDeck();
    const vampire = draftCards(d, byId).find((r) => r.card.kind === "crypt")!.card;
    d = setCount(d, vampire.id, 50);
    const review = reviewDraft(d, byId);
    expect(review.counts.crypt).toBeGreaterThan(50);
    expect(review.illegal).toEqual([]);
  });

  it("holds the library between 60 and 90, and complains at both ends", () => {
    const base = legalDeck();
    const lib = draftCards(base, byId).find((r) => r.card.kind === "library")!.card;
    const thin = withCard(base, lib.id, -1);
    expect(reviewDraft(thin, byId).illegal.join(" ")).toContain(`at least ${MIN_LIBRARY}`);
    const fat = setCount(base, lib.id, 10 + (MAX_LIBRARY - MIN_LIBRARY) + 1);
    expect(reviewDraft(fat, byId).counts.library).toBe(MAX_LIBRARY + 1);
    expect(reviewDraft(fat, byId).illegal.join(" ")).toContain(`at most ${MAX_LIBRARY}`);
  });

  it("allows two CONSECUTIVE crypt groups and refuses a gap (p. 4)", () => {
    const g = (n: string): CatalogCard[] =>
      file.cards.filter((c) => c.kind === "crypt" && c.group === n && c.status === "playable");
    const [g5, g6, g7] = [g("5"), g("6"), g("7")];
    expect(g5.length && g6.length && g7.length).toBeTruthy();

    const mix = (a: CatalogCard, b: CatalogCard): ReturnType<typeof emptyDraft> => {
      let d = legalDeck();
      // Replace the crypt wholesale so only the groups under test are in it.
      for (const r of draftCards(d, byId)) {
        if (r.card.kind === "crypt") d = setCount(d, r.card.id, 0);
      }
      return setCount(setCount(d, a.id, 6), b.id, 6);
    };
    expect(reviewDraft(mix(g6[0]!, g7[0]!), byId).illegal).toEqual([]);
    // 5 and 7 are two groups but NOT consecutive — the span is what the
    // rule turns on, not the count.
    expect(reviewDraft(mix(g5[0]!, g7[0]!), byId).illegal.join(" ")).toContain("group");
  });
});

describe("what the rules DO NOT say", () => {
  it("treats a duplicated unique card as a CAUTION, never as illegal", () => {
    // p. 14 says "CAUTION: Be careful about putting duplicates of the
    // same unique cards in your deck" — and every vampire is unique, so
    // a builder that called this illegal would reject almost every real
    // deck in existence.
    const review = reviewDraft(legalDeck(), byId);
    const dupes = draftCards(legalDeck(), byId).filter((r) => r.copies > 1 && isUnique(r.card));
    expect(dupes.length).toBeGreaterThan(0);
    expect(review.legal).toBe(true);
    expect(review.illegal).toEqual([]);
    expect(review.cautions.join(" ")).toMatch(/unique/i);
    expect(review.cautions.join(" ")).toMatch(/legal/i);
  });

  it("treats a banned card as a TOURNAMENT restriction, not a rules failure", () => {
    // "banned" appears nowhere in the V5 rulebook. It is a VEKN
    // tournament list, and a deck holding one is still a legal deck.
    const banned = file.cards.find((c) => c.banned && c.kind === "library")!;
    let d = legalDeck();
    const lib = draftCards(d, byId).find((r) => r.card.kind === "library")!.card;
    d = setCount(setCount(d, lib.id, 9), banned.id, 1);
    const review = reviewDraft(d, byId);
    expect(review.counts.library).toBe(MIN_LIBRARY);
    expect(review.illegal).toEqual([]);
    expect(review.legal).toBe(true);
    expect(review.cautions.join(" ")).toMatch(/tournament/i);
  });

  it("knows a vampire is unique unless it says otherwise", () => {
    // Five cards in the game print "Non-unique", which is why this is a
    // negative test and not a list to keep up to date.
    expect(isUnique(card("Aabbt Kindred (G2)"))).toBe(false);
    const ordinary = file.cards.find(
      (c) => c.kind === "crypt" && !/non-unique/i.test(c.text),
    )!;
    expect(isUnique(ordinary)).toBe(true);
    // A library card is unique only when it SAYS so.
    expect(isUnique(card("Aaron's Feeding Razor"))).toBe(true);
    expect(isUnique(card(".44 Magnum"))).toBe(false);
  });
});

describe("what this platform can deal", () => {
  it("separates 'illegal' from 'cannot be dealt here'", () => {
    // THE OWNER'S DECISION (2026-09-22): a deck of real cards this
    // player has not implemented is a LEGAL deck that cannot be dealt.
    // Merging the two would either hide the gap or call the rulebook
    // wrong.
    const absent = file.cards.find((c) => c.kind === "library" && c.status === "absent")!;
    let d = legalDeck();
    const lib = draftCards(d, byId).find((r) => r.card.kind === "library")!.card;
    d = setCount(setCount(d, lib.id, 6), absent.id, 4);
    const review = reviewDraft(d, byId);
    expect(review.counts.library).toBe(MIN_LIBRARY);
    expect(review.legal).toBe(true);
    expect(review.illegal).toEqual([]);
    expect(review.dealable).toBe(false);
    expect(review.unplayable.map((u) => u.card.id)).toEqual([absent.id]);
    expect(review.unplayable[0]!.copies).toBe(4);
  });

  it("calls a deck of only implemented cards dealable", () => {
    const review = reviewDraft(legalDeck(), byId);
    expect(review.unplayable).toEqual([]);
    expect(review.dealable).toBe(true);
  });
});

describe("saving and reopening", () => {
  it("round-trips a draft through the deck-list text exactly", () => {
    const before = legalDeck();
    const text = draftToText(before, byId);
    const { draft: after, unreadable } = parseDraft(text, byName);
    expect(unreadable).toEqual([]);
    expect(after.counts).toEqual(before.counts);
    expect(after.name).toBe("Test deck");
  });

  it("keeps cards this player cannot deal across a save (not importDeck)", () => {
    // THE REASON `parseDraft` EXISTS. `importDeck` resolves against the
    // REGISTRY and would report an unimplemented card as an unknown
    // line — so reopening a saved deck through it would silently delete
    // exactly the cards the builder is meant to be warning about.
    const absent = file.cards.find((c) => c.kind === "library" && c.status === "absent")!;
    const before = setCount(legalDeck(), absent.id, 2);
    const { draft: after, unreadable } = parseDraft(draftToText(before, byId), byName);
    expect(unreadable).toEqual([]);
    expect(after.counts[absent.id]).toBe(2);
  });

  it("writes a list the deck importer can also read", () => {
    // The whole point of the format: a built deck is saved as the same
    // text a pasted one is, so it needs no new plumbing anywhere else.
    const text = draftToText(legalDeck(), byId);
    expect(text).toMatch(/^Deck Name: Test deck$/m);
    expect(text).toMatch(/^Crypt \(12 cards\)$/m);
    expect(text).toMatch(/^Library \(60 cards\)$/m);
    expect(text).toMatch(/^\d+x .+$/m);
  });

  it("produces a deck the REAL importer accepts and can seat", () => {
    // THE INTEGRATION CLAIM, tested rather than asserted in a comment:
    // "a deck built here is saved by the same `saveDeck` and picked in
    // the lobby exactly like one that was pasted in". If that is true,
    // `importDeck` — the thing the lobby actually runs — accepts this
    // text with no problems and the right counts. Nothing else in this
    // file would notice if the two formats drifted apart.
    const text = draftToText(legalDeck(), byId);
    const { deck, report } = importDeck(text, "You");
    // Every line resolved: no unknown names, nothing unimplemented, and
    // no p. 14 complaint from the importer's own copy of the checks.
    expect(report.unknown).toEqual([]);
    expect(report.unsupported).toEqual([]);
    expect(report.illegal).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.cryptCount).toBe(MIN_CRYPT);
    expect(report.libraryCount).toBe(MIN_LIBRARY);
    expect(report.deckName).toBe("Test deck");
    expect(deck).not.toBeNull();
    expect(deck!.crypt.length).toBe(MIN_CRYPT);
    expect(deck!.library.length).toBe(MIN_LIBRARY);
  });

  it("reports a line it cannot read rather than dropping it", () => {
    const { draft, unreadable } = parseDraft("3x Not A Real Card At All\n2x .44 Magnum", byName);
    expect(unreadable).toEqual(["3x Not A Real Card At All"]);
    expect(draft.counts[card(".44 Magnum").id]).toBe(2);
  });

  it("ignores section headers without calling them unreadable", () => {
    // "Crypt (12 cards)" and "Master (10)" are not claims to be cards.
    const { unreadable } = parseDraft("Crypt (12 cards)\nMaster (10)\n\n2x .44 Magnum", byName);
    expect(unreadable).toEqual([]);
  });

  it("adds up two lines naming the same card", () => {
    const { draft } = parseDraft("2x .44 Magnum\n3x .44 Magnum", byName);
    expect(draft.counts[card(".44 Magnum").id]).toBe(5);
  });
});

describe("how the list is ordered", () => {
  it("files a multi-type card under one section, always the same one", () => {
    // "Action Modifier/Reaction" is common, and a decklist files it
    // once. Without a fixed order the section would depend on which type
    // the data happened to list first.
    const both = file.cards.find(
      (c) => c.kind === "library" && c.types.length > 1 && c.types.includes("Reaction"),
    )!;
    const section = sectionOf(both);
    expect(LIBRARY_TYPE_ORDER).toContain(section);
    expect(sectionOf(both)).toBe(section);
    // The earlier type in the conventional order wins.
    const expected = LIBRARY_TYPE_ORDER.find((t) => both.types.includes(t));
    expect(section).toBe(expected);
  });

  it("puts every library type it files under a known section", () => {
    for (const c of file.cards) {
      if (c.kind !== "library") continue;
      expect(typeof sectionOf(c)).toBe("string");
    }
  });

  it("writes the crypt biggest-capacity first", () => {
    const text = draftToText(legalDeck(), byId);
    const crypt = text
      .slice(text.indexOf("Crypt ("), text.indexOf("Library ("))
      .split("\n")
      .filter((l) => /^\d+x /.test(l))
      .map((l) => byName.get(l.replace(/^\d+x /, "").trim().toLowerCase())!.capacity ?? 0);
    expect(crypt.length).toBeGreaterThan(1);
    for (let i = 1; i < crypt.length; i++) expect(crypt[i - 1]!).toBeGreaterThanOrEqual(crypt[i]!);
  });
});

describe("half decks", () => {
  /** The same legal deck, cut to starter size and declared as one. */
  function halfDeck(): ReturnType<typeof emptyDraft> {
    let d = legalDeck();
    for (const r of draftCards(d, byId)) {
      d = setCount(d, r.card.id, r.card.kind === "crypt" ? 1 : 5);
    }
    return { ...d, halfDeck: true };
  }

  it("waives the two minimums, and says it did", () => {
    const short = { ...halfDeck(), halfDeck: false };
    // The SAME deck, declared and undeclared. Without the pair, a test
    // that only checked the declared one would pass just as happily
    // against a builder that had stopped applying the minimums at all.
    const declined = reviewDraft(short, byId);
    expect(declined.counts.crypt).toBeLessThan(MIN_CRYPT);
    expect(declined.counts.library).toBeLessThan(MIN_LIBRARY);
    expect(declined.illegal.length).toBe(2);
    expect(declined.legal).toBe(false);

    const review = reviewDraft(halfDeck(), byId);
    expect(review.counts).toEqual(declined.counts);
    expect(review.illegal).toEqual([]);
    expect(review.legal).toBe(true);
    expect(review.dealable).toBe(true);
    // Carried out, so the screen never has to infer why it passed.
    expect(review.halfDeck).toBe(true);
  });

  it("is exempt from the minimums and from NOTHING else", () => {
    // The exemption `validateDecks` grants a half-deck seat, restated:
    // the library MAXIMUM, the group rule and playability all still bite.
    const g = (n: string): CatalogCard[] =>
      file.cards.filter((c) => c.kind === "crypt" && c.group === n && c.status === "playable");

    const lib = draftCards(halfDeck(), byId).find((r) => r.card.kind === "library")!.card;
    const fat = setCount(halfDeck(), lib.id, MAX_LIBRARY + 1);
    expect(reviewDraft(fat, byId).illegal.join(" ")).toContain(`at most ${MAX_LIBRARY}`);

    let gapped = halfDeck();
    for (const r of draftCards(gapped, byId)) {
      if (r.card.kind === "crypt") gapped = setCount(gapped, r.card.id, 0);
    }
    gapped = setCount(setCount(gapped, g("5")[0]!.id, 2), g("7")[0]!.id, 2);
    expect(reviewDraft(gapped, byId).illegal.join(" ")).toContain("group");

    const absent = file.cards.find((c) => c.kind === "library" && c.status === "absent")!;
    const unplayable = setCount(halfDeck(), absent.id, 1);
    expect(reviewDraft(unplayable, byId).dealable).toBe(false);
  });

  it("writes the declaration into the deck text and reads it back", () => {
    const text = draftToText(halfDeck(), byId);
    expect(text).toMatch(/^Half deck: yes$/m);
    const { draft: reopened } = parseDraft(text, byName);
    expect(reopened.halfDeck).toBe(true);
    expect(reopened.counts).toEqual(halfDeck().counts);
    // And a normal deck says nothing, rather than "Half deck: no" — an
    // absent declaration is the default, so the text stays clean.
    expect(draftToText(legalDeck(), byId)).not.toMatch(/half deck/i);
    expect(parseDraft(draftToText(legalDeck(), byId), byName).draft.halfDeck).toBe(false);
  });

  it("is accepted by the REAL importer, which used to null the deck", () => {
    // THE BUG THIS FEATURE WOULD HAVE SHIPPED WITH. `importDeck` returns
    // `deck: null` whenever `illegal` is non-empty, so before the
    // declaration existed a half deck built here saved perfectly and
    // then could not be dealt — buildable and unusable.
    const text = draftToText(halfDeck(), byId);
    const { deck, report } = importDeck(text, "You");
    expect(report.halfDeck).toBe(true);
    expect(report.illegal).toEqual([]);
    expect(report.ok).toBe(true);
    expect(deck).not.toBeNull();
    expect(deck!.crypt.length).toBeLessThan(MIN_CRYPT);

    // The same list without the declaration is refused, which is what
    // makes the line above a test of the declaration rather than of a
    // minimum that quietly stopped being enforced.
    const undeclared = text.replace(/^Half deck: yes$/m, "");
    const plain = importDeck(undeclared, "You");
    expect(plain.report.halfDeck).toBe(false);
    expect(plain.report.illegal.length).toBeGreaterThan(0);
    expect(plain.deck).toBeNull();
  });

  it("can actually be SEATED at a table", () => {
    // End to end, through the thing the lobby really runs: a built half
    // deck, saved as pasted text, has to survive `buildTable` — which is
    // where `halfDeckSeats` decides whether to waive the minimums, and
    // which only understood PRECONS before 0.11.10.
    const text = draftToText(halfDeck(), byId);
    const table = defaultTable("You", (i) => `Bot ${i}`);
    for (const seat of table.seats) seat.deck = { kind: "paste", text };
    const built = buildTable(table);
    expect(built.problems).toEqual([]);
    expect(built.setup).not.toBeNull();
    expect(built.setup!.decks[0]!.crypt.length).toBeLessThan(MIN_CRYPT);
  });

  it("refuses the same table when the decks do not declare it", () => {
    // The negative control for the test above. Without it, a
    // `halfDeckSeats` that returned every seat would pass just as well.
    const text = draftToText(halfDeck(), byId).replace(/^Half deck: yes$/m, "");
    const table = defaultTable("You", (i) => `Bot ${i}`);
    for (const seat of table.seats) seat.deck = { kind: "paste", text };
    expect(buildTable(table).setup).toBeNull();
    expect(buildTable(table).problems.length).toBeGreaterThan(0);
  });
});

describe("cards no vampire in the deck can play", () => {
  /** A crypt with a known discipline set, plus a library card off it. */
  function withOffDiscipline(): {
    draft: ReturnType<typeof emptyDraft>;
    stray: CatalogCard;
    scope: string[];
  } {
    let d = legalDeck();
    const scope = [
      ...new Set(
        draftCards(d, byId)
          .filter((r) => r.card.kind === "crypt")
          .flatMap((r) => r.card.disciplines),
      ),
    ];
    expect(scope.length).toBeGreaterThan(0);
    // A library card whose every discipline is outside that set.
    const stray = file.cards.find(
      (c) =>
        c.kind === "library" &&
        c.status === "playable" &&
        c.disciplines.length > 0 &&
        c.disciplines.every((x) => !scope.includes(x)),
    )!;
    expect(stray).toBeTruthy();
    const lib = draftCards(d, byId).find((r) => r.card.kind === "library")!.card;
    d = setCount(setCount(d, lib.id, 8), stray.id, 2);
    return { draft: d, stray, scope };
  }

  it("names them, with how many copies", () => {
    const { draft, stray } = withOffDiscipline();
    const review = reviewDraft(draft, byId);
    expect(review.offDiscipline.map((r) => r.card.id)).toEqual([stray.id]);
    expect(review.offDiscipline[0]!.copies).toBe(2);
  });

  it("is a CAUTION, never illegal", () => {
    // Nothing in the rules stops you putting a Dominate card in a
    // Gangrel deck. It just means dead cards.
    const review = reviewDraft(withOffDiscipline().draft, byId);
    expect(review.illegal).toEqual([]);
    expect(review.legal).toBe(true);
    expect(review.dealable).toBe(true);
  });

  it("says nothing about a deck whose cards its crypt can all play", () => {
    // THE POSITIVE CONTROL. Without it, a check that flagged every
    // library card would pass the test above just as happily.
    const review = reviewDraft(legalDeck(), byId);
    expect(review.offDiscipline).toEqual([]);
  });

  it("reports the crypt's disciplines, read off the vampires", () => {
    // Off the VAMPIRES, never off their clans: a Malkavian with
    // Dominate is a real card, and a clan's usual disciplines are a
    // guideline rather than a fact about this crypt.
    const { draft, scope } = withOffDiscipline();
    expect(reviewDraft(draft, byId).cryptDisciplines).toEqual([...scope].sort());
  });

  it("says nothing while the crypt is still empty", () => {
    // Every library card would be "off discipline" with no vampires,
    // which is noise on a deck that is merely unfinished.
    let d = legalDeck();
    for (const r of draftCards(d, byId)) {
      if (r.card.kind === "crypt") d = setCount(d, r.card.id, 0);
    }
    const review = reviewDraft(d, byId);
    expect(review.cryptDisciplines).toEqual([]);
    expect(review.offDiscipline).toEqual([]);
  });

  it("does not report a card that needs no discipline at all", () => {
    const { draft } = withOffDiscipline();
    const free = file.cards.find(
      (c) => c.kind === "library" && c.status === "playable" && c.disciplines.length === 0,
    )!;
    const review = reviewDraft(setCount(draft, free.id, 3), byId);
    expect(review.offDiscipline.map((r) => r.card.id)).not.toContain(free.id);
  });
});
