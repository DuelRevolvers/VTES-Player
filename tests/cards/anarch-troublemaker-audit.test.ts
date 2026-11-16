import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup() {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("turn fixture");
  turn.phase = "unlock";
  turn.unlockAbilitiesDone = false;
  turn.unlockDone = false;
  state.seats[0]!.permanents.push({ card: { id: "trouble", name: "Anarch Troublemaker" },
    locked: false, usedThisPhase: false, statics: {}, tags: [] });
  state.seats[1]!.minions = [
    makeMinion("torpor", "Bob", { inTorpor: true, locked: false }),
    makeMinion("locked", "Bob", { locked: true }),
    makeMinion("ready", "Bob"), makeAlly("ally", "Bob", 2),
  ];
  state.seats[1]!.uncontrolled.push({ card: makeMinion("uncontrolled", "Bob"), counters: 1 });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

describe("Anarch Troublemaker targets", () => {
  it("offers in-play vampires in torpor and already locked vampires, but not allies or uncontrolled vampires", () => {
    const { engine } = setup();
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("ability:Anarch Troublemaker:trouble:lock:torpor");
    expect(ids).toContain("ability:Anarch Troublemaker:trouble:lock:locked");
    expect(ids).toContain("ability:Anarch Troublemaker:trouble:lock:torpor:locked");
    expect(ids.some(id => id.includes(":lock:ally") || id.includes(":lock:uncontrolled"))).toBe(false);
  });
  it("locks a vampire in torpor, leaves an already locked vampire unchanged, and transfers control", () => {
    const { state, engine } = setup();
    engine.choose("ability:Anarch Troublemaker:trouble:lock:torpor:locked");
    expect(state.seats[1]!.minions.find(m => m.id === "torpor")!.locked).toBe(true);
    expect(state.seats[1]!.minions.find(m => m.id === "locked")!.locked).toBe(true);
    expect(state.eventLog.filter(e => e.type === "MinionLocked").map(e => e.minion)).toEqual(["torpor"]);
    expect(state.seats[1]!.permanents.some(p => p.card.id === "trouble")).toBe(true);
  });
});
