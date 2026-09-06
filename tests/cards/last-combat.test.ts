/**
 * The last four combat cards, and a vest (docs/last-combat-design.md).
 *
 * Dust Up (100597), Taste of Vitae (101945), Hunger of Marduk (102227),
 * Anticipation (102350), Kevlar Vest (101040).
 *
 * This finishes Combat at 0 — the third card type to reach zero after
 * Retainer and (buildably) Master.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 90): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

function equip(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
  find(state, minion).attached.push(p);
  return p;
}

/** Alice's V1 bleeds, Bob's M blocks; combat live at before-range. */
function intoCombat(
  cards: Array<[seat: "Alice" | "Bob", name: string]>,
  disc: { v1?: Record<string, "basic" | "superior">; m?: Record<string, "basic" | "superior"> } = {},
  tweak: (s: GameState) => void = () => {},
) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc.v1 ?? {}, blood: 6, strength: 1 });
  Object.assign(find(state, "M"), { disciplines: disc.m ?? {}, blood: 6, strength: 1 });
  let a = 0;
  let b = 0;
  for (const [seat, name] of cards) {
    if (seat === "Alice") seatOf(state, "Alice").hand.push({ id: `a${a++}`, name });
    else seatOf(state, "Bob").hand.push({ id: `b${b++}`, name });
  }
  tweak(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

function drain(engine: VtesEngine, state: GameState, limit = 120): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Dust Up (100597)", () => {
  it("[ani]: a hand strike at +1 that CANNOT BE DODGED", () => {
    const { state, engine } = intoCombat(
      [["Alice", "Dust Up"], ["Bob", "Blur"]],
      { v1: { ani: "basic" }, m: { cel: "basic" } },
      (s) => {
        Object.assign(find(s, "V1"), { sect: "anarch" });
      },
    );
    expect(walkTo(engine, "play:Dust Up:basic:V1:ani")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Dust Up:basic:V1:ani"))!],
    ]);
    // Bob dodges, and it does not save him.
    expect(walkTo(engine, "strike:hand")).toBe(true);
    const cf = combat(state)!;
    const mySide = cf.acting === "V1" ? "acting" : "opposing";
    const foeSide = mySide === "acting" ? "opposing" : "acting";
    cf.strikes[foeSide] = {
      source: "card",
      name: "dodge",
      handBonus: 0,
      damage: 0,
      ranged: false,
      combatEnds: false,
      unlockSelf: false,
      dodge: true,
      aggravated: false,
      stealBlood: 0,
    };
    const before = find(state, "M").blood;
    drain(engine, state);
    // strength 1 + 1 = 2 damage, mended by burning 2 blood.
    expect(find(state, "M").blood).toBe(before - 2);
  });

  it("CONTROL: an ordinary hand strike IS dodged", () => {
    const { state, engine } = intoCombat([], {}, (s) => {
      Object.assign(find(s, "V1"), { sect: "anarch" });
    });
    expect(walkTo(engine, "strike:hand")).toBe(true);
    const cf = combat(state)!;
    const mySide = cf.acting === "V1" ? "acting" : "opposing";
    const foeSide = mySide === "acting" ? "opposing" : "acting";
    cf.strikes[foeSide] = {
      source: "card",
      name: "dodge",
      handBonus: 0,
      damage: 0,
      ranged: false,
      combatEnds: false,
      unlockSelf: false,
      dodge: true,
      aggravated: false,
      stealBlood: 0,
    };
    const before = find(state, "M").blood;
    drain(engine, state);
    expect(find(state, "M").blood).toBe(before);
  });

  it("its three modes are one per discipline", () => {
    const { engine } = intoCombat([["Alice", "Dust Up"]], {
      v1: { ani: "basic", cel: "basic", pot: "basic" },
    }, (s) => {
      Object.assign(find(s, "V1"), { sect: "anarch" });
    });
    expect(walkTo(engine, "play:Dust Up")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Dust Up"));
    expect(ids.some((o) => o.includes(":ani:"))).toBe(true);
    expect(ids.some((o) => o.includes(":cel:"))).toBe(true);
    expect(ids.some((o) => o.includes(":pot:"))).toBe(true);
  });

  it("NEGATIVE SPACE: a non-Anarch cannot play it", () => {
    const { engine } = intoCombat([["Alice", "Dust Up"]], { v1: { pot: "basic" } });
    expect(walkTo(engine, "play:Dust Up", 25)).toBe(false);
  });
});

