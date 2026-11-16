/**
 * Trophy: Wealth (102039): "Master. Trophy. When this card is placed on a
 * vampire, put five counters on it. The vampire with this card can use these
 * counters to pay some or all of the blood or pool cost of equipment. Burn
 * this card when the last counter is removed."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's V1 holds Trophy: Wealth; the equipment is played in her minion phase. */
function setup(withEquipment = true): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("turn fixture");
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(find(state, "V1"), { blood: 4, capacity: 5 });
  state.seats[0]!.hand = [{ id: "tw", name: "Trophy: Wealth" }];
  if (withEquipment) state.seats[0]!.hand.push({ id: "mag", name: ".44 Magnum" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Pass until the given option is offered, never choosing an action by accident. */
function passUntil(engine: VtesEngine, pred: (ids: string[]) => boolean, max = 120): boolean {
  for (let i = 0; i < max; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    const ids = dp.options.map((o) => o.id);
    if (pred(ids)) return true;
    engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
  }
  return false;
}

describe("Trophy: Wealth (102039)", () => {
  it("is put on a vampire with five counters", () => {
    const { state, engine } = setup(false);
    engine.choose("play:Trophy: Wealth:-:V1:tw");
    passUntil(engine, (ids) => ids.some((o) => o.startsWith("bleed:V1") || o.startsWith("hunt:V1")));
    const card = find(state, "V1").attached.find((p) => p.card.name === "Trophy: Wealth");
    expect(card).toBeDefined();
    expect(card!.counters).toBe(5);
  });

  it("pays the equipment's pool cost from the counters, one counter per pool", () => {
    const { state, engine } = setup();
    engine.choose("play:Trophy: Wealth:-:V1:tw");
    expect(passUntil(engine, (ids) => ids.some((o) => o.startsWith("bleed:V1")))).toBe(true);
    const poolBefore = state.seats[0]!.pool;
    const bloodBefore = find(state, "V1").blood;
    const ids = engine.decision()!.options.map((o) => o.id);
    // .44 Magnum costs 2 pool; the split that pays it entirely from the counters.
    const fromCounters = ids.find((o) => o.includes(":mag") && o.includes(":tw/0/2"));
    expect(fromCounters).toBeDefined();
    engine.choose(fromCounters!);
    passUntil(engine, () => false, 60);
    const card = find(state, "V1").attached.find((p) => p.card.name === "Trophy: Wealth");
    expect(card?.counters).toBe(3);
    expect(state.seats[0]!.pool).toBe(poolBefore);
    expect(find(state, "V1").blood).toBe(bloodBefore);
  });

  it("is burned when the last counter is spent", () => {
    const { state, engine } = setup();
    engine.choose("play:Trophy: Wealth:-:V1:tw");
    expect(passUntil(engine, (ids) => ids.some((o) => o.startsWith("bleed:V1")))).toBe(true);
    const card = find(state, "V1").attached.find((p) => p.card.name === "Trophy: Wealth")!;
    card.counters = 2;
    const ids = engine.decision()!.options.map((o) => o.id);
    engine.choose(ids.find((o) => o.includes(":mag") && o.includes(":tw/0/2"))!);
    passUntil(engine, () => false, 60);
    expect(find(state, "V1").attached.some((p) => p.card.name === "Trophy: Wealth")).toBe(false);
  });
});
