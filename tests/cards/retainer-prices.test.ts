/**
 * Retainers bought with a price (docs/retainer-prices-design.md).
 *
 * Corpse Minion (100428), Malajit Chandramouli (101148), Omael Kuman
 * (101320).
 *
 * Three retainers whose whole text is a price and a window: blood for
 * intercept while blocking, the retainer's own lock for stealth while
 * acting, and blood for the range before it is determined.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** A card in play, carrying the STATICS ITS SPEC COMPILED. Building the
 *  entry by hand with an empty `statics` is how a card's printed clause
 *  quietly does not exist in a test — Malajit's burn-when-blocked is a
 *  static, and the first draft of this file asserted against a copy of
 *  him that had never had it. */
function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  const h = testRegistry[name];
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
    ...over,
  };
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function find(state: GameState, id: string) {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function actionId(state: GameState): string {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af.actionId;
}

/**
 * Alice's V1 bleeds; Bob's W declares a block and the attempt is still
 * OPEN — the window all three action-time prices live in. `on` says which
 * minion carries the retainer.
 */
function blockAttempt(
  retainer: PermanentInPlay,
  on: "V1" | "W",
  blockerIntercept = 0,
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  find(state, "V1").blood = 5;
  find(state, "W").blood = 5;
  find(state, on).attached.push(retainer);
  if (blockerIntercept > 0) {
    find(state, "W").attached.push(
      entry("eyes", "Eyes", { statics: { intercept: blockerIntercept } }),
    );
  }
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:W"],
  ]);
  return { state, engine };
}

/** Pass until the named option is on the table for whoever holds it. */
function walkTo(engine: VtesEngine, id: string, limit = 12): boolean {
  for (let i = 0; i < limit; i++) {
    if (optionIds(engine).includes(id)) return true;
    const dp = engine.decision();
    if (!dp) return false;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return optionIds(engine).includes(id);
}

/** Answer everything cheaply until the action frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 40): void {
  for (let i = 0; i < limit && state.frames.some((f) => f.kind === "action"); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Corpse Minion (100428)", () => {
  it("buys intercept a point at a time, and can be used again", () => {
    const { state, engine } = blockAttempt(entry("cm", "Corpse Minion", { life: 1 }), "W");
    const id = "ability:Corpse Minion:cm:bloodintercept";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Bob", id]]);
    expect(find(state, "W").blood).toBe(4);
    // "May be used any number of times during a single action"
    // [TOM 19960109] — no latch, so it is there again next time Bob is
    // asked, with the second point still affordable.
    expect(walkTo(engine, id)).toBe(true);
  });

  it("NEGATIVE SPACE: nothing to buy when this minion is not the blocker", () => {
    const { state, engine } = blockAttempt(entry("cm", "Corpse Minion", { life: 1 }), "V1");
    for (let i = 0; i < 6 && state.frames.some((f) => f.kind === "blockAttempt"); i++) {
      expect(optionIds(engine).some((x) => x.startsWith("ability:Corpse Minion"))).toBe(false);
      const dp = engine.decision()!;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
  });
});

describe("Malajit Chandramouli (101148)", () => {
  it("locks for stealth, and is burned when the action is blocked anyway", () => {
    // W is given 2 intercept, so +1 stealth is worth playing and the
    // block still succeeds — which is the only way the burn clause can
    // be reached at all. With a bare blocker the stealth WINS, Malajit
    // survives, and the test would pass by never testing anything.
    const { state, engine } = blockAttempt(
      entry("mj", "Malajit Chandramouli", { life: 1 }),
      "V1",
      2,
    );
    const id = "ability:Malajit Chandramouli:mj:stealth";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Alice", id]]);
    expect(currentStealth(state, actionId(state))).toBe(1);
    // He is locked, which is both the price and the marker that he was
    // spent on this action.
    expect(find(state, "V1").attached.find((p) => p.card.id === "mj")?.locked).toBe(true);
    drain(engine, state);
    // The block still succeeded, so "if that action is blocked, burn
    // Malajit" fires.
    expect(find(state, "V1").attached.some((p) => p.card.id === "mj")).toBe(false);
  });
});

describe("Omael Kuman (101320)", () => {
  it("buys the range before it is determined", () => {
    const { state, engine } = blockAttempt(entry("ok", "Omael Kuman", { life: 1 }), "W");
    // Let the block resolve into combat.
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const cf = combat(state)!;
    const other = cf.range === "long" ? "close" : "long";
    const id = `ability:Omael Kuman:ok:range:${other}`;
    let guard = 0;
    while (!optionIds(engine).includes(id) && guard++ < 10) {
      const dp = engine.decision()!;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Bob", id]]);
    expect(combat(state)!.range).toBe(other);
    expect(find(state, "W").blood).toBe(4);
  });
});
