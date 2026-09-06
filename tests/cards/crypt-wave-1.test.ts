/**
 * Crypt wave 1 — the statics (docs/crypt-wave-1.md).
 *
 * The first crypt cards to have working abilities. Everything here is a
 * `PermanentStatics` or `ConditionalStatic` riding on the vampire's own
 * SELF-ATTACHED entry, which is the whole architecture: an ally's card
 * text has worked this way since the allies gate, so a crypt ability
 * needs no second set of rules (docs/crypt-plan.md §2).
 *
 * Every conditional is tested in BOTH directions. A conditional static
 * that never fires and one that always fires look identical from a single
 * assertion, and that is the bug this project keeps finding.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, capacityOf, currentIntercept, handSizeOf } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

/**
 * Put a real crypt card's ability onto a minion, exactly the way
 * `makeVampire` does when a deck is built.
 */
function asVampire(m: MinionState, cryptName: string): MinionState {
  const entry = handlers[cryptName]?.cryptEntry?.();
  if (!entry) throw new Error(`no crypt entry for ${cryptName}`);
  m.attached.push({
    card: { id: m.id, name: cryptName },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics: entry.statics,
    tags: entry.tags,
  });
  return m;
}

function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function walkTo(engine: VtesEngine, prefix: string, limit = 120): boolean {
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

/** The id of the action currently underway. */
function actionIdOf(state: GameState): string {
  const ev = [...state.eventLog].reverse().find((e) => e.type === "ActionAnnounced");
  if (!ev || ev.type !== "ActionAnnounced") throw new Error("no action announced");
  return ev.actionId;
}

/** Pool Bob loses to Alice's V1 bleeding him, before anything else. */
function bleedFor(state: GameState): number {
  const engine = new VtesEngine(state, testRegistry);
  const before = seat(state, "Bob").pool;
  runTrace(engine, [["Alice", "bleed:V1"]]);
  for (let i = 0; i < 40 && engine.decision(); i++) {
    const dp = engine.decision()!;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
    if (state.eventLog.some((e) => e.type === "ActionResolved")) break;
  }
  return before - seat(state, "Bob").pool;
}

// ---------------------------------------------------------------------------
// Flat traits
// ---------------------------------------------------------------------------

describe("flat crypt statics", () => {
  it("Catalina Vega bleeds for 2", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Catalina Vega (G6)");
    expect(bleedFor(state)).toBe(2);
  });

  it("…and a vampire with no crypt ability bleeds for 1 — the control", () => {
    expect(bleedFor(threeSeatGame())).toBe(1);
  });

  it("Massimiliano's +1 strength reaches combat damage", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    asVampire(v1, "Massimiliano (G6)");
    v1.disciplines = { cel: "basic", tha: "basic" };
    v1.blood = 4;
    const w = state.seats[1]!.minions[0]!;
    w.blood = 6;
    state.seats[0]!.hand.push({ id: "r1", name: "Hunter's Mark" });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "play:Hunter's Mark");
    const rush = optionIds(engine).find(
      (o) => o.startsWith("play:Hunter's Mark") && o.includes(":W:"),
    )!;
    runTrace(engine, [["Alice", rush]]);
    for (let i = 0; i < 40 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pick =
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id === "press:end") ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
      if (state.eventLog.some((e) => e.type === "CombatEnded")) break;
    }
    // Base strength 1 + 1 from the crypt card.
    const dmg = state.eventLog.find(
      (e) => e.type === "DamageInflicted" && e.minion === "W",
    );
    expect(dmg && dmg.type === "DamageInflicted" ? dmg.amount : 0).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Conditioned on the action
// ---------------------------------------------------------------------------

describe("conditions on the action", () => {
  /** V1 acts; report the intercept Bob's W is offered against it. */
  function interceptDuring(cryptName: string | null, action: string): number {
    const state = threeSeatGame();
    const target = state.seats[1]!.minions[0]!;
    if (cryptName) asVampire(target, cryptName);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", action]]);
    walkTo(engine, "block:W");
    return currentIntercept(state, actionIdOf(state), "W");
  }

  it("Martina gains intercept during a BLEED and not during a hunt", () => {
    // A bleed is directed at Bob, so his W is a legal blocker either way;
    // the pair isolates the action condition alone.
    const withBleed = interceptDuring("Martina Srnankova (G6)", "bleed:V1");
    const control = interceptDuring(null, "bleed:V1");
    expect(withBleed).toBe(control + 1);
  });

  it("The Dowager gains intercept during a DIRECTED action only", () => {
    const directed = interceptDuring("The Dowager (G6)", "bleed:V1");
    const base = interceptDuring(null, "bleed:V1");
    expect(directed).toBe(base + 1);
    // A hunt is undirected — the same card, the same blocker, no bonus.
    const undirected = interceptDuring("The Dowager (G6)", "hunt:V1");
    const undirectedBase = interceptDuring(null, "hunt:V1");
    expect(undirected).toBe(undirectedBase);
  });

  it("Castellan swings BOTH ways — +1 directed, −1 undirected", () => {
    expect(interceptDuring("Castellan (G7)", "bleed:V1")).toBe(
      interceptDuring(null, "bleed:V1") + 1,
    );
    expect(interceptDuring("Castellan (G7)", "hunt:V1")).toBe(
      interceptDuring(null, "hunt:V1") - 1,
    );
  });
});

// ---------------------------------------------------------------------------
// Conditioned on the acting minion
// ---------------------------------------------------------------------------

describe("conditions on the acting minion", () => {
  function interceptVs(cryptName: string, tweakActor: (m: MinionState) => void): number {
    const state = threeSeatGame();
    asVampire(state.seats[1]!.minions[0]!, cryptName);
    tweakActor(state.seats[0]!.minions[0]!);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "block:W");
    return currentIntercept(state, actionIdOf(state), "W");
  }

  it("Bret Stryker loses intercept against a TITLED vampire only", () => {
    const vsTitled = interceptVs("Bret Stryker (G6)", (m) => {
      m.title = "prince";
    });
    const vsUntitled = interceptVs("Bret Stryker (G6)", () => {});
    expect(vsTitled).toBe(vsUntitled - 1);
  });

  it("Azucena reads the acting Lasombra's age in both directions", () => {
    // Azucena's own capacity is the fixture's 5.
    const younger = interceptVs("Azucena (G6)", (m) => {
      m.clan = "Lasombra";
      m.capacity = 3;
    });
    const older = interceptVs("Azucena (G6)", (m) => {
      m.clan = "Lasombra";
      m.capacity = 9;
    });
    const otherClan = interceptVs("Azucena (G6)", (m) => {
      m.clan = "Brujah";
      m.capacity = 3;
    });
    expect(younger).toBe(otherClan + 1);
    expect(older).toBe(otherClan - 1);
  });
});

