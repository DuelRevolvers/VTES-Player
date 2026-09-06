/**
 * Wasserschloss Anif, Austria (102152) — master phase: a Tremere moves 1
 * blood to a counter; influence phase: lock to move all counters to a
 * Tremere in the uncontrolled region.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function wasser(counters: number): PermanentInPlay {
  return { card: { id: "wa1", name: "Wasserschloss Anif, Austria" }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"], counters };
}

function phaseGame(phase: "master" | "influence"): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = phase;
    tf.masterActionsLeft = 1;
    tf.transfersLeft = 4;
  }
  return state;
}

describe("Wasserschloss Anif, Austria (102152)", () => {
  it("a Tremere moves 1 blood to a counter during the master phase", () => {
    const state = phaseGame("master");
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Tremere";
    v1.blood = 2;
    state.seats[0]!.permanents.push(wasser(0));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Wasserschloss Anif, Austria:wa1:feed:V1"]]);

    expect(state.seats[0]!.minions[0]!.blood).toBe(1);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "wa1")!.counters).toBe(1);
  });

  it("locks during the influence phase to move counters to an uncontrolled Tremere", () => {
    const state = phaseGame("influence");
    state.seats[0]!.uncontrolled.push({ card: makeMinion("U", "Alice", { clan: "Tremere", capacity: 5, blood: 0 }), counters: 0 });
    state.seats[0]!.permanents.push(wasser(3));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Wasserschloss Anif, Austria:wa1:move:U"]]);

    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(3);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "wa1")!.counters).toBe(0);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "wa1")!.locked).toBe(true);
  });
});
