/**
 * Psychophagia (102302): "+1 stealth hunt action. Remove an ally in any
 * Methuselah's ash heap from the game to gain 3 blood or to gain 2 blood and
 * unlock."
 *
 * The end-to-end combination with The Sleeping Mind (superior): it "prevents
 * unlock after action resolution" [PIB 20150703], but not the blood gain.
 * So the 2-blood variant still gains its 2 blood and the actor stays locked.
 * ash-heap-cards.test.ts covers the modes in isolation; this file covers
 * the combination, which was not tested end-to-end.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function actor(state: GameState) {
  const m = state.seats[0]!.minions[0]!;
  if (!m) throw new Error("no actor");
  return m;
}

/** Hecata actor with 4 blood; Bob's heap holds one ally. */
function board(withSleepingMind: boolean): GameState {
  const state = threeSeatGame();
  Object.assign(actor(state), {
    clan: "Hecata",
    blood: 4,
    capacity: 8,
    disciplines: { obl: "superior", dom: "superior" },
  });
  state.seats[1]!.ashHeap = [{ id: "bA", name: "Political Ally" }];
  state.seats[0]!.hand.push({ id: "ps", name: "Psychophagia" });
  if (withSleepingMind) state.seats[0]!.hand.push({ id: "sm", name: "The Sleeping Mind" });
  return state;
}

/** Play Psychophagia's 2-blood-and-unlock mode and resolve the action. The
 *  Sleeping Mind (superior) is played in the action's effects window when
 *  `withSleepingMind` is set. Returns the blood gained by Psychophagia. */
function playUnlockVariant(withSleepingMind: boolean): {
  state: GameState;
  engine: VtesEngine;
  gained: number;
  smPlayed: boolean;
} {
  const state = board(withSleepingMind);
  const engine = new VtesEngine(state, testRegistry);
  for (let i = 0; i < 30 && !engine.decision()?.options.some((o) => o.id.startsWith("play:Psychophagia")); i++) {
    engine.choose("pass");
  }
  const unlock = engine.decision()!.options.find((o) => o.id.includes(":unlock:"));
  if (!unlock) throw new Error("unlock variant not offered");
  engine.choose(unlock.id);

  let smPlayed = false;
  for (let i = 0; i < 40 && state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay"); i++) {
    const dp = engine.decision()!;
    const sm = dp.options.find((o) => o.id.startsWith("play:The Sleeping Mind:superior"));
    if (withSleepingMind && sm && !smPlayed) {
      smPlayed = true;
      engine.choose(sm.id);
      continue;
    }
    engine.choose(dp.options.find((o) => o.id === "pass")!.id);
  }

  const gained = state.eventLog
    .filter((e) => e.type === "BloodGained" && e.minion === "V1")
    .reduce((n, e) => n + (e.type === "BloodGained" ? e.amount : 0), 0);
  return { state, engine, gained, smPlayed };
}

describe("Psychophagia (102302) with The Sleeping Mind", () => {
  it("baseline: the 2-blood variant gains 2 blood and unlocks the actor", () => {
    const { state, gained, smPlayed } = playUnlockVariant(false);
    expect(smPlayed).toBe(false);
    expect(gained).toBe(2);
    expect(actor(state).locked).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionUnlocked")).toBe(true);
  });

  it("superior Sleeping Mind: the 2 blood is still gained, but the unlock is prevented", () => {
    const { state, gained, smPlayed } = playUnlockVariant(true);
    expect(smPlayed).toBe(true);
    // The blood gain is not what the Sleeping Mind prohibits.
    expect(gained).toBe(2);
    // ...but the unlock after resolution is.
    expect(actor(state).locked).toBe(true);
    expect(state.eventLog.some((e) => e.type === "MinionUnlocked")).toBe(false);
  });
});
