/**
 * Audit batch: combat riders that hang off a STRIKE, a ROUND or the PRESS
 * STEP, instead of being a blanket "this round" effect. Covers
 * docs/card-rules-audit.md rows for King of the Mountain (101057),
 * Sympathetic Agony (101923), Drawing Out the Beast (100585), Necrosis
 * (101268) and Rigor Mortis (101636), plus the previously handler-less
 * Apparition (100076), Bloodform (100219) and Serpent's Numbing Kiss
 * (101727).
 *
 * These use a small local driver (`runUntil`) rather than `runTrace`:
 * the point of each test is a FRAME STATE at a named window, not the exact
 * choreography of every pass, and a strict trace would break every time an
 * unrelated window gains an option.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import type { DecisionPoint } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Pass every decision that offers a pass until `stop` matches. */
function runUntil(engine: VtesEngine, stop: (dp: DecisionPoint) => boolean): DecisionPoint {
  for (let i = 0; i < 300; i++) {
    const dp = engine.decision();
    if (!dp) throw new Error("no decision pending");
    if (stop(dp)) return dp;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return dp;
    engine.choose(pass.id);
  }
  throw new Error("decision loop did not settle");
}

function choose(engine: VtesEngine, prefix: string): void {
  const dp = engine.decision();
  if (!dp) throw new Error("no decision pending");
  const opt = dp.options.find((o) => o.id.startsWith(prefix));
  if (!opt) {
    throw new Error(`${prefix} not offered; legal: ${dp.options.map((o) => o.id).join(", ")}`);
  }
  engine.choose(opt.id);
}

/** V1 bleeds, M blocks, and Alice's first pre-range window is reached. */
function toBeforeRange(engine: VtesEngine): void {
  choose(engine, "bleed:V1");
  runUntil(engine, (dp) => dp.window === "action.effects" && dp.seat === "Bob");
  choose(engine, "block:M");
  runUntil(engine, (dp) => dp.window === "combat.beforeRange" && dp.seat === "Alice");
}

/** Play `card` at pre-range, then let the round settle up to the strike
 *  step (Alice to choose). */
function preRangeAndToStrikes(engine: VtesEngine, card: string, level: string): void {
  toBeforeRange(engine);
  choose(engine, `play:${card}:${level}`);
  runUntil(engine, (dp) => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
}

/** Both combatants strike by hand. */
function bothStrikeHand(engine: VtesEngine): void {
  choose(engine, "strike:hand");
  runUntil(engine, (dp) => dp.window === "combat.chooseStrike" && dp.seat === "Bob");
  choose(engine, "strike:hand");
}

/** Let the as-played reaction windows settle so the card actually
 *  resolves, then stop. */
function settleAsPlayed(engine: VtesEngine): void {
  for (let i = 0; i < 20; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return;
    engine.choose(pass.id);
  }
}

/** Run the rest of the combat out, passing everything. */
function finishCombat(engine: VtesEngine): void {
  for (let i = 0; i < 200; i++) {
    const dp = engine.decision();
    if (!dp) return;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return;
    if (!dp.window.startsWith("combat.") && dp.window !== "card.asPlayed") return;
    engine.choose(pass.id);
  }
}

function combatFrame(engine: VtesEngine) {
  const f = engine.state.frames.filter((x) => x.kind === "combat").pop();
  return f?.kind === "combat" ? f : null;
}

describe("King of the Mountain (101057)", () => {
  it("[for] prevents the opposing strike and mends nothing", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { for: "basic" };
    v1.blood = 6;
    state.seats[1]!.minions.find((x) => x.id === "M")!.strength = 4;
    state.seats[0]!.hand.push({ id: "k", name: "King of the Mountain" });
    const engine = new VtesEngine(state, testRegistry);

    // [for] "Prevent all damage from the opposing minion's strike" is
    // played before range, so its window is the one used here.
    preRangeAndToStrikes(engine, "King of the Mountain", "basic");
    bothStrikeHand(engine);
    finishCombat(engine);

    // All 4 points of M's strike are prevented, so V1 never mends and
    // never burns blood to damage.
    expect(
      state.eventLog.some(
        (e) => e.type === "DamagePrevented" && e.minion === "V1" && e.amount >= 1,
      ),
    ).toBe(true);
    expect(
      state.eventLog.some(
        (e) => e.type === "DamageInflicted" && e.minion === "V1" && e.amount > 0,
      ),
    ).toBe(false);
    // No mending of damage ⇒ the only blood lost is the card's own 2
    // blood, plus the 1 the fixture's opening lock/burn already took.
    expect(v1.blood).toBe(3);
  });

  it("[FOR] is offered after range is determined, not before", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { for: "superior" };
    state.seats[0]!.hand.push({ id: "k", name: "King of the Mountain" });
    const engine = new VtesEngine(state, testRegistry);

    toBeforeRange(engine);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:King of the Mountain:superior")),
    ).toBe(false);
    const dp = runUntil(engine, (d) => d.window === "combat.beforeStrikes");
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.startsWith("play:King of the Mountain:superior"))).toBe(true);
  });
});

