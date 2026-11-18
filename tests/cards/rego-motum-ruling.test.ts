import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// RTR 20041202: "If fewer points of (preventable) damage are being resolved,
// then the effect prevents all of those points." Unused points do not carry
// over (ANK 20200318, LSJ 20001114): prevention is consumed as it resolves.

function game(name: string) {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 6, capacity: 8, clan: "Salubri", disciplines: { tha: "superior", for: "superior" } });
  Object.assign(state.seats[1]!.minions.find((m) => m.id === "M")!, { blood: 6, strength: 3 });
  state.seats[0]!.hand.push({ id: "card", name });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "strike:hand"], ["Bob", "strike:hand"],
  ]);
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return { state, engine, cf };
}

// The card is played, then resolves in its own `card.asPlayed` window once
// every seat has passed; only then is the damage reduced.
function resolveCard(engine: VtesEngine): void {
  for (let i = 0; i < 10; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    engine.choose(dp.options.find((o) => o.id === "pass")!.id);
  }
}

describe("Rego Motum (101588): prevention of fewer points than it can prevent", () => {
  it("basic prevents 2 but only 1 point is resolving: all of it is prevented, nothing carries", () => {
    const { engine, cf } = game("Rego Motum");
    const pd = cf.pendingDamage[0]!;
    pd.amount = 1;
    engine.choose("play:Rego Motum:basic:V1:card");
    resolveCard(engine);
    expect(pd.amount).toBe(0);
  });

  it("superior prevents 4 against 3 incoming: all 3 prevented", () => {
    const { engine, cf } = game("Rego Motum");
    const pd = cf.pendingDamage[0]!;
    pd.amount = 3;
    engine.choose("play:Rego Motum:superior:V1:card");
    resolveCard(engine);
    expect(pd.amount).toBe(0);
  });

  it("basic against 3 incoming prevents exactly 2 and leaves 1 to resolve", () => {
    const { engine, cf } = game("Rego Motum");
    const pd = cf.pendingDamage[0]!;
    pd.amount = 3;
    engine.choose("play:Rego Motum:basic:V1:card");
    resolveCard(engine);
    expect(pd.amount).toBe(1);
  });
});
