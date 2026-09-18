/**
 * The out-of-play stores you play out of (docs/store-plays-design.md).
 *
 * Gift of Proteus (100827), Storage Annex (101877).
 *
 * The two cards are the same zone put to opposite uses: one is a store a
 * single vampire plays out of "as if from your hand", the other a store
 * NOBODY plays out of, whose card only ever comes back by an exchange. So
 * the negative space is most of what is worth pinning: which hand cards
 * each fill refuses, which minion is offered the stored card, and that
 * Storage Annex's card is offered to no one at all.
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

function alice(state: GameState): GameState["seats"][number] {
  return state.seats[0]!;
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** A store in play, built by hand. The play permission lives on the
 *  HANDLER, not the entry, so a hand-built entry is a real store — unlike
 *  statics, which a hand-built entry would silently lose. */
function storeEntry(id: string, name: string, stored: Array<{ id: string; name: string }>) {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
    stored,
    storedFaceUp: false,
  } satisfies PermanentInPlay;
}

/** A master card's as-played window (p. 7): three declines. */
const asPlayed: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

const undirectedActionPasses: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
];

function masterPhase(state: GameState, seat = "Alice"): GameState {
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.seat = seat;
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  return state;
}

// ---------------------------------------------------------------------------

describe("Gift of Proteus (100827)", () => {
  /** V1 as a Gangrel with Protean, the Gift and one Protean card in hand.
   *  Alice's starting hand already holds Conditioning ([dom]) — the
   *  negative control the fill must refuse. */
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      clan: "Gangrel",
      disciplines: { pro: "superior" },
      blood: 4,
    });
    alice(state).hand.push(
      { id: "g1", name: "Gift of Proteus" },
      { id: "em", name: "Earth Meld" }, // [pro] combat
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("fills from hand with Protean cards only — one card at a time", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Gift of Proteus"], ...undirectedActionPasses]);

    // The fill is asked AFTER the action resolves, and it is a real choice.
    const first = ids(engine);
    expect(first).toContain("choice:Gift of Proteus:g1:fillStore:hand:em");
    // Conditioning requires Dominate, not Protean.
    expect(first.some((i) => i.endsWith(":c1"))).toBe(false);
    expect(first).toContain("choice:Gift of Proteus:g1:fillStore:none");

    runTrace(engine, [["Alice", "choice:Gift of Proteus:g1:fillStore:hand:em"]]);
    // "Any number": it asks again, and now only the decline is left.
    expect(ids(engine)).toEqual(["choice:Gift of Proteus:g1:fillStore:none"]);
    runTrace(engine, [["Alice", "choice:Gift of Proteus:g1:fillStore:none"]]);

    const entry = find(state, "V1").attached.find((p) => p.card.id === "g1");
    expect(entry?.stored?.map((c) => c.id)).toEqual(["em"]);
    // Out of play means out of every other zone, and stored cards are not
    // replaced: Alice's hand is down to the card the fill refused.
    expect(alice(state).hand.map((c) => c.id)).toEqual(["c1"]);
    expect(alice(state).ashHeap?.some((c) => c.id === "em")).not.toBe(true);
  });

  it("burns on arrival when there is nothing it may take", () => {
    const { state, engine } = game();
    alice(state).hand = alice(state).hand.filter((c) => c.id !== "em");
    runTrace(engine, [["Alice", "play:Gift of Proteus"], ...undirectedActionPasses]);
    // The only answer is "put nothing on it", and then the card has no
    // cards on it.
    expect(ids(engine)).toEqual(["choice:Gift of Proteus:g1:fillStore:none"]);
    runTrace(engine, [["Alice", "choice:Gift of Proteus:g1:fillStore:none"]]);
    expect(find(state, "V1").attached.some((p) => p.card.id === "g1")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "PermanentBurned")).toBe(true);
  });

  it("the BEARER plays the stored card — in the combat window it belongs in", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      clan: "Gangrel",
      disciplines: { pro: "superior" },
      blood: 4,
    });
    find(state, "V1").attached.push(
      storeEntry("g1", "Gift of Proteus", [{ id: "em", name: "Earth Meld" }]),
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // Walk to the window Earth Meld is played in, preferring `pass` — a
    // walker that takes options[0] plays the board.
    let played = false;
    for (let i = 0; i < 12 && !played; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const opt = dp.options.find((o) => o.id.startsWith("play:Earth Meld"));
      if (opt) {
        // The store is on V1, so every offer names V1 and nobody else —
        // both of them, because V1 has Protean at superior and the card
        // prints two modes ("requirements apply as normal").
        const offers = dp.options.filter((o) => o.id.startsWith("play:Earth Meld"));
        expect(offers.length).toBe(2);
        expect(offers.every((o) => o.id.includes(":V1:"))).toBe(true);
        engine.choose(opt.id);
        played = true;
        break;
      }
      const pass = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      engine.choose(pass.id);
    }
    expect(played).toBe(true);

    const gift = find(state, "V1").attached.find((p) => p.card.id === "g1");
    // "Burn this card if it has no cards on it" — playing the last card out
    // of it empties it.
    expect(gift).toBeUndefined();
    expect(
      state.eventLog.some((e) => e.type === "CardPlayed" && e.name === "Earth Meld"),
    ).toBe(true);
    // The card was never in hand, so nothing was drawn to replace it.
    expect(alice(state).hand.map((c) => c.id)).toEqual(["c1"]);
  });

  it("is offered to NOBODY when the bearer is not the one who could play it", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      clan: "Gangrel",
      disciplines: { pro: "superior" },
      blood: 4,
    });
    // The Gift sits on a second Gangrel who is not in the combat; V1, who
    // is, has Protean and is not the bearer.
    alice(state).minions.push(
      makeMinion("V2", "Alice", { clan: "Gangrel", disciplines: { pro: "superior" } }),
    );
    find(state, "V2").attached.push(
      storeEntry("g1", "Gift of Proteus", [{ id: "em", name: "Earth Meld" }]),
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp) break;
      expect(dp.options.some((o) => o.id.startsWith("play:Earth Meld"))).toBe(false);
      const pass = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      engine.choose(pass.id);
    }
  });
});

