/**
 * The five lock-to-grant locations (docs/lock-grant-locations-design.md).
 *
 * Each has a plain clause the existing compiler already handled and one
 * new knob, so most of what is asserted here is the NEGATIVE space: the
 * option that must not be offered when the new condition is unmet. The
 * fuzz cannot see a too-permissive option list — it plays whatever it is
 * given — so these assertions are the only guard on that class of bug.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

/**
 * Get to the point where Bob's M is attempting a block — the window every
 * intercept location is offered in.
 *
 * The action is a HUNT, which carries +1 inherent stealth (p. 21), and M
 * has 0 intercept. That matters: p. 26 only offers intercept "when
 * needed", so against a 0-stealth bleed no intercept location is offered
 * at all and a test would pass for the wrong reason.
 */
const toBlockAttempt: Array<[string, string]> = [
  ["Alice", "hunt:V1"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
  ["Alice", "pass"],
  ["Bob", "block:M"],
  ["Alice", "pass"], // acting seat is asked first inside the attempt
];

describe("Kumpania (101068) — capacity-filtered intercept", () => {
  it("offers the lock for a Ravnos at capacity 5 or more", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const m = bob.minions.find((x) => x.id === "M")!;
    m.clan = "Ravnos";
    m.capacity = 5;
    bob.permanents.push(loc("k0", "Kumpania"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toBlockAttempt);

    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Kumpania"))).toBe(true);
  });

  it("does not offer it for a Ravnos below capacity 5", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const m = bob.minions.find((x) => x.id === "M")!;
    m.clan = "Ravnos";
    m.capacity = 4;
    bob.permanents.push(loc("k0", "Kumpania"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toBlockAttempt);

    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Kumpania"))).toBe(false);
  });

  it("counts DERIVED capacity, so a granted +1 lifts a 4 over the bar", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const m = bob.minions.find((x) => x.id === "M")!;
    m.clan = "Ravnos";
    m.capacity = 4;
    // A card in play granting +1 capacity really does make it a 5.
    m.attached.push({
      card: { id: "boost", name: "Potence" },
      locked: false,
      usedThisPhase: false,
      statics: { capacityBonus: 1 },
      tags: [],
    });
    bob.permanents.push(loc("k0", "Kumpania"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toBlockAttempt);

    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Kumpania"))).toBe(true);
  });

  it("does not offer it for a capacity-5 vampire of another clan", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "M")!.clan = "Ventrue";
    bob.permanents.push(loc("k0", "Kumpania"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toBlockAttempt);

    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Kumpania"))).toBe(false);
  });
});

describe("Channel 10 (100327) — not during the first action", () => {
  it("is unusable during the first action in a minion phase", () => {
    const state = threeSeatGame();
    state.seats[1]!.permanents.push(loc("c10", "Channel 10"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toBlockAttempt);

    const tf = state.frames.find((f) => f.kind === "turn");
    expect(tf && tf.kind === "turn" ? tf.minionActionsThisPhase : 0).toBe(1);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Channel 10"))).toBe(
      false,
    );
  });

  it("is usable during the second action", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    state.seats[1]!.permanents.push(loc("c10", "Channel 10"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      // First action: a hunt by V1, unblocked, all the way through.
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → C
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
      // Second action: V2 hunts (stealth 1, so intercept is needed) and
      // now the location is live.
      ["Alice", "hunt:V2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"],
    ]);

    const tf = state.frames.find((f) => f.kind === "turn");
    expect(tf && tf.kind === "turn" ? tf.minionActionsThisPhase : 0).toBe(2);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Channel 10"))).toBe(
      true,
    );
  });

  it("gives +2 intercept, catching a stealthed action", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    state.seats[1]!.permanents.push(loc("c10", "Channel 10"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      // Second action: a hunt carries +1 inherent stealth (p. 21).
      ["Alice", "hunt:V2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"], // 0 intercept vs 1 stealth → would fail
      ["Alice", "pass"],
      ["Bob", "ability:Channel 10"], // +2 intercept; rewinds the impulse
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(state.seats[1]!.permanents[0]!.locked).toBe(true);
  });
});

