/**
 * The play-cost gate (docs/play-cost-design.md).
 *
 * A card's cost used to be a constant read straight off the spec. It now
 * goes through `playCostFor`, which is consulted at BOTH kinds of site —
 * enumeration and payment — so these tests check both: that the number
 * actually charged changed, AND that the option list agrees with it.
 *
 * Charisma (100332), Libertas (101100), Consign to Oblivion (102288),
 * Unleashing the Bestial Soul (102263), Ensnare a Beast (102319).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, playCostFor } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function attach(m: MinionState, id: string, name: string, statics: object): void {
  m.attached.push({
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: statics as PermanentInPlay["statics"],
    tags: [name],
  });
}

describe("playCostFor — the chokepoint", () => {
  it("clamps at zero rather than going negative", () => {
    const state = threeSeatGame();
    const v = find(state, "V1");
    attach(v, "ch", "Charisma", {
      playCostMod: { amount: -5, pays: "bloodOrPool", cardTypes: ["ally"], minions: "bearer" },
    });
    const cost = playCostFor(
      state,
      { name: "Aggressive Corpse", bloodCost: 2, poolCost: 0, types: ["ally"], requires: [] },
      v,
      null,
      null,
    );
    expect(cost).toEqual({ blood: 0, pool: 0 });
  });

  it("leaves a card no modifier names alone", () => {
    const state = threeSeatGame();
    const v = find(state, "V1");
    attach(v, "ch", "Charisma", {
      playCostMod: { amount: -1, pays: "bloodOrPool", cardTypes: ["ally"], minions: "bearer" },
    });
    const cost = playCostFor(
      state,
      { name: "Soak", bloodCost: 1, poolCost: 0, types: ["combat"], requires: ["for"] },
      v,
      null,
      null,
    );
    expect(cost).toEqual({ blood: 1, pool: 0 });
  });
});

describe("Charisma (100332)", () => {
  /** Alice's V1 carries Charisma and recruits an ally. */
  function game(ally: string): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    attach(find(state, "V1"), "ch", "Charisma", {
      playCostMod: {
        amount: -1,
        pays: "bloodOrPool",
        cardTypes: ["ally"],
        minions: "bearer",
      },
    });
    state.seats[0]!.hand.push({ id: "a1", name: ally });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  function recruit(engine: VtesEngine, opt: string): void {
    runTrace(engine, [
      [`Alice`, opt],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
  }

  it("takes 1 off a BLOOD-costed ally", () => {
    const { state, engine } = game("Aggressive Corpse");
    const before = find(state, "V1").blood;
    recruit(engine, "play:Aggressive Corpse");
    // Printed 2 blood, charged 1.
    expect(find(state, "V1").blood).toBe(before - 1);
  });

  it("takes 1 off a POOL-costed ally instead", () => {
    // "−1 blood or pool" lands on whichever resource the card charges.
    const { state, engine } = game("Political Ally");
    const before = state.seats[0]!.pool;
    recruit(engine, "play:Political Ally");
    expect(state.seats[0]!.pool).toBe(before - 1); // printed 2 pool
  });

  it("only helps the vampire it sits on", () => {
    const { state, engine } = game("Aggressive Corpse");
    // W is Bob's; give Alice a second vampire with no Charisma and only
    // enough blood for the DISCOUNTED cost, then check it is not offered.
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 1 }));
    const recruits = engine
      .decision()!
      .options.map((o) => o.id)
      .filter((i) => i.startsWith("play:Aggressive Corpse:"));
    // V1 can afford the discounted 1; V2, with the same 1 blood and no
    // Charisma, cannot afford the printed 2.
    expect(recruits.some((i) => i.includes(":V1"))).toBe(true);
    expect(recruits.some((i) => i.includes(":V2"))).toBe(false);
  });
});

