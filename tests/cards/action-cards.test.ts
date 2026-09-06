/**
 * Scenario tests for the action-card machinery and the three supported
 * action cards: Govern the Unaligned (100845), Intimidation (100999),
 * Enchant Kindred (100640). Covers: enhanced bleeds as real bleed
 * actions (Deflection interplay, bledThisTurn), deferred cost paid only
 * on success, card burn on both outcomes, the modal basic/superior
 * choice at announcement, and the superior uncontrolled-blood effect.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Govern the Unaligned (100845)", () => {
  it("basic: an enhanced bleed — cost at resolution, card burned, once per turn", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "g1", name: "Govern the Unaligned" });
    const v1 = state.seats[0]!.minions[0]!;
    const engine = new VtesEngine(state, testRegistry);

    // Both the basic bleed and the Govern announcement are offered.
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "bleed:V1")).toBe(true);
    expect(
      dp.options.some((o) => o.id.startsWith("play:Govern the Unaligned:basic")),
    ).toBe(true);
    // V1 has basic dom only — no superior mode, and no uncontrolled
    // vampires anyway.
    expect(
      dp.options.some((o) => o.id.startsWith("play:Govern the Unaligned:superior")),
    ).toBe(false);

    runTrace(engine, [
      ["Alice", "play:Govern the Unaligned:basic"],
      // The as-played (cancel) window around the announcement itself.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Now the action is announced: V1 locked, bleed 1+2 directed at Bob.
      // Announce window, then A (Bob declines), then C.
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

    expect(state.seats[1]!.pool).toBe(7); // bled for 3
    expect(state.edge).toBe("Alice");
    expect(v1.locked).toBe(true);
    expect(v1.blood).toBe(1); // Govern's cost, paid at resolution
    expect(v1.bledThisTurn).toBe(true); // an enhanced bleed IS a bleed
    expect(state.eventLog.some((e) => e.type === "CardBurned")).toBe(true);

    // Once per turn: another Govern would not be offered to V1 now (also
    // covered by bledThisTurn here; playedSinceUnlock enforces the named-
    // card rule even for non-bleed modes).
    expect(v1.playedSinceUnlock).toContain("Govern the Unaligned");
  });

  it("superior: +1 stealth undirected action that fills a younger uncontrolled vampire", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.hand.push({ id: "g2", name: "Govern the Unaligned" });
    bob.uncontrolled.push({
      card: makeMinion("Y", "Bob", { blood: 0, capacity: 4 }),
      counters: 0,
    });
    // Make it Bob's turn.
    const frame = state.frames[0]!;
    if (frame.kind !== "turn") throw new Error("fixture");
    frame.seat = "Bob";
    const w = bob.minions.find((m) => m.id === "W")!; // dom superior, cap 5
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Bob", "play:Govern the Unaligned:superior"],
      // as-played window (sequencing order: acting Bob, prey Carol,
      // predator Alice — undirected defaults).
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      // Announce window + state A (prey/predator may block at stealth 1)
      // + state C.
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
    ]);

    expect(bob.uncontrolled[0]!.counters).toBe(3);
    expect(w.locked).toBe(true);
    expect(w.blood).toBe(2); // paid 1 at resolution
    const stealth = state.eventLog.find((e) => e.type === "StealthModified")!;
    expect(stealth).toMatchObject({ delta: 1, source: "Govern the Unaligned" });
    // No pool was lost by anyone: the blood came from the bank.
    expect(state.seats.every((s) => s.pool === 10)).toBe(true);
  });

  it("a blocked Govern pays no cost and still burns the card", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "g3", name: "Govern the Unaligned" });
    const v1 = state.seats[0]!.minions[0]!;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Govern the Unaligned:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A: Bob blocks with M (0 intercept ≥ 0 stealth).
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Blocked → combat (hand strikes, both pass everything).
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // Blocked: no pool lost, no Edge, cost NOT paid (V1 lost 1 blood to
    // combat mending only), card still burned.
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.edge).toBeNull();
    expect(v1.blood).toBe(1); // 2 - 1 (mend); the Govern cost was never paid
    expect(state.eventLog.some((e) => e.type === "CardBurned")).toBe(true);
    const resolved = state.eventLog.find((e) => e.type === "ActionResolved")!;
    expect(resolved).toMatchObject({ success: false });
  });

  it("a Governed bleed can be Deflected — and Conditioning still stacks on top", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "g4", name: "Govern the Unaligned" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Govern the Unaligned:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State A: Bob declines (sticky), Carol not eligible.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // State C: Conditioning is legal — Govern's +2 is NOT "(limited)",
      // so the modifier's own limited increase is still allowed.
      ["Alice", "play:Conditioning"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Bob deflects the 5-point bleed to Carol.
      ["Alice", "pass"],
      ["Bob", "play:Deflection:superior"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Reopened blocking for Carol; she declines; resolve.
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
    ]);

    // 1 base + 2 Govern + 2 Conditioning = 5, eaten by Carol.
    expect(state.seats[2]!.pool).toBe(5);
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.edge).toBe("Alice");
  });
});

describe("Intimidation (100999) and Enchant Kindred (100640)", () => {
  it("Intimidation offers both modes to a superior Presence vampire", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "superior" };
    state.seats[0]!.hand.push({ id: "i1", name: "Intimidation" });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Intimidation:basic"))).toBe(true);
    expect(dp.options.some((o) => o.id.startsWith("play:Intimidation:superior"))).toBe(true);

    runTrace(engine, [
      ["Alice", "play:Intimidation:superior"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
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

    expect(state.seats[1]!.pool).toBe(7); // 1 + 2
    expect(v1.blood).toBe(2); // Intimidation is free
  });

  it("Enchant Kindred superior needs a younger uncontrolled vampire to be offered", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!; // capacity 5
    v1.disciplines = { pre: "superior" };
    state.seats[0]!.hand.push({ id: "e1", name: "Enchant Kindred" });
    const engine = new VtesEngine(state, testRegistry);

    // No uncontrolled vampires → superior mode has no legal target.
    let dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Enchant Kindred:basic"))).toBe(true);
    expect(dp.options.some((o) => o.id.startsWith("play:Enchant Kindred:superior"))).toBe(false);

    // An equal-capacity uncontrolled vampire is not "younger" either.
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("Z5", "Alice", { blood: 0, capacity: 5 }),
      counters: 0,
    });
    dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Enchant Kindred:superior"))).toBe(false);

    // A younger one unlocks it.
    state.seats[0]!.uncontrolled.push({
      card: makeMinion("Z3", "Alice", { blood: 0, capacity: 3 }),
      counters: 0,
    });
    dp = engine.decision()!;
    const superiorOpts = dp.options.filter((o) =>
      o.id.startsWith("play:Enchant Kindred:superior"),
    );
    expect(superiorOpts).toHaveLength(1); // Z3 only, not Z5
    const opt = superiorOpts[0]!;
    expect(opt.kind).toBe("playCard");
    if (opt.kind === "playCard") {
      expect(opt.params["target"]).toBe("Z3");
    }
  });
});
