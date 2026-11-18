import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState, type PermanentInPlay } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// Shilmulo Tarot (101767): "if you would draw a card from your library, you
// can draw one of these cards instead". G00160 (LSJ 20060620): draw as much as
// you can, even from an empty library. So an empty library with cards still
// stored is not yet the exhausted state that p. 38 needs for a withdrawal.

const cards = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${i}` }));

function tarot(state: GameState, stored: Array<{ id: string; name: string }>) {
  const minion = makeMinion("ravnos-Alice", "Alice", { clan: "Ravnos" });
  const entry: PermanentInPlay = {
    card: { id: "tarot-Alice", name: "Shilmulo Tarot" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["Shilmulo Tarot"],
    stored,
  } as PermanentInPlay;
  minion.attached.push(entry);
  state.seats.find((s) => s.id === "Alice")!.minions.push(minion);
  return entry;
}

const canWithdraw = (engine: VtesEngine): boolean =>
  (engine as unknown as { canAnnounceWithdrawal(seat: string): boolean }).canAnnounceWithdrawal("Alice");

describe("Shilmulo Tarot: withdrawal with an empty library", () => {
  it("an empty library with a short hand allows withdrawal when nothing is stored", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand = cards("h", 2);
    state.seats[0]!.library = [];
    const engine = new VtesEngine(state, testRegistry);
    expect(canWithdraw(engine)).toBe(true);
  });

  it("not while the Tarot still holds cards that could be drawn", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand = cards("h", 2);
    state.seats[0]!.library = [];
    tarot(state, cards("s", 2));
    const engine = new VtesEngine(state, testRegistry);
    expect(canWithdraw(engine)).toBe(false);
  });

  it("is allowed again once the Tarot has been emptied", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand = cards("h", 2);
    state.seats[0]!.library = [];
    const entry = tarot(state, []);
    const engine = new VtesEngine(state, testRegistry);
    expect(canWithdraw(engine)).toBe(true);
    entry.stored = [];
    expect(canWithdraw(engine)).toBe(true);
  });
});
