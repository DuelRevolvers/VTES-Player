/**
 * Toy Chest Test (102002): "Master. Requires a ready Sabbat vampire with a
 * capacity above 4. Burn a Sabbat vampire with a capacity below 4 that has been
 * put into play since your last turn (not usable on a vampire that has been
 * contested)."
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function minion(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's turn in the master phase. Alice's V1 is a ready Sabbat vampire of
 *  capacity 5 (the requirement). Bob's M is a Sabbat vampire of capacity 3,
 *  put into play at log index `enteredAt`; Alice's last turn ended at 10. */
function setup(enteredAt: number, opts: { v1Sabbat?: boolean; mSect?: "sabbat" | "ani"; v1Capacity?: number } = {}) {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.seat = "Alice";
  turn.phase = "master";
  turn.masterActionsLeft = 1;
  const v1 = minion(state, "V1");
  Object.assign(v1, { sect: opts.v1Sabbat === false ? "camarilla" : "sabbat", capacity: opts.v1Capacity ?? 5, blood: 4 });
  const m = minion(state, "M");
  Object.assign(m, { sect: opts.mSect ?? "sabbat", capacity: 3, enteredPlayAt: enteredAt });
  state.lastTurnEndedAt = { Alice: 10 };
  state.seats[0]!.pool = 10;
  state.seats[0]!.hand = [{ id: "tc", name: "Toy Chest Test" }];
  const engine = new VtesEngine(state, testRegistry);
  return { state, engine };
}

function playOptions(engine: VtesEngine): string[] {
  return engine.decision()!.options.map((o) => o.id).filter((o) => o.startsWith("play:Toy Chest Test"));
}

describe("Toy Chest Test (102002)", () => {
  it("offers a Sabbat vampire of capacity below 4 that entered after the last turn", () => {
    const { engine } = setup(15);
    expect(playOptions(engine).some((o) => o.includes(":M:"))).toBe(true);
  });

  it("does not offer a vampire that entered before the playing seat's last turn ended", () => {
    const { engine } = setup(5);
    expect(playOptions(engine).length).toBe(0);
  });

  it("requires a ready Sabbat vampire of capacity above 4 the playing seat controls", () => {
    const { engine } = setup(15, { v1Sabbat: false });
    expect(playOptions(engine).length).toBe(0);
  });

  it("does not offer a non-Sabbat vampire", () => {
    const { engine } = setup(15, { mSect: "ani" });
    expect(playOptions(engine).length).toBe(0);
  });

  it("burns the chosen vampire when played", () => {
    const { state, engine } = setup(15);
    const opt = playOptions(engine).find((o) => o.includes(":M:"))!;
    engine.choose(opt);
    for (let i = 0; i < 20 && state.seats.some((s) => s.minions.some((m) => m.id === "M")); i++) {
      const dp = engine.decision();
      if (!dp) break;
      const ids = dp.options.map((o) => o.id);
      engine.choose(ids.includes("pass") ? "pass" : ids.includes("end") ? "end" : ids[0]!);
    }
    expect(state.seats.some((s) => s.minions.some((m) => m.id === "M"))).toBe(false);
  });
});
