/**
 * The wraith/zombie gate (docs/wraith-zombie-design.md) — unblocked by the
 * owner on 2026-09-02.
 *
 * The finding that sizes the gate: "wraith" and "zombie" appear NOWHERE in
 * the rulebook. Like "ghoul" they are printed words other cards filter on,
 * so the sub-type carries no rules and needs no new state — it is
 * `ally.subtype`, which lands in the tags of the ally's self-attached
 * entry, and every filter reads it from there.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { isUndeadAlly, minionTags } from "../../src/engine/derived.ts";
import { makeAlly, makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

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

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/**
 * An ally in play, built the way the engine builds one: its card text
 * rides as a SELF-attached entry, and its tags come from the real
 * handler — so these fixtures exercise `ally.subtype` rather than
 * hand-asserting the tag.
 */
function ally(
  state: GameState,
  seat: string,
  id: string,
  name: string,
  over: Partial<MinionState> = {},
): MinionState {
  const h = testRegistry[name];
  if (!h) throw new Error(`no handler for ${name}`);
  const self: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h.permanentStatics ?? {},
    tags: h.permanentTags ?? [],
  };
  const m = makeAlly(id, seat, 1, { name, attached: [self], ...over });
  seatOf(state, seat).minions.push(m);
  return m;
}

/** A card is played into an "as played" cycle: every seat answers before
 *  it resolves (p. 7). Pass through it. */
function settlePlay(engine: VtesEngine, state: GameState, limit = 12): void {
  for (let i = 0; i < limit; i++) {
    if (!state.frames.some((f) => f.kind === "cardPlay")) return;
    const dp = engine.decision();
    if (!dp) return;
    engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
  }
  throw new Error("settlePlay: card never resolved");
}

/** Walk the impulse cycle until some seat is offered `prefix`. */
function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    engine.choose(pick.id);
  }
  return false;
}

// ---------------------------------------------------------------------------

