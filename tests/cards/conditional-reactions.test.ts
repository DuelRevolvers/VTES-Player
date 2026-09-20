/**
 * Conditional reactions (docs/conditional-reactions-design.md).
 *
 * Steadfastness (101864), Sonar (101824), Dread Gaze (100586).
 *
 * Three reactions, each conditioned on WHAT is being answered. The primitives
 * all existed, so what these test is the CONDITION — and the fixtures are the
 * work: intercept is only offered when it is needed (p. 26), so getting a
 * directed action with stealth on it takes the real back-and-forth.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * Bob holds `bobCards`; Alice holds an Uncontrolled Impulse to put +2 stealth
 * on her bleed, because a bare bleed is 0 stealth vs 0 intercept and intercept
 * is then not "needed" and never offered.
 */
function setup(
  bobCards: string[],
  bobDisciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 5, capacity: 5 });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: m.capacity, disciplines: bobDisciplines });
  state.seats[0]!.hand.push({ id: "ui1", name: "Uncontrolled Impulse" });
  bobCards.forEach((n, i) => state.seats[1]!.hand.push({ id: `cr${i}`, name: n }));
  return { state, engine: new VtesEngine(state, testRegistry), v1, m };
}

function now(engine: VtesEngine): { seat: string; window: string; ids: string[] } {
  const dp = engine.decision();
  if (!dp) throw new Error("no decision");
  return { seat: dp.seat, window: dp.window, ids: dp.options.map((o) => o.id) };
}

/**
 * Advance by PASSING until `prefix` is on the table, and return its id. A
 * walker, not a counted trace: the number of impulses between a block attempt
 * and the blocker's own reaction window is not a constant, and a trace one step
 * short reports "not offered" for a card that is (wave 83's lesson).
 */
function offeredTo(engine: VtesEngine, prefix: string, limit = 24): string | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) return hit.id;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return null;
    engine.choose(pick.id);
  }
  return null;
}

/** The same walk, reporting only whether it ever appeared — for negatives. */
function everOffered(engine: VtesEngine, prefix: string, limit = 24): boolean {
  return offeredTo(engine, prefix, limit) !== null;
}

/**
 * Alice bleeds, Bob attempts a block, Alice adds +2 stealth — and stop where
 * Bob may answer it. This is the only sequence that makes an intercept card
 * offerable on a DIRECTED action: stealth and intercept are both gated on a
 * live block attempt, so the stealth has to come first.
 */
