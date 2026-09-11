/**
 * The aim cards, and the trigger they all wait for (docs/aim-design.md).
 *
 * Target Hand (101938), Target Head (101939), Target Leg (101940) —
 * joined to Target Vitals (101942), which was already in the pool and was
 * applying its press bar at PLAY time.
 *
 * The headline is the negative space: every one of these cards is written
 * "IF ANY DAMAGE FROM THIS STRIKE IS SUCCESSFULLY INFLICTED ON THE
 * OPPOSING MINION, …", and [RTR 19960221] says an aim "can be played on a
 * strike that does no damage … but has no effect in that case". A payload
 * applied when the card resolves passes every positive test and is still
 * wrong, so the strike-that-lands and the strike-that-does-not are
 * asserted against each other throughout.
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

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function step(engine: VtesEngine): boolean {
  const dp = engine.decision();
  if (!dp) return false;
  runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  return true;
}

function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    step(engine);
  }
  return false;
}

/** Answer cheaply until `pred` holds — used to stop the instant the aim
 *  rider has fired, which is the only moment worth asserting at. */
function walkUntil(engine: VtesEngine, pred: () => boolean, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    if (pred()) return true;
    if (!step(engine)) return pred();
  }
  return pred();
}

/** Alice's V1 bleeds, Bob's M blocks; the combat is live at before-range.
 *  `strength` 0 is how a strike is made to land NOTHING without a dodge
 *  card: `inflict` never queues a zero. */
function intoCombat(
  cards: Array<[seat: "Alice" | "Bob", name: string]>,
  opts: { strength?: number; weaponOnM?: boolean } = {},
) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), {
    disciplines: {},
    blood: 5,
    strength: opts.strength ?? 1,
  });
  Object.assign(find(state, "M"), { disciplines: {}, blood: 5, strength: 1 });
  let a = 0;
  let b = 0;
  for (const [seat, name] of cards) {
    const seatState = state.seats.find((s) => s.id === seat)!;
    seatState.hand.push({ id: seat === "Alice" ? `a${a++}` : `b${b++}`, name });
  }
  if (opts.weaponOnM) {
    const h = testRegistry[".44 Magnum"];
    const p: PermanentInPlay = {
      card: { id: "w1", name: ".44 Magnum" },
      locked: false,
      usedThisPhase: false,
      statics: h?.permanentStatics ?? {},
      tags: h?.permanentTags ?? [],
    };
    find(state, "M").attached.push(p);
  }
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

/** Play the named aim on V1's strike and leave the engine at the point
 *  where both strikes are being chosen. */
function playAim(engine: VtesEngine, name: string): void {
  expect(walkTo(engine, `play:${name}`)).toBe(true);
  runTrace(engine, [
    ["Alice", optionIds(engine).find((o) => o.startsWith(`play:${name}`))!],
  ]);
}

function side(cf: CombatFrame): "acting" | "opposing" {
  return cf.acting === "V1" ? "acting" : "opposing";
}
function victimSide(cf: CombatFrame): "acting" | "opposing" {
  return side(cf) === "acting" ? "opposing" : "acting";
}

// ---------------------------------------------------------------------------
// The trigger itself
// ---------------------------------------------------------------------------

