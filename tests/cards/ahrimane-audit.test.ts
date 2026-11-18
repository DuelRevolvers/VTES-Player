import { describe, expect, it } from "vitest";
import { VtesEngine, currentIntercept, currentStealth, playCostFor } from "../../src/engine/index.ts";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();
function asVampire(m: MinionState, name: string) {
  const self = handlers[name]?.cryptEntry?.();
  if (!self) throw new Error(`missing ${name}`);
  m.attached.push({ card: { id: m.id, name }, controller: m.controller, owner: m.controller, locked: false, usedThisPhase: false, statics: self.statics, tags: self.tags });
  return m;
}
function ids(engine: VtesEngine) { return engine.decision()?.options.map((o) => o.id) ?? []; }
function walk(engine: VtesEngine, prefix: string, limit = 150) {
  for (let n = 0; n < limit; n++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const choice = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, choice.id]]);
  }
  return false;
}
function find(s: GameState, id: string) {
  const m = s.seats.flatMap((s) => s.minions).find((m) => m.id === id);
  if (!m) throw new Error(`missing ${id}`);
  return m;
}

describe("Darlene Killian", () => {
  it("will not offer a retainer she cannot afford and allows another vampire to employ it", () => {
    const s = threeSeatGame();
    const d = asVampire(find(s, "V1"), "Darlene Killian (G5)");
    Object.assign(d, { blood: 1, disciplines: { ani: "basic" } });
    s.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 1, disciplines: { ani: "basic" } }));
    s.seats[0]!.hand.push({ id: "raven", name: "Raven Spy" });
    const opts = ids(new VtesEngine(s, testRegistry)).filter((id) => id.startsWith("play:Raven Spy:"));
    expect(opts.some((id) => id.includes(":V1:"))).toBe(false);
    expect(opts.some((id) => id.includes(":V2:"))).toBe(true);
  });
  it("adds one blood to allies and retainers, not equipment or another vampire", () => {
    const s = threeSeatGame();
    const m = asVampire(find(s, "V1"), "Darlene Killian (G5)");
    const cost = { name: "test", bloodCost: 0, poolCost: 2, requires: [] };
    for (const type of ["ally", "retainer"] as const) {
      expect(playCostFor(s, { ...cost, types: [type] }, m, null, null)).toEqual({ blood: 1, pool: 2 });
      expect(playCostFor(s, { ...cost, types: [type] }, find(s, "W"), null, null)).toEqual({ blood: 0, pool: 2 });
    }
    expect(playCostFor(s, { ...cost, types: ["equipment"] }, m, null, null)).toEqual({ blood: 0, pool: 2 });
  });
});

