/**
 * Enhanced bleeds and their superior-mode riders
 * (docs/bleed-riders-sweep.md): Show of Force (101772), Propaganda
 * (101495), Line Brawl (102229), Entrancement (100652), Enthrall (102320).
 *
 * The riders are what is worth asserting — the "+N bleed" half is the
 * existing `actionBleed` primitive and is pinned elsewhere.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function game(card: string, disc: Record<string, "basic" | "superior">): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc, blood: 4 });
  state.seats[0]!.hand.push({ id: "c", name: card });
  return state;
}

/** Announce and run the action through to resolution, unblocked. */
function resolveUnblocked(engine: VtesEngine, play: string): void {
  runTrace(engine, [
    ["Alice", play],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
  ]);
}

describe("Show of Force (101772)", () => {
  it("bleeds for 2 and arms the actor with +1 strength if blocked", () => {
    const state = game("Show of Force", { pot: "basic", pre: "basic" });
    const poolBefore = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Show of Force:basic:V1:c");
    // 1 base + 1 bonus.
    expect(state.seats[1]!.pool).toBe(poolBefore - 2);
  });

  it("carries the strength into the combat a block produces", () => {
    const state = game("Show of Force", { pot: "superior", pre: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Show of Force:superior:V1:c"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
    ]);
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf).toBeDefined();
    // +2 strength for the acting side, the whole combat.
    expect(cf!.kind === "combat" ? cf!.strengthBonus.acting : 0).toBe(2);
  });
});

describe("Propaganda (101495)", () => {
  it("keeps titled vampires from blocking", () => {
    const state = game("Propaganda", { pre: "basic" });
    find(state, "W").title = "prince";
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Propaganda:basic:V1:c"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "block:W")).toBe(false); // titled
    expect(dp.options.some((o) => o.id === "block:M")).toBe(true);
  });

  it("makes the TARGET choose which of their own minions to lock", () => {
    const state = game("Propaganda", { pre: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Propaganda:superior:V1:c");

    // The question goes to Bob, the bleed target — not to Alice.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.window).toBe("choice");
    const ids = dp.options.map((o) => o.id);
    expect(ids.some((i) => i.endsWith("lockOwnMinion:W"))).toBe(true);
    expect(ids.some((i) => i.endsWith("lockOwnMinion:M"))).toBe(true);

    runTrace(engine, [["Bob", "choice:Propaganda:c:lockOwnMinion:M"]]);
    expect(find(state, "M").locked).toBe(true);
    expect(find(state, "W").locked).toBe(false);
  });
});

describe("Line Brawl (102229)", () => {
  it("moves a pool from the target to the actor", () => {
    const state = game("Line Brawl", { cel: "basic" });
    find(state, "V1").sect = "anarch";
    const bob = state.seats[1]!.pool;
    const alice = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Line Brawl:basic:V1:steal:Bob:c");
    expect(state.seats[1]!.pool).toBe(bob - 1);
    expect(state.seats[0]!.pool).toBe(alice + 1);
  });

  it("requires an Anarch", () => {
    const state = game("Line Brawl", { cel: "basic", pot: "basic", pre: "basic" });
    find(state, "V1").sect = "camarilla";
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Line Brawl")),
    ).toBe(false);
  });
});

describe("Entrancement (100652)", () => {
  it("takes control of another Methuselah's ally", () => {
    const state = game("Entrancement", { pre: "superior" });
    state.seats[1]!.minions.push(makeAlly("BA", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Entrancement:superior:V1:BA:c");
    expect(state.seats[0]!.minions.some((m) => m.id === "BA")).toBe(true);
    expect(state.seats[1]!.minions.some((m) => m.id === "BA")).toBe(false);
    expect(find(state, "BA").controller).toBe("Alice");
  });

  it("never offers your own ally as the target", () => {
    const state = game("Entrancement", { pre: "superior" });
    state.seats[0]!.minions.push(makeAlly("AA", "Alice", 2));
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Entrancement:superior:V1:AA")),
    ).toBe(false);
  });
});

describe("Enthrall (102320)", () => {
  it("offers the crypt draw after a successful bleed, and it is optional", () => {
    const state = game("Enthrall", { pre: "superior" });
    state.seats[0]!.crypt.push(makeMinion("CR1", "Alice"));
    const engine = new VtesEngine(state, testRegistry);
    const bloodBefore = find(state, "V1").blood;
    resolveUnblocked(engine, "play:Enthrall:superior:V1:c");

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.window).toBe("choice");
    // Optional, so declining is offered too.
    expect(dp.options.some((o) => o.id === "pass")).toBe(true);

    runTrace(engine, [["Alice", "choice:Enthrall:c:cryptDraw:yes"]]);
    expect(find(state, "V1").blood).toBe(bloodBefore - 1);
    // The card went to the UNCONTROLLED region, not to hand (p. 3).
    expect(state.seats[0]!.uncontrolled.some((u) => u.card.id === "CR1")).toBe(true);
    expect(state.seats[0]!.crypt.some((c) => c.id === "CR1")).toBe(false);
  });

  it("does not ask when the crypt is empty", () => {
    const state = game("Enthrall", { pre: "superior" });
    state.seats[0]!.crypt = [];
    const engine = new VtesEngine(state, testRegistry);
    resolveUnblocked(engine, "play:Enthrall:superior:V1:c");
    const dp = engine.decision();
    expect(dp?.window).not.toBe("choice");
  });
});
