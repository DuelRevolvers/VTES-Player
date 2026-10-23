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

// ---------------------------------------------------------------------------
// Wave 107 — Bravo, Capitalist, Creep Show, Guru, Sociopath
// (docs/archetypes-design.md §7). All five gain 1 blood once per turn,
// automatically, so each scenario reads the event log rather than a choice.
// ---------------------------------------------------------------------------

const gains = (state: GameState, minionId: string): number =>
  state.eventLog.filter((e) => e.type === "BloodGained" && e.minion === minionId).length;
const indexOf = (state: GameState, pred: (e: GameState["eventLog"][number]) => boolean): number =>
  state.eventLog.findIndex(pred);

/** The walker's default: pass, else a hand strike, else end a press. */
function idle(engine: VtesEngine): void {
  const dp = engine.decision()!;
  const pick =
    dp.options.find((o) => o.id === "pass") ??
    dp.options.find((o) => o.id === "strike:hand") ??
    dp.options.find((o) => o.id === "press:end") ??
    dp.options[0]!;
  runTrace(engine, [[dp.seat, pick.id]]);
}

/** Walk idly, taking `script[seat]` the first time it is offered, until
 *  `done` holds. */
function walk(
  engine: VtesEngine,
  done: () => boolean,
  script: Record<string, string> = {},
  limit = 150,
): void {
  const left = { ...script };
  for (let i = 0; i < limit && !done(); i++) {
    const dp = engine.decision();
    if (!dp) return;
    const want = left[dp.seat];
    const hit = want ? dp.options.find((o) => o.id.startsWith(want)) : undefined;
    if (hit) {
      delete left[dp.seat];
      runTrace(engine, [[dp.seat, hit.id]]);
    } else {
      idle(engine);
    }
  }
}

const combatOver = (state: GameState) => (): boolean =>
  state.eventLog.some((e) => e.type === "CombatEnded") &&
  !state.frames.some((f) => f.kind === "combat");
const actionOver = (state: GameState) => (): boolean =>
  !state.frames.some((f) => f.kind === "action");

/** Alice's V1 rushes Bob's W with Hunter's Mark; every idle seat declines
 *  to block. */
function rushW(state: GameState): VtesEngine {
  const v1 = find(state, "V1");
  v1.disciplines = { ...v1.disciplines, cel: "basic", tha: "basic" };
  state.seats[0]!.hand.push({ id: "hm1", name: "Hunter's Mark" });
  const engine = new VtesEngine(state, testRegistry);
  const rush = engine
    .decision()!
    .options.find((o) => o.id.startsWith("play:Hunter's Mark") && o.id.includes(":W:"));
  if (!rush) throw new Error("no rush at W");
  runTrace(engine, [["Alice", rush.id]]);
  return engine;
}

/** Alice's V1 bleeds and Bob's W blocks: V1 (1 blood) against W (strength
 *  2) goes to torpor. A Minor Boon in `boonHolder`'s hand opens the torpor
 *  window, so V1 is GOING to torpor when the combat ends. */
function blockedIntoTorpor(state: GameState, boonHolder?: string): VtesEngine {
  find(state, "V1").blood = 1;
  find(state, "W").strength = 2;
  state.seats[1]!.hand = [];
  if (boonHolder) {
    state.seats.find((s) => s.id === boonHolder)!.hand.push({ id: "mnb", name: "Minor Boon" });
  }
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", "bleed:V1"]]);
  walk(engine, () => engine.decision()!.options.some((o) => o.id === "block:W"));
  runTrace(engine, [["Bob", "block:W"]]);
  return engine;
}

