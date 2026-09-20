/**
 * The shape of the round (docs/round-sequencing-design.md).
 *
 * Vanish from the Mind's Eye (102090), Sanguinary Wind (101678),
 * Rapid Thought (101544), Relentless Pursuit (101594).
 *
 * Four cards that change how the ROUND runs rather than what a strike does.
 * Each one is observable only through the sequence, so the assertions are
 * about WHO is asked, WHEN, and what survives a round boundary.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice's V1 bleeds, Bob's M blocks. Instance ids `rs*`, never `c1`. */
function inCombat(
  cards: string[],
  disciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines, strength: 1 });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: m.capacity, strength: 1 });
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `rs${i}`, name: n }));
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine, v1, m };
}

function combat(state: GameState): {
  round: number;
  range: "close" | "long";
  willContinue: boolean;
  presses: { acting: number; opposing: number };
  pressesCombat: { acting: number; opposing: number };
  maneuverCredits: { acting: number; opposing: number };
  opposingChoosesFirst?: boolean;
  strikesUndodgeableRound?: { acting: boolean; opposing: boolean };
  handSizeOnNextRound?: { seat: string; amount: number }[];
  handSizeBonus?: { seat: string; amount: number }[];
  grantedStrikes?: { acting: { kind: string }[]; opposing: { kind: string }[] };
} {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  return cf;
}

/** Walk to a window and return {seat, options}. */
function reach(
  engine: VtesEngine,
  window: string,
  limit = 16,
): { seat: string; ids: string[] } | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    if (dp.window === window) return { seat: dp.seat, ids: dp.options.map((o) => o.id) };
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) return null;
    engine.choose(pick.id);
  }
  return null;
}

function settle(engine: VtesEngine, steps = 4): void {
  for (let i = 0; i < steps; i++) {
    const dp = engine.decision();
    if (!dp || dp.window !== "card.asPlayed") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

// ---------------------------------------------------------------------------

describe("Vanish from the Mind's Eye (102090) — the restricted press is the BASIC", () => {
  it("basic needs a standing press; superior does not", () => {
    // Quiet press step: only the free superior is there.
    const quiet = inCombat(["Vanish from the Mind's Eye"], { obf: "superior" });
    const q = reach(quiet.engine, "combat.press");
    expect(q, "never reached the press step").not.toBeNull();
    expect(q!.ids.some((x) => x.startsWith("play:Vanish from the Mind's Eye:superior"))).toBe(true);
    expect(q!.ids.some((x) => x.startsWith("play:Vanish from the Mind's Eye:basic"))).toBe(false);

    // With Bob pressing to continue, the end-only basic appears.
    const live = inCombat(["Vanish from the Mind's Eye"], { obf: "superior" });
    combat(live.state).pressesCombat.opposing += 1;
    for (let i = 0; i < 20; i++) {
      const dp = live.engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("play:Vanish from the Mind's Eye:basic"))) break;
      const press = dp.seat === "Bob" ? dp.options.find((o) => o.id === "press:continue") : undefined;
      const pick =
        press ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand");
      if (!pick) break;
      live.engine.choose(pick.id);
    }
    expect(combat(live.state).willContinue).toBe(true);
    const dp = live.engine.decision()!;
    expect(dp.options.some((o) => o.id.startsWith("play:Vanish from the Mind's Eye:basic"))).toBe(
      true,
    );
  });
});