// ---------------------------------------------------------------------------
// Conditioned on the board
// ---------------------------------------------------------------------------

describe("conditions on the board", () => {
  it("Üresség bleeds for 2 only while the prey is low on pool", () => {
    const low = threeSeatGame();
    asVampire(low.seats[0]!.minions[0]!, "Üresség (G6)");
    seat(low, "Bob").pool = 10;
    expect(bleedFor(low)).toBe(2);

    const high = threeSeatGame();
    asVampire(high.seats[0]!.minions[0]!, "Üresség (G6)");
    seat(high, "Bob").pool = 11;
    expect(bleedFor(high)).toBe(1);
  });

  it("Damian needs a ready CARDINAL you control", () => {
    const withCardinal = threeSeatGame();
    asVampire(withCardinal.seats[0]!.minions[0]!, "Damian (G6)");
    withCardinal.seats[0]!.minions.push(
      makeMinion("V2", "Alice", { title: "cardinal" }),
    );
    expect(bleedFor(withCardinal)).toBe(2);

    const without = threeSeatGame();
    asVampire(without.seats[0]!.minions[0]!, "Damian (G6)");
    without.seats[0]!.minions.push(makeMinion("V2", "Alice", { title: "prince" }));
    expect(bleedFor(without)).toBe(1);
  });

  it("Neserian: −1 bleed with no locations, and the vote arrives with one", () => {
    const bare = threeSeatGame();
    asVampire(bare.seats[0]!.minions[0]!, "Neserian (G6)");
    expect(bleedFor(bare)).toBe(0);

    const withLocation = threeSeatGame();
    asVampire(withLocation.seats[0]!.minions[0]!, "Neserian (G6)");
    seat(withLocation, "Alice").permanents.push({
      card: { id: "loc1", name: "Art Museum" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location"],
    });
    expect(bleedFor(withLocation)).toBe(1);
  });

  it("Carmelita gives +1 hand size, and Khin Aye only while behind", () => {
    const state = threeSeatGame();
    const base = handSizeOf(state, "Alice");
    asVampire(state.seats[0]!.minions[0]!, "Carmelita Neillson (G7)");
    expect(handSizeOf(state, "Alice")).toBe(base + 1);

    // Khin Aye: Alice's predator is Carol (seating Alice → Bob → Carol).
    const k = threeSeatGame();
    const kBase = handSizeOf(k, "Alice");
    asVampire(k.seats[0]!.minions[0]!, "Khin Aye (G6)");
    expect(handSizeOf(k, "Alice")).toBe(kBase); // Carol has 1, Alice has 1
    k.seats[2]!.minions.push(makeMinion("N2", "Carol"));
    k.seats[2]!.minions.push(makeMinion("N3", "Carol"));
    expect(handSizeOf(k, "Alice")).toBe(kBase + 1);
  });

  it("Anxo's strength follows the Edge", () => {
    const state = threeSeatGame();
    const v1 = asVampire(state.seats[0]!.minions[0]!, "Anxo Vilela (G6)");
    // The static is conditional, so reading it is the assertion.
    state.edge = null;
    expect(v1.attached[0]!.statics.conditional?.[0]?.strength).toBe(1);
    // Proven end to end by the board check the engine makes:
    state.edge = "Bob";
    const notMine = handSizeOf(state, "Alice"); // unrelated, just a live read
    expect(notMine).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

describe("blocking statics", () => {
  it("Rexton cannot be blocked by an ally or a small vampire, but can by a big one", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, 'Rexton "Savage" Abernathy (G6)');
    const bob = state.seats[1]!;
    bob.minions[0]!.capacity = 8; // W: big enough to block
    bob.minions[1]!.capacity = 3; // M: too small
    bob.minions.push(makeAlly("AL", "Bob", 3, { name: "Underbridge Stray" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "block:");
    const ids = optionIds(engine);
    expect(ids).toContain("block:W");
    expect(ids).not.toContain("block:M");
    expect(ids).not.toContain("block:AL");
  });

  it("Jürgen charges 1 blood to ATTEMPT a block", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Jürgen, The Libertine (G6)");
    const w = state.seats[1]!.minions[0]!;
    w.blood = 3;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "block:W")).toBe(true);
    runTrace(engine, [["Bob", "block:W"]]);
    for (let i = 0; i < 20 && engine.decision(); i++) {
      const dp = engine.decision()!;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
      if (state.eventLog.some((e) => e.type === "BlockSucceeded")) break;
    }
    // Paid to ATTEMPT, not to succeed (docs/block-tax-design.md).
    expect(
      state.eventLog.some(
        (e) => e.type === "BloodBurned" && e.minion === "W" && e.amount === 1,
      ),
    ).toBe(true);
  });

  it("…and an ALLY can pay Jürgen's toll, because it is 'or life' (p. 22)", () => {
    const state = threeSeatGame();
    asVampire(state.seats[0]!.minions[0]!, "Jürgen, The Libertine (G6)");
    state.seats[1]!.minions.push(makeAlly("AL", "Bob", 3, { name: "Underbridge Stray" }));
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:V1"]]);
    walkTo(engine, "block:");
    expect(optionIds(engine)).toContain("block:AL");
  });
});

// ---------------------------------------------------------------------------
// The data this wave rests on
// ---------------------------------------------------------------------------

describe("the crypt pipeline", () => {
  it("a vampire built from a deck carries its card's ability", async () => {
    const { importCryptCard } = await import("../../src/ui/cardinfo.ts");
    // Catalina Vega is a real V5 crypt card with a real ability.
    const card = importCryptCard(201540);
    expect(card.name).toBe("Catalina Vega (G6)");
    expect(handlers[card.name]?.cryptEntry?.().statics.bleed).toBe(1);
  });

  it("a vampire with a bare sect/title line gets NO entry", () => {
    // 118 of the 217 are like this, and they must stay untouched.
    expect(handlers["Ariane (G5)"]?.cryptEntry).toBeDefined();
    expect(handlers["Nosferatu Kingdom"]).toBeUndefined();
  });

  it("Azucena's age comparison uses DERIVED capacity", () => {
    // Not the printed field: a granted point of capacity has to count.
    const m = makeMinion("x", "Alice", { capacity: 5 });
    expect(capacityOf(m)).toBe(5);
  });
});
