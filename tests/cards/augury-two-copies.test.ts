import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// Augury of Doom (102310): "A Methuselah can have only one Augury of Doom."
// Each Methuselah may hold one copy, and each copy taxes its OWN prey during
// that prey's unlock phase. Two copies in play must not interfere.

function inPlay(id: string, name: string, controller: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [name], controller } as PermanentInPlay;
}
function seatOf(state: GameState, id: string) {
  return state.seats.find((x) => x.id === id)!;
}
function unlockPhase(state: GameState, seat: string): Record<string, number> {
  const before = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "unlock";
  tf.unlockDone = false;
  new VtesEngine(state, testRegistry).decision();
  return Object.fromEntries(state.seats.map((s) => [s.id, (before[s.id] ?? 0) - s.pool]));
}

describe("two Augury of Doom copies, one per Methuselah", () => {
  it("each copy taxes only its own prey, with its own torpor count", () => {
    const state = threeSeatGame();
    // Alice's prey is Bob; Bob's prey is Carol (seating ring of three).
    seatOf(state, "Alice").permanents.push(inPlay("adA", "Augury of Doom", "Alice"));
    seatOf(state, "Bob").permanents.push(inPlay("adB", "Augury of Doom", "Bob"));
    seatOf(state, "Bob").minions.push(makeMinion("W2", "Bob"));
    for (const id of ["W", "W2"]) state.seats.flatMap((s) => s.minions).find((m) => m.id === id)!.inTorpor = true;
    state.seats.flatMap((s) => s.minions).find((m) => m.id === "N")!.inTorpor = true;

    expect(unlockPhase(state, "Bob")["Bob"]).toBe(2); // Alice's copy: Bob has two in torpor
    expect(unlockPhase(state, "Carol")["Carol"]).toBe(1); // Bob's copy: Carol has one in torpor
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "adA")).toBe(true);
    expect(seatOf(state, "Bob").permanents.some((p) => p.card.id === "adB")).toBe(true);
  });

  it("the second copy of one Methuselah is refused while the first is in play", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(inPlay("adA", "Augury of Doom", "Alice"));
    state.seats[0]!.hand.push({ id: "ad2", name: "Augury of Doom" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.kind === "playCard" && o.name === "Augury of Doom")).toBe(false);
  });
});
