/**
 * Stun (docs/stun-design.md) — Kiss of Cathari (102330), Mind Numb
 * (101211).
 *
 * The word is defined by no rulebook page and no other card; the owner
 * ruled it on 2026-08-31:
 *
 *   "Stun: lock a minion and put a stun counter on them. A minion with one
 *    or more stun counters does not unlock as normal at the beginning of
 *    their controller's unlock phase; during that unlock phase, burn all
 *    stun counters they had at the beginning of the turn."
 *
 * Both halves are pinned here, including the snapshot in the second one —
 * a stun applied DURING an unlock phase must survive it.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, stunned } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Drive the turn frame to Alice's unlock phase and let it sweep. */
function runUnlockPhase(state: GameState): void {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = "Alice";
  tf.phase = "unlock";
  tf.unlockDone = false;
  const engine = new VtesEngine(state, testRegistry);
  engine.decision(); // settling runs the sweep
}

describe("the unlock rule", () => {
  it("a stunned minion does not unlock, and the counter is burned", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    Object.assign(v1, { locked: true, counters: { stun: 1 } });
    expect(stunned(v1)).toBe(true);

    runUnlockPhase(state);

    // Skipped this unlock phase, and the counter is spent doing it.
    expect(find(state, "V1").locked).toBe(true);
    expect(stunned(find(state, "V1"))).toBe(false);
  });

  it("unlocks normally the turn AFTER — one counter costs one unlock phase", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { locked: true, counters: { stun: 1 } });
    runUnlockPhase(state);
    expect(find(state, "V1").locked).toBe(true);
    runUnlockPhase(state);
    expect(find(state, "V1").locked).toBe(false);
  });

  it("two counters still cost only one unlock phase — all are burned at once", () => {
    // The ruling burns ALL counters held at the beginning of the turn, so
    // the count does not extend the effect.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { locked: true, counters: { stun: 2 } });
    runUnlockPhase(state);
    expect(find(state, "V1").locked).toBe(true);
    expect(find(state, "V1").counters?.["stun"] ?? 0).toBe(0);
    runUnlockPhase(state);
    expect(find(state, "V1").locked).toBe(false);
  });

  it("a stun landing DURING the unlock phase survives it (the snapshot)", () => {
    // "…burn all stun counters they had at the BEGINNING of the turn."
    // Cards act during an unlock phase, so a counter arriving after the
    // sweep must not be burned by that same sweep.
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Alice";
    tf.phase = "unlock";
    tf.unlockDone = false;
    Object.assign(find(state, "V1"), { locked: true });
    const engine = new VtesEngine(state, testRegistry);
    engine.decision(); // the sweep runs: V1 had no counters, so it unlocks
    expect(find(state, "V1").locked).toBe(false);

    engine.stun("V1");
    expect(find(state, "V1").locked).toBe(true);
    expect(find(state, "V1").counters?.["stun"]).toBe(1);

    // Next turn is when it is paid for, not this one.
    runUnlockPhase(state);
    expect(find(state, "V1").locked).toBe(true);
    expect(stunned(find(state, "V1"))).toBe(false);
  });

  it("wastes no counter-sink counter on a minion that was not unlocking anyway", () => {
    // Touch of Oblivion pays "instead of unlocking as normal"; a stunned
    // minion was never going to unlock, so there is nothing to pay for.
    const withSink = (stun: number): GameState => {
      const state = threeSeatGame();
      const v1 = find(state, "V1");
      Object.assign(v1, { locked: true, ...(stun > 0 ? { counters: { stun } } : {}) });
      v1.attached.push({
        card: { id: "to", name: "Touch of Oblivion" },
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: [],
        counters: 2,
        counterSink: { instead: "unlock" },
      });
      runUnlockPhase(state);
      return state;
    };
    const sinkOf = (s: GameState): number =>
      find(s, "V1").attached.find((p) => p.card.id === "to")?.counters ?? -1;

    // The control: with no stun the sink DOES fire, so the assertion below
    // is about the stun and not about a sink that never worked.
    expect(sinkOf(withSink(0))).toBe(1);
    expect(sinkOf(withSink(1))).toBe(2);
  });
});

