import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState, type PermanentInPlay } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const perm = (id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay => ({
  card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [name], ...over,
});
const activate = (n: number) => `ability:Heart of Nizchetus:heart:drawbury:${n}`;
const bury = (id: string) => `choice:Heart of Nizchetus:heart:bury:${id}`;
const tarot = (id: string) => `choice:Shilmulo Tarot:tarot:drawFrom:${id}`;
const cache = (id: string) => `choice:Black Market Cache:cache:drawFrom:${id}`;
function setup(library: number, withTarot = true) {
  const state = threeSeatGame();
  const alice = state.seats[0]!;
  alice.hand = [{ id: "h1", name: "Old card" }];
  alice.library = Array.from({ length: library }, (_, i) => ({ id: `l${i}`, name: `Library ${i}` }));
  const ravnos = makeMinion("ravnos", "Alice", { clan: "Ravnos" });
  const heart = perm("heart", "Heart of Nizchetus");
  const store = perm("tarot", "Shilmulo Tarot", { stored: [{ id: "s1", name: "Stored 1" }, { id: "s2", name: "Stored 2" }], storedFaceUp: false });
  ravnos.attached.push(heart);
  if (withTarot) ravnos.attached.push(store);
  alice.minions.push(ravnos);
  const turn = state.frames[0]!;
  if (turn.kind !== "turn") throw new Error("no turn");
  Object.assign(turn, { phase: "unlock", unlockDone: false, unlockAbilitiesDone: false });
  return { state, alice, ravnos, heart, store, engine: new VtesEngine(state, testRegistry) };
}
const ids = (engine: VtesEngine) => engine.decision()?.options.map((o) => o.id) ?? [];

describe("Heart of Nizchetus counted draws and redirects", () => {
  it("resolves all draws before asking for the same number to bury, including newly drawn cards", () => {
    const { state, alice, engine } = setup(4);
    engine.choose(activate(3));
    expect(ids(engine)).toContain(tarot("s1"));
    expect(ids(engine)).not.toContain(bury("h1"));
    engine.choose(tarot("s1"));
    expect(alice.hand.map((c) => c.id)).toEqual(["h1", "s1"]);
    expect(ids(engine)).toContain(tarot("library"));
    engine.choose(tarot("library"));
    expect(ids(engine)).toContain(tarot("s2"));
    engine.choose(tarot("s2"));
    expect(alice.hand.map((c) => c.id)).toEqual(["h1", "s1", "l0", "s2"]);
    expect(ids(engine)).toEqual(expect.arrayContaining([bury("h1"), bury("s1"), bury("l0"), bury("s2")]));
    engine.choose(bury("s2"));
    engine.choose(bury("l0"));
    engine.choose(bury("h1"));
    expect(alice.hand.map((c) => c.id)).toEqual(["s1"]);
    expect(alice.library.map((c) => c.id)).toEqual(["l1", "l2", "l3", "s2", "l0", "h1"]);
    expect(state.eventLog.filter((e) => ["CardDrawn", "StoredCardDrawn", "CardBuried"].includes(e.type)).map((e) => e.type)).toEqual([
      "StoredCardDrawn", "CardDrawn", "StoredCardDrawn", "CardBuried", "CardBuried", "CardBuried",
    ]);
    expect(ids(engine)).not.toContain(activate(1));
  });

  it("offers draws supplied only by a live store when the library is empty", () => {
    const { alice, engine } = setup(0);
    expect(ids(engine)).toEqual(expect.arrayContaining([activate(1), activate(2)]));
    expect(ids(engine)).not.toContain(activate(3));
    engine.choose(activate(2));
    engine.choose(tarot("s2"));
    engine.choose(tarot("s1"));
    expect(ids(engine)).toEqual(expect.arrayContaining([bury("h1"), bury("s1"), bury("s2")]));
    engine.choose(bury("s2"));
    engine.choose(bury("h1"));
    expect(alice.hand.map((c) => c.id)).toEqual(["s1"]);
    expect(alice.library.map((c) => c.id)).toEqual(["s2", "h1"]);
  });

  it("buries only the number actually drawn if the library is empty and its draw is chosen", () => {
    const { alice, engine } = setup(0);
    engine.choose(activate(2));
    engine.choose(tarot("s1"));
    engine.choose(tarot("library"));
    expect(ids(engine)).toContain(bury("s1"));
    engine.choose(bury("s1"));
    expect(alice.hand.map((c) => c.id)).toEqual(["h1"]);
    expect(alice.library.map((c) => c.id)).toEqual(["s1"]);
    expect(alice.hand).toHaveLength(1);
    expect(engine.state.frames.some((f) => f.kind === "choice")).toBe(false);
  });

  it("asks for no bury when no card was actually drawn", () => {
    const { alice, engine } = setup(0);
    engine.choose(activate(1));
    engine.choose(tarot("library"));
    expect(alice.hand.map((c) => c.id)).toEqual(["h1"]);
    expect(alice.library).toEqual([]);
    expect(engine.state.frames.some((f) => f.kind === "choice")).toBe(false);
    expect(ids(engine)).not.toContain(activate(1));
  });

  it("restores remaining draws and accumulated count through save/load", () => {
    const { state, engine } = setup(2);
    engine.choose(activate(3));
    engine.choose(tarot("s1"));
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose(tarot("library"));
    resumed.choose(tarot("s2"));
    expect(ids(resumed)).toContain(bury("s1"));
    resumed.choose(bury("h1"));
    resumed.choose(bury("s1"));
    resumed.choose(bury("s2"));
    expect(saved.seats[0]!.hand.map((c) => c.id)).toEqual(["l0"]);
    expect(saved.seats[0]!.library.map((c) => c.id)).toEqual(["l1", "h1", "s1", "s2"]);
  });

  it("can choose between two sources for successive draws, including a store that burns", () => {
    const { alice, engine } = setup(1);
    alice.permanents.push(perm("cache", "Black Market Cache", { controller: "Alice", stored: [{ id: "c1", name: "Cache" }], storedFaceUp: true }));
    engine.choose(activate(3));
    expect(ids(engine)).toEqual(expect.arrayContaining([cache("c1"), tarot("s1"), tarot("s2")]));
    engine.choose(cache("c1"));
    expect(alice.permanents.some((p) => p.card.id === "cache")).toBe(false);
    engine.choose(tarot("s2"));
    engine.choose(tarot("s1"));
    expect(ids(engine)).toEqual(expect.arrayContaining([bury("c1"), bury("s2"), bury("s1")]));
  });

  it("does not count inaccessible stores or offer the ability for a torpor bearer", () => {
    const x = setup(0);
    x.ravnos.inTorpor = true;
    expect(ids(x.engine)).not.toContain(activate(1));
    const y = setup(0);
    y.store.controller = "Bob";
    expect(ids(y.engine)).not.toContain(activate(1));
    const z = setup(1, false);
    expect(ids(z.engine)).toContain(activate(1));
    expect(ids(z.engine)).not.toContain(activate(2));
  });

  // Bury sends a card to its OWNER's library, not the controller's (Heart of Nizchetus).
  // RTR 19970425, LSJ 20060921: a card taken from an opponent's library goes to its owner's library.
  it("buries a card to its owner's library, not the controller's", () => {
    const { state, engine } = setup(2);
    const bob = state.seats[1]!;
    // Bob's card in Alice's hand (as if passed between players)
    const bobCard = { id: "bobCard", name: "Bob's Card", owner: "Bob" } as any;
    state.seats[0]!.hand.push(bobCard);
    // Alice's Heart: draw 1, bury 1 (draw from library, no Tarot interference)
    engine.choose(activate(1));
    engine.choose(tarot("library"));
    // Alice's hand: h1 (old card), bobCard (Bob's card), l0 (drawn)
    expect(state.seats[0]!.hand.map((c) => c.id)).toEqual(["h1", "bobCard", "l0"]);
    // Bury Bob's card — it must go to Bob's library, not Alice's
    const dp = engine.decision();
    expect(dp).toBeDefined();
    const buryBob = dp!.options.find((o) => o.id.includes(":bury:bobCard"))!;
    engine.choose(buryBob.id);
    // Alice's hand lost bobCard
    expect(state.seats[0]!.hand.map((c) => c.id)).not.toContain("bobCard");
    // Bob's card is in Bob's library (bottom = end of array)
    expect(bob.library.map((c) => c.id)).toContain("bobCard");
    // Alice's library should NOT contain Bob's card
    expect(state.seats[0]!.library.map((c) => c.id)).not.toContain("bobCard");
    // bobCard was buried
    expect(state.eventLog.filter((e) => e.type === "CardBuried").map((e) => e.cardId)).toContain("bobCard");
  });
});
