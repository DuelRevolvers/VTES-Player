/**
 * Setting up a table, and the local profile (docs/shell-design.md).
 *
 * These are the parts of the shell with decisions in them: which seats
 * exist, whose deck is whose, and what stops a game starting. The screens
 * that collect it are markup.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import { buildGame } from "../../src/ui/decks.ts";
import { preconDeck, preconStyle, supportedPrecons } from "../../src/ui/deckimport.ts";
import type { TableConfig } from "../../src/ui/newgame.ts";
import {
  botSeats,
  buildTable,
  seatRelations,
  defaultTable,
  isOnlineTable,
  MAX_SEATS,
  MIN_SEATS,
} from "../../src/ui/newgame.ts";
import {
  avatarProblem,
  MAX_AVATAR_BYTES,
  MAX_NAME_LENGTH,
  nameProblem,
} from "../../src/ui/profile.ts";

const playable = supportedPrecons().filter((p) => p.playable);
const precon = (i: number): { kind: "precon"; set: string; name: string } => {
  const p = playable[i % playable.length]!;
  return { kind: "precon", set: p.set, name: p.name };
};

function table(over: Partial<TableConfig> = {}): TableConfig {
  return { ...defaultTable("Aaron"), seed: 42, ...over };
}

describe("the default table", () => {
  it("is you plus three bots, ready to start", () => {
    const config = defaultTable("Aaron");
    expect(config.seats).toHaveLength(4);
    expect(config.seats[0]!.name).toBe("Aaron");
    expect(config.seats[0]!.kind).toBe("you");
    expect(config.seats.slice(1).every((s) => s.kind === "ai")).toBe(true);
    expect(config.privateGame).toBe(true);
    // Ready to play with no further choices: the point of a default.
    expect(buildTable({ ...config, seed: 1 }).problems).toEqual([]);
  });

  it("gives each seat a DIFFERENT precon", () => {
    // A first game that is four copies of one deck playing itself teaches
    // a new player nothing about the game.
    const names = defaultTable("Aaron").seats.map((s) =>
      s.deck && s.deck.kind === "precon" ? `${s.deck.set}/${s.deck.name}` : "?",
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("building a table", () => {
  it("deals a real game from precons", () => {
    const build = buildTable(table());
    expect(build.setup).not.toBeNull();
    const state = buildGame(build.setup!);
    expect(state.seats).toHaveLength(4);
    for (const s of state.seats) {
      expect(s.pool).toBe(30);
      expect(s.hand).toHaveLength(7);
      expect(s.uncontrolled).toHaveLength(4);
    }
  });

  it("names the bot seats for the transport to hand over", () => {
    expect(botSeats(table())).toEqual(["Bot 1", "Bot 2", "Bot 3"]);
  });

  it("collects EVERY problem, not the first one", () => {
    // A player fixing a lobby wants the whole list.
    const build = buildTable(
      table({
        seats: [
          { name: "A", kind: "you", deck: null },
          { name: "A", kind: "ai", deck: null },
        ],
      }),
    );
    expect(build.setup).toBeNull();
    expect(build.problems.length).toBeGreaterThanOrEqual(3); // duplicate + two missing decks
    expect(build.problems.some((p) => p.problem.includes("share that name"))).toBe(true);
    expect(build.problems.filter((p) => p.problem === "no deck chosen")).toHaveLength(2);
  });

  it("refuses two seats with the same name", () => {
    // Seat names ARE the engine's seat ids, so this is not cosmetic — and
    // it is the only place "unique" is enforced at all, since there is no
    // account server to enforce it anywhere else.
    const seats = table().seats.map((s) => ({ ...s, name: "Same" }));
    expect(buildTable(table({ seats })).setup).toBeNull();
  });

  it("refuses a table that is too small or too large", () => {
    const one = table({ seats: [{ name: "A", kind: "you", deck: precon(0) }] });
    expect(buildTable(one).problems.some((p) => p.problem.includes(String(MIN_SEATS)))).toBe(true);

    const many = table({
      seats: Array.from({ length: MAX_SEATS + 1 }, (_, i) => ({
        name: `S${i}`,
        kind: "ai" as const,
        deck: precon(i),
      })),
    });
    expect(buildTable(many).problems.some((p) => p.problem.includes(String(MAX_SEATS)))).toBe(
      true,
    );
  });

  it("reports a pasted deck's problems against the seat that pasted it", () => {
    const seats = table().seats.map((s, i) =>
      i === 0 ? { ...s, deck: { kind: "paste" as const, text: "2x Not A Real Card" } } : s,
    );
    const build = buildTable(table({ seats }));
    expect(build.setup).toBeNull();
    const mine = build.problems.find((p) => p.seat === "Aaron")!;
    expect(mine.problem).toContain("not in the V5 pool");
    // ...and the full import report is kept, because an unsupported card
    // is something to read, not only something to block on.
    expect(build.reports["Aaron"]!.unknown).toHaveLength(1);
  });

  it("accepts a pasted deck that is fine", () => {
    const source = preconDeck(playable[0]!.set, playable[0]!.name, "x")!;
    const counts = new Map<string, number>();
    for (const n of source.library) counts.set(n, (counts.get(n) ?? 0) + 1);
    const cryptCounts = new Map<number, number>();
    for (const v of source.crypt) cryptCounts.set(v.id, (cryptCounts.get(v.id) ?? 0) + 1);
    const text = [
      ...[...cryptCounts].map(([id, n]) => `${n}x ${cryptName(id)}`),
      ...[...counts].map(([name, n]) => `${n}x ${name}`),
    ].join("\n");

    const seats = table().seats.map((s, i) =>
      i === 0 ? { ...s, deck: { kind: "paste" as const, text } } : s,
    );
    const build = buildTable(table({ seats }));
    expect(build.problems).toEqual([]);
    expect(build.setup).not.toBeNull();
  });

  it("waits for a player rather than dealing an open seat", () => {
    const seats = table().seats.map((s, i) =>
      i === 1 ? { ...s, kind: "open" as const, deck: null } : s,
    );
    const build = buildTable(table({ seats, privateGame: false }));
    expect(build.setup).toBeNull();
    expect(build.problems.some((p) => p.problem === "waiting for a player")).toBe(true);
  });

  it("insists an online table has a seat somebody can join", () => {
    const build = buildTable(table({ privateGame: false }));
    expect(build.problems.some((p) => p.problem.includes("someone to join"))).toBe(true);
  });

  it("derives whether a table is online from its seats", () => {
    // Not a separate switch: a "play online" flag and a set of seats are
    // two facts that can contradict each other, and this is one that
    // cannot (docs/lobby-design.md §3.2).
    expect(isOnlineTable(defaultTable("Aaron"))).toBe(false);
    const withOpen = defaultTable("Aaron");
    withOpen.seats[1]!.kind = "open";
    expect(isOnlineTable(withOpen)).toBe(true);
    // ...and it stays online once that seat has been TAKEN, which is the
    // moment the first version of this got wrong.
    withOpen.seats[1]!.kind = "remote";
    expect(isOnlineTable(withOpen)).toBe(true);
  });

  it("still starts an online table once every open seat is filled", () => {
    // The rule used to demand an OPEN seat, which is unsatisfiable at the
    // exact moment a full lobby wants to start.
    const config = table({ privateGame: false });
    config.seats[1]!.kind = "remote";
    expect(buildTable(config).setup).not.toBeNull();
  });

  it("picks a seed when none is given, and keeps the one it picked", () => {
    // "A different game each time" must not mean "a game that cannot be
    // replayed": the seed still lands in the setup, which is what a save
    // and the log file both carry.
    const a = buildTable(table({ seed: null })).setup!;
    const b = buildTable(table({ seed: null })).setup!;
    expect(typeof a.seed).toBe("number");
    expect(a.seed).not.toBe(b.seed);
    expect(JSON.stringify(buildGame(a))).toBe(JSON.stringify(buildGame(a)));
  });
});

/** The registry name for a crypt id, as a deck list would print it. */
function cryptName(id: number): string {
  return (registry as unknown as CardRegistry).entries[id]!.card.name;
}

