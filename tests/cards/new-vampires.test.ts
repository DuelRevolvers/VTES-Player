/**
 * New vampires (docs/new-vampires-design.md) — four actions whose card
 * becomes a vampire, on the `becomesVampire` machinery Waters of Duat built.
 *
 * The Embrace (100633), Third Tradition: Progeny (101973), Creation Rites
 * (100441) and Tumnimos (102046). They differ in whose sect the childe takes,
 * whether it may act this turn, how much blood the sire gives it, and where
 * its Discipline master may come from — each asserted against the others.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return false;
}

/** Play the card and let the action resolve unopposed, stopping at a choice. */
function resolve(engine: VtesEngine, state: GameState, prefix: string): void {
  expect(walkTo(engine, prefix)).toBe(true);
  runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith(prefix))!]]);
  for (let i = 0; i < 30; i++) {
    const busy = state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay");
    if (!busy) break;
    const dp = engine.decision();
    if (!dp) break;
    if (dp.window === "choice") break;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
}

function board(name: string, id: string, over: Partial<MinionState>) {
  const state = threeSeatGame();
  Object.assign(find(state, "V1")!, { capacity: 6, blood: 5, ...over });
  seatOf(state, "Alice").hand.push({ id, name });
  // The first library card replaces the card played (p. 7).
  seatOf(state, "Alice").library = [
    { id: "filler", name: "Conditioning" },
    { id: "l1", name: "Celerity" },
  ];
  return { state, engine: new VtesEngine(state, testRegistry) };
}

const shuffles = (state: GameState) =>
  state.eventLog.filter((e) => e.type === "LibraryShuffled").length;

// ---------------------------------------------------------------------------

