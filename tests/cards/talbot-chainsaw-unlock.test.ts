/**
 * Talbot's Chainsaw (101931): "If the bearer is ready during your unlock
 * phase, this weapon inflicts 3 unpreventable damage on a ready minion you
 * control." The CONTROLLER picks, not the prey.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function chainsaw(cardId = "cs"): PermanentInPlay {
  const h = testRegistry["Talbot's Chainsaw"]!;
  return {
    card: { id: cardId, name: "Talbot's Chainsaw" },
    locked: false,
    usedThisPhase: false,
    life: 1,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
}

/** Alice's unlock phase, with the Chainsaw on V1 and a second ready
 *  vampire (V2) she also controls, so there is a real choice to make. */
function atUnlock(bearerInTorpor = false): VtesEngine {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.phase = "unlock";
  tf.unlockDone = false;
  // Both start UNLOCKED: a locked vampire burns unlock blood at this phase,
  // which would be mistaken for the Chainsaw's damage.
  // Capacity is raised so blood above it is not drained at settle, which
  // would otherwise be mistaken for the Chainsaw's damage.
  const v1 = find(state, "V1");
  v1.blood = 8;
  v1.capacity = 10;
  v1.locked = false;
  v1.inTorpor = bearerInTorpor;
  v1.attached.push(chainsaw());
  state.seats[0]!.minions.push({ ...find(state, "V1"), id: "V2", name: "V2", attached: [], blood: 8, inTorpor: false, locked: false, capacity: 10 });
  return new VtesEngine(state, testRegistry);
}

const PICK_V2 = "choice:Talbot's Chainsaw:cs:unlockPhaseDamage:V2";

describe("Talbot's Chainsaw unlock damage", () => {
  it("the controller is asked to choose a ready minion they control", () => {
    const engine = atUnlock();
    const dp = engine.decision();
    expect(dp?.seat).toBe("Alice");
    expect(dp?.options.map((o) => o.id)).toEqual(
      expect.arrayContaining([PICK_V2, "choice:Talbot's Chainsaw:cs:unlockPhaseDamage:V1"]),
    );
  });

  it("the chosen minion takes 3 unpreventable damage", () => {
    const engine = atUnlock();
    runTrace(engine, [["Alice", PICK_V2]]);
    expect(find(engine.state, "V2").blood).toBe(5);
    expect(find(engine.state, "V1").blood).toBe(8);
  });

  it("NEGATIVE SPACE: a bearer in torpor is not ready, so nothing is asked", () => {
    const engine = atUnlock(true);
    const ids = engine.decision()?.options.map((o) => o.id) ?? [];
    expect(ids.some((id) => id.includes("unlockPhaseDamage:"))).toBe(false);
    expect(find(engine.state, "V2").blood).toBe(8);
  });
});
