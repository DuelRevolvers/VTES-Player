/**
 * Legacy locations — tranche 3 wave 2 (docs/pool-widening-design.md §6).
 *
 * Thirteen master cards from outside the V5 sets:
 *
 *  - **Ten hunting grounds**, which print the same clause as the twelve
 *    already in the pool and take the same helper. What is worth pinning
 *    is not that the mechanic works — `hunting-grounds.test.ts` owns that
 *    — but that each of the ten actually REACHES it. A name typo or a
 *    missing `supported.json` id produces a card that is in the registry
 *    and does nothing, and nothing else would notice.
 *  - **London Evening Star** and **Monastery of Shadows**, two lock
 *    grants the vocabulary already said in full.
 *  - **The Mausoleum, Venice**, which needed one new knob:
 *    `extraUnlessInPlay`.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, handSizeOf } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const HUNTING_GROUNDS: Array<[number, string]> = [
  [100049, "Amusement Park Hunting Ground"],
  [100136, "Base Hunting Ground"],
  [100288, "Campground Hunting Ground"],
  [100426, "Corporate Hunting Ground"],
  [100724, "Fetish Club Hunting Ground"],
  [100996, "Institution Hunting Ground"],
  [101243, "Morgue Hunting Ground"],
  [101421, "Port Hunting Ground"],
  [101753, "Shanty Town Hunting Ground"],
  [102075, "University Hunting Ground"],
];

function loc(id: string, name: string, tags = ["location"]): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags };
}

function hg(id: string, name: string): PermanentInPlay {
  return loc(id, name, ["location", "huntingGround"]);
}

/** A game parked in Alice's unlock phase, V1 short a blood. */
function unlockState(): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "unlock";
    tf.unlockDone = false;
    tf.unlockAbilitiesDone = false;
  }
  state.seats[0]!.minions[0]!.blood = 2;
  return state;
}

// --- the ten hunting grounds ----------------------------------------------

describe("the legacy hunting grounds", () => {
  for (const [id, name] of HUNTING_GROUNDS) {
    it(`${name} (${id}) feeds a ready vampire`, () => {
      const state = unlockState();
      state.seats[0]!.permanents.push(hg("hg1", name));
      const engine = new VtesEngine(state, testRegistry);
      runTrace(engine, [["Alice", `ability:${name}:hg1:V1`]]);
      expect(state.seats[0]!.minions[0]!.blood).toBe(3);
      expect(state.seats[0]!.minions[0]!.usedHuntingGroundThisTurn).toBe(true);
    });
  }

  it("a legacy one and a V5 one still share the once-per-vampire limit", () => {
    // The rule is per VAMPIRE, not per card, and it has to hold across
    // the two halves of the pool — which is the only thing the widening
    // could plausibly have broken.
    const state = unlockState();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { blood: 2 }));
    state.seats[0]!.permanents.push(hg("hg1", "Morgue Hunting Ground"));
    state.seats[0]!.permanents.push(hg("hg2", "Academic Hunting Ground"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Morgue Hunting Ground:hg1:V1"]]);
    const opts = engine.decision()?.options.map((o) => o.id) ?? [];
    expect(opts.some((o) => o.startsWith("ability:Academic Hunting Ground:hg2:V1"))).toBe(false);
    // …and the V5 card is not simply dead: it still offers the OTHER
    // vampire, so the line above is the per-vampire limit rather than a
    // legacy card poisoning everything after it.
    expect(opts.some((o) => o.startsWith("ability:Academic Hunting Ground:hg2:V2"))).toBe(true);
  });
});

// --- London Evening Star ---------------------------------------------------

/** Alice's V1 hunts (+1 inherent stealth, p. 21) and Bob's M attempts the
 *  block, so intercept is NEEDED and therefore offered (p. 26). Stops with
 *  the acting seat — Alice — being asked inside the attempt. */
const toBlockAttempt: Array<[string, string]> = [
  ["Alice", "hunt:V1"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
  ["Alice", "pass"],
  ["Bob", "block:M"],
];

describe("London Evening Star, Tabloid Newspaper (101120)", () => {
  it("gives +1 intercept to a blocker its controller does not control", () => {
    // "Give ANY minion" — no "you control". Alice owns the paper and
    // hands the intercept to BOB's blocker, which is the whole point of
    // the card and the thing an `ownOnly` would have broken. M has 0
    // intercept against a hunt's 1 stealth, so the block only lands if
    // the +1 really arrived: the combat frame is the assertion.
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("le", "London Evening Star, Tabloid Newspaper"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toBlockAttempt);

    const dp = engine.decision()!;
    const opt = dp.options.find((o) => o.id.startsWith("ability:London Evening Star"));
    expect(opt).toBeDefined();
    runTrace(engine, [
      [dp.seat, opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt resolves
    ]);
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "le")!.locked).toBe(true);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(true);
  });

  it("NEGATIVE SPACE: without it the same block fails", () => {
    // The control. A hunt is +1 stealth and M has 0 intercept, so an
    // unaided attempt must NOT reach combat — otherwise the test above
    // proves nothing about the newspaper.
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ...toBlockAttempt,
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });
});

