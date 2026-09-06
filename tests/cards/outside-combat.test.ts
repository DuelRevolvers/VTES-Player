/**
 * Acting on a combat you are not in (docs/outside-combat-design.md).
 *
 * p. 28: "Some combat cards are played by minions 'not involved in the
 * current combat'. Minions controlled by ANY Methuselah can play those
 * cards." Damage resolution used to ask only the victim's controller, so
 * none of this was reachable.
 *
 * Martyr's Resilience (101175), Saulot's Guiding Wisdom (102258).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice's V1 rushes Bob's W; Carol watches from outside. */
function combatGame(): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: { obl: "superior" }, blood: 4 });
  state.seats[0]!.hand.push({ id: "uc1", name: "Umbrous Clutch" });
  return state;
}

function intoCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "play:Umbrous Clutch:superior:V1:W"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → combat
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ["Alice", "pass"], ["Bob", "pass"], // range
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
    ["Alice", "strike:hand"], ["Bob", "strike:hand"],
  ]);
}

describe("Martyr's Resilience (101175)", () => {
  it("lets a THIRD Methuselah prevent damage in a combat they are not in", () => {
    // Carol is neither combatant — p. 28 says she may still play it.
    const state = combatGame();
    state.seats[2]!.minions.push(
      makeMinion("C2", "Carol", { disciplines: { aus: "basic", for: "basic" }, blood: 4 }),
    );
    state.seats[2]!.hand.push({ id: "mr1", name: "Martyr's Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    intoCombat(engine);

    // The victim's controller is asked first (p. 31) …
    const first = engine.decision()!;
    expect(first.window).toBe("combat.damageResolution");
    runTrace(engine, [[first.seat, "pass"]]);

    // … and then Carol, who is in the cycle because she has something to
    // play. She can aim it at either combatant.
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Carol");
    const ids = dp.options.map((o) => o.id);
    expect(ids.some((i) => i.includes("Martyr's Resilience:basic:C2:W"))).toBe(true);

    const before = find(state, "W").blood;
    runTrace(engine, [
      ["Carol", "play:Martyr's Resilience:basic:C2:W:mr1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    // Preventing all of W's pending damage removes that item outright, so
    // the next one (V1's) opens its own window with Alice first.
    expect(state.eventLog.some((e) => e.type === "DamagePrevented")).toBe(true);
    for (let i = 0; i < 10 && engine.decision(); i++) {
      const d = engine.decision()!;
      if (d.window !== "combat.damageResolution") break;
      runTrace(engine, [[d.seat, "pass"]]);
    }
    // W never burned blood to mend: the damage was prevented outright.
    expect(find(state, "W").blood).toBe(before);
  });

  it("is not offered to a vampire who IS in the combat", () => {
    const state = combatGame();
    // Bob's own combatant holds the disciplines and the card.
    Object.assign(find(state, "W"), { disciplines: { aus: "basic", for: "basic" }, blood: 4 });
    state.seats[1]!.hand.push({ id: "mr1", name: "Martyr's Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    intoCombat(engine);
    const dp = engine.decision()!;
    // W is a combatant, so W may not play it; Bob's OTHER minion M has no
    // disciplines, so there is no legal player at all.
    expect(dp.options.some((o) => o.id.includes("Martyr's Resilience"))).toBe(false);
  });

  it("is not offered to a LOCKED outside vampire — the card says unlocked", () => {
    const state = combatGame();
    state.seats[2]!.minions.push(
      makeMinion("C2", "Carol", {
        disciplines: { aus: "basic", for: "basic" },
        blood: 4,
        locked: true,
      }),
    );
    state.seats[2]!.hand.push({ id: "mr1", name: "Martyr's Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    intoCombat(engine);
    // Carol has nothing playable, so she is not even in the cycle.
    for (let i = 0; i < 4 && engine.decision(); i++) {
      const d = engine.decision()!;
      if (d.window !== "combat.damageResolution") break;
      expect(d.seat).not.toBe("Carol");
      runTrace(engine, [[d.seat, "pass"]]);
    }
  });
});

describe("Saulot's Guiding Wisdom (102258)", () => {
  function withSaulot(state: GameState): void {
    const salubri = makeMinion("S1", "Alice", { blood: 4 });
    salubri.clan = "Salubri";
    salubri.sect = "independent";
    salubri.attached.push({
      card: { id: "sgw", name: "Saulot's Guiding Wisdom" },
      locked: false,
      usedThisPhase: false,
      statics: { votes: 2 },
      tags: ["Saulot's Guiding Wisdom"],
    });
    state.seats[0]!.minions.push(salubri);
  }

  it("casts 2 votes from the card, with no printed title at all", () => {
    const state = threeSeatGame();
    withSaulot(state);
    state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Anarchist Uprising"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // → polling
    ]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const vote = dp.options.find((o) => o.id === "vote:S1:for");
    expect(vote).toBeDefined();
    expect(vote!.label).toContain("2 votes");
    // The vampire has no VampireTitle — the votes are the card's.
    expect(find(state, "S1").title).toBeNull();
  });

  it("ends a combat involving another minion you control, once a turn", () => {
    const state = combatGame();
    withSaulot(state);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:superior:V1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // → combat
    ]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.beforeRange");
    expect(dp.seat).toBe("Alice");
    expect(
      dp.options.some((o) => o.id === "ability:Saulot's Guiding Wisdom:sgw:endcombat"),
    ).toBe(true);

    runTrace(engine, [["Alice", "ability:Saulot's Guiding Wisdom:sgw:endcombat"]]);
    // The Salubri locked, and combat jumped to End of Round (p. 32) —
    // no strikes were ever chosen.
    expect(find(state, "S1").locked).toBe(true);
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf && cf.kind === "combat" ? cf.step : "gone").toBe("endOfRound");
  });

  it("cannot end a combat its own bearer is in", () => {
    // "another minion you control" — the Salubri itself does not count.
    const state = threeSeatGame();
    withSaulot(state);
    Object.assign(find(state, "S1"), { disciplines: { obl: "superior" } });
    state.seats[0]!.hand.push({ id: "uc1", name: "Umbrous Clutch" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Umbrous Clutch:superior:S1:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Saulot's Guiding Wisdom")),
    ).toBe(false);
  });
});
