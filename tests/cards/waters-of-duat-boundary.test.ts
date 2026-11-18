/**
 * Waters of Duat (102159): the token "must hunt this turn". The obligation
 * is discharged by ANNOUNCING a hunt and expires at the end of the turn;
 * gaining blood does not discharge it (token-vampire.test.ts covers that).
 * This file covers the turn boundary, which was asserted nowhere.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, mustHunt } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function board(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const v1 = find(state, "V1")!;
  Object.assign(v1, { clan: "Ministry", capacity: 5, blood: 5 });
  state.seats[0]!.hand.push({ id: "wd", name: "Waters of Duat" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Walk the impulse cycle until some seat is offered `prefix`. */
function walkTo(engine: VtesEngine, prefix: string, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return false;
}

/** Play Waters of Duat and let the action resolve, declining the optional
 *  discipline search (the token is put into play at resolution). */
function play(engine: VtesEngine): void {
  if (!walkTo(engine, "play:Waters of Duat")) throw new Error("Waters of Duat not offered");
  const p = optionIds(engine).find((o) => o.startsWith("play:Waters of Duat"))!;
  engine.choose(p);
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (dp.window === "choice") {
      engine.choose(dp.options.find((o) => o.id.endsWith(":none"))?.id ?? dp.options[0]!.id);
      continue;
    }
    const busy = engine.state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay");
    if (!busy) break;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
}

describe("Waters of Duat (102159): the must-hunt boundary", () => {
  it("the obligation expires at the end of the turn when no hunt was announced", () => {
    const { state, engine } = board();
    play(engine);
    const token = find(engine.state, "wd");
    if (!token) throw new Error("token was not put into play");
    expect(token.mustHuntThisTurn).toBe(true);
    // Give it blood so the obligation is the only reason it must hunt.
    token.blood = 1;
    expect(mustHunt(token)).toBe(true);

    // Run the turn out without announcing a hunt. Taking no action (pass /
    // end) must never be answered with a hunt for this vampire.
    const turn = engine.state.frames[0]!;
    const startTurn = turn.kind === "turn" ? turn.turnNumber : -1;
    for (let i = 0; i < 400; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const cur = engine.state.frames[0];
      if (cur?.kind === "turn" && cur.turnNumber !== startTurn) break;
      const pick = dp.options.find((o) => o.id === "end") ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      engine.choose(pick.id);
    }
    // The loop really ended the turn; otherwise "false" would prove nothing.
    const now = engine.state.frames[0];
    expect(now?.kind === "turn" && now.turnNumber !== startTurn).toBe(true);
    const after = find(engine.state, "wd")!;
    expect(after.mustHuntThisTurn).toBe(false);
    expect(mustHunt(after)).toBe(false);
  });
});