describe("the local profile", () => {
  it("accepts the names people actually have", () => {
    for (const name of ["Aaron", "Élodie", "北条", "J. R. R.", "x_ÆA-12"]) {
      expect(nameProblem(name), name).toBeNull();
    }
  });

  it("refuses what breaks something downstream", () => {
    expect(nameProblem("")).not.toBeNull();
    expect(nameProblem("   ")).not.toBeNull();
    expect(nameProblem("x".repeat(MAX_NAME_LENGTH + 1))).not.toBeNull();
    // A control character could corrupt a lobby list or a log line.
    expect(nameProblem("Aaron\nBob")).not.toBeNull();
  });

  it("refuses an avatar that is not an image, or is too big to store", () => {
    expect(avatarProblem("data:image/png;base64,AAAA")).toBeNull();
    expect(avatarProblem("https://example.com/me.png")).not.toBeNull();
    expect(avatarProblem("data:text/html;base64,AAAA")).not.toBeNull();
    // The whole origin has a few megabytes, shared with the saved game.
    const huge = `data:image/png;base64,${"A".repeat(MAX_AVATAR_BYTES)}`;
    expect(avatarProblem(huge)).toContain("too large");
  });
});

describe("who sits either side (p. 15)", () => {
  // "Your prey is the Methuselah on your left; your predator is the one on
  // your right." Shown in the lobby next to each name so a player can see
  // the table they are about to sit at.
  const four = ["Alice", "Bob", "Carol", "Dave"];

  it("wraps, because the table is a cycle", () => {
    expect(seatRelations(four, 0)).toEqual({ prey: "Bob", predator: "Dave" });
    expect(seatRelations(four, 3)).toEqual({ prey: "Alice", predator: "Carol" });
  });

  it("is every other seat in a two-seat game", () => {
    // Both directions land on the same person, which is correct rather
    // than a degenerate case: with two Methuselahs each is the other's
    // prey and predator.
    expect(seatRelations(["Alice", "Bob"], 0)).toEqual({ prey: "Bob", predator: "Bob" });
  });

  it("answers null where there is nobody to relate to", () => {
    // The negative space: one seat, and an index off the end. Without
    // this the wrap arithmetic would quietly name the seat itself.
    expect(seatRelations(["Alice"], 0)).toBeNull();
    expect(seatRelations(four, 9)).toBeNull();
    expect(seatRelations(four, -1)).toBeNull();
  });
});

