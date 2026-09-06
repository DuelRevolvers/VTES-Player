/**
 * Searching the library, and out-of-play card stores
 * (docs/library-search-design.md).
 *
 * Magic of the Smith (101143), Vast Wealth (102092), Black Market Cache
 * (102351), Shilmulo Tarot (101767), Fleshforge Chamber (102354).
 *
 * The rulebook is unusually specific here (p. 14, p. 48), so the rules it
 * states get their own assertions: a search is resolved at RESOLUTION and
 * never announced, "find nothing" is always legal, and the library is
 * shuffled either way.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, redactFor } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function inPlay(
  id: string,
  name: string,
  extra: Partial<PermanentInPlay> = {},
): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
    ...extra,
  };
}

function alice(state: GameState): GameState["seats"][number] {
  return state.seats[0]!;
}

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

describe("Magic of the Smith (101143)", () => {
  function game(level: "basic" | "superior"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { tha: level }, blood: 3 });
    alice(state).hand.push({ id: "ms", name: "Magic of the Smith" });
    alice(state).library.push(
      // Playing the card draws a REPLACEMENT off the top, so the first
      // card here is gone before the search ever runs (p. 7).
      { id: "filler", name: "Conditioning" },
      { id: "l1", name: "Conditioning" }, // not equipment
      { id: "l2", name: ".44 Magnum" }, // 2 pool
      { id: "l3", name: "Assault Rifle" }, // 5 pool
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  /** Play the card and drive the action to a successful resolution. */
  function resolveAction(engine: VtesEngine, id: string): void {
    runTrace(engine, [
      ["Alice", id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
  }

  it("names no card at announcement — the option id carries no target (p. 48)", () => {
    const { engine } = game("basic");
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.startsWith("play:Magic of the Smith"))
      .map((o) => o.id);
    // One option, not one per equipment in the library: "you do not have
    // to announce which card you are getting".
    expect(ids).toEqual(["play:Magic of the Smith:basic:V1:ms"]);
  });

  it("asks only after the action succeeds, and offers every affordable equipment", () => {
    const { state, engine } = game("basic");
    resolveAction(engine, "play:Magic of the Smith:basic:V1:ms");

    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const ids = dp.options.map((o) => o.id);
    // The Magnum (2 pool, affordable) and "find nothing". Conditioning is
    // not equipment; the Assault Rifle costs 5 and Alice has 10 pool, so
    // it IS affordable — assert both equipment, no action modifier.
    expect(ids).toContain("choice:Magic of the Smith:ms:searchEquip:l2");
    expect(ids).toContain("choice:Magic of the Smith:ms:searchEquip:l3");
    expect(ids).toContain("choice:Magic of the Smith:ms:searchEquip:none");
    expect(ids.some((i) => i.endsWith(":l1"))).toBe(false);
    void state;
  });

  it("equips the chosen card, charges its cost, and shuffles the library", () => {
    const { state, engine } = game("basic");
    const pool = alice(state).pool;
    resolveAction(engine, "play:Magic of the Smith:basic:V1:ms");
    runTrace(engine, [["Alice", "choice:Magic of the Smith:ms:searchEquip:l2"]]);

    expect(find(state, "V1").attached.some((p) => p.card.name === ".44 Magnum")).toBe(true);
    expect(alice(state).pool).toBe(pool - 2);
    expect(alice(state).library.some((c) => c.id === "l2")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("'find nothing' is legal even with matches, and STILL shuffles (p. 48)", () => {
    const { state, engine } = game("basic");
    resolveAction(engine, "play:Magic of the Smith:basic:V1:ms");
    runTrace(engine, [["Alice", "choice:Magic of the Smith:ms:searchEquip:none"]]);

    expect(find(state, "V1").attached.length).toBe(0);
    expect(alice(state).library.map((c) => c.id).sort()).toEqual(["l1", "l2", "l3"]);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("superior is the +3 stealth version", () => {
    const { state, engine } = game("superior");
    runTrace(engine, [
      ["Alice", "play:Magic of the Smith:superior:V1:ms"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 3),
    ).toBe(true);
  });

  it("does not offer an equipment the seat cannot pay for", () => {
    const { state, engine } = game("basic");
    alice(state).pool = 3; // the Assault Rifle costs 5
    resolveAction(engine, "play:Magic of the Smith:basic:V1:ms");
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("choice:Magic of the Smith:ms:searchEquip:l2");
    expect(ids.some((i) => i.endsWith(":l3"))).toBe(false);
  });
});

describe("Vast Wealth (102092)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { blood: 3 });
    find(state, "V1").attached.push(inPlay("vw", "Vast Wealth"));
    alice(state).library.push(
      { id: "l1", name: "Conditioning" },
      { id: "l2", name: "Assault Rifle" },
      { id: "l3", name: ".44 Magnum" },
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("takes the FIRST equipment from the top — no choice at all", () => {
    const { state, engine } = game();
    const opt = engine
      .decision()!
      .options.find((o) => o.id.startsWith("act:Vast Wealth:vw:equip:"));
    expect(opt).toBeDefined();

    runTrace(engine, [
      [opt!.id.startsWith("act") ? "Alice" : "Alice", opt!.id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // blocks declined
    ]);
    // The Assault Rifle is nearer the top than the Magnum, so it is the
    // one found — and no ChoiceFrame was ever raised.
    expect(find(state, "V1").attached.some((p) => p.card.name === "Assault Rifle")).toBe(true);
    expect(state.frames.some((f) => f.kind === "choice")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });
});

describe("Black Market Cache (102351)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = masterPhase(threeSeatGame());
    alice(state).hand.push({ id: "bmc", name: "Black Market Cache" });
    alice(state).library.push(
      { id: "filler", name: "Conditioning" }, // taken by the replacement draw
      { id: "l1", name: ".44 Magnum" }, // non-unique
      { id: "l2", name: "Assault Rifle" }, // non-unique
      { id: "l3", name: "Kali's Fang" }, // Unique — excluded
      { id: "l4", name: "Conditioning" }, // not equipment
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  function play(engine: VtesEngine): void {
    runTrace(engine, [
      ["Alice", "play:Black Market Cache:-:bmc"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
  }

  it("searches for up to three NON-UNIQUE equipment, and can find nothing", () => {
    const { engine } = game();
    play(engine);
    const ids = engine.decision()!.options.map((o) => o.id);
    // Subsets of {l1, l2} only: Kali's Fang is unique, Conditioning is
    // not equipment. Plus "find nothing".
    expect(ids).toEqual([
      "choice:Black Market Cache:bmc:searchStore:none",
      "choice:Black Market Cache:bmc:searchStore:l1",
      "choice:Black Market Cache:bmc:searchStore:l2",
      "choice:Black Market Cache:bmc:searchStore:l1,l2",
    ]);
  });

  it("stores the chosen cards face up, out of play, and shuffles", () => {
    const { state, engine } = game();
    play(engine);
    runTrace(engine, [["Alice", "choice:Black Market Cache:bmc:searchStore:l1,l2"]]);

    const entry = alice(state).permanents.find((p) => p.card.id === "bmc");
    expect(entry?.stored?.map((c) => c.name)).toEqual([".44 Magnum", "Assault Rifle"]);
    expect(entry?.storedFaceUp).toBe(true);
    // Out of play means out of the library too.
    expect(alice(state).library.map((c) => c.id).sort()).toEqual(["l3", "l4"]);
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("burns itself when the search finds nothing — it has no cards on it", () => {
    const { state, engine } = game();
    play(engine);
    runTrace(engine, [["Alice", "choice:Black Market Cache:bmc:searchStore:none"]]);
    expect(alice(state).permanents.some((p) => p.card.id === "bmc")).toBe(false);
  });

  it("offers its stored cards in place of a library draw, and burns when drained", () => {
    const { state, engine } = game();
    play(engine);
    runTrace(engine, [["Alice", "choice:Black Market Cache:bmc:searchStore:l1"]]);

    // Force a draw: the discard phase draws back up to hand size.
    const before = alice(state).hand.length;
    engine.drawCards("Alice", 1);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Alice");
    const ids = dp.options.map((o) => o.id);
    expect(ids).toContain("choice:Black Market Cache:bmc:drawFrom:l1");
    expect(ids).toContain("choice:Black Market Cache:bmc:drawFrom:library");

    runTrace(engine, [["Alice", "choice:Black Market Cache:bmc:drawFrom:l1"]]);
    expect(alice(state).hand.some((c) => c.id === "l1")).toBe(true);
    expect(alice(state).hand.length).toBe(before + 1);
    // Emptied, so it burns.
    expect(alice(state).permanents.some((p) => p.card.id === "bmc")).toBe(false);
  });

  it("taking the library instead leaves the store alone", () => {
    const { state, engine } = game();
    play(engine);
    runTrace(engine, [["Alice", "choice:Black Market Cache:bmc:searchStore:l1"]]);
    engine.drawCards("Alice", 1);
    runTrace(engine, [["Alice", "choice:Black Market Cache:bmc:drawFrom:library"]]);

    const entry = alice(state).permanents.find((p) => p.card.id === "bmc");
    expect(entry?.stored?.length).toBe(1);
    expect(alice(state).hand.some((c) => c.id === "l1")).toBe(false);
  });
});

describe("Shilmulo Tarot (101767)", () => {
  function equipped(): GameState {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Ravnos" });
    const entry = inPlay("tarot", "Shilmulo Tarot");
    find(state, "V1").attached.push(entry);
    alice(state).library.push(
      { id: "l1", name: ".44 Magnum" },
      { id: "l2", name: "Conditioning" },
      { id: "l3", name: "Assault Rifle" },
    );
    return state;
  }

  it("takes the top 2 cards face down when it enters play", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { clan: "Ravnos" });
    alice(state).library.push(
      { id: "l1", name: ".44 Magnum" },
      { id: "l2", name: "Conditioning" },
      { id: "l3", name: "Assault Rifle" },
    );
    const engine = new VtesEngine(state, testRegistry);
    engine.putPermanentInPlay({
      card: { id: "tarot", name: "Shilmulo Tarot" },
      seat: "Alice",
      attachTo: "V1",
      statics: {},
      tags: ["Shilmulo Tarot"],
    });
    const entry = find(state, "V1").attached.find((p) => p.card.id === "tarot");
    expect(entry?.stored?.map((c) => c.id)).toEqual(["l1", "l2"]);
    expect(entry?.storedFaceUp).toBe(false);
    expect(alice(state).library.map((c) => c.id)).toEqual(["l3"]);
  });

  it("keeps a face-down store secret from other Methuselahs", () => {
    const state = equipped();
    const entry = find(state, "V1").attached.find((p) => p.card.id === "tarot")!;
    entry.stored = [{ id: "l1", name: ".44 Magnum" }];
    entry.storedFaceUp = false;

    const mine = redactFor(state, "Alice");
    const theirs = redactFor(state, "Bob");
    const readStore = (s: GameState): string[] =>
      s.seats
        .flatMap((x) => x.minions)
        .flatMap((m) => m.attached)
        .find((p) => p.card.id === "tarot")!
        .stored!.map((c) => c.name);
    expect(readStore(mine)).toEqual([".44 Magnum"]);
    // The count survives, the name does not.
    expect(readStore(theirs)).toEqual([""]); // FACE_DOWN
  });

  it("only redirects a draw while the bearer is ready", () => {
    const state = equipped();
    const entry = find(state, "V1").attached.find((p) => p.card.id === "tarot")!;
    entry.stored = [{ id: "s1", name: ".44 Magnum" }];
    entry.storedFaceUp = false;
    find(state, "V1").inTorpor = true;

    const engine = new VtesEngine(state, testRegistry);
    engine.drawCards("Alice", 1);
    // No choice: the bearer is not ready, so the draw happened normally.
    expect(state.frames.some((f) => f.kind === "choice")).toBe(false);
    expect(alice(state).hand.some((c) => c.id === "l1")).toBe(true);
  });

  it("moves the top library card onto itself during its controller's unlock phase", () => {
    const state = equipped();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Alice";
      tf.phase = "unlock";
      tf.unlockDone = true;
      // The fixture starts mid-turn with the unlock window already spent.
      tf.unlockAbilitiesDone = false;
    }
    const engine = new VtesEngine(state, testRegistry);
    const opt = engine
      .decision()!
      .options.find((o) => o.id === "ability:Shilmulo Tarot:tarot:addTop");
    expect(opt).toBeDefined();
    runTrace(engine, [["Alice", opt!.id]]);

    const entry = find(state, "V1").attached.find((p) => p.card.id === "tarot");
    expect(entry?.stored?.map((c) => c.id)).toEqual(["l1"]);
    expect(alice(state).library.map((c) => c.id)).toEqual(["l2", "l3"]);
  });
});

describe("Fleshforge Chamber (102354)", () => {
  function game(): { state: GameState; engine: VtesEngine } {
    const state = masterPhase(threeSeatGame());
    alice(state).permanents.push(inPlay("ffc", "Fleshforge Chamber"));
    alice(state).hand.push(
      { id: "h1", name: "Revenant" }, // ghoul retainer
      { id: "h2", name: "Raven Spy" }, // animal retainer — not a ghoul
      { id: "h3", name: "War Ghoul" }, // ghoul ALLY
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("stores only GHOULS from hand — allies included", () => {
    const { engine } = game();
    const ids = engine
      .decision()!
      .options.filter((o) => o.id.includes(":store:"))
      .map((o) => o.id);
    // War Ghoul is a ghoul ALLY: an ally's tags were invisible to a
    // filter like this until compileAlly exposed `permanentTags`.
    expect(ids).toEqual([
      "ability:Fleshforge Chamber:ffc:store:h1",
      "ability:Fleshforge Chamber:ffc:store:h3",
    ]);
  });

  it("a Tzimisce can play a stored card as if from hand, paying its cost", () => {
    const { state, engine } = game();
    runTrace(engine, [["Alice", "ability:Fleshforge Chamber:ffc:store:h1"]]);
    const entry = alice(state).permanents.find((p) => p.card.id === "ffc");
    expect(entry?.stored?.map((c) => c.id)).toEqual(["h1"]);
    expect(alice(state).hand.some((c) => c.id === "h1")).toBe(false);

    // Only a Tzimisce may play it.
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.phase = "minion";
    const e2 = new VtesEngine(state, testRegistry);
    expect(
      e2.decision()!.options.some((o) => o.id.includes("Fleshforge Chamber") && o.id.includes(":play:")),
    ).toBe(false);

    find(state, "V1").clan = "Tzimisce";
    const e3 = new VtesEngine(state, testRegistry);
    const opt = e3
      .decision()!
      .options.find((o) => o.id.includes("Fleshforge Chamber") && o.id.includes(":play:"));
    expect(opt).toBeDefined();

    const blood = find(state, "V1").blood;
    runTrace(e3, [["Alice", opt!.id]]);
    // Revenant is a 1-blood ghoul retainer: it attaches to V1 and is paid for.
    expect(find(state, "V1").attached.some((p) => p.card.name === "Revenant")).toBe(true);
    expect(find(state, "V1").blood).toBe(blood - 1);
    expect(alice(state).permanents.find((p) => p.card.id === "ffc")?.stored?.length).toBe(0);
  });
});

describe("the store is genuinely out of play", () => {
  it("a stored card is in no other zone", () => {
    const state = masterPhase(threeSeatGame());
    alice(state).permanents.push(inPlay("ffc", "Fleshforge Chamber"));
    alice(state).hand.push({ id: "h1", name: "Revenant" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "ability:Fleshforge Chamber:ffc:store:h1"]]);

    const seat = alice(state);
    expect(seat.hand.some((c) => c.id === "h1")).toBe(false);
    expect(seat.library.some((c) => c.id === "h1")).toBe(false);
    expect(seat.permanents.some((p) => p.card.id === "h1")).toBe(false);
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "h1")).toBe(false);
    expect(seat.permanents.find((p) => p.card.id === "ffc")?.stored?.length).toBe(1);
  });
});

describe("a redirected draw does not spin the hand-size top-up", () => {
  /**
   * `reconcileHandSize` loops "while the hand is short and the library is
   * not empty, draw" — and a redirected draw (Black Market Cache) ASKS
   * instead of drawing, leaving the condition unchanged. Inside action
   * resolution `raiseChoice` only queues, so the loop emitted no event and
   * pushed no frame: an invisible infinite loop that exhausted the heap.
   * Found by the fuzz (seed 2) once a new wave reshuffled the decks.
   */
  it("tops the hand up at most one draw at a time, and terminates", () => {
    const state = masterPhase(threeSeatGame());
    const seat = alice(state);
    seat.permanents.push(
      inPlay("bmc", "Black Market Cache", {
        stored: [{ id: "s1", name: ".44 Magnum" }],
        storedFaceUp: true,
      }),
      // +3 hand size, so the top-up wants several cards at once — which is
      // what made the loop spin rather than merely re-ask.
      inPlay("hs", "Elder Library", { statics: { handSize: 3 } }),
    );
    seat.hand.length = 0;
    seat.library.push(
      { id: "l1", name: "Conditioning" },
      { id: "l2", name: "Conditioning" },
      { id: "l3", name: "Conditioning" },
      { id: "l4", name: "Conditioning" },
    );
    const engine = new VtesEngine(state, testRegistry);
    // Any event that reconciles the hand size is enough to trigger it.
    engine.drawCards("Alice", 1);
    const dp = engine.decision();
    expect(dp).not.toBeNull();
    // One question, not an unbounded pile of them.
    expect(state.frames.filter((f) => f.kind === "choice")).toHaveLength(1);
    expect(dp!.options.some((o) => o.id.includes(":drawFrom:"))).toBe(true);
  });
});
