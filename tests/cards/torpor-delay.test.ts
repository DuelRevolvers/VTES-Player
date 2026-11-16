import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { newCycle, VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"],
  ]);
}

function passUntilChooseStrikes(engine: VtesEngine): void {
  for (let i = 0; i < 24; i++) {
    const dp = engine.decision();
    if (!dp || dp.window === "combat.chooseStrike") return;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) throw new Error(`No pass in ${dp.window}`);
    runTrace(engine, [[dp.seat, pass.id]]);
  }
  throw new Error("Combat did not reach strike declaration");
}

function bob(state: GameState) {
  return state.seats[1]!.minions.find((m) => m.id === "M")!;
}

describe("Undead Persistence and Undying Tenacity torpor timing", () => {
  it("offers Undying Tenacity only after prevention, then defers torpor until combat ends", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!.minions[0]!;
    const vampire = bob(state);
    alice.strength = 3;
    alice.blood = 5;
    vampire.blood = 2;
    vampire.disciplines = { for: "basic" };
    state.seats[1]!.hand.push({ id: "ut", name: "Undying Tenacity" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    passUntilChooseStrikes(engine);

    let sawTorporRescue = false;
    let playedRescue = false;
    for (let i = 0; i < 100 && !state.eventLog.some((e) => e.type === "WentToTorpor" && e.minion === "M"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "combat.wouldGoTorpor") {
        sawTorporRescue = true;
        expect(dp.seat).toBe("Bob");
        if (!playedRescue) {
          expect(dp.options.some((o) => o.id.startsWith("play:Undying Tenacity:basic:M:ut"))).toBe(true);
        }
      }
      const card = dp.options.find((o) => o.id.startsWith("play:Undying Tenacity:basic:M:ut"));
      const strike = dp.window === "combat.chooseStrike"
        ? dp.options.find((o) => o.id === "strike:hand")
        : undefined;
      const pass = dp.options.find((o) => o.id === "pass");
      const pick = card?.id ?? strike?.id ?? pass?.id;
      if (!pick) throw new Error(`No expected choice in ${dp.window}`);
      if (card) playedRescue = true;
      runTrace(engine, [[dp.seat, pick]]);
    }

    expect(sawTorporRescue).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CardResolved" && e.cardId === "ut")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "WentToTorpor" && e.minion === "M")).toBe(true);
    expect(vampire.inTorpor).toBe(true);
  });

  it("Undead Persistence delays torpor and grants its optional press", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!.minions[0]!;
    const vampire = bob(state);
    alice.strength = 3;
    vampire.blood = 2;
    vampire.disciplines = { for: "basic" };
    state.seats[1]!.hand.push({ id: "up-basic", name: "Undead Persistence" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);
    passUntilChooseStrikes(engine);

    let playedPersistence = false;
    for (let i = 0; i < 100 && !state.eventLog.some((e) => e.type === "WentToTorpor" && e.minion === "M"); i++) {
      const dp = engine.decision();
      if (!dp || dp.window === "turn.minion") break;
      const card = dp.options.find((o) => o.id.startsWith("play:Undead Persistence:basic:M:up-basic"));
      const strike = dp.window === "combat.chooseStrike"
        ? dp.options.find((o) => o.id === "strike:hand")
        : undefined;
      const pass = dp.options.find((o) => o.id === "pass");
      const pick = card?.id ?? strike?.id ?? pass?.id;
      if (!pick) throw new Error(`No option in ${dp.window}`);
      if (card) playedPersistence = true;
      runTrace(engine, [[dp.seat, pick]]);
    }

    expect(playedPersistence).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CardResolved" && e.cardId === "up-basic")).toBe(true);
    expect(state.eventLog.filter((e) => e.type === "PressGranted" && e.minion === "M")).toHaveLength(1);
    expect(state.eventLog.some((e) => e.type === "WentToTorpor" && e.minion === "M")).toBe(true);
    expect(vampire.inTorpor).toBe(true);
  });

  it("ends after three rounds with no combat cards even if combat is otherwise continued", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!.minions[0]!;
    const vampire = bob(state);
    alice.strength = 3;
    vampire.blood = 2;
    vampire.disciplines = { for: "basic" };
    state.seats[1]!.hand.push({ id: "up-clock", name: "Undead Persistence" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);
    passUntilChooseStrikes(engine);

    for (let i = 0; i < 100; i++) {
      const cf = state.frames.find((f) => f.kind === "combat");
      if (cf?.kind === "combat" && cf.deferredTorpor?.some((d) => d.minion === "M")) break;
      const dp = engine.decision();
      if (!dp) throw new Error("Combat ended before Undead Persistence resolved");
      const card = dp.options.find((o) => o.id.startsWith("play:Undead Persistence:basic:M:up-clock"));
      const strike = dp.window === "combat.chooseStrike"
        ? dp.options.find((o) => o.id === "strike:hand")
        : undefined;
      const pass = dp.options.find((o) => o.id === "pass");
      const pick = card?.id ?? strike?.id ?? pass?.id;
      if (!pick) throw new Error(`No option in ${dp.window}`);
      runTrace(engine, [[dp.seat, pick]]);
    }

    let cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat" || !cf.deferredTorpor?.some((d) => d.minion === "M")) {
      throw new Error("Undead Persistence did not defer torpor");
    }
    expect(cf.playedHistory?.some((h) => h.name === "Undead Persistence" && h.round === 1)).toBe(true);
    // Drive only the end-of-round transition here: the test is specifically
    // about the cardless-round clock, with an otherwise-available press
    // continuing each of those rounds.
    cf.pendingDamage = [];
    cf.pendingSecondStrike = null;
    delete cf.afterStrikeDamage;
    for (let noCardRound = 1; noCardRound <= 3; noCardRound++) {
      cf.round = noCardRound + 1;
      cf.step = "endOfRound";
      cf.cycle = newCycle([]);
      cf.willContinue = true;
      engine.decision();
      if (noCardRound < 3) {
        cf = state.frames.find((f) => f.kind === "combat") as typeof cf;
        expect(cf.torporNoCardRounds).toBe(noCardRound);
      }
    }
    for (let i = 0; i < 8 && !state.eventLog.some((e) => e.type === "WentToTorpor" && e.minion === "M"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      const pass = dp.options.find((o) => o.id === "pass");
      if (pass) runTrace(engine, [[dp.seat, pass.id]]);
      else break;
    }
    expect(state.eventLog.some((e) => e.type === "WentToTorpor" && e.minion === "M")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "CombatEnded" && e.rounds === 4)).toBe(true);
  });

  it("offers Undead Persistence superior as fixed prevention in the damage window", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!.minions[0]!;
    const vampire = bob(state);
    alice.strength = 2;
    vampire.blood = 2;
    vampire.disciplines = { for: "superior" };
    state.seats[1]!.hand.push(
      { id: "up", name: "Undead Persistence" },
      { id: "ut", name: "Undying Tenacity" },
    );
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);
    passUntilChooseStrikes(engine);

    let used = false;
    let sawTenacityPreventMode = false;
    for (let i = 0; i < 50 && !state.eventLog.some((e) => e.type === "CardResolved" && e.cardId === "up"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      const option = dp.options.find((o) => o.id.startsWith("play:Undead Persistence:superior:M:up"));
      if (option) {
        expect(dp.window).toBe("combat.damageResolution");
        sawTenacityPreventMode = dp.options.some((o) =>
          o.id.startsWith("play:Undying Tenacity:superior:M:prevent:ut"),
        );
        used = true;
        runTrace(engine, [[dp.seat, option.id]]);
      } else {
        const strike = dp.window === "combat.chooseStrike"
          ? dp.options.find((o) => o.id === "strike:hand")
          : undefined;
        const pass = dp.options.find((o) => o.id === "pass");
        const pick = strike?.id ?? pass?.id;
        if (!pick) throw new Error(`No pass or hand strike in ${dp.window}`);
        runTrace(engine, [[dp.seat, pick]]);
      }
    }
    expect(used).toBe(true);
    expect(sawTenacityPreventMode).toBe(true);
    expect(vampire.blood).toBe(2);
    expect(vampire.inTorpor).not.toBe(true);
    expect(state.eventLog.some((e) => e.type === "DamagePrevented" && e.minion === "M" && e.amount === 2)).toBe(true);
  });
});

