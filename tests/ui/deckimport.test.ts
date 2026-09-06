/**
 * The deck importer (docs/deck-import-design.md).
 *
 * The standing rule is CLAUDE.md's: validate against the registry and
 * report unsupported cards — never silently drop or break. So most of
 * what is pinned here is the REPORTING: what happens to a line the
 * importer cannot use, and whether the deck it hands back is honest.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry, CryptCardDef } from "../../src/cards/types.ts";
import {
  findCard,
  importDeck,
  preconDeck,
  supportedPrecons,
  supportedSets,
} from "../../src/ui/deckimport.ts";
import { buildGame, MIN_CRYPT, MIN_LIBRARY, validateDecks } from "../../src/ui/decks.ts";

const reg = registry as unknown as CardRegistry;

/** A real precon, written out the way a given site would export it. */
function exportPrecon(
  set: string,
  name: string,
  style: "ardb" | "jol" | "lackey" | "vdb",
): string {
  const deck = preconDeck(set, name, "Alice")!;
  const crypt = new Map<number, number>();
  for (const v of deck.crypt) crypt.set(v.id, (crypt.get(v.id) ?? 0) + 1);
  const library = new Map<string, number>();
  for (const n of deck.library) library.set(n, (library.get(n) ?? 0) + 1);

  const lines: string[] = [];
  if (style !== "jol") lines.push(`Deck Name: ${name}`, "Author: nobody", "");
  lines.push(style === "ardb" ? `Crypt [${deck.crypt.length} vampires]` : "Crypt:");
  for (const [id, n] of crypt) {
    const c = reg.entries[id]!.card as CryptCardDef;
    const bare = c.name.replace(/ \(G\d+\)$/, "");
    if (style === "ardb") {
      // Padded columns: capacity, disciplines, clan:group.
      const discs = Object.keys(c.disciplines).join(" ").toLowerCase();
      lines.push(`${n}  ${bare.padEnd(26)} ${c.capacity}  ${discs.padEnd(20)} ${c.clan}:${c.group}`);
    } else if (style === "lackey") lines.push(`${n}\t${bare}`);
    else if (style === "vdb") lines.push(`${n}x ${c.name}`);
    else lines.push(`${n} ${bare}`);
  }
  lines.push("", style === "ardb" ? `Library [${deck.library.length} cards]` : "Library:");
  for (const [card, n] of library) {
    if (style === "lackey") lines.push(`${n}\t${card}`);
    else if (style === "vdb" || style === "ardb") lines.push(`${n}x ${card}`);
    else lines.push(`${n} ${card}`);
  }
  return lines.join("\n");
}

const SET = "Fifth Edition (Anarch)";
const PRECON = "Brujah";