// --- Monastery of Shadows --------------------------------------------------

describe("Monastery of Shadows (101238)", () => {
  it("gives its controller +1 hand size", () => {
    const state = threeSeatGame();
    const before = handSizeOf(state, "Alice");
    state.seats[0]!.permanents.push({
      ...loc("ms", "Monastery of Shadows"),
      statics: testRegistry["Monastery of Shadows"]!.permanentStatics ?? {},
    });
    expect(handSizeOf(state, "Alice")).toBe(before + 1);
  });

  it("locks to give an acting vampire of capacity 8 or more +1 stealth", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.capacity = 8;
    state.seats[0]!.permanents.push(loc("ms", "Monastery of Shadows"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce → A
      ["Alice", "pass"],
      ["Bob", "block:M"], // a live attempt, so stealth is needed (p. 26)
    ]);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Monastery of Shadows"))).toBe(
      true,
    );
  });

  it("NEGATIVE SPACE: not offered for a capacity-7 vampire", () => {
    // Same trace, one number different. Without the capacity-8 case above
    // this would pass just as well if the card did nothing at all.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.capacity = 7;
    state.seats[0]!.permanents.push(loc("ms", "Monastery of Shadows"));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:M"],
    ]);
    expect(engine.decision()!.options.some((o) => o.id.startsWith("ability:Monastery of Shadows"))).toBe(
      false,
    );
  });
});

// --- The Mausoleum, Venice -------------------------------------------------

/** Alice calls a political action; the trace stops at the polling step. */
const toPolling: Array<[string, string]> = [
  ["Alice", "play:Anarchist Uprising"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
];

describe("The Mausoleum, Venice (101187)", () => {
  function game(withHQ: boolean): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("mv", "The Mausoleum, Venice"));
    // On BOB's table on purpose: "in play" is not "in play for you".
    if (withHQ) state.seats[1]!.permanents.push(loc("hq", "Ventrue Headquarters"));
    state.seats[0]!.hand.push({ id: "au1", name: "Anarchist Uprising" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, toPolling);
    return { state, engine };
  }

  function mausoleumOption(engine: VtesEngine): { id: string; label: string } {
    const o = engine.decision()?.options.find((x) => x.id.startsWith("ability:The Mausoleum"));
    if (!o) throw new Error("The Mausoleum was not offered during polling");
    return { id: o.id, label: o.label };
  }

  it("is worth +2 votes while /Ventrue Headquarters/ is not in play", () => {
    const { state, engine } = game(false);
    const opt = mausoleumOption(engine);
    // The label and the grant are read from one helper; if they ever
    // drift, this pair is what says so.
    expect(opt.label).toContain("+2 votes");
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "vote:grant:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.find((e) => e.type === "ReferendumResolved")).toMatchObject({
      votesFor: 2,
    });
  });

  it("…and only +1 while it IS in play, on ANOTHER Methuselah's table", () => {
    // The control. Reading only the controller's own permanents would
    // pass the test above and still be wrong at the table.
    const { state, engine } = game(true);
    const opt = mausoleumOption(engine);
    expect(opt.label).toContain("+1 votes");
    runTrace(engine, [
      ["Alice", opt.id],
      ["Alice", "vote:grant:for"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.eventLog.find((e) => e.type === "ReferendumResolved")).toMatchObject({
      votesFor: 1,
    });
  });
});

// --- admission -------------------------------------------------------------

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;
  const wave: Array<[number, string]> = [
    ...HUNTING_GROUNDS,
    [101120, "London Evening Star, Tabloid Newspaper"],
    [101238, "Monastery of Shadows"],
    [101187, "The Mausoleum, Venice"],
  ];

  it("all thirteen are in the pool, implemented, and named exactly as printed", () => {
    const wrong = wave.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });

  it("every one of them has a compiled handler", () => {
    // The registry entry and the handler are two different lists, and a
    // card can be in one without the other — which is exactly a card that
    // is legal to put in a deck and does nothing on the table.
    const missing = wave.filter(([, name]) => !testRegistry[name]);
    expect(missing.map(([, name]) => name)).toEqual([]);
  });
});