describe("Storage Annex (101877)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = masterPhase(threeSeatGame());
    alice(state).hand.push(
      { id: "sa", name: "Storage Annex" },
      { id: "em", name: "Earth Meld" },
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("takes a card from hand on arrival, and the clause is NOT optional", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "play:Storage Annex"], ...asPlayed]);
    const opts = ids(engine);
    // "PUT a card from your hand on this card": every hand card is a
    // candidate and there is no "put nothing on it".
    expect(opts).toContain("choice:Storage Annex:sa:fillStore:hand:c1");
    expect(opts).toContain("choice:Storage Annex:sa:fillStore:hand:em");
    expect(opts.some((i) => i.endsWith(":none"))).toBe(false);

    runTrace(engine, [["Alice", "choice:Storage Annex:sa:fillStore:hand:em"]]);
    const entry = alice(state).permanents.find((p) => p.card.id === "sa");
    expect(entry?.stored?.map((c) => c.id)).toEqual(["em"]);
    expect(entry?.storedFaceUp).toBe(false);
  });

  it("nobody plays the card on it — the store has no play permission", () => {
    const { state, engine } = game();
    Object.assign(find(state, "V1"), { disciplines: { pro: "superior" }, blood: 4 });
    runTrace(engine, [
      ["Alice", "play:Storage Annex"],
      ...asPlayed,
      ["Alice", "choice:Storage Annex:sa:fillStore:hand:em"],
    ]);
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    const e2 = new VtesEngine(state, testRegistry);
    // Earth Meld is out of play, not in a pile anyone may play from: the
    // difference between this card and the Gift is one absent field.
    expect(ids(e2).some((i) => i.startsWith("play:Earth Meld"))).toBe(false);
  });

  it("exchanges a hand card for the card on it during the master phase", () => {
    const { state, engine } = game();
    runTrace(engine, [
      ["Alice", "play:Storage Annex"],
      ...asPlayed,
      ["Alice", "choice:Storage Annex:sa:fillStore:hand:em"],
    ]);
    // One option per card in hand; the store holds exactly one card.
    const opts = ids(engine).filter((i) => i.includes(":swap:"));
    expect(opts).toEqual(["ability:Storage Annex:sa:swap:c1"]);

    runTrace(engine, [["Alice", "ability:Storage Annex:sa:swap:c1"]]);
    const entry = alice(state).permanents.find((p) => p.card.id === "sa");
    expect(entry?.stored?.map((c) => c.id)).toEqual(["c1"]);
    expect(alice(state).hand.map((c) => c.id)).toEqual(["em"]);
  });
});
