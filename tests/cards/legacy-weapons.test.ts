/**
 * Legacy weapons — the first library cards admitted from outside the V5
 * sets (docs/pool-widening-design.md §6, tranche 3 wave 1).
 *
 * Fourteen equipment cards whose entire printed text is a strike. They are
 * here first because the weapon vocabulary already says almost all of it;
 * the one thing it could not say was "only usable once each combat/round",
 * which six of them print.
 *
 * TWO THINGS ARE UNDER TEST, and they fail in different ways:
 *
 *  - **The strikes.** A weapon whose damage is wrong is wrong silently —
 *    nothing throws, the combat just resolves at the wrong number. Hence a
 *    damage assertion per card rather than "it was offered".
 *  - **The admission.** These are the first cards to reach the pool
 *    through `widenedLibrary`, which is gated by `config/supported.json`
 *    alone. If that gate is ever loosened, the library fills with cards
 *    that make decks unplayable, so the last block pins the path they came
 *    in by.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import v5Sets from "../../config/v5-sets.json";

const WAVE: Array<[number, string]> = [
  [100529, "Desert Eagle"],
  [100130, "Bang Nakh — Tiger's Claws"],
  [100139, "Bastard Sword"],
  [101190, "Meat Cleaver"],
  [101715, "Sengir Dagger"],
  [100226, "Blow Torch"],
  [101682, "Saturday-Night Special"],
  [101891, "Submachine Gun"],
  [100317, "Chainsaw"],
  [100811, "Gas-Powered Chainsaw"],
  [101685, "Sawed-Off Shotgun"],
  [100246, "Brass Knuckles"],
  [100379, "Combat Shotgun"],
  [101168, "Mark V"],
];

// --- fixtures --------------------------------------------------------------

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

/** Equip a minion with a spec-compiled weapon, statics and tags and all. */
function equip(state: GameState, minion: string, id: string, name: string): void {
  const h = testRegistry[name];
  if (!h) throw new Error(`${name} is not in the registry — is it in supported.json?`);
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  find(state, minion).attached.push(p);
}

/** Alice's V1 bleeds, Bob's M blocks, combat live at the before-range
 *  window. The weapon goes on V1 — the ACTING side, which chooses its
 *  strike first, so nothing else has to be answered to reach it. */
function intoCombat(setup: (state: GameState) => void = () => {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: 5, strength: 1 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/** Answer everything cheaply until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 90): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Push the live combat into its second round on a granted press credit —
 *  the only way a "once each COMBAT" limit can be told apart from a "once
 *  each ROUND" one. */
function pressToRound2(engine: VtesEngine, state: GameState): void {
  const cf = combat(state);
  if (!cf) throw new Error("combat already over");
  cf.presses.acting = 1;
  const start = cf.round;
  for (let i = 0; i < 90; i++) {
    const live = combat(state);
    if (!live) throw new Error("combat ended before round 2");
    if (live.round > start) return;
    const dp = engine.decision();
    if (!dp) throw new Error("no decision while pressing");
    const pick =
      dp.options.find((o) => o.id === "press:continue") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  throw new Error("never reached round 2");
}

/** The damage `M` took from V1's weapon strike. */
function damageToM(state: GameState): { amount: number; aggravated: boolean } | undefined {
  const e = state.eventLog.find((x) => x.type === "DamageInflicted" && x.minion === "M");
  return e && e.type === "DamageInflicted"
    ? { amount: e.amount, aggravated: e.aggravated === true }
    : undefined;
}

// --- the strikes -----------------------------------------------------------

/** V1 has strength 1 throughout, so "strength+N" resolves to N+1. */
const STRIKES: Array<[string, number, boolean]> = [
  ["Desert Eagle", 2, false], //            2R
  ["Bang Nakh — Tiger's Claws", 3, false], // strength+2
  ["Bastard Sword", 2, false], //           strength+1
  ["Meat Cleaver", 2, false], //            strength+1
  ["Sengir Dagger", 1, true], //            strength, aggravated
  ["Blow Torch", 1, true], //               1 aggravated
  ["Saturday-Night Special", 1, false], //  1R
  ["Submachine Gun", 3, false], //          3R
  ["Chainsaw", 3, false], //                3
  ["Gas-Powered Chainsaw", 3, false], //    3
  ["Sawed-Off Shotgun", 3, false], //       3R
  ["Brass Knuckles", 2, false], //          strength+1
  ["Combat Shotgun", 3, false], //          3R
];

describe("legacy weapons — what each one hits for", () => {
  for (const [name, amount, aggravated] of STRIKES) {
    it(`${name}: ${amount}${aggravated ? " aggravated" : ""}`, () => {
      const { state, engine } = intoCombat((s) => equip(s, "V1", "w1", name));
      expect(walkTo(engine, `ability:${name}:w1:strike`)).toBe(true);
      runTrace(engine, [["Alice", `ability:${name}:w1:strike`]]);
      drain(engine, state);
      expect(damageToM(state)).toEqual({ amount, aggravated });
    });
  }

  it("Blow Torch is a FLAT 1, not strength+1 — a strong bearer changes nothing", () => {
    // The discriminating case for every fixed-damage weapon in the wave.
    // `damage: 1` and `damage: null, handBonus: 0` both read as "1" on a
    // strength-1 vampire, and only diverge on a strong one.
    const { state, engine } = intoCombat((s) => {
      find(s, "V1").strength = 4;
      equip(s, "V1", "bt", "Blow Torch");
    });
    expect(walkTo(engine, "ability:Blow Torch:bt:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Blow Torch:bt:strike"]]);
    drain(engine, state);
    expect(damageToM(state)).toEqual({ amount: 1, aggravated: true });
  });

  it("Bang Nakh IS strength-based — the other half of that pair", () => {
    const { state, engine } = intoCombat((s) => {
      find(s, "V1").strength = 4;
      equip(s, "V1", "bn", "Bang Nakh — Tiger's Claws");
    });
    expect(walkTo(engine, "ability:Bang Nakh — Tiger's Claws:bn:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Bang Nakh — Tiger's Claws:bn:strike"]]);
    drain(engine, state);
    expect(damageToM(state)).toEqual({ amount: 6, aggravated: false });
  });
});

describe("the optional maneuver each combat", () => {
  it("Saturday-Night Special offers one, and only one", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sn", "Saturday-Night Special"));
    expect(walkTo(engine, "ability:Saturday-Night Special:sn:maneuver")).toBe(true);
    runTrace(engine, [["Alice", "ability:Saturday-Night Special:sn:maneuver"]]);
    expect(combat(state)!.range).toBe("long");
    expect(combat(state)!.usedWeaponManeuver.acting).toBe("sn");
  });
});