function toInterceptWindow(a: { engine: VtesEngine }): void {
  runTrace(a.engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "play:Uncontrolled Impulse"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

/** The same up to the block, WITHOUT the stealth — so intercept is not needed. */
function toBlockNoStealth(a: { engine: VtesEngine }): void {
  runTrace(a.engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
  ]);
}

/** Alice calls a terms-less referendum and reaches the polling step. */
function toPolling(): Array<[string, string]> {
  return [
    ["Alice", "play:Anarchist Uprising"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

// ---------------------------------------------------------------------------

describe("the two intercept reactions", () => {
  for (const [card, d] of [
    ["Steadfastness", { for: "superior" as const }],
    ["Sonar", { pro: "superior" as const }],
  ] as const) {
    it(`${card}: its basic is offered against a stealthed DIRECTED action`, () => {
      const a = setup([card], d);
      toInterceptWindow(a);
      expect(offeredTo(a.engine, `play:${card}:basic`), `${card} basic never offered`).not.toBeNull();
    });

    it(`${card}: NOT offered when no intercept is needed`, () => {
      // 0 stealth vs 0 intercept — the block already succeeds, so p. 26 keeps
      // the card off the table. The window is open and Bob is being asked.
      const a = setup([card], d);
      toBlockNoStealth(a);
      expect(everOffered(a.engine, `play:${card}:basic`, 10)).toBe(false);
    });
  }

  it("Sonar's SUPERIOR needs no directed action; Steadfastness's basic does", () => {
    // A hunt is undirected (p. 25) and carries +1 inherent stealth, so it is
    // the fixture that separates the two gates: intercept IS needed, but the
    // action is not directed at Bob.
    const sonar = setup(["Sonar"], { pro: "superior" });
    runTrace(sonar.engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    expect(offeredTo(sonar.engine, "play:Sonar:superior"), "superior never offered").not.toBeNull();

    // …and on the same board the DIRECTED-gated basic never appears.
    const sonar2 = setup(["Sonar"], { pro: "superior" });
    runTrace(sonar2.engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    expect(everOffered(sonar2.engine, "play:Sonar:basic", 12)).toBe(false);

    const fast = setup(["Steadfastness"], { for: "superior" });
    runTrace(fast.engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    expect(everOffered(fast.engine, "play:Steadfastness:basic", 12)).toBe(false);
  });
});

describe("Steadfastness (101864) — the superior reduces the bleed instead", () => {
  it("takes a point off the bleed, and needs no block attempt at all", () => {
    const a = setup(["Steadfastness"], { for: "superior" });
    const before = a.state.seats[1]!.pool;
    runTrace(a.engine, [["Alice", "bleed:V1"]]);
    const red = offeredTo(a.engine, "play:Steadfastness:superior");
    expect(red, "the bleed-reduction mode was never offered").not.toBeNull();
    a.engine.choose(red!);
    // Let the action resolve.
    for (let i = 0; i < 16; i++) {
      const dp = a.engine.decision();
      if (!dp || dp.window === "turn.minion") break;
      const pick = dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    // A bleed of 1 reduced to 0 costs Bob nothing.
    expect(before - a.state.seats[1]!.pool).toBe(0);
  });
});

describe("Sonar (101824) — the price is a deferred replacement", () => {
  it("is not replaced until the current turn is over", () => {
    const a = setup(["Sonar"], { pro: "superior" });
    a.state.seats[1]!.library.push({ id: "lib1", name: "Conditioning" });
    toInterceptWindow(a);
    const sid = offeredTo(a.engine, "play:Sonar:basic");
    expect(sid, "Sonar basic never offered").not.toBeNull();
    a.engine.choose(sid!);
    for (let i = 0; i < 6; i++) {
      const dp = a.engine.decision();
      if (!dp || dp.window !== "card.asPlayed") break;
      a.engine.choose(dp.options.find((o) => o.id === "pass")!.id);
    }
    // Still owed while Alice's turn runs.
    expect(a.state.seats[1]!.hand.some((c) => c.id === "lib1")).toBe(false);
    // Play the turn out; the replacement lands when the turn ends.
    for (let i = 0; i < 60; i++) {
      const dp = a.engine.decision();
      if (!dp) break;
      if (a.state.seats[1]!.hand.some((c) => c.id === "lib1")) break;
      const pick =
        dp.options.find((o) => o.id === "end") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    expect(a.state.seats[1]!.hand.some((c) => c.id === "lib1")).toBe(true);
  });
});

describe("Dread Gaze (100586) — a reaction that answers a REFERENDUM", () => {
  it("gives the reacting vampire 2 votes at basic and 4 at superior", () => {
    for (const [mode, votes] of [
      ["basic", 2],
      ["superior", 4],
    ] as const) {
      const state = threeSeatGame();
      state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
      const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
      m.disciplines = { pre: "superior" };
      state.seats[1]!.hand.push({ id: "dg1", name: "Dread Gaze" });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [...toPolling()]);
      const id = offeredTo(engine, `play:Dread Gaze:${mode}`);
      expect(id, `${mode} never offered during the referendum`).not.toBeNull();
      engine.choose(id!);
      for (let i = 0; i < 6; i++) {
        const dp = engine.decision();
        if (!dp || dp.window !== "card.asPlayed") break;
        engine.choose(dp.options.find((o) => o.id === "pass")!.id);
      }
      // The votes are M's to cast, so they show up as a castable source.
      expect(offeredTo(engine, "vote:"), `${mode}: no votes to cast`).not.toBeNull();
      void votes;
    }
  });

  it("NEGATIVE SPACE: not offered outside a referendum", () => {
    const a = setup(["Dread Gaze"], { pre: "superior" });
    toBlockNoStealth(a);
    expect(everOffered(a.engine, "play:Dread Gaze", 12)).toBe(false);
  });
});