describe("Taste of Vitae (101945)", () => {
  it("gains blood equal to the blood the FOE actually burned", () => {
    const { state, engine } = intoCombat([["Alice", "Taste of Vitae"]]);
    expect(walkTo(engine, "strike:hand")).toBe(true);
    // Both strike for 1; each mends by burning 1.
    const myBlood = find(state, "V1").blood;
    expect(walkTo(engine, "play:Taste of Vitae")).toBe(true);
    const cf = combat(state)!;
    const mySide = cf.acting === "V1" ? "acting" : "opposing";
    const foeSide = mySide === "acting" ? "opposing" : "acting";
    expect(cf.bloodLostThisRound?.[foeSide]).toBe(1);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Taste of Vitae"))!],
    ]);
    for (let i = 0; i < 10; i++) {
      const dp = engine.decision();
      if (!dp || state.eventLog.some((e) => e.type === "BloodGained" && e.minion === "V1")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    // The foe burned 1 to mend, so the card is worth exactly 1 — which
    // here happens to offset what V1 burned mending, leaving them level.
    const gain = state.eventLog.filter(
      (e) => e.type === "BloodGained" && e.minion === "V1",
    );
    expect(gain).toEqual([{ type: "BloodGained", minion: "V1", amount: 1 }]);
    expect(find(state, "V1").blood).toBe(myBlood);
  });

  it("BLOOD LOST is not DAMAGE TAKEN: a foe who cannot mend gives less", () => {
    // The distinction the card needs its own tally for (§2): M has 1
    // blood, takes 2 damage, burns only 1 and goes to torpor.
    const { state, engine } = intoCombat([["Alice", "Taste of Vitae"]], {}, (s) => {
      Object.assign(find(s, "V1"), { strength: 2 });
      Object.assign(find(s, "M"), { blood: 1, strength: 0 });
    });
    expect(walkTo(engine, "strike:hand")).toBe(true);
    for (let i = 0; i < 20; i++) {
      const cf = combat(state);
      if (!cf) break;
      if ((cf.bloodLostThisRound?.acting ?? 0) + (cf.bloodLostThisRound?.opposing ?? 0) > 0) break;
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    const cf = combat(state)!;
    const mySide = cf.acting === "V1" ? "acting" : "opposing";
    const foeSide = mySide === "acting" ? "opposing" : "acting";
    // 2 damage inflicted, but only 1 blood lost.
    expect(cf.damageTakenThisRound[foeSide]).toBe(2);
    expect(cf.bloodLostThisRound?.[foeSide]).toBe(1);
  });
});

describe("Hunger of Marduk (102227)", () => {
  it("grants a ranged steal-blood strike for the round", () => {
    const { state, engine } = intoCombat([["Alice", "Hunger of Marduk"]], {
      v1: { tha: "superior" },
    }, (s) => {
      Object.assign(find(s, "V1"), { clan: "Banu Haqim" });
    });
    expect(walkTo(engine, "play:Hunger of Marduk:superior")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunger of Marduk:superior"))!],
    ]);
    expect(walkTo(engine, "strike:stealBlood:2")).toBe(true);
    const foeBlood = find(state, "M").blood;
    const myBlood = find(state, "V1").blood;
    runTrace(engine, [["Alice", "strike:stealBlood:2"]]);
    drain(engine, state);
    // The blood MOVES: 2 off the foe, 2 onto the striker.
    expect(find(state, "M").blood).toBe(foeBlood - 2);
    expect(find(state, "V1").blood).toBeGreaterThan(myBlood - 2);
  });

  it("the grant is ROUND-scoped, not combat-scoped", () => {
    const { state, engine } = intoCombat([["Alice", "Hunger of Marduk"]], {
      v1: { tha: "basic" },
    }, (s) => {
      Object.assign(find(s, "V1"), { clan: "Banu Haqim" });
    });
    expect(walkTo(engine, "play:Hunger of Marduk:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunger of Marduk:basic"))!],
    ]);
    expect(walkTo(engine, "strike:stealBlood:1")).toBe(true);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    expect(cf.grantedStrikes?.[side]).toEqual([
      { kind: "stealBlood", amount: 1, roundOnly: true },
    ]);
    // Force a new round and watch the grant lapse.
    cf.willContinue = true;
    const round = cf.round;
    for (let i = 0; i < 40 && combat(state) && combat(state)!.round === round; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    if (combat(state)) {
      expect(combat(state)!.grantedStrikes?.[side] ?? []).toEqual([]);
    }
  });
});