describe("KRCG News Radio (101067) — helping someone else block", () => {
  it("gives your own blocker +1 intercept for free", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.permanents.push(loc("krcg", "KRCG News Radio"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"], // +1 stealth, so intercept is needed
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"],
    ]);

    const opts = engine.decision()!.options.filter((o) => o.id.startsWith("ability:KRCG"));
    expect(opts).toHaveLength(1);
    // The free clause, not the pool-burning one.
    expect(opts[0]!.id.endsWith(":other")).toBe(false);
  });

  it("burns 1 pool to give ANOTHER Methuselah's blocker +1 intercept", () => {
    const state = threeSeatGame();
    // Carol owns the station; Bob is the one blocking Alice.
    state.seats[2]!.permanents.push(loc("krcg", "KRCG News Radio"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"],
    ]);

    const opts = engine.decision()!.options.filter((o) => o.id.startsWith("ability:KRCG"));
    expect(engine.decision()!.seat).toBe("Carol");
    expect(opts).toHaveLength(1);
    expect(opts[0]!.id.endsWith(":other")).toBe(true);

    runTrace(engine, [
      ["Carol", "ability:KRCG"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(state.seats[2]!.pool).toBe(9); // the 1 pool was burned
    expect(state.seats[2]!.permanents[0]!.locked).toBe(true);
  });

  it("cannot help another Methuselah when the pool would not survive it", () => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(loc("krcg", "KRCG News Radio"));
    state.seats[2]!.pool = 1; // burning 1 would oust Carol
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"],
    ]);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:KRCG"))).toBe(false);
  });
});

describe("The Anarch Free Press (100052)", () => {
  it("cannot be played without a ready Anarch", () => {
    const state = threeSeatGame();
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    state.seats[0]!.hand.push({ id: "afp", name: "The Anarch Free Press" });
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:The Anarch Free Press")),
    ).toBe(false);

    state.seats[0]!.minions[0]!.sect = "anarch";
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:The Anarch Free Press")),
    ).toBe(true);
  });

  it("locks after an Anarch hunts to add 1 blood to that Anarch", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.sect = "anarch";
    alice.minions[0]!.blood = 2;
    alice.permanents.push(loc("afp", "The Anarch Free Press"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → C
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
      // The hunt gave 1 blood; the choice is asked once the action popped.
      ["Alice", "choice:The Anarch Free Press"],
    ]);

    expect(alice.minions[0]!.blood).toBe(4); // 2 + 1 hunt + 1 press clause
    expect(alice.permanents[0]!.locked).toBe(true);
  });

  it("offers nothing when the hunter is not an Anarch", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.sect = "camarilla";
    alice.permanents.push(loc("afp", "The Anarch Free Press"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("choice:The Anarch Free Press")),
    ).toBe(false);
    expect(alice.permanents[0]!.locked).toBe(false);
  });
});

describe("The Black Throne (100172)", () => {
  it("locks during polling for +2 votes, in ANOTHER Methuselah's referendum", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    // Bob owns the location; Alice is the one calling the referendum.
    state.seats[1]!.permanents.push(loc("bt", "The Black Throne"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
      ["Alice", "pass"], // Alice polls first, then Bob
      ["Bob", "ability:The Black Throne"], // lock for +2 votes
      ["Bob", "vote:grant:against"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ votesAgainst: 2 });
    expect(state.seats[1]!.permanents[0]!.locked).toBe(true);
  });

  it("pays out when a contracted minion leaves the ready region", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const bob = state.seats[1]!;
    // Alice controls a Banu Haqim and The Black Throne; Priority Contract
    // sits on Bob's M naming that vampire.
    alice.minions[0]!.clan = "Banu Haqim";
    alice.permanents.push(loc("bt", "The Black Throne"));
    const m = bob.minions.find((x) => x.id === "M")!;
    m.attached.push({
      card: { id: "pc", name: "Priority Contract" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Priority Contract", "contract"],
      controller: "Alice",
      chosen: "V1",
    });
    const engine = new VtesEngine(state, testRegistry);
    const poolBefore = alice.pool;

    // Burn M outright — onLeaveReady fires before the departure.
    engine.burnMinion("M");

    // BOTH cards answer this departure: Priority Contract's own "burn it
    // to gain 3 pool" clause and the Black Throne's payout. Two choice
    // frames, both asked of Alice, innermost first.
    expect(state.frames.filter((f) => f.kind === "choice")).toHaveLength(2);
    runTrace(engine, [
      ["Alice", "pass"], // decline Priority Contract's own cash-out
      ["Alice", "choice:The Black Throne"],
    ]);

    expect(alice.pool).toBe(poolBefore + 1);
    expect(alice.permanents[0]!.locked).toBe(true);
  });

  it("pays out nothing when the contract names another Methuselah's vampire", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const bob = state.seats[1]!;
    alice.permanents.push(loc("bt", "The Black Throne"));
    // The chosen vampire is Banu Haqim but CAROL's, not Alice's.
    const carolVamp = state.seats[2]!.minions[0]!;
    carolVamp.clan = "Banu Haqim";
    const m = bob.minions.find((x) => x.id === "M")!;
    m.attached.push({
      card: { id: "pc", name: "Priority Contract" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Priority Contract", "contract"],
      controller: "Alice",
      chosen: carolVamp.id,
    });
    const engine = new VtesEngine(state, testRegistry);

    engine.burnMinion("M");
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("choice:The Black Throne")),
    ).toBe(false);
    expect(alice.permanents[0]!.locked).toBe(false);
  });
});
