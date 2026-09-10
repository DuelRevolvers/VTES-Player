/**
 * Contested cards and contested titles (p. 17–18), quoted where each rule
 * is tested. The two sections are one subsystem — same trigger, same
 * unlock-phase pay-or-yield, same "last claimant standing wins" — and
 * differ only in what is contested and what it costs.
 *
 * Cards (p. 17): "If more than one unique card with the same name is
 * brought into play, that means control of the card is being contested.
 * For the duration of the contest, all of the contested cards are turned
 * face down and are out of play. … The cost to contest a card is 1 pool,
 * which you pay during each of your unlock phases. Instead of paying the
 * cost to contest the card, you may choose to yield the card. A yielded
 * card is burned. Any cards or counters stacked on the yielded card are
 * also burned. If all other cards contesting your unique card are
 * yielded, then the card is unlocked and turned face up during your next
 * unlock phase, ending the contest."
 *
 * Titles (p. 18): "If more than one vampire in play claims the same
 * unique title, then the title is contested. While the title is being
 * contested, the vampires involved in the contest are treated as if they
 * have no title, but they remain controlled and may act and block as
 * normal. The cost to contest a title is 1 blood, which is paid by the
 * vampire during each of their unlock phases. Instead of paying the cost
 * to contest the title, the vampire may choose to yield the title (or may
 * be forced to yield, if they have no blood to pay). Only ready vampires
 * can contest titles. Vampires in torpor must yield during the unlock
 * phase. … The vampire yielding the title will now have no title and
 * loses the benefits of the title for the remainder of the game."
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { titleContestKey, VtesEngine } from "../../src/engine/index.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import { importCryptCard } from "../../src/ui/cardinfo.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { buildGame } from "../../src/ui/decks.ts";
import { preconDeck } from "../../src/ui/deckimport.ts";
import { makeMinion, testRegistry, threeSeatGame } from "./fixtures.ts";

function loc(id: string, name: string): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [] };
}

/** The named seat's unlock phase, at the top. */
function unlockPhase(state: GameState, seat: string): GameState {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("fixture");
  tf.seat = seat;
  tf.phase = "unlock";
  tf.unlockDone = false;
  tf.edgeDone = false;
  tf.unlockAbilitiesDone = false;
  tf.unlockOthersDone = [];
  delete tf.contestsDone;
  delete tf.contestsHandled;
  return state;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Answer the first option whose id contains `want`. */
function answer(engine: VtesEngine, want: string): void {
  const dp = engine.decision();
  const found = dp?.options.find((o) => o.id.includes(want));
  if (!found) throw new Error(`no option containing "${want}" in: ${optionIds(engine).join(", ")}`);
  engine.choose(found.id);
}

// ---------------------------------------------------------------------------
// Contested cards
// ---------------------------------------------------------------------------

describe("a unique card two Methuselahs control", () => {
  function twoLibraries(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("a1", "Elder Library"));
    state.seats[1]!.permanents.push(loc("b1", "Elder Library"));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision(); // settle
    return { state, engine };
  }

  it("goes face down and OUT OF PLAY, on both sides", () => {
    const { state } = twoLibraries();
    expect(state.seats[0]!.permanents).toEqual([]);
    expect(state.seats[1]!.permanents).toEqual([]);
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["a1"]);
    expect(state.seats[1]!.contested?.map((c) => c.card.id)).toEqual(["b1"]);
  });

  it("is not burned — a contest can still be won", () => {
    const { state } = twoLibraries();
    expect(state.eventLog.some((e) => e.type === "PermanentBurned")).toBe(false);
    expect(state.seats[0]!.ashHeap ?? []).toEqual([]);
  });

  it("takes its STATIC out of play with it", () => {
    // The reason "out of play" is modelled by moving the card rather than
    // by a flag: nothing has to learn to skip it. Elder Library's +1 hand
    // size is simply not there.
    const state = threeSeatGame();
    state.seats[0]!.permanents.push({ ...loc("a1", "Elder Library"), statics: { handSize: 1 } });
    const before = new VtesEngine(state, testRegistry);
    before.decision();
    expect(state.seats[0]!.permanents).toHaveLength(1); // uncontested: still there

    state.seats[1]!.permanents.push({ ...loc("b1", "Elder Library"), statics: { handSize: 1 } });
    const after = new VtesEngine(state, testRegistry);
    after.decision();
    expect(state.seats[0]!.permanents).toEqual([]);
  });

  it("does NOT contest two different cards, or a non-unique one", () => {
    // Two controls in one test, because a sweep that contested everything
    // would pass the tests above just as well.
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("a1", "Elder Library"));
    state.seats[1]!.permanents.push(loc("b1", "Channel 10"));
    // Sport Bike is equipment and prints no "Unique." line.
    state.seats[0]!.minions[0]!.attached.push(loc("a2", "Sport Bike"));
    state.seats[1]!.minions[0]!.attached.push(loc("b2", "Sport Bike"));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.contested ?? []).toEqual([]);
    expect(state.seats[1]!.contested ?? []).toEqual([]);
  });
});

