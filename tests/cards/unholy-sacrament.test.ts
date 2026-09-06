/**
 * Unholy Sacrament (102345) — a one-shot master: "add 3 blood to a titled
 * Sabbat vampire in your uncontrolled region." Exercises the sect +
 * titled filters on the master addUncontrolledBlood one-shot.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Unholy Sacrament (102345)", () => {
  it("adds 3 blood to a titled Sabbat uncontrolled vampire, only", () => {
    const state = threeSeatGame();
    const frame = state.frames[0]!;
    if (frame.kind === "turn") {
      frame.phase = "master";
      frame.masterActionsLeft = 1;
    }
    const alice = state.seats[0]!;
    // U: titled Sabbat (valid). Y: Sabbat but untitled. X: titled Camarilla.
    alice.uncontrolled.push({ card: makeMinion("U", "Alice", { sect: "sabbat", title: "bishop", capacity: 5, blood: 0 }), counters: 0 });
    alice.uncontrolled.push({ card: makeMinion("Y", "Alice", { sect: "sabbat", title: null, capacity: 5, blood: 0 }), counters: 0 });
    alice.uncontrolled.push({ card: makeMinion("X", "Alice", { sect: "camarilla", title: "prince", capacity: 5, blood: 0 }), counters: 0 });
    alice.hand.push({ id: "us0", name: "Unholy Sacrament" });
    const engine = new VtesEngine(state, testRegistry);

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Unholy Sacrament:-:U"))).toBe(true);
    expect(ids.some((i) => i.startsWith("play:Unholy Sacrament:-:Y"))).toBe(false); // untitled
    expect(ids.some((i) => i.startsWith("play:Unholy Sacrament:-:X"))).toBe(false); // non-Sabbat

    runTrace(engine, [
      ["Alice", "play:Unholy Sacrament:-:U"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);

    expect(alice.uncontrolled.find((u) => u.card.id === "U")!.counters).toBe(3);
    expect(alice.pool).toBe(7); // 10 − 3 pool cost
  });
});
