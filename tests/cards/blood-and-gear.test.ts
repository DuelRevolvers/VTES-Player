/**
 * Moving blood and gear between minions (docs/blood-and-gear-design.md).
 *
 * Communal Haven: Cathedral (100385), The Spawning Pool (101839),
 * Blood Trade (100215).
 *
 * Blood normally moves from the bank to a vampire, or out of one as a cost.
 * These three move it sideways — between two of your own, onto a card, and
 * across the table — and the Cathedral moves EQUIPMENT the same way, which
 * is the same question about a different thing a minion carries.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay, TurnPhase } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function inPlay(
  id: string,
  name: string,
  controller: string,
  over: Partial<PermanentInPlay> = {},
): PermanentInPlay {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler for ${name}`);
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: { ...(h.permanentStatics ?? {}) },
    tags: [...(h.permanentTags ?? [])],
    controller,
    ...over,
  };
}

// `TurnPhase`, not a hand-copied union: this helper spelled out three of the
// five phases and a test that wanted the discard phase did not typecheck.
function phase(state: GameState, seat: string, p: TurnPhase): GameState {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = p;
  if (p === "master") tf.masterActionsLeft = 1;
  return state;
}

/** Walk to the start of the next Methuselah's turn. The unlock phase is not a
 *  phase a fixture can set by hand: the engine runs the sweep as a turn
 *  BEGINS and only then opens the window, so the way into it is to walk. */
function walkToNextTurn(engine: VtesEngine, state: GameState, limit = 160): void {
  const tf0 = state.frames[0]!;
  const from = tf0.kind === "turn" ? tf0.seat : "";
  for (let i = 0; i < limit; i++) {
    const tf = state.frames[0]!;
    if (tf.kind === "turn" && tf.seat !== from) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end");
    if (!pick) return;
    engine.choose(pick.id);
  }
  throw new Error("never reached the next turn");
}

/** Bleed with `actor`, block with `blocker`, whoever the engine asks. */
function bleedAndBlock(engine: VtesEngine, actor: string, blocker: string, limit = 20): void {
  engine.choose("bleed:" + actor);
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return;
    const block = dp.options.find((o) => o.id === "block:" + blocker);
    if (block) {
      engine.choose(block.id);
      return;
    }
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return;
    engine.choose(pass.id);
  }
}

// ---------------------------------------------------------------------------

describe("Communal Haven: Cathedral (100385)", () => {
  /** Two ready Sabbat vampires and one Camarilla, all Alice's. */
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", blood: 3, capacity: 5 });
    seatOf(state, "Alice").minions.push(
      makeMinion("S2", "Alice", { sect: "sabbat", blood: 1, capacity: 5 }),
      makeMinion("C3", "Alice", { sect: "camarilla", blood: 1, capacity: 5 }),
    );
    seatOf(state, "Alice").permanents.push(
      inPlay("ch", "Communal Haven: Cathedral", "Alice"),
    );
    return phase(state, "Alice", "master");
  }

  it("moves blood between two ready SABBAT vampires and nobody else", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((i) => i.includes("carryblood"));
    // V1 (3 blood) and S2 (1 blood) can each give to the other; the Camarilla
    // vampire is neither a giver nor a receiver.
    expect(ids).toEqual([
      "ability:Communal Haven: Cathedral:ch:carryblood:V1:S2",
      "ability:Communal Haven: Cathedral:ch:carryblood:S2:V1",
    ]);

    runTrace(engine, [["Alice", "ability:Communal Haven: Cathedral:ch:carryblood:V1:S2"]]);
    expect(find(state, "V1").blood).toBe(2);
    expect(find(state, "S2").blood).toBe(2);
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(true);
  });

  it("moves EQUIPMENT the same way, on the same one lock", () => {
    const state = game();
    find(state, "V1").attached.push(inPlay("gun", ".44 Magnum", "Alice"));
    const engine = new VtesEngine(state, testRegistry);
    const id = "ability:Communal Haven: Cathedral:ch:carrygear:gun:S2";
    expect(optionIds(engine)).toContain(id);

    runTrace(engine, [["Alice", id]]);
    // The same entry, on a different minion: it never left play.
    expect(find(state, "V1").attached.some((p) => p.card.id === "gun")).toBe(false);
    expect(find(state, "S2").attached.some((p) => p.card.id === "gun")).toBe(true);
    // One lock, spent on whichever half was taken.
    expect(optionIds(engine).some((i) => i.includes("Cathedral"))).toBe(false);
  });

  it("offers nothing while locked", () => {
    const state = game();
    seatOf(state, "Alice").permanents[0]!.locked = true;
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) => i.includes("Cathedral")),
    ).toBe(false);
  });

  it("never offers to fill a vampire who is already at capacity", () => {
    const state = game();
    Object.assign(find(state, "S2"), { blood: 5, capacity: 5 });
    const ids = optionIds(new VtesEngine(state, testRegistry)).filter((i) =>
      i.includes("carryblood"),
    );
    // S2 can still GIVE; nobody can give TO them.
    expect(ids).toEqual(["ability:Communal Haven: Cathedral:ch:carryblood:S2:V1"]);
  });
});

