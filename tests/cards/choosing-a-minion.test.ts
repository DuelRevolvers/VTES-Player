/**
 * Choosing a minion (docs/choosing-a-minion-design.md).
 *
 * Precognizant Mobility (101476), Distraction (100560), Horseshoes (100937).
 *
 * Three directed actions that each pick a minion at announcement. The payoffs
 * differ — unlock, lock, damage — but so do the FILTERS, and the filter is what
 * these tests are mostly about: the target list is the card's whole rules text.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/**
 * A table with a spread of ages and kinds, because every card here filters on
 * one of them:
 *   Alice  V1 (capacity 6, the actor) + AL (her own ally, locked)
 *   Bob    M  (capacity 4, LOCKED — younger than V1) + BE (capacity 8, locked)
 *   Carol  CY (capacity 3, locked)
 * Alice's prey is Bob and her predator is Carol, so every seat is "near".
 */
function table(card: string, disciplines: Record<string, "basic" | "superior">) {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 5, capacity: 6, disciplines });
  const al = makeMinion("AL", "Alice", { kind: "ally", blood: 2, capacity: 2, locked: true });
  state.seats[0]!.minions.push(al);
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  Object.assign(m, { blood: 4, capacity: 4, locked: true });
  const be = makeMinion("BE", "Bob", { blood: 8, capacity: 8, locked: true });
  state.seats[1]!.minions.push(be);
  const cy = makeMinion("CY", "Carol", { blood: 3, capacity: 3, locked: true });
  state.seats[2]!.minions.push(cy);
  state.seats[0]!.library = Array.from({ length: 20 }, (_, i) => ({
    id: `lib${i}`,
    name: "Conditioning",
  }));
  state.seats[0]!.hand.push({ id: "cm1", name: card });
  return { state, engine: new VtesEngine(state, testRegistry), v1, al, m, be, cy };
}

/** Every option on the table for Alice in the minion phase. */
function options(engine: VtesEngine): string[] {
  const dp = engine.decision();
  if (!dp) throw new Error("no decision");
  return dp.options.map((o) => o.id);
}

/** The minion ids a mode offers as targets, read off the option ids. */
function targetsOf(engine: VtesEngine, card: string, mode: string): string[] {
  const prefix = `play:${card}:${mode}:V1:`;
  return options(engine)
    .filter((o) => o.startsWith(prefix))
    .map((o) => o.slice(prefix.length).split(":")[0]!)
    .sort();
}

/** Announce and run the action to resolution unopposed. */
function resolve(engine: VtesEngine, state: GameState, id: string): void {
  engine.choose(id);
  for (let i = 0; i < 30; i++) {
    const dp = engine.decision();
    if (!dp || dp.window === "turn.minion") return;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand");
    if (!pick) return;
    engine.choose(pick.id);
  }
  void state;
}

/** Announce `id` and stop as soon as the action frame exists. */
function announce(engine: VtesEngine, state: GameState, id: string) {
  engine.choose(id);
  for (let i = 0; i < 10; i++) {
    const af = state.frames.find((f) => f.kind === "action");
    if (af?.kind === "action") return af;
    const dp = engine.decision();
    const pick = dp?.options.find((o) => o.id === "pass");
    if (!pick) break;
    engine.choose(pick.id);
  }
  throw new Error("no action frame");
}

// ---------------------------------------------------------------------------

