/**
 * Playing a card from hand outside its own action
 * (docs/play-from-hand-design.md).
 *
 * Angel's Gift (102349), Contraband (102352), Pack Alpha (101342),
 * Piper (101401), Biothaumaturgic Experiment (100162).
 *
 * The whole family is one mechanism — "bring this permanent into play
 * now, requirements and cost as normal" — so most of what is worth
 * pinning is the NEGATIVE space: which hand cards each filter refuses,
 * and the fact that the bearer being locked (every combat case) does not
 * stop it while `canAct` would have.
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
 * Alice's V1 bleeds, Bob's M blocks, combat begins; stop in the
 * `combat.beforeRange` window with Alice to act. V1 is LOCKED here (it
 * announced an action, p. 25), which is the point: `canAct` would rule
 * every one of these cards out.
 */
function intoCombat(
  aliceHand: Array<{ id: string; name: string }>,
  v1: Partial<MinionState>,
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 4, ...v1 });
  state.seats[0]!.hand.push(...aliceHand);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block resolves
  ]);
  return { state, engine };
}

function masterPhase(state: GameState, seat = "Alice"): GameState {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = seat;
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  return state;
}

// ---------------------------------------------------------------------------

describe("Angel's Gift (102349)", () => {
  const hand = [
    { id: "ag", name: "Angel's Gift" },
    { id: "kf", name: "Kali's Fang" }, // melee
    { id: "mag", name: ".44 Magnum" }, // gun
  ];

  it("offers the melee weapon in hand and NOT the gun", () => {
    const { engine } = intoCombat(hand, { clan: "Salubri" });
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.beforeRange");
    const equips = dp.options.filter((o) =>
      o.id.startsWith("play:Angel's Gift:basic:V1:equip:"),
    );
    expect(equips.map((o) => o.id)).toEqual([
      "play:Angel's Gift:basic:V1:equip:kf:basic:ag",
    ]);
  });

  it("puts the weapon on the vampire and charges its printed pool cost", () => {
    const { state, engine } = intoCombat(hand, { clan: "Salubri" });
    const pool = state.seats[0]!.pool;
    runTrace(engine, [
      ["Alice", "play:Angel's Gift:basic:V1:equip:kf:basic:ag"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(find(state, "V1").attached.some((p) => p.card.name === "Kali's Fang")).toBe(true);
    expect(state.seats[0]!.pool).toBe(pool - 2);
    expect(state.seats[0]!.hand.some((c) => c.id === "kf")).toBe(false);
    // It IS played (p. 9) — the log is what game-wide uniqueness reads.
    expect(
      state.eventLog.some((e) => e.type === "CardPlayed" && e.name === "Kali's Fang"),
    ).toBe(true);
  });

  it("requires a Salubri", () => {
    const { engine } = intoCombat(hand, { clan: "Brujah" });
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Angel's Gift"))).toBe(false);
  });

  it("is refused when the seat cannot pay the weapon's cost", () => {
    const { state, engine } = intoCombat(hand, { clan: "Salubri" });
    // Enumeration is re-run each decision, so shrinking the pool now is
    // enough: 2 pool cannot buy a 2-pool weapon (never oust yourself, p. 9).
    state.seats[0]!.pool = 2;
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.includes(":equip:kf:"))).toBe(false);
  });

  it("its close-range maneuver is worth nothing at close range, and live at long", () => {
    const { state, engine } = intoCombat(
      [{ id: "ag", name: "Angel's Gift" }],
      { clan: "Salubri" },
    );
    // Bob's blocker gets a real maneuver card, to move the range itself.
    Object.assign(find(state, "M"), { disciplines: { cel: "basic" } });
    state.seats[1]!.hand.push({ id: "pu", name: "Pursuit" });

    runTrace(engine, [
      ["Alice", "play:Angel's Gift:basic:V1:close:ag"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // rest of beforeRange
    ]);

    // Range step, still close: the credit buys nothing, so it is not offered.
    let dp = engine.decision()!;
    expect(dp.window).toBe("combat.range");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id === "maneuver:credit")).toBe(false);

    // Bob maneuvers to long range; now Alice's credit can close it.
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Pursuit:basic:M:pu"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    expect(cf.range).toBe("long");
    dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const credit = dp.options.find((o) => o.id === "maneuver:credit");
    expect(credit).toBeDefined();

    runTrace(engine, [["Alice", "maneuver:credit"]]);
    expect(cf.range).toBe("close");
    // Spent from the close-only pool, not from the (empty) combat-long one.
    expect(cf.closeManeuvers.acting).toBe(0);
    expect(cf.maneuverCredits.acting).toBe(0);
  });
});

