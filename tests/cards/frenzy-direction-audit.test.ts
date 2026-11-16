import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import { makeAlly } from "../engine/fixtures.ts";

function setup(name: string, level = "basic", ally = false) {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 10, capacity: 10, strength: 0, disciplines: { ani: "superior" } });
  const foe = state.seats[1]!.minions.find(m => m.id === "M")!;
  Object.assign(foe, ally ? makeAlly("M", "Bob", 10) : { blood: 10, capacity: 10, strength: 0 });
  state.seats[0]!.hand.push({ id: "frenzy", name });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", `play:${name}:${level}:V1:frenzy`], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  const cf = state.frames.find(f => f.kind === "combat");
  if (!cf || cf.kind !== "combat") throw new Error("no combat");
  return { state, engine, cf, foe };
}

describe("directional frenzy restrictions", () => {
  it.each([
    ["Terror Frenzy", "close", false, true],
    ["Drawing Out the Beast", "long", true, false],
  ])("%s bans maneuver to %s but permits the opposite direction", (card, _direction, closeAllowed, longAllowed) => {
    const { engine, cf } = setup(card);
    cf.step = "range"; cf.awaiting = "opposing"; cf.maneuverCredits.opposing = 2;
    cf.range = "long";
    expect(engine.decision()!.options.some(o => o.id === "maneuver:credit")).toBe(closeAllowed);
    cf.range = "close";
    expect(engine.decision()!.options.some(o => o.id === "maneuver:credit")).toBe(longAllowed);
  });
  it.each([
    ["Terror Frenzy", false, true],
    ["Drawing Out the Beast", true, false],
  ])("%s only bars the printed press direction", (card, continueAllowed, endAllowed) => {
    const { engine, cf } = setup(card);
    cf.step = "press"; cf.awaiting = "opposing"; cf.presses.opposing = 1;
    cf.willContinue = false;
    expect(engine.decision()!.options.some(o => o.id === "press:continue")).toBe(continueAllowed);
    cf.willContinue = true;
    expect(engine.decision()!.options.some(o => o.id === "press:end")).toBe(endAllowed);
  });
  it("Drawing Out the Beast cannot be played against an ally", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { blood: 5, disciplines: { ani: "superior" } });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, makeAlly("M", "Bob", 5));
    state.seats[0]!.hand.push({ id: "frenzy", name: "Drawing Out the Beast" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Drawing Out the Beast"))).toBe(false);
  });
  it("does not inflict press-step damage when a combat-ends strike skips the press step", () => {
    const { state, engine, foe } = setup("Drawing Out the Beast", "superior");
    foe.disciplines.pre = "basic";
    state.seats[1]!.hand.push({ id: "majesty", name: "Majesty" });
    let played = false;
    for (let i = 0; i < 150 && state.frames.some(f => f.kind === "combat"); i++) {
      const dp = engine.decision()!;
      const majesty = dp.options.find(o => o.id.startsWith("play:Majesty:basic"));
      if (majesty) { engine.choose(majesty.id); played = true; continue; }
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(played).toBe(true);
    expect(state.eventLog.some(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toBe(false);
  });
  it("Drawing Out the Beast keeps its strength and press-step damage into a second round", () => {
    const { state, engine, cf } = setup("Drawing Out the Beast", "superior");
    expect(cf.strengthBonus.opposing).toBe(1);
    cf.pressesCombat.acting = 1;
    let continued = false;
    for (let i = 0; i < 120 && cf.round < 2; i++) {
      const dp = engine.decision()!;
      const press = dp.options.find(o => o.id === "press:continue");
      if (press && dp.seat === "Alice" && !continued) { engine.choose(press.id); continued = true; continue; }
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(cf.round).toBe(2);
    expect(cf.strengthBonus.opposing).toBe(1);
    for (let i = 0; i < 100; i++) {
      const events = state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null);
      if (events.length >= 2) break;
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(2);
  });
  it("inflicts and mends press-step damage before offering a press", () => {
    const { state, engine, cf, foe } = setup("Drawing Out the Beast", "superior");
    foe.blood = 2;
    cf.presses.acting = 1;
    for (let i = 0; i < 100 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(engine.decision()!.window).toBe("combat.press");
    expect(foe.blood).toBe(1);
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(1);
    expect(engine.decision()!.options.some(o => o.id === "press:continue")).toBe(true);
    engine.choose("press:continue");
    const damageIndex = state.eventLog.findIndex(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null);
    const pressIndex = state.eventLog.findIndex(e => e.type === "PressUsed");
    expect(pressIndex).toBeGreaterThan(damageIndex);
  });

  it("preserves completed press-step damage when saved and restored at the press decision", () => {
    const { state, engine, cf } = setup("Drawing Out the Beast", "superior");
    cf.presses.acting = 1;
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(engine.decision()!.window).toBe("combat.press");
    const saved = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(saved, testRegistry);
    expect(resumed.decision()!.window).toBe("combat.press");
    expect(saved.eventLog.filter((e: { type: string; minion?: string; source?: string | null }) =>
      e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(1);
    resumed.choose("press:continue");
    expect(saved.eventLog.filter((e: { type: string; minion?: string; source?: string | null }) =>
      e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(1);
  });

  it("Bloodform immunity still applies to unpreventable non-aggravated press damage", () => {
    const { state, engine, foe } = setup("Drawing Out the Beast", "superior");
    foe.disciplines = { vic: "superior" };
    state.seats[1]!.hand.push({ id: "form", name: "Bloodform" });
    runTrace(engine, [["Alice", "pass"], ["Bob", "play:Bloodform:superior:M:form"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(engine.decision()!.window).toBe("combat.press");
    expect(foe.blood).toBe(10);
    expect(state.eventLog.some(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toBe(true);
    expect(state.eventLog.some(e => e.type === "DamageMended" && e.minion === "M")).toBe(false);
  });

  it.each(["basic", "superior"] as const)("Flesh of Marble %s does not prevent the unpreventable press damage", (level) => {
    const { state, engine, foe } = setup("Drawing Out the Beast", "superior");
    state.seats[0]!.minions[0]!.strength = 1;
    Object.assign(foe, { disciplines: { pro: "superior" }, blood: 5 });
    state.seats[1]!.hand.push({ id: "flesh", name: "Flesh of Marble" });
    runTrace(engine, [["Alice", "pass"], ["Bob", `play:Flesh of Marble:${level}:M:flesh`],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    for (let i = 0; i < 150 && engine.decision()?.window !== "combat.press"; i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(engine.decision()!.window).toBe("combat.press");
    // One hand strike plus the unpreventable environmental damage.
    expect(foe.blood).toBe(3);
    expect(state.eventLog.filter(e => e.type === "DamagePrevented" && e.minion === "M")).toHaveLength(0);
  });

  it("ends combat before a press if the press-step damage sends its victim to torpor", () => {
    const { state, engine, cf, foe } = setup("Drawing Out the Beast", "superior");
    foe.blood = 0;
    cf.presses.acting = 1;
    for (let i = 0; i < 150 && state.frames.some(f => f.kind === "combat"); i++) {
      const dp = engine.decision()!;
      expect(dp.window).not.toBe("combat.press");
      const pick = dp.options.find(o => o.id === "pass") ?? dp.options.find(o => o.id === "strike:hand");
      if (!pick) throw new Error(`no option in ${dp.window}`);
      engine.choose(pick.id);
    }
    expect(foe.inTorpor || foe.torporPending).toBe(true);
    expect(state.eventLog.some(e => e.type === "PressUsed")).toBe(false);
    expect(state.eventLog.filter(e => e.type === "DamageInflicted" && e.minion === "M" && e.source === null)).toHaveLength(1);
  });

  it("Tranquility Shield removes the frenzy's combat-long riders", () => {
    const { state, engine, cf, foe } = setup("Drawing Out the Beast", "superior");
    Object.assign(foe, { clan: "Salubri", disciplines: { for: "basic" } });
    state.seats[1]!.hand.push({ id: "shield", name: "Tranquility Shield" });
    expect(cf.strengthBonus.opposing).toBe(1);
    expect(cf.pressStepDamageCombat?.opposing).toBe(1);
    runTrace(engine, [["Alice", "pass"], ["Bob", "play:Tranquility Shield:basic:M:shield"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(cf.strengthBonus.opposing).toBe(0);
    expect(cf.pressStepDamageCombat?.opposing).toBe(0);
    expect(cf.frenzyDirection?.opposing).toEqual({});
    expect(cf.restrict.opposing.equipment).toBe(false);
  });

  it("Tranquility Shield preserves an independent press ban played after the frenzy, across save/load", () => {
    const { state, engine, cf, foe } = setup("Terror Frenzy");
    state.seats[0]!.minions[0]!.disciplines.nec = "superior";
    Object.assign(foe, { clan: "Salubri", disciplines: { for: "basic" } });
    state.seats[0]!.hand.push({ id: "blight", name: "Blight" });
    state.seats[1]!.hand.push({ id: "shield", name: "Tranquility Shield" });
    runTrace(engine, [["Alice", "play:Blight:superior:V1:blight"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(cf.restrict.opposing).toEqual({ maneuver: false, press: true, equipment: true });
    const saved = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(saved, testRegistry);
    runTrace(resumed, [["Alice", "pass"], ["Bob", "play:Tranquility Shield:basic:M:shield"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const after = saved.frames.find((f: { kind: string }) => f.kind === "combat");
    expect(after.restrict.opposing).toEqual({ maneuver: false, press: true, equipment: false });
    expect(after.frenzyDirection.opposing).toEqual({});
  });

  it("retains a non-frenzy equipment restriction applied after Drawing Out the Beast", () => {
    const { state, engine, cf, foe } = setup("Drawing Out the Beast");
    Object.assign(foe, { clan: "Salubri", disciplines: { for: "basic", ani: "basic" } });
    state.seats[1]!.hand.push({ id: "conquer", name: "Conquer the Beast" }, { id: "shield", name: "Tranquility Shield" });
    runTrace(engine, [["Alice", "pass"], ["Bob", "play:Conquer the Beast:basic:M:conquer"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(cf.restrict.acting.equipment).toBe(false);
    runTrace(engine, [["Alice", "pass"], ["Bob", "play:Tranquility Shield:basic:M:shield"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(cf.restrict.opposing.equipment).toBe(true);
    expect(cf.restrict.acting.equipment).toBe(false);
    expect(cf.frenzyDirection?.opposing).toEqual({});
  });

  it("retains an equipment restriction applied before the frenzy", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { blood: 6, capacity: 8, disciplines: { ani: "basic" } });
    const foe = state.seats[1]!.minions.find(m => m.id === "M")!;
    Object.assign(foe, { blood: 6, capacity: 8, clan: "Salubri", disciplines: { ani: "basic", for: "basic" } });
    state.seats[0]!.hand.push({ id: "frenzy", name: "Drawing Out the Beast" });
    state.seats[1]!.hand.push({ id: "conquer", name: "Conquer the Beast" }, { id: "shield", name: "Tranquility Shield" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "play:Conquer the Beast:basic:M:conquer"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Drawing Out the Beast:basic:V1:frenzy"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "play:Tranquility Shield:basic:M:shield"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const cf = state.frames.find(f => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    expect(cf.restrict.opposing.equipment).toBe(true);
    expect(cf.restrict.acting.equipment).toBe(false);
    expect(cf.frenzyDirection?.opposing).toEqual({});
  });

  it("keeps ambiguous restriction flags on a legacy save without provenance", () => {
    const { state, cf, foe } = setup("Terror Frenzy");
    delete cf.nonFrenzyRestrict;
    Object.assign(foe, { clan: "Salubri", disciplines: { for: "basic" } });
    state.seats[1]!.hand.push({ id: "shield", name: "Tranquility Shield" });
    const resumed = new VtesEngine(JSON.parse(JSON.stringify(state)), testRegistry);
    runTrace(resumed, [["Alice", "pass"], ["Bob", "play:Tranquility Shield:basic:M:shield"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    const after = resumed.state.frames.find(f => f.kind === "combat");
    if (!after || after.kind !== "combat") throw new Error("no combat");
    expect(after.restrict.opposing.equipment).toBe(true);
  });

  it("also applies direction restrictions to maneuver and press cards", () => {
    const { state, engine, cf, foe } = setup("Terror Frenzy");
    foe.disciplines = { cel: "superior" };
    state.seats[1]!.hand.push({ id: "pursuit", name: "Pursuit" }, { id: "press", name: "Boxed In" });
    cf.step = "range"; cf.awaiting = "opposing"; cf.range = "long";
    expect(engine.decision()!.options.some(o => o.id.includes("Pursuit"))).toBe(false);
    cf.range = "close";
    expect(engine.decision()!.options.some(o => o.id.includes("Pursuit"))).toBe(true);
    cf.step = "press"; cf.willContinue = false;
    expect(engine.decision()!.options.some(o => o.id.includes("Boxed In"))).toBe(false);
    cf.willContinue = true;
    expect(engine.decision()!.options.some(o => o.id.includes("Boxed In"))).toBe(true);
  });

  it("a Mob Connections press is continue-only and still respects Terror Frenzy", () => {
    const { state, engine, cf } = setup("Terror Frenzy");
    state.seats[1]!.permanents.push({ card: { id: "mob", name: "Mob Connections" }, controller: "Bob", locked: false, usedThisPhase: false, statics: {}, tags: [] });
    cf.step = "press"; cf.awaiting = "opposing"; cf.willContinue = false;
    expect(engine.decision()!.options.map(o => o.id)).toContain("ability:Mob Connections:mob:press");
    engine.choose("ability:Mob Connections:mob:press");
    expect(cf.pressesContinueOnly?.opposing).toBe(1);
    expect(engine.decision()!.options.some(o => o.id === "press:continue")).toBe(false);
    cf.willContinue = true;
    expect(engine.decision()!.options.some(o => o.id === "press:end")).toBe(false);
  });

  it.each([["hand", 2], ["weapon", 1], ["card", 4]] as const)("Rage of Apedemak bonus distinguishes %s strike damage", (kind, expected) => {
    const { state, engine, cf } = setup("Rage of Apedemak", "superior");
    const actor = state.seats[0]!.minions[0]!;
    actor.disciplines.pot = "basic";
    actor.attached.push({ card: { id: "femur", name: "Femur of Toomler" }, locked: false, usedThisPhase: false, statics: {}, tags: ["weapon"] });
    state.seats[0]!.hand.push({ id: "rh", name: "Roundhouse" });
    expect(cf.strengthBonus.acting).toBe(0);
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    if (kind === "hand") engine.choose("strike:hand");
    else if (kind === "weapon") engine.choose("ability:Femur of Toomler:femur:strike");
    else {
      engine.choose("play:Roundhouse:basic:V1:rh");
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    }
    engine.choose("strike:hand");
    for (let i = 0; i < 40 && !state.eventLog.some(e => e.type === "DamageInflicted" && e.minion === "M"); i++) {
      const dp = engine.decision()!;
      engine.choose((dp.options.find(o => o.id === "pass") ?? dp.options[0]!).id);
    }
    const hit = state.eventLog.find(e => e.type === "DamageInflicted" && e.minion === "M");
    expect(hit).toMatchObject({ amount: expected });
  });

});

describe("Terror Frenzy against allies", () => {
  it("offers basic against a minion, not superior which names a vampire", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { blood: 5, disciplines: { ani: "superior" } });
    Object.assign(state.seats[1]!.minions.find(m => m.id === "M")!, makeAlly("M", "Bob", 5));
    state.seats[0]!.hand.push({ id: "frenzy", name: "Terror Frenzy" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Terror Frenzy:basic"))).toBe(true);
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Terror Frenzy:superior"))).toBe(false);
  });
});
