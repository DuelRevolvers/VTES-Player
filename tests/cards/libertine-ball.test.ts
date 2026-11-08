/**
 * Wave 115 — Libertine Ball (docs/libertine-ball-design.md).
 *
 * The first wave aimed at a legacy precon, and the first to open a crypt
 * clan: Toreador antitribu groups 4–5. Three cards carry text — two masters
 * that only do anything for that clan, and one vampire — and every clause is
 * tested in both directions, because a clan aura that reaches nobody and one
 * that reaches everybody both pass a one-sided test.
 *
 * The masters are PLAYED FROM HAND, never hand-built as entries, so these
 * tests exercise the compiled specs rather than a copy of them.
 */
import { preconDeck, supportedPrecons, importDeck } from "../../src/ui/deckimport";

describe("the deck itself (0.11.65: legacy precons in the chooser)", () => {
  it("is offered in the chooser, playable as printed", () => {
    const s = supportedPrecons().find(
      (p) => p.set === "Sabbat Preconstructed" && p.name === "Libertine Ball"
    );
    expect(s).toBeDefined();
    expect(s!.problems).toEqual([]);
    expect(s!.playable).toBe(true);
    expect([s!.cryptCount, s!.libraryCount]).toEqual([12, 77]);
  });

  it("deals every card, and its list survives the deck importer", () => {
    const d = preconDeck("Sabbat Preconstructed", "Libertine Ball", "A");
    expect(d).not.toBeNull();
    expect([d!.crypt.length, d!.library.length]).toEqual([12, 77]);
    const counts = new Map<string, number>();
    for (const n of d!.library) counts.set(n, (counts.get(n) ?? 0) + 1);
    const text = [
      "Crypt:",
      "1 Jonathan Gursel",
      "1 Justine Chen, Innocent",
      "3 Klaus Konrecht",
      "1 L'Épuisette",
      "1 Loonar",
      "1 Monique Kim",
      "2 Conchita Morales",
      "2 Guggenheim",
      "Library:",
      ...[...counts].map(([n, c]) => `${c} ${n}`),
    ].join("\n");
    const r = importDeck(text, "A");
    expect(r.report.unsupported).toEqual([]);
    expect(r.report.ok).toBe(true);
    expect(r.deck?.crypt.length).toBe(12);
    expect(r.deck?.library.length).toBe(77);
  });
});

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, ReferendumFrame } from "../../src/engine/index.ts";
import { VtesEngine, vampireVotes } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import cryptGroups from "../../config/crypt-groups.json";

const handlers = buildHandlerRegistry();
const TA = "Toreador antitribu";

