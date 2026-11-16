import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, controller: string) {
  return { card: { id, name }, controller, locked: false, usedThisPhase: false, statics: {}, tags: [name] };
}

describe("per-Methuselah limits are not unique", () => {
  it.each(["Raising the Portcullis", "Augury of Doom"])("%s permits other controllers' copies without a contest but bars a second own copy", (name) => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Lasombra";
    state.seats[1]!.minions[0]!.inTorpor = true;
    state.seats[2]!.minions[0]!.inTorpor = true;
    state.seats[0]!.hand.push({ id: "copy", name });
    state.seats[1]!.permanents.push(entry("bob-copy", name, "Bob"));
    const engine = new VtesEngine(state, testRegistry);
    expect(testRegistry[name]!.isUnique).not.toBe(true);
    expect(engine.decision()!.options.some(o => o.kind === "playCard" && o.name === name)).toBe(true);
    state.seats[0]!.permanents.push(entry("alice-copy", name, "Alice"));
    expect(engine.decision()!.options.some(o => o.kind === "playCard" && o.name === name)).toBe(false);
    expect(state.eventLog.some(e => e.type === "ContestBegan" && e.name === name)).toBe(false);
    expect(state.seats[0]!.permanents.some(p => p.card.id === "alice-copy")).toBe(true);
    expect(state.seats[1]!.permanents.some(p => p.card.id === "bob-copy")).toBe(true);
  });
});