describe("the Ⓓ belongs to the CARD, not to the target's controller", () => {
  // This is the wave's find (§5). All three cards name a minion at
  // announcement, but only two print Ⓓ — and naming another Methuselah's
  // minion is not by itself what directs an action (p. 25).
  it("Precognizant Mobility is UNDIRECTED even when it unlocks Bob's vampire", () => {
    const a = table("Precognizant Mobility", { aus: "superior" });
    const id = options(a.engine).find((o) =>
      o.startsWith("play:Precognizant Mobility:superior:V1:BE"),
    );
    const af = announce(a.engine, a.state, id!);
    expect(af.targetMinion).toBe("BE"); // the target reached the frame at all
    expect(af.directed).toBe(false);
    expect(af.target).toBeNull();
  });

  it("CONTROL: Horseshoes names the same minion and IS directed", () => {
    const a = table("Horseshoes", { pot: "superior" });
    const id = options(a.engine).find((o) =>
      o.startsWith("play:Horseshoes:superior:V1:BE"),
    );
    const af = announce(a.engine, a.state, id!);
    expect(af.targetMinion).toBe("BE");
    expect(af.directed).toBe(true);
    expect(af.target).toBe("Bob");
  });

  it("neither enters combat with the minion it names", () => {
    const a = table("Horseshoes", { pot: "superior" });
    const id = options(a.engine).find((o) =>
      o.startsWith("play:Horseshoes:superior:V1:BE"),
    );
    resolve(a.engine, a.state, id!);
    expect(a.state.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
  });
});

describe("Precognizant Mobility (101476) — unlock, filtered by AGE and KIND", () => {
  it("basic offers a younger vampire or an ALLY, and not an elder", () => {
    const a = table("Precognizant Mobility", { aus: "superior" });
    const t = targetsOf(a.engine, "Precognizant Mobility", "basic");
    // M is capacity 4 (younger than V1's 6); AL is an ally; CY is 3.
    expect(t).toContain("M");
    expect(t).toContain("AL");
    expect(t).toContain("CY");
    // BE is capacity 8 — older, and not an ally.
    expect(t).not.toContain("BE");
  });

  it("superior offers any VAMPIRE, elders included, and no ally", () => {
    const a = table("Precognizant Mobility", { aus: "superior" });
    const t = targetsOf(a.engine, "Precognizant Mobility", "superior");
    expect(t).toContain("BE"); // the elder the basic refused
    expect(t).toContain("M");
    // "Unlock a VAMPIRE" — the ally the basic allowed is gone.
    expect(t).not.toContain("AL");
  });

  it("actually unlocks the chosen minion", () => {
    const a = table("Precognizant Mobility", { aus: "superior" });
    const id = options(a.engine).find((o) =>
      o.startsWith("play:Precognizant Mobility:superior:V1:BE"),
    );
    expect(id, "BE not offered").toBeDefined();
    expect(a.be.locked).toBe(true);
    resolve(a.engine, a.state, id!);
    expect(a.be.locked).toBe(false);
    // And nobody else was touched.
    expect(a.m.locked).toBe(true);
  });

  it("NEGATIVE SPACE: an already-unlocked minion is not a target", () => {
    // Nothing to unlock is a futile option.
    const a = table("Precognizant Mobility", { aus: "superior" });
    a.m.locked = false;
    expect(targetsOf(a.engine, "Precognizant Mobility", "superior")).not.toContain("M");
  });
});

describe("Distraction (100560) — the mirror: LOCK, filtered by RELATION", () => {
  it("superior offers only predator's and prey's UNLOCKED minions", () => {
    const a = table("Distraction", { cel: "superior" });
    // Everyone starts locked except V1, so unlock one on each seat.
    a.m.locked = false;
    a.cy.locked = false;
    a.al.locked = false;
    const t = targetsOf(a.engine, "Distraction", "superior");
    expect(t).toContain("M"); // prey
    expect(t).toContain("CY"); // predator
    // Alice's own ally is neither, however unlocked it is.
    expect(t).not.toContain("AL");
    // And BE is still locked, so there is nothing to lock.
    expect(t).not.toContain("BE");
  });

  it("actually locks the chosen minion", () => {
    const a = table("Distraction", { cel: "superior" });
    a.m.locked = false;
    const id = options(a.engine).find((o) => o.startsWith("play:Distraction:superior:V1:M"));
    expect(id, "M not offered").toBeDefined();
    resolve(a.engine, a.state, id!);
    expect(a.m.locked).toBe(true);
  });

  it("its BASIC has no target and draws five", () => {
    const a = table("Distraction", { cel: "superior" });
    const libBefore = a.state.seats[0]!.library.length;
    const id = options(a.engine).find((o) => o.startsWith("play:Distraction:basic"));
    expect(id, "basic not offered").toBeDefined();
    resolve(a.engine, a.state, id!);
    // Five for the card plus one replacement for the card itself (p. 7).
    expect(libBefore - a.state.seats[0]!.library.length).toBe(6);
  });
});

describe("Horseshoes (100937) — damage, filtered only by READY", () => {
  it("offers every ready minion on the table, including your own", () => {
    const a = table("Horseshoes", { pot: "superior" });
    // Unlock nothing: "ready" is not "unlocked", so a locked minion still
    // qualifies — which is the distinction this card turns on.
    const t = targetsOf(a.engine, "Horseshoes", "basic");
    for (const id of ["AL", "M", "BE", "CY"]) expect(t, `${id} missing`).toContain(id);
  });

  it("inflicts 1 at basic and 2 at superior, unpreventably", () => {
    for (const [mode, dmg] of [
      ["basic", 1],
      ["superior", 2],
    ] as const) {
      const a = table("Horseshoes", { pot: "superior" });
      const before = a.be.blood;
      const id = options(a.engine).find((o) =>
        o.startsWith(`play:Horseshoes:${mode}:V1:BE`),
      );
      expect(id, `${mode}: BE not offered`).toBeDefined();
      resolve(a.engine, a.state, id!);
      // Normal damage on a ready vampire is mended with blood.
      expect(before - a.be.blood, `${mode} damage`).toBe(dmg);
    }
  });

  it("NEGATIVE SPACE: a minion in TORPOR is not ready", () => {
    const a = table("Horseshoes", { pot: "superior" });
    a.be.inTorpor = true;
    expect(targetsOf(a.engine, "Horseshoes", "basic")).not.toContain("BE");
  });
});
