/**
 * Avoiding the block (docs/avoiding-the-block-design.md).
 *
 * Uncontrolled Impulse (102059), Walk through Arcadia (102140),
 * Horrific Countenance (100936).
 *
 * Three action modifiers that buy the same thing — not being blocked — at three
 * prices. First bucket change in nine waves, so what is under test is the ACTION
 * frame rather than the combat frame, and the two windows it matters which is
 * which: a modifier lives in `action.effects`, and a STEALTH modifier is only
 * offered while a block attempt is underway (p. 26).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice with `cards` in hand and a second minion V2 to spend a turn's action
 *  on. Instance ids `ab*`. */
function ready(
  cards: string[],
  disciplines: Record<string, "basic" | "superior"> = {},
  seed?: number,
): { state: GameState; engine: VtesEngine; v1: MinionState; v2: MinionState; m: MinionState } {
  const state = threeSeatGame();
  if (seed !== undefined) state.rngState = seed;
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 5, capacity: 5, disciplines, strength: 1 });
  // `threeSeatGame` gives Alice ONE minion, and two of these tests need a
  // second action in the turn.
  const v2 = makeMinion("V2", "Alice", { blood: 3, capacity: 3, strength: 1 });
  state.seats[0]!.minions.push(v2);
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: m.capacity, strength: 1 });
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `ab${i}`, name: n }));
  return { state, engine: new VtesEngine(state, testRegistry), v1, v2, m };
}

/** The options on the table for whoever is asked right now. */
function now(engine: VtesEngine): { seat: string; window: string; ids: string[] } {
  const dp = engine.decision();
  if (!dp) throw new Error("no decision");
  return { seat: dp.seat, window: dp.window, ids: dp.options.map((o) => o.id) };
}

/** Announce `who`'s bleed and walk to the acting seat's MODIFIER window. A
 *  modifier is offered in `action.effects`, which is after the announce cycle —
 *  not in `action.announce`, where only blocks and reactions live. */
