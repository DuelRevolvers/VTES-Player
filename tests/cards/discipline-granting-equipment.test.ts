/**
 * Discipline-granting equipment
 * (docs/discipline-granting-equipment-design.md).
 *
 * Changeling Skin Mask (100325), Drum of Xipe Totec (100591),
 * Veneficorum Artum Sanguis (102102) — three equipment cards whose first
 * sentence is "has superior <D>", a grant AT A LEVEL where the engine
 * only had "+1 level of <D>".
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { currentIntercept, disciplinesOf } from "../../src/engine/derived.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

/** Equipment in play on `minion`, taking its statics from the compiled
 *  handler — so the test reads what the registry actually built. */
function equip(state: GameState, minionId: string, cardId: string, name: string): void {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler ${name}`);
  const e: PermanentInPlay = {
    card: { id: cardId, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  find(state, minionId).attached.push(e);
}

function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
  return false;
}

// ---------------------------------------------------------------------------
// §1 — the grant itself
// ---------------------------------------------------------------------------

describe("`has superior <D>` is a grant, not a boost (§1)", () => {
  it("gives superior to a vampire with none — where +1 level would give basic", () => {
    const state = threeSeatGame();
    equip(state, "V1", "drum", "Drum of Xipe Totec");
    expect(disciplinesOf(find(state, "V1"))["cel"]).toBe("superior");
    // …and the second sentence is the existing maneuver credit.
    expect(find(state, "V1").attached[0]!.statics.maneuverPerCombat).toBe(1);
  });

  it("NEGATIVE SPACE: it is a floor — a printed superior is never pushed down", () => {
    const state = threeSeatGame();
    find(state, "V1").disciplines["obf"] = "superior";
    equip(state, "V1", "mask", "Changeling Skin Mask");
    expect(disciplinesOf(find(state, "V1"))["obf"]).toBe("superior");
    // And it leaves with the card: nothing is written onto the vampire.
    find(state, "V1").attached = [];
    find(state, "V1").disciplines["obf"] = "basic";
    expect(disciplinesOf(find(state, "V1"))["obf"]).toBe("basic");
  });
});

// ---------------------------------------------------------------------------
// §2 — Changeling Skin Mask: the card as the price
// ---------------------------------------------------------------------------

describe("Changeling Skin Mask (100325)", () => {
  /** Carol hunts (+1 inherent stealth) and carries a further +2, so Bob's
   *  B2 is short and p. 26 lets an intercept option exist at all. */
  function setup(): GameState {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Carol";
    seatOf(state, "Bob").minions.push(makeMinion("B2", "Bob", { name: "B2" }));
    equip(state, "B2", "mask", "Changeling Skin Mask");
    find(state, "N").attached.push({
      card: { id: "cloak", name: "cloak" },
      locked: false,
      usedThisPhase: false,
      statics: { stealth: 2 },
      tags: ["cloak"],
    });
    return state;
  }

  it("burns itself for +2 intercept — and the Obfuscate goes with it", () => {
    const engine = new VtesEngine(setup(), testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    expect(walkTo(engine, "block:B2")).toBe(true);
    runTrace(engine, [["Bob", "block:B2"]]);
    expect(walkTo(engine, "ability:Changeling Skin Mask:mask:burnintercept")).toBe(true);
    const af = engine.state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action frame");
    const was = currentIntercept(engine.state, af.actionId, "B2");
    runTrace(engine, [["Bob", "ability:Changeling Skin Mask:mask:burnintercept"]]);
    expect(currentIntercept(engine.state, af.actionId, "B2")).toBe(was + 2);
    expect(find(engine.state, "B2").attached).toEqual([]);
    expect(disciplinesOf(find(engine.state, "B2"))["obf"]).toBeUndefined();
  });

  it("NEGATIVE SPACE: not offered when the block already succeeds", () => {
    const state = setup();
    // Drop the extra stealth: intercept 0 vs the hunt's 1 is still short,
    // so give B2 the point that closes it.
    find(state, "N").attached = [];
    find(state, "B2").attached.push({
      card: { id: "watch", name: "watchfulness" },
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 1 },
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Carol", "hunt:N"]]);
    expect(walkTo(engine, "block:B2")).toBe(true);
    runTrace(engine, [["Bob", "block:B2"]]);
    expect(walkTo(engine, "ability:Changeling Skin Mask", 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 — Veneficorum Artum Sanguis: a rush the whole table may take
// ---------------------------------------------------------------------------

describe("Veneficorum Artum Sanguis (102102)", () => {
  function setup(clan: string | null): GameState {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.seat = "Bob";
    find(state, "W").clan = clan;
    // The bearer is Alice's — "any Tremere" is not "your Tremere".
    equip(state, "V1", "vas", "Veneficorum Artum Sanguis");
    return state;
  }

  it("offers the Ⓓ rush to another Methuselah's Tremere", () => {
    const engine = new VtesEngine(setup("Tremere"), testRegistry);
    expect(walkTo(engine, "act:Veneficorum Artum Sanguis:vas:rush:W:V1", 4)).toBe(true);
  });

  it("NEGATIVE SPACE: not to a vampire of another clan", () => {
    const engine = new VtesEngine(setup("Ventrue"), testRegistry);
    expect(walkTo(engine, "act:Veneficorum Artum Sanguis", 4)).toBe(false);
  });
});
