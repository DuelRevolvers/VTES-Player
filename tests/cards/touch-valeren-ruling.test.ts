import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// LSJ 20001114 (immediate damage prevention): "Cannot be used if there is no
// damage to prevent." Touch of Valeren's basic combat mode is `preventAll`.

function game() {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 6, capacity: 8, clan: "Salubri", disciplines: { for: "superior", tha: "superior" } });
  Object.assign(state.seats[1]!.minions.find((m) => m.id === "M")!, { blood: 6, strength: 3 });
  state.seats[0]!.hand.push({ id: "card", name: "Touch of Valeren" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "strike:hand"], ["Bob", "strike:hand"],
  ]);
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return { engine, cf };
}

describe("Touch of Valeren (102262): immediate combat prevention needs damage", () => {
  it("is offered while damage to Alice's minion is pending", () => {
    const { engine, cf } = game();
    expect(cf.pendingDamage.some((p) => p.minion === "V1")).toBe(true);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Touch of Valeren:basic"))).toBe(true);
  });

  it("is not offered when there is no damage to prevent", () => {
    const { engine, cf } = game();
    cf.pendingDamage.length = 0;
    const offered = engine.decision()?.options.some((o) => o.id.startsWith("play:Touch of Valeren:basic")) ?? false;
    expect(offered).toBe(false);
  });
});
