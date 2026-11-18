import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// ANK 20180104 / LSJ 19971110: "The damage is applied even if the combat ends
// prematurely (eg. Illusions of the Kindred)." Outside the Hourglass superior's
// damage is pending before range, so a premature end must not cancel it.

function game() {
  const state = threeSeatGame();
  for (const seat of [0, 1]) {
    const m = seat === 0 ? state.seats[0]!.minions[0]! : state.seats[1]!.minions.find((m) => m.id === "M")!;
    m.disciplines = { tem: "superior" };
    m.blood = 8;
    m.capacity = 10;
    state.seats[seat]!.hand.push({ id: `${seat}-0`, name: "Outside the Hourglass" });
  }
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

describe("Outside the Hourglass (101338): damage survives a premature end of combat", () => {
  it("the superior's damage is still inflicted when the combat ends prematurely", () => {
    const { state, engine } = game();
    engine.choose(engine.decision()!.options.find((o) => o.id.startsWith("play:Outside the Hourglass:superior:V1"))!.id);
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision()!;
      if (dp.window === "combat.beforeRange" && dp.seat === "Alice") break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    const cf = state.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    expect(cf.pendingDamage.some((p) => p.minion === "M" && p.amount === 2)).toBe(true);
    // A real premature end: the opposing minion goes to torpor before range.
    state.seats[1]!.minions.find((m) => m.id === "M")!.inTorpor = true;
    for (let i = 0; i < 40 && state.frames.some((f) => f.kind === "combat"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "StrikeChosen")).toBe(false);
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.blood).toBe(6);
  });
});
