/**
 * The four archetypes (docs/archetypes-design.md).
 *
 * They share a skeleton — put on a vampire you control, one archetype per
 * vampire — and differ only in the once-per-turn trigger, so the shared
 * half is asserted once and each trigger gets its own scenario, including
 * the negative space: the trigger that must NOT fire.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** An archetype already on a vampire, as if played earlier. */
function archetype(name: string, id: string): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["archetype", name],
  };
}

function masterPhase(state: GameState): void {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
}

function find(state: GameState, id: string): MinionState {
  return state.seats.flatMap((s) => s.minions).find((m) => m.id === id)!;
}

describe("the archetype skeleton", () => {
  it("goes on a vampire you control", () => {
    const state = threeSeatGame();
    masterPhase(state);
    state.seats[0]!.hand.push({ id: "p1", name: "Perfectionist" });
    const engine = new VtesEngine(state, testRegistry);

    const plays = engine.decision()!.options.filter((o) => o.id.startsWith("play:Perfectionist"));
    expect(plays.length).toBeGreaterThan(0);
    // Only Alice's own vampires are offered — not Bob's or Carol's.
    for (const o of plays) {
      expect(state.seats[0]!.minions.some((m) => o.id.includes(m.id))).toBe(true);
    }
  });

  it("allows only one archetype per vampire", () => {
    const state = threeSeatGame();
    masterPhase(state);
    state.seats[0]!.minions[0]!.attached.push(archetype("Monster", "m1"));
    state.seats[0]!.minions.push(makeMinion("V2", "Alice"));
    state.seats[0]!.hand.push({ id: "p1", name: "Perfectionist" });
    const engine = new VtesEngine(state, testRegistry);

    const plays = engine.decision()!.options.filter((o) => o.id.startsWith("play:Perfectionist"));
    // V1 already has one; V2 is still free.
    expect(plays.some((o) => o.id.includes("V2"))).toBe(true);
    expect(plays.some((o) => o.id.includes(":V1:"))).toBe(false);
  });
});

describe("Perfectionist (101388)", () => {
  it("gains 1 blood after a successful action with no reaction played", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2;
    alice.minions[0]!.attached.push(archetype("Perfectionist", "p1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → C
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
      ["Alice", "choice:Perfectionist"],
    ]);

    expect(alice.minions[0]!.blood).toBe(3);
    expect(alice.minions[0]!.attached[0]!.usedThisTurn).toBe(true);
  });

  it("does not trigger when a reaction card was played", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2;
    alice.minions[0]!.attached.push(archetype("Perfectionist", "p1"));
    // Bob wakes with a reaction card during the action. A wake is what a
    // LOCKED vampire plays to react at all (p. 25), so lock them.
    const bob = state.seats[1]!;
    for (const m of bob.minions) m.locked = true;
    bob.hand.push({ id: "wake", name: "Wake with Evening's Freshness" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "play:Wake with Evening's Freshness"], // reactions live in state A
    ]);
    // Play the action out; nothing else is needed from the trace.
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("choice:Perfectionist"))) break;
      const pass = dp.options.find((o) => o.id === "pass");
      engine.choose(pass?.id ?? dp.options[0]!.id);
    }

    // The action succeeded, but a reaction was played during it.
    expect(state.eventLog.some((e) => e.type === "ActionResolved" && e.success)).toBe(true);
    expect(
      engine.decision()?.options.some((o) => o.id.startsWith("choice:Perfectionist")) ?? false,
    ).toBe(false);
    expect(alice.minions[0]!.blood).toBe(2);
  });

  it("does not trigger on a failed action", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2;
    alice.minions[0]!.attached.push(archetype("Perfectionist", "p1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"], // 0 intercept vs 0 stealth → the block succeeds
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(alice.minions[0]!.blood).toBe(2);
  });
});

