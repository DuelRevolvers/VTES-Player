/**
 * Chanjelin Ward (100326): "Master. Put this card on a vampire you control.
 * Other Methuselahs' actions targeting this vampire cost an additional blood.
 * This vampire can burn this card to cause an action targeting him or her to
 * fail. A vampire may have only one Chanjelin Ward."
 *
 * The surcharge and the burn-to-fail option are both tested. Burn-to-fail is
 * offered to the bearer's controller when another Methuselah announces an
 * action targeting the bearer; "yes" burns the ward and ends the action.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { newCycle } from "../../src/engine/state.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({ card: { id: "cw", name: "Chanjelin Ward" }, seat: "Alice", attachTo: "V1", statics: { targetedActionBloodTax: 1 }, tags: [] });
  return { state, engine };
}

/** Push an open action by `actingSeat` (acting minion `M`) against `targetMinion`,
 *  with every field the engine sets on an announced action. */
function announce(state: GameState, engine: VtesEngine, actingSeat: "Alice" | "Bob" | "Carol", targetMinion: string) {
  const frame = {
    kind: "action",
    actionId: "act-test",
    actionKind: "bleed",
    card: null,
    acting: "M",
    actingSeat,
    target: "Alice",
    directed: false,
    targetMinion,
    targetPermanent: null,
    rushRiders: { maneuver: 0, press: 0 },
    combatOutcome: null,
    grantedCost: null,
    grantedEffect: null,
    rescueSplit: null,
    step: "announce",
    declinedBlocks: [],
    played: [],
    blockedBy: null,
    notBlockPenalties: [],
    unlockOnSuccess: [],
    drawAfter: [],
    playCostMods: [],
    delayReplaceTypes: [],
    noReactionsFrom: [],
    blockerCombatRiders: {},
    actorCombatRider: { prevent: 0, strength: 0, maneuver: 0, press: 0, handStrikesAggravated: false, combatAggravated: false },
    blockPenalties: [],
    interceptBurnGrants: [],
    attachOnBlock: [],
    usedInPlayAbilities: [],
    corruptionUnlocks: [],
    blockCosts: [],
    noUnlock: false,
    afterResolutionDamage: [],
    queuedCombats: [],
    blockRestrictions: { noAllies: false, noVampires: false, noTitled: false, cannotBlock: [] },
    cycle: newCycle([actingSeat]),
  } as unknown as GameState["frames"][number];
  state.frames.push(frame);
  (engine as any).notifyActionAnnounced(frame);
}

describe("Chanjelin Ward (100326)", () => {
  it("another Methuselah's action on the warded vampire asks the controller to burn the ward", () => {
    const { state, engine } = setup();
    announce(state, engine, "Bob", "V1");
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.includes(":yes"))).toBe(true);
  });

  it("'yes' burns the ward and ends the action unsuccessfully", () => {
    const { state, engine } = setup();
    announce(state, engine, "Bob", "V1");
    const yes = engine.decision()!.options.find((o) => o.id.includes(":yes"))!;
    engine.choose(yes.id);
    expect(minion(state, "V1").attached.some((p) => p.card.name === "Chanjelin Ward")).toBe(false);
    // The action frame is gone: the action ended unsuccessfully.
    expect(state.frames.some((f) => f.kind === "action")).toBe(false);
  });

  it("'no' keeps the ward and the action goes on", () => {
    const { state, engine } = setup();
    announce(state, engine, "Bob", "V1");
    const no = engine.decision()!.options.find((o) => !o.id.includes(":yes"))!;
    engine.choose(no.id);
    expect(minion(state, "V1").attached.some((p) => p.card.name === "Chanjelin Ward")).toBe(true);
    const af = state.frames.find((f) => f.kind === "action") as any;
    expect(af.step).toBe("announce");
  });

  it("an action targeting a different vampire asks nothing", () => {
    const { state, engine } = setup();
    announce(state, engine, "Bob", "W");
    // Bob keeps his own action window; Alice is not offered the ward.
    const dp = engine.decision();
    expect(dp?.seat === "Alice" && dp.options.some((o) => o.id.includes(":yes"))).toBeFalsy();
  });

  it("an action by another Methuselah targeting the warded vampire costs the actor 1 blood", () => {
    const { state, engine } = setup();
    const bob = minion(state, "M"); // Bob's minion in the fixture
    Object.assign(bob, { blood: 3 });
    (engine as any).chargeActionTolls(bob, false, "other", "V1");
    expect(bob.blood).toBe(2);
  });

  it("an action targeting a vampire with no ward costs nothing", () => {
    const { state, engine } = setup();
    const bob = minion(state, "M");
    Object.assign(bob, { blood: 3 });
    (engine as any).chargeActionTolls(bob, false, "other", null);
    expect(bob.blood).toBe(3);
  });

  it("the controller's own action on the warded vampire is not surcharged", () => {
    const { state, engine } = setup();
    const v1 = minion(state, "V1");
    Object.assign(v1, { blood: 3 });
    (engine as any).chargeActionTolls(v1, false, "other", "V1");
    expect(v1.blood).toBe(3);
  });
});
