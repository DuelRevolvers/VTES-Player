/**
 * Stealable locations (docs/stealable-locations-design.md).
 *
 * New Management (101280), The Line (101110), The Louvre, Paris (101127).
 *
 * Two locations whose own text invites theft, and the action that steals any
 * cheap location. The COST filter on the thief is what separates them: both
 * locations are free, so New Management may take either — and a location that
 * costs 2 is exactly what it may not.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** A location entry as the engine would denormalize it. */
function loc(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: ["location"], ...over };
}

/** The Line exactly as entering play denormalizes it (asserted in its own case). */
const lineCostSource = { pays: ["blood" as const], for: "action" as const, locks: true, flat: 1 };

/** Pass every impulse until control is back in the minion phase. */
function settle(engine: VtesEngine, limit = 40): void {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp || dp.window === "turn.minion") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/** Alice's minion phase, with a library to replace from. */
function minionPhase(state: GameState): void {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") tf.phase = "minion";
  state.seats[0]!.library = Array.from({ length: 8 }, (_, i) => ({ id: `lib${i}`, name: "Conditioning" }));
}

// ---------------------------------------------------------------------------

describe("New Management (101280) — any location that is free or costs 1", () => {
  /** Bob holds a FREE location (The Line) and a 2-POOL one (Inbase Discotek);
   *  Alice holds one of her own. Only one of the three is a legal target. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    minionPhase(state);
    seatOf(state, "Bob").permanents.push(loc("ln", "The Line", { costSource: lineCostSource }));
    seatOf(state, "Bob").permanents.push(loc("id", "Inbase Discotek, Frankfurt"));
    seatOf(state, "Alice").permanents.push(loc("mine", "The Louvre, Paris"));
    seatOf(state, "Alice").hand.push({ id: "nm", name: "New Management" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers the free location, and not the 2-pool one or your own", () => {
    const { engine } = game();
    const ids = optionIds(engine).filter((o) => o.startsWith("play:New Management"));
    expect(ids.some((o) => o.includes(":ln:"))).toBe(true);
    // Inbase Discotek costs 2 pool: the printed cost is the whole filter.
    expect(ids.some((o) => o.includes(":id:"))).toBe(false);
    // Taking your own location is not a legal action.
    expect(ids.some((o) => o.includes(":mine:"))).toBe(false);
  });

  it("takes control of it on success, directed at its controller", () => {
    const { state, engine } = game();
    const id = optionIds(engine).find((o) => o.startsWith("play:New Management") && o.includes(":ln:"))!;
    engine.choose(id);
    settle(engine);
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "ln")).toBe(true);
    expect(seatOf(state, "Bob").permanents.some((p) => p.card.id === "ln")).toBe(false);
    expect(state.eventLog.find((e) => e.type === "ActionAnnounced")).toMatchObject({
      target: "Bob",
      directed: true,
    });
  });
});

describe("The Line (101110) — a cost source that pays from nowhere", () => {
  /** Alice holds The Line and a 1-blood action card (Legal Manipulations). */
  function game(): { state: GameState; engine: VtesEngine; v1: MinionState } {
    const state = threeSeatGame();
    minionPhase(state);
    const v1 = find(state, "V1")!;
    Object.assign(v1, { blood: 4, capacity: 6, disciplines: { pre: "basic" } });
    seatOf(state, "Alice").permanents.push(loc("ln", "The Line", { costSource: lineCostSource }));
    seatOf(state, "Alice").hand.push({ id: "lm", name: "Legal Manipulations" });
    return { state, engine: new VtesEngine(state, testRegistry), v1 };
  }

  it("takes the action card's 1 blood off the cost, and locks", () => {
    const { state, engine, v1 } = game();
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Legal Manipulations"));
    // The plain option and the paid-by-The-Line option, side by side.
    const viaLine = ids.find((o) => o.includes("ln/1/0"));
    expect(viaLine, "The Line was not offered as a payment").toBeDefined();
    engine.choose(viaLine!);
    settle(engine);
    // The card cost 1 blood, all of it paid by the location.
    expect(v1.blood).toBe(4);
    expect(seatOf(state, "Alice").permanents.find((p) => p.card.id === "ln")!.locked).toBe(true);
  });

  it("CONTROL: the same card paid the ordinary way costs the vampire 1 blood", () => {
    const { state, engine, v1 } = game();
    const plain = optionIds(engine).find(
      (o) => o.startsWith("play:Legal Manipulations") && !o.includes("ln/"),
    )!;
    engine.choose(plain);
    settle(engine);
    expect(v1.blood).toBe(3);
    // Unused, so still unlocked — and it paid nothing from counters it lacks.
    expect(seatOf(state, "Alice").permanents.find((p) => p.card.id === "ln")!.locked).toBe(false);
  });

  it("NEGATIVE SPACE: a LOCKED Line pays nothing", () => {
    const { state, engine } = game();
    seatOf(state, "Alice").permanents.find((p) => p.card.id === "ln")!.locked = true;
    expect(optionIds(engine).some((o) => o.includes("ln/"))).toBe(false);
  });

  it("entering play denormalizes the flat cost source onto the entry", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    seatOf(state, "Alice").hand.push({ id: "ln", name: "The Line" });
    const engine = new VtesEngine(state, testRegistry);
    engine.choose(optionIds(engine).find((o) => o.startsWith("play:The Line"))!);
    for (let i = 0; i < 6; i++) {
      const pass = engine.decision()?.options.find((o) => o.id === "pass");
      if (!pass) break;
      engine.choose(pass.id);
    }
    const entry = seatOf(state, "Alice").permanents.find((p) => p.card.id === "ln");
    expect(entry?.costSource).toEqual(lineCostSource);
  });

  it("VAMPIRES can steal it; an ally cannot", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    seatOf(state, "Alice").permanents.push(loc("ln", "The Line", { costSource: lineCostSource }));
    seatOf(state, "Bob").minions.push(makeAlly("AL", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine);
    expect(ids).toContain("act:The Line:ln:steal:W");
    expect(ids).not.toContain("act:The Line:ln:steal:AL");
  });
});