describe("reading a pasted deck list", () => {
  it("reads the same deck out of every site's export format", () => {
    // VDB, Amaranth, ARDB, JOL, Lackey and the TWD archive disagree only
    // about decoration. One parser, four spellings of one deck.
    for (const style of ["ardb", "jol", "lackey", "vdb"] as const) {
      const { deck, report } = importDeck(exportPrecon(SET, PRECON, style), "Alice");
      expect(report.unknown, `${style} produced unknown lines`).toEqual([]);
      expect(report.illegal, `${style} was called illegal`).toEqual([]);
      expect(report.ok, `${style} did not import`).toBe(true);
      expect(deck!.crypt).toHaveLength(12);
      expect(deck!.library).toHaveLength(77);
    }
  });

  it("round-trips every playable precon in the pool", () => {
    // The strongest available check: 661 real cards, real counts, real
    // names with accents and punctuation, and no hand-written fixture to
    // rot. If a name ever stops resolving, this says which deck.
    for (const p of supportedPrecons().filter((p) => p.playable)) {
      const { report } = importDeck(exportPrecon(p.set, p.name, "ardb"), "Alice");
      expect(report.unknown, `${p.set}/${p.name}`).toEqual([]);
      expect(report.ok, `${p.set}/${p.name}: ${report.illegal.join("; ")}`).toBe(true);
      expect(report.cryptCount).toBe(p.cryptCount);
      expect(report.libraryCount).toBe(p.libraryCount);
    }
  });

  it("ignores headers, titles and blank lines without complaining", () => {
    // These never claimed to be cards, so they are not failures to report.
    const { report } = importDeck(
      ["Deck Name: Test", "Author: someone", "", "Crypt (12 cards, min 6)", "Master (20)"].join(
        "\n",
      ),
      "Alice",
    );
    expect(report.unknown).toEqual([]);
    expect(report.deckName).toBe("Test");
  });

  it("takes the LONGEST name that matches, not the first", () => {
    // "Archon" and "Archon Investigation" are both real cards, as are
    // "Dominate" and "Dominate Kine". A shortest-first parser would read
    // the wrong card and never say so.
    expect(importDeck("2 Archon Investigation", "A").report.library[0]!.name).toBe(
      "Archon Investigation",
    );
    expect(importDeck("2 Archon", "A").report.library[0]!.name).toBe("Archon");
    expect(importDeck("2 Dominate Kine", "A").report.library[0]!.name).toBe("Dominate Kine");
  });

  it("reads a card whose name starts with punctuation", () => {
    // `.44 Magnum` is the trap: a count separator that swallows the first
    // character reads it as "44 Magnum" and calls a real card unknown.
    // Found by round-tripping the Tremere precon, not by imagining it.
    for (const line of ["1x .44 Magnum", "1 .44 Magnum", "1\t.44 Magnum"]) {
      expect(importDeck(line, "A").report.library[0]?.name, line).toBe(".44 Magnum");
    }
    // ...and a punctuation SEPARATOR still works, because it is the one
    // followed by a space.
    expect(importDeck("2. Blood Doll", "A").report.library[0]!.name).toBe("Blood Doll");
    expect(importDeck("2 - Blood Doll", "A").report.library[0]!.name).toBe("Blood Doll");
  });

  it("folds a card listed twice rather than importing it twice", () => {
    // Some exports split the library by card type, so a card can appear in
    // two sections.
    const { report } = importDeck("2 Blood Doll\n3 Blood Doll", "A");
    expect(report.library).toHaveLength(1);
    expect(report.library[0]!.copies).toBe(5);
  });
});

describe("matching names people actually paste", () => {
  it("survives lost accents, straightened quotes and a missing trademark", () => {
    expect(findCard("Kuyen")!.name).toBe("Kuyén (G6)");
    expect(findCard("dia de los muertos")!.name).toBe("Día de los Muertos");
    expect(findCard("Pentex Subversion")!.name).toBe("Pentex™ Subversion");
    expect(findCard("Jason “Son” Newberry")!.name).toBe('Jason "Son" Newberry (G6)');
  });

  it("takes a crypt name with or without its group suffix", () => {
    expect(findCard("Ariane")!.id).toBe(findCard("Ariane (G5)")!.id);
    expect(findCard("ariane (g5)")!.name).toBe("Ariane (G5)");
  });

  it("...and no two crypt cards collide once the group is stripped", () => {
    // The bare-name index silently prefers one of a colliding pair, so the
    // absence of collisions is load-bearing, not a coincidence to rely on.
    const seen = new Map<string, string>();
    for (const e of Object.values(reg.entries)) {
      if (e.card.kind !== "crypt") continue;
      const bare = e.card.name.replace(/ \(G\d+\)$/, "").toLowerCase();
      expect(seen.has(bare), `${bare} is used by two crypt cards`).toBe(false);
      seen.set(bare, e.card.name);
    }
  });
});