describe("Muricia", () => {
  function game(phase: "unlock" | "minion" = "unlock") {
    const s = threeSeatGame();
    asVampire(find(s, "V1"), "Muricia (G4)");
    s.seats[0]!.minions.push(makeMinion("G1", "Alice", { clan: "Gangrel antitribu", blood: 2 }));
    const turn = s.frames[0]!;
    if (turn.kind !== "turn") throw new Error("no turn");
    turn.phase = phase;
    if (phase === "unlock") {
      turn.unlockDone = false;
      turn.unlockAbilitiesDone = false;
    }
    return { s, e: new VtesEngine(s, testRegistry) };
  }
  it.each([undefined, "basic", "superior"] as const)("converts one Gangrel antitribu, gaining a level from %s", (level) => {
    const { s, e } = game();
    const target = find(s, "G1");
    if (level) target.disciplines.spi = level;
    expect(walk(e, "ability:Muricia (G4):V1:transform:G1", 5)).toBe(true);
    e.choose("ability:Muricia (G4):V1:transform:G1");
    expect(target).toMatchObject({ clan: "Ahrimane", sterile: true, blood: 1, disciplines: { spi: level ? "superior" : "basic" } });
    expect(s.eventLog.some((ev) => ev.type === "VampireTransformed" && ev.minion === "G1")).toBe(true);
    expect(ids(e).some((id) => id.includes(":transform:"))).toBe(false);
  });
  it("allows locked and torpid targets but not another controller, wrong clan, or no blood", () => {
    const { s, e } = game();
    Object.assign(find(s, "G1"), { locked: true, inTorpor: true });
    s.seats[0]!.minions.push(makeMinion("empty", "Alice", { clan: "Gangrel antitribu", blood: 0 }));
    s.seats[0]!.minions.push(makeMinion("wrong", "Alice", { clan: "Gangrel", blood: 2 }));
    Object.assign(find(s, "W"), { clan: "Gangrel antitribu", blood: 2 });
    const opts = ids(e).filter((id) => id.includes(":transform:"));
    expect(opts).toEqual(["ability:Muricia (G4):V1:transform:G1"]);
  });
  it("is not offered outside your unlock phase", () => {
    const { e } = game("minion");
    expect(ids(e).some((id) => id.includes(":transform:"))).toBe(false);
  });
  it("a chosen impersonation moved to another vampire restores the old bearer and affects the new one", () => {
    const s = threeSeatGame();
    const first = find(s, "V1");
    Object.assign(first, { clan: "Ahrimane", blood: 5 });
    const second = makeMinion("V2", "Alice", { clan: "Brujah", blood: 4 });
    s.seats[0]!.minions.push(second);
    s.seats[0]!.hand.push({ id: "ci", name: "Clan Impersonation" });
    const e = new VtesEngine(s, testRegistry);
    e.choose(ids(e).find((id) => id.startsWith("play:Clan Impersonation:") && id.includes(":V1:"))!);
    expect(walk(e, "choice:Clan Impersonation:ci:clan:")).toBe(true);
    e.choose("choice:Clan Impersonation:ci:clan:Gangrel antitribu");
    e.moveAttachment("ci", "V2");
    expect(first.clan).toBe("Ahrimane");
    expect(second.clan).toBe("Gangrel antitribu");
    e.burnPermanent("ci");
    expect(second.clan).toBe("Brujah");
  });
  it("suspends Clan Impersonation in the uncontrolled region and restores it before scarce is assessed", () => {
    const s = threeSeatGame();
    const target = find(s, "V1");
    Object.assign(target, { name: "scarce vampire", clan: "Ahrimane", blood: 5, capacity: 5, scarce: true });
    s.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Gangrel antitribu" }));
    s.seats[0]!.hand.push({ id: "ci", name: "Clan Impersonation" });
    const e = new VtesEngine(s, testRegistry);
    e.choose(ids(e).find((id) => id.startsWith("play:Clan Impersonation:") && id.includes(":V1:"))!);
    expect(walk(e, "choice:Clan Impersonation:ci:clan:")).toBe(true);
    e.choose("choice:Clan Impersonation:ci:clan:Gangrel antitribu");
    expect(walk(e, "end")).toBe(true);
    e.emit({ type: "MovedToUncontrolled", seat: "Alice", minion: "V1" });
    expect(target.clan).toBe("Ahrimane");
    const u = s.seats[0]!.uncontrolled.find((x) => x.card.id === "V1")!;
    u.counters = 5;
    const tf = s.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn");
    tf.phase = "influence"; tf.transfersLeft = 0;
    const option = e.decision()!.options.find((o) => o.id === "inf:out:V1");
    expect(option?.kind === "influenceOut" && option.poolBurn).toBe(3);
    const pool = s.seats[0]!.pool;
    e.choose("inf:out:V1");
    expect(target.clan).toBe("Gangrel antitribu");
    expect(s.seats[0]!.pool).toBe(pool - 3);
    expect(target.attached.some((p) => p.card.id === "ci")).toBe(true);
  });
  it("an impersonation played after transformation can be burned as an undirected action", () => {
    const s = threeSeatGame();
    const target = find(s, "V1");
    Object.assign(target, { clan: "Gangrel antitribu", sect: "sabbat", blood: 5, capacity: 6 });
    s.seats[0]!.hand.push({ id: "ci", name: "Clan Impersonation" });
    const e = new VtesEngine(s, testRegistry);
    e.emit({ type: "VampireTransformed", minion: "V1", clan: "Ahrimane", sterile: true });
    e.choose(ids(e).find((id) => id.startsWith("play:Clan Impersonation:") && id.includes(":V1:"))!);
    expect(walk(e, "choice:Clan Impersonation:ci:clan:")).toBe(true);
    e.choose("choice:Clan Impersonation:ci:clan:Gangrel antitribu");
    expect(target.clan).toBe("Gangrel antitribu");
    expect(walk(e, "end")).toBe(true);
    e.emit({ type: "MinionUnlocked", minion: "V1" });
    expect(walk(e, "act:Clan Impersonation:ci:burn:V1")).toBe(true);
    e.choose("act:Clan Impersonation:ci:burn:V1");
    const af = s.frames.find((f) => f.kind === "action");
    expect(af && af.kind === "action" && af.directed).toBe(false);
    expect(walk(e, "end")).toBe(true);
    expect(target.clan).toBe("Ahrimane");
    expect(target.sterile).toBe(true);
    expect(s.seats[0]!.ashHeap?.some((c) => c.id === "ci")).toBe(true);
  });
  it("Clan Impersonation can restore eligibility and burning it reveals the later transformation", () => {
    const s = threeSeatGame();
    const muricia = asVampire(find(s, "V1"), "Muricia (G4)");
    const target = makeMinion("G1", "Alice", { clan: "Ahrimane", sect: "sabbat", blood: 5, capacity: 6 });
    s.seats[0]!.minions.push(target);
    s.seats[0]!.hand.push({ id: "ci", name: "Clan Impersonation" });
    const e = new VtesEngine(s, testRegistry);
    const play = ids(e).find((id) => id.startsWith("play:Clan Impersonation:") && id.includes(":G1:"));
    expect(play).toBeDefined();
    e.choose(play!);
    expect(walk(e, "choice:Clan Impersonation:ci:clan:")).toBe(true);
    e.choose("choice:Clan Impersonation:ci:clan:Gangrel antitribu");
    expect(target.clan).toBe("Gangrel antitribu");
    expect(target.blood).toBe(3);
    expect(walk(e, "end")).toBe(true);
    const tf = s.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn");
    // Start Alice's next unlock window with the resolved attachment intact.
    s.frames = [tf];
    tf.seat = "Alice"; tf.phase = "unlock"; tf.unlockDone = false; tf.unlockAbilitiesDone = false;
    expect(walk(e, "ability:Muricia (G4):V1:transform:G1", 5)).toBe(true);
    e.choose("ability:Muricia (G4):V1:transform:G1");
    // The temporary Clan Impersonation still overlays Muricia's permanent
    // change; burning the card exposes the new underlying clan.
    expect(target).toMatchObject({ clan: "Gangrel antitribu", sterile: true, blood: 2, disciplines: { spi: "basic" } });
    e.burnPermanent("ci");
    expect(target.clan).toBe("Ahrimane");
    expect(target.disciplines.spi).toBe("basic");
    expect(muricia.blood).toBe(2);
  });
});

