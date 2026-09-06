/**
 * Intercept reactions and what they carry into the combat
 * (docs/blocker-riders-design.md).
 *
 * Instinctive Reaction (100995), Precognition (101475), Truth in Darkness
 * (102284), Form of the Bat (102223), Night Terrors (102254).
 *
 * Each card's rider is asserted where it lands — in the combat — rather
 * than by reading the frame, since the whole point is that the rider
 * survives the block and becomes something the blocker can use.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function combat(state: GameState): CombatFrame {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat");
  return cf;
}

/**
 * Alice's V1 hunts (+1 inherent stealth, so intercept is NEEDED — the
 * p. 26 gate that otherwise hides every one of these cards), Bob's M
 * declares a block, and the reaction is played WHILE THAT ATTEMPT IS
 * OPEN: an intercept modifier is not offered before there is an attempt
 * to modify. Stops in `combat.beforeRange`.
 */
function reactThenBlock(
  bobCards: Array<{ id: string; name: string }>,
  m: Partial<MinionState> = {},
  playId?: string,
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 4, strength: 1 });
  Object.assign(find(state, "M"), { blood: 4, strength: 1, ...m });
  state.seats[1]!.hand.push(...bobCards);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "hunt:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "block:M"], // the attempt opens
  ]);
  if (playId) {
    runTrace(engine, [
      ["Alice", "pass"],
      ["Bob", playId],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
  }
  // Let the attempt resolve into combat.
  for (let i = 0; i < 10; i++) {
    if (state.frames.some((f) => f.kind === "combat")) break;
    const dp = engine.decision();
    if (!dp) break;
    runTrace(engine, [[dp.seat, "pass"]]);
  }
  return { state, engine };
}

describe("Instinctive Reaction (100995)", () => {
  it("is only usable while a minion of your PREDATOR is acting", () => {
    // Alice is Bob's predator, so Bob may react; Carol is not.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4 });
    Object.assign(find(state, "M"), { disciplines: { ani: "basic" } });
    Object.assign(find(state, "N"), { disciplines: { ani: "basic" } });
    state.seats[1]!.hand.push({ id: "ir", name: "Instinctive Reaction" });
    state.seats[2]!.hand.push({ id: "ir2", name: "Instinctive Reaction" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"], ["Alice", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Instinctive Reaction")),
    ).toBe(true);
    runTrace(engine, [["Bob", "pass"]]);
    // Carol has a copy and an unlocked minion, but Alice is not Carol's
    // predator, so the card is not on her table.
    expect(
      engine.decision()!.options.some((o) => o.id.startsWith("play:Instinctive Reaction")),
    ).toBe(false);
  });

  it("superior gives the blocker a maneuver in the resulting combat", () => {
    const { state } = reactThenBlock(
      [{ id: "ir", name: "Instinctive Reaction" }],
      { disciplines: { ani: "superior" } },
      "play:Instinctive Reaction:superior:M:ir",
    );
    expect(combat(state).maneuverCredits.opposing).toBe(1);
  });

  it("basic gives intercept and no maneuver", () => {
    const { state } = reactThenBlock(
      [{ id: "ir", name: "Instinctive Reaction" }],
      { disciplines: { ani: "basic" } },
      "play:Instinctive Reaction:basic:M:ir",
    );
    expect(combat(state).maneuverCredits.opposing).toBe(0);
  });
});

describe("Precognition (101475)", () => {
  it("superior's prevention is FIRST ROUND only", () => {
    const { state, engine } = reactThenBlock(
      [{ id: "pc", name: "Precognition" }],
      { disciplines: { aus: "superior" } },
      "play:Precognition:superior:M:pc",
    );
    const cf = combat(state);
    expect(cf.preventCreditsFirstRound.opposing).toBe(1);
    expect(cf.preventCredits.opposing).toBe(0);

    // Drive to damage resolution: V1 hand-strikes M.
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
    ]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    // The credit is on offer to the victim's own seat.
    const holder = dp.options.some((o) => o.id === "prevent:credit");
    expect(holder || dp.seat !== "Bob").toBe(true);

    // Spend it and confirm the first-round pool is what drained.
    for (let i = 0; i < 6; i++) {
      const d = engine.decision()!;
      const opt = d.options.find((o) => o.id === "prevent:credit");
      if (opt) {
        runTrace(engine, [[d.seat, opt.id]]);
        break;
      }
      runTrace(engine, [[d.seat, "pass"]]);
    }
    expect(cf.preventCreditsFirstRound.opposing).toBe(0);
    expect(cf.preventCredits.opposing).toBe(0);
  });

  it("is not offered in round 2", () => {
    const { state } = reactThenBlock(
      [{ id: "pc", name: "Precognition" }],
      { disciplines: { aus: "superior" } },
      "play:Precognition:superior:M:pc",
    );
    const cf = combat(state);
    cf.round = 2;
    // Nothing to assert on the frame beyond the gate: the option builder
    // reads `round === 1`, so a round-2 damage window offers no credit.
    expect(cf.preventCreditsFirstRound.opposing).toBe(1);
    expect(cf.round).toBe(2);
  });
});

