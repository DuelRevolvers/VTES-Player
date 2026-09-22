/**
 * THE PASS CLOCK (owner request 2026-09-21, docs/pass-timeout-design.md).
 *
 * *"Add an option in the moderation settings during a game to have a
 * timeout for players that are talking too long to pass … only for when
 * players are given a choice to play card from their hand or pass during
 * other player's turn, not on their turn."*
 *
 * The owner's standing rule is that a player is NEVER auto-skipped, so
 * what these tests are mostly about is the four conditions that keep this
 * from being an auto-skip. The first two are ordinary; the last two are
 * the ones a future change could quietly break:
 *
 *  - **it is off by default**, and a table that never turns it on behaves
 *    exactly as it did before it existed;
 *  - **a bot never gets a clock**, because a bot is not stalling;
 *  - **it never runs on a seat's own turn**; and
 *  - **it never runs where PASS IS NOT ALREADY LEGAL** — the whole safety
 *    argument, because it means the clock takes an answer the engine was
 *    already offering rather than inventing one.
 *
 * The last two are asserted TOTALLY, over every decision of a whole game,
 * rather than at a spot the test picked — and with a count of how many of
 * each case the walk actually met, because a rule tested only where it
 * says "no" is a rule tested against the fixture and not against the code
 * (CLAUDE.md, "when every case in a test is a negative").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import type { DecisionPoint } from "../../src/engine/index.ts";
import { turnSeatOf } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  MAX_PASS_TIMEOUT_MS,
  PASS_TIMEOUTS,
} from "../../src/ui/settings.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};

const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };

/**
 * A deterministic walker that reaches the interesting windows.
 *
 * IT BLEEDS AND IT BLOCKS, in that order of preference, and only then
 * passes. Both are deliberate. A walker that only passes never opens
 * anybody's reaction window, so there would be no off-turn decision to
 * put a clock on; a walker that never BLOCKS never reaches combat, and
 * combat is where the only off-turn decisions with no pass live — the
 * strike, which is the case the safety rule is about. `options[0]` would
 * play the board (CLAUDE.md), so the fallbacks are named explicitly.
 */
function nextMove(dp: DecisionPoint): string {
  const choice =
    dp.options.find((o) => o.id.startsWith("block:")) ??
    dp.options.find((o) => o.id.startsWith("bleed:")) ??
    dp.options.find((o) => o.kind === "pass") ??
    dp.options.find((o) => o.kind === "endMinionPhase") ??
    dp.options[0]!;
  return choice.id;
}

/** Is this decision one the clock is supposed to run on? The RULE, spelled
 *  out here independently of the transport's own copy of it. */
function shouldBeClocked(t: LocalTransport, dp: DecisionPoint): boolean {
  return dp.seat !== turnSeatOf(t.view()) && dp.options.some((o) => o.kind === "pass");
}

/** Walk to the first decision the clock should run on, and assert we got
 *  there — a fixture a test needs, the test BUILDS. */
async function playToOffTurn(t: LocalTransport): Promise<DecisionPoint> {
  for (let i = 0; i < 4000; i++) {
    const dp = t.decision();
    if (!dp) break;
    if (shouldBeClocked(t, dp)) return dp;
    await t.choose(nextMove(dp));
  }
  throw new Error("never reached an off-turn decision with a pass in it");
}

/** Walk to the first decision on the deciding seat's OWN turn that still
 *  offers a pass — the case the clock must leave alone. */
async function playToOwnTurnPass(t: LocalTransport): Promise<DecisionPoint> {
  for (let i = 0; i < 4000; i++) {
    const dp = t.decision();
    if (!dp) break;
    if (dp.seat === turnSeatOf(t.view()) && dp.options.some((o) => o.kind === "pass")) return dp;
    await t.choose(nextMove(dp));
  }
  throw new Error("never reached an own-turn decision with a pass in it");
}