describe("Sylvie Helgon", () => {
  it("discards a political action for needed intercept while blocking", () => {
    const s = threeSeatGame();
    asVampire(find(s, "W"), "Sylvie Helgon (G6)");
    find(s, "V1").blood = 2;
    s.seats[1]!.hand.push({ id: "vote", name: "Kine Resources Contested" });
    const e = new VtesEngine(s, testRegistry);
    e.choose("hunt:V1");
    expect(walk(e, "block:W")).toBe(true);
    e.choose("block:W");
    e.choose("pass");
    const opt = ids(e).find((id) => id.includes(":discardFor:intercept:vote"));
    expect(opt).toBeDefined();
    e.choose(opt!);
    const af = s.frames.find((f) => f.kind === "action");
    if (!af || af.kind !== "action") throw new Error("no action");
    expect(currentIntercept(s, af.actionId, "W")).toBe(1);
    expect(s.seats[1]!.ashHeap?.some((c) => c.id === "vote")).toBe(true);
  });
  it("discards a political action for stealth only when needed", () => {
    const s = threeSeatGame();
    const sylvie = asVampire(find(s, "V1"), "Sylvie Helgon (G6)");
    sylvie.blood = 2;
    s.seats[0]!.hand.push({ id: "vote", name: "Kine Resources Contested" }, { id: "vote2", name: "Kine Resources Contested" });
    const blocker = find(s, "W");
    blocker.attached.push({ card: { id: "radio", name: "KRCG News Radio" }, controller: "Bob", owner: "Bob", locked: false, usedThisPhase: false, statics: { intercept: 1 }, tags: [] });
    const e = new VtesEngine(s, testRegistry);
    expect(walk(e, "hunt:V1")).toBe(true);
    e.choose("hunt:V1");
    expect(ids(e).some((id) => id.includes(":discardFor:"))).toBe(false);
    expect(walk(e, "block:W")).toBe(true);
    e.choose("block:W");
    const opt = ids(e).find((id) => id.includes(":discardFor:stealth:vote"));
    expect(opt).toBeDefined();
    e.choose(opt!);
    const af = s.frames.find((f) => f.kind === "action");
    if (!af || af.kind !== "action") throw new Error("no action");
    expect(currentStealth(s, af.actionId)).toBe(2);
    expect(s.seats[0]!.ashHeap?.some((c) => c.id === "vote")).toBe(true);
    expect(currentIntercept(s, af.actionId, "W")).toBe(1);
    expect(af.usedInPlayAbilities).toContain("V1");
    blocker.attached[0]!.statics.intercept = 2;
    expect(ids(e).some((id) => id.includes(":discardFor:stealth:vote2"))).toBe(false);
  });
});

