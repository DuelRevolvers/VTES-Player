/**
 * The first cards to read the ash heap (docs/ash-heap-design.md §6).
 *
 * Shroud of Decay (102295), Psychophagia (102302).
 *
 * The rule these exist to pin is the glossary's, because it cuts against
 * every targeting instinct this engine has: **an action that targets an
 * ash heap is always considered to be UNDIRECTED.**
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, CardInstance, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function heapNames(state: GameState, seat: string): string[] {
  return (seatOf(state, seat).ashHeap ?? []).map((c) => c.name);
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function action(state: GameState): ActionFrame | undefined {
  const f = state.frames.find((x) => x.kind === "action");
  return f && f.kind === "action" ? f : undefined;
}

/** Fill a seat's ash heap with `n` distinct cards. */
function fillHeap(state: GameState, seat: string, n: number, name = "Conditioning"): void {
  const cards: CardInstance[] = [];
  for (let i = 0; i < n; i++) cards.push({ id: `${seat}-ash-${i}`, name });
  seatOf(state, seat).ashHeap = cards;
}

function setup(
  cards: string[],
  disc: Record<string, "basic" | "superior">,
  tweak: (state: GameState) => void = () => {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc, blood: 4, capacity: 8 });
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  tweak(state);
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/** Play then pass until the action frame is gone. */
function playAndResolve(engine: VtesEngine, state: GameState, optionId: string): void {
  runTrace(engine, [[engine.decision()!.seat, optionId]]);
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Shroud of Decay (102295)", () => {
  it("inferior bleeds for +1 and makes the TARGET discard 2 of their choice", () => {
    const { state, engine } = setup(["Shroud of Decay"], { obl: "basic" }, (s) => {
      seatOf(s, "Bob").hand = [
        { id: "b1", name: "Conditioning" },
        { id: "b2", name: "Govern the Unaligned" },
        { id: "b3", name: "Deflection" },
      ];
    });
    const id = optionIds(engine).find((o) => o.startsWith("play:Shroud of Decay:basic"))!;
    expect(id).toBeDefined();
    runTrace(engine, [["Alice", id]]);
    // Walk to the discard choice; it is addressed to BOB, not the actor.
    let asked = 0;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id.startsWith("choice:Shroud of Decay"));
      if (pick) {
        expect(dp.seat).toBe("Bob");
        asked++;
        runTrace(engine, [[dp.seat, pick.id]]);
        continue;
      }
      // No early break: raiseChoice QUEUES while an action resolves and
      // flushes after it pops, so there is a gap with neither frame.
      const pass = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pass.id]]);
      if (asked >= 2) break;
    }
    expect(asked).toBe(2);
    expect(seatOf(state, "Bob").hand.length).toBe(1);
    // The discarded cards are in BOB's heap — the owner's (p. 16).
    expect(heapNames(state, "Bob").length).toBe(2);
  });

  it("superior removes 7 from the PREY's heap and burns 3 of their pool", () => {
    const { state, engine } = setup(["Shroud of Decay"], { obl: "superior" }, (s) => {
      fillHeap(s, "Bob", 8);
    });
    const id = optionIds(engine).find((o) => o.startsWith("play:Shroud of Decay:superior"))!;
    expect(id).toBeDefined();
    const bobPool = seatOf(state, "Bob").pool;
    playAndResolve(engine, state, id);
    expect(heapNames(state, "Bob").length).toBe(1);
    expect(seatOf(state, "Bob").pool).toBe(bobPool - 3);
  });

  it("THE GLOSSARY RULE: an action targeting an ash heap is UNDIRECTED", () => {
    // Every instinct built up over the rush and steal waves says
    // "reaches into the prey's stuff ⇒ directed". The rulebook says
    // otherwise, explicitly, and that changes who may block.
    const { state, engine } = setup(["Shroud of Decay"], { obl: "superior" }, (s) => {
      fillHeap(s, "Bob", 8);
    });
    const id = optionIds(engine).find((o) => o.startsWith("play:Shroud of Decay:superior"))!;
    runTrace(engine, [["Alice", id]]);
    for (let i = 0; i < 12; i++) {
      const af = action(state);
      if (af) {
        expect(af.target).toBe(null);
        return;
      }
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, dp.options[0]!.id]]);
    }
    throw new Error("never reached the action frame");
  });

  it("NEGATIVE SPACE: the superior is not offered when the prey's heap holds fewer than 7", () => {
    const { engine } = setup(["Shroud of Decay"], { obl: "superior" }, (s) => {
      fillHeap(s, "Bob", 6);
    });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Shroud of Decay"));
    // The basic mode is still there, so this does not pass vacuously.
    expect(ids.some((o) => o.includes(":basic:"))).toBe(true);
    expect(ids.some((o) => o.includes(":superior:"))).toBe(false);
  });
});

