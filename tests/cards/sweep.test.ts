/**
 * Scenario tests for the vocabulary sweep (docs/card-primitives.md §6).
 * Clone-shaped cards share data-driven harnesses; cards with riders get
 * focused tests. Every swept card appears in at least one assertion.
 */

import { describe, expect, it } from "vitest";
import type { DisciplineLevel, GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game(
  v1Disciplines: Record<string, DisciplineLevel>,
  aliceCards: string[],
  bobCards: string[] = [],
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.disciplines = v1Disciplines;
  aliceCards.forEach((name, i) =>
    state.seats[0]!.hand.push({ id: `ac${i}`, name }),
  );
  bobCards.forEach((name, i) => state.seats[1]!.hand.push({ id: `bc${i}`, name }));
  return { state, engine: new VtesEngine(state, testRegistry) };
}

describe("bleed modifiers (state C, after declines)", () => {
  const cases: Array<{
    card: string;
    pick: string;
    disc: Record<string, DisciplineLevel>;
    delta: number;
  }> = [
    { card: "Threats", pick: "play:Threats:basic", disc: { dom: "basic" }, delta: 1 },
    { card: "Threats", pick: "play:Threats:superior", disc: { dom: "superior" }, delta: 2 },
    { card: "Bonding", pick: "play:Bonding:basic", disc: { dom: "basic" }, delta: 1 },
    {
      card: "Subversion",
      pick: "play:Subversion:superior:V1:bleed",
      disc: { pre: "superior" },
      delta: 1,
    },
  ];
  for (const c of cases) {
    it(`${c.pick} adds +${c.delta} bleed`, () => {
      const { state, engine } = game(c.disc, [c.card]);
      runTrace(engine, [
        ["Alice", "bleed:V1"],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        ["Alice", c.pick],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
      ]);
      expect(state.seats[1]!.pool).toBe(10 - (1 + c.delta));
      expect(state.edge).toBe("Alice");
    });
  }
});

describe("stealth modifiers (only when a block is pending)", () => {
  const cases: Array<{
    card: string;
    pick: string;
    disc: Record<string, DisciplineLevel>;
    bleedDelta: number;
    cost: number;
  }> = [
    { card: "Earth Control", pick: "play:Earth Control:basic", disc: { pro: "basic" }, bleedDelta: 0, cost: 1 },
    { card: "Earth Control", pick: "play:Earth Control:superior", disc: { pro: "superior" }, bleedDelta: 0, cost: 1 },
    { card: "Subversion", pick: "play:Subversion:basic", disc: { cel: "basic" }, bleedDelta: 0, cost: 0 },
    // Superior Bonding: +1 stealth AND +1 bleed — legal only when stealth
    // is needed (rulings p. 47), which the pending block provides.
    { card: "Bonding", pick: "play:Bonding:superior", disc: { dom: "superior" }, bleedDelta: 1, cost: 0 },
  ];
  for (const c of cases) {
    it(`${c.pick} breaks the block and the bleed lands`, () => {
      const { state, engine } = game(c.disc, [c.card]);
      runTrace(engine, [
        ["Alice", "bleed:V1"],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        ["Alice", "pass"],
        ["Bob", "block:M"],
        ["Alice", c.pick],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        // Attempt failed (stealth > intercept) → state A → declines → C.
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
        ["Alice", "pass"],
        ["Bob", "pass"],
        ["Carol", "pass"],
      ]);
      expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
      expect(state.seats[1]!.pool).toBe(10 - (1 + c.bleedDelta));
      expect(state.seats[0]!.minions[0]!.blood).toBe(2 - c.cost);
      expect(state.seats[1]!.minions.find((m) => m.id === "M")!.locked).toBe(false);
    });
  }

  it("Forgotten Labyrinth: not during bleeds; +2 stealth on a hunt", () => {
    const { state, engine } = game({ obf: "basic" }, ["Forgotten Labyrinth"]);
    state.seats[0]!.minions[0]!.blood = 1; // pay 1 for the card, hunt after
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    // Hunt has stealth 1; give M intercept 1 (stand-in for a reaction) so
    // stealth becomes "needed".
    const af = engine.action()!;
    engine.emit({
      type: "InterceptModified",
      actionId: af.actionId,
      minion: "M",
      delta: 1,
      source: "test",
    });
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.options.some((o) => o.id.startsWith("play:Forgotten Labyrinth"))).toBe(true);
    runTrace(engine, [
      ["Alice", "play:Forgotten Labyrinth:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Stealth 3 vs intercept 1 → attempt fails; declines; resolve.
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
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    // Paid 1 for the card, gained 1 from the hunt.
    expect(state.seats[0]!.minions[0]!.blood).toBe(1);
  });

  it("Forgotten Labyrinth is not offered during a bleed's pending block", () => {
    const { engine } = game({ obf: "basic" }, ["Forgotten Labyrinth"]);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Forgotten Labyrinth"))).toBe(false);
  });
});

describe("wakes and reaction riders", () => {
  it("Wake with Evening's Freshness: wake → block; replacement waits for unlock", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    for (const m of bob.minions) m.locked = true;
    bob.hand.push({ id: "wef1", name: "Wake with Evening's Freshness" });
    bob.library.push({ id: "lib1", name: "Threats" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Wake with Evening's Freshness"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // No replacement drawn yet — it waits for Bob's unlock phase.
    expect(bob.delayedDraws).toBe(1);
    expect(bob.hand.find((c) => c.id === "lib1")).toBeUndefined();
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);

    // Play out the combat and Alice's remaining phases; Bob's unlock
    // delivers the card.
    runTrace(engine, [
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
      ["Alice", "end"],
      ["Alice", "pass"],
      ["Alice", "pass"],
    ]);
    const next = engine.decision()!;
    expect(next.seat).toBe("Bob");
    expect(bob.hand.find((c) => c.id === "lib1")).toBeDefined();
    expect(bob.delayedDraws).toBe(0);
  });

  it("Forced Awakening: waking without blocking burns 1 blood at resolution", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const w = bob.minions.find((m) => m.id === "W")!;
    w.locked = true;
    bob.minions.find((m) => m.id === "M")!.locked = true;
    bob.hand.push({ id: "fa1", name: "Forced Awakening" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Forced Awakening"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Awake but declines to block; the action resolves.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    expect(w.blood).toBe(2); // 3 - 1 penalty
    expect(state.seats[1]!.pool).toBe(9); // the bleed landed too
  });

  it("Telepathic Misdirection superior deflects and locks the reacting vampire", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    const w = bob.minions.find((m) => m.id === "W")!;
    w.disciplines = { aus: "superior" };
    bob.hand = [{ id: "tm1", name: "Telepathic Misdirection" }];
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Telepathic Misdirection:superior"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Carol", "pass"],
      ["Bob", "pass"],
    ]);

    expect(state.seats[2]!.pool).toBe(9);
    expect(state.seats[1]!.pool).toBe(10);
    expect(w.locked).toBe(true); // superior TM locks (unlike sup. Deflection)
    expect(w.blood).toBe(2); // paid 1
  });

  it("Elder Intervention (+2 intercept) catches a stealthed bleed; draw waits for the action's end", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pro: "basic" };
    v1.blood = 3;
    state.seats[0]!.hand.push({ id: "ec1", name: "Earth Control" });
    const bob = state.seats[1]!;
    bob.hand.push({ id: "ei1", name: "Elder Intervention" });
    bob.library.push({ id: "lib2", name: "Threats" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      // Pending success → Alice buys stealth; then intercept is needed
      // and Bob answers with Elder Intervention (played by blocker M).
      ["Alice", "play:Earth Control:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Elder Intervention"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Intercept 2 ≥ stealth 1 → blocked → combat.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "BlockSucceeded")).toBe(true);
    // Elder Intervention's replacement waits until after the action.
    expect(bob.hand.find((c) => c.id === "lib2")).toBeUndefined();

    runTrace(engine, [
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
    // Action resolved (blocked) → the deferred draw happened.
    expect(bob.hand.find((c) => c.id === "lib2")).toBeDefined();
  });
});

describe("swept action cards", () => {
  it("Scouting Mission superior fills a younger uncontrolled vampire (+2)", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.disciplines = { dom: "superior" };
    alice.hand.push({ id: "sm1", name: "Scouting Mission" });
    alice.uncontrolled.push({
      card: makeMinion("X", "Alice", { blood: 0, capacity: 3 }),
      counters: 0,
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Scouting Mission:superior"],
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
    expect(alice.uncontrolled[0]!.counters).toBe(2);
    expect(state.seats[1]!.pool).toBe(10); // undirected, nobody bled
  });

  it("Social Charm superior: +1 bleed and 1 pool on a successful bleed", () => {
    const { state, engine } = game({ pre: "superior" }, ["Social Charm"]);
    runTrace(engine, [
      ["Alice", "play:Social Charm:superior"],
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
    expect(state.seats[1]!.pool).toBe(8); // bled for 2
    expect(state.seats[0]!.pool).toBe(11); // gained 1
    expect(state.edge).toBe("Alice");
  });

  it("Public Trust superior: equal-capacity uncontrolled targets are allowed", () => {
    const { state, engine } = game({ pre: "superior" }, ["Public Trust"]);
    const alice = state.seats[0]!;
    alice.uncontrolled.push({
      card: makeMinion("Z", "Alice", { blood: 0, capacity: 5 }), // == V1's 5
      counters: 0,
    });
    runTrace(engine, [
      ["Alice", "play:Public Trust:superior"],
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
    expect(state.seats[1]!.pool).toBe(7); // bled for 3
    expect(alice.uncontrolled[0]!.counters).toBe(1);
    expect(alice.minions[0]!.blood).toBe(1); // paid 1 at resolution
  });

  it("Feast of the Soul's Secrets superior can feed a younger controlled vampire", () => {
    const { state, engine } = game({ dom: "superior" }, ["Feast of the Soul's Secrets"]);
    const alice = state.seats[0]!;
    alice.minions.push(makeMinion("V0", "Alice", { blood: 1, capacity: 3 }));
    runTrace(engine, [
      ["Alice", "play:Feast of the Soul's Secrets:superior:V1:V0"],
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
    expect(state.seats[1]!.pool).toBe(7); // bled for 3
    expect(alice.minions.find((m) => m.id === "V0")!.blood).toBe(3); // +2
    expect(alice.minions[0]!.blood).toBe(1); // paid 1
  });
});

describe("swept combat cards", () => {
  function toCombat(engine: VtesEngine): void {
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
  }

  it("Earth Meld basic: strike combat ends, free, no unlock", () => {
    const { state, engine } = game({ pro: "basic" }, ["Earth Meld"]);
    toCombat(engine);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "play:Earth Meld:basic"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
    expect(state.seats[0]!.minions[0]!.locked).toBe(true); // basic: no unlock
    expect(state.seats[0]!.minions[0]!.blood).toBe(2); // free
  });

  it("Indomitability superior: prevent 1 with an optional press → round two", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { for: "superior" };
    state.seats[1]!.hand.push({ id: "in1", name: "Indomitability" });
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 3;
    const engine = new VtesEngine(state, testRegistry);
    toCombat(engine);
    runTrace(engine, [
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
      // M prevents with the prevent-press variant → press credit.
      ["Bob", "play:Indomitability:superior:M:prevent-press"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Press: Alice declines; Bob spends the credit to continue; both
      // then decline (Alice cannot cancel — no press of her own).
      ["Alice", "pass"],
      ["Bob", "press:continue"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      // End of Round → round 2.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Round 2, plain.
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
    const ended = state.eventLog.find((e) => e.type === "CombatEnded")!;
    expect(ended).toMatchObject({ rounds: 2 });
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
    // M: round 1 prevented, round 2 mended 1 → blood 1; V1 mended twice.
    expect(m.blood).toBe(1);
    expect(v1.blood).toBe(1);
  });

  it("Flash basic (maneuver variant) sends the round to long range", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { cel: "basic" };
    state.seats[1]!.hand.push({ id: "fl1", name: "Flash" });
    const engine = new VtesEngine(state, testRegistry);
    toCombat(engine);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Flash:basic:M:maneuver"],
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
      ["Carol", "pass"],
    ]);
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
    expect(state.eventLog.filter((e) => e.type === "RangeSet").length).toBeGreaterThan(0);
  });
});
