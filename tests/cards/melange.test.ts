/**
 * Melange (101195) — superior: +1 intercept, and if the vampire blocks,
 * put the card on the acting minion (you keep control); later, during a
 * bleed against the controller of that minion, burn it for +1 bleed.
 * Modeled seat-level on the controller, tagged with the actor.
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("Melange (101195)", () => {
  it("attaches to the blocker's seat (tagged with the actor) on a successful block", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "basic", obf: "basic" };
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { aus: "superior" };
    state.seats[1]!.hand.push({ id: "mel1", name: "Melange" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "play:Lost in Crowds:basic"], // stealth 1
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
      ["Alice", "pass"],
      ["Bob", "play:Melange:superior:M"], // +1 intercept (→ block succeeds) + attach
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // Melange as-played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt → success
    ]);

    expect(state.eventLog.some((e) => e.type === "BlockSucceeded" && e.blocker === "M")).toBe(true);
    const mel = state.seats[1]!.permanents.find((p) => p.card.name === "Melange");
    expect(mel).toBeDefined();
    expect(mel!.tags.includes("melangeOn:V1")).toBe(true);
  });

  it("burns for +1 bleed during a bleed against the attached minion's controller", () => {
    const state = threeSeatGame();
    // Carol's turn: Carol (Alice's predator) bleeds Alice; V1 is Alice's, so
    // Melange (on V1, controlled by Bob) qualifies.
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Carol";
    state.seats[2]!.minions[0]!.disciplines = {}; // N bleeds
    const mel: PermanentInPlay = {
      card: { id: "mel1", name: "Melange" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Melange", "melangeOn:V1"],
    };
    state.seats[1]!.permanents.push(mel);
    const aliceStart = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Carol", "bleed:N"], // Carol bleeds Alice (prey)
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // announce
      ["Carol", "pass"], ["Alice", "pass"],
      ["Bob", "ability:Melange:mel1:bleed"], // burn Melange → +1 bleed
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"], // effects → resolve
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
    ]);

    expect(state.seats[0]!.pool).toBe(aliceStart - 2); // base 1 + Melange 1
    expect(state.seats[1]!.permanents.some((p) => p.card.id === "mel1")).toBe(false); // burned
  });
});
