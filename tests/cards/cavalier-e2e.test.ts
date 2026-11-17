/**
 * Cavalier (100310), end to end: "Archetype. Put this card on a vampire you
 * control. Once each turn, this vampire can burn 1 blood to unlock after
 * performing an action that costs blood."
 *
 * The offer is read off a real successful blood-cost action (Magic of the Smith,
 * blood 1). The negative case uses a bleed, which costs no blood, and must not
 * be offered the unlock.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function setup(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const turn = state.frames[0]! as any;
  turn.phase = "minion";
  turn.seat = "Alice";
  Object.assign(find(state, "V1"), { disciplines: { tha: "basic" }, blood: 4, locked: false });
  state.seats[0]!.hand.push({ id: "ms", name: "Magic of the Smith" } as any);
  state.seats[0]!.library.push({ id: "f", name: "Conditioning" } as any, { id: "l1", name: "Conditioning" } as any);
  const engine = new VtesEngine(state, testRegistry);
  engine.putPermanentInPlay({
    card: { id: "cv", name: "Cavalier" },
    seat: "Alice",
    attachTo: "V1",
    statics: {},
    tags: ["archetype"],
  });
  return { state, engine };
}

/** Pass through the action's windows, answering nothing, until the unlock offer or the window closes. */
function driveUntilUnlockOffer(engine: VtesEngine): boolean {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith("choice:Cavalier:"))) return true;
    const ids = dp.options.map((o) => o.id);
    // Decline the library search (find nothing) so the walk reaches the unlock.
    engine.choose(ids.includes("pass") ? "pass" : ids.find((x) => x.endsWith(":none")) ?? ids[0]!);
  }
  return false;
}

describe("Cavalier (100310), end to end", () => {
  it("after a successful blood-cost action, the bearer may burn 1 blood to unlock", () => {
    const { state, engine } = setup();
    const play = engine.decision()!.options.find((o) => o.id.startsWith("play:Magic of the Smith"))!;
    runTrace(engine, [["Alice", play.id], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    expect(driveUntilUnlockOffer(engine)).toBe(true);
    const offer = engine.decision()!.options.find((o) => o.id.includes(":yes"))!;
    const before = find(state, "V1").blood;
    engine.choose(offer.id);
    expect(find(state, "V1").blood).toBe(before - 1);
    expect(find(state, "V1").locked).toBe(false);
  });

  it("NEGATIVE SPACE: a bleed costs no blood, so no unlock offer", () => {
    const { engine } = setup();
    runTrace(engine, [["Alice", "bleed:V1"]]);
    let offered = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("choice:Cavalier:"))) offered = true;
      const ids = dp.options.map((o) => o.id);
      engine.choose(ids.includes("pass") ? "pass" : ids[0]!);
    }
    expect(offered).toBe(false);
  });
});
