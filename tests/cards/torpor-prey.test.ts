/**
 * Preying on a vampire in torpor (docs/torpor-prey-design.md).
 *
 * Cloak of Blood (100360), Stealing Years (101866), Crematorium (100445),
 * Corruption's Purge (100431).
 *
 * Three cards that take something from a vampire lying in torpor, and one
 * that puts them there. The diablerie half runs through the engine's own
 * five-step resolution (p. 34), so what these tests pin is the RIDERS: what
 * is read before the victim burns, and what the blood hunt is told.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function phase(state: GameState, seat: string, p: "minion" | "unlock" | "discard"): GameState {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = p;
  return state;
}

/** Walk to the start of the next Methuselah's turn, preferring `pass`. */
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

/** Play the announced action out to the end: pass everywhere, and CAST when a
 *  referendum asks — the blood hunt is part of the diablerie's resolution, so
 *  a test that stops before it has not seen the card work. */
function drive(engine: VtesEngine, state: GameState, limit = 60): void {
  for (let i = 0; i < limit; i++) {
    if (state.frames.every((f) => f.kind === "turn")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id.endsWith(":against")) ??
      dp.options.find((o) => o.id.startsWith("vote:")) ??
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      // Step 4 of the diablerie raises the ENGINE's own question when the
      // victim was older (p. 34), and that frame offers no `pass` — a walker
      // that only knows how to pass stops dead there, and the blood hunt
      // after it never happens.
      dp.options.find((o) => o.id.startsWith("choice:"));
    if (!pick) return;
    engine.choose(pick.id);
  }
}

/** Take the named option as soon as it is offered to whoever is asked. */
function takeWhenOffered(engine: VtesEngine, prefix: string, limit = 24): string | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) {
      engine.choose(hit.id);
      return hit.id;
    }
    const pass = dp.options.find((o) => o.id === "pass");
    if (!pass) return null;
    engine.choose(pass.id);
  }
  return null;
}

// ---------------------------------------------------------------------------

