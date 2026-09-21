/**
 * WHAT A VAMPIRE IN TORPOR MAY AND MAY NOT DO (p. 34, p. 24).
 *
 * "A vampire in torpor can perform no action except the leave torpor
 * action and cannot block or play reaction cards. They can play action
 * modifiers during their actions."
 *
 * Three of those four clauses are enforced by two predicates in
 * `state.ts` — `canAct` and `canReact`, both of which start at
 * `isReady` — and the fourth by `modeRole(mode) !== "modifier"` skipping
 * the react gate in the card enumerator. That is the right shape, and it
 * is exactly the shape that no test would notice breaking: every one of
 * these assertions is a NEGATIVE, and an option list that is empty
 * because the rule holds looks identical to one that is empty because the
 * fixture never offered anything. So each negative here is paired with
 * the positive that proves the fixture can produce the option at all —
 * a ready vampire beside the torpid one, with the same blood and the same
 * Disciplines.
 *
 * Written after an owner report that a torpor vampire was being offered
 * rescues and diableries. It was not: the engine had these rules right,
 * and the table was drawing every option that NAMED the torpor vampire on
 * its card, including the ones somebody else's ready vampire would
 * perform (`actionsByTableCard`, fixed in the same pass). These tests pin
 * the engine side so the next such report can be answered from the suite.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function inPlay(
  id: string,
  name: string,
  extra: Partial<PermanentInPlay> = {},
): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [name], ...extra };
}

describe("a vampire in torpor (p. 34)", () => {
  /**
   * Alice holds T1 in torpor and V2 ready — same blood, same everything
   * — so every "T1 is not offered X" below has a live "V2 is" beside it.
   */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions.push(
      makeMinion("T1", "Alice", { inTorpor: true, blood: 3 }),
      makeMinion("V2", "Alice", { blood: 3 }),
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("can perform NO action except leave torpor", () => {
    const { engine } = game();
    const ids = engine.decision()!.options.map((o) => o.id);

    // The positive control: the ready vampire beside it gets the lot.
    expect(ids).toContain("bleed:V2");
    expect(ids).toContain("hunt:V2");
    expect(ids).toContain("diablerize:V2:T1");
    expect(ids.some((id) => id.startsWith("rescue:V2:T1:"))).toBe(true);

    // The one action it may take…
    expect(ids).toContain("leave:T1");
    // …and nothing else, whoever the action would be aimed at. Read as
    // "every option naming T1 as the ACTOR", so a new basic action added
    // later is caught rather than needing a line here.
    const asActor = engine
      .decision()!
      .options.filter((o) => o.kind === "takeAction" && o.minion === "T1")
      .map((o) => o.id);
    expect(asActor).toEqual(["leave:T1"]);
  });

  it("cannot rescue or diablerise — not even the other vampire in torpor", () => {
    const { state, engine } = game();
    // A second torpid vampire, so "no target" cannot be the reason.
    state.seats[0]!.minions.push(makeMinion("T3", "Alice", { inTorpor: true, blood: 3 }));
    const ids = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    // The fixture CAN produce both actions against T3 — V2 is offered them.
    expect(ids).toContain("diablerize:V2:T3");
    expect(ids.some((id) => id.startsWith("rescue:V2:T3:"))).toBe(true);
    // T1 is offered neither, against T3 or against anybody.
    expect(ids.some((id) => id.startsWith("diablerize:T1:"))).toBe(false);
    expect(ids.some((id) => id.startsWith("rescue:T1:"))).toBe(false);
    void engine;
  });

  it("cannot block, and cannot play a reaction card", () => {
    const state = threeSeatGame();
    // Bob's W is ready with superior Dominate and holds Deflection (the
    // stock fixture); T2 is the same vampire in torpor.
    state.seats[1]!.minions.push(
      makeMinion("T2", "Bob", { inTorpor: true, blood: 3, disciplines: { dom: "superior" } }),
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A opens with the acting Methuselah (p. 8)
    ]);

    // State A — blocks. Bob's two ready minions are offered; T2 is not.
    const blocks = engine.decision()!.options.map((o) => o.id);
    expect(blocks).toContain("block:W");
    expect(blocks).toContain("block:M");
    expect(blocks).not.toContain("block:T2");

    // State C — reactions. Deflection is offered to W and to nobody else,
    // though T2 has the identical Dominate and the identical blood.
    runTrace(engine, [
      ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const reactions = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("play:Deflection"))
      .map((o) => o.id);
    expect(reactions.length).toBeGreaterThan(0);
    expect(reactions.every((id) => id.includes(":W:"))).toBe(true);
    expect(reactions.some((id) => id.includes(":T2:"))).toBe(false);
  });

  it("CAN play an action modifier during its own leave-torpor action", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeMinion("T1", "Alice", { inTorpor: true, blood: 3, disciplines: { obf: "basic" } }),
    );
    state.seats[0]!.hand.push({ id: "lic", name: "Lost in Crowds" });
    // p. 26: stealth is offered only when it is NEEDED, so the blocker
    // has to have intercept to match — otherwise the option is missing
    // for a reason that has nothing to do with torpor.
    find(state, "W").attached.push(inPlay("spy", "Raven Spy", { statics: { intercept: 1 } }));

    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "leave:T1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
    ]);
    // The acting minion IS the vampire in torpor, and the modifier is its
    // to play (p. 34) — the reaction gate must not reach a modifier mode.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id === "play:Lost in Crowds:basic:T1:lic")).toBe(true);
  });
});
