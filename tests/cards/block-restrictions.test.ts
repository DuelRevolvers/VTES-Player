/**
 * Block restrictions gate (docs/block-restrictions-design.md): action
 * modifiers that remove blockers — "allies cannot block" (Visions of
 * Gehenna) and "the chosen vampire cannot block" (Seduction). We assert
 * the negative space: the restricted minion is NOT offered a block, while
 * an unrestricted one still is.
 */

import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Options offered at the current decision, or throw if none pending. */
function currentOptionIds(engine: VtesEngine): string[] {
  const dp = engine.decision();
  if (!dp) throw new Error("no decision pending");
  return dp.options.map((o) => o.id);
}

describe("Visions of Gehenna (102264) — allies cannot block", () => {
  it("removes the ally's block option but not the vampire's", () => {
    const state = threeSeatGame();
    // Alice's V1 gets Presence to play the card.
    state.seats[0]!.minions[0]!.disciplines = { pre: "basic" };
    state.seats[0]!.minions[0]!.blood = 3;
    // Bob fields a vampire (M) and an ally (A1), both able to block.
    state.seats[1]!.minions.push(makeAlly("A1", "Bob", 3));
    // Give Alice a copy of the card in hand.
    state.seats[0]!.hand.push({ id: "vg1", name: "Visions of Gehenna" });
    const engine = new VtesEngine(state, testRegistry);

    // Alice's V1 bleeds; in the acting-seat modifier window she plays the
    // card, then we inspect the block-eligibility offered to Bob.
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as-played window
      ["Alice", "play:Visions of Gehenna:basic:V1"], // allies cannot block
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // its as-played window
      ["Alice", "pass"], // acting seat done playing modifiers
    ]);

    const ids = currentOptionIds(engine);
    expect(ids).toContain("block:M");
    expect(ids).not.toContain("block:A1");
  });
});

describe("Seduction (101712) — chosen vampire cannot block", () => {
  it("basic: only a younger vampire can be chosen, and it cannot block", () => {
    const state = threeSeatGame();
    // V1 has dom (from the fixture); make Bob's M younger than V1 (cap 5).
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.capacity = 3;
    state.seats[0]!.minions[0]!.blood = 3;
    state.seats[0]!.hand.push({ id: "sd1", name: "Seduction" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "play:Seduction:basic:V1:M"], // choose M (younger)
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);

    const ids = currentOptionIds(engine);
    expect(ids).toContain("block:W"); // W (cap 5) unaffected
    expect(ids).not.toContain("block:M"); // M chosen → cannot block
  });

  it("basic offers only younger vampires as targets", () => {
    const state = threeSeatGame();
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.capacity = 3; // younger than V1 (5)
    state.seats[0]!.minions[0]!.blood = 3;
    state.seats[0]!.hand.push({ id: "sd1", name: "Seduction" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const ids = currentOptionIds(engine).filter((i) => i.startsWith("play:Seduction:basic"));
    // Only M (cap 3) qualifies; W and N (cap 5) do not.
    expect(ids.some((i) => i.includes(":M:") || i.endsWith(":M:sd1"))).toBe(true);
    expect(ids.some((i) => i.includes(":W:"))).toBe(false);
    expect(ids.some((i) => i.includes(":N:"))).toBe(false);
  });
});
