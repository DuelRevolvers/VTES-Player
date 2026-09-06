/**
 * Modifiers played by a ready vampire OTHER than the acting minion —
 * docs/other-vampire-modifiers-design.md. The p. 12 exception to "only the
 * acting minion can play action modifiers", and the structural gate the
 * compiler could not express until now.
 *
 * Cloak the Gathering (100362), Veil the Legions (102097), Hedonism
 * (102328). Gifts From Hereafter (102325) is deferred — see the doc §7.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice gets a second vampire, V2 — the one who plays these cards. */
function game(card: string, disc: Record<string, "basic" | "superior">): GameState {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, { blood: 4 });
  state.seats[0]!.minions.push(makeMinion("V2", "Alice", { disciplines: disc, blood: 4 }));
  state.seats[0]!.hand.push({ id: "x", name: card });
  return state;
}

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/**
 * Bleed with V1 and let Bob attempt a block with M, stopping on Alice's
 * impulse inside the attempt.
 *
 * The block attempt is not decoration. Stealth may only be added WHEN
 * NEEDED (p. 26), so a stealth modifier is not on the table during an
 * unopposed action — every card here is only offered once somebody is
 * actually trying to block.
 */
function upToEffects(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
  ]);
}

describe("Cloak the Gathering (100362) — the gate itself", () => {
  it("offers the superior mode from the OTHER vampire and not the actor", () => {
    const state = game("Cloak the Gathering", { obf: "superior" });
    // The acting minion has Obfuscate too, so if the gate were missing it
    // would be offered the superior mode as well. It must not be.
    Object.assign(find(state, "V1"), { disciplines: { obf: "superior" } });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);

    const ids = engine.decision()!.options.map((o) => o.id);
    // Inferior: the acting minion only.
    expect(ids).toContain("play:Cloak the Gathering:basic:V1:x");
    expect(ids.some((i) => i.startsWith("play:Cloak the Gathering:basic:V2"))).toBe(false);
    // Superior: the OTHER vampire only.
    expect(ids).toContain("play:Cloak the Gathering:superior:V2:x");
    expect(ids.some((i) => i.startsWith("play:Cloak the Gathering:superior:V1"))).toBe(
      false,
    );
  });

  it("gives the ACTING minion the stealth, though someone else played it", () => {
    const state = game("Cloak the Gathering", { obf: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [
      ["Alice", "play:Cloak the Gathering:superior:V2:x"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const ev = state.eventLog.filter((e) => e.type === "StealthModified");
    expect(ev.length).toBe(1);
    expect(ev[0]!.type === "StealthModified" && ev[0]!.delta).toBe(1);
  });

  it("accepts a LOCKED other vampire — the card says ready, not unlocked", () => {
    const state = game("Cloak the Gathering", { obf: "superior" });
    find(state, "V2").locked = true;
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Cloak the Gathering:superior:V2")),
    ).toBe(true);
  });

  it("does not reach across Methuselahs — it is still the actor's card", () => {
    // p. 12: "only minions controlled by the same Methuselah can play
    // those cards". Bob holds a copy and has an Obfuscate vampire.
    const state = game("Cloak the Gathering", { obf: "superior" });
    state.seats[1]!.hand.push({ id: "y", name: "Cloak the Gathering" });
    Object.assign(find(state, "W"), { disciplines: { obf: "superior" } });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [["Alice", "pass"]]);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Cloak the Gathering")),
    ).toBe(false);
  });
});

