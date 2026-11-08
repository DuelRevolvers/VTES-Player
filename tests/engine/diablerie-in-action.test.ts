/**
 * A diablerie, and the blood hunt it causes, happen INSIDE the action
 * (docs/hand-rush-design.md §5.4). The diablerie is the action's effect
 * (p. 23), and the hunt is conducted "automatically and immediately" (p. 35),
 * so both come before the end of the action. Until 0.11.62 both waited for
 * the action frame to pop, so the end of a wake, the replacement draws and
 * the after-resolution window all came first.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "./fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

/** Alice's V1 diablerises Bob's torpid W; Carol's prince N has votes. */
function game(victimCapacity = 3): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, { capacity: 6, blood: 4 });
  Object.assign(find(state, "W")!, { inTorpor: true, blood: 1, capacity: victimCapacity });
  Object.assign(find(state, "N")!, { title: "prince" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function huntFrame(state: GameState) {
  const top = state.frames[state.frames.length - 1];
  return top?.kind === "referendum" && top.variant === "bloodHunt" ? top : null;
}

describe("a diablerie's blood hunt runs inside the action", () => {
  it("polls with the action still on the stack, the victim already burned", () => {
    const { state, engine } = game();
    engine.choose("diablerize:V1:W");
    for (let i = 0; i < 20 && !huntFrame(state); i++) engine.choose("pass");
    expect(huntFrame(state)).not.toBeNull();
    const below = state.frames[state.frames.length - 2];
    expect(below?.kind).toBe("action");
    expect(below?.kind === "action" ? below.step : null).toBe("referendum");
    expect(find(state, "W")).toBeUndefined();
  });

  it("a wake lasts through the hunt, because the action is not over (p. 44)", () => {
    const { state, engine } = game();
    find(state, "N")!.awake = true;
    engine.choose("diablerize:V1:W");
    for (let i = 0; i < 20 && !huntFrame(state); i++) engine.choose("pass");
    expect(huntFrame(state)).not.toBeNull();
    expect(find(state, "N")!.awake).toBe(true);
    // Vote the hunt through and let the action end: the wake ends with it.
    for (let i = 0; i < 40 && state.frames.some((f) => f.kind !== "turn"); i++) {
      const dp = engine.decision()!;
      const pick =
        dp.options.find((o) => o.id.endsWith(":for")) ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(state.frames.every((f) => f.kind === "turn")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BloodHuntCalled")).toBe(true);
    expect(find(state, "V1")).toBeUndefined();
    expect(find(state, "N")!.awake).toBe(false);
  });

  it("asks step 4's Discipline search BEFORE the hunt polls (p. 34–35)", () => {
    // W is older than V1, so step 4 applies.
    const { state, engine } = game(8);
    engine.choose("diablerize:V1:W");
    let firstChoice = -1;
    let firstVote = -1;
    for (let i = 0; i < 20 && (firstChoice < 0 || firstVote < 0); i++) {
      const dp = engine.decision();
      if (!dp) break;
      const choice = dp.options.find((o) => o.id.startsWith("choice:"));
      const vote = dp.options.find((o) => o.id.startsWith("vote:"));
      if (choice && firstChoice < 0) firstChoice = i;
      if (vote && firstVote < 0) firstVote = i;
      engine.choose((choice ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    expect(firstChoice).toBeGreaterThanOrEqual(0);
    expect(firstVote).toBeGreaterThan(firstChoice);
  });

  it("NEGATIVE SPACE: with no hunt to call (Archon), the action simply ends", () => {
    const { state, engine } = game();
    const archon: PermanentInPlay = {
      card: { id: "arc", name: "Archon" },
      locked: false,
      usedThisPhase: false,
      statics: { noBloodHunt: true },
      tags: ["Archon"],
    };
    find(state, "V1")!.attached.push(archon);
    engine.choose("diablerize:V1:W");
    for (let i = 0; i < 20 && state.frames.some((f) => f.kind !== "turn"); i++) {
      engine.choose("pass");
    }
    expect(state.frames.every((f) => f.kind === "turn")).toBe(true);
    expect(find(state, "W")).toBeUndefined();
    expect(find(state, "V1")).toBeDefined();
    expect(state.eventLog.some((e) => e.type === "BloodHuntCalled")).toBe(false);
  });
});
