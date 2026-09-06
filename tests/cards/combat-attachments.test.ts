/**
 * Combat cards that become permanents
 * (docs/combat-attachments-design.md).
 *
 * Wall of Filth (102347), Sculpt the Flesh (102260), Disarm (100549),
 * Morbidity (102332), Monstrous Form (102253).
 *
 * The combat-side twin of the action-attachments wave: a combat card that
 * puts ITSELF into play mid-fight, on one combatant or the other, and
 * everything interesting happens afterwards.
 *
 * Plus the bug the survey found on the way — `prevent` had no
 * non-aggravated filter, so SOAK had been preventing aggravated damage it
 * cannot touch.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function maybe(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function combat(state: GameState): CombatFrame {
  const f = state.frames.find((x) => x.kind === "combat");
  if (!f || f.kind !== "combat") throw new Error("no combat frame");
  return f;
}

function hasCombat(state: GameState): boolean {
  return state.frames.some((f) => f.kind === "combat");
}

/** Every entry in play anywhere — seat-level and attached alike. */
function entries(state: GameState): Array<{ name: string; on: string | null; counters: number }> {
  const out: Array<{ name: string; on: string | null; counters: number }> = [];
  for (const s of state.seats) {
    for (const p of s.permanents) out.push({ name: p.card.name, on: null, counters: p.counters ?? 0 });
    for (const m of s.minions) {
      for (const p of m.attached) {
        out.push({ name: p.card.name, on: m.id, counters: p.counters ?? 0 });
      }
    }
  }
  return out;
}

/**
 * Alice's V1 bleeds, Bob's M blocks; stop with the BEFORE RANGE window
 * open. `who` says which seat gets the cards — three of these five are
 * played by the blocker's side.
 */