describe("Veil the Legions (102097)", () => {
  it("banks stealth for the seat's later actions this turn", () => {
    const state = game("Veil the Legions", { obf: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);

    // X is chosen at play time: one option per affordable X, 0 included.
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids).toContain("play:Veil the Legions:superior:V2:0:x");
    expect(ids).toContain("play:Veil the Legions:superior:V2:2:x");

    const bloodBefore = find(state, "V2").blood;
    runTrace(engine, [
      ["Alice", "play:Veil the Legions:superior:V2:2:x"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V2").blood).toBe(bloodBefore - 2);
    expect(state.seats[0]!.stealthCharges).toBe(2);

    // Finish this action, then act again: the next action spends a charge.
    for (let i = 0; i < 20 && engine.decision(); i++) {
      const d = engine.decision()!;
      if (d.options.some((o) => o.id === "bleed:V2")) break;
      const pass = d.options.find((o) => o.id === "pass");
      if (!pass) break;
      runTrace(engine, [[d.seat, pass.id]]);
    }
    runTrace(engine, [["Alice", "bleed:V2"]]);
    expect(state.seats[0]!.stealthCharges).toBe(1);

    // The charge landed on the SECOND action, which nobody modified by
    // hand. Filtering by source would not do: the card's own +1 carries
    // the same name, so the actionId is what tells the two apart.
    const second = state.eventLog.find(
      (e) => e.type === "ActionAnnounced" && e.acting === "V2",
    );
    expect(second?.type === "ActionAnnounced" && second.actionId).toBeTruthy();
    const id = second!.type === "ActionAnnounced" ? second.actionId : "";
    const onSecond = state.eventLog.filter(
      (e) => e.type === "StealthModified" && e.actionId === id,
    );
    expect(onSecond.length).toBe(1);
    expect(onSecond[0]!.type === "StealthModified" && onSecond[0]!.delta).toBe(1);
  });

  it("allows only one copy per action, from ANY minion", () => {
    // Stricter than the p. 10 per-minion limit: a second vampire holding a
    // second copy still cannot play it into the same action.
    const state = game("Veil the Legions", { obf: "basic" });
    state.seats[0]!.minions.push(
      makeMinion("V3", "Alice", { disciplines: { obf: "basic" }, blood: 4 }),
    );
    state.seats[0]!.hand.push({ id: "x2", name: "Veil the Legions" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [
      ["Alice", "play:Veil the Legions:basic:V2:x"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Veil the Legions")),
    ).toBe(false);
  });

  it("is never offered to the acting minion, at either level", () => {
    const state = game("Veil the Legions", { obf: "superior" });
    Object.assign(find(state, "V1"), { disciplines: { obf: "superior" } });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Veil the Legions:basic:V1")),
    ).toBe(false);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Veil the Legions:superior:V1")),
    ).toBe(false);
  });

  it("is not offered to a LOCKED other vampire — this one says unlocked", () => {
    const state = game("Veil the Legions", { obf: "basic" });
    find(state, "V2").locked = true;
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Veil the Legions")),
    ).toBe(false);
  });
});

describe("Hedonism (102328)", () => {
  it("is not offered before a block is attempted", () => {
    // Deliberately stops SHORT of the block: "only usable … if a minion
    // attempts to block".
    const state = game("Hedonism", { for: "basic" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(engine.decision()!.options.some((o) => o.id.includes("Hedonism"))).toBe(false);
  });

  it("breaks the block, locks both, and queues a combat that waits", () => {
    const state = game("Hedonism", { for: "basic" });
    const poolBefore = state.seats[1]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [
      ["Alice", "play:Hedonism:basic:V2:x"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);

    // Both are locked immediately; the combat has NOT started — the bleed
    // is still resolving.
    expect(find(state, "V2").locked).toBe(true);
    expect(find(state, "M").locked).toBe(true);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);

    // Run the action out. The bleed lands (the block failed) and only then
    // does the queued combat begin.
    for (let i = 0; i < 30 && engine.decision(); i++) {
      if (state.frames.some((f) => f.kind === "combat")) break;
      const d = engine.decision()!;
      const pass = d.options.find((o) => o.id === "pass");
      if (!pass) break;
      runTrace(engine, [[d.seat, pass.id]]);
    }
    expect(state.seats[1]!.pool).toBe(poolBefore - 1);
    const cf = state.frames.find((f) => f.kind === "combat");
    expect(cf).toBeDefined();
    // Between the INTERPOSER and the blocker — neither is the actor.
    expect(cf!.kind === "combat" && cf!.acting).toBe("V2");
    expect(cf!.kind === "combat" && cf!.opposing).toBe("M");
  });

  it("queues no combat at superior", () => {
    const state = game("Hedonism", { pre: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [
      ["Alice", "play:Hedonism:superior:V2:x"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "M").locked).toBe(true);
    for (let i = 0; i < 30 && engine.decision(); i++) {
      const d = engine.decision()!;
      const pass = d.options.find((o) => o.id === "pass");
      if (!pass) break;
      runTrace(engine, [[d.seat, pass.id]]);
    }
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
    expect(state.eventLog.some((e) => e.type === "CombatBegan")).toBe(false);
  });

  it("stops the blocker attempting again — unlike a withdrawal", () => {
    const state = game("Hedonism", { for: "basic" });
    const engine = new VtesEngine(state, testRegistry);
    upToEffects(engine);
    runTrace(engine, [
      ["Alice", "play:Hedonism:basic:V2:x"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // Back in state A; M is barred (it "cannot attempt to block this
    // action again"), which is the opposite of Dawn Operation's cancel.
    for (let i = 0; i < 6 && engine.decision(); i++) {
      const d = engine.decision()!;
      if (d.seat === "Bob") {
        expect(d.options.some((o) => o.id === "block:M")).toBe(false);
        return;
      }
      runTrace(engine, [[d.seat, "pass"]]);
    }
    throw new Error("Bob was never offered a block decision");
  });
});
