import { describe, expect, it } from "vitest";
import { VtesEngine, currentBleed, type GameState, type MinionState } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function setup(reactor: Partial<MinionState> = {}, companion?: Partial<MinionState>) {
  const state = threeSeatGame();
  const bob = state.seats[1]!;
  Object.assign(bob.minions.find(m => m.id === "M")!, {
    clan: "Blood Brother", printedCircle: "Chicago", disciplines: { san: "superior" }, ...reactor,
  });
  if (companion) bob.minions.push(makeMinion("friend", "Bob", { clan: "Blood Brother", printedCircle: "Chicago", ...companion }));
  bob.hand.push({ id: "camaraderie", name: "Camaraderie" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  for (let i = 0; i < 4 && engine.decision()?.seat !== "Bob"; i++) engine.choose("pass");
  if (engine.decision()?.seat !== "Bob") throw new Error("no reaction impulse for Bob");
  return { state, engine };
}
function options(engine: VtesEngine) { return engine.decision()!.options.map(o => o.id); }
function action(state: GameState) {
  const a = state.frames.find(f => f.kind === "action");
  if (!a || a.kind !== "action") throw new Error("missing action");
  return a;
}
function play(engine: VtesEngine, mode: string) {
  const id = options(engine).find(x => x.startsWith(`play:Camaraderie:${mode}:M`));
  if (!id) throw new Error(`missing ${mode}, seat ${engine.decision()?.seat}, window ${engine.decision()?.window}, options ${options(engine)}`);
  engine.choose(id!);
  for (let i = 0; i < 20 && engine.state.frames.some(f => f.kind === "cardPlay"); i++) engine.choose("pass");
}
describe("Camaraderie and Blood Brother circles", () => {
  it("basic reduces a bleed, without requiring another Blood Brother", () => {
    const { state, engine } = setup({ disciplines: { san: "basic" } });
    expect(options(engine).some(id => id.startsWith("play:Camaraderie:superior"))).toBe(false);
    play(engine, "basic");
    expect(currentBleed(state, action(state))).toBe(0);
  });
  it("superior reduces the bleed by three with another ready unlocked member", () => {
    const { state, engine } = setup({}, {});
    play(engine, "superior");
    expect(state.eventLog.some(e => e.type === "BleedAmountModified" && e.delta === -3)).toBe(true);
    expect(currentBleed(state, action(state))).toBe(-2);
  });
  it.each([{ locked: true }, { inTorpor: true }, { printedCircle: "Kiev" }, { clan: "Tremere" }])(
    "rejects an ineligible companion %o", companion => {
      const { engine } = setup({}, companion);
      expect(options(engine).some(id => id.startsWith("play:Camaraderie:basic:M"))).toBe(true);
      expect(options(engine).some(id => id.startsWith("play:Camaraderie:superior:M"))).toBe(false);
    });
  it("uses New Blood's chosen circle even after save/load", () => {
    const { state } = setup({ name: "New Blood (ANY)", printedCircle: "", chosenCircle: "named:Chicago" }, {});
    const resumed = new VtesEngine(JSON.parse(JSON.stringify(state)) as GameState, testRegistry);
    play(resumed, "superior");
    expect(resumed.state.eventLog.some(e => e.type === "BleedAmountModified" && e.delta === -3)).toBe(true);
  });
  it.each([
    [{ name: "Angelo (G3)", printedCircle: "" }, { printedCircle: "Kiev" }],
    [{}, { name: "Angelo (G3)", printedCircle: "" }],
  ])("treats controlled Angelo as belonging to the relevant circle", (reactor, companion) => {
    const { state, engine } = setup(reactor, companion);
    play(engine, "superior");
    expect(state.eventLog.some(e => e.type === "BleedAmountModified" && e.delta === -3)).toBe(true);
  });
  it("recognizes a New Blood companion that joined a circle of one", () => {
    const { state, engine } = setup({ printedCircle: "" },
      { name: "New Blood (ANY)", printedCircle: "", chosenCircle: "individual:M" });
    play(engine, "superior");
    expect(state.eventLog.some(e => e.type === "BleedAmountModified" && e.delta === -3)).toBe(true);
  });
  it("does not count the reacting vampire itself as the other Blood Brother", () => {
    const { engine } = setup();
    expect(options(engine).some(id => id.startsWith("play:Camaraderie:superior:M"))).toBe(false);
  });
  it("basic works for a non-Blood Brother with Sanguinus", () => {
    const { state, engine } = setup({ clan: "Tremere", disciplines: { san: "basic" } });
    play(engine, "basic");
    expect(currentBleed(state, action(state))).toBe(0);
  });
  it("does not count another Methuselah's companion", () => {
    const { state, engine } = setup();
    state.seats[2]!.minions.push(makeMinion("enemy", "Carol", { clan: "Blood Brother", printedCircle: "Chicago" }));
    expect(options(engine).some(id => id.startsWith("play:Camaraderie:superior:M"))).toBe(false);
  });
  it("prevents pool loss when the reduced bleed resolves", () => {
    const { state, engine } = setup();
    const pool = state.seats[1]!.pool;
    play(engine, "basic");
    for (let i = 0; i < 30 && state.frames.some(f => f.kind === "action"); i++) engine.choose("pass");
    expect(state.frames.some(f => f.kind === "action")).toBe(false);
    expect(state.seats[1]!.pool).toBe(pool);
  });
  it("does not reduce the bleed if cancelled as played", () => {
    const { state, engine } = setup({}, {});
    state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    const id = options(engine).find(x => x.startsWith("play:Camaraderie:superior:M"));
    expect(id).toBeDefined();
    engine.choose(id!);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "play:Direct Intervention"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.eventLog.some(e => e.type === "CardCanceled" && e.name === "Camaraderie")).toBe(true);
    expect(currentBleed(state, action(state))).toBe(1);
  });
  it("cannot be played by a bystander not targeted by the bleed", () => {
    const { engine } = setup({}, {});
    engine.choose("pass");
    expect(engine.decision()!.seat).toBe("Carol");
    expect(options(engine).some(id => id.startsWith("play:Camaraderie"))).toBe(false);
  });
});