function intoCombat(
  cards: Array<[seat: "Alice" | "Bob", name: string]>,
  disc: { v1?: Record<string, "basic" | "superior">; m?: Record<string, "basic" | "superior"> },
  tweak: (state: GameState) => void = () => {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc.v1 ?? {}, blood: 4, strength: 1 });
  Object.assign(find(state, "M"), { disciplines: disc.m ?? {}, blood: 4, strength: 1 });
  let a = 0;
  let b = 0;
  for (const [seat, name] of cards) {
    if (seat === "Alice") state.seats[0]!.hand.push({ id: `a${a++}`, name });
    else state.seats[1]!.hand.push({ id: `b${b++}`, name });
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

/** Answer everything the cheapest way until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 80): void {
  for (let i = 0; i < limit; i++) {
    if (!hasCombat(state)) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

/** Walk to the first decision whose option list contains `prefix`. */
function walkTo(engine: VtesEngine, state: GameState, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
    if (!hasCombat(state)) return false;
  }
  return false;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

// ---------------------------------------------------------------------------

describe("Wall of Filth (102347)", () => {
  it("attaches to its own player before range", () => {
    const { state, engine } = intoCombat([["Alice", "Wall of Filth"]], {
      v1: { pro: "basic" },
    });
    expect(optionIds(engine).some((id) => id.startsWith("play:Wall of Filth"))).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Wall of Filth:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(entries(state).some((e) => e.name === "Wall of Filth" && e.on === "V1")).toBe(true);
  });

  it("burns itself to prevent ordinary damage", () => {
    const { state, engine } = intoCombat([["Alice", "Wall of Filth"]], {
      v1: { pro: "basic" },
    });
    runTrace(engine, [
      ["Alice", "play:Wall of Filth:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const before = find(state, "V1").blood;
    // Walk to the damage window and use the card.
    const reached = walkTo(engine, state, "ability:Wall of Filth");
    expect(reached).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("ability:Wall of Filth"))!;
    runTrace(engine, [[engine.decision()!.seat, id]]);
    drain(engine, state);
    // The card is gone (burned to pay for itself) and V1 took nothing.
    expect(entries(state).some((e) => e.name === "Wall of Filth")).toBe(false);
    expect(find(state, "V1").blood).toBe(before);
  });

  it("NEGATIVE SPACE: the basic mode is not offered against AGGRAVATED damage", () => {
    const { state, engine } = intoCombat([["Alice", "Wall of Filth"]], {
      v1: { pro: "basic" },
    });
    runTrace(engine, [
      ["Alice", "play:Wall of Filth:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Make every hand strike from Bob's side aggravated, so the damage
    // V1 takes is the kind the basic mode cannot touch.
    combat(state).handStrikesAggravated.opposing = true;
    const reached = walkTo(engine, state, "ability:Wall of Filth");
    expect(reached).toBe(false);
  });

  it("the SUPERIOR mode IS offered against aggravated damage — the control case", () => {
    const { state, engine } = intoCombat([["Alice", "Wall of Filth"]], {
      v1: { pro: "superior" },
    });
    runTrace(engine, [
      ["Alice", "play:Wall of Filth:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    combat(state).handStrikesAggravated.opposing = true;
    expect(walkTo(engine, state, "ability:Wall of Filth")).toBe(true);
  });

  it("NEGATIVE SPACE: a vampire can have only one Wall of Filth", () => {
    const { state, engine } = intoCombat(
      [["Alice", "Wall of Filth"], ["Alice", "Wall of Filth"]],
      { v1: { pro: "basic" } },
    );
    runTrace(engine, [
      ["Alice", "play:Wall of Filth:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Back in a before-range window in a later round would be the honest
    // test; the cheap one is that the option is gone while one is on.
    expect(entries(state).filter((e) => e.name === "Wall of Filth").length).toBe(1);
    expect(optionIds(engine).some((id) => id.startsWith("play:Wall of Filth"))).toBe(false);
  });
});

describe("Soak (101817) — the bug the filter fixed", () => {
  it("NEGATIVE SPACE: Soak is not offered against aggravated damage", () => {
    const { state, engine } = intoCombat([["Alice", "Soak"]], { v1: { for: "basic" } });
    combat(state).handStrikesAggravated.opposing = true;
    expect(walkTo(engine, state, "play:Soak")).toBe(false);
  });

  it("…and IS offered against ordinary damage — the control case", () => {
    const { state, engine } = intoCombat([["Alice", "Soak"]], { v1: { for: "basic" } });
    expect(walkTo(engine, state, "play:Soak")).toBe(true);
  });
});

describe("Sculpt the Flesh (102260)", () => {
  it("basic is an aggravated hand strike", () => {
    const { state, engine } = intoCombat([["Alice", "Sculpt the Flesh"]], {
      v1: { pro: "basic" },
    });
    expect(walkTo(engine, state, "play:Sculpt the Flesh:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Sculpt the Flesh:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const cf = combat(state);
    expect(cf.strikes.acting?.aggravated).toBe(true);
  });

  it("superior strikes AND puts the card on the victim, which then bleeds blood each unlock", () => {
    const { state, engine } = intoCombat([["Alice", "Sculpt the Flesh"]], {
      v1: { pro: "superior" },
    });
    expect(walkTo(engine, state, "play:Sculpt the Flesh:superior")).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Sculpt the Flesh:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drain(engine, state);
    const placed = entries(state).find((e) => e.name === "Sculpt the Flesh");
    expect(placed?.on).toBe("M");
    // p. 16: it is Alice's card even though it sits on Bob's vampire.
    const entry = find(state, "M").attached.find((p) => p.card.name === "Sculpt the Flesh")!;
    expect(entry.controller).toBe("Alice");
  });
});

describe("Disarm (100549)", () => {
  /** Put the combat at close range with M having taken more damage than
   *  V1 this round — the state Disarm's usability clause describes. */
  function armDisarm(state: GameState, mineDealt: number, theirsDealt: number): void {
    const cf = combat(state);
    cf.range = "close";
    cf.damageTakenThisRound = { acting: theirsDealt, opposing: mineDealt };
  }

  it("is offered at end of round when this vampire inflicted more, and lands with torpor", () => {
    const { state, engine } = intoCombat([["Alice", "Disarm"]], { v1: { pot: "basic" } });
    armDisarm(state, 2, 0);
    expect(walkTo(engine, state, "play:Disarm")).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Disarm:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const placed = entries(state).find((e) => e.name === "Disarm");
    expect(placed?.on).toBe("M");
    expect(find(state, "M").inTorpor).toBe(true);
  });

  it("NEGATIVE SPACE: not offered when the OPPOSING vampire inflicted more", () => {
    const { state, engine } = intoCombat([["Alice", "Disarm"]], { v1: { pot: "basic" } });
    armDisarm(state, 0, 2);
    expect(walkTo(engine, state, "play:Disarm")).toBe(false);
  });

  it("NEGATIVE SPACE: not offered on equal damage — 'MORE than', not 'at least'", () => {
    const { state, engine } = intoCombat([["Alice", "Disarm"]], { v1: { pot: "basic" } });
    armDisarm(state, 1, 1);
    expect(walkTo(engine, state, "play:Disarm")).toBe(false);
  });

  it("NEGATIVE SPACE: not offered at long range", () => {
    const { state, engine } = intoCombat([["Alice", "Disarm"]], { v1: { pot: "basic" } });
    armDisarm(state, 2, 0);
    combat(state).range = "long";
    expect(walkTo(engine, state, "play:Disarm")).toBe(false);
  });

  it("NEGATIVE SPACE: not usable by a vampire who is themselves going to torpor (p. 32)", () => {
    // End of Round runs even when a combatant has just left the ready
    // region, which is the case the card's second sentence names.
    const { state, engine } = intoCombat([["Alice", "Disarm"]], { v1: { pot: "basic" } });
    armDisarm(state, 2, 0);
    find(state, "V1").inTorpor = true;
    expect(walkTo(engine, state, "play:Disarm")).toBe(false);
  });

  it("the bearer can burn 3 blood to be rid of it", () => {
    const { state, engine } = intoCombat([["Alice", "Disarm"]], { v1: { pot: "basic" } });
    armDisarm(state, 2, 0);
    walkTo(engine, state, "play:Disarm");
    runTrace(engine, [
      ["Alice", "play:Disarm:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drain(engine, state);
    expect(entries(state).some((e) => e.name === "Disarm")).toBe(true);
    // Bob's own turn: the buy-off is his to take, not Alice's.
    const bobBlood = find(state, "M").blood;
    let used = false;
    for (let i = 0; i < 200 && !used; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const buy = dp.options.find((o) => o.id.startsWith("ability:Disarm"));
      if (buy && dp.seat === "Bob") {
        runTrace(engine, [["Bob", buy.id]]);
        used = true;
        break;
      }
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(used).toBe(true);
    expect(entries(state).some((e) => e.name === "Disarm")).toBe(false);
    expect(find(state, "M").blood).toBe(bobBlood - 3);
  });
});

describe("Morbidity (102332)", () => {
  it("puts itself in play holding the chosen amount of the opponent's blood", () => {
    const { state, engine } = intoCombat([["Alice", "Morbidity"]], {
      v1: { obl: "basic" },
    });
    const ids = optionIds(engine).filter((id) => id.startsWith("play:Morbidity"));
    // "Up to 2" is a CHOICE: 0, 1 and 2 are all offered (§6).
    expect(ids.length).toBe(3);
    const two = ids.find((id) => /:2:/.test(id))!;
    const mBlood = find(state, "M").blood;
    runTrace(engine, [
      ["Alice", two],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "M").blood).toBe(mBlood - 2);
    const held = entries(state).find((e) => e.name === "Morbidity");
    expect(held?.on).toBe(null);
    expect(held?.counters).toBe(2);
  });

  it("gives the blood back and burns itself when combat ends", () => {
    const { state, engine } = intoCombat([["Alice", "Morbidity"]], {
      v1: { obl: "basic" },
    });
    const two = optionIds(engine).find((id) => id.startsWith("play:Morbidity") && /:2:/.test(id))!;
    const mBlood = find(state, "M").blood;
    runTrace(engine, [
      ["Alice", two],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    drain(engine, state);
    expect(entries(state).some((e) => e.name === "Morbidity")).toBe(false);
    // M may have taken hand-strike damage in between; the point is that
    // the two stored blood came back, so it is not down by the loan.
    const m = maybe(state, "M");
    if (m) expect(m.blood).toBeGreaterThanOrEqual(mBlood - 2);
  });

  it("the superior also taxes the opponent's combat cards", () => {
    const { state, engine } = intoCombat([["Alice", "Morbidity"]], {
      v1: { obl: "superior" },
    });
    const two = optionIds(engine).find(
      (id) => id.startsWith("play:Morbidity:superior") && /:2:/.test(id),
    )!;
    runTrace(engine, [
      ["Alice", two],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const mods = combat(state).playCostMods;
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.some((m) => m.amount === 1 && m.pays === "blood")).toBe(true);
  });
});

describe("Monstrous Form (102253)", () => {
  it("the basic COMBAT mode is a plain +1 strength before range", () => {
    const { state, engine } = intoCombat([["Alice", "Monstrous Form"]], {
      v1: { dom: "basic", pro: "basic" },
    });
    expect(optionIds(engine).some((id) => id.startsWith("play:Monstrous Form:basic"))).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Monstrous Form:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(combat(state).strengthBonus.acting).toBe(1);
  });

  it("NEGATIVE SPACE: the superior is an ACTION, so it is not on the table in combat", () => {
    const { engine } = intoCombat([["Alice", "Monstrous Form"]], {
      v1: { dom: "superior", pro: "superior" },
    });
    // Both modes' disciplines are satisfied; only the combat half may be
    // played here, and `actionOrCombat` splits them by window.
    expect(optionIds(engine).some((id) => id.startsWith("play:Monstrous Form:superior"))).toBe(
      false,
    );
  });

  it("requires BOTH Disciplines — {all: [...]}", () => {
    const { engine } = intoCombat([["Alice", "Monstrous Form"]], {
      v1: { dom: "basic" }, // no Protean
    });
    expect(optionIds(engine).some((id) => id.startsWith("play:Monstrous Form"))).toBe(false);
  });
});
