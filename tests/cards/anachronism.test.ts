/**
 * Anachronism (100050): "Master. Put this card on a vampire with capacity above
 * 6. This vampire cannot have or use any ranged weapons except the Ivory Bow.
 * (If he or she currently has any, they are burned.)"
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { cannotHaveRangedWeapon } from "../../src/cards/effects/compile.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Bob's V2 (capacity raised to 7) holds .44 Magnum (a ranged weapon) and Ivory Bow. */
function setup(bobCapacity: number): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  const bob = state.seats[1]!.minions[0]!;
  Object.assign(bob, { capacity: bobCapacity });
  state.seats[0]!.hand = [{ id: "an", name: "Anachronism" }];
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({ card: { id: "vessel", name: ".44 Magnum" }, seat: "Bob", attachTo: bob.id, statics: {}, tags: [] });
  engine.putPermanentInPlay({ card: { id: "bow", name: "Ivory Bow" }, seat: "Bob", attachTo: bob.id, statics: {}, tags: [] });
  return { state, engine };
}

describe("Anachronism (100050)", () => {
  it("is offered only on a vampire with capacity above 6", () => {
    const low = setup(6);
    const lowIds = low.engine.decision()!.options.map((o) => o.id);
    expect(lowIds.some((o) => o.startsWith("play:Anachronism"))).toBe(false);

    const high = setup(7);
    const highIds = high.engine.decision()!.options.map((o) => o.id);
    expect(highIds.some((o) => o.startsWith("play:Anachronism"))).toBe(true);
  });

  it("burns a held ranged weapon other than the Ivory Bow when played", () => {
    const { state, engine } = setup(7);
    const bob = state.seats[1]!.minions[0]!;
    const opt = engine.decision()!.options.find((o) => o.id.startsWith("play:Anachronism"))!;
    engine.choose(opt.id);
    // resolve the play to the end of the master phase
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      if (ids.includes("pass")) engine.choose("pass");
      else if (ids.includes("end")) engine.choose("end");
      else break;
      if ((state.frames[0] as any).phase !== "master") break;
    }
    const names = minion(state, bob.id).attached.map((p) => p.card.name);
    expect(names).toContain("Anachronism");
    expect(names).toContain("Ivory Bow");
    expect(names).not.toContain(".44 Magnum");
  });

  it("the equipment gate refuses a ranged weapon but not the Ivory Bow or a melee weapon", () => {
    const restricted = { attached: [{ card: { id: "x", name: "Anachronism" }, statics: { cannotHaveRangedWeapons: true } }] } as unknown as MinionState;
    (restricted as any).id = "x";
    const bearer = { ...restricted, id: "x" } as unknown as MinionState;
    expect(cannotHaveRangedWeapon(bearer, ".44 Magnum", { weaponProfile: { ranged: true } })).toBe(true);
    expect(cannotHaveRangedWeapon(bearer, "Ivory Bow", { weaponProfile: { ranged: true } })).toBe(false);
    expect(cannotHaveRangedWeapon(bearer, "Blade", { weaponProfile: { ranged: false } })).toBe(false);
  });
});
