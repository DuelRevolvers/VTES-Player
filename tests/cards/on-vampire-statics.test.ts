/**
 * On-vampire static permanents gate (docs/on-vampire-statics-design.md):
 * action cards that attach to the acting vampire granting a persistent
 * static — Heart of the City (+bleed), Preternatural Strength (+strength).
 */

import { describe, expect, it } from "vitest";
import type { PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** A card already attached to a vampire, carrying a persistent static. */
function attached(id: string, name: string, statics: PermanentInPlay["statics"]): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics, tags: [name] };
}

describe("Heart of the City (100904) — +1 bleed self-attach", () => {
  it("attaches to the acting vampire on a successful stealth action", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "basic" };
    v1.blood = 3;
    state.seats[0]!.hand.push({ id: "hc1", name: "Heart of the City" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "play:Heart of the City:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C
    ]);

    const perm = v1.attached.find((p) => p.card.name === "Heart of the City");
    expect(perm).toBeDefined();
    expect(perm!.statics.bleed).toBe(1);
  });

  it("raises the vampire's bleed by its static", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.attached.push(attached("hc1", "Heart of the City", { bleed: 1 }));
    const bobStart = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects (no block)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects → resolve
    ]);

    expect(state.seats[1]!.pool).toBe(bobStart - 2); // base 1 + Heart 1
  });

  it("cannot be played twice on the same vampire", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pre: "basic" };
    v1.blood = 3;
    v1.attached.push(attached("hc0", "Heart of the City", { bleed: 1 }));
    state.seats[0]!.hand.push({ id: "hc1", name: "Heart of the City" });
    const engine = new VtesEngine(state, testRegistry);

    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Heart of the City"))).toBe(false);
  });
});

describe("Preternatural Strength (101483) — +1 strength self-attach", () => {
  it("raises the bearer's combat strength", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.blood = 5;
    v1.capacity = 5;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.strength = 1;
    m.attached.push(attached("ps1", "Preternatural Strength", { strength: 1 }));
    const engine = new VtesEngine(state, testRegistry);

    // V1 bleeds, M blocks → combat; M strikes with hand for strength (2).
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range → close
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"],
      ["Bob", "strike:hand"], // M strikes for strength 1+1 = 2
      ["Alice", "pass"], // V1 mends M's 2 damage
      ["Bob", "pass"], // M mends V1's hand strike
      ["Alice", "pass"], ["Bob", "pass"], // press
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // end of round
    ]);

    const dmg = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "V1",
    );
    expect(dmg).toMatchObject({ amount: 2 });
  });
});
