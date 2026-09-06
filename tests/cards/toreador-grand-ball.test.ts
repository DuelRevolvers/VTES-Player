/**
 * Toreador Grand Ball (101989) — "choose two ready Toreador you control,
 * put this card in play, and lock one of the two. The locked Toreador does
 * not unlock as normal. The other Toreador's non-bleed actions cannot be
 * blocked." Exercises both halves of the shared "does not unlock as
 * normal" mechanism (the persistent one here; `skipNextUnlock` is the
 * one-shot form) and the unblockable-action static.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's master phase with two ready Toreador and the card in hand. */
function ballGame(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  const alice = state.seats[0]!;
  alice.minions[0]!.clan = "Toreador"; // V1
  alice.minions.push(makeMinion("T2", "Alice", { clan: "Toreador" }));
  alice.hand.push({ id: "ball", name: "Toreador Grand Ball" });
  return state;
}

function playBall(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "play:Toreador Grand Ball:-:V1:T2"], // lock V1, free T2
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ]);
}

describe("Toreador Grand Ball (101989)", () => {
  it("offers both orderings of the two Toreador and locks the chosen one", () => {
    const state = ballGame();
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    const ids = dp.options.filter((o) => o.id.includes("Toreador Grand Ball")).map((o) => o.id);
    expect(ids).toHaveLength(2); // (lock V1, free T2) and (lock T2, free V1)

    playBall(engine);

    expect(state.seats[0]!.minions.find((m) => m.id === "V1")!.locked).toBe(true);
    expect(state.seats[0]!.minions.find((m) => m.id === "T2")!.locked).toBe(false);
    const entry = state.seats[0]!.permanents.find((p) => p.card.id === "ball")!;
    expect(entry.preventsUnlock).toBe("V1");
    expect(entry.unblockable).toEqual({ minion: "T2", exceptBleed: true });
  });

  it("keeps the locked Toreador locked through the unlock phase", () => {
    const state = ballGame();
    const engine = new VtesEngine(state, testRegistry);
    playBall(engine);

    // Run the turn out and into Alice's next unlock phase.
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
      tf.edgeDone = true;
    }
    // Lock the other Toreador too, so we can tell the two apart.
    state.seats[0]!.minions.find((m) => m.id === "T2")!.locked = true;
    engine.decision(); // settle runs the unlock sweep

    expect(state.seats[0]!.minions.find((m) => m.id === "V1")!.locked).toBe(true); // suppressed
    expect(state.seats[0]!.minions.find((m) => m.id === "T2")!.locked).toBe(false); // normal
  });

  it("makes the other Toreador's non-bleed actions unblockable, but not its bleeds", () => {
    const state = ballGame();
    const engine = new VtesEngine(state, testRegistry);
    playBall(engine);
    runTrace(engine, [["Alice", "pass"]]); // end the master phase

    // A hunt (non-bleed) by the free Toreador: nobody may block.
    runTrace(engine, [
      ["Alice", "hunt:T2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    expect(bob.options.some((o) => o.id.startsWith("block:"))).toBe(false);

    runTrace(engine, [
      ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolves
    ]);
    expect(state.eventLog.find((e) => e.type === "ActionResolved")).toMatchObject({
      success: true,
    });
  });

  it("leaves that Toreador's BLEED blockable — the clause is non-bleed only", () => {
    const state = ballGame();
    const engine = new VtesEngine(state, testRegistry);
    playBall(engine);
    runTrace(engine, [["Alice", "pass"]]); // end the master phase

    runTrace(engine, [
      ["Alice", "bleed:T2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);

    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    expect(bob.options.some((o) => o.id.startsWith("block:"))).toBe(true);
  });

  it("gives a Nosferatu -1 stealth on the action that burns it", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push({
      card: { id: "ball", name: "Toreador Grand Ball" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
    });
    state.seats[1]!.minions[0]!.clan = "Nosferatu";
    const engine = new VtesEngine(state, testRegistry);

    engine.choose("act:Toreador Grand Ball:ball:burn:W");
    const stealth = state.eventLog.filter(
      (e) => e.type === "StealthModified" && e.source === "Toreador Grand Ball",
    );
    expect(stealth).toHaveLength(1);
    expect(stealth[0]).toMatchObject({ delta: -1 });
  });
});

describe("On the Qui Vive (101321) — the ally rider", () => {
  it("marks an ally that wakes with it", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob"; // Bob acts; Alice reacts
    const ally = makeMinion("AL", "Alice", { kind: "ally", blood: 3 });
    ally.locked = true;
    state.seats[0]!.minions.push(ally);
    state.seats[0]!.hand.push({ id: "qv", name: "On the Qui Vive" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "bleed:W"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // announce
      ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:On the Qui Vive:basic:AL"],
      ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], // as played
    ]);

    // The wake happened, and the ally owes an unlock phase for it.
    expect(state.seats[0]!.minions.find((m) => m.id === "AL")!.awake).toBe(true);
    expect(state.seats[0]!.minions.find((m) => m.id === "AL")!.skipNextUnlock).toBe(true);
  });

  it("keeps a marked minion locked for one unlock phase, then clears", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
      tf.edgeDone = true;
    }
    const ally = makeMinion("AL", "Alice", { kind: "ally", blood: 3 });
    ally.locked = true;
    ally.skipNextUnlock = true;
    state.seats[0]!.minions.push(ally);
    state.seats[0]!.minions[0]!.locked = true; // V1, for contrast
    const engine = new VtesEngine(state, testRegistry);

    engine.decision(); // settle runs the unlock sweep

    expect(state.seats[0]!.minions.find((m) => m.id === "AL")!.locked).toBe(true);
    expect(state.seats[0]!.minions.find((m) => m.id === "V1")!.locked).toBe(false);
    // One-shot: spent by that sweep, so the next unlock is normal.
    expect(state.seats[0]!.minions.find((m) => m.id === "AL")!.skipNextUnlock).toBe(false);
  });
});
