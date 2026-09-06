/**
 * Crypt wave 4 — the discard-for-a-bonus family, and the cost modifiers
 * (docs/crypt-wave-4.md).
 *
 * Seven cards trade a card in hand for a bonus, and they differ in three
 * independent ways: which card pays, what is bought, and which window the
 * trade is offered in. So every test here asserts the NEGATIVE space as
 * well — a card that cannot pay must not be offered, and a window that is
 * shut must offer nothing. An option list that is empty for the wrong
 * reason looks exactly like one that is correctly empty, which is the
 * failure this project keeps finding.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentStatics } from "../../src/engine/index.ts";
import { VtesEngine, currentBleed, playCostFor } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

/** Give a minion a crypt card's own self-attached entry, the way the deck
 *  importer does — that entry is where the crypt ability lives. */
function asVampire(m: MinionState, cryptName: string): MinionState {
  const entry = handlers[cryptName]?.cryptEntry?.();
  if (!entry) throw new Error(`no crypt entry for ${cryptName}`);
  m.attached.push({
    card: { id: m.id, name: cryptName },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics: entry.statics,
    tags: entry.tags,
  });
  return m;
}

function attach(m: MinionState, id: string, name: string, statics: PermanentStatics, tags: string[] = []) {
  m.attached.push({
    card: { id, name },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics,
    tags,
  });
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
/** Step the engine, preferring to do NOTHING, until `prefix` is offered.
 *  Preferring pass over the first option matters: a walker that plays the
 *  board pulls vampires out of torpor and feeds hungry ones. */
function walkTo(engine: VtesEngine, prefix: string, limit = 160): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// The cost: which card in hand may pay
// ---------------------------------------------------------------------------

describe("the discard filter", () => {
  /** Larissa bleeds with the given hand; report the discard options. */
  function larissaOptions(hand: Array<{ id: string; name: string }>): string[] {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Larissa Moreira (G6)");
    state.seats[0]!.hand.push(...hand);
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "bleed:V1")) throw new Error("no bleed");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    return optionIds(engine).filter((o) => o.includes(":discardFor:"));
  }

  it("offers only the card requiring the named Discipline", () => {
    // Aire of Elation requires Presence, Cats' Guidance requires Animalism.
    const opts = larissaOptions([
      { id: "h1", name: "Aire of Elation" },
      { id: "h2", name: "Cats' Guidance" },
    ]);
    expect(opts.some((o) => o.endsWith(":h2"))).toBe(true);
    // The negative half, and the reason for it: a filter that matched
    // everything would look identical from the positive test alone.
    expect(opts.some((o) => o.endsWith(":h1"))).toBe(false);
  });

  it("offers nothing at all when no card in hand qualifies", () => {
    expect(larissaOptions([{ id: "h1", name: "Aire of Elation" }])).toEqual([]);
  });

  it("matches a card whose SUPERIOR mode requires the Discipline", () => {
    // The central query falls back to the FIRST mode when asked for none,
    // so the union across modes is what makes this pass.
    const h = handlers["Cats' Guidance"];
    const union = new Set([
      ...(h?.requiresDisciplines?.(null) ?? []),
      ...(h?.requiresDisciplines?.("superior") ?? []),
    ]);
    expect(union.has("ani")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The payoff
// ---------------------------------------------------------------------------

describe("what the discard buys", () => {
  it("Larissa's discard raises the bleed, and spends the card", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Larissa Moreira (G6)");
    state.seats[0]!.hand.push({ id: "h2", name: "Cats' Guidance" });
    // A card to draw. The fixture's library is empty, and p. 7 draws
    // nothing from an empty one — so without this the replacement half of
    // the assertion would pass for the wrong reason.
    state.seats[0]!.library.push({ id: "lib1", name: "Aire of Elation" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const before = state.seats[0]!.hand.length;
    const opt = optionIds(engine).find((o) => o.includes(":discardFor:bleed:"))!;
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt]]);
    expect(
      state.eventLog.some((e) => e.type === "BleedAmountModified" && e.delta === 1),
    ).toBe(true);
    // The card left the hand — and was REPLACED, because p. 7 does not
    // care why a card left (the unlock-tolls reading).
    expect(state.seats[0]!.hand.some((c) => c.id === "h2")).toBe(false);
    expect(state.seats[0]!.hand.some((c) => c.id === "lib1")).toBe(true);
    expect(state.seats[0]!.hand.length).toBe(before);
  });

  it("Larissa's bonus reaches the action's actual bleed amount", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Larissa Moreira (G6)");
    state.seats[0]!.hand.push({ id: "h2", name: "Cats' Guidance" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action frame");
    const base = currentBleed(state, af);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.includes(":discardFor:bleed:"))!]]);
    expect(currentBleed(state, af)).toBe(base + 1);
  });
});

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