describe("Mind Numb (101211)", () => {
  function game(mode: "basic" | "superior"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { pre: mode === "basic" ? "basic" : "superior" },
      blood: 3,
    });
    state.seats[0]!.hand.push({ id: "mn", name: "Mind Numb" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("targets any Methuselah's UNLOCKED vampire, never the actor, never an ally", () => {
    const { state, engine } = game("basic");
    find(state, "W").locked = true; // Bob's other vampire is locked
    find(state, "M").kind = "ally";
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("play:Mind Numb:"))
      .map((o) => o.id);
    // Only Carol's N qualifies: W is locked, M is an ally, V1 is the actor.
    expect(ids).toEqual(["play:Mind Numb:basic:V1:N:mn"]);
  });

  it("locks the target, counters it, and does NOT enter combat", () => {
    const { state, engine } = game("basic");
    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Mind Numb:basic:V1:W:mn"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
    const w = find(state, "W");
    expect(w.locked).toBe(true);
    expect(stunned(w)).toBe(true);
    expect(find(state, "V1").blood).toBe(blood - 1);
    // The whole reason `noCombatOnSuccess` exists: a successful action
    // naming a minion would otherwise rush it.
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
  });

  it("is directed: only the target's controller may block", () => {
    const { state, engine } = game("basic");
    runTrace(engine, [
      ["Alice", "play:Mind Numb:basic:V1:W:mn"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.directed).toBe(true);
    expect(af.target).toBe("Bob");
  });

  it("superior is the +1 stealth version", () => {
    const { state, engine } = game("superior");
    runTrace(engine, [
      ["Alice", "play:Mind Numb:superior:V1:W:mn"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
  });

  it("a blocked Mind Numb stuns nobody", () => {
    const { state, engine } = game("basic");
    runTrace(engine, [
      ["Alice", "play:Mind Numb:basic:V1:W:mn"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block resolves
    ]);
    expect(stunned(find(state, "W"))).toBe(false);
  });
});

describe("Kiss of Cathari (102330)", () => {
  /** Alice's V1 bleeds, Bob's M blocks; stop at Choose Strike. */
  function intoStrikes(disc: Record<string, "basic" | "superior">): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: disc, blood: 4, strength: 1 });
    Object.assign(find(state, "M"), { blood: 4, strength: 1, locked: false });
    state.seats[0]!.hand.push({ id: "kc", name: "Kiss of Cathari" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range: stays close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ]);
    return { state, engine };
  }

  function drainCombat(engine: VtesEngine, state: GameState): void {
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (!state.frames.some((f) => f.kind === "combat")) break;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
  }

  it("plays off EITHER Obfuscate or Presence", () => {
    // "[obf] or [pre]" — the any-one-of shape, not a dual requirement.
    for (const d of ["obf", "pre"] as const) {
      const { engine } = intoStrikes({ [d]: "basic" });
      const ids = engine.decision()!.options.map((o) => o.id);
      expect(ids.some((i) => i.startsWith("play:Kiss of Cathari:basic:V1")), d).toBe(true);
    }
  });

  it("superior ends combat and stuns the opposing minion at close range", () => {
    const { state, engine } = intoStrikes({ pre: "superior" });
    runTrace(engine, [
      ["Alice", "play:Kiss of Cathari:superior:V1:kc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    drainCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    const m = find(state, "M");
    expect(stunned(m)).toBe(true);
    expect(m.locked).toBe(true);
  });

  it("basic ends combat and stuns nobody", () => {
    const { state, engine } = intoStrikes({ pre: "superior" });
    runTrace(engine, [
      ["Alice", "play:Kiss of Cathari:basic:V1:kc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drainCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(stunned(find(state, "M"))).toBe(false);
  });

  it("does not stun at long range", () => {
    // "…if the range is close" is the range as combat ENDED. Bob's
    // blocker maneuvers away before the strike.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { pre: "superior" }, blood: 4 });
    Object.assign(find(state, "M"), { blood: 4, disciplines: { cel: "basic" } });
    state.seats[0]!.hand.push({ id: "kc", name: "Kiss of Cathari" });
    state.seats[1]!.hand.push({ id: "pu", name: "Pursuit" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      // Range step: Alice declines, Bob maneuvers away.
      ["Alice", "pass"],
      ["Bob", "play:Pursuit:basic:M:pu"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], // range closes at long
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    expect(cf.range).toBe("long");

    // The card is a STRIKE card, so it is played in the strike window.
    runTrace(engine, [
      ["Alice", "play:Kiss of Cathari:superior:V1:kc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    drainCombat(engine, state);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(stunned(find(state, "M"))).toBe(false);
  });
});
