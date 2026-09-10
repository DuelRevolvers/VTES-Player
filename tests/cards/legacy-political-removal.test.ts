/**
 * Legacy political actions, the removal family — tranche 1 wave 14
 * (docs/pool-widening-design.md §6).
 *
 * Command of the Harpies, Excommunication, Sacrifice, Permanent
 * Vacation, Screw the Masquerade!.
 *
 * Four of the five are "choose a ready <filter>, then take something
 * away from it", sharing one primitive. TWO risks come with that:
 *
 *  - a FILTER that is too broad names minions the card never could, and
 *    too narrow names none — neither throws, so every filter is asserted
 *    on something it must exclude;
 *  - an OUTCOME that is nearly right. Burned and removed-from-game look
 *    identical on the table and differ entirely in the ash heap, which is
 *    where cards can still reach a burned minion and can never reach a
 *    removed one (p. 16). That contrast is pinned on both cards.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [100382, "Command of the Harpies"],
  [100672, "Excommunication"],
  [101671, "Sacrifice"],
  [101390, "Permanent Vacation"],
  [101699, "Screw the Masquerade!"],
];

function setup(name: string, prepare: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  prepare(state);
  state.seats[0]!.hand.push({ id: "pa", name });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Announce, then answer the terms; the referendum's terms are step 1,
 *  which begins after the action itself has resolved. */
