/**
 * Combat effects that recur every round
 * (docs/round-recurring-combat-design.md).
 *
 * Bear's Skin (100145), Carrion Crows (100301), Flesh of Marble (100749),
 * Weather Control (102164), Tranquility Shield (102362).
 *
 * The gap these five close: `CombatFrame` had combat-scoped fields and
 * round-scoped fields, and nothing that is combat-scoped and FIRES AGAIN
 * every round.
 */

import { describe, expect, it } from "vitest";
import type {
  CombatFrame,
  GameState,
  MinionState,
  PermanentStatics,
} from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { frenzyTargetSide } from "../../src/cards/effects/compile.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** A retainer on `M` that inflicts 1 damage each round — the cheapest way
 *  to give a round a SECOND damage source, which is what Flesh of Marble
 *  and Weather Control's retainer clause both need. */
function giveRetainer(state: GameState, on: string, statics: PermanentStatics, life = 1): void {
  find(state, on).attached.push({
    card: { id: "r1", name: "Raven Spy" },
    controller: "Bob",
    owner: "Bob",
    statics,
    tags: [],
    locked: false,
    usedThisPhase: false,
    life,
  });
}

function combat(state: GameState): CombatFrame {
  const f = state.frames.find((x) => x.kind === "combat");
  if (!f || f.kind !== "combat") throw new Error("no combat frame");
  return f;
}

/**
 * Alice's V1 bleeds, Bob's M blocks; stop with the BEFORE RANGE window
 * open — the one window every card in this wave is played in.
 */