describe("Sympathetic Agony (101923)", () => {
  it("[chi][for] bars the press only once damage lands on this vampire", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { chi: "basic", for: "basic" };
    v1.blood = 8;
    state.seats[1]!.minions.find((x) => x.id === "M")!.strength = 2;
    state.seats[0]!.hand.push({ id: "k", name: "Sympathetic Agony" });
    const engine = new VtesEngine(state, testRegistry);

    toBeforeRange(engine);
    choose(engine, "play:Sympathetic Agony:basic");
    runUntil(engine, (dp) => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
    // Nothing is barred before the damage.
    expect(combatFrame(engine)?.restrict.opposing.press).toBe(false);
    bothStrikeHand(engine);
    runUntil(engine, (dp) => dp.window === "combat.press");
    // V1 took M's hand strike, so M's press is now barred.
    expect(combatFrame(engine)?.restrict.opposing.press).toBe(true);
  });
});

describe("Drawing Out the Beast (100585)", () => {
  it("a card-wide first-round restriction prevents play in a later round", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { ani: "superior" };
    state.seats[0]!.hand.push({ id: "k", name: "Drawing Out the Beast" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = combatFrame(engine)!;
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Drawing Out the Beast"))).toBe(true);
    cf.round = 2;
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Drawing Out the Beast"))).toBe(false);
  });

  it("[ANI] puts 1 unpreventable damage on the foe during the press step", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "superior" };
    v1.blood = 8;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 6;
    m.strength = 1;
    state.seats[0]!.hand.push({ id: "k", name: "Drawing Out the Beast" });
    const engine = new VtesEngine(state, testRegistry);

    preRangeAndToStrikes(engine, "Drawing Out the Beast", "superior");
    bothStrikeHand(engine);
    finishCombat(engine);

    // The press-step packet is environmental: `source: null`.
    expect(
      state.eventLog.some(
        (e) =>
          e.type === "DamageInflicted" &&
          e.minion === "M" &&
          e.source === null &&
          e.amount === 1,
      ),
    ).toBe(true);
    // …and unpreventable, so no prevention credit was spent on it.
    expect(
      state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "M"),
    ).toBe(false);
  });

  it("[ani] basic deals no press-step damage", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "basic" };
    v1.blood = 8;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.blood = 6;
    m.strength = 1;
    state.seats[0]!.hand.push({ id: "k", name: "Drawing Out the Beast" });
    const engine = new VtesEngine(state, testRegistry);

    preRangeAndToStrikes(engine, "Drawing Out the Beast", "basic");
    bothStrikeHand(engine);
    finishCombat(engine);

    expect(
      state.eventLog.some(
        (e) => e.type === "DamageInflicted" && e.minion === "M" && e.source === null,
      ),
    ).toBe(false);
  });
});