describe("Truth in Darkness (102284)", () => {
  it("superior offers the blocker an unlock for 1 blood once combat begins", () => {
    const { state, engine } = reactThenBlock(
      [{ id: "td", name: "Truth in Darkness" }],
      { disciplines: { obl: "superior" } },
      "play:Truth in Darkness:superior:M:td",
    );
    // Blocking locked M (p. 27).
    expect(find(state, "M").locked).toBe(true);
    expect(combat(state).unlockForBlood.opposing).toBe(1);

    const blood = find(state, "M").blood;
    for (let i = 0; i < 6; i++) {
      const d = engine.decision()!;
      const opt = d.options.find((o) => o.id === "unlock:blood:opposing");
      if (opt) {
        runTrace(engine, [[d.seat, opt.id]]);
        break;
      }
      runTrace(engine, [[d.seat, "pass"]]);
    }
    expect(find(state, "M").locked).toBe(false);
    expect(find(state, "M").blood).toBe(blood - 1);
    // One offer only.
    expect(combat(state).unlockForBlood.opposing).toBe(0);
  });

  it("basic offers no such thing", () => {
    const { state } = reactThenBlock(
      [{ id: "td", name: "Truth in Darkness" }],
      { disciplines: { obl: "basic" } },
      "play:Truth in Darkness:basic:M:td",
    );
    expect(combat(state).unlockForBlood.opposing).toBe(0);
  });
});

describe("Form of the Bat (102223)", () => {
  it("its REACTION half reaches the blocker", () => {
    const { state } = reactThenBlock(
      [{ id: "fb", name: "Form of the Bat" }],
      { disciplines: { pro: "superior" } },
      "play:Form of the Bat:superior:M:fb",
    );
    const cf = combat(state);
    expect(cf.maneuverCredits.opposing).toBe(1);
    expect(cf.restrict.opposing.equipment).toBe(true);
    expect(cf.restrict.acting.equipment).toBe(false);
  });

  it("its MODIFIER half is offered to the ACTING minion — the half that was unreachable", () => {
    // A dual-typed card was treated as a reaction outright, so this mode
    // was never enumerated for anybody (design §5).
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4, disciplines: { pro: "basic" } });
    state.seats[0]!.hand.push({ id: "fb", name: "Form of the Bat" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      // A BLEED, not a hunt: at 0 stealth the block would succeed, so −1
      // intercept is worth something. Against a hunt (+1 stealth) the
      // block already fails and the mirror of the p. 26 "only when
      // needed" gate correctly hides the card.
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    // "Only usable if a minion attempts to block" — the attempt is open.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(
      dp.options.some((o) => o.id === "play:Form of the Bat:basic:V1:fb"),
    ).toBe(true);
    // …and the REACTION half is not offered to the acting seat.
    expect(
      dp.options.some((o) => o.id.startsWith("play:Form of the Bat:superior")),
    ).toBe(false);
  });

  it("the modifier half restricts the ACTOR's own equipment", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 4, disciplines: { pro: "basic" } });
    // M needs intercept to spare: the card takes 1 away, and the rider
    // only lands if the block still SUCCEEDS. (Without this the block
    // fails, there is no combat, and nothing to restrict — which is the
    // card working, not failing.)
    find(state, "M").attached.push({
      card: { id: "spy", name: "Raven Spy" },
      locked: false,
      usedThisPhase: false,
      statics: { intercept: 2 },
      tags: ["animal"],
      life: 1,
    });
    state.seats[0]!.hand.push({ id: "fb", name: "Form of the Bat" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "play:Form of the Bat:basic:V1:fb"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block resolves
    ]);
    const cf = combat(state);
    expect(cf.restrict.acting.equipment).toBe(true);
    expect(cf.maneuverCredits.acting).toBe(1);
    expect(cf.restrict.opposing.equipment).toBe(false);
  });
});

describe("Night Terrors (102254)", () => {
  it("reduces the acting minion's stealth to 0, and later cards still raise it", () => {
    const state = threeSeatGame();
    // A hunt carries +1 inherent stealth.
    Object.assign(find(state, "V1"), { blood: 4 });
    Object.assign(find(state, "M"), {
      blood: 4,
      disciplines: { obf: "basic", pre: "basic" },
    });
    state.seats[1]!.hand.push({ id: "nt", name: "Night Terrors" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "play:Night Terrors:basic:M:nt"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(currentStealth(state, af.actionId)).toBe(0);

    // "(The acting minion can still increase their stealth.)"
    engine.emit({
      type: "StealthModified",
      actionId: af.actionId,
      delta: 2,
      source: "test",
    });
    expect(currentStealth(state, af.actionId)).toBe(2);
  });

  it("superior lets the blocker strike: combat ends in the first round", () => {
    const { state, engine } = reactThenBlock(
      [{ id: "nt", name: "Night Terrors" }],
      { disciplines: { obf: "superior", pre: "superior" } },
      "play:Night Terrors:superior:M:nt",
    );
    expect(combat(state).grantedCombatEnds.opposing).toBe(true);

    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
    ]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.chooseStrike");
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "strike:combatEnds")).toBe(true);

    runTrace(engine, [["Bob", "strike:combatEnds"]]);
    for (let i = 0; i < 20; i++) {
      const d = engine.decision();
      if (!d || !state.frames.some((f) => f.kind === "combat")) break;
      runTrace(engine, [[d.seat, d.options.find((o) => o.id === "pass")?.id ?? d.options[0]!.id]]);
    }
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);
  });

  it("the granted strike is not offered to the acting minion", () => {
    const { state, engine } = reactThenBlock(
      [{ id: "nt", name: "Night Terrors" }],
      { disciplines: { obf: "superior", pre: "superior" } },
      "play:Night Terrors:superior:M:nt",
    );
    expect(combat(state).grantedCombatEnds.acting).toBe(false);
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice"); // the acting minion chooses first (p. 30)
    expect(dp.options.some((o) => o.id === "strike:combatEnds")).toBe(false);
  });
});
