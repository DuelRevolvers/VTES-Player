/**
 * The title riders (docs/title-riders-design.md).
 *
 * Fourteen title-granting political actions the waves had left out:
 *
 *  - Praxis Seizure: Washington, D.C. — the PLAIN shape, missed because the
 *    city's full stop was read as the end of a sentence (§1);
 *  - eleven Praxis Seizures whose rider reads "if the prince is <clan>, his
 *    or her capacity increases by 1", every clan of which is in the V5 crypt;
 *  - Crusade: Berlin and Crusade: Istanbul, whose rider names Lasombra and
 *    Tzimisce — clans the pool did not have when the other Crusades landed,
 *    and does now.
 *
 * Every case drives the real referendum. What is pinned is the rider against
 * its TWIN: the same caller under two cards whose riders name different clans.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, capacityOf } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };

function v1(state: GameState): MinionState {
  return state.seats[0]!.minions[0]!;
}

/**
 * Alice's V1 calls `card` and votes for it with the caller's own ballot; the
 * referendum then resolves. V1 has no title, so that ballot is the only vote
 * cast and the card passes 1–0.
 */
function callAndPass(
  card: string,
  v: Partial<MinionState>,
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(v1(state), { title: null, capacity: 6, blood: 4, ...v });
  state.seats[0]!.hand.push({ id: "tc", name: card });
  state.seats[0]!.library = Array.from({ length: 8 }, (_, i) => ({ id: `lib${i}`, name: "Conditioning" }));
  const engine = new VtesEngine(state, testRegistry);
  const play = engine.decision()!.options.find((o) => o.id.startsWith(`play:${card}`));
  if (!play) throw new Error(`${card} not playable by this caller`);
  engine.choose(play.id);
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) break;
    if (dp.window === "turn.minion" && !state.frames.some((f) => f.kind === "referendum")) break;
    const pick =
      dp.options.find((o) => o.id === "vote:caller:for") ??
      dp.options.find((o) => o.id === "pass");
    if (!pick) break;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return { state, engine };
}

/** Walk out of Alice's turn: minion → influence → discard → Bob's turn. */
function walkToNextTurn(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 80; i++) {
    const tf = state.frames[0];
    if (tf?.kind === "turn" && tf.seat !== "Alice") return;
    const dp = engine.decision();
    if (!dp) return;
    const pick =
      dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end");
    if (!pick) return;
    engine.choose(pick.id);
  }
  throw new Error("never left Alice's turn");
}

// ---------------------------------------------------------------------------

describe("Praxis Seizure: Washington, D.C. (101472) — the one the full stop hid", () => {
  it("makes the caller Prince of Washington, D.C., city and all", () => {
    const { state } = callAndPass("Praxis Seizure: Washington, D.C.", { sect: "camarilla" });
    expect(v1(state).title).toBe("prince");
    // The city is what titles contest on (p. 39); a truncated "Washington"
    // would contest with nothing and everything wrongly.
    expect(v1(state).titleCity).toBe("Washington, D.C.");
    expect(v1(state).attached.some((p) => p.card.name === "Praxis Seizure: Washington, D.C.")).toBe(true);
  });
});

describe("the capacity rider — one sentence, eleven clans", () => {
  it("Athens gives a TREMERE prince +1 capacity", () => {
    const { state } = callAndPass("Praxis Seizure: Athens", { sect: "camarilla", clan: "Tremere" });
    expect(v1(state).title).toBe("prince");
    expect(capacityOf(v1(state))).toBe(7);
  });

  it("THE TWIN: the same Tremere under Berlin (a Ventrue rider) gets nothing", () => {
    const { state } = callAndPass("Praxis Seizure: Berlin", { sect: "camarilla", clan: "Tremere" });
    expect(v1(state).title).toBe("prince");
    expect(capacityOf(v1(state))).toBe(6);
  });

  it("…and Berlin gives a VENTRUE prince the +1 instead", () => {
    const { state } = callAndPass("Praxis Seizure: Berlin", { sect: "camarilla", clan: "Ventrue" });
    expect(capacityOf(v1(state))).toBe(7);
  });

  it("the bonus is the prince's CAPACITY, not blood — nothing is gained", () => {
    const { state } = callAndPass("Praxis Seizure: Paris", { sect: "camarilla", clan: "Toreador" });
    expect(capacityOf(v1(state))).toBe(7);
    // 4 blood before, 4 after: "capacity increases" raises the ceiling only.
    expect(v1(state).blood).toBe(4);
  });

  // All eleven, each against a clan that is NOT its own — so a rider wired to
  // the wrong clan fails here rather than only on the three spelled out above.
  // The FULL name is spelled out as its own column: the library-audit coverage
  // guard searches test source for each card's literal name, and a name built
  // from a template string never appears (the praxis-seizure.test.ts shape).
  const CAPACITY_CITIES: Array<[string, string, string]> = [
    ["Praxis Seizure: Athens", "Tremere", "Ventrue"],
    ["Praxis Seizure: Barcelona", "Tremere", "Ventrue"],
    ["Praxis Seizure: Berlin", "Ventrue", "Tremere"],
    ["Praxis Seizure: Brussels", "Nosferatu", "Tremere"],
    ["Praxis Seizure: Cairo", "Ventrue", "Tremere"],
    ["Praxis Seizure: Geneva", "Ventrue", "Tremere"],
    ["Praxis Seizure: Glasgow", "Gangrel", "Tremere"],
    ["Praxis Seizure: Monaco", "Toreador", "Tremere"],
    ["Praxis Seizure: Paris", "Toreador", "Tremere"],
    ["Praxis Seizure: Rome", "Brujah", "Tremere"],
    ["Praxis Seizure: Stockholm", "Malkavian", "Tremere"],
  ];
  for (const [card, clan, other] of CAPACITY_CITIES) {
    it(`${card} — +1 for a ${clan} prince, nothing for a ${other}`, () => {
      const yes = callAndPass(card, { sect: "camarilla", clan });
      expect(yes.state.seats[0]!.minions[0]!.title).toBe("prince");
      expect(capacityOf(yes.state.seats[0]!.minions[0]!)).toBe(7);
      const no = callAndPass(card, { sect: "camarilla", clan: other });
      expect(capacityOf(no.state.seats[0]!.minions[0]!)).toBe(6);
    });
  }

  it("every clan a rider names is a clan the V5 crypt actually has", () => {
    // The reason these were excluded was the rider, not an absent clan — and
    // a rider naming a clan nobody is would be the "Assamite" bug: whole,
    // and silently inert. Read off the REAL registry, not a list in this file.
    const cryptClans = new Set(
      Object.values(registry.entries)
        .map((e) => e.card)
        .filter((c) => c.kind === "crypt")
        .map((c) => (c as { clan?: string }).clan),
    );
    const named = [
      "Tremere", "Ventrue", "Nosferatu", "Gangrel", "Toreador", "Brujah", "Malkavian",
      // …and the two Crusade riders.
      "Lasombra", "Tzimisce",
    ];
    for (const c of named) expect(cryptClans.has(c), `${c} is not in the V5 crypt`).toBe(true);
  });
});

