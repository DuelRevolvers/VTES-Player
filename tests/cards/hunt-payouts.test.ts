/**
 * The hunt payout (docs/hunt-payouts-design.md).
 *
 * Hospital Food (100938), Inbase Discotek, Frankfurt (100968),
 * Festivo dello Estinto (100723), Harvest Rites (100889).
 *
 * Four cards that all put one more blood on a successful hunt. What separates
 * them is the PRICE and the MOMENT: a lock spent at announcement against one
 * spent after resolution, a table-wide aura that also makes the hunt easier to
 * block, and an attached card that had no way to fire at all (§5).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeMinion, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [name],
    ...over,
  };
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/**
 * Alice controls an ANARCH (AN) and a SABBAT vampire (SA) — the two cards below
 * filter on different sects, so one vampire could not tell a working filter from
 * a missing one. Both start below capacity: a full vampire gains nothing from
 * any of these cards and the options are correctly withheld, which would look
 * exactly like a broken card.
 */
function table(): { state: GameState; an: MinionState; sa: MinionState } {
  const state = threeSeatGame();
  const an = state.seats[0]!.minions[0]!;
  Object.assign(an, { id: "AN", name: "AN", sect: "anarch", blood: 2, capacity: 6 });
  const sa = makeMinion("SA", "Alice", { sect: "sabbat", blood: 1, capacity: 5 });
  state.seats[0]!.minions.push(sa);
  state.seats[0]!.library = Array.from({ length: 10 }, (_, i) => ({
    id: `lib${i}`,
    name: "Conditioning",
  }));
  return { state, an, sa };
}

/** The turn frame, put into a named phase with a master action in hand. */
function atPhase(state: GameState, phase: "master" | "minion"): void {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.phase = phase;
  if (phase === "master") tf.masterActionsLeft = 1;
}

/**
 * Pass until some seat is offered an option starting with `prefix`, and choose
 * it. A fixed trace cannot find the after-resolution window: the number of
 * decisions before it depends on how many seats can block, and one pass too
 * many passes the window away — which is how the first draft of these tests
 * "proved" the option was never offered.
 */
function walkToAndTake(engine: VtesEngine, prefix: string, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) {
      engine.choose(hit.id);
      return true;
    }
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return false;
    engine.choose(pick.id);
  }
  return false;
}

/** Walk the impulse cycles of an announced action, passing everything. */
function passAll(engine: VtesEngine, limit = 20): void {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (dp.window === "turn.minion" || dp.window === "turn.unlock") return;
    const pick = dp.options.find((o) => o.id === "pass");
    if (!pick) return;
    engine.choose(pick.id);
  }
}

// ---------------------------------------------------------------------------
// The pool can produce these cards' targets: both filters name a sect the V5
// crypt actually has. A filter naming a sect no vampire has would be the
// "Assamite" bug — whole, and inert (§0).
// ---------------------------------------------------------------------------

describe("the pool these cards filter on", () => {
  // A vampire's sect is the first word of its printed text ("Anarch: …"),
  // which is where the pipeline reads it from too — the registry's crypt
  // entries carry no `sect` field of their own.
  const sects = Object.values(registry.entries)
    .map((e) => e.card)
    .filter((c) => c.kind === "crypt")
    .map((c) => /^(Anarch|Sabbat|Camarilla|Independent|Laibon)\b/.exec(c.cardText ?? "")?.[1]);

  for (const sect of ["Anarch", "Sabbat"] as const) {
    it(`contains a ${sect} vampire, so the filter is not inert`, () => {
      expect(sects.filter((s) => s === sect).length).toBeGreaterThan(0);
    });
  }
});

