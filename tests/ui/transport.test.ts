/**
 * The transport seam (docs/cockatrice-lessons.md §2).
 *
 * The UI talks to a GameTransport, never to the engine. These tests pin the
 * contract a phase-6 peer transport will have to satisfy too: async submit,
 * change notification, and history as a separate privilege.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { PassAgent } from "../../src/engine/index.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};

const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };

function pick(seed: { n: number }, count: number): number {
  seed.n = (seed.n * 1103515245 + 12345) & 0x7fffffff;
  return seed.n % count;
}

describe("LocalTransport", () => {
  it("plays a whole game through choose(), never exposing an empty decision", async () => {
    const t = new LocalTransport({ setup });
    const rng = { n: 5 };
    let steps = 0;
    for (;;) {
      const dp = t.decision();
      if (!dp) break;
      expect(dp.options.length).toBeGreaterThan(0);
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
      if (++steps > 20000) throw new Error("game did not terminate");
    }
    expect(steps).toBeGreaterThan(50);
  });

  it("rejects an illegal option id rather than mutating", async () => {
    const t = new LocalTransport({ setup });
    const before = JSON.stringify(t.view());
    await expect(t.choose("not-a-real-option")).rejects.toThrow(/illegal option/i);
    expect(JSON.stringify(t.view())).toBe(before);
  });

  it("notifies subscribers on change, and unsubscribes cleanly", async () => {
    const t = new LocalTransport({ setup });
    let count = 0;
    const off = t.onChanged(() => (count += 1));

    await t.choose(t.decision()!.options[0]!.id);
    expect(count).toBe(1);
    await t.choose(t.decision()!.options[0]!.id);
    expect(count).toBe(2);

    off();
    await t.choose(t.decision()!.options[0]!.id);
    expect(count).toBe(2); // no further calls after unsubscribe
  });

  it("steps agent-driven seats itself, so the UI is only asked about humans", async () => {
    // Bob and Carol are agents; only Alice should ever reach the UI. In
    // phase 6 this is the host running the agents, with peers seeing results.
    const t = new LocalTransport({
      setup,
      agents: { Bob: new PassAgent(), Carol: new PassAgent() },
    });
    for (let i = 0; i < 60; i++) {
      const dp = t.decision();
      if (!dp) break;
      expect(dp.seat).toBe("Alice");
      await t.choose(dp.options[0]!.id);
    }
  });

  it("exposes history locally, and undo steps back one decision", async () => {
    const t = new LocalTransport({ setup });
    expect(t.history).not.toBeNull();
    expect(t.history!.canUndo()).toBe(false); // nothing played yet

    const rng = { n: 3 };
    for (let i = 0; i < 30; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    const before = t.view().commandLog.length;
    expect(t.history!.canUndo()).toBe(true);

    await t.history!.undo(1);
    expect(t.view().commandLog).toHaveLength(before - 1);
    expect(t.decision()!.options.length).toBeGreaterThan(0);
  });

  it("round-trips a game through snapshot() and load()", async () => {
    const t = new LocalTransport({ setup });
    const rng = { n: 11 };
    for (let i = 0; i < 40; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    const save = t.history!.snapshot();
    const expected = JSON.stringify(t.view());

    // A brand new transport, resumed from the save, is byte-identical.
    const resumed = new LocalTransport({ setup: save.setup, commands: save.commands });
    expect(JSON.stringify(resumed.view())).toBe(expected);

    // And loading into a running transport gets to the same place.
    await t.history!.restart();
    expect(t.view().commandLog).toHaveLength(0);
    await t.history!.load(save);
    expect(JSON.stringify(t.view())).toBe(expected);
  });
});

describe("LocalTransport auto-pass", () => {
  /** Play until some seat's only legal option is Pass. */
  function playToLonePass(t: LocalTransport, rng = { n: 7 }): string | null {
    for (let i = 0; i < 4000; i++) {
      const dp = t.decision();
      if (!dp) return null;
      if (dp.options.length === 1 && dp.options[0]!.kind === "pass") return dp.seat;
      void t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    return null;
  }

  it("is off by default — a lone Pass is still put to the player", () => {
    const t = new LocalTransport({ setup });
    const seat = playToLonePass(t);
    expect(seat).not.toBeNull();
    // The engine offered it and the transport did not answer it.
    expect(t.decision()!.options).toHaveLength(1);
    expect(t.decision()!.options[0]!.kind).toBe("pass");
    expect(t.autoPassSeats[seat!] ?? false).toBe(false);
  });

  it("answers a lone Pass for a seat that opted in", () => {
    const t = new LocalTransport({ setup });
    const seat = playToLonePass(t)!;
    const before = t.view().commandLog.length;

    t.setAutoPass(seat, true);

    // It stepped past that decision by itself, and whatever it stopped on
    // is either a real choice or another seat.
    expect(t.view().commandLog.length).toBeGreaterThan(before);
    const dp = t.decision();
    if (dp && dp.seat === seat) {
      expect(dp.options.length).toBeGreaterThan(1);
    }
  });

  it("never answers a decision that has a real choice in it", async () => {
    const seats = config.decks.map((d) => d.seat);
    const t = new LocalTransport({
      setup,
      autoPass: Object.fromEntries(seats.map((s) => [s, true])),
    });
    const rng = { n: 13 };
    for (let i = 0; i < 400; i++) {
      const dp = t.decision();
      if (!dp) break;
      // With every seat auto-passing, the UI must never be shown a lone Pass.
      expect(dp.options.length === 1 && dp.options[0]!.kind === "pass").toBe(false);
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
  });

  it("keeps the auto-passes in the command log, so a replay is identical", async () => {
    const seats = config.decks.map((d) => d.seat);
    const autoPass = Object.fromEntries(seats.map((s) => [s, true]));
    const t = new LocalTransport({ setup, autoPass });
    const rng = { n: 21 };
    for (let i = 0; i < 120; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    const save = t.history!.snapshot();
    // The log is the whole record: replaying it WITHOUT auto-pass on must
    // reproduce the same game, because the passes are in the log as
    // ordinary decisions. Auto-pass is a convenience, not a rule.
    const resumed = new LocalTransport({ setup: save.setup, commands: save.commands });
    expect(JSON.stringify(resumed.view())).toBe(JSON.stringify(t.view()));
  });

  it("undoes past its own auto-passes, so Undo always moves", async () => {
    const seats = config.decks.map((d) => d.seat);
    const t = new LocalTransport({
      setup,
      autoPass: Object.fromEntries(seats.map((s) => [s, true])),
    });
    const rng = { n: 33 };
    for (let i = 0; i < 80; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    const before = t.view().commandLog.length;
    await t.history!.undo(1);
    const after = t.view().commandLog.length;
    // Strictly shorter: rewinding onto an auto-passed decision would be
    // re-answered instantly and the button would look broken.
    expect(after).toBeLessThan(before);
    const dp = t.decision();
    if (dp) expect(dp.options.length).toBeGreaterThan(1);
  });
});

describe("LocalTransport hidden information", () => {
  it("masks the view to the deciding seat by default", async () => {
    const t = new LocalTransport({ setup });
    const seat = t.decision()!.seat;
    const view = t.view();

    const mine = view.seats.find((s) => s.id === seat)!;
    const theirs = view.seats.filter((s) => s.id !== seat);

    // Your own hand and uncontrolled region are readable...
    expect(mine.hand.every((c) => c.name !== "")).toBe(true);
    expect(mine.uncontrolled.every((u) => u.card.name !== "")).toBe(true);

    // ...and nobody else's are, in either zone.
    for (const s of theirs) {
      expect(s.hand.every((c) => c.name === "")).toBe(true);
      expect(s.uncontrolled.every((u) => u.card.name === "")).toBe(true);
      // The counters stacked on a face-down card stay visible (p. 14).
      expect(s.uncontrolled.every((u) => typeof u.counters === "number")).toBe(true);
    }
  });

  it("keeps every draw pile face down, including the viewer's own", () => {
    const view = new LocalTransport({ setup }).view();
    for (const s of view.seats) {
      expect(s.library.every((c) => c.name === "")).toBe(true);
      expect(s.crypt.every((m) => m.name === "")).toBe(true);
      // Counts survive — the pile's height is public.
      expect(s.library.length).toBeGreaterThan(0);
    }
  });

  it("never leaks another seat's card names anywhere in the view", () => {
    const t = new LocalTransport({ setup });
    const seat = t.decision()!.seat;
    const raw = t.view();
    // Collect the real hidden names from the unredacted setup, then assert
    // none of them appear anywhere in the serialised masked view.
    const hidden = new Set<string>();
    for (const deck of setup.decks) {
      if (deck.seat === seat) continue;
      for (const name of deck.library) hidden.add(name);
    }
    const json = JSON.stringify(raw);
    const leaked = [...hidden].filter((n) => json.includes(n));
    // Cards in play and minions are public, so a name can legitimately
    // appear; nothing in these decks is in play at turn 1.
    expect(leaked).toEqual([]);
  });

  it("reveals everything again in omniscient mode", () => {
    const t = new LocalTransport({ setup, omniscient: true });
    const seat = t.decision()!.seat;
    for (const s of t.view().seats) {
      if (s.id === seat) continue;
      expect(s.hand.some((c) => c.name !== "")).toBe(true);
      expect(s.uncontrolled.some((u) => u.card.name !== "")).toBe(true);
    }
  });
});

/**
 * AI pacing (docs/debug-ui-design.md §10).
 *
 * An agent answers in microseconds, so a whole turn of AI play lands
 * between two repaints and a human at the table sees only the aftermath.
 * The transport holds the table for a beat after each VISIBLE agent move.
 *
 * What these pin, in order of importance: it changes no decision and no
 * game; it paces what you can see and not the passes; and while it waits,
 * the AI's decision is nobody else's to answer or to read.
 */
describe("LocalTransport AI pacing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const agents = (): Record<string, HeuristicAgent> => ({
    Bob: new HeuristicAgent({ seed: 11 }),
    Carol: new HeuristicAgent({ seed: 22 }),
  });

  /** Run out any pause in progress. */
  function settle(t: LocalTransport): void {
    for (let i = 0; i < 5000 && t.isThinking; i++) {
      vi.advanceTimersByTime(Math.max(1, t.aiDelay));
    }
    expect(t.isThinking).toBe(false);
  }

  /** Answer `steps` human decisions, waiting out each AI pause first. */
  async function drive(t: LocalTransport, rng: { n: number }, steps: number): Promise<void> {
    for (let i = 0; i < steps; i++) {
      settle(t);
      const dp = t.decision();
      if (!dp) return;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
  }

  /** Play on until an AI move is actually being held back. */
  async function playToPause(t: LocalTransport, rng: { n: number }): Promise<void> {
    for (let i = 0; i < 400 && !t.isThinking; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    expect(t.isThinking).toBe(true);
  }

  it("is off by default, so nothing but the UI ever waits", async () => {
    const t = new LocalTransport({ setup, agents: agents() });
    expect(t.aiDelay).toBe(0);
    expect(t.isThinking).toBe(false);
    // The batch harness and every other test drive this transport; a pacing
    // default would make all of them wait on wall-clock time.
    for (let i = 0; i < 20; i++) {
      const dp = t.decision();
      if (!dp) break;
      expect(t.isThinking).toBe(false);
      await t.choose(dp.options[0]!.id);
    }
  });

  it("holds the table after a visible AI move, then carries on by itself", async () => {
    const t = new LocalTransport({ setup, agents: agents(), aiDelayMs: 900 });
    await playToPause(t, { n: 5 });

    // The decision on the table belongs to an agent seat, and nothing has
    // answered it: the pause is real, not a repaint.
    expect(t.agentSeats[t.decision()!.seat]).toBe(true);
    const before = t.view().commandLog.length;
    vi.advanceTimersByTime(899);
    expect(t.view().commandLog).toHaveLength(before);

    // And it resumes on its own, without anyone touching the transport.
    vi.advanceTimersByTime(1);
    expect(t.view().commandLog.length).toBeGreaterThan(before);
  });

  it("notifies the UI when a pause ends, or the table would never repaint", async () => {
    const t = new LocalTransport({ setup, agents: agents(), aiDelayMs: 900 });
    await playToPause(t, { n: 9 });

    let painted = 0;
    t.onChanged(() => (painted += 1));
    vi.advanceTimersByTime(900);
    expect(painted).toBe(1);
  });

  it("does NOT pace a pass — an impulse cycle is mostly passes", async () => {
    // Pausing on passes would spend the whole delay budget on nothing
    // happening, and a player would learn to ignore the pause rather than
    // read it. So: a pause never follows a pass.
    //
    // Note PassAgent is not purely passive — a seat that MUST act (its own
    // turn) is offered no pass and it takes the first option instead. That
    // is exactly why this asks the agent what it answered rather than
    // assuming.
    // One shared log across both seats, so "what did the AI just do" is a
    // single answer rather than two to reconcile.
    const answered: string[] = [];
    class Recorder extends PassAgent {
      override decide(
        dp: Parameters<PassAgent["decide"]>[0],
        options: Parameters<PassAgent["decide"]>[1],
        view: Parameters<PassAgent["decide"]>[2],
      ): string {
        const id = super.decide(dp, options, view);
        answered.push(options.find((o) => o.id === id)!.kind);
        return id;
      }
    }
    const t = new LocalTransport({
      setup,
      agents: { Bob: new Recorder(), Carol: new Recorder() },
      aiDelayMs: 1000,
    });

    let pauses = 0;
    const rng = { n: 63 };
    for (let i = 0; i < 400; i++) {
      if (t.isThinking) {
        pauses += 1;
        // Whatever the agent just did to earn this pause, it was not a pass.
        expect(answered[answered.length - 1]).not.toBe("pass");
        settle(t);
        continue;
      }
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }

    // ...and the agents really did pass a great many times, or the check
    // above proves nothing. An assertion that is empty for the wrong reason
    // looks exactly like one that holds.
    expect(answered.filter((k) => k === "pass").length).toBeGreaterThan(20);
    expect(pauses).toBeGreaterThan(0);
  });

  it("never waits before handing control back to a human", async () => {
    // The pause exists so a move can be READ before the next one lands. A
    // human sets their own pace, so there is nothing to hold them for.
    const t = new LocalTransport({ setup, agents: agents(), aiDelayMs: 900 });
    const rng = { n: 17 };
    for (let i = 0; i < 300; i++) {
      settle(t);
      const dp = t.decision();
      if (!dp) break;
      // Whenever the transport has stopped with no pause pending, the
      // decision it stopped on is a human's.
      expect(t.agentSeats[dp.seat] ?? false).toBe(false);
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
  });

  it("plays the IDENTICAL game paced and unpaced", async () => {
    // The whole claim: pacing is a client preference like auto-pass. It
    // reaches no command log, so the same seeds and the same human answers
    // produce the same game byte for byte, at any speed.
    const fast = new LocalTransport({ setup, agents: agents() });
    const slow = new LocalTransport({ setup, agents: agents(), aiDelayMs: 1800 });

    await drive(fast, { n: 41 }, 120);
    await drive(slow, { n: 41 }, 120);
    settle(slow);

    expect(slow.view().commandLog).toEqual(fast.view().commandLog);
    expect(JSON.stringify(slow.view())).toBe(JSON.stringify(fast.view()));
  });

  it("keeps the paused AI's hand hidden — the pause is not a peek", async () => {
    // view() masks to the seat being asked. While an AI's move is on the
    // timer that seat IS the AI, so masking to it would put its hand on a
    // shared screen for the length of every pause.
    const t = new LocalTransport({ setup, agents: agents(), aiDelayMs: 900 });
    const rng = { n: 3 };
    let human: string | null = null;
    for (let i = 0; i < 400 && !t.isThinking; i++) {
      const dp = t.decision();
      if (!dp) break;
      human = dp.seat;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    expect(t.isThinking).toBe(true);
    expect(human).toBe("Alice");

    const view = t.view();
    const ai = view.seats.find((s) => s.id === t.decision()!.seat)!;
    expect(ai.hand.length).toBeGreaterThan(0);
    expect(ai.hand.every((c) => c.name === "")).toBe(true);
    // ...and the human who was last asked still sees their own.
    const mine = view.seats.find((s) => s.id === human)!;
    expect(mine.hand.every((c) => c.name !== "")).toBe(true);
  });

  it("releases a pause in progress when the pace is set to instant", async () => {
    const t = new LocalTransport({ setup, agents: agents(), aiDelayMs: 3000 });
    await playToPause(t, { n: 27 });

    // Impatience must not mean sitting out the interval you just cancelled.
    t.setAiDelay(0);
    expect(t.isThinking).toBe(false);
    const dp = t.decision();
    if (dp) expect(t.agentSeats[dp.seat] ?? false).toBe(false);
  });

  it("cancels a pending pause on undo, so no stale timer steps the rewind", async () => {
    const t = new LocalTransport({ setup, agents: agents(), aiDelayMs: 900 });
    const rng = { n: 55 };
    await drive(t, rng, 40);
    await playToPause(t, rng);

    await t.history!.undo(1);
    const after = t.view().commandLog.length;
    // Undo rewinds past decisions the transport answers itself, so it lands
    // on a human — and the timer from the cancelled pause must not fire and
    // step the game it was just rewound out of.
    expect(t.isThinking).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(t.view().commandLog).toHaveLength(after);
  });
});
