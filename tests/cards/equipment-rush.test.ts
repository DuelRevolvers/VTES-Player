/**
 * Equipment rush (docs/equipment-rush-design.md) — cards on a vampire that
 * let the bearer enter combat: Alastor (100038), Eye of Hazimel (100678)
 * and Talbot's Chainsaw (101931). The rush is the existing
 * `permanent.rushGrant`; what is new is [RTR 19960221] (the rush fizzles
 * if the card has left the actor), and each card's riders.
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay, PermanentStatics } from "../../src/engine/index.ts";
import { VtesEngine, currentBleed, currentStealth, disciplinesOf, playCostFor } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function turnFrame(state: GameState) {
  const tf = state.frames[0];
  if (!tf || tf.kind !== "turn") throw new Error("no turn frame");
  return tf;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

/** The named seat's minion phase (threeSeatGame starts in Alice's). */
function minionPhase(seat: string, edit?: (s: GameState) => void): GameState {
  const state = threeSeatGame();
  turnFrame(state).seat = seat;
  for (const id of ["V1", "W", "M", "N"]) Object.assign(find(state, id), { blood: 6, capacity: 6 });
  edit?.(state);
  return state;
}

/** Put a card in play on a minion with its compiled statics and tags. */
function equip(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler ${name}`);
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  find(state, minion).attached.push(p);
  return p;
}

/** A raw entry, for a static no card in the pool happens to carry alone. */
function attachRaw(state: GameState, minion: string, id: string, statics: PermanentStatics): void {
  find(state, minion).attached.push({
    card: { id, name: "Test Card" },
    locked: false,
    usedThisPhase: false,
    statics,
    tags: [],
  });
}

const ids = (engine: VtesEngine): string[] => engine.decision()?.options.map((o) => o.id) ?? [];
const has = (engine: VtesEngine, prefix: string): boolean => ids(engine).some((i) => i.startsWith(prefix));

/** Answer `pass` until `done()` holds; a decision with no `pass` that is
 *  not `done` is a failure, never a silent stop. */
function passUntil(engine: VtesEngine, done: () => boolean, max = 60): void {
  for (let i = 0; i < max && !done(); i++) {
    const options = ids(engine);
    if (!options.includes("pass")) throw new Error(`no pass offered: ${options.join(", ")}`);
    engine.choose("pass");
  }
  expect(done()).toBe(true);
}

/** End the current turn: `end`, then `pass`, until the next seat's turn. */
function endTurn(engine: VtesEngine, state: GameState): void {
  const start = turnFrame(state).seat;
  for (let i = 0; i < 40 && turnFrame(state).seat === start; i++) {
    const options = ids(engine);
    const pick = ["end", "pass"].find((p) => options.includes(p));
    if (!pick) throw new Error(`cannot end the turn: ${options.join(", ")}`);
    engine.choose(pick);
  }
  expect(turnFrame(state).seat).not.toBe(start);
}

/** Pass until the rush's combat starts or the action is over. The rush
 *  combat runs INSIDE resolution, with the action frame still on the stack
 *  (docs/hand-rush-design.md §5.1), so "the action is gone" is only the
 *  fizzle's stopping point. */
const rushResolved = (state: GameState) => () =>
  combat(state) !== undefined || !state.frames.some((f) => f.kind === "action");

/** Announce V1's rush on N and pass the action through to resolution. */
function rushN(name: string, cardId: string, edit?: (s: GameState) => void, midAction?: (s: GameState) => void) {
  const state = minionPhase("Alice", (s) => {
    equip(s, "V1", cardId, name);
    edit?.(s);
  });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [["Alice", `act:${name}:${cardId}:rush:V1:N`]]);
  midAction?.(state);
  passUntil(engine, rushResolved(state));
  return { state, engine };
}

/** Move a card off V1 onto M, as a steal between announcement and
 *  resolution would. */
const strip = (cardId: string) => (s: GameState) => {
  const v1 = find(s, "V1");
  const i = v1.attached.findIndex((p) => p.card.id === cardId);
  expect(i).toBeGreaterThanOrEqual(0);
  find(s, "M").attached.push(...v1.attached.splice(i, 1));
};

// ---------------------------------------------------------------------------
// The shared grant, and [RTR 19960221]
// ---------------------------------------------------------------------------

describe("the bearer's rush", () => {
  it("is offered to an equipped bearer, and not to the same vampire without it", () => {
    const bare = new VtesEngine(minionPhase("Alice"), testRegistry);
    expect(has(bare, "act:")).toBe(false);
    for (const [name, id] of [["Eye of Hazimel", "eye"], ["Talbot's Chainsaw", "cs"], ["Alastor", "al"]] as const) {
      const state = minionPhase("Alice", (s) => equip(s, "V1", id, name));
      const rush = ids(new VtesEngine(state, testRegistry)).filter((o) => o.startsWith(`act:${name}:${id}:rush:V1:`));
      expect(rush.sort(), name).toEqual([`act:${name}:${id}:rush:V1:M`, `act:${name}:${id}:rush:V1:N`, `act:${name}:${id}:rush:V1:W`]);
    }
  });

  it("the Eye and the Chainsaw rush 'a minion', Alastor only 'a vampire'", () => {
    const withAlly = (s: GameState) => seatOf(s, "Bob").minions.push(makeAlly("A1", "Bob", 2));
    for (const [name, id, ally] of [["Eye of Hazimel", "eye", true], ["Talbot's Chainsaw", "cs", true], ["Alastor", "al", false]] as const) {
      const state = minionPhase("Alice", (s) => {
        withAlly(s);
        equip(s, "V1", id, name);
      });
      expect(has(new VtesEngine(state, testRegistry), `act:${name}:${id}:rush:V1:A1`), name).toBe(ally);
    }
  });

  it("the Chainsaw's rush is +1 stealth, the Eye's is not", () => {
    for (const [name, id, stealth] of [["Talbot's Chainsaw", "cs", 1], ["Eye of Hazimel", "eye", 0]] as const) {
      const state = minionPhase("Alice", (s) => equip(s, "V1", id, name));
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [["Alice", `act:${name}:${id}:rush:V1:N`]]);
      const af = state.frames.find((f) => f.kind === "action");
      if (af?.kind !== "action") throw new Error("no action");
      expect(currentStealth(state, af.actionId), name).toBe(stealth);
    }
  });

  it("starts combat when the Eye is still on the actor", () => {
    const { state } = rushN("Eye of Hazimel", "eye");
    expect(combat(state)).toBeDefined();
  });

  it("FIZZLES when the Eye has left the actor by resolution [RTR 19960221]", () => {
    const { state } = rushN("Eye of Hazimel", "eye", undefined, strip("eye"));
    expect(combat(state)).toBeUndefined();
    // The action still succeeded — it simply starts no combat.
    expect(state.eventLog.some((e) => e.type === "ActionResolved" && e.success)).toBe(true);
    expect(find(state, "V1").locked).toBe(true);
  });

  it("…and so does any card on the actor that provides the rush — Scourge (owner ruling)", () => {
    const go = (mid?: (s: GameState) => void) => {
      const state = minionPhase("Alice", (s) => {
        equip(s, "V1", "sc", "Scourge");
        Object.assign(find(s, "N"), { capacity: 4 });
      });
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [["Alice", "act:Scourge:sc:rush:V1:N"]]);
      mid?.(state);
      passUntil(engine, rushResolved(state));
      return state;
    };
    expect(combat(go())).toBeDefined();
    expect(combat(go(strip("sc")))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Alastor
// ---------------------------------------------------------------------------

describe("Alastor (100038)", () => {
  /** V1 (Alice) is a Camarilla justicar; W and N Camarilla, M Sabbat. */
  function alastorGame(edit?: (s: GameState) => void) {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { title: "justicar", sect: "camarilla" });
      find(s, "W").sect = "camarilla";
      find(s, "M").sect = "sabbat";
      find(s, "N").sect = "camarilla";
      seatOf(s, "Alice").hand.push({ id: "al", name: "Alastor" });
      seatOf(s, "Alice").library.push(
        // Drawn to replace Alastor itself (p. 7), so the search never sees it.
        { id: "lib-top", name: "Conditioning" },
        { id: "lib-eye", name: "Eye of Hazimel" },
        { id: "lib-kv", name: "Kevlar Vest" },
        { id: "lib-sc", name: "Sacré-Cœur Cathedral, France" },
        { id: "lib-x", name: "Conditioning" },
      );
      edit?.(s);
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const fetchKey = "choice:Alastor:al:fetchEquipment:";
  /** Call it and pass it with the chosen vampire as the bearer, up to the
   *  library search. */
  const passTo = (engine: VtesEngine, bearer: string): void => {
    runTrace(engine, [["Alice", "play:Alastor"]]);
    passUntil(engine, () => has(engine, "terms:"));
    runTrace(engine, [
      ["Alice", `terms:${bearer}`],
      ["Alice", "vote:V1:for"],
    ]);
    passUntil(engine, () => has(engine, fetchKey));
  };

  it("requires a justicar or Inner Circle member", () => {
    expect(has(alastorGame().engine, "play:Alastor")).toBe(true);
    expect(has(alastorGame((s) => (find(s, "V1").title = "innerCircle")).engine, "play:Alastor")).toBe(true);
    expect(has(alastorGame((s) => (find(s, "V1").title = "prince")).engine, "play:Alastor")).toBe(false);
    expect(has(alastorGame((s) => (find(s, "V1").title = null)).engine, "play:Alastor")).toBe(false);
  });

  it("the terms are ready Camarilla vampires without an Alastor", () => {
    const { engine } = alastorGame((s) => equip(s, "W", "al2", "Alastor"));
    runTrace(engine, [["Alice", "play:Alastor"]]);
    passUntil(engine, () => has(engine, "terms:"));
    const terms = ids(engine).filter((i) => i.startsWith("terms:")).sort();
    // Not the Sabbat M, and not W, who already has one.
    expect(terms).toEqual(["terms:N", "terms:V1"]);
  });

  it("is not playable when every candidate already has one [LSJ 20100129]", () => {
    const { engine } = alastorGame((s) => {
      equip(s, "V1", "al2", "Alastor");
      equip(s, "W", "al3", "Alastor");
      equip(s, "N", "al4", "Alastor");
    });
    expect(has(engine, "play:Alastor")).toBe(false);
  });

  it("fetches an equipment card onto the bearer for HALF its cost, rounded down", () => {
    const { state, engine } = alastorGame();
    passTo(engine, "V1");
    const offered = ids(engine).filter((i) => i.startsWith(fetchKey)).sort();
    // Equipment only: not the Conditioning.
    expect(offered).toEqual([`${fetchKey}lib-eye`, `${fetchKey}lib-kv`, `${fetchKey}lib-sc`, `${fetchKey}none`].sort());
    const pool = seatOf(state, "Alice").pool;
    runTrace(engine, [["Alice", `${fetchKey}lib-eye`]]);
    const v1 = find(state, "V1");
    expect(v1.attached.map((p) => p.card.id)).toEqual(expect.arrayContaining(["al", "lib-eye"]));
    // 3 pool, halved and rounded down: 1.
    expect(seatOf(state, "Alice").pool).toBe(pool - 1);
    expect(seatOf(state, "Alice").library.some((c) => c.id === "lib-eye")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled" && e.seat === "Alice")).toBe(true);
  });

  it("the CHOSEN vampire pays a blood cost [LSJ 20040518], ignoring requirements", () => {
    const { state, engine } = alastorGame();
    passTo(engine, "W");
    const before = find(state, "W").blood;
    const pool = seatOf(state, "Alice").pool;
    runTrace(engine, [["Alice", `${fetchKey}lib-sc`]]);
    // 2 blood, halved: 1, from W — not from the caller.
    expect(find(state, "W").blood).toBe(before - 1);
    expect(find(state, "V1").blood).toBe(6);
    expect(seatOf(state, "Alice").pool).toBe(pool);
    expect(find(state, "W").attached.some((p) => p.card.id === "lib-sc")).toBe(true);
  });

  it("finding nothing still attaches Alastor and shuffles [LSJ 20050331-2]", () => {
    const { state, engine } = alastorGame();
    passTo(engine, "N");
    runTrace(engine, [["Alice", `${fetchKey}none`]]);
    expect(find(state, "N").attached.map((p) => p.card.id)).toEqual(["al"]);
    expect(seatOf(state, "Alice").library).toHaveLength(4);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled" && e.seat === "Alice")).toBe(true);
  });

  it("a card whose halved cost cannot be paid is not offered", () => {
    const { engine } = alastorGame((s) => (seatOf(s, "Alice").pool = 1));
    passTo(engine, "V1");
    // The Eye's 1 pool would oust Alice; the Vest's halved cost is 0.
    expect(has(engine, `${fetchKey}lib-eye`)).toBe(false);
    expect(has(engine, `${fetchKey}lib-kv`)).toBe(true);
  });

  it("the bearer cannot commit diablerie, and can still rescue", () => {
    const torpid = (s: GameState) => Object.assign(find(s, "N"), { inTorpor: true, blood: 1 });
    const without = new VtesEngine(minionPhase("Alice", torpid), testRegistry);
    expect(has(without, "diablerize:V1:N")).toBe(true);
    const state = minionPhase("Alice", (s) => {
      torpid(s);
      equip(s, "V1", "al", "Alastor");
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(has(engine, "diablerize:V1:N")).toBe(false);
    expect(has(engine, "rescue:V1:N")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Eye of Hazimel
// ---------------------------------------------------------------------------

describe("Eye of Hazimel (100678)", () => {
  const withEye = (edit?: (s: GameState) => void) =>
    minionPhase("Alice", (s) => {
      equip(s, "V1", "eye", "Eye of Hazimel");
      edit?.(s);
    });

  it("+1 bleed", () => {
    for (const [eye, bleed] of [[true, 2], [false, 1]] as const) {
      const state = eye ? withEye() : minionPhase("Alice");
      runTrace(new VtesEngine(state, testRegistry), [["Alice", "bleed:V1"]]);
      const af = state.frames.find((f) => f.kind === "action");
      if (af?.kind !== "action") throw new Error("no action");
      expect(currentBleed(state, af)).toBe(bleed);
    }
  });

  it("superior Potence and superior Chimerstry, over the printed disciplines", () => {
    const d = disciplinesOf(find(withEye(), "V1"));
    expect(d["pot"]).toBe("superior");
    expect(d["chi"]).toBe("superior");
    expect(d["dom"]).toBe("basic");
    expect(disciplinesOf(find(minionPhase("Alice"), "V1"))["pot"]).toBeUndefined();
  });

  it("combat cards cost the bearer 1 fewer blood, and nobody else", () => {
    const state = withEye();
    const card = { name: "X", bloodCost: 1, poolCost: 0, types: ["combat" as const], requires: [] };
    expect(playCostFor(state, card, find(state, "V1"), null, null).blood).toBe(0);
    expect(playCostFor(state, card, find(state, "W"), null, null).blood).toBe(1);
    const action = { ...card, types: ["action" as const] };
    expect(playCostFor(state, action, find(state, "V1"), null, null).blood).toBe(1);
  });

  it("+1 strength: the bearer's hand strike deals 2", () => {
    const { state, engine } = rushN("Eye of Hazimel", "eye");
    for (let i = 0; i < 40 && !has(engine, "strike:hand"); i++) engine.choose("pass");
    runTrace(engine, [["Alice", "strike:hand"]]);
    runTrace(engine, [["Carol", "strike:hand"]]);
    for (let i = 0; i < 20 && !state.eventLog.some((e) => e.type === "DamageInflicted" && e.minion === "N"); i++) {
      engine.choose(ids(engine).includes("pass") ? "pass" : ids(engine)[0]!);
    }
    const hit = state.eventLog.find((e) => e.type === "DamageInflicted" && e.minion === "N");
    expect(hit?.type === "DamageInflicted" ? hit.amount : null).toBe(2);
  });

  /** Saankaláxt: "steal an equipment card from a minion" — from a READY one. */
  function stealer(s: GameState): void {
    const name = "Saankaláxt (G6)";
    const self: PermanentInPlay = {
      card: { id: "S", name },
      locked: false,
      usedThisPhase: false,
      statics: testRegistry[name]?.permanentStatics ?? {},
      tags: testRegistry[name]?.permanentTags ?? [],
    };
    seatOf(s, "Bob").minions.push(makeMinion("S", "Bob", { name, blood: 4, capacity: 6, attached: [self] }));
    turnFrame(s).seat = "Bob";
  }

  it("cannot be stolen while the bearer is ready — another equipment can", () => {
    const state = withEye((s) => {
      stealer(s);
      equip(s, "V1", "kv", "Kevlar Vest");
    });
    const acts = ids(new VtesEngine(state, testRegistry)).filter((o) => o.startsWith("act:Saankal"));
    expect(acts.some((o) => o.endsWith("equip:kv"))).toBe(true);
    expect(acts.some((o) => o.endsWith("equip:eye"))).toBe(false);
  });

  it("…and can be while the bearer is in torpor (§4)", () => {
    const state = withEye((s) => {
      stealer(s);
      Object.assign(find(s, "V1"), { inTorpor: true });
    });
    const acts = ids(new VtesEngine(state, testRegistry)).filter((o) => o.startsWith("act:Saankal"));
    expect(acts.some((o) => o.endsWith("equip:eye"))).toBe(true);
  });

  it("burning it inflicts 5 unpreventable damage on the bearer; burning a Vest does not", () => {
    const state = withEye((s) => equip(s, "V1", "kv", "Kevlar Vest"));
    const engine = new VtesEngine(state, testRegistry);
    engine.burnPermanent("kv");
    expect(find(state, "V1").blood).toBe(6);
    engine.burnPermanent("eye");
    // 6 blood, 5 damage.
    expect(find(state, "V1").blood).toBe(1);
    expect(find(state, "V1").attached.some((p) => p.card.id === "eye")).toBe(false);
  });

  it("upkeep: during your unlock phase, burn 1 pool or burn the Eye", () => {
    const state = minionPhase("Carol", (s) => equip(s, "V1", "eye", "Eye of Hazimel"));
    const engine = new VtesEngine(state, testRegistry);
    endTurn(engine, state);
    expect(ids(engine).sort()).toEqual([
      "choice:Eye of Hazimel:eye:upkeep:burn",
      "choice:Eye of Hazimel:eye:upkeep:pay",
    ]);
    const pool = seatOf(state, "Alice").pool;
    runTrace(engine, [["Alice", "choice:Eye of Hazimel:eye:upkeep:pay"]]);
    expect(seatOf(state, "Alice").pool).toBe(pool - 1);
    expect(find(state, "V1").attached.some((p) => p.card.id === "eye")).toBe(true);
  });

  it("…and burning it there still hurts the bearer (§4)", () => {
    const state = minionPhase("Carol", (s) => equip(s, "V1", "eye", "Eye of Hazimel"));
    const engine = new VtesEngine(state, testRegistry);
    endTurn(engine, state);
    runTrace(engine, [["Alice", "choice:Eye of Hazimel:eye:upkeep:burn"]]);
    expect(find(state, "V1").attached.some((p) => p.card.id === "eye")).toBe(false);
    expect(find(state, "V1").blood).toBe(1);
  });

  it("…with no pool to spare there is no question: the Eye burns", () => {
    const state = minionPhase("Carol", (s) => {
      equip(s, "V1", "eye", "Eye of Hazimel");
      seatOf(s, "Alice").pool = 1;
    });
    const engine = new VtesEngine(state, testRegistry);
    endTurn(engine, state);
    expect(has(engine, "choice:Eye of Hazimel:")).toBe(false);
    expect(find(state, "V1").attached.some((p) => p.card.id === "eye")).toBe(false);
    expect(seatOf(state, "Alice").pool).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Talbot's Chainsaw
// ---------------------------------------------------------------------------

describe("Talbot's Chainsaw (101931)", () => {
  it("the bearer cannot hunt — and the vampire without it can", () => {
    expect(has(new VtesEngine(minionPhase("Alice"), testRegistry), "hunt:V1")).toBe(true);
    const state = minionPhase("Alice", (s) => equip(s, "V1", "cs", "Talbot's Chainsaw"));
    expect(has(new VtesEngine(state, testRegistry), "hunt:V1")).toBe(false);
  });

  it("…and a bearer at 0 blood is not forced to hunt (the p. 19 stuck rule)", () => {
    const state = minionPhase("Alice", (s) => {
      equip(s, "V1", "cs", "Talbot's Chainsaw");
      find(s, "V1").blood = 0;
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(has(engine, "hunt:V1")).toBe(false);
    expect(ids(engine).length).toBeGreaterThan(0);
  });

  /** Rush N and walk to the given press step, answering the strikes with
   *  bare hands — the Chainsaw is offered and never forced [LSJ 19971215]. */
  function toPress(engine: VtesEngine, state: GameState, round: number): void {
    for (let i = 0; i < 80; i++) {
      const cf = combat(state);
      if (!cf) throw new Error("combat ended early");
      if (cf.step === "press" && cf.round === round && cf.awaiting === "acting") return;
      const options = ids(engine);
      if (cf.step === "chooseStrike" && engine.decision()?.seat === "Alice") {
        expect(options).toContain("strike:hand");
        expect(options.some((o) => o.includes("Talbot's Chainsaw"))).toBe(true);
      }
      const pick = ["pass", "strike:hand", "press:continue"].find((p) => options.includes(p));
      if (!pick) throw new Error(`nothing to walk: ${options.join(", ")}`);
      engine.choose(pick);
    }
    throw new Error("never reached the press step");
  }

  it("round 1's press is MANDATORY; round 2's is not", () => {
    const { state, engine } = rushN("Talbot's Chainsaw", "cs");
    toPress(engine, state, 1);
    expect(ids(engine)).not.toContain("pass");
    expect(ids(engine)).toContain("press:continue");
    runTrace(engine, [["Alice", "press:continue"]]);
    // Carol has nothing to cancel it with.
    runTrace(engine, [["Carol", "pass"]]);
    toPress(engine, state, 2);
    expect(ids(engine)).toContain("pass");
  });

  it("an opposing press to end cancels it (p. 30, owner ruling), and combat ends", () => {
    const { state, engine } = rushN("Talbot's Chainsaw", "cs", (s) => attachRaw(s, "N", "pr", { pressPerCombat: 1 }));
    toPress(engine, state, 1);
    runTrace(engine, [["Alice", "press:continue"]]);
    expect(ids(engine)).toContain("press:end");
    runTrace(engine, [["Carol", "press:end"]]);
    // Spent: the bearer is asked again, and is not forced a second time.
    expect(engine.decision()?.seat).toBe("Alice");
    expect(ids(engine)).toContain("pass");
    for (let i = 0; i < 20 && combat(state); i++) engine.choose("pass");
    expect(combat(state)).toBeUndefined();
  });

  it("strike: 3 damage", () => {
    const { state, engine } = rushN("Talbot's Chainsaw", "cs");
    for (let i = 0; i < 40 && !has(engine, "strike:hand"); i++) engine.choose("pass");
    const strike = ids(engine).find((o) => o.includes("Talbot's Chainsaw"));
    expect(strike).toBeDefined();
    runTrace(engine, [["Alice", strike!]]);
    runTrace(engine, [["Carol", "strike:hand"]]);
    for (let i = 0; i < 20 && !state.eventLog.some((e) => e.type === "DamageInflicted" && e.minion === "N"); i++) {
      engine.choose(ids(engine).includes("pass") ? "pass" : ids(engine)[0]!);
    }
    const hit = state.eventLog.find((e) => e.type === "DamageInflicted" && e.minion === "N");
    expect(hit?.type === "DamageInflicted" ? hit.amount : null).toBe(3);
  });

  it("the bearer can prevent 1 damage, once each combat", () => {
    const { state, engine } = rushN("Talbot's Chainsaw", "cs");
    for (let i = 0; i < 40 && !has(engine, "strike:hand"); i++) engine.choose("pass");
    runTrace(engine, [["Alice", "strike:hand"]]);
    runTrace(engine, [["Carol", "strike:hand"]]);
    for (let i = 0; i < 20 && !has(engine, "ability:Talbot's Chainsaw:cs:vest"); i++) engine.choose("pass");
    const opt = engine.decision()!.options.find((o) => o.id === "ability:Talbot's Chainsaw:cs:vest")!;
    expect(opt.label).toContain("prevent 1");
    runTrace(engine, [["Alice", opt.id]]);
    expect(combat(state)!.usedThisCombat).toContain("cs");
  });

  it("during your unlock phase, 3 unpreventable damage to a ready minion you control", () => {
    const state = minionPhase("Carol", (s) => {
      equip(s, "V1", "cs", "Talbot's Chainsaw");
      seatOf(s, "Alice").minions.push(makeMinion("V2", "Alice", { blood: 4, capacity: 6 }));
    });
    const engine = new VtesEngine(state, testRegistry);
    endTurn(engine, state);
    // Mandatory, and the bearer is a legal choice (§4).
    expect(ids(engine).sort()).toEqual([
      "choice:Talbot's Chainsaw:cs:unlockDamage:V1",
      "choice:Talbot's Chainsaw:cs:unlockDamage:V2",
    ]);
    runTrace(engine, [["Alice", "choice:Talbot's Chainsaw:cs:unlockDamage:V2"]]);
    expect(find(state, "V2").blood).toBe(1);
    expect(find(state, "V1").blood).toBe(6);
  });

  it("…but not while the bearer is in torpor", () => {
    const state = minionPhase("Carol", (s) => {
      equip(s, "V1", "cs", "Talbot's Chainsaw");
      Object.assign(find(s, "V1"), { inTorpor: true });
      seatOf(s, "Alice").minions.push(makeMinion("V2", "Alice", { blood: 4, capacity: 6 }));
    });
    const engine = new VtesEngine(state, testRegistry);
    endTurn(engine, state);
    expect(has(engine, "choice:Talbot's Chainsaw:")).toBe(false);
    expect(find(state, "V2").blood).toBe(4);
  });
});
