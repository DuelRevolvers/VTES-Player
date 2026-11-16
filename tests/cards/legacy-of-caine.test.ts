/**
 * Legacy of Caine (101086): "Master. Put this card on a vampire with a capacity
 * above 6 controlled by another Methuselah. This vampire cannot hunt as normal.
 * He or she may hunt by stealing 1 blood from another vampire as a Ⓓ action."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bob's M (capacity 7) carries Legacy of Caine; it is Bob's turn. */
function setup(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.seat = "Bob";
  turn.phase = "minion";
  Object.assign(minion(state, "M"), { capacity: 7, blood: 1 });
  Object.assign(minion(state, "V1"), { blood: 3, capacity: 5 });
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({ card: { id: "lc", name: "Legacy of Caine" }, seat: "Alice", attachTo: "M", statics: { cannotHunt: true, legacyStealHunt: true }, tags: [] });
  return { state, engine };
}

describe("Legacy of Caine (101086)", () => {
  it("the bearer's ordinary hunt is barred, but a steal from another vampire is offered", () => {
    const { engine } = setup();
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).not.toContain("hunt:M");
    expect(ids).toContain("hunt:M:steal:V1");
  });

  it("the steal takes 1 blood from the target", () => {
    const { state, engine } = setup();
    engine.choose("hunt:M:steal:V1");
    for (let i = 0; i < 60 && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay" || f.kind === "blockAttempt"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
    }
    expect(minion(state, "V1").blood).toBe(2); // exactly 1 blood stolen
  });

  it("is played only on another Methuselah's vampire with capacity above 6", () => {
    const offer = (cap: number) => {
      const state = threeSeatGame();
      const turn = state.frames[0]! as any;
      turn.phase = "master";
      turn.masterActionsLeft = 1;
      Object.assign(minion(state, "M"), { capacity: cap });
      state.seats[0]!.hand = [{ id: "lc", name: "Legacy of Caine" }];
      const engine = new VtesEngine(state, testRegistry);
      return engine.decision()!.options.map((o) => o.id);
    };
    expect(offer(6).some((o) => o.startsWith("play:Legacy of Caine"))).toBe(false);
    const high = offer(7);
    expect(high.some((o) => o.startsWith("play:Legacy of Caine") && o.includes(":M:"))).toBe(true);
    // never on Alice's own vampire (V1 has capacity 5, and it is "another Methuselah" only)
    expect(high.some((o) => o.startsWith("play:Legacy of Caine") && o.includes(":V1:"))).toBe(false);
  });
});
