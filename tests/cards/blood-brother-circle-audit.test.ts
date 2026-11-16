import { describe, expect, it } from "vitest";
import { vampireCircle } from "../../src/engine/index.ts";
import { importCryptCard } from "../../src/ui/cardinfo.ts";
import { buildGame, type SnapshotDeck } from "../../src/ui/decks.ts";
import { makeMinion } from "../engine/fixtures.ts";

describe("printed Blood Brother circles", () => {
  it.each([[200170, "Chicago"], [200652, "Torrance"], [200592, "Mexico City"],
    [200319, "Kiev"], [201105, "Kiev"], [200370, "Budapest"]] as const)("imports %i as %s", (id, circle) => {
    expect(importCryptCard(id).printedCircle).toBe(circle);
  });
  it("does not mistake Angelo's any-circle text or New Blood's choice for a printed circle", () => {
    expect(importCryptCard(200094).printedCircle).toBeUndefined();
    expect(importCryptCard(201052).printedCircle).toBeUndefined();
  });
  it("keeps the printed circle in ready, crypt and uncontrolled minions", () => {
    const d = (seat: string): SnapshotDeck => ({ seat, ready: [{ id: 200170 }],
      uncontrolled: [{ vampire: { id: 200170 }, counters: 0 }], crypt: [{ id: 200170 }], library: [], pool: 20 });
    const state = buildGame({ decks: [d("Alice"), d("Bob"), d("Carol")], seed: 1, maxTurns: 40 });
    const a = state.seats[0]!;
    expect(vampireCircle(a.minions[0]!)).toBe("named:Chicago");
    expect(vampireCircle(a.uncontrolled[0]!.card, false)).toBe("named:Chicago");
    expect(vampireCircle(a.crypt[0]!, false)).toBe("named:Chicago");
  });
  it("distinguishes circles of one even when vampires have the same name", () => {
    const a = makeMinion("a", "Alice", { name: "Embrace" });
    const b = makeMinion("b", "Alice", { name: "Embrace" });
    expect(vampireCircle(a)).not.toBe(vampireCircle(b));
  });
});
