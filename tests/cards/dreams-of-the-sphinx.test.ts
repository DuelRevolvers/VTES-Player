/**
 * Dreams of the Sphinx (100588) — the first counter one-off on the Gate 8
 * substrate. Each lock adds a counter; the card burns at 3. Exercises the
 * master-phase "add 1 blood to an uncontrolled vampire" and unlock-phase
 * "gain 1 pool if you have the Edge" abilities.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function withSphinx(counters: number, phase: "master" | "unlock"): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = phase;
    tf.masterActionsLeft = 1;
    if (phase === "unlock") {
      tf.unlockAbilitiesDone = false;
      tf.unlockDone = false;
    }
  }
  state.seats[0]!.permanents.push({
    card: { id: "ds1", name: "Dreams of the Sphinx" },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
    counters,
  });
  return state;
}

describe("Dreams of the Sphinx", () => {
  it("locks to add 1 blood to an uncontrolled vampire, gaining a counter", () => {
    const state = withSphinx(0, "master");
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 5 }),
      counters: 0,
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);

    const perm = state.seats[0]!.permanents.find((p) => p.card.id === "ds1")!;
    expect(perm.locked).toBe(true);
    expect(perm.counters).toBe(1);
    // The uncontrolled vampire gained 1 blood from the bank — tracked as
    // counters on the uncontrolled entry (no pool change).
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(1);
  });

  it("burns itself when the third counter lands", () => {
    const state = withSphinx(2, "master");
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 5 }),
      counters: 0,
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);

    // Third counter → burned.
    expect(state.seats[0]!.permanents.some((p) => p.card.id === "ds1")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned" && e.cardId === "ds1")).toBe(true);
  });

  it("locks during the unlock phase to gain 1 pool while holding the Edge", () => {
    const state = withSphinx(0, "unlock");
    state.edge = "Alice";
    const engine = new VtesEngine(state, testRegistry);

    // The unlock-phase Edge ability is offered; use it.
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:pool"]]);

    expect(state.seats[0]!.pool).toBe(11); // 10 + 1
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "ds1")!.counters).toBe(1);
  });
});

describe("Dreams timing regressions", () => {
  for (const phase of ["unlock", "minion", "influence", "discard"] as const) {
    it(`can add blood during ${phase}`, () => {
      const state = withSphinx(0, phase === "unlock" ? "unlock" : "master");
      const tf = state.frames[0]!;
      if (tf.kind !== "turn") throw new Error("fixture");
      tf.phase = phase;
      state.seats[0]!.uncontrolled.push({ card: makeMinion("U", "Alice", { blood: 0, capacity: 5 }), counters: 0 });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);
      expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(1);
      expect(state.seats[0]!.permanents[0]!.counters).toBe(1);
    });
  }

  it("can add blood on another player's action", () => {
    const state = withSphinx(0, "master");
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("fixture");
    tf.phase = "minion";
    tf.seat = "Bob";
    state.seats[0]!.uncontrolled.push({ card: makeMinion("U", "Alice", { blood: 0 }), counters: 0 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Bob", "bleed:M"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(1);
  });
});

describe("Dreams in combat", () => {
  it("can lock for blood after strikes are declared, before resolution", () => {
    const state = withSphinx(0, "master");
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("fixture");
    tf.phase = "minion";
    state.seats[0]!.uncontrolled.push({ card: makeMinion("U", "Alice", { blood: 0 }), counters: 0 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision()!;
      if (dp.window === "combat.beforeResolution" && dp.seat === "Alice") break;
      const option = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "strike:hand");
      if (!option) throw new Error(`no advancing option in ${dp.window}`);
      engine.choose(option.id);
    }
    expect(engine.decision()!.window).toBe("combat.beforeResolution");
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:blood:U"]]);
    expect(state.seats[0]!.uncontrolled[0]!.counters).toBe(1);
  });
});

describe("Dreams counter threshold", () => {
  it("counts a lock from another effect exactly once and burns at three", () => {
    const state = withSphinx(1, "master");
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "PermanentLocked", cardId: "ds1" });
    expect(state.seats[0]!.permanents[0]!.counters).toBe(2);
    engine.emit({ type: "PermanentLocked", cardId: "ds1" });
    expect(state.seats[0]!.permanents[0]!.counters).toBe(2);
    const resumed = new VtesEngine(JSON.parse(JSON.stringify(state)), testRegistry);
    resumed.emit({ type: "PermanentUnlocked", cardId: "ds1" });
    resumed.emit({ type: "PermanentLocked", cardId: "ds1" });
    expect(resumed.state.seats[0]!.permanents.some(p => p.card.id === "ds1")).toBe(false);
    expect(resumed.state.eventLog.filter(e => e.type === "PermanentBurned" && e.cardId === "ds1")).toHaveLength(1);
  });
  it("burns when a different effect adds the third counter", () => {
    const state = withSphinx(2, "master");
    const engine = new VtesEngine(state, testRegistry);
    engine.addCounters("ds1", 1);
    expect(state.seats[0]!.permanents.some(p => p.card.id === "ds1")).toBe(false);
    expect(state.eventLog.filter(e => e.type === "PermanentBurned" && e.cardId === "ds1")).toHaveLength(1);
  });
  it("does not burn below the threshold and counts only remaining counters", () => {
    const state = withSphinx(2, "master");
    const engine = new VtesEngine(state, testRegistry);
    engine.removeCounters("ds1", 1);
    engine.addCounters("ds1", 1);
    expect(state.seats[0]!.permanents.find(p => p.card.id === "ds1")!.counters).toBe(2);
    engine.addCounters("ds1", 1);
    expect(state.seats[0]!.permanents.some(p => p.card.id === "ds1")).toBe(false);
  });
  it("applies its third-lock payoff before it burns", () => {
    const state = withSphinx(2, "unlock");
    state.edge = "Alice";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:pool"]]);
    expect(state.seats[0]!.pool).toBe(11);
    expect(state.seats[0]!.permanents.some(p => p.card.id === "ds1")).toBe(false);
  });
});


describe("Dreams rules boundaries", () => {
  it("does not offer blood to a non-vampire uncontrolled minion", () => {
    const state = withSphinx(0, "master");
    state.seats[0]!.uncontrolled.push({ card: makeMinion("imbued", "Alice", { kind: "ally" }), counters: 0 });
    state.seats[0]!.uncontrolled.push({ card: makeMinion("vampire", "Alice"), counters: 0 });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).not.toContain("ability:Dreams of the Sphinx:ds1:blood:imbued");
    expect(ids).toContain("ability:Dreams of the Sphinx:ds1:blood:vampire");
  });

  it("cannot be activated in response to a card as it is played", () => {
    const state = withSphinx(0, "master");
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("fixture");
    tf.phase = "minion";
    state.seats[0]!.minions[0]!.disciplines.dom = "superior";
    state.seats[0]!.hand.push({ id: "mod", name: "Conditioning" });
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    for (let i = 0; i < 12 && !engine.decision()!.options.some((o) => o.kind === "playCard" && o.card === "mod"); i++) engine.choose("pass");
    engine.choose(engine.decision()!.options.find((o) => o.kind === "playCard" && o.card === "mod")!.id);
    expect(engine.decision()!.window).toBe("card.asPlayed");
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Dreams of the Sphinx:"))).toBe(false);
  });

  it("cannot use a contested Dreams", () => {
    const state = withSphinx(0, "master");
    state.seats[1]!.permanents.push({ card: { id: "opponent-dream", name: "Dreams of the Sphinx" },
      locked: false, usedThisPhase: false, statics: {}, tags: [], counters: 0 });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Dreams of the Sphinx:"))).toBe(false);
    expect(state.seats[0]!.contested?.some((c) => c.card.id === "ds1")).toBe(true);
  });
});
