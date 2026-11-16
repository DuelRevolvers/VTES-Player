import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function ready(sect: "anarch" | "camarilla" = "anarch") {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 4, sect });
  state.seats[0]!.hand.push({ id: "pd", name: "Propaganda of the Deed" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  return { state, engine };
}
function passToEndWindow(engine: VtesEngine) {
  for (let i = 0; i < 20; i++) {
    const dp = engine.decision()!;
    if (dp.window === "action.afterResolution" || dp.window === "turn.minion") return dp;
    engine.choose("pass");
  }
  throw new Error("action stalled");
}

describe("Propaganda of the Deed", () => {
  it("requires an anarch and does not give stealth during the action", () => {
    const { engine } = ready();
    expect(engine.decision()!.options.some(o => o.id.includes("Propaganda of the Deed"))).toBe(false);
    expect(passToEndWindow(engine).options.some(o => o.id.includes("Propaganda of the Deed"))).toBe(true);
    expect(passToEndWindow(ready("camarilla").engine).options.some(o => o.id.includes("Propaganda of the Deed"))).toBe(false);
  });
  it("enters the controller's play area, then burns for two votes in a political referendum", () => {
    const { state, engine } = ready();
    const dp = passToEndWindow(engine);
    const play = dp.options.find(o => o.id.includes("Propaganda of the Deed"));
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play!.id], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 10 && engine.decision()!.window !== "turn.minion"; i++) engine.choose("pass");
    expect(state.seats[0]!.permanents.some(p => p.card.id === "pd")).toBe(true);
    expect(state.seats[0]!.minions[0]!.attached.some(p => p.card.id === "pd")).toBe(false);
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    state.seats[0]!.hand.push({ id: "au", name: "Anarchist Uprising" });
    runTrace(engine, [["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(engine.decision()!.window).toBe("referendum.polling");
    engine.choose("ability:Propaganda of the Deed:pd:votes");
    expect(state.seats[0]!.permanents.some(p => p.card.id === "pd")).toBe(false);
    expect(state.seats[0]!.ashHeap?.some(c => c.id === "pd")).toBe(true);
    expect(engine.decision()!.options.find(o => o.id === "vote:grant:pd:for")).toMatchObject({ count: 2 });
    engine.choose("vote:grant:pd:for");
    const rf = state.frames.find(f => f.kind === "referendum");
    expect(rf?.kind === "referendum" && rf.votes).toEqual(expect.arrayContaining([expect.objectContaining({ count: 2, inFavor: true })]));
  });
});