describe("The Louvre, Paris (101127) — lock a Toreador, or anyone with the Prince", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    minionPhase(state);
    seatOf(state, "Alice").permanents.push(loc("lv", "The Louvre, Paris"));
    // Bob: a Toreador (TO) and a Brujah (W).
    Object.assign(find(state, "W")!, { clan: "Brujah" });
    seatOf(state, "Bob").minions.push(makeMinion("TO", "Bob", { clan: "Toreador", capacity: 5, blood: 2 }));
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers only TOREADOR, and using it locks both the location and the target", () => {
    const { state, engine } = game();
    const ids = optionIds(engine).filter((o) => o.startsWith("ability:The Louvre, Paris"));
    expect(ids).toContain("ability:The Louvre, Paris:lv:lockMinion:TO");
    expect(ids.some((o) => o.endsWith(":W"))).toBe(false);
    engine.choose("ability:The Louvre, Paris:lv:lockMinion:TO");
    expect(find(state, "TO")!.locked).toBe(true);
    expect(seatOf(state, "Alice").permanents.find((p) => p.card.id === "lv")!.locked).toBe(true);
  });

  it("with the PRINCE OF PARIS in play under you, any minion", () => {
    const { state, engine } = game();
    Object.assign(find(state, "V1")!, { title: "prince", titleCity: "Paris" });
    const ids = optionIds(engine).filter((o) => o.startsWith("ability:The Louvre, Paris"));
    // The Brujah the base clause refused.
    expect(ids).toContain("ability:The Louvre, Paris:lv:lockMinion:W");
  });

  it("NEGATIVE SPACE: a prince of ANOTHER city does not widen it", () => {
    const { state, engine } = game();
    Object.assign(find(state, "V1")!, { title: "prince", titleCity: "Chicago" });
    const ids = optionIds(engine).filter((o) => o.startsWith("ability:The Louvre, Paris"));
    expect(ids.some((o) => o.endsWith(":W"))).toBe(false);
  });

  it("MINIONS can steal it — an ally included, where The Line says vampires", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    seatOf(state, "Alice").permanents.push(loc("lv", "The Louvre, Paris"));
    seatOf(state, "Bob").minions.push(makeAlly("AL", "Bob", 2));
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine);
    expect(ids).toContain("act:The Louvre, Paris:lv:steal:W");
    expect(ids).toContain("act:The Louvre, Paris:lv:steal:AL");
  });
});
