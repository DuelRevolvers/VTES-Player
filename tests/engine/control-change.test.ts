/**
 * Control vs ownership (docs/control-change-design.md; rulebook p. 16,
 * p. 43). Control can move between Methuselahs; ownership never does.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "./fixtures.ts";

function loc(id: string, name: string, controller?: string): PermanentInPlay {
  const e: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
  };
  if (controller !== undefined) e.controller = controller;
  return e;
}

describe("control change", () => {
  it("moves a minion between Methuselahs with everything on it", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions[0]!;
    w.owner = "Bob";
    w.blood = 3;
    w.locked = true;
    w.corruption = { Alice: 2 };
    w.attached.push(loc("gun", "A Weapon"));
    const engine = new VtesEngine(state, testRegistry);

    engine.changeMinionControl("W", "Alice");

    expect(state.seats[1]!.minions.some((m) => m.id === "W")).toBe(false);
    const moved = state.seats[0]!.minions.find((m) => m.id === "W")!;
    expect(moved.controller).toBe("Alice");
    expect(moved.owner).toBe("Bob"); // ownership never moves (p. 16)
    expect(moved.blood).toBe(3);
    expect(moved.locked).toBe(true);
    expect(moved.corruption).toEqual({ Alice: 2 });
    expect(moved.attached).toHaveLength(1);
  });

  it("sends a stolen vampire to its OWNER's uncontrolled region", () => {
    const state = threeSeatGame();
    const w = state.seats[1]!.minions[0]!;
    w.owner = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    engine.changeMinionControl("W", "Alice");

    engine.emit({ type: "MovedToUncontrolled", seat: "Alice", minion: "W" });

    expect(state.seats[0]!.uncontrolled).toHaveLength(0);
    expect(state.seats[1]!.uncontrolled.some((u) => u.card.id === "W")).toBe(true);
    expect(state.seats[0]!.minions.some((m) => m.id === "W")).toBe(false);
  });

  it("moves a seat-level card in play, and its abilities go with it", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("pm1", "Powerbase: Montreal"));
    const engine = new VtesEngine(state, testRegistry);

    engine.changePermanentControl("pm1", "Bob");

    expect(state.seats[0]!.permanents).toHaveLength(0);
    const moved = state.seats[1]!.permanents.find((p) => p.card.id === "pm1")!;
    expect(moved.controller).toBe("Bob");
  });

  it("an ousted Methuselah's controlled cards leave play; cards they own but others control stay", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("aliceLoc", "Academic Hunting Ground"));
    // Alice has taken control of Bob's vampire W.
    const w = state.seats[1]!.minions[0]!;
    w.owner = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    engine.changeMinionControl("W", "Alice");
    // Bob also owns a location that Carol controls.
    state.seats[2]!.permanents.push(loc("bobLoc", "Park Hunting Ground", "Carol"));

    engine.emit({ type: "PoolBurned", seat: "Alice", amount: 10 });
    engine.decision(); // settle → oust sweep

    expect(state.seats[0]!.ousted).toBe(true);
    expect(state.seats[0]!.permanents).toHaveLength(0); // p. 43
    expect(state.seats[0]!.minions).toHaveLength(0); // incl. the stolen W
    // Bob's card that Carol controls "remains in play as normal".
    expect(state.seats[2]!.permanents.some((p) => p.card.id === "bobLoc")).toBe(true);
  });

  it("a master on another Methuselah's minion is controlled by the player who placed it (p. 16)", () => {
    const state = threeSeatGame();
    // Alice's master card, sitting on Bob's minion.
    state.seats[1]!.minions[0]!.attached.push(loc("pentex", "Some Master", "Alice"));
    // Equipment, by contrast, records no controller: the bearer's.
    state.seats[1]!.minions[0]!.attached.push(loc("gun", "A Weapon"));
    const engine = new VtesEngine(state, testRegistry);

    // changePermanentControl reads the recorded controller as the "from".
    engine.changePermanentControl("pentex", "Carol");
    const events = state.eventLog.filter((e) => e.type === "ControlChanged");
    expect(events[0]).toMatchObject({ from: "Alice", to: "Carol", target: "permanent" });
    // It stays attached to Bob's minion, only control moved.
    expect(state.seats[1]!.minions[0]!.attached.some((p) => p.card.id === "pentex")).toBe(true);

    engine.changePermanentControl("gun", "Carol");
    const last = state.eventLog.filter((e) => e.type === "ControlChanged").at(-1)!;
    expect(last).toMatchObject({ from: "Bob" }); // inferred from the bearer
  });

  it("only the new controller can act with a stolen minion", () => {
    const state = threeSeatGame();
    state.seats[1]!.minions[0]!.owner = "Bob";
    const engine = new VtesEngine(state, testRegistry);
    engine.changeMinionControl("W", "Alice");

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice"); // Alice's minion phase
    expect(dp.options.some((o) => o.id === "bleed:W")).toBe(true);
  });
});
