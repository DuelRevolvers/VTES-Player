import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

function aliceRangeOptions(engine: VtesEngine): string[] {
  for (let i = 0; i < 24; i++) {
    const dp = engine.decision();
    if (!dp) return [];
    if (dp.window === "combat.range" && dp.seat === "Alice") return dp.options.map((o) => o.id);
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) throw new Error(`No pass before Alice's range impulse (${dp.window})`);
    runTrace(engine, [[dp.seat, pass.id]]);
  }
  return [];
}

function playOption(engine: VtesEngine, prefix: string): { seat: string; id: string } | null {
  for (let i = 0; i < 24; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const found = dp.options.find((o) => o.id.startsWith(prefix));
    if (found) return { seat: dp.seat, id: found.id };
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return null;
    runTrace(engine, [[dp.seat, pass.id]]);
  }
  return null;
}

function resolveCard(engine: VtesEngine, state: GameState, cardId: string, optionId: string, seat = "Alice"): void {
  runTrace(engine, [[seat, optionId]]);
  for (let i = 0; i < 12 && !state.eventLog.some((e) => e.type === "CardResolved" && e.cardId === cardId); i++) {
    const dp = engine.decision();
    if (!dp) break;
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) throw new Error(`No pass resolving ${cardId} (${dp.window})`);
    runTrace(engine, [[dp.seat, pass.id]]);
  }
}

function combat(state: GameState) {
  const cf = state.frames.find((f) => f.kind === "combat");
  if (cf?.kind !== "combat") throw new Error("no combat frame");
  return cf;
}

describe("strike cards with optional maneuver riders", () => {
  it("Aid from Bats superior retains the basic maneuver and adds its press", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "superior" };
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "aid", name: "Aid from Bats" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    const option = aliceRangeOptions(engine).find((id) => id.startsWith("play:Aid from Bats:superior:V1:aid"));
    expect(option).toBeDefined();
    resolveCard(engine, state, "aid", option!);

    expect(combat(state).strikes.acting?.name).toBe("Aid from Bats");
    expect(combat(state).maneuverCredits.acting).toBe(1);
    expect(combat(state).presses.acting).toBe(1);
  });

  it("Aid from Bats can be chosen as a strike after declining its optional maneuver", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "basic" };
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "aid", name: "Aid from Bats" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);
    let chosen = false;
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "combat.chooseStrike" && dp.seat === "Alice") {
        const id = dp.options.find((o) => o.id.startsWith("play:Aid from Bats:basic:V1:aid"));
        expect(id).toBeDefined();
        resolveCard(engine, state, "aid", id!.id);
        chosen = true;
        break;
      }
      const pass = dp.options.find((o) => o.id === "pass");
      if (!pass) throw new Error(`No pass in ${dp.window}`);
      engine.choose(pass.id);
    }
    expect(chosen).toBe(true);
    expect(combat(state).strikes.acting).toMatchObject({ name: "Aid from Bats", damage: 1, ranged: true });
  });

  it("Diversion [tha] commits its ranged steal-blood strike in the range window", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { tha: "basic" };
    v1.sect = "anarch";
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "diversion", name: "Diversion" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    const option = aliceRangeOptions(engine).find((id) => id.startsWith("play:Diversion:basic:V1:tha:diversion"));
    expect(option).toBeDefined();
    resolveCard(engine, state, "diversion", option!);

    expect(combat(state).strikes.acting).toMatchObject({
      name: "Diversion",
      ranged: true,
      stealBlood: 1,
    });
    expect(combat(state).maneuverCredits.acting).toBe(1);
  });

  it("commits Aid from Bats and retains its maneuver to long against Terror Frenzy", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { ani: "basic" };
    v1.blood = 5;
    const m = state.seats[1]!.minions.find((minion) => minion.id === "M")!;
    m.disciplines = { ani: "basic" };
    m.blood = 5;
    state.seats[0]!.hand.push({ id: "frenzy", name: "Terror Frenzy" });
    state.seats[1]!.hand.push({ id: "aid-bob", name: "Aid from Bats" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    const frenzy = playOption(engine, "play:Terror Frenzy");
    expect(frenzy).toBeDefined();
    resolveCard(engine, state, "frenzy", frenzy!.id, frenzy!.seat);
    const aid = playOption(engine, "play:Aid from Bats");
    expect(aid, "Aid from Bats should remain playable as a strike").toBeDefined();
    resolveCard(engine, state, "aid-bob", aid!.id, aid!.seat);

    expect(combat(state).strikes.opposing?.name).toBe("Aid from Bats");
    expect(combat(state).maneuverCredits.opposing).toBe(1);
  });

  it("Lam Into [for] commits the +1 hand/melee strike and grants a maneuver", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { for: "basic" };
    v1.sect = "anarch";
    v1.blood = 5;
    state.seats[0]!.hand.push({ id: "lam", name: "Lam Into" });
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    const rangeOptions = aliceRangeOptions(engine);
    const option = rangeOptions.find((id) => id.startsWith("play:Lam Into"));
    expect(option, JSON.stringify(rangeOptions)).toBeDefined();
    resolveCard(engine, state, "lam", option!);

    expect(combat(state).strikes.acting).toMatchObject({
      name: "Lam Into",
      source: "card",
      handStrike: true,
      handBonus: 1,
    });
    expect(combat(state).maneuverCredits.acting).toBe(1);
  });
});
