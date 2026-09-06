/**
 * Temporary hand size (docs/temporary-hand-size-design.md).
 *
 * Dreams of the Sphinx (100588) "+2 hand size until the end of the turn"
 * and Rage of Apedemak (102336) "this combat, you get +1 hand size" — the
 * two ledger rows that said temporary hand-size bonuses were unmodelled.
 *
 * The half that had never existed is p. 7's OTHER direction: the engine
 * has always drawn up when hand size grew, and had nowhere to shed cards
 * when it fell. Both cards are a dig, not a gift — the cards come back.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { handSizeOf, VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

/** n filler cards, named for a card the registry knows and that offers
 *  nothing in any window these traces visit. */
function filler(prefix: string, n: number): Array<{ id: string; name: string }> {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: "Conditioning" }));
}

function turnNumber(state: GameState): number {
  const f = state.frames.find((x) => x.kind === "turn");
  return f?.kind === "turn" ? f.turnNumber : 0;
}

/**
 * Step until `stop` says so or the engine asks a question (a discard-down
 * is a `choice`), preferring to do nothing at every decision so the trace
 * is driven by the turn structure rather than by card plays.
 */
function drift(engine: VtesEngine, stop: () => boolean, limit = 200): void {
  for (let i = 0; i < limit; i++) {
    if (stop()) return;
    const dp = engine.decision();
    if (!dp) return;
    if (dp.window === "choice") return;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    engine.choose(pick.id);
  }
  throw new Error("drift: limit reached");
}

/** A card is played into an "as played" cycle: every seat answers before
 *  it resolves (p. 7). Pass through it. */
