/**
 * Chanjelin Ward (100326): "Master. Put this card on a vampire you control.
 * Other Methuselahs' actions targeting this vampire cost an additional blood.
 * This vampire can burn this card to cause an action targeting him or her to
 * fail. A vampire may have only one Chanjelin Ward."
 *
 * Partial: only the surcharge is tested here. The burn-to-fail option is not
 * built (see the card's comment in cards.ts).
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
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

describe("Chanjelin Ward (100326)", () => {
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