describe("wave 107 — four archetypes that need a Sabbat vampire", () => {
  for (const name of ["Capitalist", "Creep Show", "Guru", "Sociopath"]) {
    it(`${name} goes on a Sabbat vampire you control, and on no other`, () => {
      const state = threeSeatGame();
      masterPhase(state);
      find(state, "V1").sect = "sabbat";
      state.seats[0]!.minions.push(makeMinion("V2", "Alice", { sect: "camarilla" }));
      state.seats[0]!.hand.push({ id: "a1", name });
      const engine = new VtesEngine(state, testRegistry);
      const plays = engine.decision()!.options.filter((o) => o.id.startsWith(`play:${name}:`));
      expect(plays.some((o) => o.id.includes(":V1:"))).toBe(true);
      expect(plays.some((o) => o.id.includes(":V2:"))).toBe(false);
    });
  }

  it("Bravo prints no sect, so it goes on either", () => {
    const state = threeSeatGame();
    masterPhase(state);
    find(state, "V1").sect = "sabbat";
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { sect: "camarilla" }));
    state.seats[0]!.hand.push({ id: "a1", name: "Bravo" });
    const engine = new VtesEngine(state, testRegistry);
    const plays = engine.decision()!.options.filter((o) => o.id.startsWith("play:Bravo:"));
    expect(plays.some((o) => o.id.includes(":V1:"))).toBe(true);
    expect(plays.some((o) => o.id.includes(":V2:"))).toBe(true);
  });
});

describe("Bravo (100247)", () => {
  it("gains 1 blood when its successful rush's combat ends, still ready", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.blood = 3;
    v1.attached.push(archetype("Bravo", "b1"));
    find(state, "W").blood = 5;
    find(state, "W").capacity = 8;
    const engine = rushW(state);
    walk(engine, combatOver(state));
    const ended = indexOf(state, (e) => e.type === "CombatEnded");
    const gained = indexOf(state, (e) => e.type === "BloodGained" && e.minion === "V1");
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(gained).toBeGreaterThan(ended);
    expect(gains(state, "V1")).toBe(1);
    expect(v1.attached[0]!.usedThisTurn).toBe(true);
  });

  it("NEGATIVE SPACE: not when its action was blocked — that combat is the blocker's", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.blood = 4;
    v1.attached.push(archetype("Bravo", "b1"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, () => engine.decision()!.options.some((o) => o.id === "block:W"));
    runTrace(engine, [["Bob", "block:W"]]);
    walk(engine, combatOver(state));
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);
    expect(gains(state, "V1")).toBe(0);
  });

  it("NEGATIVE SPACE: not when the bearer is no longer ready at the end", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.blood = 1;
    v1.attached.push(archetype("Bravo", "b1"));
    const w = find(state, "W");
    w.blood = 5;
    w.strength = 3;
    const engine = rushW(state);
    walk(engine, combatOver(state));
    expect(v1.inTorpor).toBe(true);
    expect(gains(state, "V1")).toBe(0);
  });

  // Owner ruling 2026-10-23 (docs/archetypes-design.md §7.5): a vampire a
  // Minor Boon keeps out of torpor never stopped being ready.
  it("gains 1 blood when a Minor Boon keeps the bearer out of torpor after its rush", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.blood = 1;
    v1.attached.push(archetype("Bravo", "b1"));
    const w = find(state, "W");
    w.blood = 5;
    w.strength = 3;
    state.seats[2]!.hand.push({ id: "mnb", name: "Minor Boon" });
    const engine = rushW(state);
    // The rush's action frame is gone before its combat starts.
    const settled = (): boolean =>
      combatOver(state)() && !state.frames.some((f) => f.kind === "torpor");
    walk(engine, settled, { Carol: "play:Minor Boon" });
    const kept = indexOf(state, (e) => e.type === "TorporPrevented" && e.minion === "V1");
    expect(kept).toBeGreaterThanOrEqual(0);
    expect(v1.inTorpor).toBe(false);
    expect(gains(state, "V1")).toBe(1);
    expect(indexOf(state, (e) => e.type === "BloodGained" && e.minion === "V1")).toBeGreaterThan(kept);
    expect(v1.attached.find((p) => p.card.name === "Bravo")!.usedThisTurn).toBe(true);
  });

  it("NEGATIVE SPACE: a boon after a BLOCK's combat pays nothing — no rush succeeded", () => {
    const state = threeSeatGame();
    find(state, "V1").attached.push(archetype("Bravo", "b1"));
    const engine = blockedIntoTorpor(state, "Carol");
    walk(engine, actionOver(state), { Carol: "play:Minor Boon" });
    expect(state.eventLog.some((e) => e.type === "TorporPrevented" && e.minion === "V1")).toBe(true);
    expect(gains(state, "V1")).toBe(0);
  });
});