describe("paying for and yielding a contested card", () => {
  function contest(seat = "Alice"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(loc("a1", "Elder Library"));
    state.seats[1]!.permanents.push(loc("b1", "Elder Library"));
    unlockPhase(state, seat);
    const engine = new VtesEngine(state, testRegistry);
    return { state, engine };
  }

  it("asks the holder, in their unlock phase, to pay 1 pool or yield", () => {
    const { engine } = contest();
    const ids = optionIds(engine);
    expect(ids.some((i) => i.endsWith(":pay"))).toBe(true);
    expect(ids.some((i) => i.endsWith(":yield"))).toBe(true);
  });

  it("paying costs 1 pool and keeps the card face down", () => {
    const { state, engine } = contest();
    const before = state.seats[0]!.pool;
    answer(engine, ":pay");
    expect(state.seats[0]!.pool).toBe(before - 1);
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["a1"]);
    expect(state.eventLog.some((e) => e.type === "ContestPaid")).toBe(true);
  });

  it("yielding burns the card into its owner's ash heap", () => {
    const { state, engine } = contest();
    const before = state.seats[0]!.pool;
    answer(engine, ":yield");
    expect(state.seats[0]!.contested ?? []).toEqual([]);
    expect(state.seats[0]!.pool).toBe(before); // yielding is the free option
    expect((state.seats[0]!.ashHeap ?? []).map((c) => c.id)).toContain("a1");
  });

  it("still offers to pay on the LAST pool, even though it ousts", () => {
    // p. 17 gives a Methuselah a way out that Smiling Jack does not — "you
    // may choose to yield" — but it puts no floor under the payment, so
    // spending your last pool stays a legal (bad) choice. It is also the
    // only shape this branch has: a Methuselah at 0 pool has already been
    // ousted, so "cannot afford it" never arrives.
    const { state, engine } = contest();
    state.seats[0]!.pool = 1;
    expect(optionIds(engine).some((i) => i.endsWith(":pay"))).toBe(true);
    answer(engine, ":pay");
    expect(state.seats[0]!.pool).toBe(0);
    expect(state.seats[0]!.ousted).toBe(true);
  });

  it("asks once per unlock phase, not once per settle", () => {
    // The cost is paid "during EACH of your unlock phases" — one question
    // per contest per phase. Without the per-phase latch the loop would
    // re-raise the frame forever.
    const { state, engine } = contest();
    answer(engine, ":pay");
    const next = engine.decision();
    expect(next?.options.some((o) => o.id.includes(":pay"))).toBe(false);
    expect(state.seats[0]!.pool).toBe(9);
  });
});