describe("Anticipation (102350)", () => {
  it("[aus]: a hand strike at +2 — or a MELEE WEAPON strike at +2", () => {
    const { state, engine } = intoCombat([["Alice", "Anticipation"]], {
      v1: { aus: "basic" },
    }, (s) => {
      Object.assign(find(s, "V1"), { clan: "Salubri" });
      equip(s, "V1", "rb", "Righteous Blade");
    });
    expect(walkTo(engine, "play:Anticipation:basic")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Anticipation:basic"));
    // Two options: the bare hand strike and the weapon one.
    expect(ids.length).toBe(2);
    const weaponOption = ids.find((o) => o.includes("rb"))!;
    expect(weaponOption).toBeDefined();
    runTrace(engine, [["Alice", weaponOption]]);
    for (let i = 0; i < 8; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "card.asPlayed") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    // It is a WEAPON strike for every later question.
    expect(cf.strikes[side]).toMatchObject({ source: "weapon", handBonus: 2 });
  });

  it("[AUS]: burns 1 blood to cancel the opposing STRIKE card", () => {
    const { state, engine } = intoCombat(
      [["Alice", "Anticipation"], ["Bob", "Aid from Bats"]],
      { v1: { aus: "superior" }, m: { ani: "basic" } },
      (s) => {
        Object.assign(find(s, "V1"), { clan: "Salubri" });
      },
    );
    expect(walkTo(engine, "play:Aid from Bats")).toBe(true);
    runTrace(engine, [
      ["Bob", optionIds(engine).find((o) => o.startsWith("play:Aid from Bats"))!],
    ]);
    expect(walkTo(engine, "play:Anticipation:superior")).toBe(true);
    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Anticipation:superior"))!],
    ]);
    for (let i = 0; i < 14; i++) {
      const dp = engine.decision();
      if (!dp || state.eventLog.some((e) => e.type === "CardCanceled")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);
    expect(find(state, "V1").blood).toBe(blood - 1);
    // "The minion chooses a strike again" — the slot was never filled.
    expect(walkTo(engine, "strike:hand")).toBe(true);
  });

  it("NEGATIVE SPACE: a NON-strike combat card is not cancellable", () => {
    const { engine } = intoCombat(
      [["Alice", "Anticipation"], ["Bob", "Soak"]],
      { v1: { aus: "superior" }, m: { for: "basic" } },
      (s) => {
        Object.assign(find(s, "V1"), { clan: "Salubri" });
      },
    );
    let seen = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("play:Anticipation:superior"))) seen = true;
      const play = dp.options.find((o) => o.id.startsWith("play:Soak"));
      const pick = play ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(seen).toBe(false);
  });
});

describe("Kevlar Vest (101040)", () => {
  it("prevents 2 from a GUN and 1 from anything else, once each combat", () => {
    const { state, engine } = intoCombat([], {}, (s) => {
      equip(s, "M", "kv", "Kevlar Vest");
      equip(s, "V1", "gun", ".44 Magnum");
    });
    // Alice fires the gun.
    expect(walkTo(engine, "ability:.44 Magnum:gun:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:.44 Magnum:gun:strike"]]);
    expect(walkTo(engine, "ability:Kevlar Vest:kv:vest")).toBe(true);
    // Against a gun it is worth 2.
    const opt = engine.decision()!.options.find((o) => o.id.includes("Kevlar Vest"))!;
    expect(opt.label).toContain("prevent 2");
    runTrace(engine, [["Bob", opt.id]]);
    expect(combat(state)!.usedThisCombat).toContain("kv");
  });

  it("…and 1 from a HAND strike — the control case", () => {
    const { engine } = intoCombat([], {}, (s) => equip(s, "M", "kv", "Kevlar Vest"));
    expect(walkTo(engine, "strike:hand")).toBe(true);
    runTrace(engine, [["Alice", "strike:hand"]]);
    expect(walkTo(engine, "ability:Kevlar Vest:kv:vest")).toBe(true);
    const opt = engine.decision()!.options.find((o) => o.id.includes("Kevlar Vest"))!;
    expect(opt.label).toContain("prevent 1");
  });

  it("NEGATIVE SPACE: only once each combat", () => {
    const { state, engine } = intoCombat([], {}, (s) => equip(s, "M", "kv", "Kevlar Vest"));
    expect(walkTo(engine, "ability:Kevlar Vest:kv:vest")).toBe(true);
    runTrace(engine, [["Bob", "ability:Kevlar Vest:kv:vest"]]);
    expect(combat(state)!.usedThisCombat).toContain("kv");
    // A second round: still spent, because the latch is per COMBAT.
    combat(state)!.willContinue = true;
    let seen = false;
    for (let i = 0; i < 40 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes("Kevlar Vest"))) seen = true;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(seen).toBe(false);
  });
});
