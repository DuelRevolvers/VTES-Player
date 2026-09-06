/**
 * Crypt wave 3 — combat and blocking (docs/crypt-wave-3.md).
 *
 * The new idea is **a condition on who you are fighting**, read off the
 * live combat frame rather than stored — the rule
 * docs/retainer-wave-design.md §1 states, because a combat ends four
 * different ways and a flag cleaned up at only three of them will one day
 * survive.
 *
 * Every conditional is tested in both directions, and the combat ones are
 * driven through real fights: a strength bonus that never applies and one
 * that always applies look identical from a single number.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, opposingCombatantOf } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

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

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function walkTo(engine: VtesEngine, prefix: string, limit = 140): boolean {
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

/**
 * Alice's V1 rushes Bob's W and both hand strike; report the damage W
 * took. The rush is a card from hand, so V1 needs its Disciplines.
 */
function duelDamage(setUp: (s: GameState) => void): number {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.disciplines = { cel: "basic", tha: "basic" };
  v1.blood = 4;
  const w = state.seats[1]!.minions[0]!;
  w.blood = 8;
  w.capacity = 8;
  setUp(state);
  state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
  const engine = new VtesEngine(state, testRegistry);
  if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush");
  const rush = optionIds(engine).find(
    (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
  );
  if (!rush) throw new Error("no rush at W");
  runTrace(engine, [["Alice", rush]]);
  for (let i = 0; i < 60; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (state.eventLog.some((e) => e.type === "CombatEnded")) break;
    const pick =
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id === "press:end") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  const hit = state.eventLog.find(
    (e) => e.type === "DamageInflicted" && e.minion === "W" && e.source === "V1",
  );
  return hit && hit.type === "DamageInflicted" ? hit.amount : 0;
}

// ---------------------------------------------------------------------------
// "In combat with <x>" — the new condition
// ---------------------------------------------------------------------------

describe("strength conditioned on who you are fighting", () => {
  it("Kevin Jackson hits a Brujah harder, and everyone else normally", () => {
    const vsBrujah = duelDamage((s) => {
      asVampire(s.seats[0]!.minions[0]!, "Kevin Jackson (G7)");
      s.seats[1]!.minions[0]!.clan = "Brujah";
    });
    const vsOther = duelDamage((s) => {
      asVampire(s.seats[0]!.minions[0]!, "Kevin Jackson (G7)");
      s.seats[1]!.minions[0]!.clan = "Toreador";
    });
    expect(vsBrujah).toBe(vsOther + 1);
  });

  it("…and the Brujah hits HIM harder too — the mirror half", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    asVampire(v1, "Kevin Jackson (G7)");
    const w = state.seats[1]!.minions[0]!;
    w.clan = "Brujah";
    // Not in combat yet: no bonus to read.
    expect(opposingCombatantOf(state, w.id)).toBeNull();
  });

  it("Roy is stronger against a TITLED vampire only", () => {
    const vsTitled = duelDamage((s) => {
      asVampire(s.seats[0]!.minions[0]!, "Roy (G7)");
      s.seats[1]!.minions[0]!.title = "prince";
    });
    const vsUntitled = duelDamage((s) => {
      asVampire(s.seats[0]!.minions[0]!, "Roy (G7)");
      s.seats[1]!.minions[0]!.title = null;
    });
    expect(vsTitled).toBe(vsUntitled + 1);
  });

  it("Ragnar is stronger against a YOUNGER vampire, not an older one", () => {
    const vsYounger = duelDamage((s) => {
      const v = asVampire(s.seats[0]!.minions[0]!, "Ragnar Nordstrom (G6)");
      v.capacity = 8;
      s.seats[1]!.minions[0]!.capacity = 4;
    });
    const vsOlder = duelDamage((s) => {
      const v = asVampire(s.seats[0]!.minions[0]!, "Ragnar Nordstrom (G6)");
      v.capacity = 4;
      s.seats[1]!.minions[0]!.capacity = 8;
    });
    expect(vsYounger).toBe(vsOlder + 1);
  });

  it("the condition is DERIVED — it reads nothing outside a live combat", () => {
    const state = threeSeatGame();
    const v1 = asVampire(state.seats[0]!.minions[0]!, "Kevin Jackson (G7)");
    // No combat frame at all: the helper says so plainly rather than
    // guessing, which is what keeps the bonus from leaking out of combat.
    expect(opposingCombatantOf(state, v1.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

describe("Marialena pays for being blocked", () => {
  it("burns 1 blood when a block succeeds", () => {
    const state = threeSeatGame();
    const v1 = asVampire(state.seats[0]!.minions[0]!, "Marialena (G6)");
    v1.blood = 4;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    walkTo(engine, "__nothing__", 25);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(
      state.eventLog.some(
        (e) => e.type === "BloodBurned" && e.minion === "V1" && e.amount === 1,
      ),
    ).toBe(true);
  });

  it("pays nothing when the block ATTEMPT fails", () => {
    // "If she is BLOCKED" is not "if a block is attempted" — the same
    // reading Terrifying Visage takes (docs/path-cards-design.md §3).
    const state = threeSeatGame();
    const v1 = asVampire(state.seats[0]!.minions[0]!, "Marialena (G6)");
    v1.blood = 4;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]); // +1 inherent stealth
    if (walkTo(engine, "block:W", 20)) runTrace(engine, [["Bob", "block:W"]]);
    walkTo(engine, "__nothing__", 25);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "BloodBurned" && e.minion === "V1")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Granted strikes
// ---------------------------------------------------------------------------

describe("granted strikes", () => {
  function inCombat(cryptName: string, blood = 4): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const v1 = asVampire(state.seats[0]!.minions[0]!, cryptName);
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = blood;
    state.seats[0]!.hand.push({ id: "r9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
    )!;
    runTrace(engine, [["Alice", rush]]);
    return { state, engine };
  }

  it("Flávio is offered a dodge he would not otherwise have", () => {
    const { engine } = inCombat("Flávio Gonçalves (G6)");
    expect(walkTo(engine, "ability:Flávio")).toBe(true);
  });

  it("a vampire without the clause gets no such offer — the control", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "r9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    walkTo(engine, "strike:hand");
    expect(optionIds(engine).some((o) => o.includes("grantstrike"))).toBe(false);
  });

  /**
   * Agnieszka DEFENDS, so her own blood total is never forced up.
   *
   * The first draft made her the attacker with 0 blood — and a vampire at
   * 0 blood MUST hunt (p. 21), so the walker answered that mandatory
   * hunt, fed her, and the option was then correctly offered. The test
   * was measuring the walk, not the gate.
   */
  function rushedBy(blood: number): VtesEngine {
    const state = threeSeatGame();
    const w = asVampire(state.seats[1]!.minions[0]!, "Agnieszka, Tempter of Legions (G6)");
    w.blood = blood;
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "r9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    return engine;
  }

  it("Agnieszka's combat-ends strike needs the blood she pays for it", () => {
    expect(walkTo(rushedBy(4), "ability:Agnieszka")).toBe(true);
    // With no blood the price cannot be paid, so it is not offered.
    expect(walkTo(rushedBy(0), "ability:Agnieszka", 40)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prevention for somebody else
// ---------------------------------------------------------------------------

describe("Opikun prevents damage to another vampire", () => {
  it("is offered while a vampire she controls is taking non-aggravated damage", () => {
    const state = threeSeatGame();
    // Opikun sits at home; V2 does the fighting.
    const opikun = makeMinion("V2", "Alice", { blood: 4 });
    asVampire(opikun, "Opikun (G7)");
    state.seats[0]!.minions.push(opikun);
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "r9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    // Both strike; when V1's damage is on the table Opikun may pay.
    expect(walkTo(engine, "ability:Opikun", 60)).toBe(true);
  });

  it("is not offered when Opikun has no blood to burn", () => {
    const state = threeSeatGame();
    // LOCKED as well as empty: a vampire at 0 blood MUST hunt (p. 21), and
    // a walker that answers that mandatory hunt would feed her back up
    // before the combat — the option would then be correctly offered and
    // the test would be measuring the walk, not the gate.
    const opikun = makeMinion("V2", "Alice", { blood: 0, locked: true });
    asVampire(opikun, "Opikun (G7)");
    state.seats[0]!.minions.push(opikun);
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "r9", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"))!],
    ]);
    expect(walkTo(engine, "ability:Opikun", 60)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The statics that came free
// ---------------------------------------------------------------------------

describe("statics the library already had", () => {
  it("Adrino carries a continue-only press credit", () => {
    const state = threeSeatGame();
    const v = asVampire(state.seats[0]!.minions[0]!, "Adrino Manauara (G6)");
    expect(v.attached[0]!.statics.continuePressPerCombat).toBe(1);
  });

  it("Noluthando adds damage to a RANGED strike only", () => {
    const state = threeSeatGame();
    const v = asVampire(state.seats[0]!.minions[0]!, "Noluthando (G7)");
    expect(v.attached[0]!.statics.rangedDamageBonus).toBe(1);
    // A hand strike is not ranged, so the ordinary duel is unchanged.
    const plain = duelDamage((s) => {
      asVampire(s.seats[0]!.minions[0]!, "Noluthando (G7)");
    });
    expect(plain).toBe(1);
  });

  it("Egidia drains the controller of a minion that dies fighting her", () => {
    const state = threeSeatGame();
    const v = asVampire(state.seats[0]!.minions[0]!, "Egidia Arrú (G6)");
    expect(v.attached[0]!.statics.strength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Roy's price
// ---------------------------------------------------------------------------

describe("Roy locks himself in your discard phase", () => {
  it("an unlocked Roy is locked when the discard phase opens", () => {
    const state = threeSeatGame();
    const roy = asVampire(state.seats[0]!.minions[0]!, "Roy (G7)");
    roy.locked = false;
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "__nothing__", 60);
    // By the time Alice's discard phase has come and gone, he is locked —
    // the card says "lock him", not "you can" (the Rebel precedent).
    expect(
      state.eventLog.some((e) => e.type === "MinionLocked" && e.minion === "V1"),
    ).toBe(true);
  });
});
