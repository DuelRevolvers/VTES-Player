/**
 * Conditional-bonus modifiers (docs/one-off-sweep.md): "+N more if
 * <condition>" — Aire of Elation (+1 bleed if the vampire is Toreador) and
 * Protection Racket (+1 intercept if the acting minion is titled).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Aire of Elation (100031)", () => {
  function playAireBleed(clan: string | null): number {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "basic" };
    v1.clan = clan;
    v1.blood = 3;
    const bobStart = state.seats[1]!.pool;
    state.seats[0]!.hand.push({ id: "ae1", name: "Aire of Elation" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "play:Aire of Elation:basic:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve
    ]);
    return bobStart - state.seats[1]!.pool;
  }

  it("adds the Toreador bonus: base 1 + 1 + 1 = 3", () => {
    expect(playAireBleed("Toreador")).toBe(3);
  });

  it("omits the bonus for a non-Toreador: base 1 + 1 = 2", () => {
    expect(playAireBleed("Ventrue")).toBe(2);
  });
});

describe("Protection Racket (101501)", () => {
  function interceptDelta(actingTitled: boolean): number {
    const state = threeSeatGame();
    if (actingTitled) state.seats[0]!.minions[0]!.title = "prince";
    // Bob's blocker W is an Anarch able to play the reaction. A hunt gives
    // the acting vampire +1 inherent stealth, so intercept is "needed".
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.sect = "anarch";
    state.seats[1]!.hand.push({ id: "pr1", name: "Protection Racket" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A, Bob's impulse next
      ["Bob", "block:W"],
      ["Alice", "pass"], // state B
      ["Bob", "play:Protection Racket:basic:W"], // reaction: +intercept on W
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // resolve attempt
    ]);

    const ev = state.eventLog.find(
      (e) => e.type === "InterceptModified" && e.minion === "W",
    );
    return ev && ev.type === "InterceptModified" ? ev.delta : 0;
  }

  it("adds +2 intercept when the acting minion is titled", () => {
    expect(interceptDelta(true)).toBe(2);
  });

  it("adds only +1 intercept when the acting minion is untitled", () => {
    expect(interceptDelta(false)).toBe(1);
  });
});
