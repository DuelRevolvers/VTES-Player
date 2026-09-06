/**
 * The full turn skeleton: unlock (with the Edge pool decision), master,
 * minion (with a mandatory hunt — undirected, +1 inherent stealth),
 * influence, discard (with draw-to-replace bookkeeping), and rotation to
 * the next Methuselah. Plus ousting: victory point and +6 pool to the
 * predator, prey relinking, and game end.
 */

import { describe, expect, it } from "vitest";
import { preyOf, VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "./fixtures.ts";

describe("turn structure", () => {
  it("runs unlock → master → minion (mandatory hunt) → influence → discard → next turn", () => {
    const state = threeSeatGame();
    // Alice starts her turn from the top: V1 locked and empty (must hunt),
    // and she holds the Edge.
    state.edge = "Alice";
    const v1 = state.seats[0]!.minions[0]!;
    v1.locked = true;
    v1.blood = 0;
    state.frames = [
      {
        kind: "turn",
        seat: "Alice",
        phase: "unlock",
        turnNumber: 1,
        unlockDone: false,
        edgeDone: false,
        unlockAbilitiesDone: false,
        unlockOthersDone: [],
        transfersLeft: 0,
        masterActionsLeft: 0,
        trifleGained: false,
      },
    ];
    const engine = new VtesEngine(state, testRegistry);

    // Unlock happens automatically; the Edge holder is then asked.
    const dp = engine.decision()!;
    expect(dp.window).toBe("turn.unlock");
    expect(v1.locked).toBe(false); // unlocked before the Edge decision

    runTrace(engine, [
      ["Alice", "edge:gain"],
      // The unlock window stays open: with an empty library and a short
      // hand, a withdrawal may be announced here (p. 38). Declined.
      ["Alice", "pass"],
      // Master phase (no master cards yet).
      ["Alice", "pass"],
      // Minion phase: V1 is empty → hunting is mandatory and exclusive.
      ["Alice", "hunt:V1"],
      // Hunt is undirected: announce cycle is [Alice, prey Bob, predator
      // Carol], then state A (both prey and predator may block), then C.
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      // Hunt resolved (+1 blood). V1 locked → only "end" remains.
      ["Alice", "end"],
      // Influence phase (transfers arrive later).
      ["Alice", "pass"],
      // Discard phase: use the discard action on Conditioning.
      ["Alice", "discard:c1"],
    ]);

    expect(state.seats[0]!.pool).toBe(11); // Edge pool gained
    expect(v1.blood).toBe(1); // hunted from empty
    expect(v1.locked).toBe(true);
    expect(state.seats[0]!.hand).toHaveLength(0); // discarded, empty library

    // The hunt was announced at +1 inherent stealth.
    const stealth = state.eventLog.find((e) => e.type === "StealthModified")!;
    expect(stealth).toMatchObject({ delta: 1, source: "hunt" });

    // Bob's turn began. He holds no Edge, but his library is empty and his
    // hand is short, so his unlock phase offers the withdrawal (p. 38);
    // declining it takes him to the master phase.
    const bobUnlock = engine.decision()!;
    expect(bobUnlock.seat).toBe("Bob");
    expect(bobUnlock.window).toBe("turn.unlock");
    expect(bobUnlock.options.map((o) => o.id)).toEqual(["withdraw", "pass"]);
    runTrace(engine, [["Bob", "pass"]]);

    const next = engine.decision()!;
    expect(next.seat).toBe("Bob");
    expect(next.window).toBe("turn.master");
    const began = state.eventLog.find((e) => e.type === "TurnBegan")!;
    expect(began).toMatchObject({ seat: "Bob", turnNumber: 2 });
  });

  it("ousts a Methuselah at 0 pool: predator gains 1 VP and 6 pool, prey relinks", () => {
    const state = threeSeatGame();
    state.seats[1]!.pool = 1; // Bob is one bleed from the grave
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "pass"],
      ["Carol", "pass"],
    ]);

    // Bleed of 1 resolved → Bob at 0 pool → ousted.
    const [alice, bob] = state.seats;
    expect(bob!.ousted).toBe(true);
    expect(bob!.minions).toHaveLength(0);
    expect(alice!.victoryPoints).toBe(1);
    expect(alice!.pool).toBe(16); // 10 + 6 for ousting her prey
    expect(state.edge).toBe("Alice");

    // Carol is Alice's new prey; the game continues (2 standing).
    expect(preyOf(state, "Alice")).toBe("Carol");
    expect(state.eventLog.some((e) => e.type === "GameEnded")).toBe(false);

    // Alice is still in her minion phase.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    expect(dp.window).toBe("turn.minion");
  });
});
