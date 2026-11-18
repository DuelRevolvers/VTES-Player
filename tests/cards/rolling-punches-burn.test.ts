import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// ANK 20210226: "The burn blood effect is not reduced by effects that reduce the
// cost of the card" and "The card cannot be played if the minion cannot afford to
// burn the blood." Rolling with the Punches superior: "Burn 1 blood to prevent all
// damage from the opposing minion's strikes this round."

function game(blood: number, reduce: boolean) {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood, capacity: 8, clan: "Salubri", disciplines: { tha: "superior", for: "superior" } });
  Object.assign(state.seats[1]!.minions.find((m) => m.id === "M")!, { blood: 6, strength: 3 });
  state.seats[0]!.hand.push({ id: "card", name: "Rolling with the Punches" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "strike:hand"], ["Bob", "strike:hand"],
  ]);
  const cf = state.frames.find((f) => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  if (reduce) cf.playCostMods = [...(cf.playCostMods ?? []), { amount: -1, pays: "blood", cardTypes: ["combat"] }];
  return { state, engine, cf };
}

function resolveCard(engine: VtesEngine): void {
  for (let i = 0; i < 10; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    engine.choose(dp.options.find((o) => o.id === "pass")!.id);
  }
}

const superiorId = "play:Rolling with the Punches:superior:V1:card";

describe("Rolling with the Punches (101649): the superior's burn is mandatory and not reduced", () => {
  it("is not offered with 0 blood, since the burn cannot be paid", () => {
    const { state, engine } = game(1, false);
    state.seats.flatMap((s) => s.minions).find((m) => m.id === "V1")!.blood = 0;
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Rolling with the Punches:superior"))).toBe(false);
  });

  it("with a -1 blood cost reduction in force, still burns exactly 1 blood", () => {
    const { state, engine } = game(1, true);
    const offered = engine.decision()!.options.some((o) => o.id === superiorId);
    expect(offered).toBe(true);
    engine.choose(superiorId);
    resolveCard(engine);
    expect(engine.decision()).toBeDefined();
    expect(state.seats.flatMap((s) => s.minions).find((m) => m.id === "V1")!.blood).toBe(0);
  });
});
