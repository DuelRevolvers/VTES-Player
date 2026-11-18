/**
 * Cry Wolf (100475): "This werewolf MUST enter combat with any minion
 * controlled by another Methuselah as a Ⓓ action." The compelled rush is the
 * werewolf's own (an ally rush), not the bearer's optional grant. Read as a
 * per-turn obligation, in the same shape as the mandatory hunt; LSJ 20090226
 * is the anchor: after the mandatory action he is free to take any action.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Alice's Cry Wolf, ready and unlocked, with her anarch vampire V1 ready. */
function board(): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { sect: "anarch", blood: 5, disciplines: { pot: "basic" } });
  state.seats[0]!.minions.push(
    makeAlly("CW", "Alice", 3, {
      name: "Cry Wolf",
      strength: 2,
      attached: [entry("CW", "Cry Wolf")],
    }),
  );
  return state;
}

describe("Cry Wolf (100475): the compelled rush", () => {
  it("in the minion phase the werewolf's rush is offered first, and only compelled options are", () => {
    const state = board();
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine);
    const rushes = ids.filter((id) => id.startsWith("act:Cry Wolf:"));
    expect(rushes.length).toBeGreaterThan(0);
    // Every option is the compelled rush: nothing non-mandatory is offered
    // while it is owed (the mandatory action comes first).
    expect(ids.every((id) => id.startsWith("act:Cry Wolf:"))).toBe(true);
  });

  it("targets only minions controlled by another Methuselah (not her own)", () => {
    const state = board();
    const engine = new VtesEngine(state, testRegistry);
    const targets = optionIds(engine).map((id) => id.split(":").pop());
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(find(state, t!).controller).not.toBe("Alice");
    }
  });

  it("the anarch vampire is not compelled: only the werewolf's rush is mandatory", () => {
    const state = board();
    const engine = new VtesEngine(state, testRegistry);
    // V1 offers no action of its own while the werewolf's rush is owed.
    expect(optionIds(engine).some((id) => id.includes(":V1") && !id.startsWith("act:Cry Wolf:"))).toBe(false);
  });

  it("once rushed this turn, the compulsion is spent and V1 may act again", () => {
    const state = board();
    const engine = new VtesEngine(state, testRegistry);
    const first = optionIds(engine).find((id) => id.startsWith("act:Cry Wolf:"))!;
    runTrace(engine, [["Alice", first]]);
    // Run the rush and its combat out with passes.
    for (let i = 0; i < 200 && state.frames.some((f) => f.kind !== "turn"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    const back = optionIds(engine);
    expect(back.some((id) => id.startsWith("act:Cry Wolf:"))).toBe(false);
  });

  it("NEGATIVE SPACE: with no minion of another Methuselah to rush, nothing is compelled", () => {
    const state = board();
    for (const seat of state.seats.slice(1)) seat.minions = [];
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine);
    expect(ids.some((id) => id.startsWith("act:Cry Wolf:"))).toBe(false);
    expect(ids.length).toBeGreaterThan(0);
  });
});