function settlePlay(engine: VtesEngine, state: GameState, limit = 12): void {
  for (let i = 0; i < limit; i++) {
    if (!state.frames.some((f) => f.kind === "cardPlay")) return;
    const dp = engine.decision();
    if (!dp) return;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  throw new Error("settlePlay: card never resolved");
}

// ---------------------------------------------------------------------------

describe("Dreams of the Sphinx (100588) — +2 hand size until end of turn", () => {
  function withSphinx(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const alice = seatOf(state, "Alice");
    alice.hand = filler("h", 7);
    alice.library = filler("L", 12);
    alice.permanents.push({
      card: { id: "ds1", name: "Dreams of the Sphinx" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location"],
      counters: 0,
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("locks for +2 and DRAWS UP IMMEDIATELY (p. 7)", () => {
    const { state, engine } = withSphinx();
    expect(handSizeOf(state, "Alice")).toBe(7);

    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:hand"]]);

    expect(handSizeOf(state, "Alice")).toBe(9);
    expect(seatOf(state, "Alice").hand).toHaveLength(9);
    expect(seatOf(state, "Alice").library).toHaveLength(10);
    // The same "each time you lock it" clause the other two abilities feed.
    const perm = seatOf(state, "Alice").permanents.find((p) => p.card.id === "ds1")!;
    expect(perm.locked).toBe(true);
    expect(perm.counters).toBe(1);
  });

  it("the bonus is still up during the DISCARD PHASE, and lapses after it (p. 50)", () => {
    const { state, engine } = withSphinx();
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:hand"]]);

    // p. 50: "you first have the option of using a discard phase action to
    // discard a card (and replace it) BEFORE decreasing your hand size
    // back to normal by discarding 2 cards." So at the discard phase the
    // hand is still 9 and a discard phase action is still on the table.
    drift(engine, () => engine.decision()?.window === "turn.discard", 40);
    expect(engine.decision()!.window).toBe("turn.discard");
    expect(handSizeOf(state, "Alice")).toBe(9);
    expect(seatOf(state, "Alice").hand).toHaveLength(9);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("discard:"))).toBe(true);
  });

  it("sheds 2 cards at end of turn, and they are NOT replaced", () => {
    const { state, engine } = withSphinx();
    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:hand"]]);
    const libraryBefore = seatOf(state, "Alice").library.length;
    const turn = turnNumber(state);

    // Drive past the discard phase; the turn ends and the bonus lapses.
    drift(engine, () => turnNumber(state) > turn);
    expect(engine.decision()!.window).toBe("choice");
    expect(engine.decision()!.seat).toBe("Alice");
    expect(handSizeOf(state, "Alice")).toBe(7); // already gone

    // Two questions, one card each — re-raised until the hand matches.
    const first = seatOf(state, "Alice").hand[0]!.id;
    runTrace(engine, [["Alice", `choice:Dreams of the Sphinx:ds1:handSizeDown:${first}`]]);
    expect(seatOf(state, "Alice").hand).toHaveLength(8);
    expect(engine.decision()!.window).toBe("choice");
    const second = seatOf(state, "Alice").hand[0]!.id;
    runTrace(engine, [["Alice", `choice:Dreams of the Sphinx:ds1:handSizeDown:${second}`]]);

    expect(seatOf(state, "Alice").hand).toHaveLength(7);
    expect(engine.decision()!.window).not.toBe("choice");
    // A discard-DOWN is not a cost and not a play: nothing is drawn back.
    expect(seatOf(state, "Alice").library).toHaveLength(libraryBefore);
    expect(seatOf(state, "Alice").ashHeap ?? []).toHaveLength(2);
  });

  it("is not a DEBT: an empty library draws nothing and sheds nothing", () => {
    const { state, engine } = withSphinx();
    seatOf(state, "Alice").library = [];

    runTrace(engine, [["Alice", "ability:Dreams of the Sphinx:ds1:hand"]]);
    expect(seatOf(state, "Alice").hand).toHaveLength(7); // nothing to draw

    const turn = turnNumber(state);
    drift(engine, () => turnNumber(state) > turn);
    // Never over hand size, so the question is never asked.
    expect(engine.decision()!.window).not.toBe("choice");
    expect(seatOf(state, "Alice").hand).toHaveLength(7);
  });

  it("is not offered while the card is locked", () => {
    const { state, engine } = withSphinx();
    seatOf(state, "Alice").permanents[0]!.locked = true;

    expect(engine.decision()!.options.map((o) => o.id)).not.toContain(
      "ability:Dreams of the Sphinx:ds1:hand",
    );
  });
});

// ---------------------------------------------------------------------------

describe("Rage of Apedemak (102336) — +1 hand size this combat", () => {
  /** Alice's V1 bleeds, Bob's M blocks; combat live at before-range, with
   *  Alice holding a full hand and a library to draw from. */
  function intoCombat(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { ani: "basic" }, blood: 6, strength: 1 });
    Object.assign(find(state, "M"), { blood: 6, strength: 1 });
    const alice = seatOf(state, "Alice");
    alice.hand = [...filler("h", 6), { id: "roa", name: "Rage of Apedemak" }];
    alice.library = filler("L", 12);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    return { state, engine };
  }

  it("draws a card on play and takes one back when the combat ends", () => {
    const { state, engine } = intoCombat();
    expect(seatOf(state, "Alice").hand).toHaveLength(7);

    const play = engine
      .decision()!
      .options.map((o) => o.id)
      .find((id) => id.startsWith("play:Rage of Apedemak:basic:V1"))!;
    expect(play).toBeDefined();
    runTrace(engine, [["Alice", play]]);
    settlePlay(engine, state);

    // Played (−1), replaced (+1), and the bonus draws one more.
    expect(handSizeOf(state, "Alice")).toBe(8);
    expect(seatOf(state, "Alice").hand).toHaveLength(8);
    // …and the damage half still landed.
    expect(combat(state)!.strengthBonus.acting).toBe(1);

    // Run the combat out. However it ends, the bonus lifts with the frame.
    for (let i = 0; i < 120 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(combat(state)).toBeUndefined();
    expect(handSizeOf(state, "Alice")).toBe(7);

    // The excess card is asked for, one question, and not replaced.
    expect(engine.decision()!.window).toBe("choice");
    expect(engine.decision()!.seat).toBe("Alice");
    const shed = seatOf(state, "Alice").hand[0]!.id;
    runTrace(engine, [["Alice", `choice:Rage of Apedemak:roa:handSizeDown:${shed}`]]);
    expect(seatOf(state, "Alice").hand).toHaveLength(7);
    expect(engine.decision()!.window).not.toBe("choice");
  });

  it("the bonus belongs to the PLAYER, not to their vampire's controller's opponent", () => {
    const { state, engine } = intoCombat();
    const play = engine
      .decision()!
      .options.map((o) => o.id)
      .find((id) => id.startsWith("play:Rage of Apedemak:basic:V1"))!;
    runTrace(engine, [["Alice", play]]);
    settlePlay(engine, state);

    expect(handSizeOf(state, "Alice")).toBe(8);
    expect(handSizeOf(state, "Bob")).toBe(7);
    expect(handSizeOf(state, "Carol")).toBe(7);
  });
});
