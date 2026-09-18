/**
 * The mummies, closed out (docs/mummies-design.md §§4-5, wave 49).
 * Akhenaten (100033), Kherebutu (101047), Tutu the Doubly Evil One
 * (102048).
 *
 * The shared new arm is `burnSelfAndBurnMinion`: the PRICE is the actor,
 * so what is worth pinning is that both die and that the filters bar the
 * targets the cards do not name.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function allyInPlay(state: GameState, seat: string, id: string, name: string): MinionState {
  const stats = testRegistry[name]!.allyEntry!(null);
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats.statics ?? {},
    tags: stats.tags ?? [],
  };
  const m = makeAlly(id, seat, 3, { name, attached: [self], strength: 3 });
  state.seats.find((s) => s.id === seat)!.minions.push(m);
  return m;
}

function ids(engine: VtesEngine): string[] {
  return (engine.decision()?.options ?? []).map((o) => o.id);
}

function settle(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action")) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("burnSelfAndBurnMinion — the price is the actor", () => {
  it("Akhenaten takes a Ministry of his PREY with him, and nobody else", () => {
    const state = threeSeatGame(); // Alice → Bob → Carol
    allyInPlay(state, "Alice", "ak", "Akhenaten, The Sun Pharaoh");
    Object.assign(find(state, "W")!, { clan: "Ministry" }); // Bob = prey
    Object.assign(find(state, "M")!, { clan: "Ventrue" }); // wrong clan
    Object.assign(find(state, "N")!, { clan: "Ministry" }); // Carol = predator
    const engine = new VtesEngine(state, testRegistry);
    const acts = ids(engine).filter((o) => o.startsWith("act:Akhenaten"));
    expect(acts.some((o) => o.endsWith("kill:W"))).toBe(true);
    expect(acts.some((o) => o.endsWith("kill:M"))).toBe(false); // not Ministry
    expect(acts.some((o) => o.endsWith("kill:N"))).toBe(false); // not the prey
    runTrace(engine, [["Alice", acts.find((o) => o.endsWith("kill:W"))!]]);
    settle(engine, state);
    expect(find(state, "W")).toBeUndefined();
    expect(find(state, "ak")).toBeUndefined(); // he burns too
    expect(state.seats[0]!.library.some((c) => c.id === "ak")).toBe(true); // shuffled home
  });

  it("Kherebutu's capacity cap bars a big Tremere", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "kh", "Kherebutu");
    Object.assign(find(state, "W")!, { clan: "Tremere", capacity: 4 });
    state.seats[1]!.minions.push(
      makeMinion("BIG", "Bob", { clan: "Tremere", capacity: 5 }),
    );
    const acts = ids(new VtesEngine(state, testRegistry)).filter((o) => o.startsWith("act:Kherebutu"));
    expect(acts.some((o) => o.endsWith("kill:W"))).toBe(true);
    expect(acts.some((o) => o.endsWith("kill:BIG"))).toBe(false);
  });
});

describe("Akhenaten's aggravated clause (§4)", () => {
  it("is a static read where a strike becomes damage, so it reaches any damage", () => {
    expect(
      testRegistry["Akhenaten, The Sun Pharaoh"]!.allyEntry!(null).statics
        .allDamageAggravatedVsClan,
    ).toBe("Ministry");
  });
});

describe("Tutu the Doubly Evil One (102048)", () => {
  it("steals equipment only from a vampire IN TORPOR", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "tu", "Tutu the Doubly Evil One");
    const gear = (id: string): PermanentInPlay => ({
      card: { id, name: ".44 Magnum" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["equipment"],
    });
    find(state, "W")!.attached.push(gear("g1")); // ready — not a target
    state.seats[1]!.minions.push(
      makeMinion("T", "Bob", { inTorpor: true, blood: 1, capacity: 3, attached: [gear("g2")] }),
    );
    const acts = ids(new VtesEngine(state, testRegistry)).filter((o) => o.startsWith("act:Tutu"));
    expect(acts.some((o) => o.endsWith("equip:g2"))).toBe(true);
    expect(acts.some((o) => o.endsWith("equip:g1"))).toBe(false);
  });

  it("unlocks during its controller's minion phase", () => {
    const state = threeSeatGame();
    const tutu = allyInPlay(state, "Alice", "tu", "Tutu the Doubly Evil One");
    tutu.locked = true;
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "master";
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || find(state, "tu")!.locked === false) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(find(state, "tu")!.locked).toBe(false);
  });
});
