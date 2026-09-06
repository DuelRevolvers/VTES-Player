/**
 * Dawn Operation (100501) — docs/dawn-operation-design.md.
 *
 * Two mechanics, both new: combat-wide aggravated damage (symmetric, and
 * every damage source, not just hand strikes), and the blocker being
 * offered a way to WITHDRAW an attempt already underway — which, unlike
 * the fail-block cluster, does not spend their right to attempt again
 * (p. 25: only declining further attempts is final).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game(level: "basic" | "superior"): GameState {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, {
    disciplines: { for: level },
    blood: 3,
  });
  state.seats[0]!.hand.push({ id: "dawn", name: "Dawn Operation" });
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bleed, run out the announce cycle, then have Bob block with M — the
 *  card's cancel clause needs an attempt to already be underway. */
function upToBlockAttempt(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce cycle
    ["Alice", "pass"], // state A: the acting seat holds the impulse first
    ["Bob", "block:M"],
  ]);
}

describe("Dawn Operation (100501) — combat-wide aggravated damage", () => {
  it("makes damage aggravated for BOTH vampires, not just the blocker", () => {
    const state = game("superior");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);
    runTrace(engine, [
      ["Alice", "play:Dawn Operation:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
    ]);
    // Drain any remaining damage-resolution/press windows.
    for (let i = 0; i < 12 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pass = dp.options.find((o) => o.id === "pass" || o.id === "press:end");
      if (!pass) break;
      runTrace(engine, [[dp.seat, pass.id]]);
    }

    // Aggravated damage cannot be mended, so BOTH vampires go to torpor
    // with their blood intact — the acting minion is not spared (p. 32).
    expect(find(state, "V1").inTorpor).toBe(true);
    expect(find(state, "M").inTorpor).toBe(true);
    expect(find(state, "V1").blood).toBe(3);
    expect(find(state, "M").blood).toBe(2);

    const damage = state.eventLog.filter((e) => e.type === "DamageInflicted");
    expect(damage.length).toBe(2);
    expect(damage.every((e) => e.type === "DamageInflicted" && e.aggravated)).toBe(true);
  });

  it("leaves damage normal when the card was never played", () => {
    // The same trace without the card: ordinary damage, mended with blood,
    // and nobody goes to torpor. This is what the flag is doing.
    const state = game("superior");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
    ]);
    for (let i = 0; i < 12 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pass = dp.options.find((o) => o.id === "pass" || o.id === "press:end");
      if (!pass) break;
      runTrace(engine, [[dp.seat, pass.id]]);
    }
    expect(find(state, "V1").inTorpor).toBe(false);
    expect(find(state, "M").inTorpor).toBe(false);
    expect(find(state, "V1").blood).toBe(2); // mended 1
    expect(find(state, "M").blood).toBe(1);
  });
});

describe("Dawn Operation (100501) — withdrawing the block", () => {
  it("offers the blocking seat a cancel at inferior, and taking it stops the combat", () => {
    const state = game("basic");
    const poolBefore = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);
    runTrace(engine, [
      ["Alice", "play:Dawn Operation:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    // The offer belongs to the blocking seat alone.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id === "cancelblock:M")).toBe(false);
    runTrace(engine, [["Alice", "pass"]]);

    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    expect(bob.options.some((o) => o.id === "cancelblock:M")).toBe(true);

    runTrace(engine, [
      ["Bob", "cancelblock:M"],
      ["Carol", "pass"],
    ]);

    // Withdrawn, so no combat, and the bleed goes through.
    expect(
      state.eventLog.some((e) => e.type === "BlockAttemptCancelled"),
    ).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(false);
    // The blocker is NOT locked — locking follows a successful block.
    expect(find(state, "M").locked).toBe(false);

    // Drain to the end of the action.
    for (let i = 0; i < 20 && engine.decision(); i++) {
      const d = engine.decision()!;
      const pass = d.options.find((o) => o.id === "pass");
      if (!pass) break;
      runTrace(engine, [[d.seat, pass.id]]);
    }
    expect(state.seats[1]!.pool).toBe(poolBefore - 1);
  });

  it("does not spend the blocker's right to attempt again", () => {
    // The difference from the fail-block cluster: a withdrawal is not a
    // failure, so M is not added to `cannotBlock` and may try once more.
    const state = game("basic");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);
    runTrace(engine, [
      ["Alice", "play:Dawn Operation:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "cancelblock:M"],
      ["Carol", "pass"],
    ]);

    // Back in state A, and Bob is offered the same blocker again.
    const dp = engine.decision()!;
    const bobTurn = dp.seat === "Bob" ? dp : (runTrace(engine, [[dp.seat, "pass"]]), engine.decision()!);
    expect(bobTurn.options.some((o) => o.id === "block:M")).toBe(true);
  });

  it("offers no cancel at superior — that is what the mode buys", () => {
    const state = game("superior");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);
    runTrace(engine, [
      ["Alice", "play:Dawn Operation:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("cancelblock"))).toBe(false);
  });

  it("offers no cancel to an ALLY blocker — the card says 'a vampire'", () => {
    const state = game("basic");
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 3));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:A"],
      ["Alice", "play:Dawn Operation:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("cancelblock"))).toBe(false);
  });
});
