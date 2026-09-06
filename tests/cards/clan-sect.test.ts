/**
 * Clan/sect tagging (docs/clan-sect-design.md): the "Requires a …"
 * gating, the clan/sect-locked stealth/intercept locations, and the two
 * sect-gated political actions.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"] };
}

/** play → as-played (3) → announce (3) → A (3) → C (3): a successful
 *  undirected political action, referendum next. */
function politicalTrace(prefix: string): Array<[string, string]> {
  return [
    ["Alice", prefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ];
}

describe("Backways (100126) — clan-locked stealth", () => {
  it("locks to give the acting Gangrel +1 stealth, foiling a block", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Gangrel";
    alice.permanents.push(loc("bw0", "Backways"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:M"], // 0 intercept vs 0 stealth → would succeed
      ["Alice", "ability:Backways"], // lock → V1 +1 stealth; rewinds
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → fails
      // Back to A: Bob declines further blocks.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → C
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    expect(alice.permanents[0]!.locked).toBe(true);
    expect(state.seats[1]!.pool).toBe(9); // bleed succeeded
  });

  it("does nothing for a non-Gangrel acting minion", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Ventrue"; // not Gangrel
    alice.permanents.push(loc("bw0", "Backways"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("ability:Backways"))).toBe(false);
  });
});

describe("Market Square (101171) — clan-locked intercept", () => {
  it("locks to give a blocking Banu Haqim +1 intercept, catching a stealthed hunt", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.minions.find((x) => x.id === "M")!.clan = "Banu Haqim";
    bob.permanents.push(loc("ms0", "Market Square"));
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "hunt:V1"], // +1 inherent stealth
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:M"], // 0 intercept vs 1 stealth → would fail
      ["Alice", "pass"], // acting seat is asked first in the block attempt
      ["Bob", "ability:Market Square"], // lock → M +1 intercept; rewinds
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → succeeds
      // Combat V1 vs M, one uneventful round.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(true);
    expect(bob.permanents[0]!.locked).toBe(true);
  });
});

describe("Empires Fall (102318) — Sabbat referendum", () => {
  it("requires a Sabbat vampire", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "ef1", name: "Empires Fall" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Empires Fall"))).toBe(false);

    state.seats[0]!.minions[0]!.sect = "sabbat";
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Empires Fall"))).toBe(true);
  });

  it("burns 1 pool per chosen Methuselah, +3 for a ready capacity-8 vampire", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.sect = "sabbat";
    state.seats[1]!.minions.find((x) => x.id === "W")!.capacity = 8; // Bob has a cap-8
    alice.hand.push({ id: "ef1", name: "Empires Fall" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...politicalTrace("play:Empires Fall"),
      ["Alice", "terms:Bob,Carol"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[1]!.pool).toBe(6); // 1 + 3 (cap-8 W)
    expect(state.seats[2]!.pool).toBe(9); // 1 (no cap-8)
  });
});

describe("Reckless Agitation (101567) — Anarch/Independent, capacity 5+", () => {
  it("requires the right sect and capacity", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 3;
    v1.sect = "anarch";
    v1.capacity = 4; // too small
    state.seats[0]!.hand.push({ id: "ra1", name: "Reckless Agitation" });
    const engine = new VtesEngine(state, testRegistry);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Reckless Agitation"))).toBe(false);

    v1.capacity = 5;
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Reckless Agitation"))).toBe(true);
  });

  it("allocates 6 among two or more OTHER Methuselahs (never the caller)", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 3;
    v1.sect = "independent";
    v1.capacity = 6;
    state.seats[0]!.hand.push({ id: "ra1", name: "Reckless Agitation" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...politicalTrace("play:Reckless Agitation")]);
    // Terms options must exclude Alice (the caller).
    const dp = engine.decision()!;
    expect(dp.window).toBe("referendum.terms");
    expect(dp.options.every((o) => !/Alice/.test(o.id))).toBe(true);

    runTrace(engine, [
      ["Alice", "terms:Bob=3,Carol=3"],
      ["Alice", "vote:caller:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    expect(state.seats[0]!.minions[0]!.blood).toBe(1); // paid the 2-blood cost
    expect(state.seats[1]!.pool).toBe(7); // 10 − 3
    expect(state.seats[2]!.pool).toBe(7); // 10 − 3
  });
});

describe("requirement gating (kernel)", () => {
  it("an ally never meets a sect requirement", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeMinion("AL", "Alice", { kind: "ally", blood: 2, capacity: 2, sect: null }),
    );
    alice.minions[0]!.sect = null; // V1 untagged either
    alice.hand.push({ id: "ef1", name: "Empires Fall" });
    const engine = new VtesEngine(state, testRegistry);
    // No Sabbat vampire → Empires Fall not offered to anyone.
    expect(engine.decision()!.options.some((o) => o.id.startsWith("play:Empires Fall"))).toBe(false);
  });
});