describe("winning a contest", () => {
  it("returns the card, unlocked, at the winner's NEXT unlock phase", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push({ ...loc("a1", "Elder Library"), locked: true });
    state.seats[1]!.permanents.push(loc("b1", "Elder Library"));
    unlockPhase(state, "Bob");
    const engine = new VtesEngine(state, testRegistry);

    // Bob yields; Alice is now the only claimant, but nothing happens to
    // her copy yet — she gets it in her own unlock phase.
    answer(engine, ":yield");
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["a1"]);
    expect(state.seats[0]!.permanents).toEqual([]);

    unlockPhase(state, "Alice");
    const alice = new VtesEngine(state, testRegistry);
    alice.decision();
    expect(state.seats[0]!.contested ?? []).toEqual([]);
    expect(state.seats[0]!.permanents.map((p) => p.card.id)).toEqual(["a1"]);
    // "…is UNLOCKED and turned face up".
    expect(state.seats[0]!.permanents[0]!.locked).toBe(false);
    expect(state.eventLog.some((e) => e.type === "ContestWon")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contested crypt cards
// ---------------------------------------------------------------------------

describe("two Methuselahs with the same vampire", () => {
  function sameVampire(): GameState {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeMinion("x1", "Alice", { name: "Rudolf Bruckner", blood: 3 }),
    );
    state.seats[1]!.minions.push(
      makeMinion("x2", "Bob", { name: "Rudolf Bruckner", blood: 1 }),
    );
    return state;
  }

  it("contests: 'all crypt cards represent unique minions' (p. 17)", () => {
    const state = sameVampire();
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.minions.map((m) => m.id)).not.toContain("x1");
    expect(state.seats[1]!.minions.map((m) => m.id)).not.toContain("x2");
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["x1"]);
  });

  it("keeps the vampire WHOLE while it is out of play", () => {
    // A contest ends by the card coming back with everything on it, so
    // the minion is parked rather than rebuilt.
    const state = sameVampire();
    state.seats[0]!.minions.at(-1)!.attached.push(loc("gun", "Sport Bike"));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    const held = state.seats[0]!.contested![0]!.minion!;
    expect(held.blood).toBe(3);
    expect(held.attached.map((p) => p.card.id)).toEqual(["gun"]);
  });

  it("yielding burns the cards stacked on it too", () => {
    const state = sameVampire();
    state.seats[0]!.minions.at(-1)!.attached.push(loc("gun", "Sport Bike"));
    unlockPhase(state, "Alice");
    const engine = new VtesEngine(state, testRegistry);
    answer(engine, ":yield");
    const ash = (state.seats[0]!.ashHeap ?? []).map((c) => c.id);
    expect(ash).toContain("x1"); // the vampire's own card
    expect(ash).toContain("gun"); // "any cards … stacked on the yielded card"
  });

  it("does not contest a NON-UNIQUE token vampire", () => {
    // "It becomes a 1-capacity (non-unique) vampire" — the two token
    // cards are the only vampires in the game that never contest.
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("t1", "Alice", { name: "Waters of Duat", nonUnique: true }));
    state.seats[1]!.minions.push(makeMinion("t2", "Bob", { name: "Waters of Duat", nonUnique: true }));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.contested ?? []).toEqual([]);
    expect(state.seats[0]!.minions.map((m) => m.id)).toContain("t1");
  });
});

