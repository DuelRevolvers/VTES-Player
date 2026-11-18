import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

// LSJ 20041201-2 (Action creating vampire): "If it would be put into the crypt
// for any reason, it is burned instead." The engine has no path that puts a
// library-origin token into the crypt (CryptCardBuried only reorders crypt
// cards), so the observable rule is: a burned Childe goes to the ash heap and
// the crypt is left as it was.

function playChilde(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision()!;
    const play = dp.options.find((o) => o.id.startsWith("play:Childe of the Revolution"));
    if (play) {
      runTrace(engine, [["Alice", play.id]]);
      break;
    }
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  for (let i = 0; i < 30; i++) {
    if (!state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay")) break;
    const dp = engine.decision();
    if (!dp || dp.window === "choice") break;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
}

describe("Childe of the Revolution (102246): a burned token does not enter the crypt", () => {
  it("burned Childe goes to the ash heap and the crypt is unchanged", () => {
    const state = threeSeatGame();
    const alice = state.seats.find((s) => s.id === "Alice")!;
    Object.assign(alice.minions[0]!, { title: "baron", clan: "Brujah", blood: 5 });
    alice.hand.push({ id: "cr", name: "Childe of the Revolution" });
    const engine = new VtesEngine(state, testRegistry);
    const cryptBefore = alice.crypt.map((c) => c.id);
    playChilde(engine, state);
    const token = state.seats.flatMap((s) => s.minions).find((m) => m.id === "cr");
    expect(token).toBeDefined();
    engine.burnMinion("cr");
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "cr")).toBe(false);
    expect(alice.ashHeap?.some((c) => c.name === "Childe of the Revolution")).toBe(true);
    expect(alice.crypt.map((c) => c.id)).toEqual(cryptBefore);
  });
});
