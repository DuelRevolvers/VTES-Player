/**
 * Saving over a deck you are already editing
 * (docs/deck-builder-design.md §12, owner request 2026-09-22).
 *
 * THIS FILE NEEDS A `localStorage`, and that is why it exists separately.
 * The deck store is the one part of the UI that is not a pure function —
 * every other test in `tests/ui/` gets away with none because the shell
 * has no jsdom. A dozen lines of in-memory shim buys the ability to test
 * the thing the owner actually reported, which is a round trip through
 * the store: save, edit, save again, and find ONE deck rather than two or
 * an error.
 *
 * The shim is deliberately faithful about the two behaviours the store
 * guards against: it throws when asked to exceed a quota, and it hands
 * back only strings.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { DeckSource } from "../../src/ui/newgame.ts";

class MemoryStorage {
  private map = new Map<string, string>();
  /** Set above zero to make the next write fail, like a full quota. */
  limit = Infinity;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (v.length > this.limit) throw new Error("QuotaExceededError");
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

// Imported AFTER the shim is in place: the module reads `localStorage`
// lazily inside each function, but a future refactor that cached it at
// import time would otherwise fail here for a confusing reason.
const { deleteDeck, findDeckLoosely, loadDecks, replaceDeck, saveDeck } = await import(
  "../../src/ui/decklibrary.ts"
);

const deck = (text: string): DeckSource => ({ kind: "paste", text });

beforeEach(() => {
  store.limit = Infinity;
  for (const d of loadDecks()) deleteDeck(d.name);
  expect(loadDecks()).toEqual([]);
});

describe("adding a deck", () => {
  it("still refuses a duplicate name, because ADDING one is not overwriting", () => {
    // The rule `saveDeck` enforces has not changed and must not: the
    // "Add a deck" box on My decks is a different act from Save in the
    // builder, and it should still stop you making two decks alike.
    expect(saveDeck("Malkavian", deck("a"))).toBeNull();
    expect(saveDeck("Malkavian", deck("b"))).toMatch(/already have a deck/i);
    expect(loadDecks().length).toBe(1);
  });
});

describe("saving over a deck", () => {
  it("replaces the contents and leaves ONE deck", () => {
    saveDeck("Malkavian", deck("first"));
    expect(replaceDeck("Malkavian", "Malkavian", deck("second"))).toBeNull();
    const all = loadDecks();
    expect(all.length).toBe(1);
    expect((all[0]!.source as { text: string }).text).toBe("second");
  });

  it("keeps the deck's PLACE in the list", () => {
    // Delete-then-save would work and would move the deck to the top
    // every time you pressed Save — a list that reorders itself under
    // you for no reason you can see.
    saveDeck("oldest", deck("a"));
    saveDeck("middle", deck("b"));
    saveDeck("newest", deck("c"));
    const before = loadDecks().map((d) => d.name);
    replaceDeck("middle", "middle", deck("edited"));
    expect(loadDecks().map((d) => d.name)).toEqual(before);
  });

  it("keeps the date it was CREATED, not the date it was last touched", () => {
    saveDeck("Malkavian", deck("a"));
    const created = loadDecks()[0]!.created;
    replaceDeck("Malkavian", "Malkavian", deck("b"));
    expect(loadDecks()[0]!.created).toBe(created);
  });

  it("can rename in place, and does not leave the old name behind", () => {
    saveDeck("Working title", deck("a"));
    expect(replaceDeck("Working title", "Final name", deck("a"))).toBeNull();
    expect(loadDecks().map((d) => d.name)).toEqual(["Final name"]);
  });

  it("refuses a rename onto a DIFFERENT existing deck", () => {
    // The name rule still applies to everything except the deck being
    // written over — otherwise "save as" would silently merge two decks.
    saveDeck("Keep", deck("a"));
    saveDeck("Edit", deck("b"));
    expect(replaceDeck("Edit", "Keep", deck("c"))).toMatch(/already have a deck/i);
    expect(loadDecks().length).toBe(2);
  });

  it("matches the target without case, the way the name rule does", () => {
    // `deckNameProblem` collides case-insensitively, so a lookup that
    // did not would ask "overwrite?", be told yes, and then fail the
    // duplicate check anyway.
    saveDeck("Malkavian", deck("a"));
    expect(findDeckLoosely("MALKAVIAN")?.name).toBe("Malkavian");
    expect(replaceDeck("malkavian", "Malkavian", deck("b"))).toBeNull();
    expect(loadDecks().length).toBe(1);
  });

  it("still checks the name is a usable one", () => {
    saveDeck("Malkavian", deck("a"));
    expect(replaceDeck("Malkavian", "", deck("b"))).toMatch(/name is needed/i);
    expect(replaceDeck("Malkavian", "x".repeat(200), deck("b"))).toMatch(/at most/i);
  });

  it("adds the deck when the target has gone", () => {
    // A second tab deleted it between opening and saving. Pressing Save
    // must not silently lose the deck.
    expect(replaceDeck("never existed", "Rescued", deck("a"))).toBeNull();
    expect(loadDecks().map((d) => d.name)).toEqual(["Rescued"]);
  });

  it("reports a storage failure rather than pretending it saved", () => {
    saveDeck("Malkavian", deck("a"));
    store.limit = 1;
    expect(replaceDeck("Malkavian", "Malkavian", deck("b"))).toBeTruthy();
  });
});
