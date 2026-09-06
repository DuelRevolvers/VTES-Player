/**
 * Auto-pass at a table with ONE human and three bots — the shape every
 * game the shell deals actually has.
 *
 * Reported from a playtest as "auto-pass should work even if the player is
 * not a bot". These pin that it does, seat by seat, because the transport
 * checks the agent first and it would be easy for a future change to make
 * auto-pass a property of an agent-driven seat by accident.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { seatSeed } from "../../src/ui/settings.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };
const seats = config.decks.map((d) => d.seat);
const HUMAN = seats[0]!;

/** One human, everyone else a bot — what Menu → Host → Start deals. */
function soloTable(autoPassHuman: boolean): LocalTransport {
  const t = new LocalTransport({ setup });
  t.setLocalSeat(HUMAN);
  for (const s of seats.slice(1)) {
    t.setAgent(s, new HeuristicAgent({ seed: seatSeed(s) }));
  }
  if (autoPassHuman) t.setAutoPass(HUMAN, true);
  return t;
}

describe("auto-pass for the one human at the table", () => {
  it("answers the human's lone Pass — being a person is not the condition", async () => {
    const t = soloTable(true);
    let lonePasses = 0;
    for (let i = 0; i < 400; i++) {
      const dp = t.decision();
      if (!dp) break;
      // Only the human is ever asked (the bots are stepped by the
      // authority), and they must never be shown a decision whose whole
      // content is Pass.
      expect(dp.seat).toBe(HUMAN);
      if (dp.options.length === 1 && dp.options[0]!.kind === "pass") lonePasses += 1;
      await t.choose(dp.options[0]!.id);
    }
    expect(lonePasses).toBe(0);
  });

  it("...and the same table WITHOUT it is asked those passes", async () => {
    // The control. Without it the test above could hold because the human
    // is never offered a lone Pass in this game at all, which would make
    // it pass for the wrong reason.
    const t = soloTable(false);
    let lonePasses = 0;
    for (let i = 0; i < 400; i++) {
      const dp = t.decision();
      if (!dp) break;
      if (dp.options.length === 1 && dp.options[0]!.kind === "pass") lonePasses += 1;
      await t.choose(dp.options[0]!.id);
    }
    expect(lonePasses).toBeGreaterThan(0);
  });

  it("does not touch the other seats' settings", () => {
    const t = soloTable(true);
    expect(t.autoPassSeats[HUMAN]).toBe(true);
    for (const s of seats.slice(1)) expect(t.autoPassSeats[s] ?? false).toBe(false);
  });
});

describe("the one human's view", () => {
  it("is their own hand, whoever is deciding", () => {
    // The point of naming a local seat: a player reads their own hand
    // while a bot is thinking, which is exactly when there is time to.
    const t = soloTable(false);
    t.setAiDelay(500);
    const mine = t.view().seats.find((s) => s.id === HUMAN)!;
    expect(mine.hand.length).toBeGreaterThan(0);
    expect(mine.hand.every((c) => c.name !== "")).toBe(true);
    // ...and never anybody else's.
    for (const s of t.view().seats) {
      if (s.id === HUMAN) continue;
      expect(s.hand.every((c) => c.name === "")).toBe(true);
    }
  });

  it("falls back to the deciding seat in hotseat, where there is no 'you'", () => {
    const t = new LocalTransport({ setup });
    expect(t.localSeatId).toBeNull();
    const dp = t.decision()!;
    const shown = t.view().seats.find((s) => s.id === dp.seat)!;
    expect(shown.hand.every((c) => c.name !== "")).toBe(true);
  });
});
