/**
 * Wave 100 — bleed redirects (docs/bleed-redirects-design.md).
 *
 * Two Wrongs (102052), Contingency Planning (100419), Murmur of the False
 * Will (101256) — and what they found: "a card that changes the target of a
 * bleed" was a per-CARD flag where the question is per MODE, Narrow Minds'
 * "MINION cards" would have charged a master blood, and `youngerOnly` let an
 * ALLY count as "a younger vampire" (Redirection basic had it live).
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const ids = (engine: VtesEngine): string[] => engine.decision()!.options.map((o) => o.id);
const ash = (state: GameState, seat: number): string[] =>
  (state.seats[seat]!.ashHeap ?? []).map((c) => c.name);
const action = (state: GameState) => {
  const af = state.frames.find((f) => f.kind === "action");
  if (af?.kind !== "action") throw new Error("no action");
  return af;
};

/** Alice bleeds Bob with V1, every pass taken, up to Alice's modifier
 *  window in state C. */
const BLEED_TO_MODIFIER: Array<[string, string]> = [
  ["Alice", "bleed:V1"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
];

/** …then Bob's W Deflects it to Carol, and the passes up to Carol's own
 *  state-C window, where Two Wrongs is legal (Alice is not her predator). */
const DEFLECT_TO_CAROL: Array<[string, string]> = [
  ...BLEED_TO_MODIFIER,
  ["Alice", "pass"],
  ["Bob", "play:Deflection:superior:W:Carol:d1"],
  ["Alice", "pass"],
  ["Bob", "pass"],
  ["Carol", "pass"],
  ["Alice", "pass"],
  ["Carol", "pass"], // declines to block
  ["Bob", "pass"],
  ["Alice", "pass"],
];

const NARROW_MINDS: PermanentInPlay = {
  card: { id: "nm", name: "Narrow Minds" },
  locked: false,
  usedThisPhase: false,
  statics: { playCostMod: { amount: 1, pays: "bloodOrLife", redirectsBleed: true } },
  tags: ["event"],
};

describe("Two Wrongs (102052)", () => {
  it("sends a bleed from a non-predator on to the bleeder's prey, reopening blocks", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "tw", name: "Two Wrongs" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, DEFLECT_TO_CAROL);
    expect(ids(engine)).toContain("play:Two Wrongs:-:tw");
    runTrace(engine, [
      ["Carol", "play:Two Wrongs"],
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
    ]);
    // Alice's prey is Bob: the bleed is his again, and he may block (p. 26).
    expect(action(state).target).toBe("Bob");
    expect(ids(engine)).toEqual(["pass", "block:W", "block:M"]);
    expect(state.seats[2]!.outOfTurnMasterUsed).toBe(true);
    expect(ash(state, 2)).toEqual(["Two Wrongs"]);

    runTrace(engine, [
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.pool).toBe(9);
    expect(state.seats[2]!.pool).toBe(10);
  });

  it("is not offered against a bleed by your predator", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "tw", name: "Two Wrongs" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...BLEED_TO_MODIFIER, ["Alice", "pass"]]);
    // Bob's state-C window: Alice, his predator, is bleeding him.
    expect(ids(engine).some((id) => id.startsWith("play:Deflection"))).toBe(true);
    expect(ids(engine).some((id) => id.includes("Two Wrongs"))).toBe(false);
  });

  it("cancels the next card that would change the target — and ONLY that one", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "tw", name: "Two Wrongs" });
    // W has played Deflection this action (p. 16: not again), so M answers.
    state.seats[1]!.minions[1]!.disciplines = { dom: "superior" };
    state.seats[1]!.hand.push({ id: "d2", name: "Deflection" });
    state.seats[0]!.hand.push({ id: "mu", name: "Murmur of the False Will" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...DEFLECT_TO_CAROL,
      ["Carol", "play:Two Wrongs"],
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
      // Murmur's MODIFIER half bleeds; it does not redirect, so the shield
      // lets it through.
      ["Alice", "play:Murmur of the False Will:basic:V1"],
    ]);
    expect(action(state).redirectShield).toBe(true);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"], // declines to block
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Deflection:superior:M:Carol:d2"],
    ]);
    // Cancelled as it was pushed; nobody answered it.
    expect(action(state).redirectShield).toBe(false);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(action(state).target).toBe("Bob");
    expect(ash(state, 1)).toEqual(["Deflection", "Deflection"]);
  });

  it("is a master, so Narrow Minds' MINION-card tax does not reach it", () => {
    const state = threeSeatGame();
    state.seats[2]!.hand.push({ id: "tw", name: "Two Wrongs" });
    state.seats[2]!.permanents.push(NARROW_MINDS);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, DEFLECT_TO_CAROL);
    runTrace(engine, [["Carol", "play:Two Wrongs"]]);
    expect(state.seats[2]!.pool).toBe(10);
    expect(state.seats[2]!.minions[0]!.blood).toBe(2);
  });
});

