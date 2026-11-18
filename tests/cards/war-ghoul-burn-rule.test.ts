import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// RTR 19961113: "If you have no other allies or retainers in play when it enters
// play, it must burn itself." ANK 20170309-2: the burn applies however it enters
// play. War Ghoul's burn target is chosen at announcement; "self" is always legal.

function setup(withOtherAlly: boolean) {
  const state: GameState = threeSeatGame();
  const alice = state.seats.find((s) => s.id === "Alice")!;
  const v1 = alice.minions.find((m) => m.id === "V1")!;
  Object.assign(v1, { clan: "Tzimisce", blood: 5, capacity: 6 });
  alice.pool = 6;
  if (withOtherAlly) alice.minions.push(makeAlly("OA", "Alice", 2));
  alice.hand.push({ id: "wg", name: "War Ghoul" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function ghoulOptions(engine: VtesEngine): { id: string; burn: unknown }[] {
  return (engine.decision()?.options ?? [])
    .filter((o) => o.kind === "playCard" && o.name === "War Ghoul")
    .map((o) => ({ id: o.id, burn: (o as { params: Record<string, unknown> }).params["burn"] }));
}

describe("War Ghoul (102144): the burn when it is the only ally or retainer", () => {
  it("with no other ally in play the only burn choice is itself", () => {
    const { engine } = setup(false);
    const burns = ghoulOptions(engine).map((o) => o.burn);
    expect(burns.length).toBeGreaterThan(0);
    expect(new Set(burns)).toEqual(new Set(["self"]));
  });

  it("with another ally in play the other ally can be burned instead", () => {
    const { engine } = setup(true);
    const burns = new Set(ghoulOptions(engine).map((o) => o.burn));
    expect(burns.has("OA")).toBe(true);
    expect(burns.has("self")).toBe(true);
  });

  it("playing it alone burns it: no War Ghoul stays in play", () => {
    const { state, engine } = setup(false);
    const pick = ghoulOptions(engine)[0]!;
    runTrace(engine, [["Alice", pick.id]]);
    // Let the played card resolve: pass through its windows until nothing is on the stack.
    for (let i = 0; i < 40; i++) {
      if (!state.frames.some((f) => f.kind === "cardPlay" || f.kind === "action")) break;
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.name === "War Ghoul")).toBe(false);
    expect(state.seats.find((s) => s.id === "Alice")!.ashHeap?.some((c) => c.name === "War Ghoul")).toBe(true);
  });
});
