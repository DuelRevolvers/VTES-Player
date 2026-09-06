/**
 * The token-vampire gate (docs/token-vampire-design.md) — unblocked by the
 * owner on 2026-09-03.
 *
 * Waters of Duat (102159) and Childe of the Revolution (102246): a LIBRARY
 * card that becomes a 1-capacity vampire. That is the ally machinery with
 * `kind: "vampire"`, and because the token enters with 0 blood, "must hunt
 * this turn" is p. 21's mandatory hunt rather than anything new.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

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

/** Walk the impulse cycle until some seat is offered `prefix`. */
function walkTo(engine: VtesEngine, prefix: string, limit = 40): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  return false;
}

/** Play the card and let the action resolve unopposed. */
function resolve(engine: VtesEngine, state: GameState, prefix: string): void {
  expect(walkTo(engine, prefix)).toBe(true);
  runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith(prefix))!]]);
  for (let i = 0; i < 30; i++) {
    const busy = state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay");
    if (!busy) break;
    const dp = engine.decision();
    if (!dp) break;
    // Stop at the search question rather than answering it blindly.
    if (dp.window === "choice") break;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
}

// ---------------------------------------------------------------------------

describe("Waters of Duat (102159)", () => {
  function board(over: Partial<MinionState> = {}, hand: Array<{ id: string; name: string }> = []) {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, {
      clan: "Ministry",
      capacity: 5,
      blood: 5,
      ...over,
    });
    seatOf(state, "Alice").hand.push({ id: "wd", name: "Waters of Duat" }, ...hand);
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("puts a 1-capacity Ministry vampire into play with NO blood", () => {
    const { state, engine } = board();
    resolve(engine, state, "play:Waters of Duat");

    const token = find(state, "wd")!;
    expect(token).toBeDefined();
    expect(token.kind).toBe("vampire");
    expect(token.capacity).toBe(1);
    // "Follower of Set" is the Ministry — the legacy-name trap.
    expect(token.clan).toBe("Ministry");
    expect(token.blood).toBe(0);
    expect(token.locked).toBe(false);
    expect(token.inTorpor).toBe(false);
  });

  it("the token MUST HUNT — and that is p. 21, not new code", () => {
    const { state, engine } = board();
    resolve(engine, state, "play:Waters of Duat");
    // Answer the search with "find nothing" so the turn continues.
    if (engine.decision()?.window === "choice") {
      runTrace(engine, [["Alice", "choice:Waters of Duat:wd:searchDiscipline:none"]]);
    }

    // Back in the minion phase, a 0-blood vampire's only option is to
    // hunt — and no other minion may act until it does.
    expect(walkTo(engine, "hunt:wd")).toBe(true);
    const ids = optionIds(engine);
    expect(ids).toContain("hunt:wd");
    expect(ids.every((o) => o.startsWith("hunt:"))).toBe(true);
  });

  it("requires a Ministry with capacity 5 or more", () => {
    // Right clan, too young.
    const small = board({ capacity: 4 });
    expect(walkTo(small.engine, "play:Waters of Duat", 6)).toBe(false);
    // Right capacity, wrong clan.
    const wrongClan = board({ clan: "Brujah" });
    expect(walkTo(wrongClan.engine, "play:Waters of Duat", 6)).toBe(false);
  });

  it("a STERILE vampire cannot play it (p. 42), though nothing in the pool is sterile", () => {
    const ok = board();
    expect(walkTo(ok.engine, "play:Waters of Duat", 6)).toBe(true);
    const sterile = board({ sterile: true });
    expect(walkTo(sterile.engine, "play:Waters of Duat", 6)).toBe(false);
  });

  it("searches library, hand AND ash heap for a Discipline master", () => {
    const { state, engine } = board({}, [{ id: "h1", name: "Potence" }]);
    // The first library card is drawn as the replacement for the card
    // played (p. 7), so the ones under test sit behind a filler.
    seatOf(state, "Alice").library = [
      { id: "filler", name: "Conditioning" },
      { id: "l1", name: "Celerity" },
      { id: "l2", name: "Conditioning" },
    ];
    seatOf(state, "Alice").ashHeap = [{ id: "a1", name: "Dominate" }];
    resolve(engine, state, "play:Waters of Duat");

    const ids = optionIds(engine);
    expect(ids).toContain("choice:Waters of Duat:wd:searchDiscipline:library:l1");
    expect(ids).toContain("choice:Waters of Duat:wd:searchDiscipline:hand:h1");
    expect(ids).toContain("choice:Waters of Duat:wd:searchDiscipline:ashHeap:a1");
    // A non-Discipline card is not a legal find…
    expect(ids.some((o) => o.endsWith(":l2"))).toBe(false);
    // …and finding nothing is always legal (p. 48).
    expect(ids).toContain("choice:Waters of Duat:wd:searchDiscipline:none");
  });

  it("puts the found master ON the token, out of the ash heap, and shuffles", () => {
    const { state, engine } = board();
    seatOf(state, "Alice").library = [{ id: "l1", name: "Celerity" }];
    seatOf(state, "Alice").ashHeap = [{ id: "a1", name: "Dominate" }];
    resolve(engine, state, "play:Waters of Duat");
    runTrace(engine, [["Alice", "choice:Waters of Duat:wd:searchDiscipline:ashHeap:a1"]]);

    const token = find(state, "wd")!;
    expect(token.attached.some((p) => p.card.name === "Dominate")).toBe(true);
    expect(seatOf(state, "Alice").ashHeap!.some((c) => c.id === "a1")).toBe(false);
    // A Discipline master raises capacity by 1 and grants the level, and
    // the token reads them like any other vampire (derived traits).
    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
  });

  it("shuffles even when nothing is found (p. 14)", () => {
    const { state, engine } = board();
    seatOf(state, "Alice").library = [
      { id: "filler", name: "Conditioning" },
      { id: "l1", name: "Celerity" },
    ];
    resolve(engine, state, "play:Waters of Duat");
    runTrace(engine, [["Alice", "choice:Waters of Duat:wd:searchDiscipline:none"]]);

    expect(state.eventLog.some((e) => e.type === "LibraryShuffled")).toBe(true);
    // Declining takes nothing: the Celerity is still there (the filler
    // was drawn to replace the card played).
    expect(seatOf(state, "Alice").library).toHaveLength(1);
    expect(seatOf(state, "Alice").library[0]!.id).toBe("l1");
  });
});

