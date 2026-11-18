/**
 * Vast Wealth (102092), the two rulings library-search.test.ts does not pin.
 *
 *  - RTR 19951017: "Vast Wealth's ability is not usable if the vampire does
 *    not share the same controller as Vast Wealth."
 *  - TOM 19951107: "You only search your library if the action is successful."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function board(): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 3 });
  find(state, "V1").attached.push({
    card: { id: "vw", name: "Vast Wealth" },
    controller: "Alice",
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["Vast Wealth"],
  });
  state.seats[0]!.library.push({ id: "l1", name: "Blood Shield" });
  return state;
}

describe("Vast Wealth (102092) rulings", () => {
  it("the ability is offered while the bearer shares Vast Wealth's controller", () => {
    const state = board();
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("act:Vast Wealth:vw:equip:"))).toBe(true);
  });

  it("RTR 19951017: not usable when the bearer is controlled by another Methuselah", () => {
    const state = board();
    // Move the bearer to Bob's seat under his control, as a loan would.
    const bearer = find(state, "V1");
    state.seats[0]!.minions = state.seats[0]!.minions.filter((m) => m.id !== "V1");
    bearer.controller = "Bob";
    state.seats[1]!.minions.push(bearer);
    const engine = new VtesEngine(state, testRegistry);
    const offered = (engine.decision()?.options ?? []).map((o) => o.id);
    expect(offered.some((id) => id.startsWith("act:Vast Wealth:vw:equip:"))).toBe(false);
  });
});

describe("Vast Wealth (102092): search only on success", () => {
  it("TOM 19951107: a blocked equip action does not search the library", () => {
    const state = board();
    // Bob's M needs intercept at least equal to the action's stealth (+1
    // from Vast Wealth). Intercept comes from attached statics (Sport Bike).
    find(state, "M").attached.push({
      card: { id: "ic", name: "Test Intercept" },
      controller: "Bob",
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 1 },
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);
    const option = engine.decision()!.options.find((o) => o.id.startsWith("act:Vast Wealth:vw:equip:"));
    expect(option).toBeDefined();
    engine.choose(option!.id);
    // Bob blocks the action with M; a blocked action does not succeed.
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const block = dp.options.find((o) => o.id === "block:M");
      if (dp.seat === "Bob" && block) {
        engine.choose(block.id);
        break;
      }
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    for (let i = 0; i < 60 && engine.state.frames.some((f) => f.kind === "action" || f.kind === "combat" || f.kind === "cardPlay"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    // The block must actually land, or "not successful" proves nothing.
    expect(engine.state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    const succeeded = engine.state.eventLog.some((e) => e.type === "ActionResolved" && e.success);
    expect(succeeded).toBe(false);
    expect(engine.state.seats[0]!.library.some((c) => c.id === "l1")).toBe(true);
    expect(engine.state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(false);
  });
});
