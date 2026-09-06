/**
 * The after-action-resolution window (docs/after-resolution-design.md).
 *
 * Freak Drive (100788), Shadow Cast (102280), Shadow Cloak (102281),
 * Fever Pitch (102321).
 *
 * The window itself is the new thing, so the first block pins its shape:
 * it opens only when someone can use it, it sits after the action has
 * resolved, and — for a blocked action — after the combat.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, untargetableBy } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function attached(state: GameState, minion: string, cardId: string): PermanentInPlay | undefined {
  return find(state, minion).attached.find((p) => p.card.id === cardId);
}

/** V1 bleeds Bob unopposed; stop once the action has resolved. */
function unopposedBleed(
  hand: Array<{ id: string; name: string }>,
  v1: Partial<MinionState> = {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { blood: 3, ...v1 });
  state.seats[0]!.hand.push(...hand);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C → resolves
  ]);
  return { state, engine };
}

describe("the window itself", () => {
  it("does NOT open when nobody can use it", () => {
    // The recorded deviation (design §3): an unconditional impulse after
    // every action would be a decision per seat per action all game.
    const { state, engine } = unopposedBleed([]);
    expect(state.frames.some((f) => f.kind === "action")).toBe(false);
    expect(engine.decision()!.window).toBe("turn.minion");
  });

  it("opens after the action has RESOLVED — the bleed already landed", () => {
    const { state, engine } = unopposedBleed([{ id: "fd", name: "Freak Drive" }], {
      disciplines: { for: "basic" },
    });
    const dp = engine.decision()!;
    expect(dp.window).toBe("action.afterResolution");
    // Bob has already lost the pool: this is after resolution, not before.
    expect(state.seats[1]!.pool).toBe(9);
    expect(dp.options.some((o) => o.id.startsWith("play:Freak Drive:basic"))).toBe(true);
  });

  it("offers no block options — the action is over", () => {
    const { engine } = unopposedBleed([{ id: "fd", name: "Freak Drive" }], {
      disciplines: { for: "basic" },
    });
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("block:"))).toBe(false);
  });
});

describe("Freak Drive (100788)", () => {
  it("basic unlocks the vampire after a successful action", () => {
    const { state, engine } = unopposedBleed([{ id: "fd", name: "Freak Drive" }], {
      disciplines: { for: "basic" },
    });
    expect(find(state, "V1").locked).toBe(true);
    const blood = find(state, "V1").blood;

    runTrace(engine, [
      ["Alice", "play:Freak Drive:basic:V1:fd"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // window closes
    ]);
    expect(find(state, "V1").locked).toBe(false);
    expect(find(state, "V1").blood).toBe(blood - 1);
  });

  it("basic is NOT usable after a blocked action, and superior is", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, disciplines: { for: "superior" } });
    state.seats[0]!.hand.push({ id: "fd", name: "Freak Drive" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
    ]);
    // Drive the combat to its end; the window comes AFTER it (p. 48).
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp || dp.window === "action.afterResolution") break;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    const dp = engine.decision()!;
    expect(dp.window).toBe("action.afterResolution");
    expect(state.eventLog.some((e) => e.type === "CombatEnded")).toBe(true);

    const ids = dp.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Freak Drive:superior"))).toBe(true);
    // "Only usable if the action was SUCCESSFUL" — it was blocked.
    expect(ids.some((i) => i.startsWith("play:Freak Drive:basic"))).toBe(false);
  });

  it("p. 48: is playable even if the vampire is in torpor", () => {
    const { state, engine } = unopposedBleed([{ id: "fd", name: "Freak Drive" }], {
      disciplines: { for: "basic" },
    });
    // A combat during the action could have put them here; the window is
    // the same one either way.
    find(state, "V1").inTorpor = true;
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Freak Drive:basic"))).toBe(true);
  });

  it("…but not without the blood to pay for it (p. 48)", () => {
    const { state, engine } = unopposedBleed([{ id: "fd", name: "Freak Drive" }], {
      disciplines: { for: "basic" },
    });
    find(state, "V1").blood = 0;
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((i) => i.startsWith("play:Freak Drive"))).toBe(false);
  });
});

