/**
 * Vampiric Disease (102088): "Put 1 disease counter on a vampire. If a vampire
 * with a disease counter is in combat at close range with another vampire, the
 * second vampire gets a disease counter before strikes are chosen. A vampire
 * with a disease counter cannot gain blood by hunting. Each time a vampire with
 * a disease counter unlocks, they burn 1 blood or, if unable, burn the disease
 * counter. A vampire can have only one disease counter."
 */
import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { huntAmountFor } from "../../src/engine/derived.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function disease(m: MinionState): number {
  return m.counters?.["disease"] ?? 0;
}

describe("Vampiric Disease (102088)", () => {
  it("placing the card puts one disease counter on the bearer, and only one", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    engine.putPermanentInPlay({
      card: { id: "vd", name: "Vampiric Disease" },
      seat: "Alice",
      attachTo: "V1",
      statics: {},
      tags: [],
    });
    expect(disease(find(state, "V1"))).toBe(1);
  });

  it("unlocking burns 1 blood from a diseased vampire", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    const v1 = find(state, "V1");
    Object.assign(v1, { blood: 3, locked: true, counters: { disease: 1 } });
    (engine as any).diseaseOnUnlock("V1");
    expect(v1.blood).toBe(2);
    expect(disease(v1)).toBe(1);
  });

  it("a diseased vampire with no blood burns the disease counter instead", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    const v1 = find(state, "V1");
    Object.assign(v1, { blood: 0, locked: true, counters: { disease: 1 } });
    (engine as any).diseaseOnUnlock("V1");
    expect(v1.blood).toBe(0);
    expect(disease(v1)).toBe(0);
  });

  it("an undiseased vampire is not touched by the unlock rule", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    const v1 = find(state, "V1");
    Object.assign(v1, { blood: 3, counters: {} });
    (engine as any).diseaseOnUnlock("V1");
    expect(v1.blood).toBe(3);
  });

  it("a diseased vampire gains no blood from hunting", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1");
    const clean = huntAmountFor(state, v1);
    expect(clean).toBeGreaterThan(0);
    v1.counters = { disease: 1 };
    expect(huntAmountFor(state, v1)).toBe(0);
  });

  it("in close-range combat, the other vampire gets a counter; an ally does not", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    find(state, "V1").counters = { disease: 1 };
    const cf = {
      kind: "combat",
      acting: "V1",
      actingSeat: "Alice",
      opposing: "W",
      opposingSeat: "Bob",
      range: "close",
    } as unknown as CombatFrame;
    (engine as any).spreadVampiricDisease(cf);
    expect(disease(find(state, "W"))).toBe(1);
    // "another vampire": an ally in the same fight gets nothing.
    const state2 = threeSeatGame();
    const e2 = new VtesEngine(state2, testRegistry);
    find(state2, "V1").counters = { disease: 1 };
    const ally = find(state2, "W");
    ally.kind = "ally";
    (e2 as any).spreadVampiricDisease(cf);
    expect(disease(ally)).toBe(0);
  });

  it("at non-close range no counter is placed", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    find(state, "V1").counters = { disease: 1 };
    const cf = { kind: "combat", acting: "V1", opposing: "W", range: "ranged" } as unknown as CombatFrame;
    (engine as any).spreadVampiricDisease(cf);
    expect(disease(find(state, "W"))).toBe(0);
  });
});
