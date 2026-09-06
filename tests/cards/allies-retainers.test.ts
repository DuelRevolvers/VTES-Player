/**
 * The allies/retainers gate (docs/allies-retainers-design.md): recruit
 * ally and employ retainer actions, life counters, ally combat, retainer
 * combat output, and the tranche-2 abilities. Per-card scenarios; the
 * kernel-level invariants live in tests/engine/allies-kernel.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

/** announce (3 passes) → A (3 passes, defenders decline) → C (3 passes). */
const undirectedActionPasses: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

describe("Political Ally (101411)", () => {
  it("recruits via an undirected +1 stealth action; the ally cannot act this turn", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "pa1", name: "Political Ally" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Political Ally"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ...undirectedActionPasses,
    ]);

    expect(alice.pool).toBe(8); // 2 pool paid at resolution
    const ally = alice.minions.find((m) => m.id === "pa1")!;
    expect(ally.kind).toBe("ally");
    expect(ally.blood).toBe(1); // life from the blood bank
    expect(ally.bleedAmount).toBe(3);
    expect(ally.strength).toBe(0);
    expect(ally.cannotActThisTurn).toBe(true);
    // Its own card rides along as a self-attached entry.
    expect(ally.attached.map((p) => p.card.name)).toEqual(["Political Ally"]);
    expect(state.seats[0]!.minions[0]!.locked).toBe(true); // V1 acted

    // Negative space: the recruited ally is offered no actions this turn.
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.minion");
    expect(dp.options.some((o) => o.id === "bleed:pa1")).toBe(false);
    expect(dp.options.some((o) => o.id === "hunt:pa1")).toBe(false);
  });

  it("is unique: not offered while an own copy is in play", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeAlly("pa0", "Alice", 1, {
        name: "Political Ally",
        attached: [entry("pa0", "Political Ally")],
      }),
    );
    alice.hand.push({ id: "pa1", name: "Political Ally" });
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Political Ally"))).toBe(false);
  });

  it("bleeds for its printed 3 on a later turn", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeAlly("pa0", "Alice", 1, { name: "Political Ally", bleedAmount: 3 }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:pa0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A (declines)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(state.seats[1]!.pool).toBe(7);
    expect(state.edge).toBe("Alice");
  });
});

describe("Revenant (101628)", () => {
  it("employs for 1 blood: attaches with 2 life and +1 intercept", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "rev1", name: "Revenant" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Revenant"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ...undirectedActionPasses,
    ]);

    const v1 = alice.minions[0]!;
    expect(v1.blood).toBe(1); // paid 1 blood at resolution
    const rev = v1.attached.find((p) => p.card.name === "Revenant")!;
    expect(rev.life).toBe(2);
    expect(rev.statics.intercept).toBe(1);
    expect(state.eventLog.some((e) => e.type === "CardBurned")).toBe(false);
  });
});

describe("Mr. Winthrop (101249)", () => {
  it("employs for free and is unique", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "mw1", name: "Mr. Winthrop" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Mr. Winthrop"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ...undirectedActionPasses,
    ]);

    const v1 = alice.minions[0]!;
    expect(v1.blood).toBe(2); // free
    const mw = v1.attached.find((p) => p.card.name === "Mr. Winthrop")!;
    expect(mw.life).toBe(1);
    expect(mw.statics.intercept).toBe(1);
  });

  it("is not offered while an own copy is in play", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.attached.push(entry("mw0", "Mr. Winthrop", { life: 1 }));
    alice.hand.push({ id: "mw1", name: "Mr. Winthrop" });
    const engine = new VtesEngine(state, testRegistry);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Mr. Winthrop"))).toBe(false);
  });
});

describe("Raven Spy (101550)", () => {
  it("offers only the modes the employer's Animalism level unlocks", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { ani: "basic" };
    alice.hand.push({ id: "rs1", name: "Raven Spy" });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Raven Spy:basic"))).toBe(true);
    expect(dp.options.some((o) => o.id.startsWith("play:Raven Spy:superior"))).toBe(false);

    runTrace(engine, [
      ["Alice", "play:Raven Spy:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ...undirectedActionPasses,
    ]);

    const rs = alice.minions[0]!.attached.find((p) => p.card.name === "Raven Spy")!;
    expect(rs.life).toBe(1); // basic version: 1 life
    expect(rs.statics.intercept).toBe(1);
  });

  it("the superior mode enters play with 2 life", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { ani: "superior" };
    alice.hand.push({ id: "rs1", name: "Raven Spy" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Raven Spy:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ...undirectedActionPasses,
    ]);

    const rs = alice.minions[0]!.attached.find((p) => p.card.name === "Raven Spy")!;
    expect(rs.life).toBe(2);
  });
});