describe("Hospital Food (100938) — the lock is spent at ANNOUNCEMENT", () => {
  it("pays the anarch an additional blood on a successful hunt", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("hf", "Hospital Food"));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:AN");
    // Offered in the ANNOUNCE window, before anybody has decided to block.
    const id = optionIds(engine).find((o) => o.startsWith("ability:Hospital Food:hf:huntBlood:AN"));
    expect(id, "not offered at announcement").toBeDefined();
    engine.choose(id!);
    expect(a.state.seats[0]!.permanents.find((p) => p.card.id === "hf")!.locked).toBe(true);
    passAll(engine);
    // 2 + 1 (the hunt, p. 21) + 1 (the card).
    expect(a.an.blood).toBe(4);
  });

  it("THE PRICE: a BLOCKED hunt spends the lock and pays nothing", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("hf", "Hospital Food"));
    // A hunt is inherently +1 stealth (p. 21), so a bare blocker only ATTEMPTS
    // and fails — which resolves the action and would have paid the blood. M
    // needs real intercept for this to be a blocked hunt at all.
    find(a.state, "M").attached.push(entry("i1", "Intercept", { statics: { intercept: 1 } }));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:AN");
    const id = optionIds(engine).find((o) => o.startsWith("ability:Hospital Food:hf:huntBlood"));
    expect(id).toBeDefined();
    engine.choose(id!);
    // Bought, not paid: the blood is a promise on the action frame.
    expect(a.an.blood).toBe(2);
    expect(walkToAndTake(engine, "block:M"), "M could not block").toBe(true);
    passAll(engine, 40);
    // Blocked: no hunt blood and no card blood.
    expect(a.an.blood).toBe(2);
    // The lock is gone anyway — that is what "lock WHEN … announces" costs.
    expect(a.state.seats[0]!.permanents.find((p) => p.card.id === "hf")!.locked).toBe(true);
  });

  it("NEGATIVE SPACE: not offered for a non-anarch hunter", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("hf", "Hospital Food"));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:SA"); // Sabbat, not anarch
    expect(optionIds(engine).some((o) => o.includes("Hospital Food"))).toBe(false);
  });

  it("NEGATIVE SPACE: not offered on a BLEED, only on a hunt", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("hf", "Hospital Food"));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("bleed:AN");
    expect(optionIds(engine).some((o) => o.includes("Hospital Food"))).toBe(false);
  });
});

describe("Inbase Discotek, Frankfurt (100968) — the lock is spent AFTER", () => {
  it("is NOT offered at announcement, and IS after a successful hunt", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("id", "Inbase Discotek, Frankfurt"));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:AN");
    // The control for Hospital Food: same clause, other window.
    expect(optionIds(engine).some((o) => o.includes("Inbase Discotek"))).toBe(false);

    expect(
      walkToAndTake(engine, "ability:Inbase Discotek"),
      "not offered after resolution",
    ).toBe(true);
    // The hunt blood landed at resolution; this is the card's extra on top.
    expect(a.an.blood).toBe(4);
  });

  it("feeds ANY seat's hunter — the card says 'a vampire', not 'you control'", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("id", "Inbase Discotek, Frankfurt"));
    const tf = a.state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "minion";
    }
    const bobMinion = find(a.state, "M");
    Object.assign(bobMinion, { blood: 1, capacity: 5 });
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:M");
    // Alice's location, Bob's hunter. The after-resolution window asks the
    // acting seat first, so who is asked FIRST says nothing about whose option
    // it is — walk to it instead of predicting the seat.
    expect(
      walkToAndTake(engine, "ability:Inbase Discotek"),
      "not offered for another seat's hunter",
    ).toBe(true);
    expect(bobMinion.blood).toBe(3);
  });
});

