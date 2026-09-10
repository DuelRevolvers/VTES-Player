/**
 * Legacy cost-modifier masters — tranche 3 wave 8
 * (docs/pool-widening-design.md §6).
 *
 * Therbold Realty, Centralized Background Check, Bureaucratic Overload,
 * and the four Path masters.
 *
 * THE QUESTION THAT MATTERS is WHOSE cost each one changes. A seat-level
 * modifier reaches every Methuselah unless it says otherwise, so
 * "locations cost YOU 1 less" and "weapons cost an additional pool" are
 * different scopes written in almost the same words. Getting it backwards
 * charges the wrong table and nothing throws.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, playCostFor } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [101968, "Therbold Realty"],
  [100315, "Centralized Background Check"],
  [100269, "Bureaucratic Overload"],
  [101364, "The Path of Metamorphosis"],
  [101365, "The Path of Night"],
  [101366, "The Path of Paradox"],
  [101373, "The Path of Typhon"],
];

/** Put a spec-compiled master in play at seat level, statics and all. */
function inPlay(state: GameState, seatIndex: number, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`${name} has no handler — is it in supported.json?`);
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  state.seats[seatIndex]!.permanents.push(p);
  return p;
}

/** What `name` costs `seat` to play, in pool and blood.
 *
 *  Built from the compiled handler so the card's real types, tags and
 *  requirements reach the modifier filters — a hand-written PricedCard
 *  would let a tag filter pass by matching nothing. */
function cost(state: GameState, seat: string, name: string): { pool: number; blood: number } {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler for ${name}`);
  const priced = {
    name,
    bloodCost: h.bloodCost ?? 0,
    poolCost: h.poolCost ?? 0,
    types: typeof h.costTypes === "function" ? h.costTypes("basic") : (h.costTypes ?? []),
    requires: h.requiresDisciplines?.("basic") ?? [],
    requiresClans: typeof h.requiresClans === "function" ? h.requiresClans() : (h.requiresClans ?? []),
    tags: h.permanentTags ?? [],
  };
  return playCostFor(state, priced, null, null, null, null, seat);
}

describe("scope: whose cost changes", () => {
  it("Therbold Realty (101968) discounts locations for its CONTROLLER only", () => {
    const state = threeSeatGame();
    const before = cost(state, "Alice", "Elder Library").pool;
    inPlay(state, 0, "tr", "Therbold Realty");
    expect(cost(state, "Alice", "Elder Library").pool).toBe(before - 1);
    // NEGATIVE SPACE: the seat-level default is EVERYONE, so this line is
    // what `controllerOnly` is actually doing.
    expect(cost(state, "Bob", "Elder Library").pool).toBe(before);
  });

  it("Centralized Background Check (100315) taxes weapons for EVERYONE", () => {
    // The mirror. No "you" on the card, so its own controller pays too —
    // and that is the half a careless `controllerOnly` would lose.
    const state = threeSeatGame();
    const before = cost(state, "Bob", "Desert Eagle").pool;
    inPlay(state, 0, "cbc", "Centralized Background Check");
    expect(cost(state, "Bob", "Desert Eagle").pool).toBe(before + 1);
    expect(cost(state, "Alice", "Desert Eagle").pool).toBe(before + 1);
  });

  it("…and it taxes WEAPONS, not equipment at large", () => {
    // The tag filter. Laptop Computer is equipment with no weapon tag.
    const state = threeSeatGame();
    const before = cost(state, "Alice", "Laptop Computer").pool;
    inPlay(state, 0, "cbc", "Centralized Background Check");
    expect(cost(state, "Alice", "Laptop Computer").pool).toBe(before);
  });

  it("Bureaucratic Overload (100269) taxes political actions in BLOOD", () => {
    const state = threeSeatGame();
    const before = cost(state, "Bob", "Anarchist Uprising").blood;
    inPlay(state, 0, "bo", "Bureaucratic Overload");
    expect(cost(state, "Bob", "Anarchist Uprising").blood).toBe(before + 1);
    // …and leaves an ordinary action alone.
    const act = cost(state, "Bob", "Govern the Unaligned");
    inPlay(state, 1, "bo2", "Bureaucratic Overload");
    expect(cost(state, "Bob", "Govern the Unaligned")).toEqual(act);
  });
});

describe("the Path masters", () => {
  const PATHS: Array<[string, string]> = [
    ["The Path of Metamorphosis", "Tzimisce"],
    ["The Path of Night", "Lasombra"],
    ["The Path of Paradox", "Ravnos"],
    ["The Path of Typhon", "Ministry"],
  ];

  for (const [name, clan] of PATHS) {
    it(`${name} names ${clan}, a clan that EXISTS in this pool`, () => {
      // The Wall Street Night precedent cuts one way only: a discount for
      // a discipline nothing requires is fine, because the card still
      // does what it prints. A discount for a clan no vampire has would
      // be the "Assamite" bug — a filter that can never match anyone.
      const clans = new Set(
        Object.values((registry as unknown as CardRegistry).entries)
          .map((e) => e.card)
          .filter((c) => c.kind === "crypt")
          .map((c) => c.clan),
      );
      expect(clans.size).toBeGreaterThan(5); // the check is not vacuous
      expect(clans.has(clan)).toBe(true);
      expect(testRegistry[name]?.permanentStatics?.playCostMod?.requiresClan).toEqual([clan]);
    });
  }

  it("any minion can burn one as a Ⓓ action", () => {
    const state = threeSeatGame();
    inPlay(state, 0, "pn", "The Path of Night"); // ALICE's card
    const engine = new VtesEngine(state, testRegistry);
    // Bob's turn is not live here; Alice's own minion may take it too —
    // the card says "any minion", with no "another Methuselah".
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.includes("The Path of Night"))).toBe(true);
  });

  it("burning it costs the ACTING VAMPIRE 1 damage", () => {
    // The one new knob in this wave. The damage is queued through
    // `damageAfterAction`, so it lands after the action resolves.
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 3;
    inPlay(state, 0, "pn", "The Path of Night");
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine.decision()!.options.find((o) => o.id.includes("The Path of Night"));
    expect(opt).toBeDefined();
    runTrace(engine, [
      ["Alice", opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(state.seats[0]!.permanents.map((p) => p.card.id)).not.toContain("pn");
    expect(
      state.eventLog.some((e) => e.type === "DamageInflicted" && e.minion === v1.id),
    ).toBe(true);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all seven are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