describe("The Embrace (100633)", () => {
  const make = (over: Partial<MinionState> = {}) =>
    board("The Embrace", "em", { clan: "Toreador", sect: "camarilla", ...over });

  it("makes a 1-capacity vampire of the actor's clan AND sect, with no blood", () => {
    const { state, engine } = make();
    resolve(engine, state, "play:The Embrace");
    const token = find(state, "em")!;
    expect(token.kind).toBe("vampire");
    expect(token.capacity).toBe(1);
    expect(token.clan).toBe("Toreador");
    expect(token.sect).toBe("camarilla");
    expect(token.blood).toBe(0);
    // It MUST hunt — so it is not barred from acting.
    expect(token.cannotActThisTurn).toBe(false);
  });

  it("the sect follows the actor: a Sabbat sire makes a Sabbat childe", () => {
    const { state, engine } = make({ clan: "Lasombra", sect: "sabbat" });
    resolve(engine, state, "play:The Embrace");
    expect(find(state, "em")!.sect).toBe("sabbat");
    expect(find(state, "em")!.clan).toBe("Lasombra");
  });

  it("asks nothing: no master search and no blood from the sire", () => {
    const { state, engine } = make();
    const before = find(state, "V1")!.blood;
    resolve(engine, state, "play:The Embrace");
    expect(state.frames.some((f) => f.kind === "choice")).toBe(false);
    expect(shuffles(state)).toBe(0);
    // Only the card's cost left the sire.
    expect(find(state, "V1")!.blood).toBe(before - 2);
  });

  it("the childe must hunt this turn (p. 21)", () => {
    const { state, engine } = make();
    resolve(engine, state, "play:The Embrace");
    expect(walkTo(engine, "hunt:em")).toBe(true);
    expect(optionIds(engine).every((o) => o.startsWith("hunt:"))).toBe(true);
  });

  it("a sterile vampire cannot play it", () => {
    expect(walkTo(make().engine, "play:The Embrace", 6)).toBe(true);
    expect(walkTo(make({ sterile: true }).engine, "play:The Embrace", 6)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Third Tradition: Progeny (101973)", () => {
  const make = (over: Partial<MinionState> = {}) =>
    board("Third Tradition: Progeny", "tp", {
      clan: "Ventrue",
      sect: "camarilla",
      title: "prince",
      ...over,
    });
  const P = "choice:Third Tradition: Progeny:tp:";

  it("requires a prince or justicar", () => {
    expect(walkTo(make().engine, "play:Third Tradition", 6)).toBe(true);
    expect(walkTo(make({ title: "justicar" }).engine, "play:Third Tradition", 6)).toBe(true);
    expect(walkTo(make({ title: "baron" }).engine, "play:Third Tradition", 6)).toBe(false);
    expect(walkTo(make({ title: null }).engine, "play:Third Tradition", 6)).toBe(false);
  });

  it("makes a CAMARILLA vampire whatever the sire's sect, and bars it from acting", () => {
    // A justicar need not be Camarilla in the fixture; the childe still is.
    const { state, engine } = make({ title: "justicar", sect: "anarch" });
    resolve(engine, state, "play:Third Tradition");
    const token = find(state, "tp")!;
    expect(token.sect).toBe("camarilla");
    expect(token.clan).toBe("Ventrue");
    expect(token.capacity).toBe(1);
    expect(token.cannotActThisTurn).toBe(true);
  });

  it("searches library, hand and ash heap, then offers up to its room in blood", () => {
    const { state, engine } = make();
    resolve(engine, state, "play:Third Tradition");
    expect(optionIds(engine)).toContain(`${P}searchDiscipline:library:l1`);
    runTrace(engine, [["Alice", `${P}searchDiscipline:none`]]);
    expect(shuffles(state)).toBe(1);

    // "Up to 2", but a 1-capacity vampire has room for 1.
    expect(optionIds(engine)).toEqual([`${P}tokenBlood:0`, `${P}tokenBlood:1`]);
    const sire = find(state, "V1")!.blood;
    runTrace(engine, [["Alice", `${P}tokenBlood:1`]]);
    expect(find(state, "tp")!.blood).toBe(1);
    expect(find(state, "V1")!.blood).toBe(sire - 1);
  });

  it("a master found first makes room for the second blood", () => {
    const { state, engine } = make();
    resolve(engine, state, "play:Third Tradition");
    runTrace(engine, [["Alice", `${P}searchDiscipline:library:l1`]]);
    expect(optionIds(engine)).toEqual([
      `${P}tokenBlood:0`,
      `${P}tokenBlood:1`,
      `${P}tokenBlood:2`,
    ]);
    runTrace(engine, [["Alice", `${P}tokenBlood:2`]]);
    expect(find(state, "tp")!.blood).toBe(2);
  });

  it("the gift is capped by the sire's own blood", () => {
    // Blood 3, pays 1 for the card: 2 left — then drained to 1 by the fixture.
    const { state, engine } = make({ blood: 2 });
    resolve(engine, state, "play:Third Tradition");
    runTrace(engine, [["Alice", `${P}searchDiscipline:library:l1`]]);
    expect(optionIds(engine)).toEqual([`${P}tokenBlood:0`, `${P}tokenBlood:1`]);
  });

  it("a childe that CANNOT act is not made to hunt, even at 0 blood", () => {
    const { state, engine } = make();
    resolve(engine, state, "play:Third Tradition");
    runTrace(engine, [["Alice", `${P}searchDiscipline:none`], ["Alice", `${P}tokenBlood:0`]]);
    expect(find(state, "tp")!.blood).toBe(0);
    // Walk the rest of the minion phase: the childe is never offered an action.
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "turn.minion") break;
      expect(dp.options.some((o) => o.id.endsWith(":tp"))).toBe(false);
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end") ?? dp.options[0]!).id);
    }
  });
});

// ---------------------------------------------------------------------------

describe("Creation Rites (100441)", () => {
  const make = (over: Partial<MinionState> = {}) =>
    board("Creation Rites", "cr", { clan: "Tzimisce", sect: "sabbat", title: "archbishop", ...over });
  const P = "choice:Creation Rites:cr:";

  it("requires an archbishop, priscus, cardinal or regent", () => {
    for (const title of ["archbishop", "priscus", "cardinal", "regent"] as const) {
      expect(walkTo(make({ title }).engine, "play:Creation Rites", 6)).toBe(true);
    }
    expect(walkTo(make({ title: "prince" }).engine, "play:Creation Rites", 6)).toBe(false);
    expect(walkTo(make({ title: null }).engine, "play:Creation Rites", 6)).toBe(false);
  });

  it("makes a SABBAT vampire that cannot act, and gives at most ONE blood", () => {
    const { state, engine } = make({ sect: "anarch" });
    resolve(engine, state, "play:Creation Rites");
    runTrace(engine, [["Alice", `${P}searchDiscipline:library:l1`]]);
    // Room for 2 after the master — Progeny would offer 2; this card says 1.
    expect(optionIds(engine)).toEqual([`${P}tokenBlood:0`, `${P}tokenBlood:1`]);
    runTrace(engine, [["Alice", `${P}tokenBlood:1`]]);
    const token = find(state, "cr")!;
    expect(token.sect).toBe("sabbat");
    expect(token.clan).toBe("Tzimisce");
    expect(token.cannotActThisTurn).toBe(true);
    expect(token.blood).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("Tumnimos (102046)", () => {
  const make = (over: Partial<MinionState> = {}) =>
    board("Tumnimos", "tu", { clan: "Ravnos", sect: "independent", ...over });
  const P = "choice:Tumnimos:tu:";

  it("requires a Ravnos of capacity 5 or more (the icon is a requirement, p. 10)", () => {
    expect(walkTo(make().engine, "play:Tumnimos", 6)).toBe(true);
    expect(walkTo(make({ capacity: 5 }).engine, "play:Tumnimos", 6)).toBe(true);
    expect(walkTo(make({ capacity: 4 }).engine, "play:Tumnimos", 6)).toBe(false);
    expect(walkTo(make({ clan: "Toreador" }).engine, "play:Tumnimos", 6)).toBe(false);
  });

  it("makes a 2-capacity Ravnos of the sire's sect with basic Chimerstry", () => {
    const { state, engine } = make({ sect: "anarch" });
    resolve(engine, state, "play:Tumnimos");
    if (engine.decision()?.window === "choice") runTrace(engine, [["Alice", `${P}searchDiscipline:none`]]);
    const token = find(state, "tu")!;
    expect(token.capacity).toBe(2);
    expect(token.clan).toBe("Ravnos");
    expect(token.sect).toBe("anarch");
    expect(token.disciplines).toEqual({ chi: "basic" });
    expect(token.blood).toBe(0);
    expect(token.cannotActThisTurn).toBe(false);
  });

  it("offers a master from the HAND only, and shuffles nothing", () => {
    const { state, engine } = make();
    seatOf(state, "Alice").hand.push({ id: "h1", name: "Potence" });
    seatOf(state, "Alice").ashHeap = [{ id: "a1", name: "Dominate" }];
    resolve(engine, state, "play:Tumnimos");
    const ids = optionIds(engine);
    expect(ids).toContain(`${P}searchDiscipline:hand:h1`);
    expect(ids).toContain(`${P}searchDiscipline:none`);
    expect(ids.some((o) => o.includes(":library:") || o.includes(":ashHeap:"))).toBe(false);
    runTrace(engine, [["Alice", `${P}searchDiscipline:hand:h1`]]);
    expect(find(state, "tu")!.attached.some((p) => p.card.name === "Potence")).toBe(true);
    expect(shuffles(state)).toBe(0);
    // No blood clause: nothing further is asked.
    expect(state.frames.some((f) => f.kind === "choice")).toBe(false);
  });
});
