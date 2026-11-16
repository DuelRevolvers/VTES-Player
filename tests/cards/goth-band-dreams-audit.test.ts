import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { makeAlly, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function permanent(id: string, name: string, counters: number): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, tags: [], statics: {}, counters };
}

function setup() {
  const state = threeSeatGame();
  const band = makeAlly("goth", "Alice", 2, { name: "Goth Band" });
  band.attached.push(permanent("goth", "Goth Band", 0));
  state.seats[0]!.minions.push(band);
  state.seats[0]!.permanents.push(permanent("dream", "Dreams of the Sphinx", 2));
  state.seats[0]!.permanents.push(permanent("own", "Ravnos Cache", 2));
  state.seats[1]!.permanents.push(permanent("opponent", "Smiling Jack, The Anarch", 2));
  state.seats[2]!.permanents.push(permanent("empty", "Powerbase: Madrid", 0));
  state.seats[2]!.permanents.push(permanent("not-master", "Open War", 2));
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function advanceUntilActionEnds(engine: VtesEngine): void {
  for (let i = 0; i < 40 && engine.state.frames.some((f) => f.kind === "action"); i++) {
    const decision = engine.decision();
    if (!decision) throw new Error("action ended without a decision");
    if (!decision.options.some((o) => o.id === "pass")) throw new Error(`no pass in ${decision.window}`);
    engine.choose("pass");
  }
  expect(engine.state.frames.some((f) => f.kind === "action")).toBe(false);
}

const id = "act:Goth Band:goth:counter:goth:opponent:dream";

describe("Goth Band moving counters and Dreams of the Sphinx", () => {
  it("announces a directed +1 stealth action, moves a counter and burns Dreams at three", () => {
    const { state, engine } = setup();
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain(id);
    // Cannot take from your own master or from a card with no counters.
    expect(ids.some((s) => s.includes(":counter:goth:own:"))).toBe(false);
    expect(ids.some((s) => s.includes(":counter:goth:empty:"))).toBe(false);
    expect(ids.some((s) => s.includes(":counter:goth:not-master:"))).toBe(false);
    engine.choose(id);
    const action = state.frames.find((f) => f.kind === "action");
    expect(action?.kind === "action" && action.target).toBe("Bob");
    expect(state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1 && e.actionId === (action?.kind === "action" ? action.actionId : ""))).toBe(true);
    expect(state.seats[0]!.minions.find((m) => m.id === "goth")!.locked).toBe(true);
    advanceUntilActionEnds(engine);
    expect(state.seats[1]!.permanents.find((p) => p.card.id === "opponent")!.counters).toBe(1);
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "dream")).toBe(false);
    expect(state.eventLog.filter((e) => e.type === "PermanentBurned" && e.cardId === "dream")).toHaveLength(1);
  });

  it("can remove a counter from an opponent's Dreams without locking it", () => {
    const { state, engine } = setup();
    state.seats[0]!.permanents = [permanent("dest", "Ravnos Cache", 0)];
    state.seats[1]!.permanents = [permanent("enemy-dream", "Dreams of the Sphinx", 2)];
    engine.choose("act:Goth Band:goth:counter:goth:enemy-dream:dest");
    advanceUntilActionEnds(engine);
    expect(state.seats[1]!.permanents[0]!.counters).toBe(1);
    expect(state.seats[1]!.permanents[0]!.locked).toBe(false);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(1);
  });

  it("does not move counters if the directed action is blocked", () => {
    const { state, engine } = setup();
    const blocker = state.seats[1]!.minions.find((m) => m.id === "M")!;
    blocker.attached.push({ card: { id: "intercept", name: "Sport Bike" }, locked: false,
      usedThisPhase: false, tags: ["equipment"], statics: { intercept: 1 } });
    engine.choose(id);
    for (let i = 0; i < 20 && !engine.decision()!.options.some((o) => o.id === "block:M"); i++) engine.choose("pass");
    expect(engine.decision()!.seat).toBe("Bob");
    engine.choose("block:M");
    for (let i = 0; i < 80 && state.frames.some((f) => f.kind === "action"); i++) {
      const decision = engine.decision()!;
      const next = decision.options.find((o) => o.id === "pass") ?? decision.options.find((o) => o.id === "strike:hand");
      if (!next) throw new Error(`cannot advance ${decision.window}`);
      engine.choose(next.id);
    }
    expect(state.seats[1]!.permanents.find((p) => p.card.id === "opponent")!.counters).toBe(2);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "dream")!.counters).toBe(2);
    expect(state.eventLog.some((e) => e.type === "ActionResolved" && !e.success)).toBe(true);
  });

  it("does not move a counter when a chosen source disappears before resolution", () => {
    const { state, engine } = setup();
    engine.choose(id);
    engine.burnPermanent("opponent");
    advanceUntilActionEnds(engine);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "dream")!.counters).toBe(2);
  });

  it("gives the recruit action only its normal +1 stealth", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Toreador antitribu";
    state.seats[0]!.hand.push({ id: "recruit", name: "Goth Band" });
    const engine = new VtesEngine(state, testRegistry);
    const option = engine.decision()!.options.find((o) => o.kind === "playCard" && o.card === "recruit");
    expect(option).toBeDefined();
    engine.choose(option!.id);
    // Resolve the as-played window, but not the recruit action.
    for (let i = 0; i < 10 && !state.frames.some((f) => f.kind === "action"); i++) engine.choose("pass");
    const action = state.frames.find((f) => f.kind === "action");
    expect(action?.kind).toBe("action");
    const stealth = state.eventLog.filter((e) => e.type === "StealthModified" && e.actionId === (action?.kind === "action" ? action.actionId : ""));
    expect(stealth.reduce((sum, e) => sum + (e.type === "StealthModified" ? e.delta : 0), 0)).toBe(1);
  });
});
