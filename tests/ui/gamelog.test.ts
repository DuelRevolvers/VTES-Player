/**
 * Per-playthrough log files (docs/game-log-design.md).
 *
 * The file exists to be read AFTER the fact, by someone who was not there
 * — so what these pin is that nothing is missing from it: not an AI's
 * move, not an auto-pass, not an error, and not the setup that makes the
 * whole thing replayable.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { PassAgent } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { GameLog, logFileName, MemorySink } from "../../src/ui/gamelog.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };

type Opts = ConstructorParameters<typeof LocalTransport>[0];

function logged(opts: Opts = { setup }): { t: LocalTransport; sink: MemorySink } {
  const sink = new MemorySink("test.log");
  const t = new LocalTransport({ ...opts, log: new GameLog(sink, setup) });
  return { t, sink };
}

function pick(seed: { n: number }, count: number): number {
  seed.n = (seed.n * 1103515245 + 12345) & 0x7fffffff;
  return seed.n % count;
}

describe("the playthrough log", () => {
  it("opens with the setup, which is what makes it a replay", () => {
    const { sink } = logged();
    expect(sink.text).toContain("VTES playthrough log");
    expect(sink.text).toContain(`seed      ${config.seed}`);
    for (const d of config.decks) expect(sink.text).toContain(d.seat);
    // The setup line round-trips: a reader can rebuild the game from it.
    const line = sink.text.split("\n").find((l) => l.startsWith("SETUP "))!;
    expect(JSON.parse(line.slice("SETUP ".length))).toEqual(setup);
  });

  it("records every decision with the option id that caused it", async () => {
    const { t, sink } = logged();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const dp = t.decision();
      if (!dp) break;
      const id = dp.options[0]!.id;
      ids.push(id);
      await t.choose(id);
    }
    // Every id, in order — replaying them reproduces this game exactly.
    // Read the lines out of the file rather than searching for each id:
    // the same id (`pass`) recurs, so a search would find the first one
    // every time and the order check would hold vacuously.
    const written = sink.text
      .split("\n")
      .filter((l) => l.trimStart().startsWith("> "))
      .map((l) => l.trim().slice(2));
    expect(written).toEqual(ids);
  });

  it("narrates what happened, not just what was clicked", async () => {
    const { t, sink } = logged();
    for (let i = 0; i < 60; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[(i * 5 + 1) % dp.options.length]!.id);
    }
    // The English lines the game log panel shows are in the file too.
    expect(sink.text).toMatch(/^ +\. \S/m);
  });

  it("catches the moves no human is ever shown — AI seats and auto-passes", async () => {
    // This is why the logger lives in the transport. A logger in the UI
    // would only ever see Alice, and the file would have holes in it
    // exactly where the hard bugs are.
    const seats = config.decks.map((d) => d.seat);
    const { t, sink } = logged({
      setup,
      agents: { Bob: new PassAgent(), Carol: new PassAgent() },
      autoPass: Object.fromEntries(seats.map((s) => [s, true])),
    });
    for (let i = 0; i < 40; i++) {
      const dp = t.decision();
      if (!dp) break;
      expect(dp.seat).toBe("Alice");
      await t.choose(dp.options[0]!.id);
    }
    // Alice is the only seat the UI was ever asked about, yet the other
    // two are all over the file.
    expect(sink.text).toContain("Bob");
    expect(sink.text).toContain("Carol");
    expect(t.view().commandLog.length).toBeGreaterThan(40);
  });

  it("writes down a rejected option, which is the point of the file", async () => {
    const { t, sink } = logged();
    await expect(t.choose("not-a-real-option")).rejects.toThrow();
    expect(sink.text).toContain("!! ERROR");
    expect(sink.text).toContain("not-a-real-option");
  });

  it("says when the game was rewound rather than silently stopping", async () => {
    // Undo replays a SHORTER log into a fresh engine, so both logs shrink.
    // Without noticing that, the counters would sit ahead of the game for
    // ever and the file would end mid-sentence.
    const { t, sink } = logged();
    for (let i = 0; i < 20; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[0]!.id);
    }
    await t.history!.undo(1);
    expect(sink.text).toContain("rewound to decision");

    const before = sink.text.length;
    const dp = t.decision()!;
    await t.choose(dp.options[0]!.id);
    // ...and it keeps recording afterwards.
    expect(sink.text.length).toBeGreaterThan(before);
  });

  it("closes with the result, once, however many repaints follow", async () => {
    const { t, sink } = logged();
    const rng = { n: 5 };
    for (let i = 0; i < 20000; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[pick(rng, dp.options.length)]!.id);
    }
    expect(t.decision()).toBeNull();
    expect(sink.text).toContain("GAME OVER");
    expect(sink.text.match(/GAME OVER/g)).toHaveLength(1);

    // A stray change after the game is over must not reopen the file.
    const closed = sink.text;
    t.setOmniscient(true);
    expect(sink.text).toBe(closed);
  });

  it("never lets a broken sink take the game down", async () => {
    const t = new LocalTransport({
      setup,
      log: new GameLog(
        {
          name: "broken.log",
          append() {
            throw new Error("disk on fire");
          },
        },
        setup,
      ),
    });
    // The game plays on regardless: a log is a convenience, not a rule.
    for (let i = 0; i < 10; i++) {
      const dp = t.decision();
      if (!dp) break;
      await t.choose(dp.options[0]!.id);
    }
    expect(t.view().commandLog.length).toBe(10);
  });

  it("names files so they sort by time and cannot collide", () => {
    const name = logFileName(new Date("2026-09-04T14:31:02Z"));
    expect(name).toMatch(/^2026-09-04-14-31-02-vtes-[a-z0-9]{4}\.log$/);
    // The dev server only accepts this shape (vite.config.ts).
    expect(name).toMatch(/^[\w.-]+\.log$/);
  });
});