describe("The Spawning Pool (101839)", () => {
  function game(counters = 0): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Nosferatu", blood: 3 });
    seatOf(state, "Alice").permanents.push(
      inPlay("sp", "The Spawning Pool", "Alice", { counters }),
    );
    return state;
  }

  it("moves blood from a ready Nosferatu ONTO the card", () => {
    // Carol's discard phase, so the next turn — and the next unlock phase —
    // is Alice's.
    const state = phase(game(), "Carol", "discard");
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    const id = "ability:The Spawning Pool:sp:carryblood:V1:card";
    expect(optionIds(engine)).toContain(id);

    runTrace(engine, [["Alice", id]]);
    expect(find(state, "V1").blood).toBe(2);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(1);
    // "During your unlock phase, you MAY move 1 blood" — once per phase
    // (p. 16), and the card does not lock for it.
    expect(optionIds(engine).some((i) => i.includes("carryblood"))).toBe(false);
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(false);
  });

  it("burns the acting minion for each blood on it, in the SECOND round", () => {
    // The bleed has to be AGAINST ALICE, and a bleed goes to the actor's
    // PREY: in the fixture's order (Alice, Bob, Carol) that is CAROL's
    // minion. Getting this backwards is why the first draft of this test saw
    // no option at all — the card asks about a bleed against YOU.
    const state = game(3);
    Object.assign(find(state, "N"), { blood: 5 });
    // A combat ENDS after one round unless somebody presses (p. 32), so a
    // card whose clause lives in the second round needs a press to get
    // there. This entry carries the one static that grants it; any
    // press-granting card would do.
    find(state, "V1").attached.push({
      card: { id: "pr", name: "Dread Mastiff" },
      locked: false,
      usedThisPhase: false,
      statics: { pressPerCombat: 1 },
      tags: [],
    });
    phase(state, "Carol", "minion");
    const engine = new VtesEngine(state, testRegistry);
    bleedAndBlock(engine, "N", "V1");
    // Round 1: not yet — the card names the second round.
    let seen = false;
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const hit = dp.options.find((o) => o.id === "ability:The Spawning Pool:sp:punish");
      const cf = state.frames.find((f) => f.kind === "combat");
      if (hit) {
        expect(cf?.kind === "combat" && cf.round).toBe(2);
        engine.choose(hit.id);
        seen = true;
        break;
      }
      const pick =
        dp.options.find((o) => o.id === "press:continue") ??
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(seen).toBe(true);
    // 3 counters, 3 unpreventable damage. The counters STAY on the card —
    // the clause spends the lock, not the blood.
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(true);
    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(3);
    expect(
      state.eventLog.some((e) => e.type === "DamageInflicted" && e.amount === 3),
    ).toBe(true);
  });

  it("offers no punishment with no blood on it", () => {
    const state = game(0);
    Object.assign(find(state, "N"), { blood: 5 });
    phase(state, "Carol", "minion");
    const engine = new VtesEngine(state, testRegistry);
    bleedAndBlock(engine, "N", "V1");
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id.includes("sp:punish"))).toBe(false);
      const pick =
        dp.options.find((o) => o.id === "press:continue") ??
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      engine.choose(pick.id);
    }
  });
});

describe("Blood Trade (100215)", () => {
  function game(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3, capacity: 5 });
    Object.assign(find(state, "W"), { blood: 1, capacity: 5 });
    // CAROL's card; every Methuselah uses it in their own unlock phase.
    seatOf(state, "Carol").permanents.push(inPlay("bt", "Blood Trade", "Carol"));
    return state;
  }

  it("lets the seat whose unlock phase it is move blood ACROSS the table", () => {
    const state = phase(game(), "Carol", "discard"); // next turn: Alice's
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    const ids = optionIds(engine).filter((i) => i.includes("carryblood"));
    // Alice's V1 may give to Bob's or Carol's vampires — never to her own.
    expect(ids.some((i) => i.endsWith(":V1:W"))).toBe(true);
    expect(ids.every((i) => i.includes(":V1:"))).toBe(true);
    expect(ids.some((i) => i.endsWith(":V1:V1"))).toBe(false);

    runTrace(engine, [["Alice", "ability:Blood Trade:bt:carryblood:V1:W"]]);
    expect(find(state, "V1").blood).toBe(2);
    expect(find(state, "W").blood).toBe(2);
  });

  it("is the CARD OWNER's turn to use it too, in their own phase", () => {
    const state = phase(game(), "Bob", "discard"); // next turn: Carol's
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    const ids = optionIds(engine).filter((i) =>
      i.includes("carryblood"),
    );
    // Carol's own minion is N (2 blood in the fixture), and her targets are
    // the other seats'.
    expect(ids.some((i) => i.startsWith("ability:Blood Trade:bt:carryblood:N:"))).toBe(true);
  });

  it("bars a boon from being played at all", () => {
    const state = phase(game(), "Alice", "minion");
    Object.assign(find(state, "V1"), { sect: "anarch", title: "baron" });
    seatOf(state, "Alice").hand.push({ id: "cb", name: "Consanguineous Boon" });
    // With the event in play, the boon has no play option; without it, it has.
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Consanguineous Boon"),
      ),
    ).toBe(false);

    seatOf(state, "Carol").permanents = [];
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Consanguineous Boon"),
      ),
    ).toBe(true);
  });
});
