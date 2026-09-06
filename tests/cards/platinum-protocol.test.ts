/**
 * The Platinum Protocol (102232) — Anarch bleed; the vampire applies each
 * rider it has: obf +1 stealth, pre +1 bleed, pro corruption counter on a
 * chosen target minion if the bleed succeeds.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("The Platinum Protocol (102232)", () => {
  it("places a corruption counter and adds +1 bleed on a successful bleed", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "basic", pro: "basic" };
    v1.sect = "anarch";
    state.seats[0]!.hand.push({ id: "pp1", name: "The Platinum Protocol" });
    const bobStart = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:The Platinum Protocol:basic:V1:M"], // corrupt Bob's M
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A (Bob declines block)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);

    expect(state.seats[1]!.pool).toBe(bobStart - 2); // base 1 + pre 1
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    expect(m.corruption?.["Alice"]).toBe(1);
  });
});
