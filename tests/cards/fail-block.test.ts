/**
 * "That block attempt fails and the blocking minion cannot attempt to
 * block this action again" (docs/fail-block-design.md) — the acting
 * minion breaking a block already underway, and its softer sibling "the
 * blocking minion gets −1 intercept". Elder Impersonation (100617),
 * Relentlessness (102337), Forced Confessional (102250), Stygian Shroud
 * (102282) and Dominant Personality (102316).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 with the given disciplines, holding `card`; Bob has M and W. */
function game(disc: Record<string, "basic" | "superior">, card: string): GameState {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { disciplines: disc, blood: 4 });
  state.seats[0]!.hand.push({ id: "c", name: card });
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bleed, and M attempts the block; the impulse is back on Alice. */
function upToBlockAttempt(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"],
    ["Bob", "block:M"],
  ]);
}

describe("Elder Impersonation (100617)", () => {
  it("fails the block attempt at superior, and bars that minion from trying again", () => {
    const state = game({ obf: "superior" }, "Elder Impersonation");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);

    runTrace(engine, [
      ["Alice", "play:Elder Impersonation:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt cycle
      ["Alice", "pass"], // the impulse returns to the acting seat first
    ]);

    // The action is live again, and M is out of it — but Bob's other
    // vampire may still try (p. 25: the Methuselah may attempt again).
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:M")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:W")).toBe(true);
    expect(find(state, "M").locked).toBe(false); // a failed block does not lock
  });

  it("is a plain stealth modifier at inferior", () => {
    const state = game({ obf: "basic" }, "Elder Impersonation");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "play:Elder Impersonation:basic:V1:c")).toBe(true);
    // The superior mode is not on offer without the superior discipline.
    expect(dp.options.some((o) => o.id.includes(":superior:"))).toBe(false);
  });

  it("is not on offer with no block attempt underway", () => {
    const state = game({ obf: "superior" }, "Elder Impersonation");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ]);

    expect(
      engine.decision()!.options.some((o) => o.id.includes("Elder Impersonation")),
    ).toBe(false);
  });
});

describe("Relentlessness (102337)", () => {
  it("works off either discipline", () => {
    for (const disc of ["cel", "for"] as const) {
      const state = game({ [disc]: "superior" }, "Relentlessness");
      const engine = new VtesEngine(state, testRegistry);
      upToBlockAttempt(engine);

      runTrace(engine, [
        ["Alice", "play:Relentlessness:superior"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ]);

      expect(engine.decision()!.options.some((o) => o.id === "block:M")).toBe(false);
    }
  });
});

describe("Forced Confessional (102250)", () => {
  it("pushes the blocker's intercept down at inferior", () => {
    const state = game({ dom: "basic" }, "Forced Confessional");
    // M needs intercept for the option to be "needed" (p. 26): give the
    // action stealth so the block would otherwise still succeed.
    find(state, "M").attached.push({
      card: { id: "scope", name: "Scope" },
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 2 },
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);

    runTrace(engine, [
      ["Alice", "play:Forced Confessional:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
    ]);

    // Intercept 2 − 1 = 1 still beats stealth 0, so the block lands and
    // the combat begins — the point is that the modifier applied at all.
    const ev = state.eventLog.filter((x) => x.type === "InterceptModified");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ minion: "M", delta: -1 });
  });
});

describe("Stygian Shroud (102282)", () => {
  it("charges 1 blood on top of the card to fail the block", () => {
    const state = game({ obl: "superior" }, "Stygian Shroud");
    find(state, "V1").blood = 2;
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);

    runTrace(engine, [
      ["Alice", "play:Stygian Shroud:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(find(state, "V1").blood).toBe(1); // the card is free; the clause is not
    expect(engine.decision()!.options.some((o) => o.id === "block:M")).toBe(false);
  });

  it("is not offered when the vampire cannot pay the blood", () => {
    const state = game({ obl: "superior" }, "Stygian Shroud");
    // A vampire with no blood must hunt (p. 21), so the action here is a
    // hunt rather than a bleed.
    find(state, "V1").blood = 0;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt cycle start
    ]);

    expect(
      engine.decision()!.options.some((o) => o.id.includes("Stygian Shroud:superior")),
    ).toBe(false);
  });
});

describe("Dominant Personality (102316)", () => {
  it("names a vampire that cannot block, before any attempt", () => {
    const state = game({ pot: "superior" }, "Dominant Personality");
    state.seats[1]!.minions.push(makeMinion("W2", "Bob"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "play:Dominant Personality:superior:V1:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:M")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:W")).toBe(true);
  });

  it("is not offered once a block attempt is underway", () => {
    const state = game({ pot: "superior" }, "Dominant Personality");
    const engine = new VtesEngine(state, testRegistry);
    upToBlockAttempt(engine);

    expect(
      engine.decision()!.options.some((o) => o.id.includes("Dominant Personality:superior")),
    ).toBe(false);
  });
});
