/**
 * Counters that pay a card's cost (docs/cost-sources-design.md) — Ravnos
 * Carnival (101553) and Ravnos Cache (101552). The split is chosen at
 * announcement, as an extra play option per affordable way of paying, and
 * spent at resolution with the rest of the cost (p. 27), so a blocked
 * action spends nothing.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's master phase with one master action and `cards` in her hand. */
function mastersPhase(...cards: Array<{ id: string; name: string }>): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  state.seats[0]!.hand.push(...cards);
  return state;
}

/** Alice's minion phase, with a stocked cost source already in play. */
function withSource(
  cardId: string,
  name: string,
  counters: number,
  source: PermanentInPlay["costSource"],
  locked = false,
): GameState {
  const state = threeSeatGame();
  state.seats[0]!.permanents.push({
    card: { id: cardId, name },
    controller: "Alice",
    locked,
    usedThisPhase: false,
    statics: {},
    tags: ["location", name],
    counters,
    ...(source ? { costSource: source } : {}),
  });
  return state;
}

const carnivalSource = {
  pays: ["blood" as const],
  for: "action" as const,
  clan: "Ravnos",
  burnWhenEmpty: true,
};
const cacheSource = {
  pays: ["blood" as const, "pool" as const],
  for: "equipment" as const,
  locks: true,
};

function permanent(state: GameState, id: string): PermanentInPlay | undefined {
  return state.seats.flatMap((s) => s.permanents).find((p) => p.card.id === id);
}

// ---------------------------------------------------------------------------
// Ravnos Carnival — a Ravnos-only blood source for action cards
// ---------------------------------------------------------------------------

