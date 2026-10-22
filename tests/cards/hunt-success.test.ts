/**
 * Wave 102 — a successful hunt (docs/hunt-success-design.md).
 *
 * Masquerade Endangered (101183), XTC-Laced Blood (102198), Tainted Vitae
 * (101926), Restricted Vitae (101614) — and what they found: a hunt ACTION
 * CARD (Psychophagia) announced a cardEffect, so no rule about hunting ever
 * saw it; and "successfully hunts" was answered by reaching the hunt branch,
 * where the rulings answer it by GAINING blood [LSJ 20050720-2].
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ids = (engine: VtesEngine): string[] => engine.decision()!.options.map((o) => o.id);
const minion = (state: GameState, id: string): MinionState => {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
};
const entry = (id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay => ({
  card: { id, name },
  locked: false,
  usedThisPhase: false,
  statics: {},
  tags: [],
  ...extra,
});
const action = (state: GameState) => {
  const af = state.frames.find((f) => f.kind === "action");
  return af?.kind === "action" ? af : null;
};

/** Alice hunts with V1 (+1 stealth, undirected) up to the first state-C
 *  window, where the hunt is known to be going through: Alice is asked
 *  first. */
const HUNT_TO_C: Array<[string, string]> = [
  ["Alice", "hunt:V1"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
];

/** Alice's turn at her unlock phase, with whatever the state already holds. */
function alicesUnlock(state: GameState): VtesEngine {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn");
  state.frames = [
    { ...tf, phase: "unlock", unlockDone: false, edgeDone: false, unlockAbilitiesDone: false },
  ];
  return new VtesEngine(state, testRegistry);
}

describe("Masquerade Endangered (101183)", () => {
  it("in state C: the hunter gains no blood, and the card goes on them", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "me", name: "Masquerade Endangered" });
    state.seats[2]!.hand.push({ id: "x", name: "XTC-Laced Blood" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, HUNT_TO_C.slice(0, 5));
    // NEGATIVE: in state A the block window is still open — not yet.
    expect(ids(engine).some((i) => i.startsWith("play:Masquerade"))).toBe(false);
    runTrace(engine, HUNT_TO_C.slice(5));
    runTrace(engine, [["Alice", "pass"]]);
    expect(ids(engine)).toContain("play:Masquerade Endangered:-:V1:me");
    runTrace(engine, [
      ["Bob", "play:Masquerade Endangered:-:V1:me"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    const v1 = minion(state, "V1");
    expect(v1.blood).toBe(2);
    expect(v1.attached.map((p) => p.card.name)).toEqual(["Masquerade Endangered"]);
    expect(v1.attached[0]!.controller).toBe("Bob");
    expect(state.seats[1]!.outOfTurnMasterUsed).toBe(true);
    // No blood gained, so the HUNT failed: XTC-Laced Blood ("only usable
    // when a vampire successfully hunts") was never offered to Carol — the
    // after-resolution window did not even open.
    expect(action(state)).toBeNull();
    expect(state.seats[2]!.hand.map((c) => c.name)).toEqual(["XTC-Laced Blood"]);
  });

  it("NEGATIVE: never on your own turn, and a second copy is still playable [TOM 19950921]", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ma", name: "Masquerade Endangered" });
    state.seats[1]!.hand.push({ id: "mb", name: "Masquerade Endangered" });
    state.seats[2]!.hand.push({ id: "mc", name: "Masquerade Endangered" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, HUNT_TO_C);
    expect(ids(engine)).toEqual(["pass"]); // Alice, on her own turn
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Masquerade Endangered:-:V1:mb"],
      // As played, then back to state C.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    expect(ids(engine)).toContain("play:Masquerade Endangered:-:V1:mc");
    runTrace(engine, [
      ["Carol", "play:Masquerade Endangered:-:V1:mc"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(minion(state, "V1").attached).toHaveLength(2);
    expect(minion(state, "V1").blood).toBe(2);
  });

  it("holds the vampire through ONE unlock phase, burning there; the next unlocks normally", () => {
    const state = threeSeatGame();
    const v1 = minion(state, "V1");
    v1.locked = true;
    v1.attached.push(
      entry("me", "Masquerade Endangered", { statics: { bearerDoesNotUnlock: true }, controller: "Bob" }),
    );
    alicesUnlock(state).decision();
    expect(v1.locked).toBe(true);
    expect(v1.attached).toEqual([]);
    expect(state.seats[1]!.ashHeap?.map((c) => c.name)).toEqual(["Masquerade Endangered"]);
    alicesUnlock(state).decision();
    expect(v1.locked).toBe(false);
  });

  it("strips a hunt ACTION CARD too, and the ally is still removed", () => {
    const state = threeSeatGame();
    Object.assign(minion(state, "V1"), { clan: "Hecata", blood: 2, capacity: 8 });
    state.seats[0]!.hand.push({ id: "ps", name: "Psychophagia" });
    state.seats[1]!.ashHeap = [{ id: "bA", name: "Political Ally" }];
    state.seats[1]!.hand.push({ id: "me", name: "Masquerade Endangered" });
    const engine = new VtesEngine(state, testRegistry);
    const play = ids(engine).find((i) => i.startsWith("play:Psychophagia") && i.includes(":gain:"))!;
    runTrace(engine, [["Alice", play]]);
    // Through the as-played window to the announcement.
    while (action(state) === null) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    // The card announces a HUNT: Thirst's "who did not hunt" sees it.
    expect(minion(state, "V1").huntedThisPhase).toBe(true);
    expect(action(state)!.actionKind).toBe("hunt");
    // Announce, A and C.
    for (let i = 0; i < 12 && !ids(engine).includes("play:Masquerade Endangered:-:V1:me"); i++) {
      runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    }
    expect(engine.decision()!.seat).toBe("Bob");
    runTrace(engine, [["Bob", "play:Masquerade Endangered:-:V1:me"]]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(minion(state, "V1").blood).toBe(2);
    expect(state.seats[1]!.ashHeap).toEqual([]);
  });
});

describe("XTC-Laced Blood (102198)", () => {
  it("after a hunt that GAINED blood: put on the hunter, controlled by the player", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "x", name: "XTC-Laced Blood" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, HUNT_TO_C);
    // NEGATIVE: in state C the hunt has not paid yet — not offered.
    runTrace(engine, [["Alice", "pass"]]);
    expect(ids(engine)).toEqual(["pass"]);
    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"]]);
    expect(engine.decision()!.window).toBe("action.afterResolution");
    expect(minion(state, "V1").blood).toBe(3);
    runTrace(engine, [["Alice", "pass"], ["Bob", "play:XTC-Laced Blood:-:V1:x"]]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    const x = minion(state, "V1").attached[0]!;
    expect(x.card.name).toBe("XTC-Laced Blood");
    expect(x.controller).toBe("Bob");
    expect(x.statics.mustHunt).toBe(true);
  });

  it("its vampire MUST hunt, even at capacity — and other minions wait (p. 19)", () => {
    const state = threeSeatGame();
    const v1 = minion(state, "V1");
    Object.assign(v1, { blood: 5, capacity: 5 });
    v1.attached.push(entry("x", "XTC-Laced Blood", { statics: { mustHunt: true }, controller: "Bob" }));
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    const engine = new VtesEngine(state, testRegistry);
    expect(ids(engine)).toEqual(["hunt:V1"]);
    // Once hunted this phase, the obligation is met.
    runTrace(engine, [["Alice", "hunt:V1"]]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(ids(engine)).toContain("bleed:V2");
  });

  it("any VAMPIRE may burn it as a +1 stealth Ⓓ action, directed at its controller", () => {
    const state = threeSeatGame();
    minion(state, "V1").attached.push(
      entry("x", "XTC-Laced Blood", { statics: { mustHunt: true }, controller: "Bob" }),
    );
    minion(state, "V1").huntedThisPhase = true;
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"), makeAlly("A1", "Alice", 2));
    const engine = new VtesEngine(state, testRegistry);
    const burns = ids(engine).filter((i) => i.startsWith("act:XTC-Laced Blood:x:"));
    expect(burns).toEqual(["act:XTC-Laced Blood:x:burn:V1", "act:XTC-Laced Blood:x:burn:V2"]);
    runTrace(engine, [["Alice", "act:XTC-Laced Blood:x:burn:V2"]]);
    const af = action(state)!;
    expect(af.target).toBe("Bob");
    expect(af.directed).toBe(true);
  });
});

describe("Tainted Vitae (101926)", () => {
  const withMinistry = (state: GameState): void => {
    Object.assign(minion(state, "W"), { clan: "Ministry", blood: 3 });
    state.seats[1]!.hand.push({ id: "tv", name: "Tainted Vitae" });
  };

  it("your predator's hunt about to succeed: +2 hunt, and the card goes on the hunter", () => {
    const state = threeSeatGame();
    withMinistry(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, HUNT_TO_C);
    runTrace(engine, [["Alice", "pass"]]);
    // W is a Ministry vampire with blood; M is not Ministry.
    expect(ids(engine)).toEqual(["pass", "play:Tainted Vitae:-:W:tv"]);
    runTrace(engine, [["Bob", "play:Tainted Vitae:-:W:tv"]]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(minion(state, "W").blood).toBe(1);
    expect(minion(state, "V1").blood).toBe(5); // 2 + 1 + 2
    const tv = minion(state, "V1").attached[0]!;
    expect(tv.card.name).toBe("Tainted Vitae");
    expect(tv.controller).toBe("Bob");
  });

  it("NEGATIVE: not your predator, a locked or poor Ministry vampire, or a stripped hunt", () => {
    const carol = threeSeatGame();
    Object.assign(minion(carol, "N"), { clan: "Ministry", blood: 3 });
    carol.seats[2]!.hand.push({ id: "tv", name: "Tainted Vitae" });
    const e1 = new VtesEngine(carol, testRegistry);
    runTrace(e1, HUNT_TO_C);
    runTrace(e1, [["Alice", "pass"], ["Bob", "pass"]]);
    expect(ids(e1)).toEqual(["pass"]); // Carol's predator is Bob

    const locked = threeSeatGame();
    withMinistry(locked);
    minion(locked, "W").locked = true;
    const e2 = new VtesEngine(locked, testRegistry);
    runTrace(e2, [...HUNT_TO_C, ["Alice", "pass"]]);
    expect(ids(e2)).toEqual(["pass"]);

    const poor = threeSeatGame();
    withMinistry(poor);
    minion(poor, "W").blood = 1;
    const e3 = new VtesEngine(poor, testRegistry);
    runTrace(e3, [...HUNT_TO_C, ["Alice", "pass"]]);
    expect(ids(e3)).toEqual(["pass"]);

    const stripped = threeSeatGame();
    withMinistry(stripped);
    stripped.seats[1]!.hand.push({ id: "me", name: "Masquerade Endangered" });
    const e4 = new VtesEngine(stripped, testRegistry);
    runTrace(e4, [...HUNT_TO_C, ["Alice", "pass"], ["Bob", "play:Masquerade Endangered"]]);
    runTrace(e4, [["Alice", "pass"]]);
    expect(ids(e4).some((i) => i.startsWith("play:Tainted Vitae"))).toBe(false);
  });

  it("bleeding its CONTROLLER costs 1 more blood; the gate asks for it", () => {
    const state = threeSeatGame();
    const v1 = minion(state, "V1");
    v1.attached.push(entry("tv", "Tainted Vitae", { statics: { bleedAgainstControllerBloodTax: 1 }, controller: "Bob" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(v1.blood).toBe(1);
  });

  it("NEGATIVE: controlled by someone else, it charges nothing; two copies outprice 1 blood", () => {
    const other = threeSeatGame();
    const v1 = minion(other, "V1");
    v1.attached.push(entry("tv", "Tainted Vitae", { statics: { bleedAgainstControllerBloodTax: 1 }, controller: "Carol" }));
    runTrace(new VtesEngine(other, testRegistry), [["Alice", "bleed:V1"]]);
    expect(v1.blood).toBe(2);

    const two = threeSeatGame();
    const w1 = minion(two, "V1");
    w1.blood = 1;
    for (const id of ["t1", "t2"]) {
      w1.attached.push(entry(id, "Tainted Vitae", { statics: { bleedAgainstControllerBloodTax: 1 }, controller: "Bob" }));
    }
    expect(ids(new VtesEngine(two, testRegistry))).not.toContain("bleed:V1");
  });

  it("a bleed ACTION CARD pays it at announcement and asks for it with its own cost", () => {
    const state = threeSeatGame();
    const v1 = minion(state, "V1");
    v1.attached.push(entry("tv", "Tainted Vitae", { statics: { bleedAgainstControllerBloodTax: 1 }, controller: "Bob" }));
    state.seats[0]!.hand.push({ id: "gu", name: "Govern the Unaligned" });
    const engine = new VtesEngine(state, testRegistry);
    const play = ids(engine).find((i) => i.startsWith("play:Govern the Unaligned:basic:V1"))!;
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play]]);
    while (action(state) === null) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(v1.blood).toBe(1); // the tax, at announcement; the card's 1 is due at resolution

    const poor = threeSeatGame();
    const p1 = minion(poor, "V1");
    p1.blood = 1;
    p1.attached.push(entry("tv", "Tainted Vitae", { statics: { bleedAgainstControllerBloodTax: 1 }, controller: "Bob" }));
    poor.seats[0]!.hand.push({ id: "gu", name: "Govern the Unaligned" });
    expect(ids(new VtesEngine(poor, testRegistry)).some((i) => i.startsWith("play:Govern"))).toBe(false);
  });
});

describe("Restricted Vitae (101614)", () => {
  const restricted = (): GameState => {
    const state = threeSeatGame();
    state.seats[2]!.permanents.push(
      entry("rv", "Restricted Vitae", { statics: { huntingRestricted: true }, tags: ["event", "gehenna"] }),
    );
    return state;
  };

  it("vampires cannot hunt unless they must — the hunt action card included", () => {
    const state = restricted();
    Object.assign(minion(state, "V1"), { clan: "Hecata", capacity: 8 });
    state.seats[0]!.hand.push({ id: "ps", name: "Psychophagia" });
    state.seats[1]!.ashHeap = [{ id: "bA", name: "Political Ally" }];
    const o = ids(new VtesEngine(state, testRegistry));
    expect(o).toContain("bleed:V1");
    expect(o).not.toContain("hunt:V1");
    expect(o.some((i) => i.startsWith("play:Psychophagia"))).toBe(false);
  });

  it("a vampire who must hunt may steal from a YOUNGER vampire of another Methuselah", () => {
    const state = restricted();
    Object.assign(minion(state, "V1"), { blood: 0, capacity: 6 });
    minion(state, "N").capacity = 7; // older
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { capacity: 3 })); // her own
    const o = ids(new VtesEngine(state, testRegistry));
    expect(o).toEqual(["hunt:V1", "hunt:V1:steal:W", "hunt:V1:steal:M"]);
  });

  it("the steal is a Ⓓ hunt at the target's controller, and blood comes from the target", () => {
    const state = restricted();
    Object.assign(minion(state, "V1"), { blood: 0, capacity: 6 });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1:steal:W"]]);
    const af = action(state)!;
    expect([af.actionKind, af.target, af.directed, af.targetMinion]).toEqual(["hunt", "Bob", true, "W"]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(minion(state, "W").blood).toBe(2);
    expect(minion(state, "V1").blood).toBe(1);
  });

  it("from a vampire with NO blood: legal, steals nothing, and the hunt fails [LSJ 20050720-2]", () => {
    const state = restricted();
    Object.assign(minion(state, "V1"), { blood: 0, capacity: 6 });
    minion(state, "M").blood = 0;
    state.seats[1]!.hand.push({ id: "x", name: "XTC-Laced Blood" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1:steal:M"]]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(minion(state, "V1").blood).toBe(0);
    expect(state.seats[1]!.hand.map((c) => c.name)).toContain("XTC-Laced Blood");
    // Once per turn: unlocked again and still hungry, only the basic hunt.
    minion(state, "V1").locked = false;
    expect(ids(engine)).toEqual(["hunt:V1"]);
  });

  it("Tainted Vitae's +2 hunt on a steal is taken from the target [RTR 20030519]", () => {
    const state = restricted();
    Object.assign(minion(state, "V1"), { blood: 0, capacity: 6 });
    Object.assign(minion(state, "W"), { clan: "Ministry", blood: 3 });
    Object.assign(minion(state, "M"), { blood: 3 });
    state.seats[1]!.hand.push({ id: "tv", name: "Tainted Vitae" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1:steal:M"]]);
    while (!ids(engine).includes("play:Tainted Vitae:-:W:tv")) {
      runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    }
    runTrace(engine, [["Bob", "play:Tainted Vitae:-:W:tv"]]);
    while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    expect(minion(state, "M").blood).toBe(0);
    expect(minion(state, "V1").blood).toBe(3);
  });

  it("is not replaced until a vampire SUCCESSFULLY hunts", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "rv", name: "Restricted Vitae" });
    state.seats[0]!.library.push({ id: "lib", name: "Conditioning" });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "discard";
      tf.discardActionsLeft = 1;
    }
    const engine = new VtesEngine(state, testRegistry);
    const id = ids(engine).find((o) => o.includes("Restricted Vitae"))!;
    runTrace(engine, [["Alice", id]]);
    while (state.frames.some((f) => f.kind === "cardPlay")) {
      runTrace(engine, [[engine.decision()!.seat, "pass"]]);
    }
    expect(state.seats[0]!.permanents.map((p) => p.card.name)).toEqual(["Restricted Vitae"]);
    expect(state.seats[0]!.library.length).toBe(1);
    // Bob's minion phase: two hungry vampires.
    Object.assign(minion(state, "W"), { blood: 0, capacity: 6 });
    minion(state, "M").blood = 0;
    minion(state, "N").blood = 0;
    state.frames = [{ ...state.frames[0]!, seat: "Bob", phase: "minion" } as GameState["frames"][number]];
    const bob = new VtesEngine(state, testRegistry);
    // A hunt that steals nothing is not a successful one.
    runTrace(bob, [["Bob", "hunt:W:steal:N"]]);
    while (action(state)) runTrace(bob, [[bob.decision()!.seat, "pass"]]);
    expect(state.seats[0]!.library.length).toBe(1);
    // A hunt that gains blood is, and Alice draws.
    runTrace(bob, [["Bob", "hunt:M"]]);
    while (action(state)) runTrace(bob, [[bob.decision()!.seat, "pass"]]);
    expect(minion(state, "M").blood).toBe(1);
    expect(state.seats[0]!.library.length).toBe(0);
  });
});

describe("a hunt action card is a hunt", () => {
  it("a vampire who must hunt may make the mandatory hunt with Psychophagia", () => {
    const state = threeSeatGame();
    Object.assign(minion(state, "V1"), { clan: "Hecata", blood: 0, capacity: 8 });
    state.seats[0]!.hand.push({ id: "ps", name: "Psychophagia" });
    state.seats[1]!.ashHeap = [{ id: "bA", name: "Political Ally" }];
    const o = ids(new VtesEngine(state, testRegistry));
    expect(o[0]).toBe("hunt:V1");
    expect(o.some((i) => i.startsWith("play:Psychophagia"))).toBe(true);
    expect(o).not.toContain("end");
  });
});
