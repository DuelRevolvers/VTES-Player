/**
 * What a referendum chooses, and who pays
 * (docs/referendum-terms-design.md).
 *
 * Anarch Salon (100056), Consanguineous Boon (100410), Cold War (102312),
 * Disputed Territory (100557), Camarilla's Iron Fist (102270).
 *
 * Political Action's first per-card wave. The politics kernel and every
 * gate on it are closed, so these are terms: what the caller chooses when
 * the referendum is announced, and what a passed vote does with it.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { CLANS, VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function location(id: string, name: string, seat: string): PermanentInPlay {
  return {
    card: { id, name },
    controller: seat,
    owner: seat,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: ["location"],
  };
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Play a political action and pass through announce / A / C. */
const announceTrace = (prefix: string): Array<[string, string]> => [
  ["Alice", prefix],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

/** Alice's caller votes it through; the others decline. */
const passTrace: Array<[string, string]> = [
  ["Alice", "vote:V1:for"],
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
];

// ---------------------------------------------------------------------------

describe("Anarch Salon (100056)", () => {
  function salonGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "anarch", title: "baron", blood: 2 });
    // Bob controls TWO ready Anarchs — the half that counts vampires.
    Object.assign(find(state, "W"), { sect: "anarch", blood: 1 });
    Object.assign(find(state, "M"), { sect: "anarch", blood: 1 });
    // Carol's is in TORPOR: "ready" is the ready region (p. 16).
    Object.assign(find(state, "N"), { sect: "anarch", blood: 1, inTorpor: true });
    seatOf(state, "Alice").hand.push({ id: "as1", name: "Anarch Salon" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("has NO terms — it goes straight to polling", () => {
    const { engine } = salonGame();
    runTrace(engine, announceTrace("play:Anarch Salon"));
    // No `terms:` decision; the next thing asked is a vote.
    expect(optionIds(engine).some((o) => o.startsWith("terms:"))).toBe(false);
    expect(optionIds(engine).some((o) => o.startsWith("vote:"))).toBe(true);
  });

  it("each ready Anarch gains blood; each CONTROLLER gains one pool, not one each", () => {
    const { state, engine } = salonGame();
    const pools = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
    runTrace(engine, [...announceTrace("play:Anarch Salon"), ...passTrace]);
    expect(state.eventLog.some((e) => e.type === "ReferendumResolved" && e.passed)).toBe(
      true,
    );
    // Vampires: Alice's V1 and both of Bob's gained 1 blood each.
    expect(find(state, "V1").blood).toBe(3);
    expect(find(state, "W").blood).toBe(2);
    expect(find(state, "M").blood).toBe(2);
    // …but Bob, with TWO Anarchs, gains ONE pool. That is the whole point.
    expect(seatOf(state, "Bob").pool).toBe(pools["Bob"]! + 1);
    expect(seatOf(state, "Alice").pool).toBe(pools["Alice"]! + 1);
    // Carol's Anarch is in torpor: no blood, and no pool for her.
    expect(find(state, "N").blood).toBe(1);
    expect(seatOf(state, "Carol").pool).toBe(pools["Carol"]!);
  });
});

describe("Consanguineous Boon (100410)", () => {
  function boonGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince", clan: "Brujah" });
    Object.assign(find(state, "W"), { clan: "Brujah" });
    Object.assign(find(state, "M"), { clan: "Brujah" });
    Object.assign(find(state, "N"), { clan: "Ventrue" });
    seatOf(state, "Alice").hand.push({ id: "cb1", name: "Consanguineous Boon" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("RULING (p. 49): the terms are every EXISTING clan, in play or not", () => {
    const { engine } = boonGame();
    runTrace(engine, announceTrace("play:Consanguineous Boon"));
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    expect(terms.length).toBe(CLANS.length);
    // Nobody controls a Nosferatu, and it is still a legal choice.
    expect(terms).toContain("terms:Nosferatu");
    expect(terms).toContain("terms:Brujah");
  });

  it("pays each Methuselah 1 pool per vampire of the chosen clan", () => {
    const { state, engine } = boonGame();
    const pools = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
    runTrace(engine, [
      ...announceTrace("play:Consanguineous Boon"),
      ["Alice", "terms:Brujah"],
      ...passTrace,
    ]);
    expect(seatOf(state, "Alice").pool).toBe(pools["Alice"]! + 1); // one Brujah
    expect(seatOf(state, "Bob").pool).toBe(pools["Bob"]! + 2); // two Brujah
    expect(seatOf(state, "Carol").pool).toBe(pools["Carol"]!); // none
  });

  it("a clan nobody plays pays nobody — which is legal, not a bug", () => {
    const { state, engine } = boonGame();
    const pools = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
    runTrace(engine, [
      ...announceTrace("play:Consanguineous Boon"),
      ["Alice", "terms:Nosferatu"],
      ...passTrace,
    ]);
    for (const s of state.seats) expect(s.pool).toBe(pools[s.id]!);
  });

  it("NEGATIVE SPACE: an ALLY of no clan is never counted", () => {
    // Allies have `clan: null`, so they are excluded by construction.
    const { state, engine } = boonGame();
    seatOf(state, "Carol").minions.push(
      makeMinion("CA", "Carol", { kind: "ally", clan: null }),
    );
    const pools = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
    runTrace(engine, [
      ...announceTrace("play:Consanguineous Boon"),
      ["Alice", "terms:Ventrue"],
      ...passTrace,
    ]);
    expect(seatOf(state, "Carol").pool).toBe(pools["Carol"]! + 1); // N only
  });
});

describe("Cold War (102312)", () => {
  function coldWarGame(title: "bishop" | "cardinal"): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", title, blood: 3 });
    seatOf(state, "Bob").permanents.push(location("gm", "Garibaldi-Meucci Museum", "Bob"));
    seatOf(state, "Alice").hand.push({ id: "cw1", name: "Cold War" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("a titled Sabbat vampire chooses a Methuselah OR a location", () => {
    const { engine } = coldWarGame("bishop");
    runTrace(engine, announceTrace("play:Cold War"));
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    expect(terms).toContain("terms:Bob");
    expect(terms).toContain("terms:loc:gm");
    // NEGATIVE SPACE: a bishop is not a cardinal or regent, so no "both".
    expect(terms.some((o) => /^terms:\w+:loc:/.test(o))).toBe(false);
  });

  it("a CARDINAL may choose both, and both halves land", () => {
    const { state, engine } = coldWarGame("cardinal");
    runTrace(engine, announceTrace("play:Cold War"));
    expect(optionIds(engine)).toContain("terms:Bob:loc:gm");
    const pool = seatOf(state, "Bob").pool;
    runTrace(engine, [["Alice", "terms:Bob:loc:gm"], ...passTrace]);
    expect(seatOf(state, "Bob").pool).toBe(pool - 3);
    expect(seatOf(state, "Bob").permanents).toEqual([]);
  });

  it("NEGATIVE SPACE: an UNTITLED Sabbat vampire cannot play it at all", () => {
    // "Requires a TITLED Sabbat vampire" — any title, which is a
    // different question from a named list.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "sabbat", title: null, blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "cw1", name: "Cold War" });
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((o) => o.startsWith("play:Cold War"))).toBe(false);

    // CONTROL: give the same vampire any title and it appears.
    find(state, "V1").title = "priscus";
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((o) => o.startsWith("play:Cold War")),
    ).toBe(true);
  });
});

describe("Disputed Territory (100557)", () => {
  it("hands a chosen location to a chosen Methuselah", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince" });
    seatOf(state, "Bob").permanents.push(location("gm", "Garibaldi-Meucci Museum", "Bob"));
    seatOf(state, "Alice").hand.push({ id: "dt1", name: "Disputed Territory" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceTrace("play:Disputed Territory"));
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    // The cross product: one option per (location, Methuselah).
    expect(terms).toContain("terms:gm:Alice");
    expect(terms).toContain("terms:gm:Carol");
    // The current controller is a legal — if pointless — choice.
    expect(terms).toContain("terms:gm:Bob");

    runTrace(engine, [["Alice", "terms:gm:Alice"], ...passTrace]);
    expect(seatOf(state, "Alice").permanents.map((p) => p.card.id)).toEqual(["gm"]);
    expect(seatOf(state, "Bob").permanents).toEqual([]);
    // Ownership never moves (p. 16) — only control.
    expect(seatOf(state, "Alice").permanents[0]!.owner).toBe("Bob");
  });

  it("NEGATIVE SPACE: with no location in play there are no terms at all", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { title: "prince" });
    seatOf(state, "Alice").hand.push({ id: "dt1", name: "Disputed Territory" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, announceTrace("play:Disputed Territory"));
    // A referendum whose terms have no legal choice passes with no
    // effect — the kernel's recorded behaviour, not a new one.
    expect(optionIds(engine).some((o) => o.startsWith("terms:"))).toBe(false);
  });
});

describe("Camarilla's Iron Fist (102270)", () => {
  function fistGame(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "camarilla", title: "prince", blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "cif", name: "Camarilla's Iron Fist" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("the chosen Methuselah gains, and the OTHERS split 5 points", () => {
    const { state, engine } = fistGame();
    runTrace(engine, announceTrace("play:Camarilla's Iron Fist"));
    const terms = optionIds(engine).filter((o) => o.startsWith("terms:"));
    // "Other" is measured from the CHOSEN seat: choosing Carol allocates
    // among Alice and Bob (§2).
    expect(terms).toContain("terms:Carol:Alice=2,Bob=3");
    // …and the chosen seat is never itself allocated points.
    expect(terms.every((o) => !/^terms:(\w+):.*\1=/.test(o))).toBe(true);

    const pools = Object.fromEntries(state.seats.map((s) => [s.id, s.pool]));
    runTrace(engine, [["Alice", "terms:Carol:Alice=2,Bob=3"], ...passTrace]);
    // The card's own cost is 1 BLOOD, so Alice's pool moves only by the
    // 2 points allocated to her — a caller may allocate to themselves.
    expect(seatOf(state, "Alice").pool).toBe(pools["Alice"]! - 2);
    expect(find(state, "V1").blood).toBe(2);
    expect(seatOf(state, "Bob").pool).toBe(pools["Bob"]! - 3);
    expect(seatOf(state, "Carol").pool).toBe(pools["Carol"]! + 1);
  });

  it("NEGATIVE SPACE: an untitled Camarilla vampire cannot play it", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { sect: "camarilla", title: null, blood: 3 });
    seatOf(state, "Alice").hand.push({ id: "cif", name: "Camarilla's Iron Fist" });
    expect(
      optionIds(new VtesEngine(state, testRegistry)).some((o) =>
        o.startsWith("play:Camarilla's Iron Fist"),
      ),
    ).toBe(false);
  });
});

describe("CLANS is derived, not guessed", () => {
  it("matches exactly the clans the V5 crypt contains", async () => {
    // The CITY_TITLES precedent: a constant that must not rot the way the
    // "Assamite" filter did (docs/referendum-terms-design.md §1).
    const registry = (await import("../../src/cards/registry.json", {
      with: { type: "json" },
    })) as unknown as { default: { entries: Record<string, { card: Record<string, unknown> }> } };
    const fromRegistry = new Set<string>();
    for (const e of Object.values(registry.default.entries)) {
      if (e.card["kind"] === "crypt" && typeof e.card["clan"] === "string") {
        fromRegistry.add(e.card["clan"]);
      }
    }
    expect([...CLANS].sort()).toEqual([...fromRegistry].sort());
  });
});
