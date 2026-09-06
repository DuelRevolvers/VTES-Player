/**
 * The block tax — who may attempt to block at all, and what the attempt
 * costs them (docs/block-tax-design.md). Where the Veil Thins (102285),
 * Seeds of Terror (102338), Unthinkable Humiliation (102346), The Sleeping
 * Mind (101805) and Daring the Dawn (100492).
 */

import { describe, expect, it } from "vitest";
import type { GameState, LegalOption, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentIntercept } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * The toll on a block option, read from the option's own field rather
 * than parsed out of its label. The label is prose and now also carries
 * intercept vs stealth; the number is the thing these tests are about
 * (docs/richer-options-design.md §1).
 */
function tollOf(dp: { options: LegalOption[] }, id: string): number | null {
  const o = dp.options.find((x) => x.id === id);
  return o && o.kind === "declareBlock" ? o.toll : null;
}

/** Alice's V1 with the given disciplines, holding `card`. */
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

/** Bleed, and run the announce cycle out; the impulse is on Alice in state A. */
function upToEffects(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ]);
}

/** Alice plays the card and everyone lets it stand; the impulse comes back. */
function playAndSettle(engine: VtesEngine, optionId: string): void {
  runTrace(engine, [
    ["Alice", optionId],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"],
  ]);
}

describe("Where the Veil Thins (102285)", () => {
  it("taxes minions without Oblivion, exempts those with it, and bars allies", () => {
    const state = game({ obl: "superior" }, "Where the Veil Thins");
    // Bob: M has no Oblivion, W has it, and A is an ally (no blood at all).
    find(state, "W").disciplines = { obl: "basic" };
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Where the Veil Thins:superior");

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    // The Oblivion vampire blocks for free; the other must pay; the ally
    // has no blood to burn and so cannot attempt at all.
    expect(tollOf(dp, "block:W")).toBe(0);
    expect(tollOf(dp, "block:M")).toBe(1);
    expect(dp.options.some((o) => o.id === "block:A")).toBe(false);
  });

  it("burns the blood when the attempt is made, not when it succeeds", () => {
    const state = game({ obl: "superior" }, "Where the Veil Thins");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Where the Veil Thins:superior");

    const before = find(state, "M").blood;
    runTrace(engine, [["Bob", "block:M"]]);
    // The stealth half means the block will fail, but the toll is paid for
    // the attempt regardless.
    expect(find(state, "M").blood).toBe(before - 1);
  });

  it("is a plain when-needed stealth modifier at inferior", () => {
    const state = game({ obl: "basic" }, "Where the Veil Thins");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    // No block attempt underway, so the inferior stealth is not "needed".
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Where the Veil Thins")),
    ).toBe(false);
  });
});

describe("Seeds of Terror (102338)", () => {
  it("taxes every minion, allies included — and allies cannot pay in blood", () => {
    const state = game({ obf: "basic" }, "Seeds of Terror");
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Seeds of Terror:basic");

    const dp = engine.decision()!;
    expect(tollOf(dp, "block:M")).toBe(1);
    expect(dp.options.some((o) => o.id === "block:A")).toBe(false);
  });

  it("also names a vampire that cannot block at superior", () => {
    const state = game({ pre: "superior" }, "Seeds of Terror");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Seeds of Terror:superior:V1:M");

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "block:M")).toBe(false);
    expect(tollOf(dp, "block:W")).toBe(1);
  });

  it("is not on offer once a block attempt is underway", () => {
    const state = game({ obf: "basic" }, "Seeds of Terror");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [["Alice", "pass"], ["Bob", "block:M"]]);

    expect(
      engine.decision()!.options.some((o) => o.id.includes("Seeds of Terror")),
    ).toBe(false);
  });

  it("stops a minion with no blood from blocking at all", () => {
    const state = game({ obf: "basic" }, "Seeds of Terror");
    find(state, "M").blood = 0;
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Seeds of Terror:basic");

    expect(engine.decision()!.options.some((o) => o.id === "block:M")).toBe(false);
  });
});

