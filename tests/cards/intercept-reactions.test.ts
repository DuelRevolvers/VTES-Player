/**
 * Intercept-reaction cluster (docs/one-off-sweep.md): the
 * `actionDirectedAtYou` usability (The Warrens, Eyes of Argus) and the
 * blocker-combat-rider ("if this vampire blocks, it gets a maneuver in the
 * resulting combat" — Spirit's Touch).
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

describe("The Warrens (102216)", () => {
  it("gives a titled Nosferatu +3 intercept on an action directed at you", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "basic", obf: "basic" };
    v1.blood = 3;
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.clan = "Nosferatu";
    m.title = "prince";
    m.blood = 2;
    state.seats[1]!.hand.push({ id: "tw1", name: "The Warrens" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "play:Lost in Crowds:basic"], // stealth 1 → intercept needed
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
      ["Alice", "pass"],
      ["Bob", "play:The Warrens:basic:M"], // +2 +1 (titled) = +3
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // Warrens as-played
    ]);

    const ev = state.eventLog.find(
      (e) => e.type === "InterceptModified" && e.minion === "M",
    );
    expect(ev && ev.type === "InterceptModified" ? ev.delta : 0).toBe(3);
  });
});

describe("Eyes of Argus (100680)", () => {
  it("superior: a locked vampire wakes", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.disciplines = { dom: "basic" };
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { aus: "superior" };
    m.locked = true;
    state.seats[1]!.hand.push({ id: "ea1", name: "Eyes of Argus" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "play:Eyes of Argus:superior:M"], // locked M wakes
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
    ]);

    expect(state.eventLog.some((e) => e.type === "MinionWoke" && e.minion === "M")).toBe(true);
  });
});

describe("Spirit's Touch (101850)", () => {
  it("superior: the blocker gets a maneuver in the resulting combat", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { dom: "basic", obf: "basic" };
    v1.blood = 3;
    state.seats[0]!.hand.push({ id: "lic1", name: "Lost in Crowds" });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.disciplines = { aus: "superior" };
    state.seats[1]!.hand.push({ id: "st1", name: "Spirit's Touch" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:M"],
      ["Alice", "play:Lost in Crowds:basic"], // stealth 1
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // LiC as-played
      ["Alice", "pass"],
      ["Bob", "play:Spirit's Touch:superior:M"], // +1 intercept (block succeeds) + maneuver rider
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played
      // intercept 1 ≥ stealth 1 → block succeeds → combat begins.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block attempt resolves
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], // range step: acting side first, no maneuver
    ]);

    // Now the blocker (Bob) is asked and holds a maneuver credit.
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.range");
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id === "maneuver:credit")).toBe(true);
  });
});