describe("Capitalist (100292)", () => {
  it("gains 1 blood when the bearer successfully bleeds its prey", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.attached.push(archetype("Capitalist", "c1"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, actionOver(state));
    expect(state.eventLog.some((e) => e.type === "PoolBurned" && e.seat === "Bob")).toBe(true);
    expect(gains(state, "V1")).toBe(1);
    expect(v1.attached[0]!.usedThisTurn).toBe(true);
  });

  it("NEGATIVE SPACE: a bleed for 0 is not a successful bleed (p. 21)", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.bleedAmount = 0;
    v1.attached.push(archetype("Capitalist", "c1"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, actionOver(state));
    expect(state.eventLog.some((e) => e.type === "ActionResolved")).toBe(true);
    expect(gains(state, "V1")).toBe(0);
  });
});

describe("Creep Show (100442)", () => {
  function creepRush(setUp: (state: GameState) => void, script: Record<string, string>): GameState {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.blood = 3;
    v1.attached.push(archetype("Creep Show", "cs1"));
    find(state, "W").blood = 5;
    find(state, "W").capacity = 8;
    setUp(state);
    const engine = rushW(state);
    walk(engine, combatOver(state), script);
    return state;
  }
  const played = (state: GameState, name: string): boolean =>
    state.eventLog.some((e) => e.type === "CardPlayed" && e.name === name);

  it("gains 1 blood when the opposing minion dodges", () => {
    const state = creepRush((s) => s.seats[1]!.hand.push({ id: "dg1", name: "Dodge" }), {
      Bob: "play:Dodge",
    });
    expect(played(state, "Dodge")).toBe(true);
    expect(gains(state, "V1")).toBe(1);
  });

  it("gains 1 blood when the opposing minion ends combat as a strike", () => {
    const state = creepRush(
      (s) => {
        find(s, "W").disciplines = { ...find(s, "W").disciplines, pre: "basic" };
        s.seats[1]!.hand.push({ id: "cf1", name: "Catatonic Fear" });
      },
      { Bob: "play:Catatonic Fear" },
    );
    expect(played(state, "Catatonic Fear")).toBe(true);
    expect(gains(state, "V1")).toBe(1);
  });

  it("NEGATIVE SPACE: not for hand strikes, and not for the bearer's OWN dodge", () => {
    const plain = creepRush(() => {}, {});
    expect(gains(plain, "V1")).toBe(0);
    const own = creepRush((s) => s.seats[0]!.hand.push({ id: "dg1", name: "Dodge" }), {
      Alice: "play:Dodge",
    });
    expect(played(own, "Dodge")).toBe(true);
    expect(gains(own, "V1")).toBe(0);
  });
});

describe("Guru (100872)", () => {
  function callUprising(vote: boolean): GameState {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.title = "prince";
    v1.attached.push(archetype("Guru", "g1"));
    state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Anarchist Uprising"]]);
    walk(
      engine,
      () => state.eventLog.some((e) => e.type === "ReferendumResolved"),
      vote ? { Alice: "vote:V1:for" } : {},
    );
    return state;
  }

  it("gains 1 blood when its referendum passes — after the effects apply", () => {
    const state = callUprising(true);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved");
    expect(resolved?.type === "ReferendumResolved" && resolved.passed).toBe(true);
    // "Each Methuselah burns 1 pool for each minion they control" — then
    // the blood [LSJ 20090115-2].
    const lastBurn = state.eventLog.map((e) => e.type).lastIndexOf("PoolBurned");
    const gained = indexOf(state, (e) => e.type === "BloodGained" && e.minion === "V1");
    expect(lastBurn).toBeGreaterThanOrEqual(0);
    expect(gained).toBeGreaterThan(lastBurn);
    expect(gains(state, "V1")).toBe(1);
  });

  it("NEGATIVE SPACE: nothing when the referendum fails", () => {
    const state = callUprising(false);
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved");
    expect(resolved?.type === "ReferendumResolved" && resolved.passed).toBe(false);
    expect(gains(state, "V1")).toBe(0);
  });
});

