/**
 * Crypt wave 6 — the referendum tail (docs/crypt-wave-6.md).
 *
 * Three cards that reach into a referendum from three different angles: a
 * bonus that depends on which WAY a vote is cast, a toll on casting one,
 * and a consequence for the caller when the referendum does not pass.
 *
 * Each is tested in both directions, because all three are conditions on
 * an option list — and a list that is empty (or unchanged) for the wrong
 * reason looks exactly like a correct one.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, handSizeOf } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

function asVampire(m: MinionState, cryptName: string): MinionState {
  const entry = handlers[cryptName]?.cryptEntry?.();
  if (!entry) throw new Error(`no crypt entry for ${cryptName}`);
  m.attached.push({
    card: { id: m.id, name: cryptName },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics: entry.statics,
    tags: entry.tags,
  });
  return m;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function options(engine: VtesEngine) {
  return engine.decision()?.options ?? [];
}
function optionIds(engine: VtesEngine): string[] {
  return options(engine).map((o) => o.id);
}

/** Alice calls Anarchist Uprising and reaches the polling step. */
const TO_POLLING: Array<[string, string]> = [
  ["Alice", "play:Anarchist Uprising"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
];

/** A three-seat game with a titled vampire per seat, ready to poll. */
function politicalGame(setUp: (s: GameState) => void = () => {}): {
  state: GameState;
  engine: VtesEngine;
} {
  const state = threeSeatGame();
  find(state, "V1").title = "prince";
  find(state, "W").title = "prince";
  state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
  setUp(state);
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/**
 * Walk the polling cycle until `seat` is the one being asked, and return
 * their options. The polling step cycles every Methuselah starting with
 * the CALLER, so a test about the defender's options has to pass through
 * the caller's impulse first.
 */
function pollingOptionsFor(engine: VtesEngine, seat: string, limit = 12) {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (dp.seat === seat) return dp.options;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  throw new Error(`${seat} was never asked during polling`);
}

/** A referendum frame on the stack, with the real cycle shape. */
function pushReferendum(state: GameState, over: Record<string, unknown>): void {
  state.frames.push({
    kind: "referendum",
    variant: "political",
    caller: "Alice",
    callingMinion: "V1",
    cardName: "Anarchist Uprising",
    cardInstanceId: null,
    step: "polling",
    votes: [],
    usedSources: [],
    voteGrants: {},
    // `{ order, cursor, passes }` — the real `ImpulseCycle`. Getting this
    // wrong throws inside `cycleQuiescent`, not at the assertion.
    cycle: { order: ["Alice", "Bob", "Carol"], cursor: 0, passes: 0 },
    bloodHuntTarget: null,
    ...over,
  } as unknown as GameState["frames"][number]);
}

// ---------------------------------------------------------------------------
// Jason Newberry — a bonus that depends on WHICH WAY you vote
// ---------------------------------------------------------------------------

describe("Jason Newberry", () => {
  /** The counts on Bob's two vote options in the given referendum. */
  function voteCounts(bloodHunt: boolean): { for: number; against: number } {
    const state = threeSeatGame();
    const jason = find(state, "W"); // Bob's
    jason.title = "primogen";
    asVampire(jason, 'Jason "Son" Newberry (G6)');
    pushReferendum(state, { variant: bloodHunt ? "bloodHunt" : "political" });
    const engine = new VtesEngine(state, testRegistry);
    const opts = pollingOptionsFor(engine, "Bob").filter(
      (o) => o.kind === "castVote" && o.source === "W",
    );
    const forOpt = opts.find((o) => o.kind === "castVote" && o.inFavor);
    const againstOpt = opts.find((o) => o.kind === "castVote" && !o.inFavor);
    return {
      for: forOpt?.kind === "castVote" ? forOpt.count : 0,
      against: againstOpt?.kind === "castVote" ? againstOpt.count : 0,
    };
  }

  it("gets +2 AGAINST a blood hunt, and nothing FOR it", () => {
    // Absolute numbers, not a relation: `against === for + 2` would also
    // hold if the FOR option were simply missing, which is the "passes
    // for the wrong reason" shape this project keeps finding.
    expect(voteCounts(true)).toEqual({ for: 1, against: 3 });
  });

  it("gets no bonus at all in an ordinary political referendum", () => {
    // The control case, and the reason the `variant` filter exists: a
    // bonus that applied everywhere would look identical from the first
    // test alone. A primogen is 1 vote (p. 28).
    expect(voteCounts(false)).toEqual({ for: 1, against: 1 });
  });

  it("still carries his printed +1 bleed", () => {
    const state = threeSeatGame();
    const jason = find(state, "V1");
    asVampire(jason, 'Jason "Son" Newberry (G6)');
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id === "bleed:V1")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    runTrace(engine, [["Alice", "bleed:V1"]]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.actionKind).toBe("bleed");
  });
});

// ---------------------------------------------------------------------------
// Alexander Silverson — a toll on casting AGAINST
// ---------------------------------------------------------------------------

describe("Alexander Silverson", () => {
  it("charges a vampire 1 blood to vote AGAINST his referendum, and nothing to vote FOR", () => {
    const { engine } = politicalGame((s) => {
      asVampire(find(s, "V1"), "Alexander Silverson (G6)"); // the caller
      find(s, "W").blood = 3;
    });
    runTrace(engine, TO_POLLING);
    const bobsVotes = pollingOptionsFor(engine, "Bob").filter(
      (o) => o.kind === "castVote" && o.source === "W",
    );
    const against = bobsVotes.find((o) => o.kind === "castVote" && !o.inFavor);
    const forIt = bobsVotes.find((o) => o.kind === "castVote" && o.inFavor);
    expect(against?.kind === "castVote" ? against.toll : undefined).toBe(1);
    // The toll is on the against side ONLY — the card says so.
    expect(forIt?.kind === "castVote" ? forIt.toll : undefined).toBeUndefined();
  });

  it("actually burns the blood when the vote is cast", () => {
    const { state, engine } = politicalGame((s) => {
      asVampire(find(s, "V1"), "Alexander Silverson (G6)");
      find(s, "W").blood = 3;
    });
    runTrace(engine, TO_POLLING);
    pollingOptionsFor(engine, "Bob");
    runTrace(engine, [["Bob", "vote:W:against"]]);
    expect(find(state, "W").blood).toBe(2);
  });

  it("does NOT offer the against-vote to a vampire who cannot pay", () => {
    const { engine } = politicalGame((s) => {
      asVampire(find(s, "V1"), "Alexander Silverson (G6)");
      // 0 blood, and LOCKED so the mandatory hunt (p. 21) cannot feed him
      // — a fixture that sets blood to 0 has also enabled a mandatory
      // action, which is how this trap has bitten three times.
      const w = find(s, "W");
      w.blood = 0;
      w.locked = true;
    });
    runTrace(engine, TO_POLLING);
    const ids = pollingOptionsFor(engine, "Bob").map((o) => o.id);
    expect(ids).not.toContain("vote:W:against");
    // …but he may still vote FOR, which is the control: the gate is the
    // toll, not the vampire.
    expect(ids).toContain("vote:W:for");
  });

  it("charges nothing when somebody ELSE called the referendum", () => {
    const { engine } = politicalGame((s) => {
      // Silverson is on Alice's OTHER vampire, not the caller.
      s.seats[0]!.minions.push({
        ...find(s, "V1"),
        id: "V9",
        name: "V9",
        attached: [],
        title: null,
      });
      asVampire(find(s, "V9"), "Alexander Silverson (G6)");
      find(s, "W").blood = 3;
    });
    runTrace(engine, TO_POLLING);
    const against = pollingOptionsFor(engine, "Bob").find(
      (o) => o.kind === "castVote" && o.source === "W" && !o.inFavor,
    );
    expect(against).toBeDefined();
    expect(against?.kind === "castVote" ? against.toll : undefined).toBeUndefined();
  });

  it("does not toll a vote from the EDGE — a toll is paid in blood", () => {
    const { engine } = politicalGame((s) => {
      asVampire(find(s, "V1"), "Alexander Silverson (G6)");
      s.edge = "Bob";
    });
    runTrace(engine, TO_POLLING);
    const edge = pollingOptionsFor(engine, "Bob").find(
      (o) => o.kind === "castVote" && o.source === "edge" && !o.inFavor,
    );
    expect(edge).toBeDefined();
    expect(edge?.kind === "castVote" ? edge.toll : undefined).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Ashur-uballit — a bonus applied where the life is COMPUTED
// ---------------------------------------------------------------------------

describe("Ashur-uballit", () => {
  /** Recruit `ally` and report its life and capacity as it enters. */
  function recruit(ally: string, withAshur: boolean): { life: number; capacity: number } {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    v1.blood = 6;
    v1.capacity = 10;
    v1.disciplines = { obf: "superior", pot: "superior", ani: "superior", obl: "superior" };
    if (withAshur) {
      state.seats[0]!.minions.push(makeMinion("V9", "Alice", { capacity: 10, blood: 4 }));
      asVampire(find(state, "V9"), "Ashur-uballit, Son of the Abyss (G6)");
    }
    state.seats[0]!.hand.push({ id: "a1", name: ally });
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const play = dp.options.find((o) => o.id.startsWith(`play:${ally}`));
      if (play) {
        runTrace(engine, [["Alice", play.id]]);
        break;
      }
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    for (let i = 0; i < 30; i++) {
      const m = state.seats[0]!.minions.find((x) => x.id === "a1");
      if (m) return { life: m.blood, capacity: m.capacity };
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    throw new Error(`${ally} never entered play`);
  }

  it("gives a ZOMBIE +1 starting life, and raises its capacity with it", () => {
    const without = recruit("Bone Shambler", false);
    const with_ = recruit("Bone Shambler", true);
    expect(with_.life).toBe(without.life + 1);
    // For an ally, `capacity` IS the printed starting life (p. 11) — so
    // raising one without the other would have `drainOverCapacity` burn
    // the point straight back off.
    expect(with_.capacity).toBe(with_.life);
  });

  it("does nothing for an ally that is not a zombie", () => {
    // The control case, and it must be a REAL ally that simply lacks the
    // tag — one the engine did not recognise would look identical.
    const without = recruit("Screamer", false);
    const with_ = recruit("Screamer", true);
    expect(handlers["Screamer"]?.allyEntry).toBeDefined();
    expect(with_.life).toBe(without.life);
  });
});

// ---------------------------------------------------------------------------
// Fotini — a third hand-size duration
// ---------------------------------------------------------------------------

describe("Fotini Katsikaris", () => {
  /** Bleed with Fotini and run the action out; report the state. */
  function bleedWithFotini() {
    const state = threeSeatGame();
    asVampire(find(state, "V1"), "Fotini Katsikaris (G6)");
    for (let i = 0; i < 12; i++) {
      state.seats[0]!.library.push({ id: `lib${i}`, name: "Aire of Elation" });
    }
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id === "bleed:V1")) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    runTrace(engine, [["Alice", "bleed:V1"]]);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
      runTrace(engine, [
        [dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id],
      ]);
    }
    return { state, engine };
  }

  it("draws a card up on a successful bleed", () => {
    const { state } = bleedWithFotini();
    expect(handSizeOf(state, "Alice")).toBe(8);
    expect(state.seats[0]!.hand.length).toBe(8);
  });

  it("LIFTS as the discard phase opens, not at end of turn", () => {
    // The whole point of the duration: a bonus that lasted through the
    // discard phase would let its holder keep the extra card.
    const { state, engine } = bleedWithFotini();
    for (let i = 0; i < 60; i++) {
      const tf = state.frames.find((f) => f.kind === "turn");
      if (tf?.kind === "turn" && tf.phase === "discard") break;
      const dp = engine.decision();
      if (!dp) break;
      const pick =
        dp.options.find((o) => o.id.startsWith("choice:")) ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    // The grant is gone the moment the phase opens…
    expect(handSizeOf(state, "Alice")).toBe(7);
    // …and p. 7's discard-down is what sheds the extra card, so the
    // engine asks rather than silently trimming.
    const dp = engine.decision();
    expect(dp?.options.some((o) => o.id.includes("handSizeDown"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cedrick Calhoun — the caller pays for losing
// ---------------------------------------------------------------------------

describe("Cedrick Calhoun", () => {
  it("goes to torpor when his own referendum FAILS", () => {
    const { state, engine } = politicalGame((s) => {
      asVampire(find(s, "V1"), "Cedrick Calhoun (G6)");
    });
    runTrace(engine, TO_POLLING);
    // Nobody votes: a tie fails (p. 28).
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ReferendumResolved")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved");
    expect(resolved).toMatchObject({ passed: false });
    expect(find(state, "V1").inTorpor).toBe(true);
  });

  it("stays ready when his referendum PASSES", () => {
    // The control case: a hook that fired on every resolution would look
    // identical from the failure test alone.
    const { state, engine } = politicalGame((s) => {
      asVampire(find(s, "V1"), "Cedrick Calhoun (G6)");
    });
    runTrace(engine, TO_POLLING);
    runTrace(engine, [["Alice", "vote:V1:for"]]);
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ReferendumResolved")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    expect(state.eventLog.find((e) => e.type === "ReferendumResolved")).toMatchObject({
      passed: true,
    });
    expect(find(state, "V1").inTorpor).toBe(false);
  });

  it("is untouched by a referendum somebody ELSE called", () => {
    const { state, engine } = politicalGame((s) => {
      // Cedrick is Alice's second vampire; V1 does the calling.
      s.seats[0]!.minions.push({
        ...find(s, "V1"),
        id: "V9",
        name: "V9",
        attached: [],
        title: null,
      });
      asVampire(find(s, "V9"), "Cedrick Calhoun (G6)");
    });
    runTrace(engine, TO_POLLING);
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.eventLog.some((e) => e.type === "ReferendumResolved")) break;
      runTrace(engine, [[dp.seat, dp.options.find((o) => o.id === "pass")?.id ?? dp.options[0]!.id]]);
    }
    expect(state.eventLog.find((e) => e.type === "ReferendumResolved")).toMatchObject({
      passed: false,
    });
    // The referendum failed, but it was not HIS.
    expect(find(state, "V9").inTorpor).toBe(false);
  });

  it("also fires when the referendum is CANCELLED, which emits no resolution", () => {
    // "Canceled OR fails" names two outcomes the engine deliberately keeps
    // apart: a cancelled referendum never resolves at all, so a hook hung
    // on `ReferendumResolved` would miss this half entirely.
    const state = threeSeatGame();
    const cedrick = find(state, "V1");
    cedrick.title = "prince";
    asVampire(cedrick, "Cedrick Calhoun (G6)");
    pushReferendum(state, { cancelled: true });
    const engine = new VtesEngine(state, testRegistry);
    engine.decision(); // settle drops the cancelled frame
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved")).toBe(false);
    expect(find(state, "V1").inTorpor).toBe(true);
  });
});
