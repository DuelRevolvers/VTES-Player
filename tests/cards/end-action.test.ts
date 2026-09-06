/**
 * Ending an action early (docs/end-action-design.md).
 *
 * Change of Target (100323), Mirror Walk (101223), Obedience (101309),
 * Delaying Tactics (100519), Faceless Night (100687).
 *
 * The rulebook rules three of these by name (p. 47, p. 48, p. 49), so
 * those rulings get their own assertions — including the two that are
 * about what does NOT happen: the blocker is not locked, and Faceless
 * Night does not lock retroactively.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/**
 * Alice's V1 bleeds and Bob's M attempts to block; stop with the attempt
 * still open (state B), which is where this whole cluster is played.
 */
function intoBlockAttempt(
  aliceCards: Array<{ id: string; name: string }>,
  v1: Partial<MinionState> = {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 3, ...v1 });
  state.seats[0]!.hand.push(...aliceCards);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
  ]);
  return { state, engine };
}

/** Pass every seat through the impulse cycle until the action is gone. */
function settle(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (!state.frames.some((f) => f.kind === "action" || f.kind === "blockAttempt")) break;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

describe("Change of Target (100323)", () => {
  it("ends the action unsuccessfully and unlocks the acting minion", () => {
    const { state, engine } = intoBlockAttempt([{ id: "ct", name: "Change of Target" }]);
    const bobPool = state.seats[1]!.pool;
    expect(find(state, "V1").locked).toBe(true);

    runTrace(engine, [
      ["Alice", "play:Change of Target:basic:V1:ct"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    settle(engine, state);

    expect(find(state, "V1").locked).toBe(false);
    // The bleed never resolved, so Bob lost no pool.
    expect(state.seats[1]!.pool).toBe(bobPool);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("p. 47: the blocking minion is NOT locked for blocking", () => {
    const { state, engine } = intoBlockAttempt([{ id: "ct", name: "Change of Target" }]);
    expect(find(state, "M").locked).toBe(false);
    runTrace(engine, [
      ["Alice", "play:Change of Target:basic:V1:ct"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);
    // "Since the action ends before the block resolution, the blocking
    // minion is not locked for blocking."
    expect(find(state, "M").locked).toBe(false);
  });

  it("p. 47: a locked blocker under a wake effect stays locked", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    // M blocks while locked, via a wake.
    Object.assign(find(state, "M"), { locked: true, awake: true });
    state.seats[0]!.hand.push({ id: "ct", name: "Change of Target" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "play:Change of Target:basic:V1:ct"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);
    expect(find(state, "M").locked).toBe(true);
  });

  it("bars that minion from bleeding again this turn — but not from hunting", () => {
    const { state, engine } = intoBlockAttempt([{ id: "ct", name: "Change of Target" }]);
    runTrace(engine, [
      ["Alice", "play:Change of Target:basic:V1:ct"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).not.toContain("bleed:V1");
    expect(ids).toContain("hunt:V1"); // a different action
  });

  it("the bar is lifted next turn", () => {
    const { state, engine } = intoBlockAttempt([{ id: "ct", name: "Change of Target" }]);
    runTrace(engine, [
      ["Alice", "play:Change of Target:basic:V1:ct"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);
    expect(find(state, "V1").cannotRepeat).toContain("bleed");

    // A new turn clears it, beside every other per-turn record.
    engine.emit({ type: "TurnBegan", seat: "Bob", turnNumber: 2 });
    expect(find(state, "V1").cannotRepeat).toEqual([]);
  });

  it("p. 47: a 0-blood vampire barred from hunting is STUCK — no action at all", () => {
    // The ruling is emergent, not implemented: a vampire with no blood
    // must hunt (p. 21), mandatory actions come first (p. 19), and the
    // bar removes the only action it may take.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 0, cannotRepeat: ["hunt"], locked: false });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("V1"))).toBe(false);
    expect(find(state, "V1").locked).toBe(false); // "they remain unlocked"
    // …and the phase can still be ended, so the game is not deadlocked.
    expect(ids).toContain("end");
  });
});

describe("Mirror Walk (101223)", () => {
  it("superior LOCKS the blocking minion — the one difference from Change of Target (p. 49)", () => {
    const { state, engine } = intoBlockAttempt([{ id: "mw", name: "Mirror Walk" }], {
      disciplines: { tha: "superior" },
    });
    runTrace(engine, [
      ["Alice", "play:Mirror Walk:superior:V1:mw"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);

    expect(find(state, "M").locked).toBe(true);
    // …and it does NOT unlock the actor, unlike Change of Target.
    expect(find(state, "V1").locked).toBe(true);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("basic is a plain +1 stealth that ends nothing", () => {
    const { state, engine } = intoBlockAttempt([{ id: "mw", name: "Mirror Walk" }], {
      disciplines: { tha: "basic" },
    });
    runTrace(engine, [
      ["Alice", "play:Mirror Walk:basic:V1:mw"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("the action ended");
    expect(af.step).not.toBe("blocked");
  });

  it("its replacement waits for the discard phase, not the unlock phase", () => {
    const { state, engine } = intoBlockAttempt([{ id: "mw", name: "Mirror Walk" }], {
      disciplines: { tha: "basic" },
    });
    state.seats[0]!.library.push({ id: "lib1", name: "Conditioning" });
    const hand = state.seats[0]!.hand.length;
    runTrace(engine, [
      ["Alice", "play:Mirror Walk:basic:V1:mw"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Down one card and not replaced yet.
    expect(state.seats[0]!.hand.length).toBe(hand - 1);
    expect(state.seats[0]!.delayedDrawsDiscard).toBe(1);
    expect(state.seats[0]!.hand.some((c) => c.id === "lib1")).toBe(false);
  });
});

describe("Obedience (101309)", () => {
  function game(level: "basic" | "superior"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    // The acting vampire must be YOUNGER than the reacting one.
    Object.assign(find(state, "V1"), { blood: 3, capacity: 3 });
    Object.assign(find(state, "M"), { capacity: 8, disciplines: { dom: level } });
    state.seats[1]!.hand.push({ id: "ob", name: "Obedience" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    return { state, engine };
  }

  it("basic unlocks the acting vampire and ends the action", () => {
    const { state, engine } = game("basic");
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Obedience:basic:M:ob"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);
    expect(find(state, "V1").locked).toBe(false);
    expect(find(state, "V1").cannotRepeat).toContain("bleed");
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("superior leaves the acting vampire LOCKED", () => {
    const { state, engine } = game("superior");
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Obedience:superior:M:ob"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    settle(engine, state);
    expect(find(state, "V1").locked).toBe(true);
    expect(find(state, "V1").cannotRepeat).toContain("bleed");
  });
});

describe("Delaying Tactics (100519)", () => {
  it("cancels the referendum, unlocks the caller, and bars the whole seat", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince", blood: 3 });
    state.seats[0]!.hand.push(
      { id: "kr", name: "Kine Resources Contested" },
      { id: "kr2", name: "Kine Resources Contested" },
    );
    Object.assign(find(state, "M"), { blood: 3 });
    state.seats[1]!.hand.push({ id: "dt", name: "Delaying Tactics" });
    const engine = new VtesEngine(state, testRegistry);

    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Kine Resources Contested"));
    expect(opt).toBeDefined();
    runTrace(engine, [
      ["Alice", opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
    // Terms, then polling — where Delaying Tactics lives.
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "referendum.polling") break;
      runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
    }
    const dp = engine.decision()!;
    expect(dp.window).toBe("referendum.polling");

    const dtOpt = dp.seat === "Bob" ? "play:Delaying Tactics:basic:M:dt" : null;
    if (!dtOpt) {
      // Pass around to Bob's impulse.
      for (let i = 0; i < 4; i++) {
        const d = engine.decision()!;
        if (d.seat === "Bob") break;
        runTrace(engine, [[d.seat, "pass"]]);
      }
    }
    runTrace(engine, [["Bob", "play:Delaying Tactics:basic:M:dt"]]);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    // The referendum is gone, the calling card is back in hand, the
    // caller is unlocked, and the SEAT cannot call it again this turn.
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
    expect(find(state, "V1").locked).toBe(false);
    expect(state.seats[0]!.cannotRepeat).toContain("Kine Resources Contested");
    expect(state.seats[0]!.hand.some((c) => c.id === "kr")).toBe(true);

    // The bar is seat-wide: even another vampire cannot play the copy.
    state.seats[0]!.minions.push(
      makeMinion("A2", "Alice", { title: "prince", blood: 3 }),
    );
    const e2 = new VtesEngine(state, testRegistry);
    expect(
      e2.decision()!.options.some((o) => o.id.startsWith("play:Kine Resources Contested")),
    ).toBe(false);
  });
});

describe("Faceless Night (100687)", () => {
  it("p. 48: locks blockers who fail AFTER it is played, at action resolution", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, disciplines: { obf: "superior" } });
    state.seats[0]!.hand.push({ id: "fn", name: "Faceless Night" });
    // Two of Bob's minions, so one can fail before and one after.
    state.seats[1]!.minions.push(makeMinion("M2", "Bob"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    // M's attempt fails on stealth — Faceless Night is played only after,
    // so M must NOT be locked (the card is not retroactive).
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");

    runTrace(engine, [
      ["Alice", "play:Faceless Night:superior:V1:fn"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(af.lockFailedBlockers).toBe(true);
    // Nothing recorded from before the card resolved.
    expect(af.failedBlockersToLock ?? []).toEqual([]);
  });

  it("is a plain +1 stealth at basic, locking nobody", () => {
    // A stealth modifier is only offered while stealth is NEEDED (p. 26),
    // so the block attempt has to be open for the card to appear at all.
    const { state, engine } = intoBlockAttempt([{ id: "fn", name: "Faceless Night" }], {
      disciplines: { obf: "basic" },
    });
    runTrace(engine, [
      ["Alice", "play:Faceless Night:basic:V1:fn"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.lockFailedBlockers).toBeUndefined();
  });
});