function intoBeforeRange(
  aliceCards: string[],
  disc: Record<string, "basic" | "superior">,
  tweak: (state: GameState) => void = () => {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc, blood: 4, strength: 1 });
  Object.assign(find(state, "M"), { blood: 4, strength: 1 });
  aliceCards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  tweak(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

/** Answer every decision the cheapest way (pass where possible, first
 *  option where not) until the combat frame is gone or `stop` says so. */
function drain(
  engine: VtesEngine,
  state: GameState,
  stop: () => boolean = () => false,
  limit = 60,
): void {
  for (let i = 0; i < limit; i++) {
    if (!state.frames.some((f) => f.kind === "combat")) return;
    if (stop()) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

/** Push the combat into its second round: hand the acting side a press
 *  credit and spend it when the press step comes round. */
function pressToNextRound(engine: VtesEngine, state: GameState): void {
  const startRound = combat(state).round;
  combat(state).presses.acting = 1;
  for (let i = 0; i < 80; i++) {
    if (!state.frames.some((f) => f.kind === "combat")) return;
    if (combat(state).round > startRound) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id === "press:continue") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

const passCycle = (id: string): Array<[string, string]> => [
  ["Alice", id], ["Bob", "pass"], ["Carol", "pass"],
];

describe("Bear's Skin (100145)", () => {
  it("inferior is the existing ROUND-scoped credit: +1 strength, prevent 1, gone next round", () => {
    const { state, engine } = intoBeforeRange(["Bear's Skin"], {
      ani: "basic",
      pro: "basic",
    });
    runTrace(engine, [
      ["Alice", "play:Bear's Skin:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    const cf = combat(state);
    expect(cf.strengthBonusRound.acting).toBe(1);
    expect(cf.strengthBonus.acting).toBe(0);
    expect(cf.preventCredits.acting).toBe(1);
    // Nothing recurring was installed.
    expect(cf.preventPerRound.acting).toBe(0);
  });

  it("superior grants a RATE: +1 strength all combat, 1 prevention EACH round", () => {
    const { state, engine } = intoBeforeRange(["Bear's Skin"], {
      ani: "superior",
      pro: "superior",
    });
    runTrace(engine, [
      ["Alice", "play:Bear's Skin:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    const cf = combat(state);
    expect(cf.strengthBonus.acting).toBe(1);
    expect(cf.preventPerRound.acting).toBe(1);
    expect(cf.preventCredits.acting).toBe(0); // a rate, not a pool
  });

  it("the rate refreshes at the round boundary; a spent POOL credit does not", () => {
    const { state, engine } = intoBeforeRange(["Bear's Skin"], {
      ani: "superior",
      pro: "superior",
    });
    runTrace(engine, [
      ["Alice", "play:Bear's Skin:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    // Spend the round's point by hand, then advance a round.
    const cf = combat(state);
    cf.preventPerRoundUsed.acting = 1;
    pressToNextRound(engine, state);
    const next = combat(state);
    expect(next.round).toBe(2);
    expect(next.preventPerRound.acting).toBe(1); // the grant survives
    expect(next.preventPerRoundUsed.acting).toBe(0); // the spend does not
  });

  it("the prevention credit is actually offered and spent from the rate", () => {
    const { state, engine } = intoBeforeRange(["Bear's Skin"], {
      ani: "superior",
      pro: "superior",
    });
    runTrace(engine, [
      ["Alice", "play:Bear's Skin:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    const before = find(state, "V1").blood;
    // Run to the damage-resolution window for V1 and take the credit.
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const credit = dp.options.find((o) => o.id === "prevent:credit");
      if (credit && dp.seat === "Alice") {
        runTrace(engine, [["Alice", "prevent:credit"]]);
        break;
      }
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state).preventPerRoundUsed.acting).toBe(1);
    drain(engine, state);
    // M's hand strike is 1 damage; the credit ate all of it.
    expect(find(state, "V1").blood).toBe(before);
  });

  it("only one Bear's Skin each combat", () => {
    const { state, engine } = intoBeforeRange(["Bear's Skin", "Bear's Skin"], {
      ani: "superior",
      pro: "superior",
    });
    runTrace(engine, [
      ["Alice", "play:Bear's Skin:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Bear's Skin"))).toBe(false);
    expect(state.seats[0]!.hand.some((c) => c.name === "Bear's Skin")).toBe(true);
  });
});

describe("Carrion Crows (100301)", () => {
  it("inferior: the opposing minion takes 1 environmental damage each round", () => {
    const { state, engine } = intoBeforeRange(["Carrion Crows"], { ani: "basic" });
    const before = find(state, "M").blood;
    runTrace(engine, [
      ["Alice", "play:Carrion Crows:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    // Nothing lands until strike resolution — it is "during normal strike
    // resolution", not on play.
    expect(find(state, "M").blood).toBe(before);
    expect(combat(state).roundDamage).toHaveLength(1);
    drain(engine, state);
    // 1 from the crows + 1 from V1's hand strike.
    expect(find(state, "M").blood).toBe(before - 2);
  });

  it("superior does 2", () => {
    const { state, engine } = intoBeforeRange(["Carrion Crows"], { ani: "superior" });
    const before = find(state, "M").blood;
    runTrace(engine, [
      ["Alice", "play:Carrion Crows:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    drain(engine, state);
    expect(find(state, "M").blood).toBe(before - 3);
  });

  it("its damage is environmental — source null, so it cannot be dodged", () => {
    const { state, engine } = intoBeforeRange(["Carrion Crows"], { ani: "basic" });
    runTrace(engine, [
      ["Alice", "play:Carrion Crows:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    drain(engine, state);
    const inflicted = state.eventLog.filter(
      (e) => e.type === "DamageInflicted" && e.minion === "M" && e.source === null,
    );
    expect(inflicted).toHaveLength(1);
  });

  it("fires AGAIN in the second round — the whole point of the wave", () => {
    const { state, engine } = intoBeforeRange(["Carrion Crows"], { ani: "basic" });
    runTrace(engine, [
      ["Alice", "play:Carrion Crows:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    pressToNextRound(engine, state);
    expect(combat(state).round).toBe(2);
    drain(engine, state);
    const crows = state.eventLog.filter(
      (e) => e.type === "DamageInflicted" && e.minion === "M" && e.source === null,
    );
    expect(crows).toHaveLength(2);
  });
});

describe("Flesh of Marble (100749)", () => {
  it("inferior auto-prevents the SECOND damage of a round", () => {
    // M strikes for 1 and a retainer adds 1; only the first lands.
    const { state, engine } = intoBeforeRange(
      ["Flesh of Marble"],
      { pro: "basic" },
      (s) => {
        giveRetainer(s, "M", { combatRoundDamage: { amount: 1, ranged: true } });
      },
    );
    const before = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Flesh of Marble:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(combat(state).autoPreventAfterFirst.acting).toBe("nonAgg");
    drain(engine, state);
    expect(find(state, "V1").blood).toBe(before - 1);
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1"),
    ).toBe(true);
  });

  it("inferior does NOT prevent aggravated damage that way", () => {
    const { state, engine } = intoBeforeRange(
      ["Flesh of Marble"],
      { pro: "basic" },
      (s) => {
        giveRetainer(s, "M", { combatRoundDamage: { amount: 1, ranged: true } });
      },
    );
    runTrace(engine, [
      ["Alice", "play:Flesh of Marble:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    // Make everything in this combat aggravated (Dawn Operation's flag).
    combat(state).allDamageAggravated = true;
    drain(engine, state);
    // Both points landed — "aggravated damage cannot be prevented this
    // way", so the second was not auto-prevented either.
    const onV1 = state.eventLog.filter(
      (e) => e.type === "DamageInflicted" && e.minion === "V1",
    );
    expect(onV1).toHaveLength(2);
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1"),
    ).toBe(false);
  });

  it("superior prevents aggravated damage this way too", () => {
    const { state, engine } = intoBeforeRange(
      ["Flesh of Marble"],
      { pro: "superior" },
      (s) => {
        giveRetainer(s, "M", { combatRoundDamage: { amount: 1, ranged: true } });
      },
    );
    runTrace(engine, [
      ["Alice", "play:Flesh of Marble:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    combat(state).allDamageAggravated = true;
    drain(engine, state);
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1"),
    ).toBe(true);
  });

  it("the FIRST damage of a round still lands — the tally resets each round", () => {
    const { state, engine } = intoBeforeRange(["Flesh of Marble"], { pro: "basic" });
    runTrace(engine, [
      ["Alice", "play:Flesh of Marble:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    pressToNextRound(engine, state);
    // The new round starts with a clean tally, so its first damage lands.
    expect(combat(state).damageTakenThisRound.acting).toBe(0);
    drain(engine, state);
    // M's hand strike landed in each round; neither was auto-prevented,
    // because each was the first of its own round.
    expect(
      state.eventLog.filter((e) => e.type === "DamageInflicted" && e.minion === "V1"),
    ).toHaveLength(2);
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "V1"),
    ).toBe(false);
  });
});

describe("Weather Control (102164)", () => {
  it("hits BOTH combatants immediately, in the round it is played", () => {
    const { state, engine } = intoBeforeRange(["Weather Control"], { tha: "basic" });
    const v = find(state, "V1").blood;
    const m = find(state, "M").blood;
    runTrace(engine, [
      ["Alice", "play:Weather Control:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(find(state, "V1").blood).toBe(v - 1);
    expect(find(state, "M").blood).toBe(m - 1);
  });

  it("its damage opens NO prevention window — it is unpreventable", () => {
    const { state, engine } = intoBeforeRange(["Weather Control"], { tha: "basic" });
    runTrace(engine, [
      ["Alice", "play:Weather Control:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    // Resolved on the spot: nothing is left queued and the frame is still
    // in its before-range step.
    expect(combat(state).pendingDamage).toHaveLength(0);
    expect(combat(state).step).toBe("beforeRange");
  });

  it("burns a retainer's life as well", () => {
    const { state, engine } = intoBeforeRange(["Weather Control"], { tha: "basic" }, (s) => {
      giveRetainer(s, "M", {}, 2);
    });
    runTrace(engine, [
      ["Alice", "play:Weather Control:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(find(state, "M").attached[0]!.life).toBe(1);
  });

  /** Environmental damage only (source null) — strikes land in the same
   *  rounds and would otherwise be counted with it. */
  const weather = (state: GameState, on: string): number[] =>
    state.eventLog
      .filter((e) => e.type === "DamageInflicted" && e.minion === on && e.source === null)
      .map((e) => (e.type === "DamageInflicted" ? e.amount : 0));

  it("fires again next round, at the same amount at inferior", () => {
    const { state, engine } = intoBeforeRange(["Weather Control"], { tha: "basic" });
    runTrace(engine, [
      ["Alice", "play:Weather Control:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(weather(state, "M")).toEqual([1]);
    pressToNextRound(engine, state);
    expect(weather(state, "M")).toEqual([1, 1]);
  });

  it("superior escalates: 1 in the round it was played, 2 in the next", () => {
    const { state, engine } = intoBeforeRange(["Weather Control"], { tha: "superior" });
    runTrace(engine, [
      ["Alice", "play:Weather Control:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(weather(state, "M")).toEqual([1]);
    pressToNextRound(engine, state);
    expect(weather(state, "M")).toEqual([1, 2]);
    // …and it hits its own player just as hard.
    expect(weather(state, "V1")).toEqual([1, 2]);
  });

  it("only usable during the first round", () => {
    const { state, engine } = intoBeforeRange(["Weather Control", "Weather Control"], {
      tha: "basic",
    });
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    pressToNextRound(engine, state);
    expect(combat(state).round).toBe(2);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Weather Control"))).toBe(false);
  });
});

describe("Tranquility Shield (102362)", () => {
  const salubri = (s: GameState): void => {
    find(s, "V1").clan = "Salubri";
  };

  it("grants a per-round prevention rate and costs 1 blood", () => {
    const { state, engine } = intoBeforeRange(["Tranquility Shield"], { for: "basic" }, salubri);
    const before = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", "play:Tranquility Shield:basic:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(combat(state).preventPerRound.acting).toBe(1);
    expect(find(state, "V1").blood).toBe(before - 1);
  });

  it("superior grants 2 per round", () => {
    const { state, engine } = intoBeforeRange(["Tranquility Shield"], { for: "superior" }, salubri);
    runTrace(engine, [
      ["Alice", "play:Tranquility Shield:superior:V1:a0"],
      ...passCycle("pass"),
    ]);
    expect(combat(state).preventPerRound.acting).toBe(2);
  });

  it("requires a Salubri", () => {
    const { engine } = intoBeforeRange(["Tranquility Shield"], { for: "basic" });
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Tranquility Shield"))).toBe(false);
  });

  const withTerrorFrenzy = (level: "basic" | "superior") => (s: GameState) => {
    salubri(s);
    find(s, "M").disciplines = { ani: level };
    find(s, "M").blood = 4;
    s.seats[1]!.hand.push({ id: "b0", name: "Terror Frenzy" });
  };

  it("control case: without the shield, Bob IS offered Terror Frenzy", () => {
    const { engine } = intoBeforeRange([], {}, withTerrorFrenzy("basic"));
    runTrace(engine, [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:Terror Frenzy"))).toBe(true);
  });

  it("makes the vampire immune: an opponent-directed frenzy card is not offered", () => {
    const { state, engine } = intoBeforeRange(
      ["Tranquility Shield"],
      { for: "basic" },
      withTerrorFrenzy("basic"),
    );
    runTrace(engine, [
      ["Alice", "play:Tranquility Shield:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(combat(state).frenzyImmune.acting).toBe(true);
    // Playing a card rewinds the impulse to the acting seat; step past her.
    runTrace(engine, [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:Terror Frenzy"))).toBe(false);
    expect(state.seats[1]!.hand.some((c) => c.name === "Terror Frenzy")).toBe(true);
  });

  it("cancels a frenzy card's effects that are ALREADY in force", () => {
    const { state, engine } = intoBeforeRange(["Tranquility Shield"], { for: "basic" }, (s) => {
      salubri(s);
      find(s, "M").disciplines = { ani: "basic" };
      find(s, "M").blood = 4;
      s.seats[1]!.hand.push({ id: "b0", name: "Terror Frenzy" });
    });
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Terror Frenzy:basic:M:b0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const cf = combat(state);
    expect(cf.restrict.acting.equipment).toBe(true);
    expect(cf.frenzyRestrict.acting).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Tranquility Shield:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const after = combat(state);
    expect(after.restrict.acting).toEqual({
      maneuver: false,
      press: false,
      equipment: false,
    });
    expect(after.frenzyRestrict.acting).toBe(false);
  });

  it("cancels a frenzy card's play-cost surcharge too", () => {
    const { state, engine } = intoBeforeRange(["Tranquility Shield"], { for: "basic" }, (s) => {
      salubri(s);
      find(s, "M").disciplines = { ani: "superior" };
      find(s, "M").blood = 4;
      s.seats[1]!.hand.push({ id: "b0", name: "Terror Frenzy" });
    });
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "play:Terror Frenzy:superior:M:b0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(combat(state).playCostMods.some((m) => m.fromFrenzy && m.minionId === "V1")).toBe(
      true,
    );
    runTrace(engine, [
      ["Alice", "play:Tranquility Shield:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(combat(state).playCostMods.some((m) => m.fromFrenzy)).toBe(false);
  });

  it("a SELF-BUFF frenzy card is still playable at a shielded vampire's opponent", () => {
    // Rage of Apedemak is not "used on" the other vampire — §8.4.
    const { state, engine } = intoBeforeRange(["Tranquility Shield"], { for: "basic" }, (s) => {
      salubri(s);
      find(s, "M").disciplines = { pot: "basic" };
      find(s, "M").blood = 4;
      s.seats[1]!.hand.push({ id: "b0", name: "Rage of Apedemak" });
    });
    runTrace(engine, [
      ["Alice", "play:Tranquility Shield:basic:V1:a0"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    expect(combat(state).frenzyImmune.acting).toBe(true);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("play:Rage of Apedemak"))).toBe(true);
  });
});

describe("frenzy classification (docs/round-recurring-combat-design.md §6)", () => {
  it("every frenzy mode in the pool classifies, and matches its printed text", () => {
    const frenzy = cardSpecs.filter((s) => s.frenzy);
    // `frenzyTargetSide` answers "which COMBATANT is this used on", which
    // is what Tranquility Shield's immunity and Meditative Grove's cancel
    // both ask — so the set to pin is the frenzy COMBAT cards. Scoped to
    // the question it is really asking, after Deep Song (a frenzy ACTION
    // card, played before any combat exists) landed: an assertion about a
    // total set is a hostage to every future card.
    // docs/last-buildable-design.md §3
    const combatFrenzy = frenzy.filter((s) => s.cardType === "combat");
    expect(combatFrenzy.map((s) => s.name).sort()).toEqual([
      "Rage of Apedemak",
      "Terror Frenzy",
    ]);
    // …and the non-combat ones are named too, so a new frenzy card of
    // either kind still has to be looked at deliberately.
    expect(
      frenzy.filter((s) => s.cardType !== "combat").map((s) => s.name).sort(),
    ).toEqual(["Deep Song"]);
    const target = (name: string, level: string): string => {
      const spec = frenzy.find((s) => s.name === name)!;
      const mode = spec.modes.find((m) => m.level === level)!;
      return frenzyTargetSide(mode, "acting");
    };
    // Terror Frenzy reaches across in both modes (restrict, then cost).
    expect(target("Terror Frenzy", "basic")).toBe("opposing");
    expect(target("Terror Frenzy", "superior")).toBe("opposing");
    // Rage of Apedemak buffs its own player.
    expect(target("Rage of Apedemak", "basic")).toBe("acting");
    expect(target("Rage of Apedemak", "superior")).toBe("acting");
  });
});

describe("the three prevention buckets", () => {
  /** Walk the engine forward, spending `prevent:credit` whenever Alice is
   *  offered it, and report which bucket each spend came out of. */
  function spendOrder(engine: VtesEngine, state: GameState, times: number): string[] {
    const taken: string[] = [];
    for (let i = 0; i < 60 && taken.length < times; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const cf = combat(state);
      const before = {
        firstRound: cf.preventCreditsFirstRound.acting,
        rate: cf.preventPerRound.acting - cf.preventPerRoundUsed.acting,
        pool: cf.preventCredits.acting,
      };
      if (dp.seat === "Alice" && dp.options.some((o) => o.id === "prevent:credit")) {
        runTrace(engine, [["Alice", "prevent:credit"]]);
        const now = combat(state);
        if (now.preventCreditsFirstRound.acting < before.firstRound) taken.push("firstRound");
        else if (now.preventPerRound.acting - now.preventPerRoundUsed.acting < before.rate)
          taken.push("rate");
        else if (now.preventCredits.acting < before.pool) taken.push("pool");
        else taken.push("nothing");
        continue;
      }
      runTrace(engine, [
        [dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id],
      ]);
    }
    return taken;
  }

  it("shortest-lived first: the round-1 pool, then the per-round rate, then the combat pool", () => {
    // One combatant holding all three kinds of credit, and 3 damage to
    // spend them on: M strikes for 3 in one item.
    const { state, engine } = intoBeforeRange([], {}, (s) => {
      Object.assign(find(s, "M"), { strength: 3 });
    });
    const cf = combat(state);
    cf.preventCreditsFirstRound.acting = 1; // Precognition
    cf.preventPerRound.acting = 1; // Bear's Skin superior
    cf.preventCredits.acting = 1; // Beast Meld
    expect(spendOrder(engine, state, 3)).toEqual(["firstRound", "rate", "pool"]);
  });

  it("the rate is back next round; the two pools are not", () => {
    const { state, engine } = intoBeforeRange([], {}, (s) => {
      Object.assign(find(s, "M"), { strength: 3 });
    });
    const cf = combat(state);
    cf.preventCreditsFirstRound.acting = 1;
    cf.preventPerRound.acting = 1;
    cf.preventCredits.acting = 1;
    spendOrder(engine, state, 3);
    pressToNextRound(engine, state);
    const next = combat(state);
    expect(next.preventPerRound.acting - next.preventPerRoundUsed.acting).toBe(1);
    expect(next.preventCredits.acting).toBe(0);
    expect(next.round).toBe(2);
  });
});
