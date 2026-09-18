/**
 * The lock as currency (docs/lock-as-currency-design.md).
 *
 * Minor Irritation (101221), Lost in Translation (101126), Fillip
 * (100729) — three reactions in which locking is the price or the refund.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id)!;
}

/** Pass until Bob is asked and one of his options matches `want`. */
function toBob(engine: VtesEngine, want: string, steps = 20): string[] {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    const ids = dp.options.map((o) => o.id);
    if (dp.seat === "Bob" && ids.some((o) => o.includes(want))) return ids;
    engine.choose(ids.includes("pass") ? "pass" : ids[0]!);
  }
  return [];
}

/** Pass through the as-played window so the card resolves. */
function settle(engine: VtesEngine, steps = 6): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    engine.choose("pass");
  }
}

/** Alice bleeds; Bob's W blocks it and the block succeeds. */
function blockedBleed(hand: string[]) {
  const state = threeSeatGame();
  hand.forEach((n, i) => state.seats[1]!.hand.push({ id: `r${i}`, name: n }));
  const engine = new VtesEngine(state, testRegistry);
  engine.choose("bleed:V1");
  for (let i = 0; i < 20; i++) {
    const dp = engine.decision();
    if (!dp) break;
    const blk = dp.options.find((o) => o.id === "block:W");
    if (blk) {
      engine.choose(blk.id);
      break;
    }
    engine.choose("pass");
  }
  return { state, engine };
}

// ---------------------------------------------------------------------------

describe("Minor Irritation (101221)", () => {
  it("refunds the lock for blocking someone younger", () => {
    // V1 is capacity 5; W is capacity 5 by default, so make W older.
    const { state, engine } = blockedBleed(["Minor Irritation"]);
    find(state, "W").capacity = 8;
    const ids = toBob(engine, "Minor Irritation");
    // The block has resolved by now, so the lock is on.
    expect(find(state, "W").locked).toBe(true);
    engine.choose(ids.find((i) => i.includes("Minor Irritation"))!);
    settle(engine);
    expect(find(state, "W").locked).toBe(false);
  });

  it("NEGATIVE SPACE: not offered against an equal-capacity vampire", () => {
    const { engine } = blockedBleed(["Minor Irritation"]);
    // W and V1 are both capacity 5 — "younger" is strict.
    expect(toBob(engine, "Minor Irritation").length).toBe(0);
  });
});

describe("Lost in Translation (101126)", () => {
  it("sends the bleed to a third Methuselah, never the actor's own", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "lt", name: "Lost in Translation" });
    find(state, "W").capacity = 8; // V1 (5) is younger
    find(state, "W").blood = 3;
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    const ids = toBob(engine, "Lost in Translation");
    expect(ids.some((i) => i.includes("Lost in Translation:basic:W:Carol"))).toBe(true);
    expect(ids.some((i) => i.includes(":Alice"))).toBe(false);
  });
});

describe("Fillip (100729)", () => {
  it("wakes a younger locked vampire without unlocking it", () => {
    const state = threeSeatGame();
    state.seats[1]!.hand.push({ id: "f", name: "Fillip" });
    state.seats[1]!.minions.push(makeMinion("Y", "Bob", { capacity: 2, locked: true }));
    find(state, "W").capacity = 8;
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    const ids = toBob(engine, "Fillip");
    engine.choose(ids.find((i) => i.includes("Fillip") && i.includes(":Y"))!);
    settle(engine);
    expect(find(state, "Y").awake).toBe(true);
    expect(find(state, "Y").locked).toBe(true); // a wake does not unlock (p. 44)
  });
});
