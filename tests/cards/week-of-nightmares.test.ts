/**
 * Week of Nightmares (102166) — the first **game-wide** unique card (the
 * event log is the record of what has ever been played), a global clan
 * aura that also takes the hunt action away, a granted blood-steal, and
 * nightmare counters that come due when the card runs dry.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function week(seat = "Alice", counters = 10) {
  return {
    card: { id: "won", name: "Week of Nightmares" },
    controller: seat,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["Week of Nightmares"],
    counters,
    aura: {
      scope: "global" as const,
      clan: "Ravnos",
      bleed: 1,
      strength: 1,
      cannotHunt: true,
    },
  };
}

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((m) => m.id === id);
}

/** Everyone's vampires are Ravnos, so the aura reaches all of them. */
function ravnosGame(): GameState {
  const state = threeSeatGame();
  for (const s of state.seats) for (const m of s.minions) m.clan = "Ravnos";
  return state;
}

describe("Week of Nightmares (102166)", () => {
  it("can only be played once in a game, by anyone", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    state.seats[0]!.hand.push({ id: "won", name: "Week of Nightmares" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.includes("Week of Nightmares"))).toBe(
      true,
    );

    runTrace(engine, [
      ["Alice", "play:Week of Nightmares"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(state.seats[0]!.permanents[0]!.counters).toBe(10);

    // Bob holds a second copy: no longer playable, even though it is his
    // first and even after the first one leaves play.
    engine.burnPermanent("won");
    const tf2 = state.frames[0]!;
    if (tf2.kind === "turn") {
      tf2.seat = "Bob";
      tf2.phase = "master";
      tf2.masterActionsLeft = 1;
    }
    state.seats[1]!.hand.push({ id: "won2", name: "Week of Nightmares" });
    expect(engine.decision()!.options.some((o) => o.id.includes("Week of Nightmares"))).toBe(
      false,
    );
  });

  it("gives every Methuselah's Ravnos +1 bleed and +1 strength", () => {
    const state = ravnosGame();
    state.seats[0]!.permanents.push(week());
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // Bleed 1 + 1 from the aura.
    expect(state.seats[1]!.pool).toBe(8);
  });

  it("takes the hunt action away from Ravnos, and only Ravnos", () => {
    const state = ravnosGame();
    find(state, "V1")!.clan = "Ravnos";
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Brujah" }));
    state.seats[0]!.permanents.push(week());
    const dp = new VtesEngine(state, testRegistry).decision()!;

    expect(dp.options.some((o) => o.id === "hunt:V1")).toBe(false);
    expect(dp.options.some((o) => o.id === "hunt:V2")).toBe(true);
  });

  it("lets a Ravnos steal 1 blood from another Ravnos", () => {
    const state = ravnosGame();
    state.seats[0]!.permanents.push(week());
    find(state, "V1")!.blood = 1;
    find(state, "W")!.blood = 3;
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Week of Nightmares:won:steal:V1:W")).toBe(
      true,
    );

    runTrace(engine, [
      ["Alice", "act:Week of Nightmares:won:steal:V1:W"],
      // Undirected (no minion target on the frame), so prey then predator
      // get the block window (p. 25).
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(find(state, "V1")!.blood).toBe(2);
    expect(find(state, "W")!.blood).toBe(2);
  });

  it("moves a nightmare counter in each Methuselah's own unlock phase", () => {
    const state = ravnosGame();
    state.seats[0]!.permanents.push(week("Alice", 2));
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob"; // not the card's controller
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob"); // "that Methuselah", not the owner
    const put = dp.options.find((o) => o.id.endsWith(":nightmare:W"));
    expect(put).toBeDefined();
    engine.choose(put!.id);

    expect(state.seats[0]!.permanents[0]!.counters).toBe(1);
    expect(find(state, "W")!.counters?.["nightmare"]).toBe(1);
  });

  it("comes due when the last counter goes: pay a blood each, or burn", () => {
    const state = ravnosGame();
    state.seats[0]!.permanents.push(week("Alice", 1));
    // W already carries 2 nightmares and can pay; N carries 3 and cannot.
    Object.assign(find(state, "W")!, { blood: 3, counters: { nightmare: 2 } });
    Object.assign(find(state, "N")!, { blood: 1, counters: { nightmare: 3 } });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    engine.choose(dp.options.find((o) => o.id.endsWith(":nightmare:V1"))!.id);

    // V1 took the last counter (1), W had 2, N had 3 and only 1 blood.
    expect(find(state, "V1")!.blood).toBe(1); // 2 - 1
    expect(find(state, "W")!.blood).toBe(1); // 3 - 2
    expect(find(state, "N")).toBeUndefined(); // could not pay 3
    expect(state.seats[0]!.permanents).toHaveLength(0); // the card burns
  });
});
