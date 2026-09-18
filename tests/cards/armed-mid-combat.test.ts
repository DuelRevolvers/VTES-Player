/**
 * Getting armed in the middle of a fight
 * (docs/armed-mid-combat-design.md).
 * Concealed Weapon (100392), Zip Gun (102208), Molotov Cocktail (101235).
 *
 * The three shapes: a weapon arrives FROM HAND, the card itself becomes a
 * weapon that stays, and the card itself becomes a weapon that does not.
 * What is worth pinning is the negative space — which weapons Concealed
 * Weapon may not reach, that an ammo card cannot load a Zip Gun, and that
 * a Molotov cannot be used the round it lands.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Alice's V1 bleeds Bob, Bob's W blocks: a real combat, at beforeRange. */
function combat(state: GameState): VtesEngine {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") tf.phase = "minion";
  const engine = new VtesEngine(state, testRegistry);
  for (let i = 0; i < 30; i++) {
    if (state.frames.some((f) => f.kind === "combat")) break;
    const dp = engine.decision();
    if (!dp) break;
    const want =
      dp.options.find((o) => o.id === "bleed:V1") ??
      dp.options.find((o) => o.id === "block:W") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, want.id]]);
  }
  return engine;
}

/** Play a card and let its as-played window close. */
function playAndSettle(engine: VtesEngine, state: GameState, seat: string, id: string): void {
  runTrace(engine, [[seat, id]]);
  for (let i = 0; i < 20; i++) {
    if (!state.frames.some((f) => f.kind === "cardPlay")) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

/** Walk until `stop` holds, always preferring `pass`. */
function settle(engine: VtesEngine, stop: () => boolean, limit = 40): void {
  for (let i = 0; i < limit; i++) {
    if (stop()) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("Concealed Weapon (100392)", () => {
  it("reaches only the weapons the printed limits allow", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push(
      { id: "cw", name: "Concealed Weapon" },
      // LEGAL: 1 pool, 1 damage, non-aggravated, non-unique.
      { id: "sns", name: "Saturday-Night Special" },
      // LEGAL, and the boundary: 3 damage is not "4 or more".
      { id: "saw", name: "Chainsaw" },
      // LEGAL, and the reason the damage figure is not `w.damage`: a
      // strength-based weapon is read against a generic opponent's base
      // 1 strength [RTR 19980623] [LSJ 20020821], so this is 2, not 0.
      { id: "sword", name: "Bastard Sword" },
      // BARRED BY COST ALONE: 4 pool, 3 damage, non-aggravated.
      { id: "smg", name: "Submachine Gun" },
      // BARRED BY AGGRAVATED ALONE: 2 pool, 1 damage.
      { id: "torch", name: "Blow Torch" },
      // BARRED BY BOTH cost and damage.
      { id: "ar", name: "Assault Rifle" },
    );
    const engine = combat(state);
    const from = ids(engine)
      .filter((i) => i.startsWith("play:Concealed Weapon"))
      .map((i) => i.split(":").find((p) => ["sns", "saw", "sword", "smg", "torch", "ar"].includes(p)));
    expect(new Set(from)).toEqual(new Set(["sns", "saw", "sword"]));
  });
});

/**
 * Alice's V1 fights holding `gun` and an ammo card, strikes with the gun,
 * and the walk reports whether the ammo was ever offered. Run against a
 * Zip Gun and against an ordinary gun, because "no ammo option" is the
 * shape that looks identical whether it is right or the window simply
 * never opened.
 */
function ammoOfferedFor(gun: "Zip Gun" | "Desert Eagle"): boolean {
  const state = threeSeatGame();
  state.seats[0]!.hand.push({ id: "ms", name: "Manstopper Rounds" });
  if (gun === "Zip Gun") {
    state.seats[0]!.hand.push({ id: "gun", name: "Zip Gun" });
  } else {
    const h = testRegistry[gun]!;
    state.seats[0]!.minions
      .find((m) => m.id === "V1")!
      .attached.push({
        card: { id: "gun", name: gun },
        locked: false,
        usedThisPhase: false,
        statics: h.permanentStatics ?? {},
        tags: h.permanentTags ?? [],
      });
  }
  const engine = combat(state);
  let sawAmmo = false;
  let sawStrike = false;
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) break;
    const opts = dp.options.map((o) => o.id);
    if (opts.some((o) => o.startsWith("play:Manstopper"))) sawAmmo = true;
    const strike = opts.find((o) => o === `ability:${gun}:gun:strike`);
    if (strike) sawStrike = true;
    const want =
      opts.find((o) => o.startsWith("play:Zip Gun")) ??
      strike ??
      dp.options.find((o) => o.id === "pass")?.id ??
      opts[0]!;
    runTrace(engine, [[dp.seat, want]]);
    if (sawAmmo) break;
  }
  // The gun's own strike being offered is the refactor's payoff for the
  // Zip Gun, and the control's precondition for the Desert Eagle: without
  // it the ammo question was never asked at all.
  expect(sawStrike).toBe(true);
  return sawAmmo;
}

describe("Zip Gun (102208)", () => {
  it("becomes a gun whose strike is offered, though no ammo card can load it", () => {
    // NEGATIVE SPACE: "Ammo cards cannot be used with this gun" — against
    // a positive control that proves the ammo window opens at all.
    expect(ammoOfferedFor("Desert Eagle")).toBe(true);
    expect(ammoOfferedFor("Zip Gun")).toBe(false);
  });
});

describe("Molotov Cocktail (101235)", () => {
  it("is not usable the round it is put in play", () => {
    const state = threeSeatGame();
    state.seats[0]!.hand.push({ id: "mc", name: "Molotov Cocktail" });
    const engine = combat(state);
    // The attach IS the strike, so it lands at strike resolution.
    settle(engine, () => ids(engine).some((i) => i.startsWith("play:Molotov")), 12);
    const play = ids(engine).find((i) => i.startsWith("play:Molotov"))!;
    expect(play).toBeDefined();
    playAndSettle(engine, state, "Alice", play);
    settle(engine, () => {
      const v = state.seats[0]!.minions.find((m) => m.id === "V1");
      return !!v?.attached.some((p) => p.card.id === "mc");
    });
    const v1 = state.seats[0]!.minions.find((m) => m.id === "V1")!;
    const entry = v1.attached.find((p) => p.card.id === "mc");
    expect(entry).toBeDefined();
    // Asserted, not guarded: `if (cf?.kind === "combat")` here would skip
    // the whole check the moment the walk drifted past the combat.
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf?.kind).toBe("combat");
    // The CARD's age, not the combat's: it records the round it arrived.
    expect(entry!.attachedRound).toBe(cf?.kind === "combat" ? cf.round : -1);
    // NEGATIVE SPACE: no option from it in the round it landed.
    expect(ids(engine).some((i) => i.startsWith("ability:Molotov"))).toBe(false);
  });
});