describe("Rebel (101564)", () => {
  it("gains 1 blood on blocking a TITLED vampire, before block resolution", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const bob = state.seats[1]!;
    alice.minions[0]!.title = "prince"; // the acting vampire is titled
    const blocker = bob.minions.find((x) => x.id === "M")!;
    blocker.blood = 2;
    blocker.attached.push(archetype("Rebel", "r1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);

    // Automatic — no question was asked, and it arrived while the block
    // attempt is still open (before it resolves).
    expect(blocker.blood).toBe(3);
    expect(state.frames.some((f) => f.kind === "blockAttempt")).toBe(true);
    expect(blocker.attached[0]!.usedThisTurn).toBe(true);
  });

  it("does not trigger on blocking an untitled vampire's ordinary action", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const blocker = bob.minions.find((x) => x.id === "M")!;
    blocker.blood = 2;
    blocker.attached.push(archetype("Rebel", "r1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"], // V1 has no title
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);

    expect(blocker.blood).toBe(2);
  });

  it("gains 1 blood on blocking a political action by an untitled vampire", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const bob = state.seats[1]!;
    const blocker = bob.minions.find((x) => x.id === "M")!;
    blocker.blood = 2;
    blocker.attached.push(archetype("Rebel", "r1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);

    expect(blocker.blood).toBe(3);
  });

  it("fires only once each turn", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.title = "prince";
    alice.minions.push(makeMinion("V2", "Alice", { title: "prince" }));
    const bob = state.seats[1]!;
    const blocker = bob.minions.find((x) => x.id === "M")!;
    blocker.blood = 2;
    blocker.attached.push(archetype("Rebel", "r1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      // First action: blocked, Rebel triggers.
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block resolves
    ]);
    expect(blocker.blood).toBe(3);
    const afterFirst = blocker.blood;

    // Whatever else happens this turn, the archetype is spent.
    expect(blocker.attached[0]!.usedThisTurn).toBe(true);
    expect(blocker.blood).toBe(afterFirst);
  });
});

describe("Monster (101242)", () => {
  it("burns 1 blood to unlock when the opposing minion is in torpor", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const bob = state.seats[1]!;
    // Alice's V1 is a heavy hitter; Bob's blocker M is on 1 blood, so one
    // hand strike sends it to torpor.
    alice.minions[0]!.strength = 3;
    alice.minions[0]!.blood = 3;
    alice.minions[0]!.attached.push(archetype("Monster", "m1"));
    const m = bob.minions.find((x) => x.id === "M")!;
    m.blood = 1;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block succeeds
      // Combat: one round of hand strikes.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
    ]);

    // Play out whatever the combat still needs, then take the offer.
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const monster = dp.options.find((o) => o.id.startsWith("choice:Monster"));
      if (monster) {
        engine.choose(monster.id);
        break;
      }
      engine.choose(dp.options[0]!.id);
    }

    expect(find(state, "M").inTorpor).toBe(true);
    expect(alice.minions[0]!.locked).toBe(false); // unlocked by the archetype
    expect(alice.minions[0]!.attached[0]!.usedThisTurn).toBe(true);
  });

  it("does not trigger when the opposing minion is still ready", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 3;
    alice.minions[0]!.attached.push(archetype("Monster", "m1"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
    ]);

    let offered = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("choice:Monster"))) {
        offered = true;
        break;
      }
      engine.choose(dp.options[0]!.id);
    }
    // Bob's M survived on 2 blood, so it is still ready.
    expect(find(state, "M").inTorpor).toBe(false);
    expect(offered).toBe(false);
  });
});

describe("Dabbler (100485)", () => {
  it("triggers after an action in which the vampire used 3+ Disciplines", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const v1 = alice.minions[0]!;
    v1.blood = 4; // enough to pay both cards' blood costs
    v1.disciplines = { dom: "superior", ani: "superior", pro: "superior" };
    v1.attached.push(archetype("Dabbler", "d1"));
    // Two cards, three Disciplines: Beast Meld requires ANI *and* PRO
    // ({ all: [...] }), so it contributes both. Stacking bleed modifiers
    // would not work — only one LIMITED bleed bonus per action (p. 10) —
    // and stealth modifiers are only offered when stealth is needed
    // (p. 26), which an unblocked action never is.
    alice.hand.push({ id: "c1", name: "Conditioning" }); // dom
    alice.hand.push({ id: "c2", name: "Beast Meld" }); // ani + pro
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Beast Meld"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // Finish the action and take the Dabbler offer when it appears.
    let took = false;
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const gain = dp.options.find((o) => o.id.startsWith("choice:Dabbler") && o.id.endsWith("gain"));
      if (gain) {
        engine.choose(gain.id);
        took = true;
        break;
      }
      engine.choose(dp.options[0]!.id);
    }
    expect(took).toBe(true);
    expect(v1.attached[0]!.usedThisTurn).toBe(true);
  });

  it("does not trigger on two Disciplines", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    const v1 = alice.minions[0]!;
    v1.blood = 2;
    v1.disciplines = { ani: "superior", pro: "superior" };
    v1.attached.push(archetype("Dabbler", "d1"));
    // Beast Meld alone is exactly TWO Disciplines — one short.
    alice.hand.push({ id: "c2", name: "Beast Meld" }); // ani + pro
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Beast Meld"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id.startsWith("choice:Dabbler"))).toBe(false);
      engine.choose(dp.options[0]!.id);
    }
    expect(v1.attached[0]!.usedThisTurn ?? false).toBe(false);
  });
});