function toEffects(engine: VtesEngine, who = "V1"): void {
  runTrace(engine, [
    ["Alice", `bleed:${who}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

/** …and on into a live block attempt, which is the only place a STEALTH
 *  modifier is offered (p. 26: stealth "only when needed"). */
function toBlockAttempt(engine: VtesEngine): void {
  toEffects(engine);
  runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);
}

/**
 * Resolve an action the plain way, so the turn has one behind it. A WALKER, not
 * a fixed trace: the number of passes between announcement and resolution is
 * not a constant, and a trace one step short leaves the engine mid-action with
 * no sign that anything went wrong.
 */
function resolveAnAction(engine: VtesEngine, who: string, kind = "bleed"): void {
  runTrace(engine, [["Alice", `${kind}:${who}`]]);
  for (let i = 0; i < 24; i++) {
    if (!engine.decision()) return;
    const dp = engine.decision()!;
    if (dp.window === "turn.minion") return; // the action is over
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

function action(state: GameState): {
  blockRestrictions: { noAllies: boolean; noVampires: boolean; cannotBlock: string[] };
} | null {
  const af = state.frames.find((f) => f.kind === "action");
  return af?.kind === "action" ? af : null;
}

/** Walk on and report whether Bob is ever offered a block. */
function bobCanBlock(engine: VtesEngine, limit = 10): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith("block:"))) return true;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return false;
    engine.choose(pick.id);
  }
  return false;
}

/** Let a played modifier resolve through its as-played window. */
function settle(engine: VtesEngine, steps = 6): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

// ---------------------------------------------------------------------------

describe("Uncontrolled Impulse (102059) — the price is on the TURN", () => {
  it("is playable on the first action of the turn", () => {
    const a = ready(["Uncontrolled Impulse"]);
    toBlockAttempt(a.engine);
    const at = now(a.engine);
    expect(
      at.ids.some((x) => x.startsWith("play:Uncontrolled Impulse")),
      `window ${at.window}: ${at.ids.join(",")}`,
    ).toBe(true);
  });

  it("NEGATIVE SPACE: not playable once another action has been taken", () => {
    const a = ready(["Uncontrolled Impulse"]);
    resolveAnAction(a.engine, "V2");
    toBlockAttempt(a.engine);
    const at = now(a.engine);
    // The window is open and Alice is being asked, so the negative is real.
    expect(at.ids).toContain("pass");
    expect(at.ids.some((x) => x.startsWith("play:Uncontrolled Impulse"))).toBe(false);
  });

  it("a MANDATORY hunt does not count against it", () => {
    // "Non-mandatory" — a vampire with no blood MUST hunt (p. 21), so that hunt
    // is not a choice and does not spend the card's window.
    const a = ready(["Uncontrolled Impulse"]);
    a.v2.blood = 0;
    resolveAnAction(a.engine, "V2", "hunt");
    toBlockAttempt(a.engine);
    const at = now(a.engine);
    expect(
      at.ids.some((x) => x.startsWith("play:Uncontrolled Impulse")),
      `window ${at.window}: ${at.ids.join(",")}`,
    ).toBe(true);
  });
});

describe("Walk through Arcadia (102140) — a coin flip through the seeded RNG", () => {
  /** Play the card on a given seed and report which way the coin fell. */
  function flip(seed: number): { unblockable: boolean; damage: number } {
    const a = ready(["Walk through Arcadia"], {}, seed);
    toEffects(a.engine);
    const before = a.v1.blood;
    const at = now(a.engine);
    const id = at.ids.find((x) => x.startsWith("play:Walk through Arcadia"));
    if (!id) throw new Error(`not offered in ${at.window}: ${at.ids.join(",")}`);
    a.engine.choose(id);
    settle(a.engine);
    const af = action(a.state);
    return {
      unblockable:
        (af?.blockRestrictions.noVampires ?? false) && (af?.blockRestrictions.noAllies ?? false),
      // 1 blood is the card's cost; anything past it is the tails damage.
      damage: before - a.v1.blood - 1,
    };
  }

  it("falls BOTH ways across seeds, and each way does its own thing", () => {
    // A coin that always landed the same way would pass any single-seed test, so
    // the assertion is that both outcomes occur AND that each is coherent.
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const results = seeds.map((s) => flip(s));
    expect(results.filter((r) => r.unblockable).length, "no seed came up heads").toBeGreaterThan(0);
    expect(results.filter((r) => !r.unblockable).length, "no seed came up tails").toBeGreaterThan(0);
    for (const r of results) expect(r.damage).toBe(r.unblockable ? 0 : 1);
  });

  it("is deterministic: the same seed flips the same way", () => {
    // The whole reason it goes through the engine's RNG (principle 2).
    for (const s of [4, 7]) expect(flip(s).unblockable).toBe(flip(s).unblockable);
  });

  it("heads actually stops Bob blocking", () => {
    // The state flag is not the point; the option list is.
    const headsSeed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((s) => flip(s).unblockable);
    expect(headsSeed, "no heads seed found").toBeDefined();
    const a = ready(["Walk through Arcadia"], {}, headsSeed);
    toEffects(a.engine);
    a.engine.choose(now(a.engine).ids.find((x) => x.startsWith("play:Walk through Arcadia"))!);
    settle(a.engine);
    expect(bobCanBlock(a.engine)).toBe(false);
  });

  it("CONTROL: with no card played, Bob CAN block", () => {
    const a = ready([]);
    toEffects(a.engine);
    expect(bobCanBlock(a.engine)).toBe(true);
  });
});

describe("Horrific Countenance (100936) — undoing a block that happened", () => {
  /** Bleed, get blocked, and stop in the combat's first window. */
  function blocked(cards: string[]): ReturnType<typeof ready> {
    const a = ready(cards, { pro: "superior" });
    runTrace(a.engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    return a;
  }

  it("unlocks the blocker, cancels the combat and frees the action", () => {
    const a = blocked(["Horrific Countenance"]);
    expect(a.m.locked).toBe(true);
    const at = now(a.engine);
    const id = at.ids.find((x) => x.startsWith("play:Horrific Countenance"));
    expect(id, `not offered in ${at.window}: ${at.ids.join(",")}`).toBeDefined();
    const before = a.v1.blood;
    a.engine.choose(id!);
    settle(a.engine);
    // Three effects, three assertions — plus the 4 blood.
    expect(a.state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(a.m.locked).toBe(false);
    const af = action(a.state);
    expect(af?.blockRestrictions.noVampires).toBe(true);
    expect(af?.blockRestrictions.noAllies).toBe(true);
    expect(before - a.v1.blood).toBe(4);
  });

  it("so a second minion cannot block the freed action", () => {
    // This is what "now unblockable" is FOR: without it, another of Bob's
    // minions would simply block the action the card just freed.
    const a = blocked(["Horrific Countenance"]);
    a.engine.choose(now(a.engine).ids.find((x) => x.startsWith("play:Horrific Countenance"))!);
    settle(a.engine);
    expect(bobCanBlock(a.engine)).toBe(false);
  });
});