describe("Contingency Planning (100419)", () => {
  /** Alice bleeds for 3 (Conditioning) and Bob Deflects it to Carol. */
  const BLEED_THEN_DEFLECT: Array<[string, string]> = [
    ...BLEED_TO_MODIFIER,
    ["Alice", "play:Conditioning"],
    ["Alice", "pass"],
    ["Bob", "pass"],
    ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "play:Deflection:superior:W:Carol:d1"],
  ];

  it("cancels a redirect on your own turn, with no cost paid, and caps the bleed at 1", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "cp", name: "Contingency Planning" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, BLEED_THEN_DEFLECT);
    expect(ids(engine)).toEqual(["pass", "play:Contingency Planning:-:cp"]);
    runTrace(engine, [
      ["Alice", "play:Contingency Planning"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    // The bleed of 3 stayed on Bob and burned 1; Carol untouched.
    expect(state.seats[1]!.pool).toBe(9);
    expect(state.seats[2]!.pool).toBe(10);
    expect(state.seats[0]!.pool).toBe(9); // the card's own 1 pool
    expect(state.edge).toBe("Alice");
    expect(state.seats[0]!.outOfTurnMasterUsed).toBe(true);
    expect(ash(state, 1)).toEqual(["Deflection"]);
    expect(ash(state, 0)).toEqual(["Conditioning", "Contingency Planning"]);
  });

  it("answers only a redirect, and only for the bleeder's controller", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "cp", name: "Contingency Planning" });
    state.seats[2]!.hand.push({ id: "cp2", name: "Contingency Planning" });
    const engine = new VtesEngine(state, testRegistry);

    // Conditioning's own as-played window: not a card that redirects.
    runTrace(engine, [...BLEED_TO_MODIFIER, ["Alice", "play:Conditioning"]]);
    expect(ids(engine)).toEqual(["pass"]);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Deflection:superior:W:Carol:d1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    // Carol controls no minion that is bleeding.
    expect(ids(engine)).toEqual(["pass"]);
  });

  it("does not answer Murmur of the False Will played as a MODIFIER", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push(
      { id: "mu", name: "Murmur of the False Will" },
      { id: "cp", name: "Contingency Planning" },
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...BLEED_TO_MODIFIER, ["Alice", "play:Murmur of the False Will:basic:V1"]]);
    expect(ids(engine)).toEqual(["pass"]);
  });
});

describe("Murmur of the False Will (101256)", () => {
  it("[dom] is +1 bleed for the acting minion, and never a reaction", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "mu", name: "Murmur of the False Will" });
    state.seats[1]!.hand.push({ id: "mu2", name: "Murmur of the False Will" });
    state.seats[0]!.minions[0]!.capacity = 3; // younger than W
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, BLEED_TO_MODIFIER);
    expect(ids(engine)).toContain("play:Murmur of the False Will:basic:V1:mu");
    expect(ids(engine).some((id) => id.includes(":superior:V1:"))).toBe(false);
    runTrace(engine, [
      ["Alice", "play:Murmur of the False Will:basic:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    // Bob's W: only the REACTION half (a younger vampire bleeds him).
    expect(ids(engine)).toContain("play:Murmur of the False Will:superior:W:Carol:mu2");
    expect(ids(engine).some((id) => id.startsWith("play:Murmur of the False Will:basic"))).toBe(
      false,
    );
    runTrace(engine, [
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.seats[1]!.pool).toBe(8);
  });

  it("[DOM] locks the reactor and sends a younger vampire's bleed elsewhere", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "mu", name: "Murmur of the False Will" });
    state.seats[0]!.minions[0]!.capacity = 3;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "pass"],
      ["Bob", "play:Murmur of the False Will:superior:W:Carol"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(action(state).target).toBe("Carol");
    expect(state.seats[1]!.minions[0]!.locked).toBe(true);
  });

  it("[DOM] is not offered against a vampire of the same age", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "mu", name: "Murmur of the False Will" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [...BLEED_TO_MODIFIER, ["Alice", "pass"]]);
    expect(ids(engine).some((id) => id.startsWith("play:Deflection"))).toBe(true);
    expect(ids(engine).some((id) => id.includes("Murmur"))).toBe(false);
  });

  it("an ALLY is not 'a younger vampire' — for Murmur, and for Redirection basic", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("A1", "Alice", { kind: "ally", capacity: 0 }));
    state.seats[1]!.hand.push(
      { id: "mu", name: "Murmur of the False Will" },
      { id: "rd", name: "Redirection" },
    );
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:A1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    // Redirection superior has no age clause — the positive control.
    expect(ids(engine)).toContain("play:Redirection:superior:W:Carol:rd");
    expect(ids(engine).some((id) => id.startsWith("play:Redirection:basic"))).toBe(false);
    expect(ids(engine).some((id) => id.includes("Murmur"))).toBe(false);
  });

  it("under Narrow Minds, only the REDIRECT half pays the tax", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "mu", name: "Murmur of the False Will" });
    state.seats[0]!.hand.push({ id: "mu0", name: "Murmur of the False Will" });
    state.seats[0]!.minions[0]!.capacity = 3;
    state.seats[0]!.minions[0]!.blood = 2;
    state.seats[2]!.permanents.push(NARROW_MINDS);
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ...BLEED_TO_MODIFIER,
      ["Alice", "play:Murmur of the False Will:basic:V1"],
    ]);
    expect(state.seats[0]!.minions[0]!.blood).toBe(2);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Murmur of the False Will:superior:W:Carol"],
    ]);
    expect(state.seats[1]!.minions[0]!.blood).toBe(2); // 3 − Narrow Minds' 1
  });
});
