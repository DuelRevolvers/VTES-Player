/**
 * Healing another minion (docs/minion-target-actions-design.md):
 * Touch of Valeren (102262) and Saulot's Healing Touch (102259).
 *
 * The interesting assertions are the caps — "not to exceed their starting
 * life", which for an ALLY is its `capacity` field (already its printed
 * starting life) — and the rescue discount, which has to be visible at the
 * option site as well as at payment.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function healingTouch(): PermanentInPlay {
  return {
    card: { id: "sht", name: "Saulot's Healing Touch" },
    locked: false,
    usedThisPhase: false,
    statics: { rescueDiscount: { amount: 2, notClan: "Tremere", bonusBlood: 1 } },
    tags: ["Saulot's Healing Touch"],
  };
}

describe("Touch of Valeren (102262) — the action mode", () => {
  it("heals another minion up to its starting life, allies included", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { for: "basic" }, blood: 4 });
    state.seats[0]!.hand.push({ id: "tv1", name: "Touch of Valeren" });
    // A wounded ally of Alice's: capacity 5 is its printed starting life.
    const ally = makeAlly("A1", "Alice", 5);
    ally.blood = 1;
    state.seats[0]!.minions.push(ally);
    const engine = new VtesEngine(state, testRegistry);

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("Touch of Valeren:basic:V1:action:A1"))).toBe(true);

    runTrace(engine, [
      ["Alice", "play:Touch of Valeren:basic:V1:action:A1:tv1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(find(state, "A1").blood).toBe(4); // 1 + 3
  });

  it("trims the heal at starting life rather than overfilling an ally", () => {
    // An ally's capacity is a reference, not a cap (p. 11), so nothing
    // else would have stopped this going to 6.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { for: "basic" }, blood: 4 });
    state.seats[0]!.hand.push({ id: "tv1", name: "Touch of Valeren" });
    const ally = makeAlly("A1", "Alice", 4);
    ally.blood = 3; // one short of its starting life
    state.seats[0]!.minions.push(ally);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Touch of Valeren:basic:V1:action:A1:tv1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "A1").blood).toBe(4); // capped, not 6
  });

  it("does not offer a minion already at its starting life", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { for: "basic" }, blood: 4 });
    state.seats[0]!.hand.push({ id: "tv1", name: "Touch of Valeren" });
    const ally = makeAlly("A1", "Alice", 3);
    ally.blood = 3; // full
    state.seats[0]!.minions.push(ally);
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Touch of Valeren:basic:V1:action:A1")),
    ).toBe(false);
  });
});

describe("Saulot's Healing Touch (102259)", () => {
  /** Alice's Salubri wears the card; Bob's W is in torpor. */
  function rescueGame(victimClan: string | null): GameState {
    const state = threeSeatGame();
    const salubri = makeMinion("S1", "Alice", { blood: 1 });
    salubri.clan = "Salubri";
    salubri.attached.push(healingTouch());
    state.seats[0]!.minions.push(salubri);
    const victim = find(state, "W");
    victim.inTorpor = true;
    victim.blood = 0;
    victim.clan = victimClan;
    return state;
  }

  it("makes the rescue affordable for a Salubri that could not pay 2", () => {
    // The discount has to be read at the OPTION site: with 1 blood this
    // Salubri cannot pay the 2 share, so without the discount the split
    // it exists for would never be offered. (0 blood would not do as a
    // test — a vampire with no blood MUST hunt, p. 21.)
    const state = rescueGame("Brujah");
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("rescue:S1:W:2");
  });

  it("pays nothing and gives the rescued vampire 1 blood", () => {
    const state = rescueGame("Brujah");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "rescue:S1:W:2"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(find(state, "S1").blood).toBe(1); // -2 discount covered it all
    expect(find(state, "W").inTorpor).toBe(false);
    expect(find(state, "W").blood).toBe(1); // the card's second clause
  });

  it("does not discount rescuing a Tremere", () => {
    const state = rescueGame("Tremere");
    const engine = new VtesEngine(state, testRegistry);
    // The Salubri has 1 blood, so with no discount it cannot pay 2 — and
    // W has 0 blood, so no split is affordable at all.
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("rescue:S1:W")),
    ).toBe(false);
  });

  it("grants a +1 stealth action that heals another ready minion", () => {
    const state = threeSeatGame();
    const salubri = makeMinion("S1", "Alice", { blood: 3 });
    salubri.clan = "Salubri";
    salubri.attached.push(healingTouch());
    state.seats[0]!.minions.push(salubri);
    const wounded = find(state, "V1");
    wounded.blood = 1;
    const engine = new VtesEngine(state, testRegistry);

    const opt = "act:Saulot's Healing Touch:sht:heal:S1:V1";
    expect(engine.decision()!.options.some((o) => o.id === opt)).toBe(true);
    // Itself is not a legal target — "another ready minion".
    expect(
      engine.decision()!.options.some((o) => o.id.endsWith(":heal:S1:S1")),
    ).toBe(false);

    runTrace(engine, [
      ["Alice", opt],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(find(state, "V1").blood).toBe(2);
  });
});