describe("the pass clock is off unless a host turns it on", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs no clock by default, however long anybody sits there", async () => {
    const t = new LocalTransport({ setup });
    expect(t.passTimeout).toBe(0);
    await playToOffTurn(t);
    expect(t.passClockMs()).toBeNull();

    // An hour of nothing happening, on a decision the clock WOULD apply to
    // if it were on. The fuzz, the batch harness and every card test drive
    // this transport, so this is also the assertion that none of them ever
    // waits on a wall clock.
    const before = t.view().commandLog.length;
    const seq = t.decision()!.seq;
    vi.advanceTimersByTime(3_600_000);
    expect(t.view().commandLog).toHaveLength(before);
    expect(t.decision()!.seq).toBe(seq);
  });
});

describe("the pass clock, once a host turns it on", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes for a player who sits on somebody else's turn", async () => {
    const t = new LocalTransport({ setup });
    const dp = await playToOffTurn(t);
    t.setPassTimeout(15_000);

    // Armed against the decision that was already on the table: turning it
    // on mid-stall starts counting now rather than at the next decision.
    expect(t.passClockMs()).toBe(15_000);

    // NOT A MOMENT EARLY. A clock that fired at 14.9s would take a click a
    // player had every right to make.
    vi.advanceTimersByTime(14_999);
    expect(t.decision()!.seq).toBe(dp.seq);
    expect(t.passClockMs()).toBe(1);

    vi.advanceTimersByTime(1);
    expect(t.decision()!.seq).not.toBe(dp.seq);
    // …and it passed rather than doing something clever with the options.
    const log = t.view().commandLog;
    expect(log[log.length - 1]!.option).toBe("pass");
    // THE CLOCK IS PER DECISION, so the next one gets its own, whole. It
    // is emphatically not the remainder of the one that just fired: an
    // impulse cycle asks every seat in turn, and a clock that carried its
    // leftover forward would pass for the second seat almost at once.
    expect(t.passClockMs()).toBe(15_000);
  });

  it("says in the log that the table answered, not the player", async () => {
    const t = new LocalTransport({ setup });
    const dp = await playToOffTurn(t);
    t.setPassTimeout(5000);
    vi.advanceTimersByTime(5000);

    // A pass that arrives out of nowhere is indistinguishable from the
    // table having broken. It goes in the log every player is reading, and
    // it is STAMPED where it happened so the panel can interleave it.
    const notice = t.notices().at(-1);
    expect(notice?.text).toContain(dp.seat);
    expect(notice?.text).toMatch(/ran out of time/i);
    expect(notice?.afterEvent).toBeLessThanOrEqual(t.view().eventLog.length);
  });

  it("does not restart the count when something else repaints the table", async () => {
    const t = new LocalTransport({ setup });
    const dp = await playToOffTurn(t);
    t.setPassTimeout(10_000);
    vi.advanceTimersByTime(8000);
    expect(t.passClockMs()).toBe(2000);

    // THE BUG THIS PINS: every one of these emits and two of them step the
    // automatic loop, which is what re-arms the clock. If arming were not
    // idempotent on the decision, a stalling player would be handed a
    // fresh ten seconds every time anybody's screen changed — and the
    // clock would never fire at a busy table.
    t.setOmniscient(true);
    t.setAutoPass("nobody-in-particular", true);
    t.setLocalSeat(dp.seat);
    t.note("something happened elsewhere");
    expect(t.passClockMs()).toBe(2000);

    vi.advanceTimersByTime(2000);
    expect(t.decision()!.seq).not.toBe(dp.seq);
  });

  it("gives a player the new interval in full when the host changes it", async () => {
    const t = new LocalTransport({ setup });
    const dp = await playToOffTurn(t);
    t.setPassTimeout(10_000);
    vi.advanceTimersByTime(9000);

    // A change of interval never takes time AWAY from somebody who is
    // already being waited on: the clock in flight was measured against
    // the old interval, so it is dropped and the new one starts whole.
    t.setPassTimeout(20_000);
    expect(t.passClockMs()).toBe(20_000);
    vi.advanceTimersByTime(19_999);
    expect(t.decision()!.seq).toBe(dp.seq);
    vi.advanceTimersByTime(1);
    expect(t.decision()!.seq).not.toBe(dp.seq);
  });

  it("releases the seat when the host turns it off", async () => {
    const t = new LocalTransport({ setup });
    const dp = await playToOffTurn(t);
    t.setPassTimeout(10_000);
    vi.advanceTimersByTime(9000);

    t.setPassTimeout(0);
    expect(t.passClockMs()).toBeNull();
    // The old interval must not run out under them afterwards.
    vi.advanceTimersByTime(3_600_000);
    expect(t.decision()!.seq).toBe(dp.seq);
  });

  it("never runs on a seat's own turn, however long they take", async () => {
    const t = new LocalTransport({ setup, passTimeoutMs: 5000 });
    const dp = await playToOwnTurnPass(t);
    expect(dp.seat).toBe(turnSeatOf(t.view()));
    expect(t.passClockMs()).toBeNull();

    vi.advanceTimersByTime(3_600_000);
    expect(t.decision()!.seq).toBe(dp.seq);
  });

  it("gives a timed-out player the whole clock back when the host undoes it", async () => {
    const t = new LocalTransport({ setup });
    const dp = await playToOffTurn(t);
    t.setPassTimeout(10_000);
    vi.advanceTimersByTime(10_000);
    expect(t.decision()!.seq).not.toBe(dp.seq);

    // Rewind the pass the clock made. The player is back on the decision
    // it took from them, and they get the interval IN FULL — the clock is
    // keyed on the decision, and an undo lands on a fresh engine, so
    // nothing of the old count survives.
    await t.history.undo(1);
    expect(t.decision()!.seq).toBe(dp.seq);
    expect(t.passClockMs()).toBe(10_000);

    // AND THE OLD TIMER IS GONE. A timer from the rewound game firing
    // here would step a game that no longer exists — the hazard
    // `cancelPump` answers for the pacing timer.
    vi.advanceTimersByTime(9999);
    expect(t.decision()!.seq).toBe(dp.seq);
  });
});