describe("Aiyana, The Wolfcatcher", () => {
  function fight(werewolf: boolean, blood = 6) {
    const s = threeSeatGame();
    const a = asVampire(find(s, "V1"), "Aiyana, The Wolfcatcher (G4)");
    Object.assign(a, { blood, strength: 0 });
    const foe = find(s, "M");
    Object.assign(foe, { blood: 6, strength: 3, kind: "ally" });
    foe.attached.push({ card: { id: foe.id, name: "wolf body" }, controller: "Bob", owner: "Bob", locked: false, usedThisPhase: false, statics: {}, tags: werewolf ? ["werewolf"] : ["animal"] });
    const e = new VtesEngine(s, testRegistry);
    runTrace(e, [
      ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const cf = s.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    return { s, e, a, foe, cf };
  }
  function damage(f: ReturnType<typeof fight>) {
    runTrace(f.e, [
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
    ]);
    expect(f.e.decision()?.window).toBe("combat.damageResolution");
  }
  it.each([true, false])("gets a press against a werewolf=%s only", (wolf) => {
    const f = fight(wolf);
    expect(f.cf.pressesCombat.acting).toBe(wolf ? 1 : 0);
  });
  it("pays once and prevents all werewolf damage in the packet", () => {
    const f = fight(true);
    damage(f);
    const before = f.a.blood;
    const id = "ability:Aiyana, The Wolfcatcher (G4):V1:preventFromTag";
    expect(ids(f.e)).toContain(id);
    f.e.choose(id);
    expect(f.a.blood).toBe(before - 1);
    expect(f.s.eventLog).toContainEqual({ type: "DamagePrevented", minion: "V1", amount: 3 });
    expect(f.cf.usedThisRound).toContain("V1");
    expect(f.cf.preventFromTagRound).toContainEqual({ minion: "V1", tag: "werewolf", round: 1 });
  });
  it("also prevents later werewolf packets in the same round, but not environmental damage", () => {
    const f = fight(true);
    damage(f);
    f.cf.pendingDamage.splice(1, 0,
      { minion: "V1", amount: 2, source: "M", aggravated: true },
      { minion: "V1", amount: 1, source: null, aggravated: false });
    f.e.choose("ability:Aiyana, The Wolfcatcher (G4):V1:preventFromTag");
    f.e.decision();
    const prevented = f.s.eventLog.filter((ev) => ev.type === "DamagePrevented" && ev.minion === "V1");
    expect(prevented.map((ev) => ev.type === "DamagePrevented" ? ev.amount : 0)).toEqual([3, 2]);
    expect(f.cf.pendingDamage[0]).toMatchObject({ minion: "V1", source: null, amount: 1 });
    // Simulate the next round with a new packet: last round's shield must
    // not prevent it, and the ability must be available to buy again.
    f.cf.round = 2;
    f.cf.usedThisRound = [];
    f.cf.pendingDamage[0]!.source = "M";
    delete f.cf.damageCycle;
    delete f.cf.damageCycleLen;
    expect(ids(f.e)).toContain("ability:Aiyana, The Wolfcatcher (G4):V1:preventFromTag");
  });
  it("does not offer the shield when she cannot pay", () => {
    const f = fight(true);
    damage(f);
    f.a.blood = 0;
    expect(ids(f.e)).not.toContain("ability:Aiyana, The Wolfcatcher (G4):V1:preventFromTag");
  });
  it("does not offer prevention for non-werewolf or environmental damage", () => {
    const f = fight(false);
    damage(f);
    const id = "ability:Aiyana, The Wolfcatcher (G4):V1:preventFromTag";
    expect(ids(f.e)).not.toContain(id);
    f.cf.pendingDamage[0]!.source = null;
    expect(ids(f.e)).not.toContain(id);
  });
});

describe("Darlene's cost during a real action", () => {
  it.each(["Political Ally", "Raven Spy"])("charges an extra blood on successful %s", (name) => {
    const s = threeSeatGame();
    const d = asVampire(find(s, "V1"), "Darlene Killian (G5)");
    d.blood = 6;
    d.disciplines = { ani: "superior" };
    if (name === "Political Ally") d.clan = "Ventrue";
    s.seats[0]!.hand.push({ id: "card", name });
    const e = new VtesEngine(s, testRegistry);
    const opt = ids(e).find((id) => id.startsWith(`play:${name}:`) && id.includes(":V1:"));
    expect(opt).toBeDefined();
    const before = d.blood;
    runTrace(e, [["Alice", opt!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(d.blood).toBe(before - (name === "Raven Spy" ? 2 : 1));
  });
});

describe("Helen and Howler equipment restrictions", () => {
  function board(name: string) {
    const s = threeSeatGame();
    const m = find(s, "V1");
    if (name) asVampire(m, name);
    m.blood = 6;
    s.seats[0]!.hand.push({ id: "gunhand", name: ".44 Magnum" });
    return { s, m, e: new VtesEngine(s, testRegistry) };
  }
  it("Helen cannot equip normally, while Howler can possess a weapon", () => {
    for (const [name, allowed] of [["Helen Fairchild (G6)", false], ["Howler (G2)", true], ["", true]] as const) {
      const { e } = board(name);
      expect(ids(e).some((id) => id.startsWith("play:.44 Magnum:") && id.includes(":V1:"))).toBe(allowed);
    }
  });
  it.each([["Howler (G2)", false], ["", true]] as const)("%s: a combat card cannot bypass weapon restrictions=%s", (name, allowed) => {
    const { s, m, e } = board(name);
    Object.assign(m, { clan: "Salubri", disciplines: { aus: "basic" } });
    m.attached.push({ card: { id: "sword", name: "Sword of the Archangel" }, controller: "Alice", owner: "Alice", locked: false, usedThisPhase: false, statics: {}, tags: ["equipment", "weapon", "melee"] });
    s.seats[0]!.hand.push({ id: "anticipation", name: "Anticipation" });
    runTrace(e, [
      ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walk(e, "strike:hand", 20)).toBe(true);
    const opts = e.decision()!.options.filter((o) => o.kind === "playCard" && o.name === "Anticipation");
    expect(opts.some((o) => o.kind === "playCard" && o.params.weapon === "sword")).toBe(allowed);
    expect(opts.some((o) => o.kind === "playCard" && !o.params.weapon)).toBe(true);
  });
  it.each([["Howler (G2)", 1], ["", 2]] as const)("%s: weapon press is usable only when allowed", (name, presses) => {
    const { s, m, e } = board(name);
    const h = testRegistry["Talbot's Chainsaw"]!;
    m.attached.push({ card: { id: "chainsaw", name: "Talbot's Chainsaw" }, controller: "Alice", owner: "Alice", locked: false, usedThisPhase: false, statics: h.permanentStatics ?? {}, tags: h.permanentTags ?? [] });
    m.attached.push({ card: { id: "bonus", name: "test retainer" }, locked: false, usedThisPhase: false, statics: { pressPerCombat: 1 }, tags: ["retainer"] });
    runTrace(e, [
      ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const cf = s.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    // The chainsaw's mandatory first-round press sits in its own pool; the
    // retainer's optional press is in pressesCombat. Howler stops both weapon
    // presses, so the usable total is the same as before the mandatory pool.
    expect(cf.pressesCombat.acting + (cf.mandatoryFirstRoundPresses?.acting ?? 0)).toBe(presses);
  });
  it.each([["Helen Fairchild (G6)", false], ["Howler (G2)", false], ["", true]] as const)("%s: gun strike available=%s", (name, allowed) => {
    const { s, m, e } = board(name);
    m.attached.push({ card: { id: "gun", name: ".44 Magnum" }, controller: "Alice", owner: "Alice", locked: false, usedThisPhase: false, statics: {}, tags: ["equipment", "weapon", "gun"] });
    runTrace(e, [
      ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walk(e, "strike:hand", 20)).toBe(true);
    expect(ids(e).some((id) => id.startsWith("ability:.44 Magnum:gun:"))).toBe(allowed);
    const cf = s.frames.find((f) => f.kind === "combat");
    if (!cf || cf.kind !== "combat") throw new Error("no combat");
    if (name === "Howler (G2)") expect(cf.maneuverCredits.acting).toBe(1);
  });
});
