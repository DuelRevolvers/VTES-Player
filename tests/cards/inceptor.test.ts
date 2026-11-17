/**
 * Inceptor (100969): "Unique master. Put this card on a vampire of capacity 1,
 * and put three cards from your hand, ash heap or library on this card, face up
 * but out of play. This vampire may play other copies of these cards as if he
 * or she had the Discipline required (if any) at superior."
 *
 * Tested here: the placement of three cards, one answer at a time. NOT tested
 * (not built): the superior play of other copies, and the capacity-1 gate on
 * attach (putPermanentInPlay bypasses it).
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

describe("Inceptor (100969)", () => {
  it("entering play asks for three cards and stores exactly those three, face up", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { capacity: 1 });
    const alice = state.seats[0]!;
    alice.hand = [
      { id: "h1", name: "Conditioning" } as any,
      { id: "h2", name: "Deflection" } as any,
      { id: "h3", name: "Telepathic Tracking" } as any,
      { id: "h4", name: "Dominate" } as any,
    ];
    const engine = new VtesEngine(state, testRegistry);
    engine.putPermanentInPlay({
      card: { id: "inc", name: "Inceptor" },
      seat: "Alice",
      attachTo: "V1",
      statics: {},
      tags: ["Inceptor"],
    });
    const holder = find(state, "V1").attached.find((p) => p.card.name === "Inceptor")!;
    const pick = (cardId: string) => {
      const dp = engine.decision()!;
      expect(dp.seat).toBe("Alice");
      const opt = dp.options.find((o) => o.id.includes(`:${cardId}`))!;
      expect(opt).toBeDefined();
      engine.choose(opt.id);
    };
    pick("h1");
    pick("h2");
    pick("h3");
    expect(holder.stored?.map((c) => c.name)).toEqual(["Conditioning", "Deflection", "Telepathic Tracking"]);
    expect(holder.storedFaceUp).toBe(true); // the store is face up
    expect(alice.hand.map((c) => c.id)).toEqual(["h4"]);
  });

  it("the question is not optional: there is no decline option", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand = [{ id: "h1", name: "Conditioning" } as any];
    const engine = new VtesEngine(state, testRegistry);
    engine.putPermanentInPlay({
      card: { id: "inc", name: "Inceptor" },
      seat: "Alice",
      attachTo: "V1",
      statics: {},
      tags: ["Inceptor"],
    });
    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "pass" || !o.id.startsWith("choice:"))).toBe(false);
  });
});