describe("when the capacity bonus goes away", () => {
  it("a FULL prince whose title is contested is not left over capacity", () => {
    // Alice's Tremere holds Prince of Athens and is FULL at the bonus capacity:
    // 6 printed + 1 = 7 blood. Bob then seizes Athens too, the title is
    // contested, Alice's card goes face down (p. 17) — and with it the +1.
    // p. 6: "A vampire cannot have more blood than their capacity; … the
    // excess is always moved to the blood bank immediately."
    const state = threeSeatGame();
    const alice = state.seats[0]!.minions[0]!;
    Object.assign(alice, {
      sect: "camarilla",
      clan: "Tremere",
      capacity: 6,
      blood: 7,
      title: "prince",
      titleCity: "Athens",
    });
    alice.attached.push({
      card: { id: "alicePx", name: "Praxis Seizure: Athens" },
      locked: false,
      usedThisPhase: false,
      statics: { capacityBonusIfClan: { clan: "Tremere", amount: 1 } },
      tags: ["Prince of Athens", "title"],
    });
    expect(capacityOf(alice)).toBe(7);

    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    const w = state.seats[1]!.minions.find((m) => m.id === "W")!;
    Object.assign(w, { sect: "camarilla", title: null });
    state.seats[1]!.hand.push({ id: "bobPx", name: "Praxis Seizure: Athens" });
    const engine = new VtesEngine(state, testRegistry);
    const play = engine
      .decision()!
      .options.find((o) => o.id.startsWith("play:Praxis Seizure: Athens") && o.id.includes(":W:"));
    expect(play, "Bob cannot call Athens with W").toBeDefined();
    engine.choose(play!.id);
    for (let i = 0; i < 40; i++) {
      const dp = engine.decision();
      if (!dp || !state.frames.some((f) => f.kind !== "turn")) break;
      const pick = dp.options.find((o) => o.id === "vote:caller:for") ?? dp.options.find((o) => o.id === "pass");
      if (!pick) break;
      engine.choose(pick.id);
    }

    // The contest happened: Alice's card is out of play.
    expect(alice.attached.some((p) => p.card.id === "alicePx")).toBe(false);
    expect(capacityOf(alice)).toBe(6);
    // …and so did p. 6: exactly the 1 blood of excess went to the bank —
    // `drainOverCapacity`, which settle() runs for a derived capacity that
    // FALLS (written for the Discipline masters; this rider is its second user).
    expect(alice.blood).toBe(6);
    expect(
      state.eventLog.some((e) => e.type === "BloodBurned" && e.minion === alice.id && e.amount === 1),
    ).toBe(true);
  });
});

describe("the Crusade rider — unlock during your next discard phase", () => {
  it("Crusade: Berlin unlocks a LASOMBRA archbishop in the discard phase", () => {
    const { state, engine } = callAndPass("Crusade: Berlin", { sect: "sabbat", clan: "Lasombra" });
    expect(v1(state).title).toBe("archbishop");
    // Calling the political action locked the caller (p. 25).
    expect(v1(state).locked).toBe(true);
    walkToNextTurn(engine, state);
    // Bob's turn: Alice's minions do not unlock in Bob's unlock phase, so an
    // unlocked V1 here was unlocked by the rider in Alice's discard phase.
    expect(v1(state).locked).toBe(false);
  });

  it("THE TWIN: a Tzimisce under Berlin stays locked", () => {
    const { state, engine } = callAndPass("Crusade: Berlin", { sect: "sabbat", clan: "Tzimisce" });
    expect(v1(state).locked).toBe(true);
    walkToNextTurn(engine, state);
    expect(v1(state).locked).toBe(true);
  });

  it("…and Crusade: Istanbul unlocks the Tzimisce instead", () => {
    const { state, engine } = callAndPass("Crusade: Istanbul", { sect: "sabbat", clan: "Tzimisce" });
    expect(v1(state).title).toBe("archbishop");
    walkToNextTurn(engine, state);
    expect(v1(state).locked).toBe(false);
  });
});
