/**
 * Nephandus (101272): "Nephandus can strike: 1R damage" and "Each strike or
 * damaging effect made by the opposing minion against Nephandus in combat
 * inflicts 1 less damage."
 */
import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Nephandus (Bob's ally, 5 life) fights V1 (Alice's vampire) in combat. */
function setup(inCombat: boolean): { engine: VtesEngine; nephandus: string } {
  const state = threeSeatGame();
  state.seats[1]!.minions.push(makeMinion("NEPH", "Bob", { kind: "ally", name: "Nephandus", blood: 5 }));
  if (inCombat) {
    state.frames.push({
      kind: "combat",
      acting: "V1",
      actingSeat: "Alice",
      opposing: "NEPH",
      opposingSeat: "Bob",
      fromBlock: true,
      round: 1,
      step: "range",
      range: "long",
      awaiting: "acting",
      declines: 0,
      strikes: { acting: null, opposing: null },
      strikeRound: "normal",
      additionalStrikes: { acting: 0, opposing: 0 },
      maneuverCredits: { acting: 0, opposing: 0 },
      closeManeuvers: { acting: 0, opposing: 0 },
      preventCreditsFirstRound: { acting: 0, opposing: 0 },
      unlockForBlood: { acting: 0, opposing: 0 },
      grantedCombatEnds: { acting: false, opposing: false },
      committedStrike: { acting: null, opposing: null },
      usedWeaponManeuver: { acting: null, opposing: null },
      restrict: {
        acting: { maneuver: false, press: false, equipment: false },
        opposing: { maneuver: false, press: false, equipment: false },
      },
      cycle: { order: ["Alice", "Bob", "Carol"], cursor: 0, passes: 0 },
    } as unknown as CombatFrame);
  }
  return { engine: new VtesEngine(state, testRegistry), nephandus: "NEPH" };
}

/** Deliver `amount` damage from `source` to Nephandus, through the engine's
 *  own damage path. */
function hit(engine: VtesEngine, source: string | null, amount: number): void {
  (engine as unknown as {
    applyResolvedDamage(pd: { minion: string; amount: number; source: string | null; aggravated: boolean; fromStrike: boolean }): void;
  }).applyResolvedDamage({ minion: "NEPH", amount, source, aggravated: false, fromStrike: true });
}

describe("Nephandus (101272)", () => {
  it("has its printed 1R strike on the ally itself", () => {
    expect(testRegistry["Nephandus"]?.abilityOptions).toBeDefined();
  });

  it("a strike from the opposing minion in combat inflicts 1 less damage", () => {
    const { engine } = setup(true);
    hit(engine, "V1", 2);
    expect(find(engine.state, "NEPH").blood).toBe(4);
  });

  it("a 1-damage strike from the opposing minion is fully absorbed", () => {
    const { engine } = setup(true);
    hit(engine, "V1", 1);
    expect(find(engine.state, "NEPH").blood).toBe(5);
  });

  it("NEGATIVE SPACE: damage from outside the combat is not reduced", () => {
    const { engine } = setup(false);
    hit(engine, "V1", 2);
    expect(find(engine.state, "NEPH").blood).toBe(3);
  });

  it("NEGATIVE SPACE: environmental damage (no source) is not reduced", () => {
    const { engine } = setup(true);
    hit(engine, null, 2);
    expect(find(engine.state, "NEPH").blood).toBe(3);
  });
});

/** The whole combat, from the bleed to the strikes, with the ally's own
 *  permanent attached to itself as `PermanentEnteredPlay` leaves it. */
describe("Nephandus (101272): a full combat with its 1R strike", () => {
  function fight(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 5;
    const neph = makeMinion("NEPH", "Bob", { kind: "ally", name: "Nephandus", blood: 5 });
    neph.attached.push({ card: { id: "NEPH", name: "Nephandus" }, locked: false, usedThisPhase: false, statics: {}, tags: ["mage"] } as unknown as MinionState["attached"][number]);
    state.seats[1]!.minions.push(neph);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "block:NEPH"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    return { state, engine };
  }

  it("is offered its 1R strike alongside hand strike when the strikes are chosen", () => {
    const { engine } = fight();
    expect(engine.decision()!.window).toBe("combat.chooseStrike");
    expect(engine.decision()!.options.map((o) => o.id)).toContain("strike:hand");
    engine.choose("strike:hand");
    expect(engine.decision()!.options.map((o) => o.id)).toContain("ability:Nephandus:NEPH:strike");
  });

  it("its ranged strike costs the opposing vampire 1 blood, and its own life is untouched by its hand strike", () => {
    const { state, engine } = fight();
    engine.choose("strike:hand");
    engine.choose("ability:Nephandus:NEPH:strike");
    for (let i = 0; i < 30 && engine.decision(); i++) {
      const dp = engine.decision()!;
      engine.choose(dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    // 1R from Nephandus lands on V1: one blood burned.
    expect(find(state, "V1").blood).toBe(4);
    // V1's hand strike (1) is reduced by 1 against Nephandus: no damage.
    expect(find(state, "NEPH").blood).toBe(5);
  });
});
