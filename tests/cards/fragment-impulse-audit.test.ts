import { describe, expect, it } from "vitest";
import { VtesEngine, type GameState, type PermanentInPlay } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const fragment = (id = "nod"): PermanentInPlay => ({ card: { id, name: "Fragment of the Book of Nod" }, locked: false, usedThisPhase: false, statics: {}, tags: [] });
const ids = (e: VtesEngine) => e.decision()!.options.map(o => o.id);
const activate = "ability:Fragment of the Book of Nod:nod:draw";

describe("Fragment of the Book of Nod impulse and draw ordering", () => {
  it("is available to its controller during another player's action", () => {
    const state = threeSeatGame();
    const bob = state.seats[1]!;
    bob.permanents.push(fragment());
    bob.library = [{ id: "l1", name: "A" }, { id: "l2", name: "B" }];
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1"); engine.choose("pass");
    expect(engine.decision()!.seat).toBe("Bob");
    expect(ids(engine)).toContain(activate);
    engine.choose(activate);
    expect(bob.hand.map(c => c.id)).toEqual(expect.arrayContaining(["l1", "l2"]));
    expect(bob.permanents[0]!.locked).toBe(true);
  });

  it("does not offer its ability to respond as another card is played", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(fragment());
    state.seats[0]!.hand.push({ id: "c", name: "Conditioning" });
    state.seats[0]!.minions[0]!.disciplines.dom = "superior";
    const e = new VtesEngine(state, testRegistry);
    e.choose("bleed:V1");
    for (let i = 0; i < 12 && !ids(e).some(x => x.startsWith("play:Conditioning")); i++) e.choose("pass");
    e.choose(ids(e).find(x => x.startsWith("play:Conditioning"))!);
    expect(e.decision()!.window).toBe("card.asPlayed");
    expect(ids(e)).not.toContain(activate);
  });

  it("finishes redirected draws before discard down, including after save/load", () => {
    const state = threeSeatGame();
    const alice = state.seats[0]!;
    alice.hand = Array.from({ length: 7 }, (_, i) => ({ id: `h${i}`, name: "Conditioning" }));
    alice.library = [{ id: "l1", name: "Library 1" }];
    alice.permanents.push(fragment());
    const ravnos = makeMinion("ravnos", "Alice", { clan: "Ravnos" });
    ravnos.attached.push({ card: { id: "tarot", name: "Shilmulo Tarot" }, locked: false,
      usedThisPhase: false, statics: {}, tags: [], stored: [{ id: "s1", name: "Stored 1" }, { id: "s2", name: "Stored 2" }], storedFaceUp: false });
    alice.minions.push(ravnos);
    const e = new VtesEngine(state, testRegistry);
    e.choose(activate);
    expect(ids(e)).toContain("choice:Shilmulo Tarot:tarot:drawFrom:s1");
    e.choose("choice:Shilmulo Tarot:tarot:drawFrom:s1");
    expect(ids(e)).toContain("choice:Shilmulo Tarot:tarot:drawFrom:s2");
    expect(ids(e).some(x => x.includes(":discardDown:"))).toBe(false);
    const saved = JSON.parse(JSON.stringify(state)) as GameState;
    const restored = new VtesEngine(saved, testRegistry);
    restored.choose("choice:Shilmulo Tarot:tarot:drawFrom:s2");
    expect(saved.seats[0]!.hand).toHaveLength(9);
    expect(ids(restored)).toContain("choice:Fragment of the Book of Nod:nod:discardDown:s2");
    restored.choose("choice:Fragment of the Book of Nod:nod:discardDown:s2");
    restored.choose("choice:Fragment of the Book of Nod:nod:discardDown:h0");
    expect(saved.seats[0]!.hand).toHaveLength(7);
  });
});