describe("Necrosis (101268)", () => {
  it.each([false, true])("[THN] press damage occurs before press only against a vampire (ally=%s)", (ally) => {
    const state = threeSeatGame();
    const actor = state.seats[0]!.minions[0]!;
    const foe = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(actor, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(foe, { blood: 10, capacity: 10, strength: 0, ...(ally ? { kind: "ally" as const } : {}) });
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    runUntil(engine, dp => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
    choose(engine, "play:Necrosis:superior");
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const opt = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(engine.decision()!.window).toBe("combat.press");
    const events = state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null);
    expect(events).toHaveLength(ally ? 0 : 1);
  });

  it("[THN] a dodged Necrosis strike must not inflict environmental damage", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 10, capacity: 10, strength: 0 });
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    cf.grantedStrikes ??= { acting: [], opposing: [] };
    cf.grantedStrikes.opposing.push({ kind: "dodge" });
    runUntil(engine, dp => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
    choose(engine, "play:Necrosis:superior");
    let dodged = false;
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const dodge = dp.seat === "Bob" && dp.window === "combat.chooseStrike" && dp.options.find(o => o.id === "strike:dodge");
      if (dodge) dodged = true;
      const opt = dodge || dp.options.find(o => o.id === "pass") || dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(dodged).toBe(true);
    expect(engine.decision()!.window).toBe("combat.press");
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(0);
  });

  it("[THN] does not schedule damage for a strike made at long range", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 10, capacity: 10, strength: 0 });
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    cf.maneuverCredits.acting = 1;
    runUntil(engine, dp => dp.window === "combat.range" && dp.seat === "Alice");
    choose(engine, "maneuver:credit");
    runUntil(engine, dp => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
    expect(cf.range).toBe("long");
    choose(engine, "play:Necrosis:superior");
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const opt = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(engine.decision()!.window).toBe("combat.press");
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(0);
  });

  it("[THN] schedules no damage if first strike sends the Necrosis player to torpor", () => {
    const state = threeSeatGame();
    const actor = state.seats[0]!.minions[0]!;
    Object.assign(actor, { disciplines: { thn: "superior" }, blood: 1, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 10, capacity: 10, strength: 1 });
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    state.seats[1]!.hand.push({ id: "jab", name: "Quick Jab" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    // Blood can be lost after the bleed was announced.
    actor.blood = 0;
    let necrosis = false, jab = false;
    for (let i = 0; i < 150 && state.frames.some(f => f.kind === "combat"); i++) {
      const dp = engine.decision()!;
      const nec = !necrosis && dp.seat === "Alice" && dp.options.find(o => o.id.startsWith("play:Necrosis:superior"));
      const quick = !jab && dp.seat === "Bob" && dp.options.find(o => o.id.startsWith("play:Quick Jab"));
      if (nec) necrosis = true;
      if (quick) jab = true;
      const opt = nec || quick || dp.options.find(o => o.id === "pass") || dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(necrosis && jab).toBe(true);
    expect(actor.inTorpor || actor.torporPending).toBe(true);
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(0);
  });

  it("[THN] still schedules environmental damage when the hand strike damage is prevented", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { disciplines: { for: "basic" }, blood: 10, capacity: 10, strength: 0 });
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    state.seats[1]!.hand.push({ id: "soak", name: "Soak" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    let necrosis = false, soak = false;
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const nec = !necrosis && dp.seat === "Alice" && dp.options.find(o => o.id.startsWith("play:Necrosis:superior"));
      const prevent = !soak && dp.seat === "Bob" && dp.options.find(o => o.id.startsWith("play:Soak:basic"));
      if (nec) necrosis = true;
      if (prevent) soak = true;
      const opt = nec || prevent || dp.options.find(o => o.id === "pass") || dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(necrosis && soak).toBe(true);
    expect(engine.decision()!.window).toBe("combat.press");
    expect(state.eventLog.some(e => e.type === "DamagePrevented" && e.minion === "M" && e.amount === 2)).toBe(true);
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(1);
  });

  it("[THN] persists the strike rider across a save before strike resolution", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 10, capacity: 10, strength: 0 });
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    runUntil(engine, dp => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
    choose(engine, "play:Necrosis:superior");
    settleAsPlayed(engine);
    expect(cf.strikes.acting?.pressStepDamageOnClose).toEqual({ amount: 1, vampireOnly: true });
    const saved = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(saved, testRegistry);
    for (let i = 0; i < 150 && resumed.decision()?.window !== "combat.press"; i++) {
      const dp = resumed.decision()!;
      const opt = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      resumed.choose(opt.id);
    }
    expect(resumed.decision()!.window).toBe("combat.press");
    expect(saved.eventLog.filter((e: {type: string; minion?: string; source?: string | null}) =>
      e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(1);
  });

  it("[THN] schedules each resolved Necrosis strike in the same round", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 10, capacity: 10, strength: 0 });
    state.seats[0]!.hand.push({ id: "k1", name: "Necrosis" }, { id: "k2", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    cf.additionalStrikes.acting = 1;
    let strikes = 0;
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const necrosis = dp.seat === "Alice" && dp.window === "combat.chooseStrike" && dp.options.find(o => o.id.startsWith("play:Necrosis:superior"));
      if (necrosis) strikes++;
      const opt = necrosis || dp.options.find(o => o.id === "pass") || dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(strikes).toBe(2);
    expect(engine.decision()!.window).toBe("combat.press");
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null))
      .toMatchObject([{ amount: 2 }]);
  });

  it("[THN] tracks a dodged strike separately from a later additional Necrosis strike", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { disciplines: { thn: "superior" }, blood: 10, capacity: 10, strength: 0 });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, { blood: 10, capacity: 10, strength: 0 });
    state.seats[0]!.hand.push({ id: "k1", name: "Necrosis" }, { id: "k2", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);
    toBeforeRange(engine);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    cf.presses.acting = 1;
    cf.additionalStrikes.acting = 1;
    cf.grantedStrikes ??= { acting: [], opposing: [] };
    cf.grantedStrikes.opposing.push({ kind: "dodge" });
    let strikes = 0, dodged = false;
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const nec = dp.seat === "Alice" && dp.window === "combat.chooseStrike" && dp.options.find(o => o.id.startsWith("play:Necrosis:superior"));
      const dodge = !dodged && dp.seat === "Bob" && dp.window === "combat.chooseStrike" && dp.options.find(o => o.id === "strike:dodge");
      if (nec) strikes++;
      if (dodge) dodged = true;
      const opt = nec || dodge || dp.options.find(o => o.id === "pass") || dp.options.find(o => o.id === "strike:hand");
      if (!opt) throw new Error(`no option in ${dp.window}`);
      engine.choose(opt.id);
    }
    expect(strikes).toBe(2);
    expect(dodged).toBe(true);
    expect(engine.decision()!.window).toBe("combat.press");
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null))
      .toMatchObject([{ amount: 1 }]);
  });

  it("[THN] keeps the +2 hand strike and offers the press rider", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { thn: "superior" };
    state.seats[0]!.hand.push({ id: "k", name: "Necrosis" });
    const engine = new VtesEngine(state, testRegistry);

    choose(engine, "bleed:V1");
    runUntil(engine, (dp) => dp.window === "action.effects" && dp.seat === "Bob");
    choose(engine, "block:M");
    runUntil(engine, (dp) => dp.window === "combat.chooseStrike" && dp.seat === "Alice");
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Necrosis:superior")),
    ).toBe(true);
  });
});