function announce(engine: VtesEngine, name: string, terms?: string): void {
  runTrace(engine, [
    ["Alice", `play:${name}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
  if (terms !== undefined) runTrace(engine, [["Alice", `terms:${terms}`]]);
}

function drain(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp || !state.frames.some((f) => f.kind === "referendum")) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Alice calls the referendum and carries it on her own ballot. */
function pass(name: string, prepare: (s: GameState) => void, terms?: string): GameState {
  const { state, engine } = setup(name, prepare);
  announce(engine, name, terms);
  runTrace(engine, [["Alice", "vote:caller:for"]]);
  drain(engine, state);
  return state;
}

/** The terms this card offers, which is the legal-move generator's answer
 *  to "who may this name". */
function terms(name: string, prepare: (s: GameState) => void): string[] {
  const { engine } = setup(name, prepare);
  announce(engine, name);
  return engine.decision()!.options.map((o) => o.id);
}

const find = (s: GameState, id: string) =>
  s.seats.flatMap((x) => x.minions).find((m) => m.id === id);
const ashOf = (s: GameState, i: number): string[] => (s.seats[i]!.ashHeap ?? []).map((c) => c.name);

describe("Command of the Harpies (100382) — a ready prince loses the title", () => {
  const princes = (s: GameState) => {
    Object.assign(s.seats[0]!.minions[0]!, { sect: "camarilla" });
    Object.assign(s.seats[1]!.minions[0]!, { title: "prince", sect: "camarilla" });
  };

  it("strips the title and leaves the vampire in play", () => {
    // The whole point of `loseTitle`: the minion stays, the votes go.
    const state = pass("Command of the Harpies", princes, "W");
    expect(find(state, "W")!.title).toBe(null);
    expect(find(state, "W")).toBeDefined();
  });

  it("NEGATIVE SPACE: only PRINCES are offered, not every titled vampire", () => {
    const offered = terms("Command of the Harpies", (s) => {
      princes(s);
      s.seats[1]!.minions[1]!.title = "archbishop"; // titled, wrong title
      s.seats[2]!.minions[0]!.title = null; // untitled
    });
    expect(offered).toContain("terms:W");
    expect(offered).not.toContain("terms:M");
    expect(offered).not.toContain("terms:N");
  });

  it("requires a Camarilla vampire to call it", () => {
    const offered = (sect: string): boolean =>
      setup("Command of the Harpies", (s) => {
        princes(s);
        s.seats[0]!.minions[0]!.sect = sect as never;
      })
        .engine.decision()!
        .options.some((o) => o.id.startsWith("play:Command of the Harpies"));
    expect(offered("sabbat")).toBe(false);
    expect(offered("camarilla")).toBe(true);
  });
});

describe("Excommunication (100672) — a ready archbishop loses the title", () => {
  it("strips an archbishop and never names a prince", () => {
    // The sibling filter. Sharing one primitive is only safe if the two
    // cards cannot reach each other's targets, so both halves are here.
    const board = (s: GameState) => {
      s.seats[0]!.minions[0]!.sect = "sabbat";
      Object.assign(s.seats[1]!.minions[0]!, { title: "archbishop", sect: "sabbat" });
      s.seats[1]!.minions[1]!.title = "prince";
    };
    const offered = terms("Excommunication", board);
    expect(offered).toContain("terms:W");
    expect(offered).not.toContain("terms:M");

    const state = pass("Excommunication", board, "W");
    expect(find(state, "W")!.title).toBe(null);
    expect(find(state, "M")!.title).toBe("prince"); // untouched
  });
});

describe("Sacrifice (101671) — burn a small vampire of the caller's own clan", () => {
  const board = (s: GameState) => {
    Object.assign(s.seats[0]!.minions[0]!, { sect: "sabbat", capacity: 8, clan: "Brujah" });
    Object.assign(s.seats[1]!.minions[0]!, { clan: "Brujah", capacity: 6 }); // legal
    Object.assign(s.seats[1]!.minions[1]!, { clan: "Ventrue", capacity: 6 }); // wrong clan
    Object.assign(s.seats[2]!.minions[0]!, { clan: "Brujah", capacity: 7 }); // too big
  };

  it("burns the chosen vampire, and the card reaches the ASH HEAP", () => {
    // Burned, not removed. The ash heap is the difference between this
    // card and Permanent Vacation, and it is invisible on the table.
    const state = pass("Sacrifice", board, "W");
    expect(find(state, "W")).toBeUndefined();
    expect(ashOf(state, 1)).toContain("W");
  });

  it("NEGATIVE SPACE: wrong clan and capacity 7 are both excluded", () => {
    // Two filters, each with a near miss on the table, so neither can be
    // passing by matching nothing.
    const offered = terms("Sacrifice", board);
    expect(offered).toContain("terms:W");
    expect(offered).not.toContain("terms:M"); // Ventrue
    expect(offered).not.toContain("terms:N"); // capacity 7 is not "below 7"
  });

  it("the clan is read from the CALLER, not fixed to one clan", () => {
    // Change only the caller's clan and the legal targets change with it.
    // A hard-coded clan would keep offering W here.
    const offered = terms("Sacrifice", (s) => {
      board(s);
      s.seats[0]!.minions[0]!.clan = "Ventrue";
    });
    expect(offered).toContain("terms:M"); // now the Ventrue is the clanmate
    expect(offered).not.toContain("terms:W");
  });

  it("requires a Sabbat vampire above capacity 7 to call it", () => {
    const offered = (prep: (s: GameState) => void): boolean =>
      setup("Sacrifice", (s) => {
        board(s);
        prep(s);
      })
        .engine.decision()!
        .options.some((o) => o.id.startsWith("play:Sacrifice"));
    expect(offered((s) => (s.seats[0]!.minions[0]!.sect = "camarilla"))).toBe(false);
    expect(offered((s) => (s.seats[0]!.minions[0]!.capacity = 7))).toBe(false); // not "above 7"
    expect(offered(() => {})).toBe(true);
  });
});

describe("Permanent Vacation (101390) — an ally is REMOVED FROM THE GAME", () => {
  const board = (s: GameState) => {
    s.seats[1]!.minions.push(makeMinion("A1", "Bob", { kind: "ally" }));
  };

  it("removes the ally and does NOT put it in the ash heap [p. 16]", () => {
    // The contrast with Tradition Upheld, and the only place the two
    // outcomes differ. A removed card "cannot be retrieved or affected in
    // any way"; asserting only that it left play would pass for a burn.
    const state = pass("Permanent Vacation", board, "A1");
    expect(find(state, "A1")).toBeUndefined();
    expect(ashOf(state, 1)).not.toContain("A1");
    // An absent name in an ash heap is empty for two possible reasons —
    // removed, or never burned at all — so the event log settles which
    // path ran. This is the assertion that would fail if the outcome were
    // quietly compiled as a burn.
    const kinds = state.eventLog
      .filter((e) => e.type === "MinionRemovedFromGame" || e.type === "MinionBurned")
      .map((e) => e.type);
    expect(kinds).toEqual(["MinionRemovedFromGame"]);
  });

  it("NEGATIVE SPACE: vampires are not allies", () => {
    const offered = terms("Permanent Vacation", board);
    expect(offered).toContain("terms:A1");
    expect(offered.some((o) => ["terms:V1", "terms:W", "terms:M", "terms:N"].includes(o))).toBe(
      false,
    );
  });
});

describe("Screw the Masquerade! (101699) — everyone burns 1, the chosen burns 2", () => {
  it("charges the table once and the chosen seat twice", () => {
    // "Each Methuselah burns 1 pool AND the chosen Methuselah burns an
    // ADDITIONAL pool" — additional, so the chosen seat pays both.
    const state = pass("Screw the Masquerade!", () => {}, "Bob");
    expect(state.seats.map((s) => s.pool)).toEqual([9, 8, 9]);
  });

  it("offers exactly ONE Methuselah, never a subset", () => {
    // The primitive's default is any non-empty subset, which would let
    // this card name two seats at once. "Choose A Methuselah" does not.
    const offered = terms("Screw the Masquerade!", () => {}).filter((o) => o.startsWith("terms:"));
    expect(offered.sort()).toEqual(["terms:Alice", "terms:Bob", "terms:Carol"]);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all five are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