describe("Festivo dello Estinto (100723) — the table-wide bargain", () => {
  const aura = { scope: "global" as const, sect: "sabbat" as const, huntStealth: -1, huntFill: true };

  it("a SABBAT hunt fills the vampire to capacity", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("fe", "Festivo dello Estinto", { aura }));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:SA");
    passAll(engine);
    // 1 blood, capacity 5 → full, not 1 + 1.
    expect(a.sa.blood).toBe(5);
  });

  it("CONTROL: the anarch's hunt still gains exactly 1", () => {
    const a = table();
    a.state.seats[0]!.permanents.push(entry("fe", "Festivo dello Estinto", { aura }));
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    engine.choose("hunt:AN");
    passAll(engine);
    expect(a.an.blood).toBe(3);
  });

  it("THE COST: the Sabbat hunter's stealth drops to 0, and the anarch's does not", () => {
    for (const [who, stealth] of [
      ["SA", 0],
      ["AN", 1],
    ] as const) {
      const a = table();
      a.state.seats[0]!.permanents.push(entry("fe", "Festivo dello Estinto", { aura }));
      atPhase(a.state, "minion");
      const engine = new VtesEngine(a.state, testRegistry);
      engine.choose(`hunt:${who}`);
      const ev = a.state.eventLog.find((e) => e.type === "ActionAnnounced");
      const id = ev?.type === "ActionAnnounced" ? ev.actionId : "";
      // A hunt is inherently +1 stealth (p. 21); the aura takes one back.
      expect(currentStealth(a.state, id), `${who} stealth`).toBe(stealth);
    }
  });

  it("burns itself during its controller's unlock phase", () => {
    const a = table();
    a.state.seats[0]!.hand.push({ id: "fe", name: "Festivo dello Estinto" });
    atPhase(a.state, "master");
    const engine = new VtesEngine(a.state, testRegistry);

    const play = optionIds(engine).find((o) => o.startsWith("play:Festivo dello Estinto"));
    expect(play, "not playable").toBeDefined();
    engine.choose(play!);
    passAll(engine, 8);
    const inPlay = a.state.seats[0]!.permanents.find((p) => p.card.id === "fe");
    expect(inPlay, "not in play").toBeDefined();
    // The aura was denormalized off the handler, not written by the test.
    expect(inPlay!.aura?.huntFill).toBe(true);
    expect(inPlay!.aura?.huntStealth).toBe(-1);

    // Round the table back to Alice's unlock phase.
    for (let i = 0; i < 200; i++) {
      if (!a.state.seats[0]!.permanents.some((p) => p.card.id === "fe")) break;
      const dp = engine.decision();
      if (!dp) break;
      const pick =
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "end") ??
        dp.options[0]!;
      engine.choose(pick.id);
    }
    expect(a.state.seats[0]!.permanents.some((p) => p.card.id === "fe")).toBe(false);
  });
});

describe("Harvest Rites (100889) — the ATTACHED payout that could not fire", () => {
  it("attaches to the acting Sabbat vampire and pays on its hunt", () => {
    const a = table();
    a.state.seats[0]!.hand.push({ id: "hr", name: "Harvest Rites" });
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    const play = optionIds(engine).find((o) => o.startsWith("play:Harvest Rites:basic:SA"));
    expect(play, "not offered to the Sabbat vampire").toBeDefined();
    engine.choose(play!);
    passAll(engine, 20);
    const attached = a.sa.attached.find((p) => p.card.id === "hr");
    expect(attached, "did not attach").toBeDefined();
    // The card cost 1 blood; SA started at 1.
    const before = a.sa.blood;

    // Unlock SA and hunt: this is the assertion that failed before the
    // `onHuntSuccess` dispatch was widened to attached cards (§5).
    a.sa.locked = false;
    const dp = engine.decision();
    if (dp?.window !== "turn.minion") throw new Error(`not in the minion phase: ${dp?.window}`);
    engine.choose("hunt:SA");
    passAll(engine, 20);
    // 1 (the hunt) + 1 (Harvest Rites).
    expect(a.sa.blood).toBe(before + 2);
    // "Once each turn" is latched on the entry, so a second hunt this turn
    // would pay nothing.
    expect(a.sa.attached.find((p) => p.card.id === "hr")!.usedThisTurn).toBe(true);
  });

  it("NEGATIVE SPACE: not offered to the anarch, and only one per vampire", () => {
    const a = table();
    a.state.seats[0]!.hand.push({ id: "hr", name: "Harvest Rites" });
    a.state.seats[0]!.hand.push({ id: "hr2", name: "Harvest Rites" });
    atPhase(a.state, "minion");
    const engine = new VtesEngine(a.state, testRegistry);

    // "Requires a Sabbat vampire" — the anarch cannot play it.
    expect(optionIds(engine).some((o) => o.startsWith("play:Harvest Rites:basic:AN"))).toBe(false);

    engine.choose(optionIds(engine).find((o) => o.startsWith("play:Harvest Rites:basic:SA"))!);
    passAll(engine, 20);
    a.sa.locked = false;
    // "A vampire can have only one Harvest Rites."
    expect(optionIds(engine).some((o) => o.startsWith("play:Harvest Rites:basic:SA"))).toBe(false);
  });
});