// ---------------------------------------------------------------------------

describe("Childe of the Revolution (102246)", () => {
  function board(over: Partial<MinionState> = {}) {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, {
      title: "baron",
      clan: "Brujah",
      blood: 5,
      ...over,
    });
    seatOf(state, "Alice").hand.push({ id: "cr", name: "Childe of the Revolution" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("makes an ANARCH of the acting vampire's own clan", () => {
    const { state, engine } = board();
    resolve(engine, state, "play:Childe of the Revolution");

    const token = find(state, "cr")!;
    expect(token.clan).toBe("Brujah"); // the actor's clan, read once
    expect(token.sect).toBe("anarch");
    expect(token.capacity).toBe(1);
    expect(token.blood).toBe(0);
  });

  it("follows the actor's clan wherever it goes", () => {
    const { state, engine } = board({ clan: "Gangrel" });
    resolve(engine, state, "play:Childe of the Revolution");
    expect(find(state, "cr")!.clan).toBe("Gangrel");
  });

  it("requires a baron", () => {
    const withTitle = board();
    expect(walkTo(withTitle.engine, "play:Childe of the Revolution", 6)).toBe(true);
    const untitled = board({ title: null });
    expect(walkTo(untitled.engine, "play:Childe of the Revolution", 6)).toBe(false);
    const wrongTitle = board({ title: "prince" });
    expect(walkTo(wrongTitle.engine, "play:Childe of the Revolution", 6)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the token's card", () => {
  it("goes to the ash heap when the vampire is burned (p. 16)", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { clan: "Ministry", capacity: 5, blood: 5 });
    seatOf(state, "Alice").hand.push({ id: "wd", name: "Waters of Duat" });
    const engine = new VtesEngine(state, testRegistry);
    resolve(engine, state, "play:Waters of Duat");
    if (engine.decision()?.window === "choice") {
      runTrace(engine, [["Alice", "choice:Waters of Duat:wd:searchDiscipline:none"]]);
    }
    expect(find(state, "wd")).toBeDefined();

    engine.burnMinion("wd");

    expect(find(state, "wd")).toBeUndefined();
    // The card itself is a library card and belongs in its owner's ash
    // heap — which is what the self-attached entry is for.
    expect((seatOf(state, "Alice").ashHeap ?? []).some((c) => c.id === "wd")).toBe(true);
  });

  it("does NOT reach the ash heap when the minion is REMOVED from the game", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1")!, { clan: "Ministry", capacity: 5, blood: 5 });
    seatOf(state, "Alice").hand.push({ id: "wd", name: "Waters of Duat" });
    const engine = new VtesEngine(state, testRegistry);
    resolve(engine, state, "play:Waters of Duat");
    if (engine.decision()?.window === "choice") {
      runTrace(engine, [["Alice", "choice:Waters of Duat:wd:searchDiscipline:none"]]);
    }

    engine.removeMinionFromGame("wd");

    // "Removed from the game … cannot be retrieved or affected in any
    // way" (p. 16) — so it must NOT be sitting in a public, searchable
    // zone. This was a live bug until the token gate: Heartrender removes
    // itself and Split the Veil retrieves from the ash heap.
    expect(find(state, "wd")).toBeUndefined();
    expect((seatOf(state, "Alice").ashHeap ?? []).some((c) => c.id === "wd")).toBe(false);
  });

  it("a removed minion's EQUIPMENT is still burned to the ash heap (p. 16)", () => {
    const state = threeSeatGame();
    const v = find(state, "V1")!;
    v.attached.push({
      card: { id: "kv", name: "Kevlar Vest" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["equipment"],
      owner: "Alice",
    });
    const engine = new VtesEngine(state, testRegistry);

    engine.removeMinionFromGame("V1");

    expect((seatOf(state, "Alice").ashHeap ?? []).some((c) => c.id === "kv")).toBe(true);
  });
});
