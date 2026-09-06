/**
 * "During YOUR unlock phase" abilities must fire only in their
 * controller's own unlock phase. The unlock window is also offered to the
 * other seats (for "during ANY Methuselah's unlock phase" cards such as
 * Homunculus), so `ctx.seat === owner.seat` alone is not enough — the
 * turn's seat has to match too (PlayContext.turnSeat).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Bob's turn, unlock phase; Alice controls the card under test. */
function bobsUnlockPhase(entry: PermanentInPlay): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = "Bob";
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  state.seats[0]!.permanents.push(entry);
  return state;
}

function location(id: string, name: string, tags: string[], counters?: number): PermanentInPlay {
  const entry: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags,
  };
  if (counters !== undefined) entry.counters = counters;
  return entry;
}

/** All options offered to any seat until the unlock phase ends. */
function unlockOptions(state: GameState): string[] {
  const engine = new VtesEngine(state, testRegistry);
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "turn.unlock") break;
    ids.push(...dp.options.map((o) => `${dp.seat}:${o.id}`));
    engine.choose(dp.options.find((o) => o.id === "pass")!.id);
  }
  return ids;
}

describe("'During your unlock phase' abilities", () => {
  it("does not offer a hunting ground during another Methuselah's unlock phase", () => {
    const ids = unlockOptions(
      bobsUnlockPhase(location("hg1", "Academic Hunting Ground", ["location", "huntingGround"])),
    );
    expect(ids.some((id) => id.includes("Academic Hunting Ground"))).toBe(false);
  });

  it("does not accumulate a Powerbase: Madrid counter on another Methuselah's turn", () => {
    const state = bobsUnlockPhase(location("pm1", "Powerbase: Madrid", ["location"], 0));
    const ids = unlockOptions(state);
    expect(ids.some((id) => id.includes("Powerbase: Madrid"))).toBe(false);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(0);
  });

  it("does not offer Vessel's blood move on another Methuselah's turn", () => {
    const state = bobsUnlockPhase(location("x", "unused", []));
    state.seats[0]!.permanents.pop();
    state.seats[0]!.minions[0]!.attached.push({
      card: { id: "v1", name: "Vessel" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Vessel"],
    });
    expect(unlockOptions(state).some((id) => id.includes("Vessel"))).toBe(false);
  });

  it("still offers the hunting ground during its controller's own unlock phase", () => {
    const state = bobsUnlockPhase(
      location("hg1", "Academic Hunting Ground", ["location", "huntingGround"]),
    );
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Alice"; // back to Alice's own turn
    expect(
      unlockOptions(state).some((id) => id.startsWith("Alice:ability:Academic Hunting Ground")),
    ).toBe(true);
  });

  it("still offers Homunculus during another Methuselah's unlock phase", () => {
    const state = bobsUnlockPhase(location("x", "unused", []));
    state.seats[0]!.permanents.pop();
    const v1 = state.seats[0]!.minions[0]!;
    v1.locked = true;
    v1.attached.push({
      card: { id: "h1", name: "Homunculus" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Homunculus"],
    });
    expect(unlockOptions(state).some((id) => id.includes("Homunculus"))).toBe(true);
  });
});