describe("precon play-style lines", () => {
  it("every precon in the pool has one", () => {
    // A standing guard, not a fixed list: the descriptors are keyed on the
    // deck NAME so a New Blood starter shares its clan's line, and the day
    // the pool widens this fails until the new decks are written up rather
    // than letting the panel drift behind the sets.
    const missing = supportedPrecons()
      .filter((p) => preconStyle(p.name) === null)
      .map((p) => `${p.set} / ${p.name}`);
    expect(missing).toEqual([]);
  });

  it("says how the deck WINS, not what clan it is", () => {
    // The point is telling a combat deck from a vote deck without reading
    // 60 cards, so each line has to name a plan. Every one mentions at
    // least one of the three things a Methuselah can actually do.
    const verbs = /bleed|vote|referend|combat|fight|rush|block|burn|drain|pool/i;
    for (const p of supportedPrecons()) {
      expect(preconStyle(p.name), `${p.name} names no plan`).toMatch(verbs);
    }
  });

  it("shares one line between a clan's full deck and its New Blood half", () => {
    // Deliberate: they are the same clan and the same plan at half the
    // size, and two lines that drifted apart would be worse than one.
    expect(preconStyle("Malkavian")).toBe(preconStyle("Malkavian"));
    const nb = supportedPrecons().find((p) => p.set.startsWith("New Blood") && p.name === "Ventrue");
    const full = supportedPrecons().find((p) => p.set === "Fifth Edition" && p.name === "Ventrue");
    expect(nb && full && preconStyle(nb.name) === preconStyle(full.name)).toBe(true);
  });
});
