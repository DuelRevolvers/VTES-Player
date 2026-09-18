/**
 * Buying a block (docs/buying-a-block-design.md).
 *
 * Legwork (101093), Pack Tactics (101343), Eluding the Arms of Morpheus
 * (100628) — three reactions that each pay a different price to get a
 * block in.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string) {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

function statics(id: string, s: Record<string, unknown>): PermanentInPlay {
  return { card: { id, name: id }, locked: false, usedThisPhase: false, statics: s, tags: [] } as never;
}

/**
 * Alice bleeds with 1 stealth; Bob holds `cards` and is the one bled.
 *
 * The stealth is not decoration: intercept is only offered when it is
 * NEEDED (p. 26), so a bare 0-vs-0 bleed offers none of these cards.
 */
function bleedAt(cards: string[]) {
  const state = threeSeatGame();
  cards.forEach((name, i) => state.seats[1]!.hand.push({ id: `r${i}`, name }));
  find(state, "V1").attached.push(statics("cloak", { stealth: 1 }));
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"]]);
  toBob(engine, "block:W");
  // An intercept reaction is offered inside the BLOCK ATTEMPT, not in
  // state A: the compiler asks `ba.blocker === this minion`.
  runTrace(engine, [["Bob", "block:W"]]);
  toBob(engine, cards[0]!);
  return { state, engine };
}

/** Pass until Bob is the seat being asked — reactions live in state A,
 *  not in the announce cycle. */
function toBob(engine: VtesEngine, want?: string, steps = 16): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (dp.seat === "Bob" && (want === undefined || dp.options.some((o) => o.id.includes(want)))) {
      return;
    }
    engine.choose("pass");
  }
}

function bobOptions(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

// ---------------------------------------------------------------------------

describe("Legwork (101093)", () => {
  it("NEGATIVE SPACE: only for a vampire with no intercept of its own", () => {
    const { engine } = bleedAt(["Legwork"]);
    expect(bobOptions(engine).some((i) => i.includes("Legwork"))).toBe(true);

    const { state, engine: e2 } = bleedAt(["Legwork"]);
    find(state, "W").attached.push(statics("eye", { intercept: 1 }));
    // Re-derive: the option list is computed fresh each decision.
    expect(bobOptions(e2).some((i) => i.includes("Legwork:-:W"))).toBe(false);
  });
});

describe("Pack Tactics (101343) and Elder Intervention", () => {
  it("bars the SAME vampire from playing both in one action", () => {
    const { engine } = bleedAt(["Pack Tactics", "Elder Intervention"]);
    const first = bobOptions(engine).find((i) => i.includes("Pack Tactics:basic:W"))!;
    expect(bobOptions(engine).some((i) => i.includes("Elder Intervention:basic:W"))).toBe(true);
    runTrace(engine, [["Bob", first]]);
    // Out of the as-played window and back to Bob's own impulse. Walking
    // until Elder Intervention APPEARS would be the trap: the assertion
    // below is that it never does.
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || (dp.seat === "Bob" && dp.window !== "card.asPlayed")) break;
      engine.choose("pass");
    }
    // The intercept window is still open (W could still play more), but
    // Elder Intervention is gone from it.
    expect(bobOptions(engine).some((i) => i.includes("Elder Intervention"))).toBe(false);
  });
});

describe("Eluding the Arms of Morpheus (100628)", () => {
  it("lets a LOCKED vampire unlock and block", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "el", name: "Eluding the Arms of Morpheus" });
    find(state, "W").locked = true;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    toBob(engine, "Eluding");
    const id = bobOptions(engine).find((i) => i.includes("Eluding"))!;
    expect(id).toBeDefined();
    runTrace(engine, [["Bob", id]]);
    for (let i = 0; i < 10; i++) {
      if (state.eventLog.some((e) => e.type === "BlockSucceeded")) break;
      if (!engine.decision()) break;
      engine.choose("pass");
    }
    // It unlocked and went straight into the attempt — and a successful
    // block locks it again (p. 27), so the LOCK is not the evidence.
    expect(
      state.eventLog.some((e) => e.type === "BlockSucceeded" && e.blocker === "W"),
    ).toBe(true);
  });
});
