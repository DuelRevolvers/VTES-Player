/**
 * Before-range attachments (docs/before-range-attachments-design.md).
 * Focus the Blood (100753), Nosferatu Putrescence (101302),
 * Magazine (101142).
 *
 * All three are played before range and LAND somewhere that pays off
 * later, in three different places: on the vampire with blood on it, on
 * either combatant whoever controls them, and on a GUN holding an ammo
 * card. What is worth pinning is where each one may land and where it
 * may not.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Alice's V1 bleeds Bob, Bob's W blocks: a real combat, beforeRange. */
function combat(state: GameState): VtesEngine {
  const tf = state.frames.find((f) => f.kind === "turn")!;
  if (tf.kind === "turn") tf.phase = "minion";
  const engine = new VtesEngine(state, testRegistry);
  // Walk to the block rather than tracing it: the announce cycle asks a
  // different number of seats depending on what is in play, and a fixed
  // trace would break every time a card is added to the fixture.
  for (let i = 0; i < 30; i++) {
    if (state.frames.some((f) => f.kind === "combat")) break;
    const dp = engine.decision();
    if (!dp) break;
    const want =
      dp.options.find((o) => o.id === "bleed:V1") ??
      dp.options.find((o) => o.id === "block:W") ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, want.id]]);
  }
  return engine;
}

/** Play a card and let the as-played window close. */
function playAndSettle(engine: VtesEngine, state: GameState, seat: string, id: string): void {
  runTrace(engine, [[seat, id]]);
  for (let i = 0; i < 20; i++) {
    if (!state.frames.some((f) => f.kind === "cardPlay")) return;
    const dp = engine.decision();
    if (!dp) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("Focus the Blood (100753)", () => {
  it("needs a Banu Haqim, and puts the vampire's OWN blood on the card", () => {
    const state = threeSeatGame();
    const v1 = find(state, "V1")!;
    Object.assign(v1, { clan: "Ventrue", blood: 4 });
    state.seats[0]!.hand.push({ id: "fb", name: "Focus the Blood" });
    const engine = combat(state);
    // NEGATIVE SPACE: the clan icon is a requirement (p. 10).
    expect(ids(engine).some((i) => i.startsWith("play:Focus the Blood"))).toBe(false);

    const s2 = threeSeatGame();
    Object.assign(find(s2, "V1")!, { clan: "Banu Haqim", blood: 4 });
    s2.seats[0]!.hand.push({ id: "fb", name: "Focus the Blood" });
    const e2 = combat(s2);
    const play = ids(e2).find((i) => i.startsWith("play:Focus the Blood"));
    expect(play).toBeDefined();
    playAndSettle(e2, s2, "Alice", play!);
    const bearer = find(s2, "V1")!;
    // The blood MOVED: 4 → 3 on the vampire, 1 on the card.
    expect(bearer.blood).toBe(3);
    expect(bearer.attached.find((p) => p.card.id === "fb")?.counters).toBe(1);
  });
});

describe("Nosferatu Putrescence (101302)", () => {
  it("is played from OUTSIDE the combat, onto a Nosferatu in it, and only a Nosferatu", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { clan: "Ventrue" });
    Object.assign(find(state, "W")!, { clan: "Nosferatu" });
    // Carol is in neither seat of this combat and holds the card.
    state.seats[2]!.hand.push({ id: "np", name: "Nosferatu Putrescence" });
    const engine = combat(state);
    // beforeRange cycles the table, not just the combatants: walk on to
    // Carol's impulse, which is the whole point of the printed clause.
    for (let i = 0; i < 10 && engine.decision()?.seat !== "Carol"; i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(engine.decision()?.seat).toBe("Carol");
    const plays = ids(engine).filter((i) => i.startsWith("play:Nosferatu Putrescence"));
    expect(plays.some((i) => i.includes(":W:"))).toBe(true); // the Nosferatu
    expect(plays.some((i) => i.includes(":V1:"))).toBe(false); // the Ventrue
    playAndSettle(engine, state, "Carol", plays.find((i) => i.includes(":W:"))!);
    expect(find(state, "W")!.attached.some((p) => p.statics.strength === -1)).toBe(true);
  });
});

describe("Magazine (101142)", () => {
  it("goes on a GUN with an ammo card, and is not offered with neither", () => {
    const build = (opts: { gun: boolean; ammo: boolean }): VtesEngine => {
      const state = threeSeatGame();
      if (opts.gun) {
        find(state, "V1")!.attached.push({
          card: { id: "g1", name: ".44 Magnum" },
          locked: false,
          usedThisPhase: false,
          statics: {},
          tags: ["equipment", "weapon", "gun"],
        });
      }
      state.seats[0]!.hand.push({ id: "mg", name: "Magazine" });
      if (opts.ammo) state.seats[0]!.hand.push({ id: "am", name: "Manstopper Rounds" });
      return combat(state);
    };
    expect(ids(build({ gun: true, ammo: true })).some((i) => i.startsWith("play:Magazine"))).toBe(
      true,
    );
    // NEGATIVE SPACE: both halves of the sentence are required.
    expect(ids(build({ gun: true, ammo: false })).some((i) => i.startsWith("play:Magazine"))).toBe(
      false,
    );
    expect(ids(build({ gun: false, ammo: true })).some((i) => i.startsWith("play:Magazine"))).toBe(
      false,
    );
  });

  it("stores the ammo card out of hand, linked to the gun it was put on", () => {
    const state = threeSeatGame();
    find(state, "V1")!.attached.push({
      card: { id: "g1", name: ".44 Magnum" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["equipment", "weapon", "gun"],
    });
    state.seats[0]!.hand.push({ id: "mg", name: "Magazine" }, { id: "am", name: "Manstopper Rounds" });
    const engine = combat(state);
    const play = ids(engine).find((i) => i.startsWith("play:Magazine"))!;
    playAndSettle(engine, state, "Alice", play);
    const entry = find(state, "V1")!.attached.find((p) => p.card.id === "mg")!;
    expect(entry.stored?.map((c) => c.name)).toEqual(["Manstopper Rounds"]);
    expect(entry.tags).toContain("gun:g1");
    expect(state.seats[0]!.hand.some((c) => c.id === "am")).toBe(false);
  });
});

describe("the ammo rules are asked through ONE helper", () => {
  it("every ammo card still reports its load, which is what Magazine fires", () => {
    for (const name of [
      "Manstopper Rounds",
      "Glaser Rounds",
      "Scattershot",
      "Dragon's Breath Rounds",
      "Caseless Rounds",
    ]) {
      expect(testRegistry[name]?.ammoLoad?.(null)).toBeDefined();
    }
    // Glaser's load-time gate rides on the load, so both paths see it.
    expect(testRegistry["Glaser Rounds"]!.ammoLoad!(null)!.minGunUses).toBe(2);
    expect(testRegistry[".44 Magnum"]?.ammoLoad?.(null)).toBeUndefined();
  });
});

// Keep the fixture helper referenced even if a case above is trimmed.
void makeMinion;
