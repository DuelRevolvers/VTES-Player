import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// Big Game (100159), Ⓓ: "Enter combat with a ready minion controlled by
// another Methuselah. If that minion is a Red List minion, this minion gets
// an optional maneuver or press in that combat and unlocks at the end of the
// action if he or she is still ready."

const PASS_ROUND: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

function setup(redList: boolean) {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  actor.blood = 5;
  const target = state.seats[1]!.minions.find(m => m.id === "W")!;
  target.blood = 5;
  target.redList = redList;
  state.seats[0]!.hand.push({ id: "bg", name: "Big Game" });
  return { state, actor, engine: new VtesEngine(state, testRegistry) };
}

function finishCombat(engine: VtesEngine, state: ReturnType<typeof threeSeatGame>) {
  for (let i = 0; i < 60 && state.frames.some(f => f.kind === "action" || f.kind === "combat"); i++) {
    const dp = engine.decision()!;
    const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
}

describe("Big Game on a Red List minion", () => {
  it("offers the optional maneuver and the optional press as separate options", () => {
    const { engine } = setup(true);
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("play:Big Game:basic:V1:W:maneuver:bg");
    expect(ids).toContain("play:Big Game:basic:V1:W:press:bg");
  });

  it("the maneuver option gives the acting minion one maneuver and unlocks it at the end", () => {
    const { state, actor, engine } = setup(true);
    runTrace(engine, [["Alice", "play:Big Game:basic:V1:W:maneuver:bg"], ...PASS_ROUND]);
    const cf = state.frames.find(f => f.kind === "combat");
    expect(cf?.kind).toBe("combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    expect(cf.maneuverCredits.acting).toBe(1);
    expect(cf.pressesCombat.acting).toBe(0);
    finishCombat(engine, state);
    expect(actor.locked).toBe(false);
  });

  it("the press option gives one press instead, and still unlocks", () => {
    const { state, actor, engine } = setup(true);
    runTrace(engine, [["Alice", "play:Big Game:basic:V1:W:press:bg"], ...PASS_ROUND]);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    // A rider press is combat-long credit (`pressesCombat`), not per-round.
    expect(cf.pressesCombat.acting).toBe(1);
    expect(cf.maneuverCredits.acting).toBe(0);
    finishCombat(engine, state);
    expect(actor.locked).toBe(false);
  });
});

describe("Big Game on a minion that is not Red List", () => {
  it("offers only the plain rush, with no maneuver/press choice", () => {
    const { engine } = setup(false);
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("play:Big Game:basic:V1:W:bg");
    expect(ids.some(id => id.includes(":W:maneuver:") || id.includes(":W:press:"))).toBe(false);
  });

  it("gives no unlock: the acting minion stays locked", () => {
    const { state, actor, engine } = setup(false);
    runTrace(engine, [["Alice", "play:Big Game:basic:V1:W:bg"], ...PASS_ROUND]);
    finishCombat(engine, state);
    expect(actor.locked).toBe(true);
  });
});

describe("Big Game targets", () => {
  it("does not offer any minion the acting Methuselah controls", () => {
    const { state, engine } = setup(false);
    state.seats[0]!.minions.push(makeMinion("OWN", "Alice"));
    const own = state.seats[0]!.minions.map(m => m.id).filter(id => id !== "V1");
    expect(own.length).toBeGreaterThan(0);
    const ids = engine.decision()!.options.map(o => o.id);
    for (const id of own) {
      expect(ids.some(o => o.startsWith("play:Big Game:basic:V1:") && o.split(":")[4] === id)).toBe(false);
    }
  });
});