describe("Sanguinary Wind (101678) — a dodge that does nothing", () => {
  /** Give M a real dodge; a dodge is never a free option (wave 76). */
  function grantBobADodge(state: GameState): void {
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame");
    cf.grantedStrikes ??= { acting: [], opposing: [] };
    cf.grantedStrikes.opposing.push({ kind: "dodge" });
  }

  /** Play a mode in its own window, then fight the round out with Bob
   *  dodging, and report the damage M took. */
  function damageThroughDodge(mode: "basic" | "superior"): number {
    const a = inCombat(["Sanguinary Wind"], { cel: "superior" });
    grantBobADodge(a.state);
    const window = mode === "basic" ? "combat.beforeStrikes" : "combat.chooseStrike";
    const r = reach(a.engine, window);
    expect(r, `${mode}: never reached ${window}`).not.toBeNull();
    const id = r!.ids.find((x) => x.startsWith(`play:Sanguinary Wind:${mode}`));
    expect(id, `${mode} not offered in ${window}`).toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    const mBefore = a.m.blood;
    let dodged = false;
    for (let i = 0; i < 26; i++) {
      if (!a.state.frames.some((f) => f.kind === "combat")) break;
      const dp = a.engine.decision();
      if (!dp) break;
      const dodge = dp.seat === "Bob" ? dp.options.find((o) => o.id === "strike:dodge") : undefined;
      const pick =
        dodge ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id.startsWith("strike:"));
      if (!pick) break;
      if (dodge) dodged = true;
      a.engine.choose(pick.id);
    }
    // The control has to have happened, or "damage landed" proves nothing.
    expect(dodged, `${mode}: Bob never dodged`).toBe(true);
    return mBefore - a.m.blood;
  }

  it("V1's hand strike lands through a dodge, from either mode", () => {
    // "Does not prevent the opponent from dodging, the dodge just has no
    // effect" [LSJ 20030902-2] — so the dodge IS taken and the damage lands.
    expect(damageThroughDodge("basic")).toBe(1);
    expect(damageThroughDodge("superior")).toBe(1);
  });

  it("CONTROL: without it, the dodge stops the hand strike", () => {
    const a = inCombat(["Sanguinary Wind"], { cel: "superior" });
    grantBobADodge(a.state);
    const mBefore = a.m.blood;
    for (let i = 0; i < 26; i++) {
      if (!a.state.frames.some((f) => f.kind === "combat")) break;
      const dp = a.engine.decision();
      if (!dp) break;
      const dodge = dp.seat === "Bob" ? dp.options.find((o) => o.id === "strike:dodge") : undefined;
      const pick =
        dodge ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    expect(mBefore - a.m.blood).toBe(0);
  });

  it("the two modes live in DIFFERENT windows", () => {
    const a = inCombat(["Sanguinary Wind"], { cel: "superior" });
    const before = reach(a.engine, "combat.beforeStrikes")!;
    expect(before.ids.some((x) => x.startsWith("play:Sanguinary Wind:basic"))).toBe(true);
    expect(before.ids.some((x) => x.startsWith("play:Sanguinary Wind:superior"))).toBe(false);

    const b = inCombat(["Sanguinary Wind"], { cel: "superior" });
    const at = reach(b.engine, "combat.chooseStrike")!;
    expect(at.ids.some((x) => x.startsWith("play:Sanguinary Wind:superior"))).toBe(true);
  });
});