describe("Contraband (102352)", () => {
  const hand = [
    { id: "cb", name: "Contraband" },
    { id: "mag", name: ".44 Magnum" }, // non-unique, 2 pool
    { id: "kf", name: "Kali's Fang" }, // Unique
  ];

  it("refuses a unique equipment and takes the non-unique one", () => {
    const { engine } = intoCombat(hand, {
      clan: "Ravnos",
      disciplines: { obf: "basic" },
    });
    const dp = engine.decision()!;
    const plays = dp.options.filter((o) => o.id.startsWith("play:Contraband:"));
    expect(plays.length).toBe(1);
    // A hand-rolled handler (.44 Magnum) has one printed version and no
    // discipline gate, so its mode segment is "-".
    expect(plays[0]!.id).toBe("play:Contraband:basic:V1:mag:-:cb");
  });

  it("superior offers one option per legal blood/pool split, half rounded down", () => {
    const { engine } = intoCombat(hand, {
      clan: "Ravnos",
      disciplines: { obf: "superior" },
    });
    const dp = engine.decision()!;
    const sup = dp.options
      .filter((o) => o.id.startsWith("play:Contraband:superior:"))
      .map((o) => o.id);
    // A 2-pool weapon: pay 2 pool, or 1 blood + 1 pool. Never 2 blood.
    expect(sup).toEqual([
      "play:Contraband:superior:V1:mag:-:cb",
      "play:Contraband:superior:V1:mag:-:1:cb",
    ]);
  });

  it("actually charges the chosen split", () => {
    const { state, engine } = intoCombat(hand, {
      clan: "Ravnos",
      disciplines: { obf: "superior" },
    });
    const pool = state.seats[0]!.pool;
    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Contraband:superior:V1:mag:-:1:cb"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.seats[0]!.pool).toBe(pool - 1);
    expect(find(state, "V1").blood).toBe(blood - 1);
    expect(find(state, "V1").attached.some((p) => p.card.name === ".44 Magnum")).toBe(true);
  });
});

