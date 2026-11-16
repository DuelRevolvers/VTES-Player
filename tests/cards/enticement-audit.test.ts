import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import type { GameState } from "../../src/engine/state.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game(edge: string | null = "Alice") {
  const state = threeSeatGame();
  state.edge = edge;
  const alice = state.seats[0]!;
  Object.assign(alice.minions[0]!, { disciplines: { ser: "superior" }, blood: 5 });
  alice.minions.push(makeMinion("V2", "Alice", { disciplines: { dom: "basic" }, blood: 4, sect: "anarch" }));
  alice.minions.push(makeAlly("ally", "Alice", 3));
  alice.hand.push({ id: "ent", name: "Enticement" }, { id: "govern", name: "Govern the Unaligned" }, { id: "protocol", name: "The Platinum Protocol" });
  alice.minions[1]!.attached.push({ card: { id: "codex", name: "Codex of the Edenic Groundskeepers" }, controller: "Alice", locked: false, usedThisPhase: false, tags: ["equipment"], statics: {} });
  return { state, engine: new VtesEngine(state, testRegistry) };
}
function ids(engine: VtesEngine) { return engine.decision()?.options.map(o => o.id) ?? []; }
function announce(engine: VtesEngine, mode: "basic" | "superior") {
  engine.choose(`play:Enticement:${mode}:V1:ent`);
  runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
}
function finish(engine: VtesEngine, state: GameState) {
  for (let i = 0; i < 80 && !state.eventLog.some(e => e.type === "ActionResolved"); i++) {
    const dp = engine.decision();
    if (!dp) throw new Error("no decision during action");
    engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
  }
  expect(state.eventLog.some(e => e.type === "ActionResolved")).toBe(true);
}