describe("the pass clock's two safety rules, over a whole game", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * ARMED EXACTLY WHEN THE RULE SAYS, at every decision of a full game.
   *
   * The timers are never advanced, so nothing ever fires: this is about
   * WHEN a clock exists, which is the half of the feature that decides
   * whether it can reach a decision it has no right to answer.
   */
  it("arms on off-turn pass-able decisions and on nothing else", async () => {
    const t = new LocalTransport({ setup, passTimeoutMs: 30_000 });
    let clocked = 0;
    let ownTurn = 0;
    let offTurnMandatory = 0;

    for (let i = 0; i < 4000; i++) {
      const dp = t.decision();
      if (!dp) break;
      const should = shouldBeClocked(t, dp);
      // THE BICONDITIONAL, not one direction of it. A clock that never
      // armed would pass "it never reached a mandatory decision" while
      // being entirely broken.
      expect(t.passClockMs() === null).toBe(!should);
      if (should) clocked += 1;
      else if (dp.seat === turnSeatOf(t.view())) ownTurn += 1;
      else offTurnMandatory += 1;
      await t.choose(nextMove(dp));
    }

    // WHAT THE WALK ACTUALLY MET. Without these the assertion above is a
    // statement about the fixture: three cases, and all three have to
    // occur or the test has not tested the rule.
    expect(clocked).toBeGreaterThan(0);
    expect(ownTurn).toBeGreaterThan(0);
    // The off-turn decision with NO pass — a blocker choosing its strike.
    // This is the case that must never be timed out, because there is no
    // pass in the option list to take and the clock would have to invent
    // an answer.
    expect(offTurnMandatory).toBeGreaterThan(0);
  });

  it("never runs on a bot, whose seat is not stalling", async () => {
    // Every seat a bot, so the transport plays the whole game itself.
    const seats = new LocalTransport({ setup }).view().seats.map((s) => s.id);
    const agents = Object.fromEntries(
      seats.map((s, i) => [s, new HeuristicAgent({ seed: 11 + i })]),
    );
    const t = new LocalTransport({ setup, agents, passTimeoutMs: 30_000 });

    // The constructor plays it out; nothing was ever clocked on the way.
    expect(t.passClockMs()).toBeNull();
    expect(t.decision()).toBeNull();
    expect(t.view().commandLog.length).toBeGreaterThan(50);
  });

  it("follows the decision, not the seat it was armed on", async () => {
    const t = new LocalTransport({ setup, passTimeoutMs: 30_000 });
    const dp = await playToOffTurn(t);
    expect(t.passClockMs()).toBe(30_000);

    // A bot takes that seat over mid-decision — a kick, or the host
    // handing it away. It answers at once, so there is nobody left to wait
    // for; what must not happen is the clock armed for the PERSON going on
    // to fire against whatever the bot left on the table.
    t.setAgent(dp.seat, new HeuristicAgent({ seed: 5 }));
    const now = t.decision();
    expect(now).not.toBeNull();
    expect(now!.seq).not.toBe(dp.seq);
    expect(t.passClockMs() === null).toBe(!shouldBeClocked(t, now!));
  });
});