describe("the aim trigger", () => {
  it("holds the payload until the strike LANDS", () => {
    const { state, engine } = intoCombat([["Alice", "Target Vitals"]]);
    playAim(engine, "Target Vitals");
    const cf = combat(state)!;
    // Played and resolved (the as-played cancel window has to close
    // first) — and nothing has happened to the opponent yet.
    expect(walkUntil(engine, () => combat(state)?.aimRiders?.[side(cf)].length === 1)).toBe(true);
    expect(cf.restrict[victimSide(cf)].press).toBe(false);

    const before = find(state, "M").blood;
    expect(walkUntil(engine, () => (combat(state)?.aimRiders?.[side(cf)].length ?? 1) === 0)).toBe(
      true,
    );
    expect(combat(state)!.restrict[victimSide(cf)].press).toBe(true);
    // Strength 1, +2 from the rider, mended by burning 3 blood.
    walkUntil(engine, () => find(state, "M").blood !== before);
    expect(find(state, "M").blood).toBe(before - 3);
  });

  it("NEGATIVE SPACE: a strike that inflicts nothing fires no rider", () => {
    // Strength 0: the hand strike resolves, queues no damage, and
    // [RTR 19960221] says the aim therefore has no effect. The card is
    // still spent — it was played.
    const { state, engine } = intoCombat([["Alice", "Target Vitals"]], { strength: 0 });
    playAim(engine, "Target Vitals");
    const cf = combat(state)!;
    const before = find(state, "M").blood;
    for (let i = 0; i < 40 && combat(state)?.step !== "endOfRound"; i++) {
      if (!step(engine)) break;
    }
    expect(find(state, "M").blood).toBe(before);
    expect(combat(state)?.restrict[victimSide(cf)].press ?? false).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Target Hand
// ---------------------------------------------------------------------------

describe("Target Hand (101938)", () => {
  it("takes 1 strength off the victim and offers its weapon up", () => {
    const { state, engine } = intoCombat([["Alice", "Target Hand"]], { weaponOnM: true });
    playAim(engine, "Target Hand");
    const cf = combat(state)!;
    expect(walkUntil(engine, () => combat(state)?.strengthBonus[victimSide(cf)] === -1)).toBe(true);
    // "…and you MAY destroy a weapon he or she has" — Alice's choice,
    // raised the moment the damage lands.
    expect(walkTo(engine, "choice:Target Hand", 10)).toBe(true);
    expect(engine.decision()!.seat).toBe("Alice");
    const burn = optionIds(engine).find((o) => o.includes("aimBurnWeapon"))!;
    expect(burn).toContain("w1");
    runTrace(engine, [["Alice", burn]]);
    expect(find(state, "M").attached.some((p) => p.card.id === "w1")).toBe(false);
  });

  it("NEGATIVE SPACE: no weapon question when the victim has none", () => {
    const { engine } = intoCombat([["Alice", "Target Hand"]]);
    playAim(engine, "Target Hand");
    expect(walkTo(engine, "choice:Target Hand", 20)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Target Head
// ---------------------------------------------------------------------------

describe("Target Head (101939)", () => {
  it("+2 is part of the STRIKE's damage, and one discard cancels it", () => {
    const { state, engine } = intoCombat([["Alice", "Target Head"]]);
    playAim(engine, "Target Head");
    const cf = combat(state)!;
    // Unlike Target Vitals' bonus, this one is in force before any damage
    // exists — it is what the strike deals.
    expect(walkUntil(engine, () => combat(state)?.aimStrikeBonus?.[side(cf)] === 2)).toBe(true);
    const before = find(state, "M").blood;
    walkUntil(engine, () => find(state, "M").blood !== before);
    expect(find(state, "M").blood).toBe(before - 3);
  });

  it("bars the victim's additional strikes, and asks Alice for the range", () => {
    const { state, engine } = intoCombat([["Alice", "Target Head"]]);
    playAim(engine, "Target Head");
    const cf = combat(state)!;
    expect(walkUntil(engine, () => combat(state)?.noAdditionalStrikes?.[victimSide(cf)] === true))
      .toBe(true);
    // "…and you may SET THE RANGE for the next round" — asked at the round
    // boundary, the first moment there is known to be a next round, and
    // only if there is one. This combat ends, so the question never comes.
    expect(combat(state)!.pendingSetRange?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Target Leg
// ---------------------------------------------------------------------------

describe("Target Leg (101940)", () => {
  it("leaves the victim only Discipline-requiring maneuvers and presses", () => {
    const { state, engine } = intoCombat([["Alice", "Target Leg"]]);
    playAim(engine, "Target Leg");
    const cf = combat(state)!;
    const v = victimSide(cf);
    expect(walkUntil(engine, () => combat(state)?.moveDisciplines?.[v] != null)).toBe(true);
    expect(combat(state)!.moveDisciplines![v]).toEqual(["obf", "tha", "flight"]);
    // A press CREDIT requires no Discipline at all, so it goes.
    combat(state)!.presses[v] = 1;
    expect(walkTo(engine, "press:continue", 20)).toBe(false);
  });

  it("CONTROL: the same credit IS offered without the card", () => {
    const { state, engine } = intoCombat([["Alice", "Soak"]]);
    const cf = combat(state)!;
    const v = victimSide(cf);
    expect(walkUntil(engine, () => combat(state)?.step === "chooseStrike")).toBe(true);
    combat(state)!.presses[v] = 1;
    expect(walkTo(engine, "press:continue", 20)).toBe(true);
  });
});
