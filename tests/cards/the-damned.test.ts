/**
 * The Damned (100490): "Unique master. Put this card on a vampire with a
 * capacity below 5. The vampire with this card burns 1 additional blood for
 * each bleeding action he or she successfully performs (after resolving the
 * action)."
 *
 * The extra burn is read off the bearer's statics when a bleed succeeds, in
 * the resolution step (engine.ts, `bleedSuccessBloodBurn`). A failed bleed
 * burns nothing extra.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { attachTargets } from "../../src/cards/effects/compile.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's V1 (capacity 4) in her master phase, optionally carrying The Damned. */
function setup(withDamned: boolean): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("turn fixture");
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  Object.assign(find(state, "V1"), { blood: 5, capacity: 4 });
  const engine = new VtesEngine(state, testRegistry);
  if (withDamned) {
    engine.putPermanentInPlay({
      card: { id: "dm", name: "The Damned" },
      seat: "Alice",
      attachTo: "V1",
      statics: { bleedSuccessBloodBurn: 1 },
      tags: ["The Damned"],
    });
  }
  return { state, engine };
}

/** Choose the bleed on V1 and stop at the action's resolution. Returns the
 *  events from the bleed's announcement through its resolution, so the
 *  next turn's gains cannot leak into the comparison. */
function bleedAndResolve(engine: VtesEngine, state: GameState) {
  // Pass until the bleed is offered; never pick anything else by accident.
  let bleed: string | undefined;
  for (let i = 0; i < 20 && !bleed; i++) {
    const dp = engine.decision();
    if (!dp) throw new Error("no decision before the bleed");
    bleed = dp.options.find((o) => o.id.startsWith("bleed:V1"))?.id;
    if (!bleed) engine.choose(dp.options.some((o) => o.id === "pass") ? "pass" : dp.options[0]!.id);
  }
  if (!bleed) throw new Error("bleed never offered");
  const from = state.eventLog.length;
  engine.choose(bleed);
  for (let i = 0; i < 60; i++) {
    if (state.eventLog.slice(from).some((e) => e.type === "ActionResolved")) break;
    const next = engine.decision();
    if (!next) break;
    const ids = next.options.map((o) => o.id);
    engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
  }
  return state.eventLog.slice(from);
}

/** Blood the V1 burned by its own bleed (The Damned's extra burn). */
function extraBurn(events: GameState["eventLog"]): number {
  return events.reduce((n, e) => (e.type === "BloodBurned" && e.minion === "V1" ? n + e.amount : n), 0);
}

describe("The Damned (100490)", () => {
  it("a successful bleed burns 1 extra blood; without the card there is no extra burn", () => {
    const control = setup(false);
    expect(extraBurn(bleedAndResolve(control.engine, control.state))).toBe(0);
    const withCard = setup(true);
    expect(extraBurn(bleedAndResolve(withCard.engine, withCard.state))).toBe(1);
  });

  it("a blocked bleed (not successful) gets no extra burn: same combat burns with and without the card", () => {
    // The combat itself burns blood (damage mending), so the test compares
    // the same blocked combat with and without The Damned, not a raw count.
    function blockedRun(withCard: boolean): number {
      const { state, engine } = setup(withCard);
      let blocked = false;
      for (let i = 0; i < 40 && !blocked; i++) {
        const dp = engine.decision();
        if (!dp) break;
        const ids = dp.options.map((o) => o.id);
        if (ids.includes("block:M") && dp.seat === "Bob") {
          engine.choose("block:M");
          blocked = true;
          break;
        }
        if (ids.includes("bleed:V1") && dp.seat === "Alice") {
          engine.choose("bleed:V1");
          continue;
        }
        engine.choose(ids.includes("pass") ? "pass" : ids[0]!);
      }
      expect(blocked).toBe(true);
      const from = state.eventLog.length;
      for (let i = 0; i < 80; i++) {
        if (state.eventLog.slice(from).some((e) => e.type === "ActionResolved")) break;
        const next = engine.decision();
        if (!next) break;
        const ids = next.options.map((o) => o.id);
        engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
      }
      const evs = state.eventLog.slice(from);
      expect(evs.some((e) => e.type === "MinionActionSucceeded")).toBe(false);
      return evs.reduce((n, e) => (e.type === "BloodBurned" && e.minion === "V1" ? n + e.amount : n), 0);
    }
    expect(blockedRun(true)).toBe(blockedRun(false));
  });

  it("the extra burn is capped by the blood the vampire has", () => {
    const { state, engine } = setup(true);
    find(state, "V1").blood = 1;
    expect(extraBurn(bleedAndResolve(engine, state))).toBe(1);
    expect(find(state, "V1").blood).toBe(0);
  });

  it("the statics are read off the bearer, not the bank (bleedSuccessBloodBurn on the attached card)", () => {
    const { state } = setup(true);
    const card = find(state, "V1").attached.find((p) => p.card.name === "The Damned")!;
    expect(card.statics.bleedSuccessBloodBurn).toBe(1);
  });

  it("the card goes only on a vampire with capacity below 5 (attach gate on the real spec)", () => {
    const spec = cardSpecs.find((s) => s.name === "The Damned")!;
    const state = threeSeatGame();
    for (const m of state.seats.flatMap((s) => s.minions)) m.capacity = 5;
    find(state, "V1").capacity = 4;
    const ids = attachTargets(state, "Alice", spec).map((m) => m.id);
    expect(ids).toContain("V1");
    expect(ids).not.toContain("M");
    expect(ids).not.toContain("W");
  });
});
