/**
 * The crypt and the uncontrolled region
 * (docs/crypt-and-uncontrolled-design.md).
 *
 * Chantry (100329), Grooming the Protégé (100860), Wider View (102180),
 * Family Gathering (102289), Yawp Court (102199) — the last five
 * BUILDABLE Masters, so Master finishes at 5 unsupported and all five of
 * those are BLOCKED rather than deferred.
 *
 * Four of the five reach into the two zones the engine had barely used,
 * and needed no new zone and only one new event.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 80): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

function location(id: string, name: string, seat: string): PermanentInPlay {
  return {
    card: { id, name },
    controller: seat,
    owner: seat,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
  };
}

/** Point the turn frame at a phase of `seat`'s turn. */
function atPhase(state: GameState, seat: string, phase: "master" | "influence"): VtesEngine {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = phase;
  if (phase === "master") tf.masterActionsLeft = 1;
  return new VtesEngine(state, testRegistry);
}

// ---------------------------------------------------------------------------

describe("Chantry (100329)", () => {
  function chantryGame(): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(location("ch", "Chantry", "Alice"));
    Object.assign(find(state, "V1"), { clan: "Tremere", blood: 3 });
    // BOB's Tremere is the one in torpor — "a Tremere", anyone's.
    Object.assign(find(state, "W"), { clan: "Tremere", inTorpor: true });
    Object.assign(find(state, "M"), { clan: "Ventrue", inTorpor: true });
    return state;
  }

  it("frees ANY Methuselah's Tremere, to THEIR OWN ready region", () => {
    const state = chantryGame();
    const engine = atPhase(state, "Alice", "master");
    const ids = optionIds(engine).filter((o) => o.includes("Chantry:ch:rescue:"));
    // Bob's Tremere is a legal target; his Ventrue is not.
    expect(ids.some((o) => o.includes(":rescue:W:"))).toBe(true);
    expect(ids.some((o) => o.includes(":rescue:M:"))).toBe(false);
    // The payment is a CHOICE: the pool, or a ready Tremere's blood.
    expect(ids).toContain("ability:Chantry:ch:rescue:W:pool");
    expect(ids).toContain("ability:Chantry:ch:rescue:W:V1");

    runTrace(engine, [["Alice", "ability:Chantry:ch:rescue:W:V1"]]);
    expect(find(state, "W").inTorpor).toBe(false);
    // …and W goes home to BOB, not to the Chantry's controller.
    expect(seatOf(state, "Bob").minions.some((m) => m.id === "W")).toBe(true);
    expect(find(state, "V1").blood).toBe(2); // paid in blood
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(true);
  });

  it("NEGATIVE SPACE: locked, or with nothing to pay, it is not offered", () => {
    const locked = chantryGame();
    seatOf(locked, "Alice").permanents[0]!.locked = true;
    expect(optionIds(atPhase(locked, "Alice", "master")).some((o) => o.includes("Chantry")))
      .toBe(false);

    const broke = chantryGame();
    seatOf(broke, "Alice").pool = 0;
    find(broke, "V1").blood = 0;
    expect(optionIds(atPhase(broke, "Alice", "master")).some((o) => o.includes("Chantry")))
      .toBe(false);
  });
});