describe("a forced self-contest", () => {
  it("burns the INCOMING copy rather than starting a contest (p. 17)", () => {
    // "If some effect would force you to contest a card with yourself,
    // then you simply burn the incoming copy." Stealing is that effect.
    const state = threeSeatGame();
    state.seats[0]!.minions.push(makeMinion("x1", "Alice", { name: "Rudolf Bruckner" }));
    state.seats[1]!.minions.push(makeMinion("x2", "Bob", { name: "Rudolf Bruckner" }));
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    // They are contesting. Alice yields, Bob wins his back...
    unlockPhase(state, "Alice");
    const a = new VtesEngine(state, testRegistry);
    answer(a, ":yield");
    unlockPhase(state, "Bob");
    const b = new VtesEngine(state, testRegistry);
    b.decision();
    expect(state.seats[1]!.minions.map((m) => m.id)).toContain("x2");

    // ...and now Alice has a second copy of her own and steals Bob's.
    state.seats[0]!.minions.push(makeMinion("x3", "Alice", { name: "Rudolf Bruckner" }));
    b.changeMinionControl("x2", "Alice");
    expect(state.seats[0]!.minions.map((m) => m.id)).not.toContain("x2");
    expect(state.seats[0]!.minions.map((m) => m.id)).toContain("x3");
    expect(state.eventLog.some((e) => e.type === "MinionBurned" && e.minion === "x2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contested titles
// ---------------------------------------------------------------------------

describe("titleContestKey — which titles are unique at all", () => {
  const v = (over: Partial<MinionState>): MinionState => makeMinion("v", "Alice", over);

  it("keys the three city titles on the CITY alone", () => {
    // "The title of prince is associated with a particular city and can be
    // contested by another vampire who claims ANY title to the same city"
    // (p. 39) — so a prince and a baron of one city DO contest.
    expect(titleContestKey(v({ title: "prince", titleCity: "Mannheim" }))).toBe("city:mannheim");
    expect(titleContestKey(v({ title: "baron", titleCity: "Mannheim" }))).toBe("city:mannheim");
    expect(titleContestKey(v({ title: "archbishop", titleCity: "Mannheim" }))).toBe("city:mannheim");
    expect(titleContestKey(v({ title: "prince", titleCity: "Melbourne" }))).toBe("city:melbourne");
  });

  it("keys justicar and Inner Circle on the CLAN", () => {
    // "Each clan's justicar and Inner Circle titles are unique … and can
    // only be held by vampires of that clan" (p. 41).
    expect(titleContestKey(v({ title: "justicar", clan: "Banu Haqim" }))).toBe(
      "justicar:banu haqim",
    );
    expect(titleContestKey(v({ title: "justicar", clan: "Ventrue" }))).toBe("justicar:ventrue");
    expect(titleContestKey(v({ title: "innerCircle", clan: "Ventrue" }))).toBe(
      "innerCircle:ventrue",
    );
  });

  it("answers null for every title that is NOT unique", () => {
    // "The title of primogen is not unique and cannot be contested"
    // (p. 41); "the other Sabbat titles are not unique" (p. 42). Without
    // this the pool's six primogen would contest each other on sight.
    for (const t of ["primogen", "bishop", "cardinal", "priscus"] as const) {
      expect(titleContestKey(v({ title: t }))).toBeNull();
    }
    expect(titleContestKey(v({ title: null }))).toBeNull();
    expect(titleContestKey(v({ title: "regent" }))).toBe("regent");
  });
});

describe("two vampires claiming one city", () => {
  /** The real pair in the V5 pool: Baron and Archbishop of Mannheim. */
  function mannheim(): GameState {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeMinion("bar", "Alice", { name: "Aline Gädeke", title: "baron", titleCity: "Mannheim" }),
    );
    state.seats[1]!.minions.push(
      makeMinion("arch", "Bob", {
        name: "Jürgen, The Libertine",
        title: "archbishop",
        titleCity: "Mannheim",
      }),
    );
    return state;
  }

  it("leaves both 'treated as if they have no title', still in play", () => {
    const state = mannheim();
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    const bar = state.seats[0]!.minions.find((m) => m.id === "bar")!;
    const arch = state.seats[1]!.minions.find((m) => m.id === "arch")!;
    expect(bar.title).toBeNull();
    expect(arch.title).toBeNull();
    // "…but they remain controlled and may act and block as normal."
    expect(state.seats[0]!.minions.map((m) => m.id)).toContain("bar");
    expect(bar.titleContest).toEqual({ title: "baron", city: "Mannheim" });
  });

  it("does NOT contest two different cities", () => {
    // The control. Twenty-four cities appear in the V5 crypt and only one
    // is claimed twice, so a key that ignored the city would contest
    // every prince in the game.
    const state = mannheim();
    state.seats[1]!.minions.find((m) => m.id === "arch")!.titleCity = "Melbourne";
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.minions.find((m) => m.id === "bar")!.title).toBe("baron");
    expect(state.seats[1]!.minions.find((m) => m.id === "arch")!.title).toBe("archbishop");
  });

  it("costs the VAMPIRE 1 blood each unlock phase, not the Methuselah", () => {
    const state = mannheim();
    unlockPhase(state, "Alice");
    const engine = new VtesEngine(state, testRegistry);
    const pool = state.seats[0]!.pool;
    answer(engine, ":pay");
    const bar = state.seats[0]!.minions.find((m) => m.id === "bar")!;
    expect(bar.blood).toBe(1); // started at 2
    expect(state.seats[0]!.pool).toBe(pool);
    expect(bar.titleContest).toBeDefined();
  });

  it("yielding loses the title FOR THE REST OF THE GAME", () => {
    const state = mannheim();
    unlockPhase(state, "Alice");
    const engine = new VtesEngine(state, testRegistry);
    answer(engine, ":yield");
    const bar = state.seats[0]!.minions.find((m) => m.id === "bar")!;
    expect(bar.title).toBeNull();
    expect(bar.titleContest).toBeUndefined();
    // The city goes too, or the next sweep would re-enter them into the
    // contest they just conceded.
    expect(bar.titleCity).toBeUndefined();
    expect(titleContestKey(bar)).toBeNull();
  });

  it("gives the title to the last claimant at their next unlock phase", () => {
    const state = mannheim();
    unlockPhase(state, "Alice");
    const a = new VtesEngine(state, testRegistry);
    answer(a, ":yield");
    // Bob's archbishop is still title-less until his own unlock phase.
    expect(state.seats[1]!.minions.find((m) => m.id === "arch")!.title).toBeNull();

    unlockPhase(state, "Bob");
    const b = new VtesEngine(state, testRegistry);
    b.decision();
    expect(state.seats[1]!.minions.find((m) => m.id === "arch")!.title).toBe("archbishop");
    expect(state.seats[1]!.minions.find((m) => m.id === "arch")!.titleContest).toBeUndefined();
  });
});

describe("a vampire who cannot contest a title", () => {
  function pair(over: Partial<MinionState>): GameState {
    const state = threeSeatGame();
    state.seats[0]!.minions.push(
      makeMinion("bar", "Alice", {
        name: "Aline Gädeke",
        title: "baron",
        titleCity: "Mannheim",
        ...over,
      }),
    );
    state.seats[1]!.minions.push(
      makeMinion("arch", "Bob", {
        name: "Jürgen, The Libertine",
        title: "archbishop",
        titleCity: "Mannheim",
      }),
    );
    unlockPhase(state, "Alice");
    return state;
  }

  it("yields automatically from TORPOR, with no question asked", () => {
    // "Only ready vampires can contest titles. Vampires in torpor must
    // yield during the unlock phase."
    const state = pair({ inTorpor: true });
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    const bar = state.seats[0]!.minions.find((m) => m.id === "bar")!;
    expect(bar.titleContest).toBeUndefined();
    expect(state.eventLog.some((e) => e.type === "TitleYielded" && e.minion === "bar")).toBe(true);
    expect(optionIds(engine).some((i) => i.includes(":yield"))).toBe(false);
  });

  it("yields automatically with NO BLOOD to pay", () => {
    // "…or may be forced to yield, if they have no blood to pay."
    const state = pair({ blood: 0 });
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.minions.find((m) => m.id === "bar")!.titleContest).toBeUndefined();
    expect(state.eventLog.some((e) => e.type === "TitleYielded" && e.minion === "bar")).toBe(true);
  });

  it("IS asked when it is ready with blood — the control", () => {
    // Without this, both tests above would pass on an engine that never
    // asked anybody anything.
    const state = pair({});
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((i) => i.includes(":yield"))).toBe(true);
    expect(state.eventLog.some((e) => e.type === "TitleYielded")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The city comes off the card, like clan, sect and path before it
// ---------------------------------------------------------------------------

describe("reading the title city off a real crypt card", () => {
  /** Every V5 crypt card's parsed title claim. */
  function claims(): { name: string; title: string | null; city?: string }[] {
    const out: { name: string; title: string | null; city?: string }[] = [];
    for (const entry of Object.values((registry as unknown as CardRegistry).entries)) {
      if (entry.card.kind !== "crypt") continue;
      const v = importCryptCard(entry.card.id);
      out.push({
        name: v.name,
        title: v.title,
        ...(v.titleCity === undefined ? {} : { city: v.titleCity }),
      });
    }
    return out;
  }

  it("parses a title line ending in ':' — 'Camarilla Prince of Melbourne:'", () => {
    const alexa = claims().find((c) => c.name.startsWith("Alexa Draper"))!;
    expect(alexa.title).toBe("prince");
    expect(alexa.city).toBe("Melbourne");
  });

  it("parses one ending in '.' too — 'Camarilla Prince of Pittsburgh.'", () => {
    // The two spellings are the difference between a vampire with ability
    // text and one without, and an earlier survey of mine read only the
    // first — which is how it reported half the city titles in the pool.
    const donny = claims().find((c) => c.name.startsWith("Donny Kowalczyk"))!;
    expect(donny.title).toBe("prince");
    expect(donny.city).toBe("Pittsburgh");
  });

  it("finds cities two vampires both claim — the shape p. 39 describes", () => {
    // The pair this named (Mannheim, Pittsburgh) was the whole of it while
    // the pool was V5-only; widening the crypt added more, so the LIST was
    // a hostage to the pool's size (docs/pool-widening-design.md §3).
    // The claim worth keeping is the one p. 39 makes: a city title is
    // "contested by another vampire who claims ANY title to the same
    // city", so the pool must actually contain such pairs for the
    // contest rules to have anything to bite on.
    const byCity = new Map<string, string[]>();
    for (const c of claims()) {
      if (c.city === undefined) continue;
      byCity.set(c.city, [...(byCity.get(c.city) ?? []), c.title ?? "?"]);
    }
    const shared = [...byCity.entries()].filter(([, v]) => v.length > 1).sort();
    expect(shared.length).toBeGreaterThan(0);
    // Mannheim and Pittsburgh are the two the V5 sets ship, and they must
    // survive any widening — they are the fixtures the contest tests use.
    expect(shared.map(([city]) => city)).toEqual(expect.arrayContaining(["Mannheim", "Pittsburgh"]));
    // NOT "shared by different titles". The widened pool has two Princes
    // of Chicago, and that is the PRIMARY contest, not an anomaly: p. 39
    // says a city title is contested by any vampire claiming any title to
    // the same city, and the same title obviously qualifies.
  });

  it("gives NO city to a title that has none — the control", () => {
    // "Camarilla primogen" has no "of <city>", and primogen is not unique
    // anyway. A parser that invented a city would make the pool's six
    // primogen contest each other on sight.
    const withCity = new Set(claims().filter((c) => c.city !== undefined).map((c) => c.title));
    expect([...withCity].sort()).toEqual(["archbishop", "baron", "prince"]);
    const dowager = claims().find((c) => c.name.startsWith("The Dowager"))!;
    expect(dowager.title).toBe("primogen");
    expect(dowager.city).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// End to end, on real decks
// ---------------------------------------------------------------------------

describe("a mirror match on a real precon", () => {
  it("contests a vampire once both sides influence one out", () => {
    // The integration case, and the reason the mechanism is worth having:
    // two players choosing the same deck is an ordinary thing to do, and
    // 14 of the 496 precon pairs share a crypt card even when the decks
    // differ. Everything above this point is fixtures; this is the pool.
    const a = preconDeck("Fifth Edition", "Malkavian", "Alice")!;
    const b = preconDeck("Fifth Edition", "Malkavian", "Bob")!;
    const c = preconDeck("Fifth Edition", "Nosferatu", "Carol")!;
    expect(a).not.toBeNull();

    const state = buildGame({ decks: [a, b, c], seed: 5, maxTurns: 200 });
    const engine = new VtesEngine(state, buildHandlerRegistry());

    // Force the collision rather than playing to it: both seats influence
    // out the same vampire. The deal shuffles, so the shared card is found
    // across the whole crypt rather than in the four dealt face down.
    const aCrypt = [...state.seats[0]!.uncontrolled.map((u) => u.card), ...state.seats[0]!.crypt];
    const bCrypt = [...state.seats[1]!.uncontrolled.map((u) => u.card), ...state.seats[1]!.crypt];
    const shared = aCrypt.find((v) => bCrypt.some((w) => w.name === v.name));
    expect(shared, "both Malkavian decks hold the same crypt cards").toBeDefined();
    const twin = bCrypt.find((w) => w.name === shared!.name)!;

    state.seats[0]!.minions.push({ ...shared!, controller: "Alice", blood: 1 });
    state.seats[1]!.minions.push({ ...twin, controller: "Bob", blood: 1 });
    engine.decision();

    expect(state.seats[0]!.contested?.map((c) => c.card.name)).toEqual([shared!.name]);
    expect(state.seats[1]!.contested?.map((c) => c.card.name)).toEqual([shared!.name]);
    expect(state.seats[0]!.minions.some((m) => m.name === shared!.name)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contested TITLE CARDS (as against a vampire's printed title)
// ---------------------------------------------------------------------------

describe("a contested title CARD takes the title with it", () => {
  /** Both Methuselahs hold Prince of Chicago, granted by the card. */
  function twoPrinces(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const title = (id: string) => ({
      ...loc(id, "Praxis Seizure: Chicago"),
      tags: ["Prince of Chicago", "title"],
    });
    const v1 = state.seats[0]!.minions[0]!;
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    v1.title = "prince";
    v1.attached.push(title("a1"));
    m.title = "prince";
    m.attached.push(title("b1"));
    unlockPhase(state, "Bob");
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("both bearers lose the title while the cards are out of play", () => {
    // "Turned face down and OUT OF PLAY" (p. 17). `burnPermanent` has
    // always dropped the title of a burned title card; the contested path
    // did not, so a bearer kept a title granted by a card that was no
    // longer there. Praxis Seizure found it; Regent has the same shape.
    const { state, engine } = twoPrinces();
    engine.decision();
    expect(state.seats[0]!.minions[0]!.title).toBeNull();
    expect(state.seats[1]!.minions.find((x) => x.id === "M")!.title).toBeNull();
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["a1"]);
  });

  it("and the winner gets it back when the contest ends", () => {
    // The other half: a contest can be won turns later, so the title has
    // to be restorable rather than merely dropped.
    const { state, engine } = twoPrinces();
    engine.decision();
    answer(engine, ":yield");

    unlockPhase(state, "Alice");
    const alice = new VtesEngine(state, testRegistry);
    alice.decision();
    const v1 = state.seats[0]!.minions[0]!;
    expect(v1.attached.map((p) => p.card.id)).toContain("a1");
    expect(v1.title).toBe("prince");
  });

  it("NEGATIVE SPACE: a non-title card in the same contest touches no title", () => {
    // The control. If the contest simply cleared every bearer's title,
    // the two tests above would pass for the wrong reason.
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.title = "prince";
    v1.attached.push(loc("a1", "Elder Library"));
    state.seats[1]!.permanents.push(loc("b1", "Elder Library"));
    unlockPhase(state, "Bob");
    const engine = new VtesEngine(state, testRegistry);
    engine.decision();
    expect(state.seats[0]!.contested?.map((c) => c.card.id)).toEqual(["a1"]);
    expect(v1.title).toBe("prince");
  });
});