describe("Libertas (101100)", () => {
  /** Bob's M carries Libertas; Alice bleeds into it. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { dom: "superior" }, blood: 4 });
    Object.assign(find(state, "M"), { sect: "anarch", blood: 3 });
    attach(find(state, "M"), "lib", "Libertas", {
      alliesCannotBlock: true,
      playCostMod: {
        amount: 1,
        pays: "blood",
        requiresDiscipline: ["dom", "pre"],
        minions: "others",
        whileBearerEngaged: true,
      },
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("does nothing while the bearer is not engaged", () => {
    // "…while this Anarch is acting, attempting to block or in combat."
    // Alice bleeds Bob; M is uninvolved, so Deflection is priced as
    // printed and the acting minion's own cards are untouched.
    const { state } = game();
    const cost = playCostFor(
      state,
      { name: "Deflection", bloodCost: 1, poolCost: 0, types: ["reaction"], requires: ["dom"] },
      find(state, "V1"),
      null,
      null,
    );
    expect(cost.blood).toBe(1);
  });

  it("charges OTHER minions +1 on a Dominate card while the bearer acts", () => {
    const { state } = game();
    const af = {
      acting: "M",
      blockedBy: null,
      playCostMods: [],
    } as unknown as Parameters<typeof playCostFor>[3];
    const dom = playCostFor(
      state,
      { name: "Deflection", bloodCost: 1, poolCost: 0, types: ["reaction"], requires: ["dom"] },
      find(state, "V1"),
      af,
      null,
    );
    expect(dom.blood).toBe(2);
    // The bearer themselves is exempt — "other minions".
    const own = playCostFor(
      state,
      { name: "Deflection", bloodCost: 1, poolCost: 0, types: ["reaction"], requires: ["dom"] },
      find(state, "M"),
      af,
      null,
    );
    expect(own.blood).toBe(1);
    // And a card requiring neither Discipline is untouched.
    const other = playCostFor(
      state,
      { name: "Soak", bloodCost: 1, poolCost: 0, types: ["combat"], requires: ["for"] },
      find(state, "V1"),
      af,
      null,
    );
    expect(other.blood).toBe(1);
  });

  it("stops allies blocking the bearer, for EVERY action they take", () => {
    // The persistent form of blockRestrictions.noAllies.
    const { state, engine } = game();
    // Bob's M is the actor; Carol has an ally who would otherwise block.
    state.seats[2]!.minions.push(
      makeMinion("CA", "Carol", { kind: "ally", blood: 3, bleedAmount: 1 }),
    );
    // Advance to Bob's turn so M can act… simpler: assert through the
    // option list of an action M announces. M bleeds its prey (Carol).
    const tf = state.frames.find((f) => f.kind === "turn")!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const e2 = new VtesEngine(state, testRegistry);
    runTrace(e2, [
      ["Bob", "bleed:M"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // announce
      ["Bob", "pass"],
    ]);
    const dp = e2.decision()!;
    expect(dp.seat).toBe("Carol");
    expect(dp.options.some((o) => o.id === "block:CA")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:N")).toBe(true); // her vampire can
  });
});

describe("Consign to Oblivion (102288)", () => {
  /** Alice's V1 bleeds Bob, who holds a reaction. */
  function game(mode: string): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { obl: "superior" }, blood: 4 });
    Object.assign(find(state, "M"), { disciplines: { aus: "superior" }, blood: 3 });
    state.seats[0]!.hand.push({ id: "cto", name: "Consign to Oblivion" });
    state.seats[1]!.hand.push({ id: "tc", name: "Telepathic Counter" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", `play:Consign to Oblivion:${mode}:V1:cto`],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    return { state, engine };
  }

  it("makes the defender's reaction cost 1 more", () => {
    const { state, engine } = game("basic");
    const before = find(state, "M").blood;
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Telepathic Counter:superior:M:tc"],
    ]);
    // Telepathic Counter is printed free; the surcharge is the whole cost.
    expect(find(state, "M").blood).toBe(before - 1);
  });

  it("prices it out of reach when the defender cannot pay", () => {
    // The enumeration half: a surcharge must remove the option, not let
    // a minion announce something it cannot pay for.
    const { state, engine } = game("basic");
    find(state, "M").blood = 0;
    runTrace(engine, [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.includes("Telepathic Counter"))).toBe(false);
  });

  it("superior also holds the replacement draw until the action ends", () => {
    const { state, engine } = game("superior");
    state.seats[1]!.library.push({ id: "lib1", name: "Soak" }, { id: "lib2", name: "Soak" });
    const handBefore = state.seats[1]!.hand.length;
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Telepathic Counter:superior:M:tc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    // The card left the hand and has NOT been replaced yet.
    expect(state.seats[1]!.hand.length).toBe(handBefore - 1);
  });
});

