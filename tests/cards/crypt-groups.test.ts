/**
 * The crypt GROUP rule (p. 4 and p. 6):
 *
 *   "A Methuselah's crypt must be built using vampires from a single
 *    group or from two consecutive groups. This does not restrict a
 *    Methuselah from stealing vampires from other groups through play,
 *    however."
 *
 * Unenforced for the project's whole life, because the pool was groups
 * 5-7 and nothing outside it could be built with. Admitting groups 1-4
 * makes it live: without it a player builds an illegal crypt and nothing
 * says so (docs/pool-widening-design.md §5).
 *
 * The second sentence is why this is a DECK-CONSTRUCTION check and never
 * an engine one — a vampire of any group can end up under your control
 * mid-game, and that is legal.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import type { DeckList } from "../../src/ui/decks.ts";
import { cryptGroupProblem, MIN_CRYPT, validateDecks } from "../../src/ui/decks.ts";

const reg = registry as unknown as CardRegistry;

/** Twelve real crypt ids from the given group, or null if the pool has
 *  too few — a fixture that cannot be built must not silently pass. */
function cryptFrom(group: number): number[] | null {
  const ids = Object.values(reg.entries)
    .filter((e) => e.card.kind === "crypt" && Number(e.card.group) === group)
    .map((e) => e.card.id);
  return ids.length > 0 ? Array.from({ length: MIN_CRYPT }, (_, i) => ids[i % ids.length]!) : null;
}

describe("the group rule, as a rule", () => {
  it("allows a single group", () => {
    expect(cryptGroupProblem([5, 5, 5])).toBeNull();
    expect(cryptGroupProblem([2])).toBeNull();
    expect(cryptGroupProblem([])).toBeNull();
  });

  it("allows two CONSECUTIVE groups", () => {
    expect(cryptGroupProblem([5, 6, 5, 6])).toBeNull();
    expect(cryptGroupProblem([1, 2])).toBeNull();
    expect(cryptGroupProblem([6, 7])).toBeNull();
  });

  it("refuses two groups that are not consecutive", () => {
    expect(cryptGroupProblem([5, 7])).toMatch(/groups 5, 7/);
    expect(cryptGroupProblem([1, 4])).toBeTruthy();
  });

  it("refuses three groups even when they are consecutive", () => {
    // The half that a span check alone would miss: 5, 6, 7 spans two, and
    // is still three groups.
    expect(cryptGroupProblem([5, 6, 7])).toMatch(/groups 5, 6, 7/);
  });

  it("treats ANY as a wildcard, not as a group", () => {
    // Anarch Convert and New Blood print no group and are legal beside
    // any crypt. Counted as a group they would make every deck illegal.
    expect(cryptGroupProblem(["ANY", 5, 6])).toBeNull();
    expect(cryptGroupProblem(["ANY"])).toBeNull();
    expect(cryptGroupProblem(["ANY", 5, 7])).toBeTruthy();
  });
});

describe("the group rule, on a real deck", () => {
  const library = Array.from({ length: 60 }, () => "Blood Doll");
  const deck = (crypt: number[]): DeckList => ({
    kind: "deck",
    seat: "Alice",
    crypt: crypt.map((id) => ({ id })),
    library,
  });

  it("passes a legal crypt and fails an illegal one", () => {
    const g5 = cryptFrom(5);
    const g7 = cryptFrom(7);
    expect(g5, "no group 5 vampires in the pool — fixture is broken").not.toBeNull();
    expect(g7, "no group 7 vampires in the pool — fixture is broken").not.toBeNull();

    // One group: legal, and no group complaint anywhere in the report.
    const legal = validateDecks([deck(g5!)]);
    expect(legal.illegalDecks.filter((d) => /group/.test(d.problem))).toEqual([]);

    // Groups 5 and 7 are two apart: illegal, and it says so.
    const mixed = [...g5!.slice(0, 6), ...g7!.slice(0, 6)];
    const bad = validateDecks([deck(mixed)]);
    expect(bad.ok).toBe(false);
    expect(bad.illegalDecks.some((d) => /consecutive/.test(d.problem))).toBe(true);
  });

  it("says nothing about groups when a crypt id is unknown", () => {
    // An unreadable id has no group, and naming a group problem on top of
    // an unknown-card problem would report the wrong cause.
    const bad = validateDecks([deck(Array.from({ length: MIN_CRYPT }, () => 999999))]);
    expect(bad.badCryptIds).toContain(999999);
    expect(bad.illegalDecks.filter((d) => /group/.test(d.problem))).toEqual([]);
  });
});