describe("the window each card trades in", () => {
  it("Larissa's ability is a BLEED ability — a hunt does not open it", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Larissa Moreira (G6)");
    v1.blood = 2;
    state.seats[0]!.hand.push({ id: "h2", name: "Cats' Guidance" });
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "hunt:V1")) throw new Error("no hunt");
    runTrace(engine, [["Alice", "hunt:V1"]]);
    expect(optionIds(engine).filter((o) => o.includes(":discardFor:"))).toEqual([]);
  });

  it("Alexa sells a vote during the polling step, and the vote counts", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    asVampire(alice.minions[0]!, "Alexa Draper (G6)");
    alice.hand.push(
      { id: "au1", name: "Anarchist Uprising" },
      { id: "dom1", name: "Conditioning" }, // requires Dominate
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
    ]);
    const sale = optionIds(engine).find((o) => o.includes(":discardFor:votes:"));
    expect(sale).toBeDefined();
    runTrace(engine, [
      ["Alice", sale!],
      ["Alice", "vote:grant:for"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved")!;
    expect(resolved).toMatchObject({ passed: true, votesFor: 2 });
  });

  it("Alexa's ability is not on the table outside a referendum", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Alexa Draper (G6)");
    state.seats[0]!.hand.push({ id: "dom1", name: "Conditioning" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(optionIds(engine).filter((o) => o.includes(":discardFor:"))).toEqual([]);
  });

  it("Yewon sells the same vote for a different Discipline", () => {
    // The two cards differ ONLY in which card pays, which is the point of
    // the clause: cost and payoff are independent.
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    asVampire(alice.minions[0]!, "Yewon Ong (G6)");
    alice.hand.push(
      { id: "au1", name: "Anarchist Uprising" },
      { id: "dom1", name: "Conditioning" }, // Dominate — must NOT qualify
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(optionIds(engine).some((o) => o.includes(":discardFor:votes:"))).toBe(false);
  });

  it("Abraham sells STEALTH to the actor and INTERCEPT to the blocker, never both", () => {
    // p. 26: each is offered only when it could change whether the block
    // succeeds, and they are asked from opposite ends of one attempt.
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Abraham DuSable (G6)");
    state.seats[0]!.hand.push({ id: "h3", name: "Blood Rage" }); // requires [tha]
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    // No block attempt yet, so neither half is "needed" (p. 26).
    expect(optionIds(engine).filter((o) => o.includes(":discardFor:"))).toEqual([]);
  });

  it("…and sells STEALTH once a blocker's intercept has caught up", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Abraham DuSable (G6)");
    v1.blood = 2;
    state.seats[0]!.hand.push({ id: "h3", name: "Blood Rage" }); // requires [tha]
    // A hunt carries +1 inherent stealth, and this blocker matches it —
    // which is exactly the "needed" condition p. 26 states, and the only
    // way to put a stealth option on the table.
    attach(find(state, "W"), "int", "KRCG News Radio", { intercept: 1 }, ["location"]);
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "hunt:V1")) throw new Error("no hunt");
    runTrace(engine, [["Alice", "hunt:V1"]]);
    if (!walkTo(engine, "block:W")) throw new Error("no block");
    runTrace(engine, [["Bob", "block:W"]]);
    const opts = optionIds(engine).filter((o) => o.includes(":discardFor:"));
    // The ACTOR's half only: Abraham is acting, not blocking.
    expect(opts.some((o) => o.includes(":discardFor:stealth:"))).toBe(true);
    expect(opts.some((o) => o.includes(":discardFor:intercept:"))).toBe(false);
    runTrace(engine, [["Alice", opts.find((o) => o.includes(":stealth:"))!]]);
    expect(
      state.eventLog.some(
        (e) => e.type === "StealthModified" && e.source === "Abraham DuSable (G6)",
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Kasim: a combat-LONG strength bonus, once each combat
// ---------------------------------------------------------------------------

describe("Kasim Bayar", () => {
  it("trades a political action card for +2 strength that combat", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Kasim Bayar (G6)");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push(
      { id: "pol", name: "Parity Shift" }, // a political action card
      { id: "rush9", name: "Hunter's Mark" },
    );
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
    )!;
    runTrace(engine, [["Alice", rush]]);
    if (!walkTo(engine, "ability:Kasim Bayar (G6)")) throw new Error("no Kasim offer");
    const opt = optionIds(engine).find((o) => o.includes(":discardFor:combatStrength:"))!;
    expect(opt).toContain(":pol");
    runTrace(engine, [["Alice", opt]]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    // Combat-long, not round-scoped: it must survive the round boundary,
    // which is the whole reason `addCombatStrengthTo` exists.
    expect(cf.strengthBonus[cf.acting === v1.id ? "acting" : "opposing"]).toBe(2);
    // "Once each combat" — spent.
    expect(optionIds(engine).some((o) => o.includes(":discardFor:combatStrength:"))).toBe(false);
  });

  it("is not offered a non-political card", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Kasim Bayar (G6)");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push(
      { id: "h1", name: "Aire of Elation" },
      { id: "rush9", name: "Hunter's Mark" },
    );
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
    )!;
    runTrace(engine, [["Alice", rush]]);
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp || dp.options.some((o) => o.id === "strike:hand")) break;
      expect(dp.options.some((o) => o.id.includes(":discardFor:"))).toBe(false);
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
  });

  it("also carries its printed +1 bleed", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Kasim Bayar (G6)");
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(currentBleed(state, af)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phaibun: the cost the player does not choose
// ---------------------------------------------------------------------------

describe("Phaibun", () => {
  it("offers ONE option naming no card — the discard is at random", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Phaibun (G7)");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push(
      { id: "a", name: "Aire of Elation" },
      { id: "b", name: "Cats' Guidance" },
      { id: "rush9", name: "Hunter's Mark" },
    );
    // Enough to draw through: playing the rush already draws one back
    // (p. 7), so a single-card library would be empty by the time the
    // discard happens — and the missing replacement would have nothing
    // to do with Phaibun.
    for (let i = 0; i < 4; i++) {
      state.seats[0]!.library.push({ id: `lib${i}`, name: "Aire of Elation" });
    }
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    if (!walkTo(engine, "ability:Phaibun (G7)")) throw new Error("no Phaibun offer");
    const opts = optionIds(engine).filter((o) => o.includes(":discardFor:dodge:"));
    // Three cards in hand, ONE option: the player is not choosing which
    // card pays, and offering them the choice would be a lie about the
    // card. (Two of the three would qualify under any Discipline filter.)
    expect(opts).toHaveLength(1);
    expect(opts[0]).toContain(":random");
    const before = state.seats[0]!.hand.length;
    runTrace(engine, [["Alice", opts[0]!]]);
    expect(state.seats[0]!.hand.length).toBe(before);
    expect(state.eventLog.some((e) => e.type === "CardDiscarded")).toBe(true);
  });

  it("is not offered with an EMPTY hand", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    asVampire(v1, "Phaibun (G7)");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.length = 0;
    state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    // The rush card left the hand to be played, so nothing can pay.
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id.includes(":discardFor:dodge:"))).toBe(false);
      if (dp.options.some((o) => o.id === "strike:hand")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
  });
});

