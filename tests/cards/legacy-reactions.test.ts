/**
 * Legacy referendum reactions — tranche 3 wave 10
 * (docs/pool-widening-design.md §6).
 *
 * Surprise Influence, Conflict of Interests, Irregular Protocol.
 *
 * All three are played by a NON-CALLING seat during the polling step
 * (p. 28), which the V5 abstain cards already built. What is new is three
 * filters, and each one can be wrong in a way that shows up as an option
 * list rather than as an error:
 *
 *  - the same-clan filter matching everyone (or nobody),
 *  - "the ACTING vampire" being any vampire,
 *  - the self-lock never being paid.
 */

import { describe, expect, it } from "vitest";
import type { GameState, ReferendumFrame } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [101909, "Surprise Influence"],
  [100404, "Conflict of Interests"],
  [101010, "Irregular Protocol"],
];

/** Alice calls a referendum; `name` is in BOB's hand (a reaction is
 *  offered to the non-calling seats). Stops at the polling step. */
function polling(name: string, setup: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  // The caller needs a title, or there is nothing to abstain from.
  state.seats[0]!.minions[0]!.title = "prince";
  setup(state);
  state.seats[0]!.hand.push({ id: "au", name: "Anarchist Uprising" });
  state.seats[1]!.hand.push({ id: "rx", name });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "play:Anarchist Uprising"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
  ]);
  return { state, engine };
}

function ref(state: GameState): ReferendumFrame | undefined {
  const f = state.frames.find((x) => x.kind === "referendum");
  return f?.kind === "referendum" ? f : undefined;
}

/** Play `opt` for `seat`, then close the AS-PLAYED window — a reaction's
 *  effects land when that window closes, not when the card is chosen.
 *  Driven generically because the as-played cycle does not start with the
 *  playing seat. */
function playAndSettle(engine: VtesEngine, state: GameState, seat: string, opt: string): void {
  runTrace(engine, [[seat, opt]]);
  for (let i = 0; i < 12; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Bob's options at the polling step. */
function bobOptions(engine: VtesEngine, state: GameState): string[] {
  for (let i = 0; i < 20; i++) {
    const dp = engine.decision();
    if (!dp || !ref(state)) return [];
    if (dp.seat === "Bob") return dp.options.map((o) => o.id);
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
  return [];
}

describe("Surprise Influence (101909) — the reactor gains 2 votes", () => {
  it("is offered to a non-calling seat and grants the votes", () => {
    const { state, engine } = polling("Surprise Influence");
    const opt = bobOptions(engine, state).find((o) => o.startsWith("play:Surprise Influence"));
    expect(opt).toBeDefined();
    playAndSettle(engine, state, "Bob", opt!);
    // The polling step resumes with the CALLER, not with whoever just
    // played — so walk to Bob's turn to cast rather than assuming it.
    for (let i = 0; i < 20 && ref(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      const cast = dp.options.find((o) => o.id === "vote:grant:against");
      if (cast) {
        runTrace(engine, [[dp.seat, cast.id]]);
        break;
      }
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    for (let i = 0; i < 20 && ref(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    const resolved = state.eventLog.find((e) => e.type === "ReferendumResolved");
    expect(resolved).toMatchObject({ votesAgainst: 2 });
  });
});

describe("Conflict of Interests (100404) — cancel a same-clan vampire", () => {
  it("offers the caller only when the reactor shares their clan", () => {
    const { state, engine } = polling("Conflict of Interests", (s) => {
      s.seats[0]!.minions[0]!.clan = "Brujah";
      s.seats[1]!.minions.find((m) => m.id === "M")!.clan = "Brujah";
    });
    const ids = bobOptions(engine, state);
    expect(ids.some((o) => o.startsWith("play:Conflict of Interests"))).toBe(true);
  });

  it("NEGATIVE SPACE: a different clan offers nothing", () => {
    // Same trace, one clan changed. Without this the test above passes
    // for a card whose filter matches everybody.
    const { state, engine } = polling("Conflict of Interests", (s) => {
      s.seats[0]!.minions[0]!.clan = "Brujah";
      for (const m of s.seats[1]!.minions) m.clan = "Toreador";
    });
    const ids = bobOptions(engine, state);
    expect(ids.some((o) => o.startsWith("play:Conflict of Interests"))).toBe(false);
  });

  it("actually makes the caller abstain", () => {
    const { state, engine } = polling("Conflict of Interests", (s) => {
      s.seats[0]!.minions[0]!.clan = "Brujah";
      s.seats[1]!.minions.find((m) => m.id === "M")!.clan = "Brujah";
    });
    const opt = bobOptions(engine, state).find((o) => o.startsWith("play:Conflict of Interests"));
    playAndSettle(engine, state, "Bob", opt!);
    expect(ref(state)?.abstaining ?? []).toContain("V1");
  });
});

describe("Irregular Protocol (101010) — the ACTING vampire abstains", () => {
  it("targets the caller and nobody else", () => {
    // Carol has a titled vampire too. "The acting vampire" is one target,
    // named by the referendum — an unfiltered abstain would offer both.
    const { state, engine } = polling("Irregular Protocol", (s) => {
      s.seats[2]!.minions[0]!.title = "prince";
    });
    // One option per REACTOR (Bob has two ready vampires), but every one
    // of them names the same target — the caller. An unfiltered abstain
    // would also offer Carol's prince.
    const ids = bobOptions(engine, state).filter((o) => o.startsWith("play:Irregular Protocol"));
    expect(ids.length).toBeGreaterThan(0);
    const targets = new Set(ids.map((o) => o.split(":").at(-2)));
    expect([...targets]).toEqual(["V1"]);
  });

  it("locks the REACTING vampire, not the target", () => {
    // `lockSelf`, the mirror of `lockTarget`. Getting them the wrong way
    // round locks the wrong minion and still abstains the right one, so
    // only the lock state tells them apart.
    const { state, engine } = polling("Irregular Protocol");
    const opt = bobOptions(engine, state).find((o) => o.startsWith("play:Irregular Protocol"));
    expect(opt).toBeDefined();
    const reactor = opt!.split(":")[3]!;
    playAndSettle(engine, state, "Bob", opt!);
    expect(ref(state)?.abstaining ?? []).toContain("V1");
    expect(state.seats[1]!.minions.find((m) => m.id === reactor)!.locked).toBe(true);
    expect(state.seats[0]!.minions[0]!.locked).toBe(true); // the caller locked to ACT
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all three are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