describe("Cloak of Blood (100360)", () => {
  /** Alice's V1 (capacity 6) hunts a torpid vampire of Bob's. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { capacity: 6, blood: 3 });
    Object.assign(find(state, "W")!, {
      inTorpor: true,
      blood: 2,
      capacity: 4,
      disciplines: { aus: "superior", for: "basic" },
    });
    seatOf(state, "Alice").hand.push({ id: "cb", name: "Cloak of Blood" });
    return { state, engine: new VtesEngine(phase(state, "Alice", "minion"), testRegistry) };
  }

  it("targets only vampires in torpor, and needs capacity 6", () => {
    const { state, engine } = game();
    const ids = optionIds(engine).filter((i) => i.startsWith("play:Cloak of Blood"));
    // W is the only vampire in torpor; the ready ones are not targets.
    expect(ids).toEqual(["play:Cloak of Blood:basic:V1:W:cb"]);

    find(state, "V1")!.capacity = 5; // "capacity ABOVE 5"
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((i) =>
        i.startsWith("play:Cloak of Blood"),
      ),
    ).toBe(false);
  });

  it("diablerises: the blood moves, the victim burns, a hunt is called", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Cloak of Blood:basic:V1:W:cb"]]);
    takeWhenOffered(engine, "choice:Cloak of Blood:cb:victimDiscipline:");
    drive(engine, state);

    // Step 1: the victim's blood moved to the diablerist. Step 3: the
    // victim burned. Read off the LOG, because step 5's blood hunt may burn
    // the diablerist too and that is a different question.
    expect(find(state, "W")).toBeUndefined();
    expect(
      state.eventLog.some((e) => e.type === "BloodGained" && e.minion === "V1" && e.amount === 2),
    ).toBe(true);
    expect(state.eventLog.some((e) => e.type === "DiablerieCommitted")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "W")).toBe(true);
  });

  it("offers ONE LEVEL of a Discipline the victim had, and nothing else", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Cloak of Blood:basic:V1:W:cb"]]);
    // Walk to the question.
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes("victimDiscipline"))) break;
      const pass = dp.options.find((o) => o.id === "pass");
      if (!pass) break;
      engine.choose(pass.id);
    }
    const ids = optionIds(engine).filter((i) => i.includes("victimDiscipline"));
    // The victim's two Disciplines, and no third — the list is read off the
    // victim BEFORE the burn, which is the only moment it exists.
    expect(ids.sort()).toEqual([
      "choice:Cloak of Blood:cb:victimDiscipline:aus",
      "choice:Cloak of Blood:cb:victimDiscipline:for",
    ]);

    runTrace(engine, [["Alice", "choice:Cloak of Blood:cb:victimDiscipline:aus"]]);
    // V1 had no Auspex at all, so one level is BASIC.
    expect(find(state, "V1")!.disciplines["aus"]).toBe("basic");
  });

  it("gives the diablerist 2 extra votes in the resulting blood hunt", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Cloak of Blood:basic:V1:W:cb"]]);
    takeWhenOffered(engine, "choice:Cloak of Blood:cb:victimDiscipline:");
    drive(engine, state);
    // The hunt is called and resolves inside the same play, so the frame is
    // gone by the time a test could read it — what is observable is the VOTE
    // the rider bought: V1 has no title and so no votes of its own, and yet
    // it is offered two.
    expect(
      state.eventLog.some((e) => e.type === "VoteCast" && e.source === "V1" && e.count === 2),
    ).toBe(true);
    // The rider is consumed: it belongs to this hunt and no later referendum.
    expect(find(state, "V1")?.bloodHuntVoteRiders).toBeUndefined();
  });
});

describe("Stealing Years (101866)", () => {
  function game(victimCapacity: number): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { sect: "anarch", capacity: 4, blood: 3 });
    Object.assign(find(state, "W")!, { inTorpor: true, blood: 1, capacity: victimCapacity });
    seatOf(state, "Alice").hand.push({ id: "sy", name: "Stealing Years" });
    return { state, engine: new VtesEngine(phase(state, "Alice", "minion"), testRegistry) };
  }

  it("targets an OLDER vampire in torpor only", () => {
    const older = game(7);
    expect(
      optionIds(older.engine).some((i) => i.startsWith("play:Stealing Years")),
    ).toBe(true);

    const younger = game(3);
    expect(
      optionIds(younger.engine).some((i) => i.startsWith("play:Stealing Years")),
    ).toBe(false);
  });

  it("raises the anarch's capacity by 1, on the card that stays with them", () => {
    const { state, engine } = game(7);
    runTrace(engine, [["Alice", "play:Stealing Years:basic:V1:W:sy"]]);
    drive(engine, state);
    const v1 = find(state, "V1")!;
    expect(v1.attached.some((p) => p.card.id === "sy")).toBe(true);
    expect(v1.attached.find((p) => p.card.id === "sy")!.statics.capacityBonus).toBe(1);
  });

  it("gives EVERY anarch an extra vote in the hunt, not just the diablerist", () => {
    const { state, engine } = game(7);
    // A second anarch of Alice's, who did no diablerie at all: the clause
    // names a SECT, so the vote is theirs too.
    seatOf(state, "Alice").minions.push(
      makeMinion("A2", "Alice", { sect: "anarch", blood: 2 }),
    );
    runTrace(engine, [["Alice", "play:Stealing Years:basic:V1:W:sy"]]);
    drive(engine, state);
    const cast = state.eventLog.filter((e) => e.type === "VoteCast");
    expect(cast.some((e) => e.source === "A2" && e.count === 1)).toBe(true);
  });
});

describe("Crematorium (100445)", () => {
  function game(victimBlood: number): GameState {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push({
      card: { id: "cr", name: "Crematorium" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Crematorium", "location"],
      controller: "Alice",
    });
    Object.assign(find(state, "W")!, { inTorpor: true, blood: victimBlood });
    return phase(state, "Carol", "discard"); // next turn — and unlock — is Alice's
  }

  it("burns a torpid vampire with NO blood, in the unlock phase", () => {
    const state = game(0);
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    const id = "ability:Crematorium:cr:burntorpid:W";
    expect(optionIds(engine)).toContain(id);

    runTrace(engine, [["Alice", id]]);
    expect(find(state, "W")).toBeUndefined();
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(true);
  });

  it("does not touch a torpid vampire with blood left", () => {
    const state = game(1);
    const engine = new VtesEngine(state, testRegistry);
    walkToNextTurn(engine, state);
    expect(optionIds(engine).some((i) => i.includes("burntorpid"))).toBe(false);
    expect(find(state, "W")).toBeDefined();
  });
});

describe("Corruption's Purge (100431)", () => {
  it("burns 2 blood from every Ministry and torpors the ones left empty", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { title: "prince", blood: 3 });
    // Two Ministry vampires of Bob's: one survives the burn, one does not.
    seatOf(state, "Bob").minions.push(
      makeMinion("M1", "Bob", { clan: "Ministry", blood: 5 }),
      makeMinion("M2", "Bob", { clan: "Ministry", blood: 2 }),
      makeMinion("B3", "Bob", { clan: "Brujah", blood: 2 }),
    );
    seatOf(state, "Alice").hand.push({ id: "cp", name: "Corruption's Purge" });
    const engine = new VtesEngine(phase(state, "Alice", "minion"), testRegistry);

    const play = optionIds(engine).find((i) => i.startsWith("play:Corruption's Purge"));
    expect(play).toBeDefined();
    engine.choose(play!);
    // Drive the action and the referendum: everyone passes, the caller's own
    // votes carry it.
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (state.frames.every((f) => f.kind === "turn")) break;
      const pick =
        dp.options.find((o) => o.id.startsWith("vote:") && o.id.endsWith(":for")) ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      engine.choose(pick.id);
    }

    expect(find(state, "M1")!.blood).toBe(3);
    expect(find(state, "M1")!.inTorpor).toBe(false);
    // M2 had exactly 2: empty, and then into torpor.
    expect(find(state, "M2")!.blood).toBe(0);
    expect(find(state, "M2")!.inTorpor).toBe(true);
    // The Brujah is untouched — the clause names one clan.
    expect(find(state, "B3")!.blood).toBe(2);
    expect(find(state, "B3")!.inTorpor).toBe(false);
  });
});