describe("Pack Alpha (101342)", () => {
  it("employs an animal retainer from hand mid-combat, locked bearer and all", () => {
    const { state, engine } = intoCombat(
      [
        { id: "pa", name: "Pack Alpha" },
        { id: "rs", name: "Raven Spy" }, // animal, 1 blood
        { id: "wi", name: "Mr. Winthrop" }, // mortal
      ],
      { disciplines: { ani: "basic" } },
    );
    expect(find(state, "V1").locked).toBe(true);

    const dp = engine.decision()!;
    const plays = dp.options.filter((o) => o.id.startsWith("play:Pack Alpha:"));
    // Only the animal, and only the printed version V1's Animalism reaches.
    expect(plays.map((o) => o.id)).toEqual(["play:Pack Alpha:basic:V1:rs:basic:pa"]);

    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Pack Alpha:basic:V1:rs:basic:pa"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const spy = find(state, "V1").attached.find((p) => p.card.name === "Raven Spy");
    expect(spy).toBeDefined();
    expect(spy!.life).toBe(1);
    expect(find(state, "V1").blood).toBe(blood - 1);
  });

  it("superior burns an animal retainer to attach itself for +1 strength", () => {
    const { state, engine } = intoCombat([{ id: "pa", name: "Pack Alpha" }], {
      disciplines: { ani: "superior" },
    });
    // A retainer already employed — and a non-animal one it must not eat.
    find(state, "V1").attached.push(
      { card: { id: "dog", name: "Dog Pack" }, locked: false, usedThisPhase: false, statics: {}, tags: ["animal"], life: 1 },
      { card: { id: "win", name: "Mr. Winthrop" }, locked: false, usedThisPhase: false, statics: {}, tags: ["mortal"], life: 1 },
    );

    const dp = engine.decision()!;
    const sup = dp.options.filter((o) => o.id.startsWith("play:Pack Alpha:superior:"));
    expect(sup.map((o) => o.id)).toEqual(["play:Pack Alpha:superior:V1:dog:pa"]);

    runTrace(engine, [
      ["Alice", "play:Pack Alpha:superior:V1:dog:pa"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const v1 = find(state, "V1");
    expect(v1.attached.some((p) => p.card.id === "dog")).toBe(false);
    const alpha = v1.attached.find((p) => p.card.id === "pa");
    expect(alpha).toBeDefined();
    expect(alpha!.statics.strength).toBe(1);
    expect(alpha!.tags).toContain("Pack Alpha");
  });

  it("superior is not offered a second time on the same minion", () => {
    const { state, engine } = intoCombat([{ id: "pa2", name: "Pack Alpha" }], {
      disciplines: { ani: "superior" },
    });
    find(state, "V1").attached.push(
      { card: { id: "dog", name: "Dog Pack" }, locked: false, usedThisPhase: false, statics: {}, tags: ["animal"], life: 1 },
      { card: { id: "pa1", name: "Pack Alpha" }, locked: false, usedThisPhase: false, statics: {}, tags: ["Pack Alpha"] },
    );
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Pack Alpha:superior:"))).toBe(false);
  });
});

describe("Piper (101401)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = masterPhase(threeSeatGame());
    Object.assign(find(state, "V1"), { sect: "anarch" });
    state.seats[0]!.minions.push(
      makeMinion("A2", "Alice", { sect: "anarch", locked: true }),
    );
    state.seats[0]!.hand.push(
      { id: "pi", name: "Piper" },
      { id: "pal", name: "Political Ally" }, // 2 pool
      { id: "mag", name: ".44 Magnum" }, // equipment: not an ally or retainer
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers only the unlocked Anarch, and only ally/retainer cards", () => {
    const { engine } = game();
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.master");
    const plays = dp.options.filter((o) => o.id.startsWith("play:Piper:"));
    // A2 is locked, so it is not an actor; the Magnum is the wrong type.
    expect(plays.map((o) => o.id)).toEqual(["play:Piper:-:pal:basic:V1:pi"]);
  });

  it("locks the Anarch, pays the ally's cost, and puts it in play", () => {
    const { state, engine } = game();
    const pool = state.seats[0]!.pool;
    runTrace(engine, [
      ["Alice", "play:Piper:-:pal:basic:V1:pi"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(find(state, "V1").locked).toBe(true);
    expect(state.seats[0]!.pool).toBe(pool - 2);
    const ally = state.seats[0]!.minions.find((m) => m.id === "pal");
    expect(ally).toBeDefined();
    expect(ally!.kind).toBe("ally");
    // "This is not an action": no ActionFrame was ever announced for it.
    expect(state.eventLog.some((e) => e.type === "ActionAnnounced")).toBe(false);
  });

  it("is not playable at all without a ready Anarch", () => {
    const { state, engine } = game();
    find(state, "V1").sect = "camarilla";
    find(state, "A2").sect = "camarilla";
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Piper:"))).toBe(false);
  });
});

describe("Biothaumaturgic Experiment (100162)", () => {
  it("basic employs an animal retainer the vampire could NOT normally employ", () => {
    // The sharp case for `ignoreRequirements`: V1 has Thaumaturgy and no
    // Animalism at all, so Raven Spy is unplayable by the ordinary employ
    // action — and this card says "ignoring requirements".
    const state = masterPhase(threeSeatGame(), "Alice");
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    Object.assign(find(state, "V1"), { disciplines: { tha: "basic" }, blood: 4 });
    state.seats[0]!.hand.push(
      { id: "bx", name: "Biothaumaturgic Experiment" },
      { id: "rs", name: "Raven Spy" },
    );
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    // Raven Spy on its own is NOT playable — no Animalism.
    expect(dp.options.some((o) => o.id.startsWith("play:Raven Spy:"))).toBe(false);
    // Through the Experiment it is, at both printed versions.
    const plays = dp.options
      .filter((o) => o.id.startsWith("play:Biothaumaturgic Experiment:basic:"))
      .map((o) => o.id);
    expect(plays).toEqual([
      "play:Biothaumaturgic Experiment:basic:V1:rs:basic:bx",
      "play:Biothaumaturgic Experiment:basic:V1:rs:superior:bx",
    ]);

    const pool = state.seats[0]!.pool;
    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Biothaumaturgic Experiment:basic:V1:rs:superior:bx"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
    const spy = find(state, "V1").attached.find((p) => p.card.name === "Raven Spy");
    expect(spy).toBeDefined();
    // The superior printed version: 2 life. The card's own pool cost is 1,
    // and "pay cost as normal" charges the retainer's 1 blood.
    expect(spy!.life).toBe(2);
    expect(state.seats[0]!.pool).toBe(pool - 1);
    expect(find(state, "V1").blood).toBe(blood - 1);
  });

  it("superior attaches to a chosen minion and grants it a maneuver each combat", () => {
    const state = masterPhase(threeSeatGame(), "Alice");
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    Object.assign(find(state, "V1"), { disciplines: { tha: "superior" }, blood: 4 });
    state.seats[0]!.minions.push(makeMinion("A2", "Alice", { blood: 3 }));
    state.seats[0]!.hand.push({ id: "bx", name: "Biothaumaturgic Experiment" });
    const engine = new VtesEngine(state, testRegistry);

    // "A minion you control" — one option per minion, not just the actor.
    // Only V1 can ANNOUNCE it (A2 has no Thaumaturgy), but either can be
    // the bearer: the two questions are separate.
    const dp = engine.decision()!;
    const sup = dp.options
      .filter((o) => o.id.startsWith("play:Biothaumaturgic Experiment:superior:"))
      .map((o) => o.id);
    expect(sup).toEqual([
      "play:Biothaumaturgic Experiment:superior:V1:V1:bx",
      "play:Biothaumaturgic Experiment:superior:V1:A2:bx",
    ]);

    runTrace(engine, [
      ["Alice", "play:Biothaumaturgic Experiment:superior:V1:A2:bx"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
    const a2 = find(state, "A2");
    const entry = a2.attached.find((p) => p.card.id === "bx");
    expect(entry).toBeDefined();
    expect(entry!.statics.strength).toBe(1);
    expect(entry!.statics.maneuverPerCombat).toBe(1);
    expect(find(state, "V1").attached.some((p) => p.card.id === "bx")).toBe(false);

    // The maneuver is real: A2 starts its next combat with a credit.
    runTrace(engine, [["Alice", "bleed:A2"]]);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    expect(cf.maneuverCredits.acting).toBe(1);
  });
});