describe("Grooming the Protégé (100860)", () => {
  function groomGame(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Brujah", capacity: 8, blood: 5 });
    seatOf(state, "Alice").uncontrolled.push(
      { card: makeMinion("U-young", "Alice", { clan: "Brujah", capacity: 4 }), counters: 0 },
      { card: makeMinion("U-old", "Alice", { clan: "Brujah", capacity: 9 }), counters: 0 },
      { card: makeMinion("U-other", "Alice", { clan: "Ventrue", capacity: 3 }), counters: 0 },
    );
    seatOf(state, "Alice").hand.push({ id: "gp", name: "Grooming the Protégé" });
    return state;
  }

  it("moves up to 3 blood to a YOUNGER vampire of the SAME clan", () => {
    const state = groomGame();
    const engine = atPhase(state, "Alice", "master");
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Grooming"));
    // One option per (donor, recipient, amount): 1–3 to the young Brujah.
    expect(ids.filter((o) => o.includes("U-young")).length).toBe(3);
    // NEGATIVE SPACE, both filters: an OLDER Brujah and a younger Ventrue.
    expect(ids.some((o) => o.includes("U-old"))).toBe(false);
    expect(ids.some((o) => o.includes("U-other"))).toBe(false);

    const pick = ids.find((o) => o.includes("U-young") && o.includes(":3:"))!;
    runTrace(engine, [["Alice", pick]]);
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "card.asPlayed") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(find(state, "V1").blood).toBe(2);
    // Blood on an uncontrolled vampire IS its influence counter: p. 35-36
    // says those counters "become its blood on taking control", and the
    // engine has always modelled them as one pile.
    expect(seatOf(state, "Alice").uncontrolled.find((u) => u.card.id === "U-young")!.counters)
      .toBe(3);
  });

  it("is a ONE-SHOT: it does not stay in play", () => {
    const state = groomGame();
    const engine = atPhase(state, "Alice", "master");
    const pick = optionIds(engine).find((o) => o.includes("U-young"))!;
    runTrace(engine, [["Alice", pick]]);
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "card.asPlayed") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(seatOf(state, "Alice").permanents).toEqual([]);
    expect((seatOf(state, "Alice").ashHeap ?? []).map((c) => c.name)).toContain(
      "Grooming the Protégé",
    );
  });
});

describe("Family Gathering (102289)", () => {
  function gatheringGame(topClan: string): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").crypt = [
      makeMinion("C1", "Alice", { clan: topClan, capacity: 5 }),
      makeMinion("C2", "Alice", { clan: "Ventrue", capacity: 4 }),
    ];
    seatOf(state, "Alice").hand.push({ id: "fg", name: "Family Gathering" });
    return state;
  }

  function play(state: GameState): void {
    const engine = atPhase(state, "Alice", "master");
    const pick = optionIds(engine).find((o) => o.startsWith("play:Family Gathering"))!;
    expect(pick).toBeDefined();
    runTrace(engine, [["Alice", pick]]);
    for (let i = 0; i < 6; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "card.asPlayed") break;
      runTrace(engine, [[dp.seat, "pass"]]);
    }
  }

  it("a HECATA on top is drawn to the uncontrolled region with 1 blood", () => {
    const state = gatheringGame("Hecata");
    play(state);
    const alice = seatOf(state, "Alice");
    // A crypt draw goes to the UNCONTROLLED region (p. 3), not into play.
    expect(alice.uncontrolled.map((u) => u.card.id)).toEqual(["C1"]);
    expect(alice.uncontrolled[0]!.counters).toBe(1);
    expect(alice.crypt.map((c) => c.id)).toEqual(["C2"]);
    expect(alice.minions.some((m) => m.id === "C1")).toBe(false);
  });

  it("anything else goes to the BOTTOM of the crypt", () => {
    const state = gatheringGame("Toreador");
    play(state);
    const alice = seatOf(state, "Alice");
    expect(alice.uncontrolled).toEqual([]);
    // The crypt is drawn from the FRONT, so the bottom is last.
    expect(alice.crypt.map((c) => c.id)).toEqual(["C2", "C1"]);
  });

  it("an EMPTY crypt is harmless", () => {
    const state = gatheringGame("Hecata");
    seatOf(state, "Alice").crypt = [];
    play(state);
    expect(seatOf(state, "Alice").uncontrolled).toEqual([]);
  });
});

