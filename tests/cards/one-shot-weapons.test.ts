/**
 * One-shot weapons — "Burn after use" (docs/one-shot-weapons-design.md).
 *
 * Grenade (100857), White Phosphorus Grenade (102179), Smoke Grenade
 * (101814), Waxen Poetica (102162).
 *
 * The family's whole point is WHEN the weapon burns: at strike
 * RESOLUTION, not when the strike is chosen. *"Does not burn nor inflict
 * damage if combat ends before it resolves"* [LSJ 19981006], and yet the
 * Smoke Grenade — whose own strike IS "combat ends" — *"still burns when
 * used"* [LSJ 20001127-2]. One test pits those two rulings against each
 * other in a single combat.
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

function has(state: GameState, minion: string, cardId: string): boolean {
  return find(state, minion).attached.some((p) => p.card.id === cardId);
}

/**
 * Damage the engine actually inflicted, as `minion/amount/source/agg`.
 *
 * Read from the log rather than from blood, because a vampire's blood is
 * a lossy record of what hit it: this engine sends a ready vampire to
 * torpor on ANY aggravated damage (p. 34), so two aggravated points and
 * one look identical afterwards — and the one thing this wave adds at
 * close range is a packet with NO SOURCE, which no blood total can show.
 */
function damage(state: GameState): string[] {
  return state.eventLog
    .filter((e) => e.type === "DamageInflicted")
    .map((e) => `${e.minion}/${e.amount}/${e.source ?? "environment"}/${e.aggravated ? "agg" : "normal"}`);
}

function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/** Alice's V1 bleeds, Bob's M blocks; combat is live at BEFORE RANGE. */
function intoCombat(setup: (state: GameState) => void = () => {}) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 5, strength: 1 });
  Object.assign(find(state, "M"), { blood: 5, strength: 1 });
  setup(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

/** Answer everything cheaply until the combat frame is gone. */
function drain(engine: VtesEngine, state: GameState, limit = 90): void {
  for (let i = 0; i < limit && combat(state); i++) {
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Grenade (100857)", () => {
  it("hits for 3R, then burns itself — and at LONG range the bearer is untouched", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "g", "Grenade"));
    combat(state)!.range = "long";
    expect(walkTo(engine, "ability:Grenade:g:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Grenade:g:strike"]]);
    // Chosen is not used: the weapon is still in play at this point.
    expect(has(state, "V1", "g")).toBe(true);
    drain(engine, state);
    expect(find(state, "M").blood).toBe(2);
    expect(has(state, "V1", "g")).toBe(false);
    // NEGATIVE SPACE: the close-range clause is a CLAUSE, not a cost —
    // at long range the bearer is hit by nothing at all.
    expect(damage(state)).toEqual(["M/3/V1/normal"]);
  });

  it("at CLOSE range the bearer takes 1 — environmental, from nobody", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "g", "Grenade"));
    combat(state)!.range = "close";
    expect(walkTo(engine, "ability:Grenade:g:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Grenade:g:strike"]]);
    drain(engine, state);
    // "Damage done to the bearer is environmental" [LSJ 19970801] — no
    // source, so nothing that reads "damage from the opposing minion"
    // can see it. The other packet is M's ordinary hand strike.
    expect(damage(state)).toContain("V1/1/environment/normal");
    expect(has(state, "V1", "g")).toBe(false);
  });
});

describe("Smoke Grenade (101814) vs Grenade — the two burn rulings at once", () => {
  it("the smoke burns because its OWN strike resolved; the grenade does not", () => {
    const { state, engine } = intoCombat((s) => {
      equip(s, "V1", "g", "Grenade");
      equip(s, "M", "sg", "Smoke Grenade");
    });
    combat(state)!.range = "long";
    expect(walkTo(engine, "ability:Grenade:g:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Grenade:g:strike"]]);
    expect(walkTo(engine, "ability:Smoke Grenade:sg:strike")).toBe(true);
    runTrace(engine, [["Bob", "ability:Smoke Grenade:sg:strike"]]);
    drain(engine, state);
    // "Still burns when used…" [LSJ 20001127-2]
    expect(has(state, "M", "sg")).toBe(false);
    // "…does not burn NOR INFLICT DAMAGE if combat ends before it
    // resolves" [LSJ 19981006] — the grenade never went off.
    expect(has(state, "V1", "g")).toBe(true);
    expect(find(state, "M").blood).toBe(5);
  });

  it("NEGATIVE SPACE: the smoke's strike is not offered at close range", () => {
    const { state, engine } = intoCombat((s) => equip(s, "M", "sg", "Smoke Grenade"));
    combat(state)!.range = "close";
    expect(walkTo(engine, "ability:Smoke Grenade:sg:strike", 25)).toBe(false);
  });
});

describe("Waxen Poetica (102162)", () => {
  it("NEGATIVE SPACE: not offered against a vampire with Celerity", () => {
    const { state, engine } = intoCombat((s) => {
      equip(s, "V1", "wp", "Waxen Poetica");
      find(s, "M").disciplines["cel"] = "basic";
    });
    expect(walkTo(engine, "ability:Waxen Poetica:wp:strike", 25)).toBe(false);
  });

  it("…and IS offered without it — the control case — burning after use", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "wp", "Waxen Poetica"));
    delete find(state, "M").disciplines["cel"];
    expect(walkTo(engine, "ability:Waxen Poetica:wp:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:Waxen Poetica:wp:strike"]]);
    drain(engine, state);
    expect(has(state, "V1", "wp")).toBe(false);
  });
});

describe("White Phosphorus Grenade (102179)", () => {
  it("deals 2 aggravated and costs the bearer 1 aggravated at close range", () => {
    const { state, engine } = intoCombat((s) => equip(s, "V1", "wp", "White Phosphorus Grenade"));
    combat(state)!.range = "close";
    expect(walkTo(engine, "ability:White Phosphorus Grenade:wp:strike")).toBe(true);
    runTrace(engine, [["Alice", "ability:White Phosphorus Grenade:wp:strike"]]);
    drain(engine, state);
    // Both packets aggravated — the bearer's included, which is the one
    // way this card differs from the plain Grenade.
    expect(damage(state)).toContain("M/2/V1/agg");
    expect(damage(state)).toContain("V1/1/environment/agg");
    expect(has(state, "V1", "wp")).toBe(false);
  });
});