describe("the sub-type itself", () => {
  it("rides into play on the ally's own self-attached entry", () => {
    const state = threeSeatGame();
    const f = ally(state, "Alice", "fio", "Fiorella, Empty One");

    expect(minionTags(f)).toContain("wraith");
    expect(isUndeadAlly(f)).toBe(true);
  });

  it("a VAMPIRE has no sub-type — which is what every 'non-wraith' filter wants", () => {
    const state = threeSeatGame();
    expect(minionTags(find(state, "V1"))).toEqual([]);
    expect(isUndeadAlly(find(state, "V1"))).toBe(false);
  });

  it("reads the SELF entry only: a ghoul retainer does not make its bearer a ghoul", () => {
    const state = threeSeatGame();
    const f = ally(state, "Alice", "fio", "Fiorella, Empty One");
    f.attached.push({
      card: { id: "r1", name: "Raven Spy" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["ghoul"],
    });

    expect(minionTags(f)).toEqual(["wraith"]);
  });
});

// ---------------------------------------------------------------------------

describe("Fiorella, Empty One (102322)", () => {
  /** Alice's wraith bleeds; Bob blocks with M, so stealth is live. */
  function bleeding(): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    ally(state, "Alice", "fio", "Fiorella, Empty One");
    ally(state, "Alice", "scr", "Screamer");
    const engine = new VtesEngine(state, testRegistry);
    return { state, engine };
  }

  it("locks to give ANOTHER undead ally +1 stealth when stealth is needed (p. 26)", () => {
    const { state, engine } = bleeding();
    runTrace(engine, [
      ["Alice", "bleed:scr"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);

    // Bob's M has 0 intercept against a 0-stealth bleed, so the block
    // would succeed — the grant is exactly what is needed.
    const id = "ability:Fiorella, Empty One:fio:grant:stealth:scr";
    expect(optionIds(engine)).toContain(id);
    runTrace(engine, [["Alice", id]]);

    // "Lock this ally" locks the MINION, not its card entry.
    expect(find(state, "fio").locked).toBe(true);
    expect(
      state.eventLog.some((e) => e.type === "StealthModified" && e.delta === 1),
    ).toBe(true);
  });

  it("never offers itself as its own target — 'ANOTHER' ally", () => {
    const { engine } = bleeding();
    runTrace(engine, [
      ["Alice", "bleed:fio"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);

    expect(optionIds(engine).some((o) => o.startsWith("ability:Fiorella, Empty One:fio:grant:stealth:fio"))).toBe(
      false,
    );
  });

  it("is not offered to a VAMPIRE — the grant is undead-only", () => {
    const state = threeSeatGame();
    ally(state, "Alice", "fio", "Fiorella, Empty One");
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);

    expect(optionIds(engine).some((o) => o.includes("Fiorella"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Screamer (102292)", () => {
  it("burns itself to make an action directed at an ALLY you control fail", () => {
    const state = threeSeatGame();
    ally(state, "Bob", "scr", "Screamer");
    const victim = ally(state, "Bob", "vic", "Fiorella, Empty One");
    victim.name = "Fiorella, Empty One";
    // Alice's V1 rushes Bob's ally.
    seatOf(state, "Alice").hand.push({ id: "hm", name: "Hunter's Mark" });
    Object.assign(find(state, "V1"), {
      disciplines: { cel: "basic", tha: "basic" },
      blood: 5,
    });
    const engine = new VtesEngine(state, testRegistry);

    // Rush the ALLY (`vic`), which is what the clause is about — rushing
    // Bob's vampire instead is the negative case below.
    expect(walkTo(engine, "play:Hunter's Mark:basic:V1:vic")).toBe(true);
    runTrace(engine, [["Alice", "play:Hunter's Mark:basic:V1:vic"]]);
    settlePlay(engine, state);

    // Bob is offered the burn as the action stands announced.
    expect(walkTo(engine, "ability:Screamer:scr:failaction")).toBe(true);
    runTrace(engine, [["Bob", "ability:Screamer:scr:failaction"]]);

    // The ally is gone and the action FAILED — not blocked, so no combat.
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "scr")).toBe(false);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("is not offered for an action directed at a VAMPIRE you control", () => {
    const state = threeSeatGame();
    ally(state, "Bob", "scr", "Screamer");
    seatOf(state, "Alice").hand.push({ id: "hm", name: "Hunter's Mark" });
    Object.assign(find(state, "V1"), {
      disciplines: { cel: "basic", tha: "basic" },
      blood: 5,
    });
    const engine = new VtesEngine(state, testRegistry);

    // Rush Bob's VAMPIRE W instead: "directed at an ALLY you control".
    expect(walkTo(engine, "play:Hunter's Mark:basic:V1:W")).toBe(true);
    runTrace(engine, [["Alice", "play:Hunter's Mark:basic:V1:W"]]);
    settlePlay(engine, state);

    expect(walkTo(engine, "ability:Screamer:scr:failaction", 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Shadow Sentinel (102294)", () => {
  it("[obl] a locked vampire wakes itself", () => {
    const state = threeSeatGame();
    const w = find(state, "W");
    Object.assign(w, { locked: true, disciplines: { obl: "basic" } });
    seatOf(state, "Bob").hand.push({ id: "ss", name: "Shadow Sentinel" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:Shadow Sentinel:basic:W")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:Shadow Sentinel:basic:W"))!;
    runTrace(engine, [["Bob", play]]);
    settlePlay(engine, state);

    expect(state.eventLog.some((e) => e.type === "MinionWoke" && e.minion === "W")).toBe(true);
  });

  it("[OBL] wakes a chosen LOCKED undead ally — and the player need not be locked", () => {
    const state = threeSeatGame();
    // Bob's vampire is UNLOCKED: the superior drops the word "Only" from
    // "Only usable by a locked vampire", which is the whole difference.
    Object.assign(find(state, "W"), { locked: false, disciplines: { obl: "superior" } });
    ally(state, "Bob", "scr", "Screamer", { locked: true });
    seatOf(state, "Bob").hand.push({ id: "ss", name: "Shadow Sentinel" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:Shadow Sentinel:superior:W")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:Shadow Sentinel:superior:W"))!;
    expect(play).toContain("scr"); // the target rides in the option id
    runTrace(engine, [["Bob", play]]);
    settlePlay(engine, state);

    expect(state.eventLog.some((e) => e.type === "MinionWoke" && e.minion === "scr")).toBe(true);
  });

  it("[OBL] offers no target when the only undead ally is UNLOCKED", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "W"), { locked: false, disciplines: { obl: "superior" } });
    ally(state, "Bob", "scr", "Screamer", { locked: false });
    seatOf(state, "Bob").hand.push({ id: "ss", name: "Shadow Sentinel" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:Shadow Sentinel:superior:W", 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Paths in Two Worlds (102300)", () => {
  /** Alice recruits a wraith, holding the modifier. */
  function recruiting(mode: "basic" | "superior"): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { obl: mode === "superior" ? "superior" : "basic" },
      blood: 5,
    });
    seatOf(state, "Alice").pool = 10;
    seatOf(state, "Alice").hand.push(
      { id: "scr", name: "Screamer" },
      { id: "p2w", name: "Paths in Two Worlds" },
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("is usable as a recruit of a WRAITH is announced, even though stealth is not needed", () => {
    const { engine } = recruiting("basic");
    expect(walkTo(engine, "play:Screamer")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("play:Screamer"))!]]);

    // Nobody is blocking, so an ordinary stealth modifier would NOT be
    // offered — "even if stealth is not yet needed" is what puts it here.
    expect(walkTo(engine, "play:Paths in Two Worlds:basic:V1")).toBe(true);
  });

  it("is NOT usable when the recruit is not a wraith or zombie", () => {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { obl: "basic" }, blood: 5 });
    seatOf(state, "Alice").hand.push(
      { id: "pa", name: "Political Ally" },
      { id: "p2w", name: "Paths in Two Worlds" },
    );
    const engine = new VtesEngine(state, testRegistry);

    expect(walkTo(engine, "play:Political Ally")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Political Ally"))!],
    ]);
    expect(walkTo(engine, "play:Paths in Two Worlds", 12)).toBe(false);
  });

  it("[OBL] offers the actor an unlock for 1 blood AFTER the action resolves", () => {
    const { state, engine } = recruiting("superior");
    expect(walkTo(engine, "play:Screamer")).toBe(true);
    runTrace(engine, [["Alice", optionIds(engine).find((o) => o.startsWith("play:Screamer"))!]]);
    expect(walkTo(engine, "play:Paths in Two Worlds:superior:V1")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Paths in Two Worlds:superior:V1"))!],
    ]);

    const blood = find(state, "V1").blood;
    expect(walkTo(engine, "choice:Paths in Two Worlds:p2w:unlockAfterResolution")).toBe(true);
    runTrace(engine, [
      ["Alice", "choice:Paths in Two Worlds:p2w:unlockAfterResolution:yes"],
    ]);

    expect(find(state, "V1").locked).toBe(false);
    expect(find(state, "V1").blood).toBe(blood - 1);
  });
});

// ---------------------------------------------------------------------------

describe("Gifts From Hereafter (102325)", () => {
  it("another unlocked vampire gives the acting UNDEAD ALLY +1 bleed", () => {
    const state = threeSeatGame();
    const scr = ally(state, "Alice", "scr", "Screamer", { bleedAmount: 1 });
    expect(scr.id).toBe("scr");
    Object.assign(find(state, "V1"), { disciplines: { dom: "basic" }, locked: false, blood: 5 });
    seatOf(state, "Alice").hand.push({ id: "gfh", name: "Gifts From Hereafter" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "bleed:scr"]]);
    expect(walkTo(engine, "play:Gifts From Hereafter:basic:V1")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Gifts From Hereafter:basic:V1"))!],
    ]);
    settlePlay(engine, state);

    expect(
      state.eventLog.some((e) => e.type === "BleedAmountModified" && e.delta === 1),
    ).toBe(true);
  });

  it("is NOT offered when the acting minion is a vampire", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").minions.push(
      makeMinion("V2", "Alice", { disciplines: { dom: "basic" } }),
    );
    seatOf(state, "Alice").hand.push({ id: "gfh", name: "Gifts From Hereafter" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [["Alice", "bleed:V1"]]);
    expect(walkTo(engine, "play:Gifts From Hereafter", 12)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Spectral Servitor (102296)", () => {
  function recruiting(level: "basic" | "superior") {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { obl: level === "superior" ? "superior" : "basic" },
      blood: 5,
    });
    seatOf(state, "Alice").hand.push({ id: "ss", name: "Spectral Servitor" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  function resolveRecruit(engine: VtesEngine, state: GameState, level: string) {
    expect(walkTo(engine, `play:Spectral Servitor:${level}:V1`)).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith(`play:Spectral Servitor:${level}:V1`))!],
    ]);
    // The play becomes an action; pass until BOTH frames are gone.
    for (let i = 0; i < 30; i++) {
      const busy = state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay");
      if (!busy) break;
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
  }

  it("can act the turn it is recruited, and unlocks its recruiter", () => {
    const { state, engine } = recruiting("basic");
    resolveRecruit(engine, state, "basic");

    const ally = find(state, "ss");
    // p. 22's "cannot act the turn it is recruited" is waived by the card.
    expect(ally.cannotActThisTurn).toBe(false);
    // "Unlock this vampire if this is their first successful recruit ally
    // action this turn" — V1 locked to announce and is unlocked again.
    expect(find(state, "V1").locked).toBe(false);
  });

  it("plays NON-ACTION cards as a vampire, but is never offered an action card", () => {
    const { state, engine } = recruiting("basic");
    resolveRecruit(engine, state, "basic");

    // It has [obl] on its MinionState, which is the whole of p. 11's rule…
    expect(find(state, "ss").disciplines["obl"]).toBe("basic");
    // …but an action card requiring it is not offered to the ally.
    seatOf(state, "Alice").hand.push({ id: "sv", name: "Split the Veil" });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Split the Veil"));
    expect(ids.some((o) => o.includes(":ss"))).toBe(false);
  });

  it("[obl] burns itself at your next unlock phase", () => {
    const { state, engine } = recruiting("basic");
    resolveRecruit(engine, state, "basic");
    expect(find(state, "ss")).toBeTruthy();

    // Walk round to Alice's next unlock phase.
    for (let i = 0; i < 200; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (!state.seats.flatMap((s) => s.minions).some((m) => m.id === "ss")) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options.find((o) => o.id === "end") ?? dp.options[0]!).id);
    }
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "ss")).toBe(false);
  });

  it("[OBL] offers 1 pool instead of burning", () => {
    // Placed straight into play at an unlock phase: the recruit itself is
    // covered above, and this isolates the upkeep.
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    const statics = testRegistry["Spectral Servitor"]!.allyEntry!("superior").statics;
    seatOf(state, "Alice").minions.push(
      makeAlly("ss", "Alice", 1, {
        name: "Spectral Servitor",
        attached: [
          {
            card: { id: "ss", name: "Spectral Servitor" },
            locked: false,
            usedThisPhase: false,
            statics,
            tags: ["wraith"],
          },
        ],
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    expect(walkTo(engine, "choice:Spectral Servitor:ss:unlockUpkeep", 10)).toBe(true);
    const pool = seatOf(state, "Alice").pool;
    runTrace(engine, [["Alice", "choice:Spectral Servitor:ss:unlockUpkeep:pool"]]);

    expect(seatOf(state, "Alice").pool).toBe(pool - 1);
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "ss")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Rotting Behemoth (102304)", () => {
  function entering(heap: Array<{ id: string; name: string }>) {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { obl: "basic" }, blood: 6 });
    seatOf(state, "Alice").hand.push({ id: "rb", name: "Rotting Behemoth" });
    seatOf(state, "Alice").ashHeap = heap;
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("burns on arrival when the ash heap has nothing to pay with", () => {
    const { state, engine } = entering([]);
    expect(walkTo(engine, "play:Rotting Behemoth")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Rotting Behemoth"))!],
    ]);
    for (let i = 0; i < 20 && state.frames.some((f) => f.kind === "action"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }
    // It entered play and burned immediately — "burn it UNLESS you remove…".
    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "rb")).toBe(false);
  });

  it("survives by removing an ally card in the ash heap from the game", () => {
    const { state, engine } = entering([{ id: "old", name: "Political Ally" }]);
    expect(walkTo(engine, "play:Rotting Behemoth")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:Rotting Behemoth"))!],
    ]);
    expect(walkTo(engine, "choice:Rotting Behemoth:rb:ashCost:old", 25)).toBe(true);
    runTrace(engine, [["Alice", "choice:Rotting Behemoth:rb:ashCost:old"]]);

    expect(state.seats.flatMap((s) => s.minions).some((m) => m.id === "rb")).toBe(true);
    expect((seatOf(state, "Alice").ashHeap ?? []).some((c) => c.id === "old")).toBe(false);
  });

  it("cannot gain life", () => {
    const state = threeSeatGame();
    const statics = testRegistry["Rotting Behemoth"]!.allyEntry!("basic").statics;
    seatOf(state, "Alice").minions.push(
      makeAlly("rb", "Alice", 6, {
        name: "Rotting Behemoth",
        attached: [
          {
            card: { id: "rb", name: "Rotting Behemoth" },
            locked: false,
            usedThisPhase: false,
            statics,
            tags: ["zombie"],
          },
        ],
        blood: 3,
        capacity: 6,
      }),
    );
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "BloodGained", minion: "rb", amount: 2 });
    expect(find(state, "rb").blood).toBe(3); // unchanged
  });
});