describe("Unleashing the Bestial Soul (102263)", () => {
  /** `target` is the minion barred from reacting — "choose a minion" is
   *  unqualified, so it may even be one of the actor's own. */
  function game(mode: string, target: string): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { dom: "superior" }, blood: 4 });
    Object.assign(find(state, "M"), { disciplines: { aus: "superior" }, blood: 3 });
    Object.assign(find(state, "W"), { disciplines: { aus: "superior" }, blood: 3 });
    state.seats[0]!.hand.push({ id: "ubs", name: "Unleashing the Bestial Soul" });
    state.seats[1]!.hand.push(
      { id: "tc1", name: "Telepathic Counter" },
      { id: "tc2", name: "Telepathic Counter" },
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", `play:Unleashing the Bestial Soul:${mode}:V1:${target}:ubs`],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"],
    ]);
    return { state, engine };
  }

  it("bars the chosen minion from playing reaction cards", () => {
    const { engine } = game("basic", "M");
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    const reactions = dp.options.filter((o) => o.id.startsWith("play:Telepathic Counter"));
    // M was chosen; W was not.
    expect(reactions.some((o) => o.id.includes(":M:"))).toBe(false);
    expect(reactions.some((o) => o.id.includes(":W:"))).toBe(true);
  });

  it("does NOT stop the chosen minion blocking — the card says reaction CARDS", () => {
    const { engine } = game("basic", "M");
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "block:M")).toBe(true);
  });

  it("superior surcharges only the NEXT reaction card, then stops", () => {
    // Choose the ACTOR's own vampire, so the bar takes nothing away from
    // Bob and the one-shot surcharge is what the test measures.
    const { state, engine } = game("superior", "V1");
    const w = find(state, "W");
    const m = find(state, "M");
    const wBefore = w.blood;
    runTrace(engine, [["Bob", "play:Telepathic Counter:superior:W:tc1"]]);
    // The first reaction pays the one-shot charge (printed cost is 0).
    expect(w.blood).toBe(wBefore - 1);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"],
    ]);
    // A DIFFERENT minion plays the second copy — the p. 10 limit is one
    // named card per minion per action, so W could not do it again.
    const mBefore = m.blood;
    runTrace(engine, [["Bob", "play:Telepathic Counter:superior:M:tc2"]]);
    // The charge is spent: the second is free again.
    expect(m.blood).toBe(mBefore);
  });
});

describe("Terror Frenzy (101966) superior — the frenzy doc's deferral", () => {
  /** Alice's V1 bleeds; Bob's M blocks; combat, stopping before range. */
  function combat(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { pot: "superior" }, blood: 4, strength: 1 });
    Object.assign(find(state, "M"), { disciplines: { ani: "superior" }, blood: 4 });
    state.seats[1]!.hand.push(
      { id: "tf1", name: "Terror Frenzy" },
      { id: "tf2", name: "Terror Frenzy" },
    );
    state.seats[0]!.hand.push({ id: "slam", name: "Slam" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
    ]);
    return { state, engine };
  }

  it("makes the opposing vampire's combat cards cost 1 more", () => {
    const { state, engine } = combat();
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Terror Frenzy:superior:M:tf1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ]);
    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", "play:Slam:basic:V1:slam"]]);
    expect(find(state, "V1").blood).toBe(before - 2); // printed 1
  });

  it("charges only the OPPOSING vampire, not its own player", () => {
    const { state, engine } = combat();
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Terror Frenzy:superior:M:tf1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    const priced = {
      name: "Slam",
      bloodCost: 1,
      poolCost: 0,
      types: ["combat" as const],
      requires: ["pot"],
    };
    // V1 is M's opponent and pays the surcharge…
    expect(playCostFor(state, priced, find(state, "V1"), null, cf).blood).toBe(2);
    // …M, who played it, does not.
    expect(playCostFor(state, priced, find(state, "M"), null, cf).blood).toBe(1);
  });

  it("is limited per MODE — the basic mode stays playable", () => {
    // "Only one Terror Frenzy at superior each combat" must not restrict
    // the basic mode, which carries no such clause.
    const { engine } = combat();
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Terror Frenzy:superior:M:tf1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    const ids = dp.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Terror Frenzy:superior"))).toBe(false);
    expect(ids.some((i) => i.startsWith("play:Terror Frenzy:basic"))).toBe(true);
  });
});

describe("Ensnare a Beast (102319)", () => {
  it("surcharges the acting minion's STRIKE cards in the resulting combat", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { pot: "superior" }, blood: 4, strength: 1 });
    Object.assign(find(state, "M"), { disciplines: { ani: "superior" }, blood: 4 });
    state.seats[1]!.hand.push({ id: "eab", name: "Ensnare a Beast" });
    state.seats[0]!.hand.push({ id: "slam", name: "Slam" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"], // +1 inherent stealth, so intercept is needed
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"], // attempt first: an intercept
      // card is only legal once a block attempt is underway (p. 26).
      ["Alice", "pass"],
      ["Bob", "play:Ensnare a Beast:superior:M:eab"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt resolves
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ]);

    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", "play:Slam:basic:V1:slam"]]);
    // Slam is printed at 1 blood; the rider makes it 2.
    expect(find(state, "V1").blood).toBe(before - 2);
  });

  it("basic mode grants no such rider", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { pot: "superior" }, blood: 4, strength: 1 });
    Object.assign(find(state, "M"), { disciplines: { ani: "superior" }, blood: 4 });
    state.seats[1]!.hand.push({ id: "eab", name: "Ensnare a Beast" });
    state.seats[0]!.hand.push({ id: "slam", name: "Slam" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"],
      ["Bob", "play:Ensnare a Beast:basic:M:eab"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const before = find(state, "V1").blood;
    runTrace(engine, [["Alice", "play:Slam:basic:V1:slam"]]);
    expect(find(state, "V1").blood).toBe(before - 1); // printed cost
  });
});