/**
 * The stored preference. A settings blob is UNTRUSTED INPUT — a hand
 * edit, or a build that knew a longer interval than this one — and this
 * value decides when a decision is answered for somebody, so it is
 * clamped to what the panel could actually have offered.
 */
describe("the pass clock setting", () => {
  it("is off by default, and its cap is the longest the panel offers", () => {
    expect(DEFAULT_SETTINGS.passTimeoutMs).toBe(0);
    // Pinned to the LIST rather than to 60000, so adding a step moves the
    // cap with it and neither can drift from the other.
    expect(MAX_PASS_TIMEOUT_MS).toBe(PASS_TIMEOUTS[PASS_TIMEOUTS.length - 1]!.ms);
    expect(PASS_TIMEOUTS[0]!.ms).toBe(0);
  });

  it("clamps a stored value to that cap, and a nonsensical one to off", () => {
    const stored = { passTimeoutMs: 0 as unknown };
    const original = Reflect.get(globalThis, "localStorage");
    Reflect.set(globalThis, "localStorage", {
      getItem: () => JSON.stringify(stored),
      setItem: () => {},
      removeItem: () => {},
    });
    try {
      stored.passTimeoutMs = 60 * 60 * 1000;
      expect(loadSettings().passTimeoutMs).toBe(MAX_PASS_TIMEOUT_MS);
      stored.passTimeoutMs = -5000;
      expect(loadSettings().passTimeoutMs).toBe(0);
      stored.passTimeoutMs = "a minute";
      expect(loadSettings().passTimeoutMs).toBe(DEFAULT_SETTINGS.passTimeoutMs);
      // The control: a value the panel DOES offer survives untouched,
      // without which the three above would pass on a loader that
      // returned 0 for everything.
      stored.passTimeoutMs = 25_000;
      expect(loadSettings().passTimeoutMs).toBe(25_000);
    } finally {
      Reflect.set(globalThis, "localStorage", original);
    }
  });
});

describe("a timed pass is an ordinary command", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("replays into the identical game, so the clock changes no outcome", async () => {
    const t = new LocalTransport({ setup, passTimeoutMs: 5000 });
    await playToOffTurn(t);
    vi.advanceTimersByTime(5000);
    const save = t.history.snapshot();

    // THE POINT OF THE WHOLE DESIGN: the clock is outside the engine and
    // answers through the same `choose` a click does, so the command log
    // is the only trace of it and a replay reproduces the game exactly —
    // on a client with the clock switched OFF, which is what a saved game
    // opened tomorrow will be.
    const replayed = new LocalTransport({ setup, commands: save.commands });
    expect(replayed.passTimeout).toBe(0);
    expect(JSON.stringify(replayed.view())).toBe(JSON.stringify(t.view()));
  });
});
