/**
 * Wave 101 — intercept from masters and locations
 * (docs/master-intercept-design.md).
 *
 * Special Report (101841), Warning Sirens (102147), Club Zombie (100367),
 * Guard Duty (100864) — and what they found: a FORCED block attempt read
 * only the toll, so any "unlock and attempt to block" could push a minion
 * that "cannot block" into an attempt; the per-minion bars lived inside
 * `blockOptions` alone. And the burn-for-intercept grant knew one currency
 * and no limit.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ids = (engine: VtesEngine): string[] => engine.decision()!.options.map((o) => o.id);
const action = (state: GameState) => {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af;
};
const inCombat = (state: GameState): boolean => state.frames.some((f) => f.kind === "combat");
const entry = (id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay => ({
  card: { id, name },
  locked: false,
  usedThisPhase: false,
  statics: {},
  tags: [],
  ...extra,
});

/** Alice hunts with V1 (+1 stealth, undirected: Bob is prey, Carol predator),
 *  up to Bob's first state-A window. */
const HUNT_TO_BOB: Array<[string, string]> = [
  ["Alice", "hunt:V1"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
  ["Alice", "pass"],
];

describe("Special Report (101841)", () => {
  it("unlocks a locked vampire into a block attempt; 1 pool buys +1 intercept, once", () => {
    const state = threeSeatGame();
    state.seats[1]!.minions[0]!.locked = true; // W
    state.seats[1]!.hand.push({ id: "sr", name: "Special Report" });
    state.seats[0]!.hand.push({ id: "sa", name: "Special Report" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "hunt:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    // Never on your own turn (p. 9).
    expect(ids(engine)).toEqual(["pass"]);
    runTrace(engine, [["Alice", "pass"]]);
    // A locked W and an unlocked M are both choices; W could not block at all.
    expect(ids(engine)).toEqual([
      "pass",
      "play:Special Report:-:W:sr",
      "play:Special Report:-:M:sr",
      "block:M",
    ]);
    runTrace(engine, [
      ["Bob", "play:Special Report:-:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    // W is attempting, 0 vs 1: the pool is on offer because it is needed.
    expect(ids(engine)).toEqual(["pass", "burn:intercept:W:pool"]);
    expect(state.seats[1]!.outOfTurnMasterUsed).toBe(true);
    runTrace(engine, [["Bob", "burn:intercept:W:pool"]]);
    expect(state.seats[1]!.pool).toBe(9);
    // "Once this action": spent.
    expect(action(state).interceptBurnGrants).toEqual([]);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(inCombat(state)).toBe(true);
  });

  it("names the vampire already attempting to block; then only the pool is new", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "sr", name: "Special Report" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...HUNT_TO_BOB, ["Bob", "block:W"], ["Alice", "pass"]]);
    // [ANK 20181122-2] — the blocker, and nobody else.
    expect(ids(engine)).toEqual(["pass", "play:Special Report:-:W:sr"]);
    runTrace(engine, [
      ["Bob", "play:Special Report:-:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    expect(ids(engine)).toEqual(["pass", "burn:intercept:W:pool"]);
  });

  it("does not reach a vampire who cannot block, nor a seat that may not block", () => {
    const state = threeSeatGame();
    // "This minion cannot block" (Pentex™ Subversion) [LSJ 20010714-2].
    state.seats[1]!.minions[0]!.attached.push(entry("px", "Pentex™ Subversion", { statics: { cannotBlock: true } }));
    state.seats[1]!.hand.push({ id: "sr", name: "Special Report" });
    state.seats[2]!.hand.push({ id: "sc", name: "Special Report" });
    const engine = new VtesEngine(state, testRegistry);

    // A bleed on Bob: Carol may not block it [ANK 20180623].
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(ids(engine)).toEqual(["pass", "play:Special Report:-:M:sr", "block:M"]);
    runTrace(engine, [["Bob", "pass"]]);
    expect(engine.decision()!.seat).toBe("Carol");
    expect(ids(engine)).toEqual(["pass"]);
  });
});

describe("the forced block honours every bar a declared one does", () => {
  it("Eluding the Arms of Morpheus unlocks a vampire who cannot block, but starts no attempt", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions[0]!;
    w.locked = true;
    w.attached.push(entry("px", "Pentex™ Subversion", { statics: { cannotBlock: true } }));
    state.seats[1]!.hand.push({ id: "el", name: "Eluding the Arms of Morpheus" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, HUNT_TO_BOB);
    const play = ids(engine).find((id) => id.startsWith("play:Eluding the Arms of Morpheus:basic:W"));
    expect(play).toBeDefined();
    runTrace(engine, [["Bob", play!], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(w.locked).toBe(false);
    expect(state.frames.some((f) => f.kind === "blockAttempt")).toBe(false);
    expect(action(state).pendingAutoBlock).toBeUndefined();
  });
});

describe("Warning Sirens (102147)", () => {
  it("gives the targeted minion +1 intercept in its own block attempt", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ap", name: "Abuse of Power" });
    state.seats[1]!.hand.push({ id: "ws", name: "Warning Sirens" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Abuse of Power:basic:V1:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    // State A: intercept is not yet needed (p. 26).
    expect(ids(engine)).toEqual(["pass", "block:W", "block:M"]);
    runTrace(engine, [["Bob", "block:W"], ["Alice", "pass"]]);
    expect(ids(engine)).toEqual(["pass", "play:Warning Sirens:-:intercept:W:ws"]);
    runTrace(engine, [
      ["Bob", "play:Warning Sirens:-:intercept:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(inCombat(state)).toBe(true);
  });

  it("is not for a blocker who is not the target", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ap", name: "Abuse of Power" });
    state.seats[1]!.hand.push({ id: "ws", name: "Warning Sirens" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Abuse of Power:basic:V1:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"],
    ]);
    expect(ids(engine)).toEqual(["pass"]);
  });

  it("gives a combatant an optional strike: dodge this round", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ap", name: "Abuse of Power" });
    state.seats[0]!.hand.push({ id: "wa", name: "Warning Sirens" });
    state.seats[1]!.hand.push({ id: "ws", name: "Warning Sirens" });
    state.seats[2]!.hand.push({ id: "wc", name: "Warning Sirens" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Abuse of Power:basic:V1:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    // Combat on Alice's turn: Alice may play no out-of-turn master.
    expect(engine.decision()!.window).toBe("combat.beforeRange");
    expect(ids(engine)).toEqual(["pass"]);
    runTrace(engine, [["Alice", "pass"]]);
    expect(ids(engine)).toEqual([
      "pass",
      "play:Warning Sirens:-:dodge:V1:ws",
      "play:Warning Sirens:-:dodge:W:ws",
    ]);
    runTrace(engine, [
      ["Bob", "play:Warning Sirens:-:dodge:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    // A second copy on W this round adds nothing; V1 is still a choice.
    expect(ids(engine)).toEqual(["pass", "play:Warning Sirens:-:dodge:V1:wc"]);
    runTrace(engine, [
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
    ]);
    expect(ids(engine)).toEqual(["strike:hand", "strike:dodge"]);
  });
});

describe("Club Zombie (100367)", () => {
  it("locks to give a blocking vampire +1 intercept — not an ally", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("cz", "Club Zombie", { tags: ["location"] }));
    state.seats[1]!.minions.push(makeAlly("A1", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...HUNT_TO_BOB, ["Bob", "block:A1"], ["Alice", "pass"]]);
    expect(ids(engine)).toEqual(["pass"]);
    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    runTrace(engine, [["Bob", "block:W"], ["Alice", "pass"]]);
    expect(ids(engine)).toEqual(["pass", "ability:Club Zombie:cz:intercept"]);
    runTrace(engine, [["Bob", "ability:Club Zombie:cz:intercept"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.seats[1]!.permanents[0]!.locked).toBe(true);
    expect(inCombat(state)).toBe(true);
  });

  const bobsUnlock = (locked: boolean): { state: GameState; engine: VtesEngine } => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("cz", "Club Zombie", { tags: ["location"], locked }));
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn");
    state.frames = [
      { ...tf, seat: "Bob", phase: "unlock", unlockDone: false, edgeDone: false, unlockAbilitiesDone: false },
    ];
    return { state, engine: new VtesEngine(state, testRegistry) };
  };

  it("unlocked at the start of your turn: a ready vampire you control gains 1 blood", () => {
    const { state, engine } = bobsUnlock(false);
    expect(ids(engine)).toEqual([
      "choice:Club Zombie:cz:gainBlood:W",
      "choice:Club Zombie:cz:gainBlood:M",
    ]);
    runTrace(engine, [["Bob", "choice:Club Zombie:cz:gainBlood:M"]]);
    expect(state.seats[1]!.minions[1]!.blood).toBe(3);
  });

  it("locked at the start of your turn: it unlocks, and nobody gains", () => {
    const { state, engine } = bobsUnlock(true);
    expect(engine.decision()!.window).toBe("turn.unlock");
    expect(ids(engine).some((id) => id.startsWith("choice:"))).toBe(false);
    expect(state.seats[1]!.permanents[0]!.locked).toBe(false);
    expect(state.seats[1]!.minions[1]!.blood).toBe(2);
  });
});

describe("Guard Duty (100864)", () => {
  it("is +2 stealth, attaches to the acting minion, and chooses any location in play", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "gd", name: "Guard Duty" });
    state.seats[2]!.permanents.push(entry("rk", "The Rack", { tags: ["location"] }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Guard Duty:basic:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    expect(currentStealth(state, action(state).actionId)).toBe(2);
    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    // Another Methuselah's location is a legal choice.
    expect(ids(engine)).toEqual(["choice:Guard Duty:gd:chooseLocation:rk"]);
    runTrace(engine, [["Alice", "choice:Guard Duty:gd:chooseLocation:rk"]]);
    const gd = state.seats[0]!.minions[0]!.attached.find((p) => p.card.name === "Guard Duty");
    expect(gd?.chosenCard).toBe("rk");
  });

  const guarded = (): { state: GameState; engine: VtesEngine } => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(entry("rk", "The Rack", { tags: ["location"] }));
    const m = state.seats[1]!.minions[1]!;
    m.locked = true;
    m.attached.push(entry("gd", "Guard Duty", { tags: ["Guard Duty"], chosenCard: "rk" }));
    return { state, engine: new VtesEngine(state, testRegistry) };
  };
  const STEAL_TO_BOB: Array<[string, string]> = [
    ["Alice", "act:The Rack:rk:steal:V1"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "pass"],
    ["Alice", "pass"],
  ];

  it("burns 1 blood to unlock and block an action aimed at the guarded location", () => {
    const { state, engine } = guarded();
    runTrace(engine, STEAL_TO_BOB);
    expect(ids(engine)).toEqual([
      "pass",
      "ability:Guard Duty:gd:blood",
      "ability:Guard Duty:gd:burn",
      "block:W",
    ]);
    runTrace(engine, [["Bob", "ability:Guard Duty:gd:blood"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(state.seats[1]!.minions[1]!.blood).toBe(1);
    expect(inCombat(state)).toBe(true);
  });

  it("or burns itself instead", () => {
    const { state, engine } = guarded();
    runTrace(engine, [...STEAL_TO_BOB, ["Bob", "ability:Guard Duty:gd:burn"]]);
    const m = state.seats[1]!.minions[1]!;
    expect(m.blood).toBe(2);
    expect(m.attached).toEqual([]);
    expect(m.locked).toBe(false);
  });

  it("answers only for a location you control, and only when it is the target", () => {
    const stolen = guarded();
    const rack = stolen.state.seats[1]!.permanents.pop()!;
    stolen.state.seats[2]!.permanents.push({ ...rack, controller: "Carol" });
    runTrace(stolen.engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(ids(stolen.engine)).toEqual(["pass", "block:W"]);

    const bleed = guarded();
    runTrace(bleed.engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"]]);
    expect(ids(bleed.engine)).toEqual(["pass", "block:W"]);
  });
});
