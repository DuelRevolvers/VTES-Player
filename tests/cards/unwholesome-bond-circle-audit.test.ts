import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
function setup(level: "basic" | "superior" = "basic") {
  const state = threeSeatGame();
  const actor = state.seats[0]!.minions[0]!;
  Object.assign(actor, { name: "New Blood (ANY)", clan: "Blood Brother", blood: 1, capacity: 8,
    disciplines: { san: level }, chosenCircle: "named:Chicago" });
  const self = testRegistry["New Blood (ANY)"]!.cryptEntry!();
  actor.attached.push({ card: { id: "self", name: actor.name }, locked: false, usedThisPhase: false,
    statics: self.statics, tags: self.tags });
  state.seats[0]!.hand.push({ id: "ub", name: "Unwholesome Bond" });
  return { state, actor, engine: new VtesEngine(state, testRegistry) };
}
function passAction(e: VtesEngine) {
  for (let i = 0; i < 25 && e.state.frames.some(f => f.kind === "action" || f.kind === "cardPlay"); i++) e.choose("pass");
}
function play(e: VtesEngine, mode: string, suffix = "") {
  const option = e.decision()!.options.find(o => o.id.startsWith(`play:Unwholesome Bond:${mode}:V1`) && o.id.endsWith(suffix));
  if (!option) throw new Error(`missing option ${mode} ${suffix}: ${e.decision()!.options.map(o => o.id)}`);
  e.choose(option.id);
}
describe("Unwholesome Bond and circles", () => {
  it("basic counts ready unlocked Blood Brothers of the selected circle across the table", () => {
    const { state, actor, engine } = setup();
    state.seats[0]!.minions.push(makeMinion("friend", "Alice", { clan: "Blood Brother", printedCircle: "Chicago" }));
    state.seats[1]!.minions.push(makeMinion("enemy", "Bob", { clan: "Blood Brother", printedCircle: "Chicago" }));
    state.seats[1]!.minions.push(makeMinion("locked", "Bob", { clan: "Blood Brother", printedCircle: "Chicago", locked: true }));
    state.seats[1]!.minions.push(makeMinion("torpor", "Bob", { clan: "Blood Brother", printedCircle: "Chicago", inTorpor: true }));
    state.seats[1]!.minions.push(makeMinion("wrong", "Bob", { clan: "Blood Brother", printedCircle: "Kiev" }));
    play(engine, "basic"); passAction(engine);
    expect(actor.blood).toBe(4); // 1 initial + 1 base + 2 ready unlocked
  });
  it("superior adds blood to every matching uncontrolled Blood Brother, not New Blood's inactive special", () => {
    const { state, engine } = setup("superior");
    state.seats[0]!.uncontrolled = [
      { card: makeMinion("c1", "Alice", { clan: "Blood Brother", printedCircle: "Chicago" }), counters: 0 },
      { card: makeMinion("c2", "Alice", { clan: "Blood Brother", printedCircle: "Chicago" }), counters: 2 },
      { card: makeMinion("other", "Alice", { clan: "Blood Brother", printedCircle: "Kiev" }), counters: 0 },
      { card: makeMinion("new2", "Alice", { clan: "Blood Brother", chosenCircle: "named:Chicago" }), counters: 0 },
    ];
    play(engine, "superior");
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const e = new VtesEngine(saved, testRegistry); passAction(e);
    expect(saved.seats[0]!.uncontrolled.map(u => u.counters)).toEqual([1, 3, 0, 0]);
  });
  it("Angelo selects one circle only, including an uncontrolled vampire's individual circle", () => {
    const { state, actor, engine } = setup("superior");
    actor.name = "Angelo (G3)"; delete actor.chosenCircle;
    state.seats[0]!.uncontrolled = [
      { card: makeMinion("c", "Alice", { clan: "Blood Brother", printedCircle: "Chicago" }), counters: 0 },
      { card: makeMinion("k", "Alice", { clan: "Blood Brother", printedCircle: "Kiev" }), counters: 0 },
      { card: makeMinion("uncontrolled-angelo", "Alice", { name: "Angelo (G3)", clan: "Blood Brother" }), counters: 0 },
    ];
    play(engine, "superior", ":circle:individual:uncontrolled-angelo"); passAction(engine);
    expect(state.seats[0]!.uncontrolled.map(u => u.counters)).toEqual([0, 0, 1]);
  });
  it("does not apply its blood gain when blocked", () => {
    const { state, actor, engine } = setup();
    const blocker = state.seats[1]!.minions.find(m => m.id === "W")!;
    blocker.attached.push({ card: { id: "intercept", name: "test intercept" }, locked: false,
      usedThisPhase: false, tags: [], statics: { intercept: 1 } });
    play(engine, "basic");
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 60 && state.frames.some(f => f.kind === "action" || f.kind === "combat"); i++) {
      const dp = engine.decision()!;
      const opt = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no legal pass in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(actor.blood).toBeLessThanOrEqual(1); // combat may inflict damage, the action cannot gain blood
    expect(state.eventLog.some(e => e.type === "ActionResolved" && !e.success)).toBe(true);
  });
  it("another Blood Brother counts controlled Angelo as if in their circle", () => {
    const { state, actor, engine } = setup();
    state.seats[0]!.minions.push(makeMinion("angelo", "Alice", { name: "Angelo (G3)", clan: "Blood Brother" }));
    play(engine, "basic"); passAction(engine);
    expect(actor.blood).toBe(3);
  });
});