it("Undying Tenacity superior offers an ordinary press without waiting for torpor", () => {
  const state = threeSeatGame();
  const vampire = bob(state);
  vampire.blood = 5;
  vampire.disciplines = { for: "superior" };
  state.seats[1]!.hand.push({ id: "ut-press", name: "Undying Tenacity" });
  const engine = new VtesEngine(state, testRegistry);
  enterCombat(engine);
  passUntilChooseStrikes(engine);
  let played = false;
  for (let i = 0; i < 60 && !played; i++) {
    const dp = engine.decision()!;
    const option = dp.options.find(o => o.id.startsWith("play:Undying Tenacity:superior:M:press:continue:ut-press"));
    if (option) {
      expect(dp.window).toBe("combat.press");
      engine.choose(option.id);
      runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
      played = true;
      break;
    }
    engine.choose(dp.options.find(o => o.id === (dp.window === "combat.chooseStrike" ? "strike:hand" : "pass"))!.id);
  }
  expect(played).toBe(true);
  expect(state.eventLog.some(e => e.type === "CardResolved" && e.cardId === "ut-press")).toBe(true);
  const cf = state.frames.find(f => f.kind === "combat");
  expect(cf?.kind === "combat" && cf.willContinue).toBe(true);
  expect(cf?.kind === "combat" && cf.deferredTorpor?.length).toBeFalsy();
});
