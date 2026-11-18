/**
 * Khabar: Glory (101043) with The Sleeping Mind (superior).
 *
 * Khabar's attach unlocks its Assamite. The Sleeping Mind's superior text is
 * "During this action, minions cannot unlock", so the unlock is prohibited
 * while the attach still happens and the +1 bleed still applies. This pins
 * that split: it is the card text, not a missing rule.
 */
import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function v1(state: GameState) {
  const m = state.seats[0]!.minions.find((x) => x.id === "V1");
  if (!m) throw new Error("no V1");
  return m;
}

function board(withSleepingMind: boolean): GameState {
  const state = threeSeatGame();
  Object.assign(v1(state), { clan: "Banu Haqim", blood: 4, capacity: 8, disciplines: { dom: "superior", obl: "superior" } });
  state.seats[0]!.hand.push({ id: "kg", name: "Khabar: Glory" });
  if (withSleepingMind) state.seats[0]!.hand.push({ id: "sm", name: "The Sleeping Mind" });
  return state;
}

/** Play Khabar's basic mode, then the superior Sleeping Mind when offered,
 *  and resolve the action. */
function playKhabar(withSleepingMind: boolean) {
  const state = board(withSleepingMind);
  const engine = new VtesEngine(state, testRegistry);
  for (let i = 0; i < 30 && !engine.decision()?.options.some((o) => o.id.startsWith("play:Khabar: Glory")); i++) {
    engine.choose("pass");
  }
  engine.choose(engine.decision()!.options.find((o) => o.id.startsWith("play:Khabar: Glory:basic"))!.id);
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
  return { state, smPlayed };
}

describe("Khabar: Glory (101043) with The Sleeping Mind (superior)", () => {
  it("baseline: the attach unlocks the Assamite", () => {
    const { state, smPlayed } = playKhabar(false);
    expect(smPlayed).toBe(false);
    expect(v1(state).locked).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionUnlocked")).toBe(true);
  });

  it("superior Sleeping Mind: the card still attaches and gives +1 bleed, but the unlock is prohibited", () => {
    const { state, smPlayed } = playKhabar(true);
    expect(smPlayed).toBe(true);
    expect(v1(state).locked).toBe(true);
    expect(state.eventLog.some((e) => e.type === "MinionUnlocked")).toBe(false);
    // The attached card is still in play on this vampire.
    const card = v1(state).attached.find((a) => a.card.name === "Khabar: Glory");
    expect(card).toBeDefined();
    // The +1 bleed is not an unlock, so the Sleeping Mind does not stop it.
    expect(card!.statics.bleed).toBe(1);
  });
});