describe("Rapid Thought (101544) — who chooses a strike first", () => {
  it("the acting minion is asked first by default", () => {
    const a = inCombat(["Rapid Thought"], { cel: "superior" });
    const r = reach(a.engine, "combat.chooseStrike")!;
    expect(r.seat).toBe("Alice");
  });

  it("its superior hands the first choice to the opposing minion", () => {
    const a = inCombat(["Rapid Thought"], { cel: "superior" });
    const r = reach(a.engine, "combat.chooseStrike")!;
    const id = r.ids.find((x) => x.startsWith("play:Rapid Thought:superior"));
    expect(id, "superior not offered to the side that chooses first").toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    expect(combat(a.state).opposingChoosesFirst).toBe(true);
    // Bob is now asked for his strike, with Alice's still unchosen.
    const next = a.engine.decision()!;
    expect(next.window).toBe("combat.chooseStrike");
    expect(next.seat).toBe("Bob");
  });

  it("NEGATIVE SPACE: it is not offered twice, nor to the side already going first", () => {
    const a = inCombat(["Rapid Thought", "Rapid Thought"], { cel: "superior" });
    const r = reach(a.engine, "combat.chooseStrike")!;
    a.engine.choose(r.ids.find((x) => x.startsWith("play:Rapid Thought:superior"))!);
    settle(a.engine);
    // Bob chooses first now; Alice must not be able to swap it back, and the
    // window IS open to her once Bob has chosen.
    const dp = a.engine.decision()!;
    expect(dp.seat).toBe("Bob");
    a.engine.choose(dp.options.find((o) => o.id === "strike:hand")!.id);
    const mine = a.engine.decision()!;
    expect(mine.seat).toBe("Alice");
    expect(mine.options.some((o) => o.id === "strike:hand")).toBe(true);
    expect(mine.options.some((o) => o.id.startsWith("play:Rapid Thought:superior"))).toBe(false);
  });

  it("its basic is a maneuver OR a press, each in its own window", () => {
    const a = inCombat(["Rapid Thought"], { cel: "superior" });
    const atRange = reach(a.engine, "combat.range")!;
    expect(atRange.ids.some((x) => x.startsWith("play:Rapid Thought:basic:V1:rs0"))).toBe(true);

    const b = inCombat(["Rapid Thought"], { cel: "superior" });
    const atPress = reach(b.engine, "combat.press")!;
    expect(atPress.ids.some((x) => x.startsWith("play:Rapid Thought:basic:V1:press"))).toBe(true);
  });
});

describe("Relentless Pursuit (101594) — paid only if a round follows", () => {
  /** Play the mode at the press step and press on into round 2. */
  function pressOn(mode: "basic" | "superior"): GameState {
    const a = inCombat(["Relentless Pursuit"], { pot: "superior" });
    const r = reach(a.engine, "combat.press")!;
    const id = r.ids.find((x) => x.startsWith(`play:Relentless Pursuit:${mode}`));
    expect(id, `${mode} not offered at the press step`).toBeDefined();
    a.engine.choose(id!);
    settle(a.engine);
    for (let i = 0; i < 24; i++) {
      const live = a.state.frames.find((f) => f.kind === "combat");
      if (live?.kind !== "combat" || live.round > 1) break;
      const dp = a.engine.decision();
      if (!dp) break;
      const pick =
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand");
      if (!pick) break;
      a.engine.choose(pick.id);
    }
    return a.state;
  }

  it("the superior owes the hand size and pays it when round 2 begins", () => {
    const state = pressOn("superior");
    const cf = combat(state);
    expect(cf.round).toBe(2);
    // Owed at play, paid at the boundary and cleared.
    expect(cf.handSizeOnNextRound ?? []).toHaveLength(0);
    expect((cf.handSizeBonus ?? []).some((g) => g.seat === "Alice" && g.amount === 2)).toBe(true);
  });

  it("the basic owes nothing", () => {
    // The pair: both modes press, so "a round 2 happened" proves nothing on
    // its own — only the grant separates them.
    const state = pressOn("basic");
    const cf = combat(state);
    expect(cf.round).toBe(2);
    expect((cf.handSizeBonus ?? []).some((g) => g.seat === "Alice")).toBe(false);
  });

  it("nothing is granted while the round has not turned over", () => {
    const a = inCombat(["Relentless Pursuit"], { pot: "superior" });
    const r = reach(a.engine, "combat.press")!;
    a.engine.choose(r.ids.find((x) => x.startsWith("play:Relentless Pursuit:superior"))!);
    settle(a.engine);
    const cf = combat(a.state);
    expect(cf.round).toBe(1);
    // Owed but NOT yet paid — "if another round starts" is not knowable yet.
    expect(cf.handSizeOnNextRound ?? []).toHaveLength(1);
    expect((cf.handSizeBonus ?? []).some((g) => g.seat === "Alice")).toBe(false);
  });
});
