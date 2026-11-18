import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// Spirit Marionette superior [OBE] (101848): "+1 stealth action. Ⓓ Take control
// of a ready unlocked minion until the end of the next action. That minion
// must bleed your prey unless they must hunt."

function board() {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 4, disciplines: { obe: "superior", dom: "basic" } });
  state.seats[0]!.hand.push({ id: "sm", name: "Spirit Marionette" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

const owner = (state: ReturnType<typeof threeSeatGame>, id: string) =>
  state.seats.find(s => s.minions.some(m => m.id === id))?.id;

describe("Spirit Marionette superior: whom it may take", () => {
  it("offers a ready unlocked minion of another Methuselah, not a locked one", () => {
    const { state, engine } = board();
    state.seats[1]!.minions.find(m => m.id === "M")!.locked = true;
    const ids = engine.decision()!.options.map(o => o.id);
    expect(ids).toContain("play:Spirit Marionette:superior:V1:W:sm");
    expect(ids.some(id => id.startsWith("play:Spirit Marionette:superior:V1:M:"))).toBe(false);
  });

  it("does not offer the actor's own minion", () => {
    const { engine } = board();
    expect(engine.decision()!.options.some(o => o.id.startsWith("play:Spirit Marionette:superior:V1:V1:"))).toBe(false);
  });
});

describe("Spirit Marionette superior: the loan", () => {
  it("the minion is Alice's after the card, and must bleed before anything else", () => {
    const { state, engine } = board();
    engine.choose("play:Spirit Marionette:superior:V1:W:sm");
    // Pass until the minion phase opens for Alice (the card's action is done).
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "turn.minion" && dp.seat === "Alice") break;
      engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(owner(state, "W")).toBe("Alice");
    const dp = engine.decision()!;
    const actions = dp.options.filter(o => o.kind === "takeAction").map(o => o.id);
    // Only the mandatory bleed of the borrowed minion is offered.
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every(id => id === "bleed:W" || id.startsWith("hunt:W"))).toBe(true);
    expect(actions).toContain("bleed:W");
  });

  it("returns to its owner when the next action ends, before Alice's minion phase resumes", () => {
    const { state, engine } = board();
    engine.choose("play:Spirit Marionette:superior:V1:W:sm");
    let bled = false;
    let ownerAtNextMinionPhase: string | undefined;
    for (let i = 0; i < 80; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (bled && dp.window === "turn.minion" && ownerAtNextMinionPhase === undefined) {
        ownerAtNextMinionPhase = owner(state, "W");
        break;
      }
      if (!bled && dp.window === "turn.minion" && dp.seat === "Alice" && dp.options.some(o => o.id === "bleed:W")) {
        engine.choose("bleed:W");
        bled = true;
        continue;
      }
      engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(bled).toBe(true);
    expect(ownerAtNextMinionPhase).toBe("Bob");
  });
});

describe("Spirit Marionette superior: owner ousted during the loan", () => {
  it("removes the stolen minion from the game when its owner is ousted (ANK 20181110)", () => {
    const { state, engine } = board();
    engine.choose("play:Spirit Marionette:superior:V1:W:sm");
    state.seats[1]!.ousted = true;
    for (let i = 0; i < 80; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.window === "turn.minion" && dp.seat === "Alice" && dp.options.some(o => o.id === "bleed:W")) {
        engine.choose("bleed:W");
        continue;
      }
      engine.choose(dp.options.find(o => o.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(state.seats.flatMap(s => s.minions).some(m => m.id === "W")).toBe(false);
  });
});