describe("Psychophagia (102302)", () => {
  const withAllyInHeap = (s: GameState) => {
    seatOf(s, "Bob").ashHeap = [
      { id: "bA", name: "Political Ally" },
      { id: "bC", name: "Conditioning" },
    ];
  };

  it("removes an ALLY card from any Methuselah's heap and gains 3 blood", () => {
    const { state, engine } = setup(["Psychophagia"], {}, withAllyInHeap);
    const gain = optionIds(engine).find(
      (o) => o.startsWith("play:Psychophagia") && o.includes(":bA:") && o.includes(":gain:"),
    );
    expect(gain).toBeDefined();
    const before = find(state, "V1").blood;
    playAndResolve(engine, state, gain!);
    expect(heapNames(state, "Bob")).toEqual(["Conditioning"]);
    expect(find(state, "V1").blood).toBe(before + 3);
  });

  it("…or 2 blood and an unlock — the payoff is a real choice", () => {
    const { state, engine } = setup(["Psychophagia"], {}, withAllyInHeap);
    const unlock = optionIds(engine).find(
      (o) => o.startsWith("play:Psychophagia") && o.includes(":unlock:"),
    );
    expect(unlock).toBeDefined();
    const before = find(state, "V1").blood;
    playAndResolve(engine, state, unlock!);
    expect(find(state, "V1").blood).toBe(before + 2);
    // The actor locked at announcement (p. 25) and the card unlocks them.
    expect(find(state, "V1").locked).toBe(false);
  });

  it("NEGATIVE SPACE: a NON-ally card in the heap is not a legal choice", () => {
    const { engine } = setup(["Psychophagia"], {}, withAllyInHeap);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Psychophagia"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes(":bC:"))).toBe(false);
  });

  it("NEGATIVE SPACE: with no ally in any heap the card is unplayable", () => {
    const { engine } = setup(["Psychophagia"], {}, (s) => {
      seatOf(s, "Bob").ashHeap = [{ id: "bC", name: "Conditioning" }];
    });
    expect(optionIds(engine).some((o) => o.startsWith("play:Psychophagia"))).toBe(false);
  });
});

describe("Putrescent Sustenance (102335) — PARTIAL", () => {
  it("removes an ally from an ash heap for 2 blood (basic) / 3 (superior)", () => {
    for (const [level, gain] of [["basic", 2], ["superior", 3]] as const) {
      const { state, engine } = setup(["Putrescent Sustenance"], { obl: level }, (s) => {
        seatOf(s, "Bob").ashHeap = [{ id: "bA", name: "Political Ally" }];
      });
      const id = optionIds(engine).find((o) =>
        o.startsWith(`play:Putrescent Sustenance:${level}`),
      );
      expect(id, `${level} mode offered`).toBeDefined();
      const before = find(state, "V1").blood;
      playAndResolve(engine, state, id!);
      expect(heapNames(state, "Bob")).toEqual([]);
      expect(find(state, "V1").blood).toBe(before + gain);
    }
  });

  it("PARTIAL, asserted: the zombie-ally half is NOT implemented", () => {
    // The card also reads "…or to add 2 life to a zombie ally you
    // control". Zombie allies are BLOCKED, so that clause is absent and
    // recorded in docs/partial-support.md. This pins the gap so it cannot
    // rot: only the blood payoff is ever offered.
    const { engine } = setup(["Putrescent Sustenance"], { obl: "basic" }, (s) => {
      seatOf(s, "Bob").ashHeap = [{ id: "bA", name: "Political Ally" }];
    });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Putrescent Sustenance"));
    expect(ids.length).toBe(1);
    expect(ids[0]).toContain(":gain:");
  });
});