describe("Shadow Cast (102280)", () => {
  function placed(): { state: GameState; engine: VtesEngine } {
    const { state, engine } = unopposedBleed([{ id: "sc", name: "Shadow Cast" }], {
      disciplines: { obl: "superior" },
    });
    runTrace(engine, [
      ["Alice", "play:Shadow Cast:superior:V1:sc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // window closes
    ]);
    return { state, engine };
  }

  it("attaches itself and records the Methuselah the action was aimed at", () => {
    const { state } = placed();
    const entry = attached(state, "V1", "sc");
    expect(entry).toBeDefined();
    expect(entry!.tags).toContain("shadowCast");
    // The bleed was directed at Alice's prey, Bob.
    expect(entry!.againstSeat).toBe("Bob");
  });

  it("burns for +1 stealth against the SAME Methuselah, not another", () => {
    const { state } = placed();
    // Ready to bleed again: unlocked, and the one-bleed-per-turn record
    // cleared (p. 23).
    Object.assign(find(state, "V1"), { locked: false, bledThisTurn: false });

    // A bleed at Bob again: the card is live.
    const e2 = new VtesEngine(state, testRegistry);
    runTrace(e2, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(
      e2.decision()!.options.some((o) => o.id === "ability:Shadow Cast:sc:stealth"),
    ).toBe(true);
  });

  it("is not offered when the action is aimed elsewhere", () => {
    const { state } = placed();
    const entry = attached(state, "V1", "sc")!;
    entry.againstSeat = "Carol"; // a different Methuselah
    Object.assign(find(state, "V1"), { locked: false, bledThisTurn: false });

    const e2 = new VtesEngine(state, testRegistry);
    runTrace(e2, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(
      e2.decision()!.options.some((o) => o.id === "ability:Shadow Cast:sc:stealth"),
    ).toBe(false);
  });

  it("its superior needs a DIRECTED action — a hunt places nothing", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, disciplines: { obl: "superior" } });
    state.seats[0]!.hand.push({ id: "sc", name: "Shadow Cast" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // A hunt is undirected, so the window never opens for this card.
    expect(state.frames.some((f) => f.kind === "action")).toBe(false);
    expect(attached(state, "V1", "sc")).toBeUndefined();
  });
});

describe("Shadow Cloak (102281)", () => {
  it("protects the bearer from minions without Auspex, but not from those with it", () => {
    const { state, engine } = unopposedBleed([{ id: "sk", name: "Shadow Cloak" }], {
      disciplines: { obl: "superior" },
    });
    runTrace(engine, [
      ["Alice", "play:Shadow Cloak:superior:V1:sk"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const entry = attached(state, "V1", "sk");
    expect(entry?.statics.untargetableExceptDiscipline).toBe("aus");

    const v1 = find(state, "V1");
    const plain = find(state, "M");
    expect(untargetableBy(v1, "Bob", plain)).toBe(true);
    plain.disciplines = { aus: "basic" };
    expect(untargetableBy(v1, "Bob", plain)).toBe(false);
    // Its own controller is never blocked by it.
    expect(untargetableBy(v1, "Alice", plain)).toBe(false);
  });

  it("burns itself in its controller's unlock phase", () => {
    const { state, engine } = unopposedBleed([{ id: "sk", name: "Shadow Cloak" }], {
      disciplines: { obl: "superior" },
    });
    runTrace(engine, [
      ["Alice", "play:Shadow Cloak:superior:V1:sk"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(attached(state, "V1", "sk")).toBeDefined();

    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Alice";
      tf.phase = "unlock";
      tf.unlockDone = false;
    }
    new VtesEngine(state, testRegistry).decision();
    expect(attached(state, "V1", "sk")).toBeUndefined();
  });
});

describe("Fever Pitch (102321)", () => {
  it("gives +1 bleed when played during the bleed, and attaches after it lands", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, disciplines: { pre: "superior" } });
    state.seats[0]!.hand.push({ id: "fp", name: "Fever Pitch" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state C → resolves
    ]);
    // The bleed landed for 1 (no modifier played), so the attach half is
    // on offer in the window.
    const dp = engine.decision()!;
    expect(dp.window).toBe("action.afterResolution");
    const opt = dp.options.find((o) => o.id.includes("Fever Pitch") && o.id.includes("attach"));
    expect(opt).toBeDefined();

    runTrace(engine, [
      ["Alice", opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const entry = attached(state, "V1", "fp");
    expect(entry).toBeDefined();
    expect(entry!.tags).toContain("feverPitch");
  });

  it("the attached copy burns to make a block attempt fail", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    find(state, "V1").attached.push({
      card: { id: "fp", name: "Fever Pitch" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Fever Pitch", "feverPitch"],
    });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    const opt = engine
      .decision()!
      .options.find((o) => o.id === "ability:Fever Pitch:fp:failblock");
    expect(opt).toBeDefined();

    runTrace(engine, [["Alice", opt!.id]]);
    // Let the (now failing) block attempt resolve.
    runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
    // The card is spent and the blocker is barred from trying again.
    expect(attached(state, "V1", "fp")).toBeUndefined();
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action");
    expect(af.blockRestrictions.cannotBlock).toContain("M");
  });

  it("a vampire can have only one Fever Pitch", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, disciplines: { pre: "superior" } });
    find(state, "V1").attached.push({
      card: { id: "fp0", name: "Fever Pitch" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Fever Pitch", "feverPitch"],
    });
    state.seats[0]!.hand.push({ id: "fp", name: "Fever Pitch" });
    state.seats[0]!.minions.push(makeMinion("A2", "Alice"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const dp = engine.decision();
    // Either the window did not open, or the attach option is absent.
    const ids = dp?.options.map((o) => o.id) ?? [];
    expect(ids.some((i) => i.includes("Fever Pitch") && i.includes("attach"))).toBe(false);
  });
});
