/**
 * The end of the round, and what reopens it (docs/round-end-design.md).
 *
 * Hunting the Quarry (102329), Telepathic Tracking (101950), Immortal
 * Grapple (100959), Target Vitals (101942), Dance with the Devil
 * (102315).
 *
 * The headline is §0: Hunting the Quarry was on the cut list for three
 * waves as needing a new combat SUB-STEP, and it needs none — the press
 * step decides `willContinue` BEFORE the End of Round window opens, so
 * "only usable if combat would end" is a usable rule reading the frame.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

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

/** Alice's V1 bleeds, Bob's M blocks; the combat is live at before-range. */
function intoCombat(
  cards: Array<[seat: "Alice" | "Bob", name: string]>,
  disc: { v1?: Record<string, "basic" | "superior">; m?: Record<string, "basic" | "superior"> } = {},
  tweak: (s: GameState) => void = () => {},
) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc.v1 ?? {}, blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { disciplines: disc.m ?? {}, blood: 5, strength: 1 });
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
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
  ]);
  return { state, engine };
}

/** Answer cheaply until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 120): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------
// §1 — "would this combat end?"
// ---------------------------------------------------------------------------

describe("Hunting the Quarry (102329) — no sub-step was needed", () => {
  it("superior: burns 1 blood at End of Round to start a new round", () => {
    const { state, engine } = intoCombat([["Alice", "Hunting the Quarry"]], {
      v1: { cel: "superior" },
    });
    expect(walkTo(engine, "play:Hunting the Quarry:superior")).toBe(true);
    // The window is END OF ROUND, and willContinue is already decided.
    expect(combat(state)!.step).toBe("endOfRound");
    expect(combat(state)!.willContinue).toBe(false);
    const blood = find(state, "V1").blood;
    const round = combat(state)!.round;
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunting the Quarry:superior"))!],
    ]);
    // Let the as-played window finish and the round turn over.
    for (let i = 0; i < 30 && combat(state)?.round === round; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)?.round).toBe(round + 1);
    expect(find(state, "V1").blood).toBe(blood - 1);
  });

  it("basic: attaches to the OPPOSING minion, and its controller keeps it", () => {
    const { state, engine } = intoCombat([["Alice", "Hunting the Quarry"]], {
      v1: { cel: "basic" },
    });
    expect(walkTo(engine, "play:Hunting the Quarry:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Hunting the Quarry:basic"))!],
    ]);
    drain(engine, state);
    const on = find(state, "M").attached.find((p) => p.card.name === "Hunting the Quarry");
    expect(on).toBeDefined();
    // "You still control this card" (p. 16).
    expect(on!.controller).toBe("Alice");
  });

  it("…and a vampire you control burns it to rush the attached minion", () => {
    const state = threeSeatGame();
    const p: PermanentInPlay = {
      card: { id: "htq", name: "Hunting the Quarry" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Hunting the Quarry"],
      controller: "Alice",
    };
    find(state, "M").attached.push(p);
    const engine = new VtesEngine(state, testRegistry);
    const id = "act:Hunting the Quarry:htq:rush:V1:M";
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Alice", id]]);
    // "Burn this card to attempt" — spent at announcement, whether or
    // not the rush lands.
    expect(find(state, "M").attached.some((x) => x.card.id === "htq")).toBe(false);
  });

  it("NEGATIVE SPACE: not offered when the combat is CONTINUING", () => {
    // The gate that makes §0 true: `willContinue` is already decided by
    // the time the End of Round window opens.
    const { state, engine } = intoCombat([["Alice", "Hunting the Quarry"]], {
      v1: { cel: "superior" },
    });
    expect(walkTo(engine, "play:Hunting the Quarry:superior")).toBe(true);
    combat(state)!.willContinue = true;
    expect(optionIds(engine).some((o) => o.startsWith("play:Hunting the Quarry"))).toBe(
      false,
    );
  });

  it("NEGATIVE SPACE: not offered when the combat ended PREMATURELY", () => {
    // A combatant left the ready region (p. 30): End of Round still runs,
    // but "both combatants are still ready" is false and the card says so.
    const { state, engine } = intoCombat([["Alice", "Hunting the Quarry"]], {
      v1: { cel: "superior" },
    });
    const cf = combat(state)!;
    cf.endedPrematurely = true;
    expect(optionIds(engine).some((o) => o.startsWith("play:Hunting the Quarry"))).toBe(
      false,
    );
  });
});

describe("Telepathic Tracking (101950)", () => {
  it("superior: restarts a combat that would end", () => {
    const { state, engine } = intoCombat([["Alice", "Telepathic Tracking"]], {
      v1: { aus: "superior" },
    });
    expect(walkTo(engine, "play:Telepathic Tracking:superior")).toBe(true);
    const round = combat(state)!.round;
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Telepathic Tracking:superior"))!],
    ]);
    for (let i = 0; i < 30 && combat(state)?.round === round; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)?.round).toBe(round + 1);
  });

  it("basic: a press that can only CONTINUE, plus a maneuver credit", () => {
    const { state, engine } = intoCombat([["Alice", "Telepathic Tracking"]], {
      v1: { aus: "basic" },
    });
    expect(walkTo(engine, "play:Telepathic Tracking:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Telepathic Tracking:basic"))!],
    ]);
    for (let i = 0; i < 20 && !combat(state)?.willContinue; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)?.willContinue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — Immortal Grapple
// ---------------------------------------------------------------------------

describe(".44 Magnum audit regressions", () => {
  it("lets the opposing minion use the gun for an additional strike when the actor has none", () => {
    const { state, engine } = intoCombat([], {}, (s) => equip(s, "M", "gun2", ".44 Magnum"));
    expect(walkTo(engine, "strike:hand")).toBe(true);
    const cf = combat(state)!;
    cf.strikeRound = "additional";
    cf.additionalStrikes = { acting: 0, opposing: 1 };
    cf.strikes = { acting: null, opposing: null };
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.map((o) => o.id)).toContain("ability:.44 Magnum:gun2:strike");
    runTrace(engine, [["Bob", "ability:.44 Magnum:gun2:strike"]]);
    expect(cf.strikes.opposing).toMatchObject({ damage: 2, ranged: true });
  });

  it("does not let a minion barred from acting equip the gun", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").hand.push({ id: "gun", name: ".44 Magnum" });
    const minion = find(state, "V1");
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((id) => id.startsWith("play:.44 Magnum") && id.includes(":V1:"))).toBe(true);
    minion.cannotActThisTurn = true;
    expect(optionIds(engine).some((id) => id.startsWith("play:.44 Magnum") && id.includes(":V1:"))).toBe(false);
  });

  it("does not offer equipment to an ally that cannot have it", () => {
    const state = threeSeatGame();
    const ally = makeAlly("ally", "Alice", 2);
    ally.attached.push({ card: { id: "ally", name: "Bone Shambler" }, locked: false,
      usedThisPhase: false, statics: { cannotBeEquipped: {} }, tags: [] });
    seatOf(state, "Alice").minions.push(ally);
    seatOf(state, "Alice").hand.push({ id: "gun", name: ".44 Magnum" });
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((id) => id.startsWith("play:.44 Magnum") && id.includes(":ally:"))).toBe(false);
    expect(optionIds(engine).some((id) => id.startsWith("play:.44 Magnum") && id.includes(":V1:"))).toBe(true);
  });
});

describe("Immortal Grapple (100959)", () => {
  it("bars every non-hand strike for BOTH combatants this round", () => {
    const { state, engine } = intoCombat([["Alice", "Immortal Grapple"]], {
      v1: { pot: "basic" },
    }, (s) => {
      // Both sides armed, and with DIFFERENT weapons — one hand-rolled
      // (.44 Magnum) and one spec-compiled (Assault Rifle), because the
      // gate has to be written in both places.
      equip(s, "V1", "gun1", ".44 Magnum");
      equip(s, "M", "gun2", "Assault Rifle");
    });
    // CONTROL: before the grapple, Bob's gun strike is on the table.
    expect(walkTo(engine, "play:Immortal Grapple:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Immortal Grapple:basic"))!],
    ]);
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(combat(state)!.handStrikesOnly).toBe(true);
    // Neither side is offered a weapon strike any more.
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "combat.chooseStrike") break;
      expect(
        dp.options.map((o) => o.id).filter((o) => /Magnum|Assault Rifle/.test(o)),
      ).toEqual([]);
      runTrace(engine, [[dp.seat, "strike:hand"]]);
    }
  });

  it("CONTROL: without the grapple, the gun strike IS offered", () => {
    // The pairing that keeps the negative above honest.
    const { engine } = intoCombat([], {}, (s) => equip(s, "M", "gun2", ".44 Magnum"));
    expect(walkTo(engine, "ability:.44 Magnum:gun2:strike")).toBe(true);
  });

  it("superior: next round keeps pre-range plays but skips maneuvers", () => {
    const { state, engine } = intoCombat([["Alice", "Immortal Grapple"], ["Alice", "Torn Signpost"], ["Alice", "High Ground"]], {
      v1: { pot: "superior" },
    }, (s) => { equip(s, "V1", "flight", "Flight").tags.push("flight"); });
    expect(walkTo(engine, "play:Immortal Grapple:superior")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("play:Immortal Grapple:superior"))!]]);
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(combat(state)!.skipRangeNextRound).toBe(true);
    for (let i = 0; i < 60 && combat(state)?.round === 1; i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "press:continue") ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(combat(state)?.round).toBe(2);
    expect(engine.decision()?.window).toBe("combat.beforeRange");
    expect(optionIds(engine).some((id) => id.startsWith("play:Torn Signpost:superior"))).toBe(true);
    expect(optionIds(engine).some((id) => id.startsWith("play:High Ground"))).toBe(false);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("play:Torn Signpost:superior"))!]]);
    let sawStrikeWindow = false;
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision()!;
      expect(dp.window).not.toBe("combat.range");
      if (dp.window === "combat.beforeStrikes") { sawStrikeWindow = true; break; }
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")!.id]]);
    }
    expect(sawStrikeWindow).toBe(true);
    expect(combat(state)?.range).toBe("close");
    expect(combat(state)?.skipRangeNextRound).toBe(false);
  });

  it("carries the GRAPPLE keyword, which Sword of the Archangel filters on", () => {
    expect(testRegistry["Immortal Grapple"]!.cardKeywords?.()).toEqual(["grapple"]);
  });
});

// ---------------------------------------------------------------------------
// §3 — Target Vitals
// ---------------------------------------------------------------------------

describe("Target Vitals (101942)", () => {
  it("adds +2 only to a strike that LANDS, and bans the victim's press", () => {
    const { state, engine } = intoCombat([["Alice", "Target Vitals"]]);
    expect(walkTo(engine, "play:Target Vitals")).toBe(true);
    // Its window is chooseStrike — "as this minion chooses a strike".
    expect(engine.decision()!.window).toBe("combat.chooseStrike");
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Target Vitals"))!],
    ]);
    expect(walkTo(engine, "strike:hand")).toBe(true);
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    const victim = side === "acting" ? "opposing" : "acting";
    expect(cf.aimRiders?.[side].length).toBe(1);
    // WAVE 17: the press bar is part of "if any damage from this strike
    // is successfully inflicted", so it is NOT in force yet — the strike
    // has only been chosen. docs/aim-design.md §2
    expect(cf.restrict[victim].press).toBe(false);

    const before = find(state, "M").blood;
    drain(engine, state);
    // Strength 1 + 2 = 3 damage, mended by burning 3 blood.
    expect(find(state, "M").blood).toBe(before - 3);
  });

  it("NEGATIVE SPACE: only ONE aim per strike, per minion", () => {
    const { state, engine } = intoCombat([
      ["Alice", "Target Vitals"],
      ["Alice", "Target Vitals"],
    ]);
    expect(walkTo(engine, "play:Target Vitals")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Target Vitals"))!],
    ]);
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(combat(state)!.aimsThisStrike).toContain("V1");
    expect(optionIds(engine).some((o) => o.startsWith("play:Target Vitals"))).toBe(false);
  });

  it("PAY TO CANCEL IN CARDS: the opposing controller discards two combat cards", () => {
    const { state, engine } = intoCombat([
      ["Alice", "Target Vitals"],
      ["Bob", "Soak"],
      ["Bob", "Soak"],
    ]);
    expect(walkTo(engine, "play:Target Vitals")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Target Vitals"))!],
    ]);
    expect(walkTo(engine, "cancelpay:")).toBe(true);
    // BOB pays — "they" on a combat card is the other combatant's side.
    expect(engine.decision()!.seat).toBe("Bob");
    const id = optionIds(engine).find((o) => o.startsWith("cancelpay:"))!;
    expect(id).toContain(",");
    runTrace(engine, [["Bob", id]]);
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp || state.eventLog.some((e) => e.type === "CardCanceled")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);
    expect(combat(state)?.aimRiders?.acting.length ?? 0).toBe(0);
  });

  it("NEGATIVE SPACE: no buy-off without TWO combat cards to discard", () => {
    const { engine } = intoCombat([
      ["Alice", "Target Vitals"],
      ["Bob", "Soak"],
    ]);
    expect(walkTo(engine, "play:Target Vitals")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Target Vitals"))!],
    ]);
    expect(walkTo(engine, "cancelpay:", 12)).toBe(false);
  });

  it("carries the AIM keyword", () => {
    expect(testRegistry["Target Vitals"]!.cardKeywords?.()).toEqual(["aim"]);
  });
});

// ---------------------------------------------------------------------------
// §4 — Dance with the Devil
// ---------------------------------------------------------------------------

describe("Dance with the Devil (102315)", () => {
  it("maneuvers to close range, and is not offered once the range IS close", () => {
    const { state, engine } = intoCombat([["Alice", "Dance with the Devil"]], {
      v1: { obf: "basic" },
    });
    // A blocked action's combat opens at CLOSE range, so put it long to
    // give the card something to do.
    combat(state)!.range = "long";
    expect(walkTo(engine, "play:Dance with the Devil:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Dance with the Devil:basic"))!],
    ]);
    for (let i = 0; i < 10 && combat(state)!.range !== "close"; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)!.range).toBe("close");
  });

  it("NEGATIVE SPACE: not offered at close range — it can only go one way", () => {
    const { state, engine } = intoCombat([["Alice", "Dance with the Devil"]], {
      v1: { obf: "basic" },
    });
    combat(state)!.range = "close";
    expect(walkTo(engine, "play:Dance with the Devil", 25)).toBe(false);
  });

  it("superior can be played without blood when the extra maneuver is declined", () => {
    const { state, engine } = intoCombat([["Alice", "Dance with the Devil"]], { v1: { obf: "superior" } });
    combat(state)!.range = "long";
    find(state, "V1").blood = 0;
    expect(walkTo(engine, "play:Dance with the Devil:superior")).toBe(true);
    engine.choose(optionIds(engine).find(o => o.startsWith("play:Dance with the Devil:superior"))!);
    for (let i = 0; i < 10 && combat(state)!.range !== "close"; i++) engine.choose("pass");
    expect(find(state, "V1").blood).toBe(0);
    expect(combat(state)!.range).toBe("close");
  });

  it("superior: also grants a bought close-only maneuver credit", () => {
    const { state, engine } = intoCombat([["Alice", "Dance with the Devil"]], {
      v1: { obf: "superior" },
    });
    combat(state)!.range = "long";
    expect(walkTo(engine, "play:Dance with the Devil:superior")).toBe(true);
    const blood = find(state, "V1").blood;
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Dance with the Devil:superior"))!],
    ]);
    for (let i = 0; i < 12 && combat(state)!.range !== "close"; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    const cf = combat(state)!;
    const side = cf.acting === "V1" ? "acting" : "opposing";
    // The printed maneuver is free; paying for the extra is optional.
    expect(cf.range).toBe("close");
    expect(cf.paidCloseManeuvers?.[side]).toEqual([1]);
    expect(find(state, "V1").blood).toBe(blood);
    const other = side === "acting" ? "opposing" : "acting";
    cf.maneuverCredits[other] = 1;
    expect(engine.decision()!.options.some(o => o.id === "maneuver:credit")).toBe(true);
    engine.choose("maneuver:credit");
    expect(engine.decision()!.options.some(o => o.id === "maneuver:paidClose")).toBe(true);
    engine.choose("maneuver:paidClose");
    expect(cf.range).toBe("close");
    expect(find(state, "V1").blood).toBe(blood - 1);
    expect(cf.paidCloseManeuvers?.[side]).toEqual([]);
  });
});