describe("telling the player what is wrong", () => {
  const good = exportPrecon(SET, PRECON, "vdb");

  it("reports an unknown card with its line, and refuses the deck", () => {
    // Never silently dropped: a deck that lost a card is not the deck the
    // player built.
    const text = `${good}\n2x Sword of Nuln`;
    const { deck, report } = importDeck(text, "Alice");
    expect(deck).toBeNull();
    expect(report.ok).toBe(false);
    expect(report.unknown).toHaveLength(1);
    expect(report.unknown[0]!.text).toContain("Sword of Nuln");
    expect(report.unknown[0]!.line).toBe(text.split("\n").length);
  });

  it("refuses a crypt that mixes non-consecutive groups (p. 4)", () => {
    const g5 = Object.values(reg.entries).find(
      (e) => e.card.kind === "crypt" && e.card.group === 5,
    )!.card;
    const g7 = Object.values(reg.entries).find(
      (e) => e.card.kind === "crypt" && e.card.group === 7,
    )!.card;
    const { report } = importDeck(`6 ${g5.name}\n6 ${g7.name}\n60 Blood Doll`, "A");
    expect(report.ok).toBe(false);
    expect(report.illegal.join(" ")).toContain("groups 5, 7");
    // ...and two CONSECUTIVE groups are fine, which is the same sentence.
    const g6 = Object.values(reg.entries).find(
      (e) => e.card.kind === "crypt" && e.card.group === 6,
    )!.card;
    expect(importDeck(`6 ${g5.name}\n6 ${g6.name}\n60 Blood Doll`, "A").report.illegal).toEqual(
      [],
    );
  });

  it("refuses a deck that is the wrong size (p. 14)", () => {
    const small = importDeck("11 Ariane\n60 Blood Doll", "A").report;
    expect(small.illegal.join(" ")).toContain(`at least ${MIN_CRYPT}`);
    const short = importDeck("12 Ariane\n59 Blood Doll", "A").report;
    expect(short.illegal.join(" ")).toContain(String(MIN_LIBRARY));
    const big = importDeck("12 Ariane\n91 Blood Doll", "A").report;
    expect(big.illegal.join(" ")).toContain("91");
  });

  it("names vampires whose ability does nothing, but still plays the deck", () => {
    // Not fatal: the vampire is a real card with real stats, and 118 of
    // the crypt print a bare sect line and need no code at all.
    const { report } = importDeck(good, "Alice");
    expect(report.ok).toBe(true);
    expect(Array.isArray(report.inertAbilities)).toBe(true);
  });
});

describe("what this client can play", () => {
  it("lists the sets from the registry, not from a hand-kept copy", () => {
    expect(supportedSets()).toEqual(reg.pool);
    expect(supportedSets().length).toBeGreaterThan(0);
  });

  it("lists every precon, and says which are playable as printed", () => {
    const all = supportedPrecons();
    expect(all.length).toBe(reg.precons.length);
    expect(all.length).toBeGreaterThan(0);
    // The full-size decks are playable; the New Blood starters are half
    // decks on purpose and must say so rather than look broken.
    const playable = all.filter((p) => p.playable);
    expect(playable.length).toBeGreaterThan(0);
    for (const p of all.filter((p) => !p.playable)) {
      expect(p.problems.length).toBeGreaterThan(0);
      expect(p.set).toMatch(/New Blood/);
    }
    // The library is fully implemented, so nothing is held back for that.
    for (const p of all) expect(p.unsupported).toEqual([]);
  });

  it("hands back a precon that actually deals a legal game", () => {
    const decks = ["Alice", "Bob", "Carol"].map((seat) => preconDeck(SET, PRECON, seat)!);
    expect(validateDecks(decks).ok).toBe(true);
    const state = buildGame({ decks, seed: 9, maxTurns: 40 });
    for (const s of state.seats) {
      expect(s.hand).toHaveLength(7);
      expect(s.uncontrolled).toHaveLength(4);
      expect(s.pool).toBe(30);
    }
  });

  it("answers null for a precon that does not exist", () => {
    expect(preconDeck("Nope", "Nope", "A")).toBeNull();
  });
});