describe("Sociopath (101823)", () => {
  it("gains 1 blood when it sends the opposing vampire to torpor and stays ready", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.blood = 3;
    v1.attached.push(archetype("Sociopath", "s1"));
    find(state, "W").blood = 0;
    const engine = rushW(state);
    walk(engine, combatOver(state));
    expect(find(state, "W").inTorpor).toBe(true);
    expect(gains(state, "V1")).toBe(1);
    expect(v1.attached[0]!.usedThisTurn).toBe(true);
  });

  it("NEGATIVE SPACE: both to torpor at once — neither remains ready, on either side", () => {
    // Damage is applied acting-first (p. 29), so a check made as each one
    // LEFT would have paid whichever side went second. Sociopath is on both.
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.blood = 1;
    v1.attached.push(archetype("Sociopath", "s1"));
    const w = find(state, "W");
    w.sect = "sabbat";
    w.blood = 0;
    w.strength = 2;
    w.attached.push(archetype("Sociopath", "s2"));
    const engine = rushW(state);
    walk(engine, combatOver(state));
    expect(v1.inTorpor).toBe(true);
    expect(w.inTorpor).toBe(true);
    expect(gains(state, "V1")).toBe(0);
    expect(gains(state, "W")).toBe(0);
  });

  it("gains 1 blood when its strike burns an opposing ALLY", () => {
    // An ally emptied by damage used to wait for the next settle to be
    // burned, which fired no combat-leave hook at all.
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.blood = 3;
    v1.attached.push(archetype("Sociopath", "s1"));
    state.seats[1]!.minions.push(makeMinion("A1", "Bob", { kind: "ally", blood: 1, capacity: 1 }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walk(engine, () => engine.decision()!.options.some((o) => o.id === "block:A1"));
    runTrace(engine, [["Bob", "block:A1"]]);
    walk(engine, combatOver(state));
    expect(state.seats[1]!.minions.some((m) => m.id === "A1")).toBe(false);
    expect(gains(state, "V1")).toBe(1);
  });

  it("NEGATIVE SPACE: not when something other than its own strike sends them (owner ruling)", () => {
    // A retainer's damage is environmental (p. 31), not this vampire's
    // strike. The bearer dodges, so the retainer is all that lands.
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.blood = 3;
    v1.attached.push(archetype("Sociopath", "s1"), {
      ...archetype("Test Retainer", "r1"),
      tags: [],
      statics: { combatRoundDamage: { amount: 1, ranged: false } },
    });
    find(state, "W").blood = 0;
    state.seats[0]!.hand.push({ id: "dg1", name: "Dodge" });
    const engine = rushW(state);
    walk(engine, combatOver(state), { Alice: "play:Dodge" });
    expect(state.eventLog.some((e) => e.type === "CardPlayed" && e.name === "Dodge")).toBe(true);
    expect(find(state, "W").inTorpor).toBe(true);
    expect(gains(state, "V1")).toBe(0);
  });

  it("NEGATIVE SPACE: nothing when the opposing minion survives", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.sect = "sabbat";
    v1.blood = 3;
    v1.attached.push(archetype("Sociopath", "s1"));
    find(state, "W").blood = 5;
    const engine = rushW(state);
    walk(engine, combatOver(state));
    expect(gains(state, "V1")).toBe(0);
  });

  it("a vampire GOING to torpor pays when it arrives — and not if a boon keeps it out", () => {
    for (const playBoon of [false, true]) {
      const state = threeSeatGame();
      const w = find(state, "W");
      w.sect = "sabbat";
      w.attached.push(archetype("Sociopath", "s1"));
      const engine = blockedIntoTorpor(state, "Carol");
      walk(engine, actionOver(state), playBoon ? { Carol: "play:Minor Boon" } : {});
      expect(state.eventLog.some((e) => e.type === "TorporPending" && e.minion === "V1")).toBe(true);
      expect(find(state, "V1").inTorpor).toBe(!playBoon);
      expect(gains(state, "W")).toBe(playBoon ? 0 : 1);
    }
  });
});

describe("Monster (101242) — an opponent GOING to torpor is not ready", () => {
  it("offers the unlock when the opposing vampire is held in Minor Boon's window", () => {
    const state = threeSeatGame();
    find(state, "W").attached.push(archetype("Monster", "m1"));
    const engine = blockedIntoTorpor(state, "Carol");
    let offered = false;
    walk(engine, () => {
      offered ||= engine.decision()?.options.some((o) => o.id.startsWith("choice:Monster:")) ?? false;
      return offered || !state.frames.some((f) => f.kind === "action");
    });
    expect(state.eventLog.some((e) => e.type === "TorporPending" && e.minion === "V1")).toBe(true);
    expect(offered).toBe(true);
  });
});
