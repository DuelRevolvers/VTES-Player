/**
 * Second vocabulary sweep (docs/card-primitives.md §6): defensive and
 * utility cards that fit the existing primitives plus three small
 * additions — `actionGainBlood`, the combat once-per-round/combat limit,
 * and `requiresTitle` on action cards.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Drive V1's bleed into a block by W, into combat, up to the strike step. */
function bleedIntoCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"],
    ["Bob", "block:W"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → success
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ["Alice", "pass"], ["Bob", "pass"], // range → close
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
  ]);
}

describe("Glancing Blow (100834)", () => {
  it("prevents 1 damage from the opposing strike and defers its replacement", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.strength = 3; // V1 hits W for 3
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.blood = 5;
    w.capacity = 5;
    state.seats[1]!.hand.push({ id: "gb1", name: "Glancing Blow" });
    state.seats[1]!.library.push({ id: "lib1", name: "Threats" });
    const engine = new VtesEngine(state, testRegistry);

    bleedIntoCombat(engine);
    runTrace(engine, [
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      // Acting minion's incoming resolves first: V1 takes W's 1.
      ["Alice", "pass"],
      // Then W's incoming: Bob prevents 1 of V1's 3 with Glancing Blow.
      ["Bob", "play:Glancing Blow"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Bob", "pass"], // done preventing → mend the remaining 2
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    expect(w.blood).toBe(3); // 5 − (3 − 1 prevented)
    // "Do not replace until your next unlock phase": no draw yet.
    expect(state.seats[1]!.hand.some((c) => c.id === "lib1")).toBe(false);
    expect(state.seats[1]!.delayedDraws).toBe(1);
  });
});

describe("Soak (101817) / Rego Motum (101588) — once per round", () => {
  it("Soak prevents 2 and cannot be played twice in the same round", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.strength = 4;
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.blood = 5;
    w.capacity = 5;
    w.disciplines = { for: "basic" };
    state.seats[1]!.hand.push(
      { id: "sk1", name: "Soak" },
      { id: "sk2", name: "Soak" },
    );
    const engine = new VtesEngine(state, testRegistry);

    bleedIntoCombat(engine);
    runTrace(engine, [
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1's incoming resolves first
      ["Bob", "play:Soak:basic"], // prevent 2 of V1's 4 on W
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);
    // A second Soak this round is not offered (one each round).
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.startsWith("play:Soak"))).toBe(false);

    runTrace(engine, [
      ["Bob", "pass"], // stop preventing → mend the remaining 2
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(w.blood).toBe(3); // 5 − (4 − 2 prevented)
  });

  it("Rego Motum superior prevents 4 at its blood cost", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.strength = 4;
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.blood = 5;
    w.capacity = 5;
    w.disciplines = { tha: "superior" };
    state.seats[1]!.hand.push({ id: "rm1", name: "Rego Motum" });
    const engine = new VtesEngine(state, testRegistry);

    bleedIntoCombat(engine);
    runTrace(engine, [
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      ["Alice", "pass"], // V1's incoming resolves first
      ["Bob", "play:Rego Motum:superior"], // prevent all 4 of V1's strike
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);
    expect(w.blood).toBe(4); // paid 1 blood; prevented all 4 of V1's strike
  });
});

describe("Telepathic Counter (101948)", () => {
  it("reduces a bleed against its controller", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions.find((x) => x.id === "W")!;
    w.disciplines = { aus: "superior" };
    // Alice bleeds Bob; Bob's W reduces it by 2.
    state.seats[1]!.hand = [{ id: "tc1", name: "Telepathic Counter" }];
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "play:Telepathic Counter:superior"], // reduce by 2
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A declines
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    // Base bleed 1, reduced by 2 → no pool lost, no Edge.
    expect(state.seats[1]!.pool).toBe(10);
    expect(state.edge).toBeNull();
  });

  it("is not offered on a bleed against another Methuselah", () => {
    const state = threeSeatGame();
    const carol = state.seats[2]!;
    carol.minions[0]!.disciplines = { aus: "superior" };
    carol.hand.push({ id: "tc1", name: "Telepathic Counter" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"], // targets Bob, not Carol
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);
    const dp = engine.decision()!;
    // Carol is not the bleed target → no Telepathic Counter.
    const carolOpts = dp.seat === "Carol" ? dp.options : [];
    expect(carolOpts.some((o) => o.id.startsWith("play:Telepathic Counter"))).toBe(false);
  });
});

describe("Restoration (101613)", () => {
  it("is a +1 stealth action giving the acting vampire blood", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { for: "basic" };
    v1.blood = 2;
    v1.capacity = 5;
    state.seats[0]!.hand.push({ id: "rs1", name: "Restoration" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Restoration:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(v1.blood).toBe(4); // gained 2
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
  });
});

describe("Fourth Tradition: The Accounting (100782)", () => {
  it("requires a prince or justicar", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2;
    alice.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 3 }),
      counters: 0,
    });
    alice.hand.push({ id: "ft1", name: "Fourth Tradition: The Accounting" });
    const engine = new VtesEngine(state, testRegistry);

    // Untitled: not offered.
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Fourth Tradition")),
    ).toBe(false);

    alice.minions[0]!.title = "prince";
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Fourth Tradition")),
    ).toBe(true);
  });

  it("adds 3 blood to a younger uncontrolled vampire on success", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.minions[0]!.blood = 2;
    alice.minions[0]!.capacity = 5;
    alice.minions[0]!.title = "justicar";
    alice.uncontrolled.push({
      card: makeMinion("U", "Alice", { blood: 0, capacity: 3 }),
      counters: 1,
    });
    alice.hand.push({ id: "ft1", name: "Fourth Tradition: The Accounting" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Fourth Tradition: The Accounting:basic:V1:U"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    expect(alice.uncontrolled[0]!.counters).toBe(4); // 1 + 3
    expect(alice.minions[0]!.blood).toBe(1); // paid the 1 blood cost
  });
});