describe("Wider View (102180)", () => {
  function viewGame(transfers: number): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(location("wv", "Wider View", "Alice"));
    seatOf(state, "Alice").permanents[0]!.tags = ["Wider View"];
    seatOf(state, "Alice").crypt = [makeMinion("C1", "Alice", { capacity: 5 })];
    seatOf(state, "Alice").uncontrolled.push({
      card: makeMinion("U1", "Alice", { capacity: 4 }),
      counters: 1,
    });
    const tf = state.frames[0]!;
    if (tf.kind !== "turn") throw new Error("no turn frame");
    tf.phase = "influence";
    tf.transfersLeft = transfers;
    return state;
  }

  it("1 transfer: draw from the crypt and REMOVE an uncontrolled vampire", () => {
    const state = viewGame(2);
    const engine = new VtesEngine(state, testRegistry);
    const id = "ability:Wider View:wv:cryptdraw:U1";
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Alice", id]]);
    const alice = seatOf(state, "Alice");
    // U1 is REMOVED (p. 16), not burned — it is in no zone at all.
    expect(alice.uncontrolled.map((u) => u.card.id)).toEqual(["C1"]);
    expect(alice.crypt).toEqual([]);
    const tf = state.frames[0]!;
    expect(tf.kind === "turn" && tf.transfersLeft).toBe(1);
  });

  it("4 transfers: burn it for 2 pool", () => {
    const state = viewGame(4);
    const engine = new VtesEngine(state, testRegistry);
    const pool = seatOf(state, "Alice").pool;
    expect(optionIds(engine)).toContain("ability:Wider View:wv:cashout");
    runTrace(engine, [["Alice", "ability:Wider View:wv:cashout"]]);
    expect(seatOf(state, "Alice").pool).toBe(pool + 2);
    expect(seatOf(state, "Alice").permanents).toEqual([]);
  });

  it("NEGATIVE SPACE: neither is offered without the transfers", () => {
    const state = viewGame(0);
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((o) => o.includes("Wider View")),
    ).toBe(false);

    // And the crypt draw needs BOTH halves: an empty uncontrolled region
    // means the one clause cannot happen, so it is not offered (§2).
    const noTargets = viewGame(4);
    seatOf(noTargets, "Alice").uncontrolled = [];
    const ids = optionIds(new VtesEngine(noTargets, testRegistry));
    expect(ids.some((o) => o.includes(":cryptdraw:"))).toBe(false);
    expect(ids).toContain("ability:Wider View:wv:cashout"); // the control
  });
});

describe("Yawp Court (102199)", () => {
  function courtGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(location("yc", "Yawp Court", "Bob"));
    // Bob's ambusher, and Alice calls the referendum.
    Object.assign(find(state, "W"), { sect: "sabbat", blood: 4, strength: 1 });
    Object.assign(find(state, "V1"), { title: "prince", blood: 4, strength: 1 });
    seatOf(state, "Alice").hand.push({ id: "krc", name: "Kine Resources Contested" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("ambushes the acting vampire BEFORE the referendum", () => {
    const { state, engine } = courtGame();
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ]);
    const id = "ability:Yawp Court:yc:ambush:W";
    expect(walkTo(engine, id)).toBe(true);
    // The window is action.afterResolution — before the referendum.
    expect(engine.decision()!.window).toBe("action.afterResolution");
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
    runTrace(engine, [["Bob", id]]);
    expect(find(state, "W").locked).toBe(true);
    expect(seatOf(state, "Bob").permanents[0]!.locked).toBe(true);
    // The combat comes first…
    expect(walkTo(engine, "strike:hand")).toBe(true);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(true);
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
  });

  it("…and the referendum is conducted afterwards, as normal", () => {
    const { state, engine } = courtGame();
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Yawp Court:yc:ambush:W")).toBe(true);
    runTrace(engine, [["Bob", "ability:Yawp Court:yc:ambush:W"]]);
    // Drain the combat first…
    for (let i = 0; i < 80 && state.frames.some((f) => f.kind === "combat"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    // …and the referendum is conducted as normal, which is what the
    // card's last sentence describes rather than instructs (§5).
    expect(walkTo(engine, "terms:")).toBe(true);
  });

  it("NEGATIVE SPACE: not offered on a NON-political action", () => {
    const { state, engine } = courtGame();
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Yawp Court", 20)).toBe(false);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("NEGATIVE SPACE: not offered without a ready unlocked Sabbat vampire", () => {
    const { state, engine } = courtGame();
    find(state, "W").locked = true;
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Yawp Court", 20)).toBe(false);
  });
});