describe("Murder of Crows (101254)", () => {
  it("inflicts 1 environmental damage on the opposing minion each round", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.attached.push(
      entry("mc1", "Murder of Crows", {
        statics: { combatRoundDamage: { amount: 1, ranged: true } },
        life: 2,
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // no maneuvers
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      // Damage: V1 takes W's strike (1) then the crows' 1, then W takes 1.
      ["Alice", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const v1 = state.seats[0]!.minions[0]!;
    expect(v1.blood).toBe(0); // mended 1 (strike) + 1 (crows)
    expect(w.blood).toBe(2); // mended V1's strike only
    const environmental = state.eventLog.filter(
      (e) => e.type === "DamageInflicted" && e.source === null,
    );
    expect(environmental).toHaveLength(1);
    expect(environmental[0]).toMatchObject({ minion: "V1", amount: 1 });
  });
});

describe("Dread Mastiff (102317)", () => {
  it("superior grants the employer a press usable in any round of the combat", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 5;
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.attached.push(
      entry("dm1", "Dread Mastiff", {
        statics: { combatRoundDamage: { amount: 1, ranged: false }, pressPerCombat: 1 },
        life: 2,
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      // Round 1.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Alice", "pass"], // V1: strike + mastiff damage
      ["Bob", "pass"], // W: V1's strike
      // Press: Alice has none; Bob spends the mastiff's combat press.
      ["Alice", "pass"],
      ["Bob", "press:continue"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round 1
      // Round 2.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Alice", "pass"],
      ["Bob", "pass"],
      // Press: the combat press is spent — nothing left, combat ends.
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const ended = state.eventLog.find((e) => e.type === "CombatEnded")!;
    expect(ended).toMatchObject({ rounds: 2 });
    expect(state.seats[0]!.minions[0]!.blood).toBe(1); // 5 − 2×(1+1)
  });
});

describe("Dog Pack (100568)", () => {
  it("blocks the opposing minion's combat-ends strikes", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { pre: "basic" };
    alice.hand.push({ id: "mj1", name: "Majesty" });
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.attached.push(
      entry("dp1", "Dog Pack", { statics: { opposingCannotCombatEnds: true }, life: 1 }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ]);

    // V1 (in combat with the Dog Pack's employer) cannot play Majesty.
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.startsWith("play:Majesty"))).toBe(false);
    expect(dp.options.some((o) => o.id === "strike:hand")).toBe(true);
  });

  it("without Dog Pack the same strike is offered (control)", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { pre: "basic" };
    alice.hand.push({ id: "mj1", name: "Majesty" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Majesty"))).toBe(true);
  });
});

describe("Double Deuce (102220)", () => {
  it("gains 1 life during his controller's unlock phase when at 2 or fewer", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeAlly("dd1", "Alice", 2, {
        name: "Double Deuce",
        capacity: 3,
        strength: 1,
        bleedAmount: 1,
        attached: [entry("dd1", "Double Deuce", { statics: { stealth: 1 } })],
      }),
    );
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.phase = "unlock";
    frame.unlockDone = false;
    const engine = new VtesEngine(state, testRegistry);

    engine.decision(); // settling the unlock phase runs the regen hook
    expect(alice.minions.find((m) => m.id === "dd1")!.blood).toBe(3);
  });

  it("does not regen above 2 life, and his +1 stealth static foils a block", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeAlly("dd1", "Alice", 3, {
        name: "Double Deuce",
        strength: 1,
        bleedAmount: 1,
        attached: [entry("dd1", "Double Deuce", { statics: { stealth: 1 } })],
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:dd1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"], // M: 0 intercept vs static stealth 1
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      // Failed block → back to A; Bob declines this time.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    expect(state.seats[1]!.pool).toBe(9); // bled for 1
  });
});

describe("47th Street Royals (102217)", () => {
  it("burns itself to reduce a bleed against its controller by 3", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.minions.push(
      makeAlly("sr1", "Bob", 2, {
        name: "47th Street Royals",
        strength: 1,
        bleedAmount: 0,
        attached: [entry("sr1", "47th Street Royals")],
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "ability:47th Street Royals"],
      // Using an effect hands the impulse back to the acting Methuselah.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A again
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    // Bleed 1 − 3 → nothing burned, no Edge; the ally burned itself.
    expect(bob.pool).toBe(10);
    expect(state.edge).toBeNull();
    expect(bob.minions.some((m) => m.id === "sr1")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "MinionBurned")).toBe(true);
  });
});

describe("ally card play (vampire-only wakes)", () => {
  it("a locked ally may play On the Qui Vive but not Forced Awakening", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.minions.push(makeAlly("AL", "Bob", 2, { locked: true }));
    bob.hand.push({ id: "fa1", name: "Forced Awakening" });
    bob.hand.push({ id: "qv1", name: "On the Qui Vive" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    const ids = dp.options.map((o) => o.id);
    // "Only usable by a locked minion": the ally qualifies.
    expect(ids.some((id) => id.startsWith("play:On the Qui Vive:basic:AL"))).toBe(true);
    // "Only usable by a locked vampire": the ally does not.
    expect(ids.some((id) => id.startsWith("play:Forced Awakening:basic:AL"))).toBe(false);
  });
});

describe("Homunculus (100932)", () => {
  it("lets the employer burn 1 blood to unlock during another Methuselah's unlock phase", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.locked = true;
    w.attached.push(entry("hom1", "Homunculus", { life: 1 }));
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.phase = "unlock";
    frame.unlockDone = false;
    const engine = new VtesEngine(state, testRegistry);

    // Alice's own unlock settles automatically; Bob then holds the window.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.window).toBe("turn.unlock");

    runTrace(engine, [["Bob", "ability:Homunculus"]]);
    expect(w.locked).toBe(false);
    expect(w.blood).toBe(2);

    // Ability spent → Alice's master phase proceeds.
    const next = engine.decision()!;
    expect(next.seat).toBe("Alice");
    expect(next.window).toBe("turn.master");
  });

  it("declining leaves the employer locked and advances the turn", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.locked = true;
    w.attached.push(entry("hom1", "Homunculus", { life: 1 }));
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.phase = "unlock";
    frame.unlockDone = false;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Bob", "pass"]]);
    expect(w.locked).toBe(true);
    const next = engine.decision()!;
    expect(next.seat).toBe("Alice");
    expect(next.window).toBe("turn.master");
  });
});