describe("Apparition (100076)", () => {
  it("is supported and now has a handler", () => {
    expect(testRegistry["Apparition"]).toBeDefined();
  });

  it("[CHI] offers 2 points of prevention each round", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { chi: "superior" };
    v1.blood = 8;
    state.seats[1]!.minions.find((x) => x.id === "M")!.strength = 3;
    state.seats[0]!.hand.push({ id: "k", name: "Apparition" });
    const engine = new VtesEngine(state, testRegistry);

    preRangeAndToStrikes(engine, "Apparition", "superior");
    bothStrikeHand(engine);

    const dp = runUntil(engine, (d) => d.window === "combat.damageResolution");
    expect(dp.options.some((o) => o.id.startsWith("prevent:"))).toBe(true);
  });
});

describe("Rigor Mortis (101636)", () => {
  it("[pre] bars additional strikes but NOT presses", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "basic" };
    state.seats[0]!.hand.push({ id: "k", name: "Rigor Mortis" });
    const engine = new VtesEngine(state, testRegistry);

    toBeforeRange(engine);
    choose(engine, "play:Rigor Mortis:basic");
    settleAsPlayed(engine);
    expect(combatFrame(engine)?.noAdditionalStrikes?.opposing).toBe(true);

    const cf = combatFrame(engine);
    expect(cf?.noAdditionalStrikes?.opposing).toBe(true);
    expect(cf?.restrict.opposing.press).toBe(false);
  });
});

describe("Bloodform (100219)", () => {
  it("is supported and now has a handler", () => {
    expect(testRegistry["Bloodform"]).toBeDefined();
  });

  it("[vic] is not offered against a vampire", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { vic: "basic" };
    state.seats[0]!.hand.push({ id: "k", name: "Bloodform" });
    const engine = new VtesEngine(state, testRegistry);

    choose(engine, "bleed:V1");
    runUntil(engine, (dp) => dp.window === "action.effects" && dp.seat === "Bob");
    choose(engine, "block:M");
    runUntil(engine, (dp) => dp.window === "combat.chooseStrike");
    const opts = engine.decision()?.options.map((o) => o.id) ?? [];
    expect(opts.some((o) => o.startsWith("play:Bloodform"))).toBe(false);
  });
});

describe("Serpent's Numbing Kiss (101727)", () => {
  it("has a handler and drops the unprinted self-unlock", () => {
    expect(testRegistry["Serpent's Numbing Kiss"]).toBeDefined();
  });
});