function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function turn(state: GameState) {
  const tf = state.frames.find((f) => f.kind === "turn");
  if (!tf || tf.kind !== "turn") throw new Error("no turn frame");
  return tf;
}
/** `pass`, then `end`, then anything — a walker must not play the board. */
function walk(engine: VtesEngine, until: () => boolean, limit = 400): void {
  for (let i = 0; i < limit; i++) {
    if (until()) return;
    const dp = engine.decision();
    if (!dp) throw new Error("game ended before the condition held");
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  throw new Error("condition never held");
}

/** Put a real crypt card's ability onto a minion, as `makeVampire` does. */
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

/** Alice in her master phase with one master action and `cards` in hand. */
function master(cards: Array<[string, string]>, tweak: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  const tf = turn(state);
  tf.phase = "master";
  tf.masterActionsLeft = cards.length;
  seat(state, "Alice").hand = cards.map(([id, name]) => ({ id, name }));
  tweak(state);
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Pool Bob loses to V1 bleeding him, from Alice's minion phase. */
function bleedFor(state: GameState, engine = new VtesEngine(state, testRegistry)): number {
  if (turn(state).phase !== "minion") {
    walk(engine, () => turn(state).phase === "minion");
  }
  const before = seat(state, "Bob").pool;
  runTrace(engine, [["Alice", "bleed:V1"]]);
  walk(engine, () => state.eventLog.some((e) => e.type === "ActionResolved"));
  return before - seat(state, "Bob").pool;
}

/** A referendum frame with no riders, for asking `vampireVotes` alone. */
const bareReferendum = { kind: "referendum" } as unknown as ReferendumFrame;

// ---------------------------------------------------------------------------
// The clan is open — and only that clan
// ---------------------------------------------------------------------------

describe("Toreador antitribu groups 4–5 are open", () => {
  const crypt = Object.values(
    (registry as { entries: Record<string, { card: { kind: string; name: string; clan?: string; group?: number } }> })
      .entries,
  ).map((e) => e.card).filter((c) => c.kind === "crypt");

  it("admits every vampire Libertine Ball's crypt names", () => {
    for (const n of [
      "Conchita Morales (G5)", "Guggenheim (G5)", "Jonathan Gursel (G4)",
      "Justine Chen, Innocent (G4)", "Klaus Konrecht (G4)", "L'Épuisette (G4)",
      "Loonar (G4)", "Monique Kim (G4)",
    ]) {
      expect(crypt.some((c) => c.name === n), n).toBe(true);
    }
  });

  it("admits no other legacy clan — the filter is per clan", () => {
    const open = (cryptGroups as { open: Array<{ clan: string }> }).open.map((o) => o.clan);
    expect(open).toEqual([TA]);
  });
});

// ---------------------------------------------------------------------------
// L'Épuisette — +1 bleed against a Methuselah who controls a READY Toreador
// ---------------------------------------------------------------------------

describe("L'Épuisette (200800)", () => {
  function withTarget(clan: string, torpor = false): GameState {
    const state = threeSeatGame();
    asVampire(must(state, "V1"), "L'Épuisette (G4)");
    Object.assign(must(state, "W"), { clan, inTorpor: torpor });
    return state;
  }

  it("bleeds for 2 when the prey controls a ready Toreador", () => {
    expect(bleedFor(withTarget("Toreador"))).toBe(2);
  });

  it("bleeds for 1 when that Toreador is in torpor — 'ready' is printed", () => {
    expect(bleedFor(withTarget("Toreador", true))).toBe(1);
  });

  it("bleeds for 1 against a Toreador ANTITRIBU — a different clan", () => {
    expect(bleedFor(withTarget(TA))).toBe(1);
  });

  it("the control: without the ability, the same target takes 1", () => {
    const state = threeSeatGame();
    must(state, "W").clan = "Toreador";
    expect(bleedFor(state)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Palla Grande — Toreador antitribu get +1 bleed, on a three-turn clock
// ---------------------------------------------------------------------------

describe("Palla Grande (101346)", () => {
  const pallaCounters = (state: GameState): number | undefined =>
    seat(state, "Alice").permanents.find((p) => p.card.name === "Palla Grande")?.counters;

  it("enters play with 3 counters", () => {
    const { state, engine } = master([["pg", "Palla Grande"]]);
    runTrace(engine, [["Alice", "play:Palla Grande"]]);
    walk(engine, () => pallaCounters(state) !== undefined);
    expect(pallaCounters(state)).toBe(3);
  });

  it("gives a Toreador antitribu +1 bleed — anyone's, since it says no 'you control'", () => {
    const { state, engine } = master([["pg", "Palla Grande"]], (s) => {
      must(s, "V1").clan = TA;
    });
    runTrace(engine, [["Alice", "play:Palla Grande"]]);
    expect(bleedFor(state, engine)).toBe(2);
  });

  it("gives any other clan nothing", () => {
    const { state, engine } = master([["pg", "Palla Grande"]], (s) => {
      must(s, "V1").clan = "Toreador";
    });
    runTrace(engine, [["Alice", "play:Palla Grande"]]);
    expect(bleedFor(state, engine)).toBe(1);
  });

  it("loses a counter in ITS CONTROLLER'S discard phase only, and burns at zero", () => {
    const { state, engine } = master([["pg", "Palla Grande"]]);
    runTrace(engine, [["Alice", "play:Palla Grande"]]);
    const at = (s: string) => () => turn(state).seat === s && turn(state).phase === "discard";
    walk(engine, at("Alice"));
    expect(pallaCounters(state)).toBe(2);
    // Bob's and Carol's discard phases do not touch it.
    walk(engine, at("Bob"));
    walk(engine, at("Carol"));
    expect(pallaCounters(state)).toBe(2);
    walk(engine, () => turn(state).seat === "Alice" && turn(state).phase === "unlock");
    walk(engine, at("Alice"));
    expect(pallaCounters(state)).toBe(1);
    walk(engine, () => turn(state).seat === "Bob");
    walk(engine, () => turn(state).seat === "Alice" && turn(state).phase === "unlock");
    walk(engine, at("Alice"));
    expect(pallaCounters(state)).toBeUndefined();
    expect(
      state.eventLog.some((e) => e.type === "PermanentBurned" && e.name === "Palla Grande"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Foundation Exhibit — +1 vote for non-titled Toreador antitribu you control
// ---------------------------------------------------------------------------

describe("Foundation Exhibit (100779)", () => {
  function exhibit(tweak: (s: GameState) => void) {
    const { state, engine } = master([["fe", "Foundation Exhibit"]], tweak);
    runTrace(engine, [["Alice", "play:Foundation Exhibit"]]);
    walk(engine, () => seat(state, "Alice").permanents.some((p) => p.card.id === "fe"));
    return { state, engine };
  }
  const votes = (state: GameState, id: string) => vampireVotes(state, bareReferendum, must(state, id)).votes;

  it("gives a non-titled Toreador antitribu you control 1 vote", () => {
    const { state } = exhibit((s) => Object.assign(must(s, "V1"), { clan: TA, title: null }));
    expect(votes(state, "V1")).toBe(1);
  });

  it("gives a TITLED one nothing extra", () => {
    const without = threeSeatGame();
    Object.assign(must(without, "V1"), { clan: TA, title: "cardinal" });
    const { state } = exhibit((s) => Object.assign(must(s, "V1"), { clan: TA, title: "cardinal" }));
    expect(votes(state, "V1")).toBe(votes(without, "V1"));
    expect(votes(state, "V1")).toBeGreaterThan(0); // the title's own votes
  });

  it("gives another Methuselah's Toreador antitribu nothing — 'you control'", () => {
    const { state } = exhibit((s) => Object.assign(must(s, "W"), { clan: TA, title: null }));
    expect(votes(state, "W")).toBe(0);
  });

  it("gives a non-titled vampire of another clan nothing", () => {
    const { state } = exhibit((s) => Object.assign(must(s, "V1"), { clan: "Toreador", title: null }));
    expect(votes(state, "V1")).toBe(0);
  });

  it("an untitled Toreador antitribu can vote in a real referendum", () => {
    const { state, engine } = exhibit((s) => {
      Object.assign(must(s, "V1"), { clan: TA, title: null });
      seat(s, "Alice").hand.push({ id: "au", name: "Anarchist Uprising" });
    });
    walk(engine, () => turn(state).phase === "minion");
    runTrace(engine, [["Alice", "play:Anarchist Uprising"]]);
    walk(engine, () => ids(engine).some((i) => i.startsWith("vote:V1:")));
    expect(ids(engine)).toContain("vote:V1:for");
  });

  it("any vampire can burn it as a directed action costing 1 blood — not an ally", () => {
    const { state, engine } = exhibit((s) => {
      seat(s, "Bob").minions.push(makeAlly("A1", "Bob", 2));
    });
    walk(engine, () => turn(state).seat === "Bob" && turn(state).phase === "minion");
    const offered = ids(engine).filter((i) => i.startsWith("act:Foundation Exhibit"));
    expect(offered).toContain("act:Foundation Exhibit:fe:burn:W");
    expect(offered.some((i) => i.endsWith(":A1"))).toBe(false);
    const blood = must(state, "W").blood;
    runTrace(engine, [["Bob", "act:Foundation Exhibit:fe:burn:W"]]);
    walk(engine, () => state.eventLog.some((e) => e.type === "ActionResolved"));
    expect(seat(state, "Alice").permanents.some((p) => p.card.id === "fe")).toBe(false);
    expect(must(state, "W").blood).toBe(blood - 1);
  });
});
