import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState, type PermanentInPlay } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function space(state: GameState, id = "space"): PermanentInPlay {
  const result = state.seats.flatMap(s => s.permanents).find(p => p.card.id === id);
  if (!result) throw new Error(`missing ${id}`);
  return result;
}
function playSpace(state: GameState, id = "space"): VtesEngine {
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("missing turn");
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  state.seats[0]!.hand.push({ id, name: "Hackerspace" });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", `play:Hackerspace:-:${id}`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
  return engine;
}
function moveToInfluence(state: GameState): void {
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("missing turn");
  turn.phase = "influence";
  turn.transfersLeft = 4;
}

describe("Hackerspace (100876)", () => {
  it("enters with one counter per controlled Anarch, including torpor, without gaining pool", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "anarch";
    state.seats[0]!.minions.push(makeMinion("a2", "Alice", { sect: "anarch", inTorpor: true }));
    state.seats[0]!.minions.push(makeMinion("c", "Alice", { sect: "camarilla" }));
    state.seats[1]!.minions[0]!.sect = "anarch";
    const pool = state.seats[0]!.pool;
    playSpace(state);
    expect(space(state).counters).toBe(2);
    expect(space(state).costSource).toMatchObject({ for: "equipment", sect: "anarch" });
    expect(state.seats[0]!.pool).toBe(pool);
    expect(testRegistry.Hackerspace!.isUnique).not.toBe(true);
  });

  it("counts Convert's entry before its effect and a separate conversion, even after save/load", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "camarilla";
    state.seats[0]!.minions[0]!.title = null;
    const engine = playSpace(state);
    expect(space(state).counters).toBe(0);
    moveToInfluence(state);
    state.seats[0]!.uncontrolled.push({ card: makeMinion("convert", "Alice", { name: "Anarch Convert (ANY)", capacity: 1, sect: "anarch" }), counters: 1 });
    engine.choose("inf:out:convert");
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose("choice:Anarch Convert (ANY):convert:convert:V1:pool");
    expect(space(saved).counters).toBe(2);
    const events = saved.eventLog;
    const entered = events.findIndex(e => e.type === "VampireEnteredPlay" && e.minion === "convert");
    const removed = events.findIndex(e => e.type === "MinionRemovedFromGame" && e.minion === "convert");
    const changed = events.findIndex(e => e.type === "MinionSectChanged" && e.minion === "V1");
    const counters = events.map((e, i) => ({ e, i })).filter(x => x.e.type === "CountersChanged" && x.e.cardId === "space");
    expect(counters).toHaveLength(2);
    expect(entered).toBeLessThan(counters[0]!.i);
    expect(counters[0]!.i).toBeLessThan(removed);
    expect(removed).toBeLessThan(changed);
    expect(changed).toBeLessThan(counters[1]!.i);
  });

  it("does not count an already-Anarch target a second time", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "anarch";
    state.seats[0]!.minions[0]!.title = null;
    const engine = playSpace(state);
    moveToInfluence(state);
    state.seats[0]!.uncontrolled.push({ card: makeMinion("convert", "Alice", { name: "Anarch Convert (ANY)", capacity: 1, sect: "anarch" }), counters: 1 });
    engine.choose("inf:out:convert");
    engine.choose("choice:Anarch Convert (ANY):convert:convert:V1:pool");
    expect(space(state).counters).toBe(2); // one initial + one for Convert
  });

  it("counts Convert entering before a contest when the controller keeps it", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.title = null;
    const engine = playSpace(state);
    moveToInfluence(state);
    state.seats[1]!.minions.push(makeMinion("other", "Bob", { name: "Anarch Convert (ANY)", capacity: 1, sect: "anarch" }));
    state.seats[0]!.uncontrolled.push({ card: makeMinion("convert", "Alice", { name: "Anarch Convert (ANY)", capacity: 1, sect: "anarch" }), counters: 1 });
    engine.choose("inf:out:convert");
    engine.choose("choice:Anarch Convert (ANY):convert:convert:keep");
    engine.decision();
    expect(space(state).counters).toBe(1);
    expect(state.seats[0]!.contested?.some(c => c.card.id === "convert")).toBe(true);
  });

  it("tracks actual Anarch entry and sect changes but ignores opponents and no-op changes", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "camarilla";
    const engine = playSpace(state);
    engine.emit({ type: "MinionSectChanged", minion: "V1", sect: "anarch" });
    engine.emit({ type: "MinionSectChanged", minion: "V1", sect: "anarch" });
    engine.emit({ type: "MinionSectChanged", minion: "W", sect: "anarch" });
    engine.emit({ type: "VampireTokenEnteredPlay", seat: "Alice", minion: "token", cardId: "token", name: "Token", capacity: 1, clan: null, sect: "anarch" });
    expect(space(state).counters).toBe(2);
  });

  it("allows only a controlled Anarch to pay an equipment cost with counters", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "anarch";
    state.seats[0]!.minions.push(makeMinion("non", "Alice", { sect: "camarilla" }));
    playSpace(state);
    const turn = state.frames[0]!;
    if (turn.kind !== "turn") throw new Error("missing turn");
    turn.phase = "minion";
    state.seats[0]!.hand.push({ id: "bow", name: "Ivory Bow" });
    const engine = new VtesEngine(state, testRegistry);
    const options = engine.decision()!.options.map(o => o.id);
    expect(options.some(id => id === "play:Ivory Bow:basic:V1:space/0/1:bow")).toBe(true);
    expect(options.some(id => id.includes(":non:space/"))).toBe(false);
    const pool = state.seats[0]!.pool;
    runTrace(engine, [["Alice", "play:Ivory Bow:basic:V1:space/0/1:bow"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(space(state).counters).toBe(0);
    expect(space(state).locked).toBe(false);
    expect(state.seats[0]!.pool).toBe(pool);
    expect(state.seats[0]!.minions[0]!.attached.some(p => p.card.name === "Ivory Bow")).toBe(true);
  });
  it("allows multiple copies and triggers each of them independently", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "camarilla";
    playSpace(state, "first");
    const engine = playSpace(state, "second");
    expect(space(state, "first").counters).toBe(0);
    expect(space(state, "second").counters).toBe(0);
    engine.emit({ type: "MinionSectChanged", minion: "V1", sect: "anarch" });
    expect(space(state, "first").counters).toBe(1);
    expect(space(state, "second").counters).toBe(1);
    expect(state.seats[0]!.contested ?? []).toEqual([]);
  });

  it("pays a blood cost without locking or spending the vampire's blood", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { sect: "anarch", clan: "Tzimisce", blood: 3 });
    playSpace(state);
    const turn = state.frames[0]!;
    if (turn.kind !== "turn") throw new Error("missing turn");
    turn.phase = "minion";
    state.seats[0]!.hand.push({ id: "manse", name: "Living Manse" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Living Manse:basic:V1:space/1/0:manse"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(space(state).counters).toBe(0);
    expect(space(state).locked).toBe(false);
    expect(state.seats[0]!.minions[0]!.blood).toBe(3);
    expect(state.seats[0]!.minions[0]!.attached.some(p => p.card.name === "Living Manse")).toBe(true);
  });

  it("spends no counters for a blocked equip action", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "anarch";
    playSpace(state);
    const turn = state.frames[0]!;
    if (turn.kind !== "turn") throw new Error("missing turn");
    turn.phase = "minion";
    state.seats[1]!.minions[0]!.attached.push({ card: { id: "scope", name: "Scope" }, locked: false, usedThisPhase: false, statics: { intercept: 3 }, tags: [] });
    state.seats[0]!.hand.push({ id: "bow", name: "Ivory Bow" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Ivory Bow:basic:V1:space/0/1:bow"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.eventLog.some(e => e.type === "BlockSucceeded")).toBe(true);
    expect(space(state).counters).toBe(1);
  });

  it("rechecks the Anarch condition when the equip cost is paid", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "anarch";
    playSpace(state);
    const turn = state.frames[0]!;
    if (turn.kind !== "turn") throw new Error("missing turn");
    turn.phase = "minion";
    state.seats[0]!.hand.push({ id: "bow", name: "Ivory Bow" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Ivory Bow:basic:V1:space/0/1:bow"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    engine.emit({ type: "MinionSectChanged", minion: "V1", sect: "camarilla" });
    const pool = state.seats[0]!.pool;
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(space(state).counters).toBe(1);
    expect(state.seats[0]!.pool).toBe(pool - 1);
  });

  it("does not spend counters for a discount gained after announcement, including after save/load", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.sect = "anarch";
    playSpace(state);
    const turn = state.frames[0]!;
    if (turn.kind !== "turn") throw new Error("missing turn");
    turn.phase = "minion";
    state.seats[0]!.hand.push({ id: "bow", name: "Ivory Bow" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Ivory Bow:basic:V1:space/0/1:bow"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    state.seats[0]!.minions[0]!.attached.push({
      card: { id: "discount", name: "equipment discount" }, locked: false, usedThisPhase: false, tags: [],
      statics: { playCostMod: { amount: -1, pays: "pool", cardTypes: ["equipment"], minions: "bearer" } },
    });
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    const pool = saved.seats[0]!.pool;
    runTrace(resumed, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(space(saved).counters).toBe(1);
    expect(saved.seats[0]!.pool).toBe(pool);
    expect(saved.seats[0]!.minions[0]!.attached.some(p => p.card.name === "Ivory Bow")).toBe(true);
  });

});