// --- "only usable once each combat / round" --------------------------------

describe("Chainsaw (100317) — once each COMBAT", () => {
  it("is gone in the second round, and the round is genuinely still live", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "cs", "Chainsaw"));
    expect(walkTo(engine, "ability:Chainsaw:cs:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Chainsaw:cs:strike"]]);
    expect(combat(state)!.usedThisCombat).toContain("cs");

    pressToRound2(engine, state);
    // NEGATIVE SPACE, with its own control: the chainsaw is absent AND
    // Alice is really being asked for a strike. Without the second half
    // this passes just as well when combat ended or the walk ran out.
    let asked = false;
    for (let i = 0; i < 60 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.seat === "Alice" && dp.window === "combat.chooseStrike") {
        asked = true;
        expect(dp.options.map((o) => o.id)).toContain("strike:hand");
        expect(dp.options.some((o) => o.id.startsWith("ability:Chainsaw"))).toBe(false);
        break;
      }
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(asked).toBe(true);
  });
});

describe("Combat Shotgun (100379) — once each ROUND", () => {
  it("recharges for the second round — the control for the Chainsaw case", () => {
    // Same trace, opposite outcome. That is what makes the Chainsaw test
    // above evidence of the limit rather than of a broken walk.
    const { state, engine } = intoCombat((s) => equip(s, "V1", "sg", "Combat Shotgun"));
    expect(walkTo(engine, "ability:Combat Shotgun:sg:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Combat Shotgun:sg:strike"]]);
    expect(combat(state)!.usedThisRound).toContain("sg");
    expect(combat(state)!.usedThisCombat).not.toContain("sg");

    pressToRound2(engine, state);
    expect(combat(state)!.usedThisRound).not.toContain("sg");
    expect(walkTo(engine, "ability:Combat Shotgun:sg:strike")).toBe(true);
  });
});

describe("Mark V (101168) — once each round AND long range only", () => {
  it("NEGATIVE SPACE: not offered at close range", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "mk", "Mark V"));
    combat(state)!.range = "close";
    expect(walkTo(engine, "ability:Mark V:mk:strike", 25)).toBe(false);
  });

  it("…and offered at long range, for 4R", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "mk", "Mark V"));
    combat(state)!.range = "long";
    expect(walkTo(engine, "ability:Mark V:mk:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Mark V:mk:strike"]]);
    expect(combat(state)!.usedThisRound).toContain("mk");
    drain(engine, state);
    expect(damageToM(state)).toEqual({ amount: 4, aggravated: false });
  });
});

// --- how they got into the pool -------------------------------------------

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;
  const sets = v5Sets as string[];

  it("all fourteen are in the pool, implemented, and are library cards", () => {
    const missing = WAVE.filter(([id]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.kind !== "library";
    });
    expect(missing.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });

  it("none of them comes from a V5 set — they are the widening, not the pool", () => {
    // If this ever goes empty because the names drifted, the test above
    // has already failed on the ids, so this cannot pass vacuously.
    const fromV5 = WAVE.filter(([id]) =>
      (reg.entries[id]?.card.sets ?? []).some((s) => sets.includes(s)),
    );
    expect(fromV5.map(([, name]) => name)).toEqual([]);
    expect(WAVE.length).toBe(14);
  });

  it("every legacy library card in the pool is implemented — the gate itself", () => {
    // `widenedLibrary` admits on `supported.json` and nothing else. This
    // is the same claim `no-partial-cards.test.ts` makes registry-wide,
    // asserted here against the specific path these cards took.
    const strays = Object.values(reg.entries).filter(
      (e) =>
        e.card.kind === "library" &&
        !e.supported &&
        !e.card.sets.some((s) => sets.includes(s)),
    );
    expect(strays.map((e) => e.card.name)).toEqual([]);
  });
});