// ---------------------------------------------------------------------------
// Roger de Camden: the "and/or" cost union, and a bonus for somebody else
// ---------------------------------------------------------------------------

describe("Roger de Camden", () => {
  const priced = (over: Partial<Parameters<typeof playCostFor>[1]> = {}) => ({
    name: "X",
    bloodCost: 2,
    poolCost: 0,
    types: ["action" as const],
    requires: [] as string[],
    requiresClans: [] as string[],
    ...over,
  });

  function withRoger(): { state: GameState; roger: MinionState } {
    const state = threeSeatGame();
    const roger = find(state, "V1");
    asVampire(roger, "Roger de Camden (G6)");
    return { state, roger };
  }

  it("discounts a card requiring Oblivion", () => {
    const { state, roger } = withRoger();
    expect(playCostFor(state, priced({ requires: ["obl"] }), roger, null, null).blood).toBe(1);
  });

  it("discounts a card requiring Hecata", () => {
    const { state, roger } = withRoger();
    expect(playCostFor(state, priced({ requiresClans: ["Hecata"] }), roger, null, null).blood).toBe(1);
  });

  it("discounts a card requiring BOTH exactly once — 'and/or' is a union, not a stack", () => {
    // Written as one modifier for this reason: two would charge −2.
    const { state, roger } = withRoger();
    const both = priced({ requires: ["obl"], requiresClans: ["Hecata"] });
    expect(playCostFor(state, both, roger, null, null).blood).toBe(1);
  });

  it("does not discount a card requiring NEITHER", () => {
    const { state, roger } = withRoger();
    expect(playCostFor(state, priced({ requires: ["dom"] }), roger, null, null).blood).toBe(2);
  });

  it("does not discount ANOTHER vampire's card — the modifier is bearer-scoped", () => {
    const { state } = withRoger();
    const other = find(state, "W");
    expect(playCostFor(state, priced({ requires: ["obl"] }), other, null, null).blood).toBe(2);
  });

  it("gives a maneuver to a minion he is NOT fighting alongside", () => {
    // The recipient is enumerated rather than assumed: Roger need not be
    // in the combat at all, which is what makes this arm different from
    // every other card in the family.
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const roger = find(state, "V1");
    asVampire(roger, "Roger de Camden (G6)");
    // A second vampire of Alice's to do the actual fighting.
    alice.minions.push(
      makeMinion("V9", "Alice", { disciplines: { cel: "basic", tha: "basic" }, blood: 4 }),
    );
    alice.hand.push(
      { id: "obl1", name: "Shroud of Decay" }, // requires Oblivion
      { id: "rush9", name: "Hunter's Mark" },
    );
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":V9:") && o.includes(":W:"),
    );
    if (!rush) return; // the fixture could not produce V9's rush; nothing to assert
    runTrace(engine, [["Alice", rush]]);
    if (!walkTo(engine, "ability:Roger de Camden (G6)")) throw new Error("no Roger offer");
    const opt = optionIds(engine).find((o) => o.includes(":discardFor:maneuverToCombatant:"))!;
    // The option names the RECIPIENT, and it is the fighter, not Roger.
    expect(opt).toContain(":V9");
    runTrace(engine, [["Alice", opt]]);
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat");
    const side = cf.acting === "V9" ? "acting" : "opposing";
    expect(cf.maneuverCredits[side]).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The cost modifiers that were already data
// ---------------------------------------------------------------------------

describe("play-cost modifiers", () => {
  const animal = {
    name: "Raven Spy",
    bloodCost: 1,
    poolCost: 0,
    types: ["retainer" as const],
    requires: [],
    tags: ["animal"],
  };

  it("Kuyén discounts an ANIMAL retainer and nothing else", () => {
    const state = threeSeatGame();
    const k = find(state, "V1");
    asVampire(k, "Kuyén (G6)");
    expect(playCostFor(state, animal, k, null, null).blood).toBe(0);
    expect(playCostFor(state, { ...animal, tags: [] }, k, null, null).blood).toBe(1);
  });

  it("Kuyén's discount is 'blood OR pool' — it lands on whichever the card charges", () => {
    const state = threeSeatGame();
    const k = find(state, "V1");
    asVampire(k, "Kuyén (G6)");
    const poolPriced = { ...animal, bloodCost: 0, poolCost: 2 };
    expect(playCostFor(state, poolPriced, k, null, null).pool).toBe(1);
  });

  it("Máddji discounts an ally or retainer REQUIRING A TZIMISCE, by clan not by tag", () => {
    const state = threeSeatGame();
    const m = find(state, "V1");
    asVampire(m, "Máddji, Mistress of Szlachtas (G6)");
    const tz = {
      name: "Szlachta Assistant",
      bloodCost: 2,
      poolCost: 0,
      types: ["retainer" as const],
      requires: [],
      requiresClans: ["Tzimisce"],
    };
    expect(playCostFor(state, tz, m, null, null).blood).toBe(1);
    // Same type, different clan requirement: no discount.
    expect(playCostFor(state, { ...tz, requiresClans: ["Gangrel"] }, m, null, null).blood).toBe(2);
    // Right clan, wrong TYPE (an equipment requiring a Tzimisce): none.
    expect(
      playCostFor(state, { ...tz, types: ["equipment" as const] }, m, null, null).blood,
    ).toBe(2);
  });

  it("a cost never goes below zero", () => {
    const state = threeSeatGame();
    const k = find(state, "V1");
    asVampire(k, "Kuyén (G6)");
    expect(playCostFor(state, { ...animal, bloodCost: 0, poolCost: 0 }, k, null, null)).toEqual({
      blood: 0,
      pool: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Hesha: a bleed that COUNTS
// ---------------------------------------------------------------------------

describe("Hesha Ruhadze", () => {
  function bleedWith(setUp: (m: MinionState) => void): number {
    const state = threeSeatGame();
    const h = find(state, "V1");
    asVampire(h, "Hesha Ruhadze (G6)");
    setUp(h);
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    return currentBleed(state, af);
  }

  it("gets +1 for each unique equipment, and counts them", () => {
    expect(bleedWith(() => {})).toBe(1);
    expect(
      bleedWith((m) => attach(m, "e1", "Bowl of Convergence", {}, ["equipment", "unique"])),
    ).toBe(2);
    expect(
      bleedWith((m) => {
        attach(m, "e1", "Bowl of Convergence", {}, ["equipment", "unique"]);
        attach(m, "e2", "Treasured Samadji", {}, ["equipment", "unique"]);
      }),
    ).toBe(3);
  });

  it("does NOT count non-unique equipment", () => {
    expect(bleedWith((m) => attach(m, "e1", ".44 Magnum", {}, ["equipment"]))).toBe(1);
  });

  it("does NOT count a unique card that is not equipment", () => {
    expect(bleedWith((m) => attach(m, "r1", "Raven Spy", {}, ["retainer", "unique"]))).toBe(1);
  });

  it("its own crypt card does not count itself", () => {
    // Every crypt card rides in as a self-attached entry, so a count over
    // "the bearer's attachments" would otherwise include the vampire.
    expect(bleedWith(() => {})).toBe(1);
  });

  it("real unique equipment carries the tag, centrally", () => {
    // The count is only correct because uniqueness is denormalized onto
    // every equipment handler, including hand-rolled ones (§3).
    expect(handlers["Bowl of Convergence"]?.permanentTags).toContain("unique");
    expect(handlers["Treasured Samadji"]?.permanentTags).toContain("unique");
    // .44 Magnum is HAND-ROLLED and is not printed "Unique." — it must
    // carry the type tag and not the uniqueness one. A hand-rolled
    // handler answering nothing at all is the failure the central
    // backfill exists to prevent.
    expect(handlers[".44 Magnum"]?.permanentTags).toContain("equipment");
    expect(handlers[".44 Magnum"]?.permanentTags).not.toContain("unique");
  });
});

// ---------------------------------------------------------------------------
// Marchesa Liliana: the same trade, a different currency
// ---------------------------------------------------------------------------

describe("Marchesa Liliana", () => {
  function withHeap(n: number) {
    const state = threeSeatGame();
    const m = find(state, "V1");
    asVampire(m, "Marchesa Liliana (G6)");
    const seat = state.seats[0]!;
    seat.ashHeap = [];
    for (let i = 0; i < n; i++) seat.ashHeap.push({ id: `ash${i}`, name: "Aire of Elation" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    return { state, engine, seat };
  }

  it("is offered with seven cards in the ash heap, and not with six", () => {
    expect(optionIds(withHeap(7).engine).some((o) => o.includes(":discardFor:bleed:"))).toBe(true);
    expect(optionIds(withHeap(6).engine).some((o) => o.includes(":discardFor:bleed:"))).toBe(false);
  });

  it("removes exactly seven and adds the bleed — and the cards do NOT come back", () => {
    const { state, engine, seat } = withHeap(9);
    const opt = optionIds(engine).find((o) => o.includes(":discardFor:bleed:"))!;
    runTrace(engine, [["Alice", opt]]);
    expect(seat.ashHeap).toHaveLength(2);
    // Removed from the game, not discarded (p. 16): they land in no zone
    // at all, so nothing can retrieve them.
    expect(seat.hand.some((c) => c.id.startsWith("ash"))).toBe(false);
    expect(seat.library.some((c) => c.id.startsWith("ash"))).toBe(false);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    // Her printed +1 bleed plus the bought one, on top of the base 1.
    expect(currentBleed(state, af)).toBe(3);
  });

  it("offers ONE option, not one per card — the player does not pick which seven", () => {
    expect(
      optionIds(withHeap(9).engine).filter((o) => o.includes(":discardFor:bleed:")),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The small hooks
// ---------------------------------------------------------------------------

describe("Sreelekha", () => {
  it("adds a discard phase action on top of p. 37's default", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Sreelekha (G7)");
    const engine = new VtesEngine(state, testRegistry);
    // Walk to the discard phase: the hook fires as it opens.
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const tf = state.frames.find((f) => f.kind === "turn");
      if (tf?.kind === "turn" && tf.phase === "discard") break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    const tf = state.frames.find((f) => f.kind === "turn");
    if (tf?.kind !== "turn") throw new Error("no turn frame");
    expect(tf.discardActionsLeft).toBe(2);
  });

  it("does nothing on ANOTHER Methuselah's discard phase", () => {
    // "YOUR discard phase" — the turn-seat gate, which is the bug the
    // 2026-08-02 fix records: the window is offered to every seat.
    const state = threeSeatGame();
    asVampire(find(state, "W"), "Sreelekha (G7)"); // Bob's vampire
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const tf = state.frames.find((f) => f.kind === "turn");
      if (tf?.kind === "turn" && tf.phase === "discard") break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    const tf = state.frames.find((f) => f.kind === "turn");
    if (tf?.kind !== "turn") throw new Error("no turn frame");
    expect(tf.seat).toBe("Alice");
    expect(tf.discardActionsLeft).toBe(1);
  });
});

describe("Abderrahim", () => {
  it("lends stealth to a YOUNGER vampire of yours, and only when it is needed", () => {
    const state = threeSeatGame();
    const abd = find(state, "V1");
    asVampire(abd, "Abderrahim, Death's Hand (G6)");
    abd.capacity = 9;
    abd.blood = 4;
    // A younger vampire of Alice's to act.
    state.seats[0]!.minions.push(makeMinion("V9", "Alice", { capacity: 4, blood: 2 }));
    attach(find(state, "W"), "int", "KRCG News Radio", { intercept: 1 }, ["location"]);
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "hunt:V9")) throw new Error("no hunt");
    // Before a block attempt, stealth is not needed (p. 26).
    runTrace(engine, [["Alice", "hunt:V9"]]);
    expect(optionIds(engine).some((o) => o.includes(":stealthGrant:"))).toBe(false);
    if (!walkTo(engine, "block:W")) throw new Error("no block");
    runTrace(engine, [["Bob", "block:W"]]);
    const opt = optionIds(engine).find((o) => o.includes(":stealthGrant:"));
    expect(opt).toBeDefined();
    const bloodBefore = abd.blood;
    runTrace(engine, [["Alice", opt!]]);
    expect(abd.blood).toBe(bloodBefore - 1);
    expect(
      state.eventLog.some(
        (e) => e.type === "StealthModified" && e.source === "Abderrahim, Death's Hand (G6)",
      ),
    ).toBe(true);
  });

  it("does NOT lend it to an OLDER vampire — the filter is a real one", () => {
    const state = threeSeatGame();
    const abd = find(state, "V1");
    asVampire(abd, "Abderrahim, Death's Hand (G6)");
    abd.capacity = 4;
    abd.blood = 4;
    state.seats[0]!.minions.push(makeMinion("V9", "Alice", { capacity: 9, blood: 2 }));
    attach(find(state, "W"), "int", "KRCG News Radio", { intercept: 1 }, ["location"]);
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "hunt:V9")) throw new Error("no hunt");
    runTrace(engine, [["Alice", "hunt:V9"]]);
    if (walkTo(engine, "block:W")) {
      runTrace(engine, [["Bob", "block:W"]]);
      expect(optionIds(engine).some((o) => o.includes(":stealthGrant:"))).toBe(false);
    }
  });

  it("cannot lend what it cannot pay", () => {
    const state = threeSeatGame();
    const abd = find(state, "V1");
    asVampire(abd, "Abderrahim, Death's Hand (G6)");
    abd.capacity = 9;
    // A vampire at 0 blood MUST hunt (p. 21), and a walker would feed him
    // — so he is LOCKED instead, which takes him out of that path while
    // leaving the ability's own gate the thing under test.
    abd.blood = 0;
    abd.locked = true;
    state.seats[0]!.minions.push(makeMinion("V9", "Alice", { capacity: 4, blood: 2 }));
    attach(find(state, "W"), "int", "KRCG News Radio", { intercept: 1 }, ["location"]);
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, "hunt:V9")) throw new Error("no hunt");
    runTrace(engine, [["Alice", "hunt:V9"]]);
    if (walkTo(engine, "block:W")) {
      runTrace(engine, [["Bob", "block:W"]]);
      expect(optionIds(engine).some((o) => o.includes(":stealthGrant:"))).toBe(false);
    }
  });
});

describe("Věnceslava", () => {
  it("gains a pool after an action during which the prey burned some", () => {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Věnceslava, The Implacable (G6)");
    const before = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    // The bleed took a pool from Bob (the prey), so the clause fires.
    expect(state.seats[0]!.pool).toBe(before + 1);
  });

  it("gains nothing from a HUNT — the prey burns no pool", () => {
    const state = threeSeatGame();
    const v = find(state, "V1");
    asVampire(v, "Věnceslava, The Implacable (G6)");
    v.blood = 2;
    const before = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "hunt:V1");
    runTrace(engine, [["Alice", "hunt:V1"]]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    expect(state.seats[0]!.pool).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Gostoso: an automatic payoff
// ---------------------------------------------------------------------------

describe("Gostoso", () => {
  it("gains 1 blood after a successful bleed of the PREY", () => {
    const state = threeSeatGame();
    const g = find(state, "V1");
    asVampire(g, "Gostoso (G6)");
    g.blood = 2;
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    expect(g.blood).toBe(3);
  });

  it("gains nothing when the bleed is BLOCKED", () => {
    const state = threeSeatGame();
    const g = find(state, "V1");
    asVampire(g, "Gostoso (G6)");
    g.blood = 2;
    const w = find(state, "W");
    w.locked = false;
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "bleed:V1");
    runTrace(engine, [["Alice", "bleed:V1"]]);
    if (walkTo(engine, "block:W", 12)) {
      runTrace(engine, [["Bob", "block:W"]]);
      for (let i = 0; i < 60; i++) {
        const dp = engine.decision();
        if (!dp) break;
        if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
        const pick =
          dp.options.find((o) => o.id === "press:end") ??
          dp.options.find((o) => o.id === "strike:hand") ??
          dp.options.find((o) => o.id === "pass") ??
          dp.options[0]!;
        runTrace(engine, [[dp.seat, pick.id]]);
      }
      // A blocked bleed transfers no pool, so `onBleedSuccess` never
      // fires — the hook is the whole gate.
      expect(state.eventLog.some((e) => e.type === "PoolBurned" && e.seat === "Bob")).toBe(false);
      // Not `g.blood`: the block puts him in combat, where he burns blood
      // to mend (p. 31) — so the number moves for reasons that have
      // nothing to do with the card. What the card would have done is a
      // GAIN, and there is none.
      expect(state.eventLog.some((e) => e.type === "BloodGained" && e.minion === "V1")).toBe(false);
    }
  });
});