describe("Unthinkable Humiliation (102346)", () => {
  it("lets an ally pay the toll out of its life", () => {
    const state = game({ pot: "basic" }, "Unthinkable Humiliation");
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Unthinkable Humiliation:basic");

    expect(engine.decision()!.options.some((o) => o.id === "block:A")).toBe(true);
    runTrace(engine, [["Bob", "block:A"]]);
    expect(find(state, "A").blood).toBe(1);
  });

  it("pushes every minion's intercept down at superior", () => {
    const state = game({ pre: "superior" }, "Unthinkable Humiliation");
    // Both of Bob's vampires carry intercept gear, so the -1 has to reach
    // whichever one attempts.
    for (const id of ["M", "W"]) {
      find(state, id).attached.push({
        card: { id: `scope-${id}`, name: "Scope" },
        locked: false,
        usedThisPhase: false,
        statics: { intercept: 1 },
        tags: [],
      });
    }
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Unthinkable Humiliation:superior");

    // Intercept 1 − 1 = 0 vs stealth 0 still blocks (p. 26 is "equal or
    // greater"), so assert on the derived value rather than the outcome.
    const actionId = state.eventLog.find((e) => e.type === "ActionAnnounced")!.actionId;
    expect(currentIntercept(state, actionId, "M")).toBe(0);
    expect(currentIntercept(state, actionId, "W")).toBe(0);
  });
});

describe("The Sleeping Mind (101805)", () => {
  it("offers only locked vampires as the choice", () => {
    const state = game({ dom: "basic" }, "The Sleeping Mind");
    find(state, "M").locked = true; // W stays unlocked
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.includes("The Sleeping Mind:basic:V1:M"))).toBe(true);
    expect(dp.options.some((o) => o.id.includes("The Sleeping Mind:basic:V1:W"))).toBe(false);
  });

  it("keeps the named vampire out even after it unlocks", () => {
    const state = game({ dom: "basic" }, "The Sleeping Mind");
    // M is locked and holds the Animalism to unlock itself with Guard Dogs.
    Object.assign(find(state, "M"), { locked: true, disciplines: { ani: "basic" } });
    state.seats[1]!.hand.push({ id: "gd", name: "Guard Dogs" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:The Sleeping Mind:basic:V1:M");

    runTrace(engine, [
      ["Bob", "play:Guard Dogs:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"],
    ]);

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(find(state, "M").locked).toBe(false); // it did unlock…
    expect(dp.options.some((o) => o.id === "block:M")).toBe(false); // …and still cannot block
    expect(dp.options.some((o) => o.id === "block:W")).toBe(true);
  });

  it("shuts off unlock effects for the whole action at superior", () => {
    const state = game({ dom: "superior" }, "The Sleeping Mind");
    // Both of Bob's vampires are locked and could unlock with Guard Dogs.
    for (const id of ["M", "W"]) {
      Object.assign(find(state, id), { locked: true, disciplines: { ani: "basic" } });
    }
    state.seats[1]!.hand.push({ id: "gd", name: "Guard Dogs" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    // Only M is named, but the superior clause stops W unlocking too.
    playAndSettle(engine, "play:The Sleeping Mind:superior:V1:M");

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.includes("Guard Dogs"))).toBe(false);
  });

  it("leaves unlock effects alone at inferior", () => {
    const state = game({ dom: "basic" }, "The Sleeping Mind");
    for (const id of ["M", "W"]) {
      Object.assign(find(state, id), { locked: true, disciplines: { ani: "basic" } });
    }
    state.seats[1]!.hand.push({ id: "gd", name: "Guard Dogs" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:The Sleeping Mind:basic:V1:M");

    expect(
      engine.decision()!.options.some((o) => o.id.includes("Guard Dogs")),
    ).toBe(true);
  });
});

describe("Daring the Dawn (100492)", () => {
  it("keeps vampires out and burns the actor down after resolution", () => {
    const state = game({ for: "superior" }, "Daring the Dawn");
    state.seats[1]!.minions.push(makeAlly("A", "Bob", 3));
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Daring the Dawn:superior");

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "block:M")).toBe(false);
    expect(dp.options.some((o) => o.id === "block:W")).toBe(false);
    // An ally is not a vampire, so it may still block.
    expect(dp.options.some((o) => o.id === "block:A")).toBe(true);
  });

  it("sends the acting vampire to torpor — the damage is aggravated", () => {
    const state = game({ for: "basic" }, "Daring the Dawn");
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    playAndSettle(engine, "play:Daring the Dawn:basic");
    // Nobody can block, so the bleed resolves.
    runTrace(engine, [["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);

    expect(find(state, "V1").inTorpor).toBe(true);
    expect(state.seats[1]!.pool).toBe(9); // the bleed still landed
  });
});