describe("Ravnos Carnival (101553)", () => {
  it("comes into play with 1 counter for each Ravnos you control", () => {
    const state = mastersPhase({ id: "rc", name: "Ravnos Carnival" });
    state.seats[0]!.minions[0]!.clan = "Ravnos";
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Ravnos" }));
    state.seats[0]!.minions.push(makeMinion("V3", "Alice", { clan: "Brujah" }));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Ravnos Carnival"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    expect(permanent(state, "rc")?.counters).toBe(2);
    expect(state.seats[0]!.pool).toBe(9); // 1 pool
  });

  it("burns on arrival when its player controls no Ravnos", () => {
    const state = mastersPhase({ id: "rc", name: "Ravnos Carnival" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Ravnos Carnival"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // "If this location has no counters, burn it" — true the moment it
    // arrives with none; the pool is spent either way.
    expect(permanent(state, "rc")).toBeUndefined();
    expect(state.seats[0]!.pool).toBe(9);
  });

  it("offers the counter as a way to pay, to a Ravnos only", () => {
    const state = withSource("rc", "Ravnos Carnival", 2, carnivalSource);
    state.seats[0]!.minions[0]!.clan = "Ravnos";
    state.seats[0]!.minions[0]!.disciplines["pot"] = "basic";
    state.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { clan: "Brujah", disciplines: { pot: "basic" } }),
    );
    state.seats[0]!.hand.push(
      { id: "ps1", name: "Preternatural Strength" },
      { id: "ps2", name: "Preternatural Strength" },
    );
    const dp = new VtesEngine(state, testRegistry).decision()!;

    // The Ravnos gets both ways of paying its 1 blood; the Brujah only
    // gets its own blood.
    expect(dp.options.some((o) => o.id === "play:Preternatural Strength:basic:V1:ps1")).toBe(
      true,
    );
    expect(
      dp.options.some((o) => o.id === "play:Preternatural Strength:basic:V1:rc/1/0:ps1"),
    ).toBe(true);
    expect(
      dp.options.some((o) => o.id === "play:Preternatural Strength:basic:V2:rc/1/0:ps1"),
    ).toBe(false);
  });

  it("lets a Ravnos play a card it could not afford alone, in either split", () => {
    const state = withSource("rc", "Ravnos Carnival", 2, carnivalSource);
    Object.assign(state.seats[0]!.minions[0]!, {
      clan: "Ravnos",
      blood: 1,
      disciplines: { pre: "basic" },
    });
    // Heart of the City costs 2 blood; the vampire has 1.
    state.seats[0]!.hand.push({ id: "hc", name: "Heart of the City" });
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "play:Heart of the City:basic:V1:hc")).toBe(false);
    // "Some or all": one counter and a blood, or both counters.
    expect(dp.options.some((o) => o.id === "play:Heart of the City:basic:V1:rc/1/0:hc")).toBe(
      true,
    );
    expect(dp.options.some((o) => o.id === "play:Heart of the City:basic:V1:rc/2/0:hc")).toBe(
      true,
    );
  });

  it("spends the counter at resolution, not at announcement", () => {
    const state = withSource("rc", "Ravnos Carnival", 2, carnivalSource);
    Object.assign(state.seats[0]!.minions[0]!, {
      clan: "Ravnos",
      blood: 3,
      disciplines: { pot: "basic" },
    });
    state.seats[0]!.hand.push({ id: "ps1", name: "Preternatural Strength" });
    const engine = new VtesEngine(state, testRegistry);

    engine.choose("play:Preternatural Strength:basic:V1:rc/1/0:ps1");
    expect(permanent(state, "rc")?.counters).toBe(2); // announced, not paid

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(permanent(state, "rc")?.counters).toBe(1);
    expect(state.seats[0]!.minions[0]!.blood).toBe(3); // no blood spent
  });

  it("spends nothing when the action is blocked", () => {
    const state = withSource("rc", "Ravnos Carnival", 1, carnivalSource);
    Object.assign(state.seats[0]!.minions[0]!, {
      clan: "Ravnos",
      blood: 3,
      disciplines: { pot: "basic" },
    });
    // Enough intercept on Bob's W that the block lands.
    state.seats[1]!.minions[0]!.attached.push({
      card: { id: "scope", name: "Scope" },
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 3 },
      tags: [],
    });
    state.seats[0]!.hand.push({ id: "ps1", name: "Preternatural Strength" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Preternatural Strength:basic:V1:rc/1/0:ps1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:W"], // W intercepts
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], // combat has begun
    ]);

    // A blocked action pays no cost at all (p. 27), so the counter — and
    // the location that would have burned with it — survive.
    expect(permanent(state, "rc")?.counters).toBe(1);
    expect(state.seats[0]!.minions[0]!.blood).toBe(3);
  });

  it("burns itself when the last counter goes", () => {
    const state = withSource("rc", "Ravnos Carnival", 1, carnivalSource);
    Object.assign(state.seats[0]!.minions[0]!, {
      clan: "Ravnos",
      blood: 3,
      disciplines: { pot: "basic" },
    });
    state.seats[0]!.hand.push({ id: "ps1", name: "Preternatural Strength" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Preternatural Strength:basic:V1:rc/1/0:ps1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(permanent(state, "rc")).toBeUndefined();
    expect(state.seats[0]!.minions[0]!.blood).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Ravnos Cache — pays equipment in blood or pool, and locking is the price
// ---------------------------------------------------------------------------

describe("Ravnos Cache (101552)", () => {
  it("trades 1 pool for 2 counters, once per master phase", () => {
    const state = mastersPhase();
    state.seats[0]!.permanents.push({
      card: { id: "cache", name: "Ravnos Cache" },
      controller: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location", "Ravnos Cache"],
      counters: 0,
      costSource: cacheSource,
    });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "ability:Ravnos Cache:cache:stock"]]);

    expect(permanent(state, "cache")?.counters).toBe(2);
    expect(state.seats[0]!.pool).toBe(9);
    // The p. 16 latch: not on offer a second time this phase.
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("ability:Ravnos Cache")),
    ).toBe(false);
  });

  it("is not offered during another Methuselah's master phase", () => {
    const state = mastersPhase();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push({
      card: { id: "cache", name: "Ravnos Cache" },
      controller: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location", "Ravnos Cache"],
      counters: 0,
      costSource: cacheSource,
    });
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("ability:Ravnos Cache"))).toBe(false);
  });

  it("pays an equip cost and locks the location doing it", () => {
    const state = withSource("cache", "Ravnos Cache", 3, cacheSource);
    state.seats[0]!.hand.push({ id: "bow", name: "Ivory Bow" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Ivory Bow:basic:V1:cache/0/1:bow"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    const cache = permanent(state, "cache")!;
    expect(cache.counters).toBe(2);
    expect(cache.locked).toBe(true); // "…can lock this location to use those counters"
    expect(state.seats[0]!.pool).toBe(10); // the 1 pool never left
    expect(
      state.seats[0]!.minions[0]!.attached.some((p) => p.card.name === "Ivory Bow"),
    ).toBe(true);
  });

  it("pays only some of a bigger cost", () => {
    const state = withSource("cache", "Ravnos Cache", 1, cacheSource);
    state.seats[0]!.hand.push({ id: "fang", name: "Kali's Fang" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Kali's Fang:basic:V1:cache/0/1:fang"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // 2 pool cost: 1 from the counter, 1 from the pool.
    expect(permanent(state, "cache")?.counters).toBe(0);
    expect(state.seats[0]!.pool).toBe(9);
  });

  it("offers nothing while locked, and never pays for an action card", () => {
    const locked = withSource("cache", "Ravnos Cache", 3, cacheSource, true);
    locked.seats[0]!.hand.push({ id: "bow", name: "Ivory Bow" });
    const dpLocked = new VtesEngine(locked, testRegistry).decision()!;
    expect(dpLocked.options.some((o) => o.id === "play:Ivory Bow:basic:V1:bow")).toBe(true);
    expect(dpLocked.options.some((o) => o.id.includes("cache/"))).toBe(false);

    // An action card is a different card type — the Cache pays equipment.
    const open = withSource("cache", "Ravnos Cache", 3, cacheSource);
    Object.assign(open.seats[0]!.minions[0]!, {
      clan: "Ravnos",
      disciplines: { pot: "basic" },
    });
    open.seats[0]!.hand.push({ id: "ps1", name: "Preternatural Strength" });
    const dpOpen = new VtesEngine(open, testRegistry).decision()!;
    expect(dpOpen.options.some((o) => o.id.includes("Preternatural"))).toBe(true);
    expect(
      dpOpen.options.some((o) => o.id.includes("Preternatural") && o.id.includes("cache/")),
    ).toBe(false);
  });
});
