/**
 * Actor-side combat riders (docs/actor-riders-design.md) — "if this action
 * is blocked, the ACTING minion gets X in the resulting combat", the mirror
 * of the blockerCombatRider cluster. Beast Meld (100146), Invigorate
 * (102251) and Obedient Flesh (102255).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function game(disc: Record<string, "basic" | "superior">, card: string): GameState {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { disciplines: disc, blood: 6 });
  state.seats[0]!.hand.push({ id: "c", name: card });
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bleed, run the announce cycle out; impulse on Alice in state A. */
function upToEffects(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

function playAndSettle(engine: VtesEngine, optionId: string): void {
  runTrace(engine, [
    ["Alice", optionId],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"],
  ]);
}

describe("Beast Meld (100146)", () => {
  it("gives the actor a prevention credit in the combat a block produces", () => {
    const state = game({ ani: "basic", pro: "basic" }, "Beast Meld");
    // M will block and hit V1 for 1; the credit should absorb it. It needs
    // intercept to get through the card's own +1 stealth.
    const m = find(state, "M");
    m.strength = 1;
    m.attached.push({
      card: { id: "scope", name: "Scope" },
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 2 },
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Beast Meld:basic");

    const bloodBefore = find(state, "V1").blood;
    runTrace(engine, [
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // combat before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
    ]);

    // V1 is taking damage and holds the credit.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const credit = dp.options.find((o) => o.id === "prevent:credit");
    expect(credit).toBeDefined();
    expect(credit!.label).toContain("1 left");

    runTrace(engine, [["Alice", "prevent:credit"]]);
    // Fully prevented, so no blood was burned to mend it.
    expect(find(state, "V1").blood).toBe(bloodBefore);
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
    // And the credit is spent — it is not offered a second time.
    expect(
      engine.decision()!.options.some((o) => o.id === "prevent:credit"),
    ).toBe(false);
  });

  it("keeps vampires out of the way at superior, on a non-bleed action", () => {
    const state = game({ ani: "superior", pro: "superior" }, "Beast Meld");
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 3));
    const engine = new VtesEngine(state, testRegistry);
    // A hunt is a non-bleed action, which is what the superior mode needs.
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    playAndSettle(engine, "play:Beast Meld:superior");

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "block:M")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:W")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:A")).toBe(true); // an ally may
  });

  it("does not offer the superior mode during a bleed", () => {
    const state = game({ ani: "superior", pro: "superior" }, "Beast Meld");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Beast Meld:superior")),
    ).toBe(false);
  });
});

describe("Invigorate (102251)", () => {
  it("requires an Anarch", () => {
    const state = game({ ani: "basic" }, "Invigorate");
    find(state, "V1").sect = "camarilla";
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Invigorate")),
    ).toBe(false);
  });

  it("adds the actor's strength for the resulting combat at [ani]", () => {
    const state = game({ ani: "basic" }, "Invigorate");
    find(state, "V1").sect = "anarch";
    find(state, "V1").strength = 1;
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Invigorate:basic:V1:strength");

    const before = find(state, "M").blood;
    runTrace(engine, [
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
      // The acting minion's damage resolves first (p. 29), so Alice is
      // asked about V1's before Bob is asked about M's.
      ["Alice", "pass"],
      ["Bob", "pass"],
    ]);
    // Strength 1 + 1 = 2 damage, all mended from M's blood.
    expect(before - find(state, "M").blood).toBe(2);
  });

  it("keeps allies from blocking at [dom]", () => {
    const state = game({ dom: "basic" }, "Invigorate");
    find(state, "V1").sect = "anarch";
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 3));
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Invigorate:basic:V1:noallies");

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "block:A")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:M")).toBe(true);
  });

  it("makes the actor's hand strikes aggravated at [pro]", () => {
    const state = game({ pro: "basic" }, "Invigorate");
    find(state, "V1").sect = "anarch";
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Invigorate:basic:V1:aggravated");

    runTrace(engine, [
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"],
    ]);
    const dmg = state.eventLog.filter(
      (e) => e.type === "DamageInflicted" && e.minion === "M",
    );
    expect(dmg).toHaveLength(1);
    expect(dmg[0]).toMatchObject({ aggravated: true });
  });

  it("offers only the modes whose discipline the vampire has", () => {
    const state = game({ ani: "basic", pro: "basic" }, "Invigorate");
    find(state, "V1").sect = "anarch";
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("Invigorate:basic:V1:strength"))).toBe(true);
    expect(ids.some((i) => i.includes("Invigorate:basic:V1:aggravated"))).toBe(true);
    expect(ids.some((i) => i.includes("Invigorate:basic:V1:noallies"))).toBe(false);
  });
});

describe("Obedient Flesh (102255)", () => {
  it("pushes only allies' intercept down as an action modifier", () => {
    const state = game({ dom: "basic", pro: "basic" }, "Obedient Flesh");
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 3));
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Obedient Flesh:basic");

    const ev = state.eventLog.filter((e) => e.type === "ActionInterceptModified");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ delta: -1, appliesTo: "ally" });
  });

  it("grants strength, a maneuver and a prevention credit in combat", () => {
    const state = game({ dom: "superior", pro: "superior" }, "Obedient Flesh");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
    ]);

    // Before range: the combat half is on offer to the acting vampire.
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.beforeRange");
    expect(dp.options.some((o) => o.id.includes("Obedient Flesh:superior"))).toBe(true);

    runTrace(engine, [
      ["Alice", "play:Obedient Flesh:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // rest of before-range
    ]);

    // The maneuver credit is offered in the range step.
    const range = engine.decision()!;
    expect(range.window).toBe("combat.range");
    expect(range.options.some((o) => o.id === "maneuver:credit")).toBe(true);
  });
});