describe("Enticement", () => {
  it("requires its controller to hold the Edge", () => {
    for (const edge of [null, "Bob"]) {
      const { engine } = game(edge);
      expect(ids(engine).some(id => id.startsWith("play:Enticement"))).toBe(false);
    }
    expect(ids(game().engine)).toContain("play:Enticement:basic:V1:ent");
  });
  it.each([["basic", 2], ["superior", 3]] as const)("%s burns the Edge and %i prey pool without stealing it", (mode, amount) => {
    const { state, engine } = game();
    announce(engine, mode);
    const af = state.frames.find(f => f.kind === "action");
    expect(af?.kind === "action" && af.target).toBe("Bob");
    expect(af?.kind === "action" && af.directed).toBe(true);
    expect(state.edge).toBe("Alice");
    finish(engine, state);
    expect(state.edge).toBeNull();
    expect(state.seats[0]!.pool).toBe(10);
    expect(state.seats[1]!.pool).toBe(10 - amount);
    expect(state.seats[2]!.pool).toBe(10);
    const tf = state.frames.find(f => f.kind === "turn");
    expect(tf?.kind === "turn" && tf.cannotBleedSeats).toContain("Alice");
  });
  it("prevents basic, action-card, granted and bespoke bleeds, including allies, but not other actions", () => {
    const { state, engine } = game();
    expect(ids(engine)).toContain("bleed:ally");
    expect(ids(engine).some(id => id.startsWith("play:Govern the Unaligned:basic:V2"))).toBe(true);
    expect(ids(engine).some(id => id.startsWith("play:The Platinum Protocol") && id.includes(":V2"))).toBe(true);
    expect(ids(engine).some(id => id.startsWith("act:Codex of the Edenic Groundskeepers:codex:bleed:V2"))).toBe(true);
    announce(engine, "basic");
    finish(engine, state);
    const options = ids(engine);
    expect(options).not.toContain("bleed:V2");
    expect(options).not.toContain("bleed:ally");
    expect(options.some(id => id.startsWith("play:Govern the Unaligned:basic:V2"))).toBe(false);
    expect(options.some(id => id.startsWith("play:The Platinum Protocol") && id.includes(":V2"))).toBe(false);
    expect(options.some(id => id.startsWith("act:Codex of the Edenic Groundskeepers:codex:bleed:V2"))).toBe(false);
    expect(options).toContain("hunt:V2");
  });
  it("follows current control and expires at the end of the turn, including across save/restore", () => {
    const { state, engine } = game();
    announce(engine, "basic");
    finish(engine, state);
    engine.changeMinionControl("W", "Alice");
    engine.changeMinionControl("V2", "Bob");
    expect(ids(engine)).not.toContain("bleed:W");
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    expect(ids(resumed)).not.toContain("bleed:W");
    for (let i = 0; i < 250; i++) {
      const dp = resumed.decision();
      if (!dp) break;
      if (dp.seat === "Bob" && dp.window === "turn.minion") break;
      resumed.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(resumed.decision()!.seat).toBe("Bob");
    expect(resumed.decision()!.window).toBe("turn.minion");
    expect(ids(resumed)).toContain("bleed:V2");
    const bobTurn = saved.frames.find(f => f.kind === "turn");
    expect(bobTurn?.kind === "turn" && bobTurn.cannotBleedSeats?.includes("Alice")).not.toBe(true);
    for (let i = 0; i < 300; i++) {
      const dp = resumed.decision();
      if (!dp) break;
      if (dp.seat === "Alice" && dp.window === "turn.minion") break;
      resumed.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(resumed.decision()!.seat).toBe("Alice");
    expect(resumed.decision()!.window).toBe("turn.minion");
    expect(ids(resumed)).toContain("bleed:V1");
    expect(ids(resumed)).toContain("bleed:W");
  });

  it("bars only the bleed mode of a multi-mode action card", () => {
    const { state, engine } = game();
    state.seats[0]!.minions[1]!.disciplines = { pot: "basic", pre: "basic" };
    state.seats[0]!.hand.push({ id: "line", name: "Line Brawl" });
    expect(ids(engine).some(id => id.startsWith("play:Line Brawl:basic:V2:bleed"))).toBe(true);
    announce(engine, "basic");
    finish(engine, state);
    expect(ids(engine).some(id => id.startsWith("play:Line Brawl:basic:V2:bleed"))).toBe(false);
    expect(ids(engine).some(id => id.startsWith("play:Line Brawl:basic:V2:combat"))).toBe(true);
  });

  it("a mandatory-bleed minion is not stuck by a prohibition", () => {
    const { state, engine } = game();
    announce(engine, "basic");
    finish(engine, state);
    state.seats[0]!.minions[1]!.attached.push({ card: { id: "must", name: "test" }, locked: false,
      usedThisPhase: false, tags: [], statics: { mustBleed: { bonus: 1, whileControlsLocked: true } } });
    expect(ids(engine)).not.toContain("bleed:V2");
    expect(ids(engine)).toContain("hunt:V2");
  });

  it("if the Edge is lost during the action, burns no pool but still bars bleeds", () => {
    const { state, engine } = game();
    announce(engine, "superior");
    engine.takeEdge("Bob");
    finish(engine, state);
    expect(state.edge).toBe("Bob");
    expect(state.seats[1]!.pool).toBe(10);
    expect(ids(engine)).not.toContain("bleed:V2");
  });
  it("if blocked, does not burn the Edge or pool and imposes no bleed restriction", () => {
    const { state, engine } = game();
    announce(engine, "basic");
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.edge).toBe("Alice");
    expect(state.seats[1]!.pool).toBe(10);
    const tf = state.frames.find(f => f.kind === "turn");
    expect(tf?.kind === "turn" && tf.cannotBleedSeats?.includes("Alice")).not.toBe(true);
    expect(state.frames.some(f => f.kind === "combat")).toBe(true);
  });
  it("if canceled as played, does not burn the Edge, pool, or restrict bleeds", () => {
    const { state, engine } = game();
    state.seats[2]!.hand.push({ id: "di", name: "Direct Intervention" });
    engine.choose("play:Enticement:basic:V1:ent");
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "play:Direct Intervention"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.edge).toBe("Alice");
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.seats[0]!.minions[0]!.locked).toBe(false);
    expect(ids(engine)).toContain("bleed:V2");
  });
});