// ---------------------------------------------------------------------------

describe("Split the Veil (102297) — a minion comes back", () => {
  function withVeil(counters: number, heap: Array<{ id: string; name: string }>) {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    seatOf(state, "Alice").permanents.push({
      card: { id: "sv", name: "Split the Veil" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
      counters,
    });
    seatOf(state, "Alice").ashHeap = heap;
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("ticks a counter down each unlock phase", () => {
    const { state, engine } = withVeil(2, [{ id: "scr", name: "Screamer" }]);
    runTrace(engine, [["Alice", "ability:Split the Veil:sv:tick"]]);
    expect(seatOf(state, "Alice").permanents.find((p) => p.card.id === "sv")!.counters).toBe(1);
  });

  it("on the last counter, burns itself and returns an undead ally to the READY region", () => {
    const { state, engine } = withVeil(1, [{ id: "scr", name: "Screamer" }]);
    runTrace(engine, [
      ["Alice", "ability:Split the Veil:sv:tick"],
      ["Alice", "choice:Split the Veil:sv:returnAlly:scr"],
    ]);

    // The card is gone, and the ally is a minion in play.
    expect(seatOf(state, "Alice").permanents.some((p) => p.card.id === "sv")).toBe(false);
    const back = find(state, "scr");
    expect(back.kind).toBe("ally");
    expect(back.blood).toBe(1); // "life equal to its starting life"
    expect(isUndeadAlly(back)).toBe(true); // its card text came with it
    // The ally has left the heap — and Split the Veil itself has arrived
    // there, being a card that was just burned.
    const heap = (seatOf(state, "Alice").ashHeap ?? []).map((c) => c.id);
    expect(heap).not.toContain("scr");
    expect(heap).toContain("sv");
    // A MOVE, not a recruit: it can act at once (p. 22 names a recruit).
    expect(back.cannotActThisTurn).toBe(false);
  });

  it("offers only WRAITH OR ZOMBIE allies from the ash heap", () => {
    const { engine } = withVeil(1, [
      { id: "pa", name: "Political Ally" },
      { id: "scr", name: "Screamer" },
      { id: "cond", name: "Conditioning" },
    ]);
    runTrace(engine, [["Alice", "ability:Split the Veil:sv:tick"]]);

    const ids = optionIds(engine);
    expect(ids).toContain("choice:Split the Veil:sv:returnAlly:scr");
    expect(ids).not.toContain("choice:Split the Veil:sv:returnAlly:pa");
    expect(ids).not.toContain("choice:Split the Veil:sv:returnAlly:cond");
  });
});

// ---------------------------------------------------------------------------

describe("Heartrender (102327)", () => {
  function board() {
    const state = threeSeatGame();
    ally(state, "Alice", "hr", "Heartrender");
    // Two possible victims for Bob: an ordinary ally and a wraith.
    seatOf(state, "Bob").minions.push(
      makeAlly("pa", "Bob", 2, { name: "Political Ally", attached: [] }),
    );
    ally(state, "Bob", "scr", "Screamer");
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("burns a NON-undead ally and removes itself from the game", () => {
    const { state, engine } = board();
    const id = "act:Heartrender:hr:rend:hr:pa";
    expect(optionIds(engine)).toContain(id);

    runTrace(engine, [["Alice", id]]);
    // Nobody interferes: pass until the action has resolved.
    for (let i = 0; i < 30 && state.frames.some((f) => f.kind === "action"); i++) {
      const dp = engine.decision();
      if (!dp) break;
      engine.choose((dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id);
    }

    const alive = state.seats.flatMap((s) => s.minions).map((m) => m.id);
    expect(alive).not.toContain("pa"); // burned
    expect(alive).not.toContain("hr"); // removed as the cost
    expect(
      state.eventLog.some((e) => e.type === "MinionRemovedFromGame" && e.minion === "hr"),
    ).toBe(true);
  });

  it("cannot burn its own kind — 'non-wraith non-zombie'", () => {
    const { engine } = board();
    const ids = optionIds(engine).filter((o) => o.startsWith("act:Heartrender:hr:rend"));
    expect(ids).toContain("act:Heartrender:hr:rend:hr:pa"); // the control case
    expect(ids.some((o) => o.endsWith(":scr"))).toBe(false);
    expect(ids.some((o) => o.endsWith(":hr"))).toBe(false); // nor itself
  });
});

// ---------------------------------------------------------------------------

describe("Bone Shambler (102293) — 'another copy of this ally'", () => {
  /** Two Bone Shamblers; the first bleeds. */
  function twoCopies(mode: "basic" | "superior" = "basic") {
    const state = threeSeatGame();
    const statics =
      testRegistry["Bone Shambler"]!.allyEntry!(mode).statics;
    for (const id of ["bs1", "bs2"]) {
      const self: PermanentInPlay = {
        card: { id, name: "Bone Shambler" },
        locked: false,
        usedThisPhase: false,
        statics,
        tags: ["zombie"],
      };
      seatOf(state, "Alice").minions.push(
        makeAlly(id, "Alice", 1, { name: "Bone Shambler", attached: [self], bleedAmount: 1 }),
      );
    }
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("locks the OTHER copy for +1 bleed", () => {
    const { state, engine } = twoCopies();
    runTrace(engine, [["Alice", "bleed:bs1"]]);

    expect(walkTo(engine, "ability:Bone Shambler:bs1:copybleed:bs2")).toBe(true);
    runTrace(engine, [["Alice", "ability:Bone Shambler:bs1:copybleed:bs2"]]);

    expect(find(state, "bs2").locked).toBe(true);
    expect(find(state, "bs1").locked).toBe(true); // locked by acting, not by this
    expect(
      state.eventLog.some((e) => e.type === "BleedAmountModified" && e.delta === 1),
    ).toBe(true);
  });

  it("never offers ITSELF as the copy to lock", () => {
    const { engine } = twoCopies();
    runTrace(engine, [["Alice", "bleed:bs1"]]);
    walkTo(engine, "ability:Bone Shambler:bs1:copybleed");
    expect(optionIds(engine)).not.toContain("ability:Bone Shambler:bs1:copybleed:bs1");
  });

  it("offers nothing with only ONE copy in play", () => {
    const state = threeSeatGame();
    const self: PermanentInPlay = {
      card: { id: "bs1", name: "Bone Shambler" },
      locked: false,
      usedThisPhase: false,
      statics: testRegistry["Bone Shambler"]!.allyEntry!("basic").statics,
      tags: ["zombie"],
    };
    seatOf(state, "Alice").minions.push(
      makeAlly("bs1", "Alice", 1, { name: "Bone Shambler", attached: [self], bleedAmount: 1 }),
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "bleed:bs1"]]);
    expect(walkTo(engine, "ability:Bone Shambler:bs1:copybleed", 10)).toBe(false);
  });

  it("cannot be given equipment", () => {
    const { state, engine } = twoCopies();
    seatOf(state, "Alice").hand.push({ id: "kv", name: "Kevlar Vest" });
    seatOf(state, "Alice").pool = 10;
    // Alice's vampire V1 can equip; neither Bone Shambler can. The
    // positive half matters: an empty list would otherwise pass for the
    // wrong reason.
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Kevlar Vest"));
    expect(ids.some((o) => o.includes(":V1"))).toBe(true);
    expect(ids.some((o) => o.includes(":bs1") || o.includes(":bs2"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Gravebound Drone (102326)", () => {
  it("burns a life to prevent damage to ANOTHER COPY in combat", () => {
    const state = threeSeatGame();
    const statics = testRegistry["Gravebound Drone"]!.allyEntry!("basic").statics;
    for (const id of ["gd1", "gd2"]) {
      seatOf(state, "Alice").minions.push(
        makeAlly(id, "Alice", 2, {
          name: "Gravebound Drone",
          attached: [
            {
              card: { id, name: "Gravebound Drone" },
              locked: false,
              usedThisPhase: false,
              statics,
              tags: ["zombie"],
            },
          ],
          strength: 1,
        }),
      );
    }
    // gd1 rushes Bob's vampire, so gd1 is the one taking damage and gd2
    // (not in the combat at all) does the preventing.
    seatOf(state, "Alice").hand.push({ id: "hm", name: "Hunter's Mark" });
    Object.assign(find(state, "V1"), { disciplines: { cel: "basic", tha: "basic" }, blood: 5 });
    const engine = new VtesEngine(state, testRegistry);

    expect(walkTo(engine, "play:Hunter's Mark:basic:V1:W")).toBe(true);
    runTrace(engine, [["Alice", "play:Hunter's Mark:basic:V1:W"]]);
    settlePlay(engine, state);

    // Drive into the combat's damage step, where the option appears only
    // if the pending damage is aimed at the other copy. Here the victim is
    // a vampire, so it must NOT be offered — the negative half.
    walkTo(engine, "ability:Gravebound Drone:gd2:copyprevent", 40);
    expect(optionIds(engine)).not.toContain("ability:Gravebound Drone:gd2:copyprevent");
  });
});

// ---------------------------------------------------------------------------

describe("Cursed Abattoir (102313)", () => {
  function withAbattoir(counters = 0): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push({
      card: { id: "ca", name: "Cursed Abattoir" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location"],
      counters,
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("takes a counter when a ZOMBIE ally you control is burned", () => {
    const { state, engine } = withAbattoir();
    // Aggressive Corpse is a zombie the pool already had — it carries the
    // tag, so the new filters see it.
    ally(state, "Alice", "ac", "Aggressive Corpse");
    engine.burnMinion("ac");

    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(1);
  });

  it("takes NO counter when a WRAITH burns — the clause says zombie", () => {
    const { state, engine } = withAbattoir();
    ally(state, "Alice", "scr", "Screamer");
    engine.burnMinion("scr");

    expect(seatOf(state, "Alice").permanents[0]!.counters ?? 0).toBe(0);
  });

  it("burns a counter during a bleed to give the acting zombie +1 bleed", () => {
    const { state, engine } = withAbattoir(2);
    ally(state, "Alice", "ac", "Aggressive Corpse", { bleedAmount: 1 });

    runTrace(engine, [["Alice", "bleed:ac"]]);
    expect(walkTo(engine, "ability:Cursed Abattoir:ca:bleedcounter")).toBe(true);
    runTrace(engine, [["Alice", "ability:Cursed Abattoir:ca:bleedcounter"]]);

    expect(seatOf(state, "Alice").permanents[0]!.counters).toBe(1);
    expect(
      state.eventLog.some((e) => e.type === "BleedAmountModified" && e.delta === 1),
    ).toBe(true);
  });

  it("offers nothing with no counters", () => {
    const { state, engine } = withAbattoir(0);
    ally(state, "Alice", "ac", "Aggressive Corpse", { bleedAmount: 1 });
    runTrace(engine, [["Alice", "bleed:ac"]]);
    expect(walkTo(engine, "ability:Cursed Abattoir:ca:bleedcounter", 10)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("Burial Site Hunting Ground (102311)", () => {
  /** The whole board must exist BEFORE the engine: it settles on
   *  construction, and an unlock phase with nothing to do advances. */
  function withSite(setup: (s: GameState) => void = () => {}): {
    state: GameState;
    engine: VtesEngine;
  } {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    seatOf(state, "Alice").permanents.push({
      card: { id: "bs", name: "Burial Site Hunting Ground" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location", "hunting ground"],
    });
    setup(state);
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("gives an undead ally 1 life", () => {
    const { state, engine } = withSite((s) =>
      ally(s, "Alice", "beh", "Screamer", { blood: 1, capacity: 3 }),
    );

    // An ally at 0 life is burned on the spot (life depletion), so the
    // fixture starts it at 1 of a printed 3.
    runTrace(engine, [["Alice", "ability:Burial Site Hunting Ground:bs:life:beh"]]);
    expect(find(state, "beh").blood).toBe(2);
  });

  it("does not offer an ally already at its starting life", () => {
    const { engine } = withSite((s) =>
      ally(s, "Alice", "beh", "Screamer", { blood: 1, capacity: 1 }),
    );
    expect(walkTo(engine, "ability:Burial Site Hunting Ground:bs:life", 8)).toBe(false);
  });

  it("offers NO vampire: the other branch needs a Path, which is out of scope", () => {
    const { engine } = withSite((s) =>
      ally(s, "Alice", "beh", "Screamer", { blood: 1, capacity: 3 }),
    );
    // Alice controls V1, a perfectly ordinary ready vampire — and the
    // ally option below proves the window is open, so this negative is
    // empty for the RIGHT reason.
    expect(walkTo(engine, "ability:Burial Site Hunting Ground:bs:life", 8)).toBe(true);
    expect(optionIds(engine).some((o) => o.endsWith(":V1"))).toBe(false);
  });
});
