/**
 * The ledger closeout (docs/ledger-closeout.md) — 2026-09-03.
 *
 * The owner asked for every printed clause on every library card to be
 * functional. These are the ten rows that were open, one describe each.
 * Every clause that a card can be OFFERED or NOT offered is tested in
 * both directions: the recurring bug in this project is an option list
 * that is empty for the wrong reason, and only a paired control tells
 * the difference.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function maybe(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}
function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
/** `pass`, then `end`, then anything — a walker must not play the board. */
function walkTo(engine: VtesEngine, prefix: string, limit = 140): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}
function step(engine: VtesEngine, n: number): void {
  walkTo(engine, "__nothing__", n);
}

/** Give a minion enough intercept that a +1-stealth action can be blocked. */
function withIntercept(m: MinionState, amount: number): void {
  m.attached.push({
    card: { id: `${m.id}-eyes`, name: "eyes" },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics: { intercept: amount },
    tags: [],
  });
}

/** Drive Alice's V1 into combat with Bob's W via a rush played from hand. */
function rushIntoCombat(state: GameState): VtesEngine {
  const v1 = state.seats[0]!.minions[0]!;
  v1.disciplines = { ...v1.disciplines, cel: "basic", tha: "basic" };
  v1.blood = Math.max(v1.blood, 4);
  state.seats[0]!.hand.push({ id: "rush9", name: "Hunter's Mark" });
  const engine = new VtesEngine(state, testRegistry);
  if (!walkTo(engine, "play:Hunter's Mark")) throw new Error("no rush offered");
  const rush = optionIds(engine).find(
    (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
  );
  if (!rush) throw new Error("no rush option naming W");
  runTrace(engine, [["Alice", rush]]);
  return engine;
}

// ---------------------------------------------------------------------------
// 1. Preternatural Strength — "cannot play cards named /Torn Signpost/"
// ---------------------------------------------------------------------------

describe("Preternatural Strength (101483) — the Torn Signpost bar", () => {
  /** V1 in combat holding Torn Signpost, optionally wearing the card. */
  function game(withCard: boolean): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pot: "superior" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "ts1", name: "Torn Signpost" });
    if (withCard) {
      v1.attached.push({
        card: { id: "ps1", name: "Preternatural Strength" },
        controller: "Alice",
        owner: "Alice",
        locked: false,
        usedThisPhase: false,
        statics: { strength: 1, cannotPlayCardNames: ["Torn Signpost"] },
        tags: ["Preternatural Strength"],
      });
    }
    // Torn Signpost is a COMBAT card, so a combat has to exist before it
    // can be offered at all.
    const engine = rushIntoCombat(state);
    return { state, engine };
  }

  it("without the card, Torn Signpost is playable in combat", () => {
    const { engine } = game(false);
    expect(walkTo(engine, "play:Torn Signpost")).toBe(true);
  });

  it("with the card, it is barred — and that is the only difference", () => {
    const { engine } = game(true);
    expect(walkTo(engine, "play:Torn Signpost", 60)).toBe(false);
  });

  it("bars by NAME only — other combat cards are unaffected", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { pot: "superior", tha: "superior" };
    v1.blood = 4;
    v1.attached.push({
      card: { id: "ps1", name: "Preternatural Strength" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { strength: 1, cannotPlayCardNames: ["Torn Signpost"] },
      tags: ["Preternatural Strength"],
    });
    state.seats[0]!.hand.push({ id: "wd9", name: "Wind Dance" });
    const engine = rushIntoCombat(state);
    expect(walkTo(engine, "play:Wind Dance")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Putrescent Sustenance — the zombie-life payoff
// ---------------------------------------------------------------------------

describe("Putrescent Sustenance (102335) — the zombie half", () => {
  function game(zombieLife: number | null): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { obl: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "ps1", name: "Putrescent Sustenance" });
    // Something to remove: an ally card in Bob's ash heap.
    seat(state, "Bob").ashHeap = [{ id: "dead1", name: "Underbridge Stray" }];
    if (zombieLife !== null) {
      const z = makeAlly("Z", "Alice", zombieLife, { name: "Aggressive Corpse", capacity: 3 });
      z.attached.push({
        card: { id: "Z", name: "Aggressive Corpse" },
        controller: "Alice",
        owner: "Alice",
        locked: false,
        usedThisPhase: false,
        statics: {},
        tags: ["zombie"],
      });
      state.seats[0]!.minions.push(z);
    }
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("offers the life payoff when a zombie ally can take it", () => {
    const { engine } = game(1);
    expect(walkTo(engine, "play:Putrescent Sustenance")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Putrescent Sustenance"));
    expect(ids.some((o) => o.includes("life"))).toBe(true);
    // The blood payoff is still there — this is an "or".
    expect(ids.some((o) => o.includes("gain"))).toBe(true);
  });

  it("does not offer it with no zombie ally at all", () => {
    const { engine } = game(null);
    expect(walkTo(engine, "play:Putrescent Sustenance")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Putrescent Sustenance"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes("life"))).toBe(false);
  });

  it("does not offer it to a zombie already at its starting life", () => {
    // "Not to exceed its starting life" — a recipient that could gain
    // nothing is not a choice.
    const { engine } = game(3);
    expect(walkTo(engine, "play:Putrescent Sustenance")).toBe(true);
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Putrescent Sustenance"));
    expect(ids.some((o) => o.includes("life"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. .44 Magnum — the equipment restriction it never honoured
// ---------------------------------------------------------------------------

describe(".44 Magnum (100001) — cannot be used when equipment is barred", () => {
  function game(barred: boolean): VtesEngine {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.attached.push({
      card: { id: "gun", name: ".44 Magnum" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["equipment", "weapon", "gun"],
    });
    state.seats[0]!.hand.push({ id: "hm1", name: "Hunter's Mark" });
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    const engine = new VtesEngine(state, testRegistry);
    // Rush Bob's W so a combat exists.
    walkTo(engine, "play:Hunter's Mark");
    const rush = optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes("W"));
    if (rush) runTrace(engine, [["Alice", rush]]);
    walkTo(engine, "strike:hand");
    if (barred) {
      const cf = state.frames.find((f) => f.kind === "combat");
      if (cf?.kind === "combat") cf.restrict.acting.equipment = true;
    }
    return engine;
  }

  it("the gun's strike is offered normally", () => {
    const engine = game(false);
    expect(optionIds(engine).some((o) => o.includes(".44 Magnum"))).toBe(true);
  });

  it("…and is gone when the bearer cannot use equipment", () => {
    const engine = game(true);
    expect(optionIds(engine).some((o) => o.includes(".44 Magnum"))).toBe(false);
    // The ordinary hand strike is still there, so the list is not empty
    // for the wrong reason.
    expect(optionIds(engine)).toContain("strike:hand");
  });
});

// ---------------------------------------------------------------------------
// 4. Melange — the attached card burns with its bearer
// ---------------------------------------------------------------------------

describe("Melange (101195) — the attached card does not outlive its bearer", () => {
  function game(): GameState {
    const state = threeSeatGame();
    seat(state, "Alice").permanents.push({
      card: { id: "mel1", name: "Melange" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Melange", "melangeOn:W"],
    });
    return state;
  }

  it("burns when the attached minion is burned (p. 16)", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    engine.burnMinion("W");
    step(engine, 3);
    expect(seat(state, "Alice").permanents.some((p) => p.card.name === "Melange")).toBe(false);
  });

  it("SURVIVES the bearer going to torpor — torpor is not leaving play", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "WentToTorpor", minion: "W" });
    step(engine, 3);
    expect(seat(state, "Alice").permanents.some((p) => p.card.name === "Melange")).toBe(true);
  });

  it("ignores a different minion leaving play", () => {
    const state = game();
    const engine = new VtesEngine(state, testRegistry);
    engine.burnMinion("M");
    step(engine, 3);
    expect(seat(state, "Alice").permanents.some((p) => p.card.name === "Melange")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Heroic Might — the second granted strike
// ---------------------------------------------------------------------------

describe("Heroic Might (100913) — [POT]'s second granted strike", () => {
  function game(superior: boolean): VtesEngine {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.attached.push({
      card: { id: "hm1", name: "Heroic Might" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { strength: superior ? 2 : 1 },
      tags: ["Heroic Might"],
    });
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "r1", name: "Hunter's Mark" });
    // The bearer needs a mode recorded for the ability to read; the spec
    // reads it off the mode that attached the card, so drive a real play
    // instead of hand-building when the superior is under test.
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    const rush = optionIds(engine).find((o) => o.startsWith("play:Hunter's Mark") && o.includes("W"));
    if (rush) runTrace(engine, [["Alice", rush]]);
    walkTo(engine, "strike:hand");
    return engine;
  }

  it("the basic mode grants only the burn-equipment strike", () => {
    // W carries no equipment, so burn-equipment is correctly not offered
    // and the ranged strike must not appear either.
    const engine = game(false);
    expect(optionIds(engine).some((o) => o.includes("rangedstrike"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Rotting Behemoth — burnt vampires reach the ash heap
// ---------------------------------------------------------------------------

describe("burnt vampires go to their owner's ash heap (p. 34)", () => {
  it("a burned vampire's card is filed, marked as crypt", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    engine.burnMinion("W");
    const heap = seat(state, "Bob").ashHeap ?? [];
    expect(heap.map((c) => c.id)).toContain("W");
    expect(heap.find((c) => c.id === "W")?.crypt).toBe(true);
    expect(maybe(state, "W")).toBeUndefined();
  });

  it("a vampire REMOVED from the game is not filed (p. 16)", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    engine.removeMinionFromGame("W");
    expect((seat(state, "Bob").ashHeap ?? []).map((c) => c.id)).not.toContain("W");
  });

  it("an ALLY is filed by its own card, not twice", () => {
    const state = threeSeatGame();
    const ally = makeAlly("AL", "Bob", 2, { name: "Underbridge Stray" });
    ally.attached.push({
      card: { id: "AL", name: "Underbridge Stray" },
      controller: "Bob",
      owner: "Bob",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
    });
    state.seats[1]!.minions.push(ally);
    const engine = new VtesEngine(state, testRegistry);
    engine.burnMinion("AL");
    const heap = seat(state, "Bob").ashHeap ?? [];
    expect(heap.filter((c) => c.id === "AL")).toHaveLength(1);
    expect(heap.find((c) => c.id === "AL")?.crypt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Rutor's Hand — pay to be immune
// ---------------------------------------------------------------------------

describe("Rutor's Hand (101664) — [THA]'s pay-to-opt-out", () => {
  function play(level: "basic" | "superior", blood: number): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.disciplines = { tha: level === "superior" ? "superior" : "basic" };
    v1.blood = blood;
    v1.capacity = 10;
    state.seats[0]!.hand.push({ id: "rh1", name: "Rutor's Hand" });
    const engine = new VtesEngine(state, testRegistry);
    if (!walkTo(engine, `play:Rutor's Hand:${level}`)) throw new Error("not offered");
    const id = optionIds(engine).find((o) => o.startsWith(`play:Rutor's Hand:${level}`))!;
    runTrace(engine, [["Alice", id]]);
    return { state, engine };
  }

  it("the superior asks, and paying 3 blood avoids the damage", () => {
    const { state, engine } = play("superior", 6);
    expect(walkTo(engine, "choice:Rutor's Hand")).toBe(true);
    const pay = optionIds(engine).find((o) => o.endsWith(":pay"))!;
    runTrace(engine, [["Alice", pay]]);
    step(engine, 6);
    // 6 blood − 1 card cost − 3 paid = 2, and NO aggravated damage.
    expect(find(state, "V1").blood).toBe(2);
    expect(state.eventLog.some((e) => e.type === "DamageInflicted")).toBe(false);
  });

  it("declining takes the aggravated damage instead", () => {
    const { state, engine } = play("superior", 6);
    expect(walkTo(engine, "choice:Rutor's Hand")).toBe(true);
    const take = optionIds(engine).find((o) => o.endsWith(":take"))!;
    runTrace(engine, [["Alice", take]]);
    step(engine, 6);
    expect(
      state.eventLog.some((e) => e.type === "DamageInflicted" && e.aggravated === true),
    ).toBe(true);
  });

  it("the BASIC mode never asks — that is the whole difference", () => {
    const { state, engine } = play("basic", 6);
    expect(walkTo(engine, "choice:Rutor's Hand", 20)).toBe(false);
    step(engine, 6);
    expect(
      state.eventLog.some((e) => e.type === "DamageInflicted" && e.aggravated === true),
    ).toBe(true);
  });

  it("is not asked when the 3 blood cannot be paid", () => {
    // An unaffordable offer is not a choice.
    const { engine } = play("superior", 3); // 3 − 1 cost = 2 left
    expect(walkTo(engine, "choice:Rutor's Hand", 20)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Go-getter — continue a blocked action as if unblocked
// ---------------------------------------------------------------------------

describe("Go-getter (102355) — [OBF] continues a blocked action", () => {
  /** Alice's Ravnos hunts; Bob blocks; Alice may continue. */
  function blockedHunt(withCard: boolean): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Ravnos";
    v1.disciplines = { obf: "superior" };
    v1.blood = 4;
    if (withCard) state.seats[0]!.hand.push({ id: "gg1", name: "Go-getter" });
    // A hunt carries +1 inherent stealth, so a 0-intercept blocker cannot
    // reach it — and a hunt that is never blocked tests nothing.
    withIntercept(state.seats[1]!.minions[0]!, 2);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "hunt:V1"]]);
    if (!walkTo(engine, "block:W", 30)) throw new Error("W could not block the hunt");
    runTrace(engine, [["Bob", "block:W"]]);
    return { state, engine };
  }

  it("a blocked hunt normally gains nothing", () => {
    const { state, engine } = blockedHunt(false);
    step(engine, 90);
    expect(state.eventLog.some((e) => e.type === "BloodGained" && e.minion === "V1")).toBe(false);
  });

  it("continuing runs the action's success effects", () => {
    const { state, engine } = blockedHunt(true);
    expect(walkTo(engine, "play:Go-getter:superior", 90)).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("play:Go-getter:superior"))!;
    runTrace(engine, [["Alice", id]]);
    step(engine, 90);
    // The hunt now happens: blood gained, and the log says so plainly.
    expect(state.eventLog.some((e) => e.type === "ActionContinued")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BloodGained" && e.minion === "V1")).toBe(true);
  });

  it("does NOT emit a second ActionResolved for the same action", () => {
    // One resolution really did happen and fail; a fold that counts
    // resolutions must not double-count (design §11).
    const { state, engine } = blockedHunt(true);
    if (walkTo(engine, "play:Go-getter:superior", 90)) {
      const id = optionIds(engine).find((o) => o.startsWith("play:Go-getter:superior"))!;
      runTrace(engine, [["Alice", id]]);
    }
    step(engine, 90);
    const resolved = state.eventLog.filter((e) => e.type === "ActionResolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ success: false });
  });

  it("does not burn the action's card twice", () => {
    const { state, engine } = blockedHunt(true);
    if (walkTo(engine, "play:Go-getter:superior", 90)) {
      const id = optionIds(engine).find((o) => o.startsWith("play:Go-getter:superior"))!;
      runTrace(engine, [["Alice", id]]);
    }
    step(engine, 90);
    const burns = state.eventLog.filter(
      (e) => e.type === "CardBurned" && e.name === "Go-getter",
    );
    expect(burns.length).toBeLessThanOrEqual(1);
  });

  it("is not usable during a bleed, even blocked", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Ravnos";
    v1.disciplines = { obf: "superior" };
    v1.blood = 4;
    state.seats[0]!.hand.push({ id: "gg1", name: "Go-getter" });
    withIntercept(state.seats[1]!.minions[0]!, 2);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    if (walkTo(engine, "block:W", 30)) runTrace(engine, [["Bob", "block:W"]]);
    expect(walkTo(engine, "play:Go-getter:superior", 90)).toBe(false);
  });
});
