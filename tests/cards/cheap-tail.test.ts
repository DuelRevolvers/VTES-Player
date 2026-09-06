/**
 * The cheap tail (docs/cheap-tail-design.md) — six cards chosen by the
 * LEDGER rather than by a mechanism: every one had a cut-list row in
 * docs/partial-support.md saying it was one clause away.
 *
 * Garibaldi-Meucci Museum (100809), Vagabond Mystic (102087),
 * Underbridge Stray (102065), Voracious Vermin (102266), Heart of
 * Nizchetus (100903), True Love's Face (102041).
 */

import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
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

function seatOf(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

function walkTo(engine: VtesEngine, prefix: string, limit = 60): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
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

/** An ally already in play, with its card text as a self-attached entry. */
function allyInPlay(
  state: GameState,
  seat: string,
  id: string,
  name: string,
  life: number,
  strength = 0,
  over: Partial<MinionState> = {},
): MinionState {
  const stats = testRegistry[name]?.allyEntry?.(null);
  const m = makeAlly(id, seat, life, { name, strength, bleedAmount: 0, ...over });
  m.attached.push({
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: stats?.statics ?? {},
    tags: stats?.tags ?? [],
  });
  seatOf(state, seat).minions.push(m);
  return m;
}

/** Point the turn frame at `seat`'s unlock phase, past the sweep. */
function atUnlockAbilities(state: GameState, seat: string): VtesEngine {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn frame");
  tf.seat = seat;
  tf.phase = "unlock";
  tf.unlockDone = true;
  tf.unlockAbilitiesDone = false;
  return new VtesEngine(state, testRegistry);
}

// ---------------------------------------------------------------------------

describe("Garibaldi-Meucci Museum (100809)", () => {
  it("swaps a hand card for an ANARCH-requiring card in the ash heap, for 1 pool", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(entry("gm", "Garibaldi-Meucci Museum"));
    seatOf(state, "Alice").hand = [{ id: "h1", name: "Conditioning" }];
    seatOf(state, "Alice").ashHeap = [
      { id: "a1", name: "Protection Racket" }, // Requires an Anarch
      { id: "a2", name: "Govern the Unaligned" }, // requires nothing
    ];
    const engine = atUnlockAbilities(state, "Alice");
    const ids = optionIds(engine).filter((o) => o.includes(":exchange:"));
    expect(ids).toEqual(["ability:Garibaldi-Meucci Museum:gm:exchange:h1:a1"]);

    runTrace(engine, [["Alice", ids[0]!]]);
    expect(seatOf(state, "Alice").pool).toBe(9);
    expect(seatOf(state, "Alice").hand.map((c) => c.name)).toEqual(["Protection Racket"]);
    // An EXCHANGE: the hand card goes to the heap, no replacement drawn.
    expect((seatOf(state, "Alice").ashHeap ?? []).map((c) => c.name).sort()).toEqual([
      "Conditioning",
      "Govern the Unaligned",
    ]);
    expect(seatOf(state, "Alice").permanents[0]!.locked).toBe(true);
  });

  it("NEGATIVE SPACE: not offered with no pool, and not on another seat's turn", () => {
    const broke = threeSeatGame();
    seatOf(broke, "Alice").permanents.push(entry("gm", "Garibaldi-Meucci Museum"));
    seatOf(broke, "Alice").hand = [{ id: "h1", name: "Conditioning" }];
    seatOf(broke, "Alice").ashHeap = [{ id: "a1", name: "Protection Racket" }];
    seatOf(broke, "Alice").pool = 0;
    expect(optionIds(atUnlockAbilities(broke, "Alice")).some((o) => o.includes(":exchange:"))).toBe(
      false,
    );

    // "During YOUR unlock phase" — the 2026-08-02 bug's rule.
    const other = threeSeatGame();
    seatOf(other, "Alice").permanents.push(entry("gm", "Garibaldi-Meucci Museum"));
    seatOf(other, "Alice").hand = [{ id: "h1", name: "Conditioning" }];
    seatOf(other, "Alice").ashHeap = [{ id: "a1", name: "Protection Racket" }];
    expect(optionIds(atUnlockAbilities(other, "Bob")).some((o) => o.includes(":exchange:"))).toBe(
      false,
    );
  });

  it("ends a combat between two Anarchs when one is yours", () => {
    // Bob holds the Museum AND the blocking Anarch, so both combatants
    // are Anarchs and one is his. (A bleed is directed at the prey, so
    // only Bob may block Alice.)
    const state = threeSeatGame();
    seatOf(state, "Bob").permanents.push(entry("gm", "Garibaldi-Meucci Museum"));
    Object.assign(find(state, "V1"), { sect: "anarch" });
    Object.assign(find(state, "M"), { sect: "anarch" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block → combat
    ]);
    expect(combat(state)).toBeDefined();
    expect(walkTo(engine, "ability:Garibaldi-Meucci Museum:gm:endcombat")).toBe(true);
    runTrace(engine, [["Bob", "ability:Garibaldi-Meucci Museum:gm:endcombat"]]);
    // End of Round still runs (p. 32), so drain to the frame's exit.
    for (let i = 0; i < 30 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(combat(state)).toBeUndefined();
  });

  it("NEGATIVE SPACE: not offered when only ONE combatant is an Anarch", () => {
    const state = threeSeatGame();
    seatOf(state, "Alice").permanents.push(entry("gm", "Garibaldi-Meucci Museum"));
    Object.assign(find(state, "V1"), { sect: "anarch" }); // M is not
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(combat(state)).toBeDefined();
    expect(walkTo(engine, "ability:Garibaldi-Meucci Museum:gm:endcombat", 20)).toBe(false);
  });
});

describe("Vagabond Mystic (102087)", () => {
  it("locks to add 1 life to a wounded ally, and only a wounded one", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "VM", "Vagabond Mystic", 2);
    const hurt = allyInPlay(state, "Alice", "HURT", "Political Ally", 1);
    hurt.capacity = 3; // starting life 3, currently 1
    allyInPlay(state, "Alice", "FULL", "Political Ally", 2).capacity = 2;
    const engine = new VtesEngine(state, testRegistry);
    const ids = optionIds(engine).filter((o) => o.includes("Vagabond Mystic:VM:heal:"));
    // "…who has FEWER life than its starting life": HURT yes, FULL no.
    expect(ids).toContain("ability:Vagabond Mystic:VM:heal:HURT");
    expect(ids).not.toContain("ability:Vagabond Mystic:VM:heal:FULL");
    // It may heal itself: it is an ally the controller controls, and at
    // 2 of 2 it is full, so it is not offered — the control case.
    expect(ids).not.toContain("ability:Vagabond Mystic:VM:heal:VM");

    runTrace(engine, [["Alice", "ability:Vagabond Mystic:VM:heal:HURT"]]);
    expect(find(state, "HURT").blood).toBe(2);
    // An ally IS a minion, so "lock this ally" locks the minion.
    expect(find(state, "VM").locked).toBe(true);
  });

  it("CANNOT BLOCK VAMPIRES, but can still block an ally", () => {
    // One direction only, and the positive half is the control case that
    // stops this passing because the Mystic cannot block at all.
    const vampireActs = threeSeatGame();
    allyInPlay(vampireActs, "Bob", "VM", "Vagabond Mystic", 2);
    const e1 = new VtesEngine(vampireActs, testRegistry);
    runTrace(e1, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    const blocks = optionIds(e1).filter((o) => o.startsWith("block:"));
    expect(blocks).toContain("block:M"); // Bob's vampire may block
    expect(blocks).not.toContain("block:VM");

    const allyActs = threeSeatGame();
    allyInPlay(allyActs, "Bob", "VM", "Vagabond Mystic", 2);
    allyInPlay(allyActs, "Alice", "AA", "Political Ally", 2, 0, { bleedAmount: 1 });
    const e2 = new VtesEngine(allyActs, testRegistry);
    runTrace(e2, [
      ["Alice", "bleed:AA"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
    ]);
    expect(optionIds(e2).filter((o) => o.startsWith("block:"))).toContain("block:VM");
  });
});

describe("Underbridge Stray (102065)", () => {
  it("its two modes differ only in printed stats", () => {
    expect(testRegistry["Underbridge Stray"]!.allyEntry?.("basic")).toMatchObject({
      life: 1,
      strength: 0,
    });
    expect(testRegistry["Underbridge Stray"]!.allyEntry?.("superior")).toMatchObject({
      life: 2,
      strength: 1,
    });
  });

  it("burns 1 life to give a minion you control a press", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Alice", "US", "Underbridge Stray", 2, 1);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Underbridge Stray:US:press:V1")).toBe(true);
    runTrace(engine, [["Alice", "ability:Underbridge Stray:US:press:V1"]]);
    expect(find(state, "US").blood).toBe(1);
  });

  it("burns itself to unlock a minion during an action directed AT YOU", () => {
    const state = threeSeatGame();
    const stray = allyInPlay(state, "Bob", "US", "Underbridge Stray", 2, 1);
    expect(stray).toBeDefined();
    find(state, "M").locked = true; // a locked minion to wake up
    const engine = new VtesEngine(state, testRegistry);
    // Alice bleeds Bob — a DIRECTED action at Bob.
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const id = "ability:Underbridge Stray:US:burnunlock:M";
    expect(walkTo(engine, id)).toBe(true);
    runTrace(engine, [["Bob", id]]);
    expect(find(state, "M").locked).toBe(false);
    expect(maybe(state, "US")).toBeUndefined(); // spent
  });

  it("NEGATIVE SPACE: not offered on an UNDIRECTED action", () => {
    const state = threeSeatGame();
    allyInPlay(state, "Bob", "US", "Underbridge Stray", 2, 1);
    find(state, "M").locked = true;
    const engine = new VtesEngine(state, testRegistry);
    // A hunt is undirected, so nothing is aimed at Bob.
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:Underbridge Stray:US:burnunlock:", 20)).toBe(false);
  });

  it("NEGATIVE SPACE: not offered while it is the one BLOCKING", () => {
    // The clause the ledger row named: the ally is spent INSTEAD of
    // blocking, so a live attempt by it bars the ability.
    const state = threeSeatGame();
    allyInPlay(state, "Bob", "US", "Underbridge Stray", 2, 1);
    find(state, "M").locked = true;
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:US"],
    ]);
    // Scoped to WHILE the attempt is live: once it resolves the ally is
    // no longer blocking, and the ability is rightly back on the table.
    let seen = false;
    for (let i = 0; i < 10; i++) {
      if (!state.frames.some((f) => f.kind === "blockAttempt")) break;
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.includes("US:burnunlock:"))) seen = true;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(seen).toBe(false);
  });
});

describe("Voracious Vermin (102266)", () => {
  /** Alice's V1 bleeds, Bob's M blocks; Alice holds the card. */
  function intoCombat(level: "basic" | "superior", equipBob: boolean) {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { ani: level }, blood: 4 });
    seatOf(state, "Alice").hand.push({ id: "vv", name: "Voracious Vermin" });
    if (equipBob) {
      find(state, "M").attached.push(
        entry("gun", ".44 Magnum", { tags: ["equipment"] }),
      );
    }
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    return { state, engine };
  }

  it("superior: the additional strike is the GRANTED burn-weapon one", () => {
    const { state, engine } = intoCombat("superior", true);
    expect(walkTo(engine, "play:Voracious Vermin:superior")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:Voracious Vermin:superior"))!;
    runTrace(engine, [["Alice", play]]);
    // Walk to the extra sub-round's strike choice.
    expect(walkTo(engine, "strike:burnEquipment:gun")).toBe(true);
    runTrace(engine, [["Alice", "strike:burnEquipment:gun"]]);
    for (let i = 0; i < 40 && combat(state); i++) {
      const dp = engine.decision();
      if (!dp) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(find(state, "M").attached.map((p) => p.card.name)).not.toContain(".44 Magnum");
  });

  it("NEGATIVE SPACE: with nothing to burn, the granted strike is not offered", () => {
    const { engine } = intoCombat("superior", false);
    expect(walkTo(engine, "play:Voracious Vermin:superior")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:Voracious Vermin:superior"))!;
    runTrace(engine, [["Alice", play]]);
    let seen = false;
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("strike:burnEquipment"))) seen = true;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(seen).toBe(false);
  });

  it("NEGATIVE SPACE: the BASIC mode grants no extra strike at all", () => {
    // The control case for the whole clause: same card, same combat,
    // Bob equipped — only the mode differs.
    const { engine } = intoCombat("basic", true);
    expect(walkTo(engine, "play:Voracious Vermin:basic")).toBe(true);
    expect(
      optionIds(engine).some((o) => o.startsWith("play:Voracious Vermin:superior")),
    ).toBe(false);
    const play = optionIds(engine).find((o) => o.startsWith("play:Voracious Vermin:basic"))!;
    runTrace(engine, [["Alice", play]]);
    let seen = false;
    for (let i = 0; i < 30; i++) {
      const dp = engine.decision();
      if (!dp) break;
      if (dp.options.some((o) => o.id.startsWith("strike:burnEquipment"))) seen = true;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(seen).toBe(false);
  });
});

describe("Heart of Nizchetus (100903)", () => {
  function equipped(library: number, hand: string[]): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    find(state, "V1").attached.push(entry("hn", "Heart of Nizchetus", { tags: ["equipment"] }));
    seatOf(state, "Alice").hand = hand.map((n, i) => ({ id: `h${i}`, name: n }));
    seatOf(state, "Alice").library = Array.from({ length: library }, (_, i) => ({
      id: `L${i}`,
      name: "Conditioning",
    }));
    return { state, engine: atUnlockAbilities(state, "Alice") };
  }

  it("draws up to 3 and buries the same number, leaving the hand unchanged in size", () => {
    const { state, engine } = equipped(5, ["Govern the Unaligned"]);
    const ids = optionIds(engine).filter((o) => o.includes(":drawbury:"));
    // "Up to 3": one option per count, capped by the library.
    expect(ids).toEqual([
      "ability:Heart of Nizchetus:hn:drawbury:1",
      "ability:Heart of Nizchetus:hn:drawbury:2",
      "ability:Heart of Nizchetus:hn:drawbury:3",
    ]);
    runTrace(engine, [["Alice", "ability:Heart of Nizchetus:hn:drawbury:2"]]);
    // Two draws, then two bury choices, one at a time — and a card just
    // drawn is a legal thing to bury, which is the whole point of "draw
    // up to 3 and then move the same number".
    const buried: string[] = [];
    for (let i = 0; i < 2; i++) {
      const dp = engine.decision()!;
      expect(dp.seat).toBe("Alice");
      const bury = dp.options.find((o) => o.id.startsWith("choice:Heart of Nizchetus"));
      expect(bury, `bury choice ${i}`).toBeDefined();
      buried.push(bury!.id.split(":").pop()!);
      runTrace(engine, [["Alice", bury!.id]]);
    }
    const alice = seatOf(state, "Alice");
    expect(alice.hand.length).toBe(1); // 1 + 2 drawn − 2 buried
    expect(alice.library.length).toBe(5); // 5 − 2 drawn + 2 buried
    // Buried, not discarded: nothing reached the ash heap.
    expect(alice.ashHeap ?? []).toEqual([]);
    // And they went to the BOTTOM — the library is drawn from the front,
    // so `push` is the bottom and the two buried cards are last.
    expect(alice.library.slice(-2).map((c) => c.id)).toEqual(buried);
  });

  it("NEGATIVE SPACE: once per phase; and 'ready' includes LOCKED", () => {
    const { engine } = equipped(5, ["Govern the Unaligned"]);
    runTrace(engine, [["Alice", "ability:Heart of Nizchetus:hn:drawbury:1"]]);
    const dp = engine.decision()!;
    runTrace(engine, [["Alice", dp.options[0]!.id]]); // the bury
    expect(optionIds(engine).some((o) => o.includes(":drawbury:"))).toBe(false);

    // "If the bearer is READY" is the ready REGION (p. 16), which a
    // locked vampire is still in — so a locked bearer still works.
    const locked = equipped(5, ["Govern the Unaligned"]);
    find(locked.state, "V1").locked = true;
    expect(
      optionIds(atUnlockAbilities(locked.state, "Alice")).some((o) => o.includes(":drawbury:")),
    ).toBe(true);

    // Torpor is what takes them out of the ready region.
    const torpid = equipped(5, ["Govern the Unaligned"]);
    find(torpid.state, "V1").inTorpor = true;
    expect(
      optionIds(atUnlockAbilities(torpid.state, "Alice")).some((o) => o.includes(":drawbury:")),
    ).toBe(false);
  });
});

describe("True Love's Face (102041)", () => {
  function bleedGame(level: "basic" | "superior") {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { obf: level, pre: level },
      blood: 4,
    });
    seatOf(state, "Alice").hand.push({ id: "tlf", name: "True Love's Face" });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("superior: the block attempt fails and that minion cannot try again", () => {
    const { state, engine } = bleedGame("superior");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(walkTo(engine, "play:True Love's Face:superior")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:True Love's Face:superior"))!;
    runTrace(engine, [["Alice", play]]);
    // Bob declines the buy-off; walk until he is offered blocks again.
    expect(walkTo(engine, "block:")).toBe(true);
    const ids = optionIds(engine);
    // "That attempt fails and the blocking minion cannot attempt to
    // block this action AGAIN" — W may still try, M may not.
    expect(ids).toContain("block:W");
    expect(ids).not.toContain("block:M");
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(true);
    const af = state.frames.find((f) => f.kind === "action");
    expect(af?.kind === "action" && af.blockRestrictions.cannotBlock).toContain("M");
  });

  it("PAY TO CANCEL: the BLOCKING minion's controller is the payer", () => {
    const { state, engine } = bleedGame("superior");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
    ]);
    expect(walkTo(engine, "play:True Love's Face:superior")).toBe(true);
    const play = optionIds(engine).find((o) => o.startsWith("play:True Love's Face:superior"))!;
    runTrace(engine, [["Alice", play]]);
    // The as-played window: BOB (M's controller) is offered the buy-off,
    // and Alice — who played the card — is not.
    expect(walkTo(engine, "cancelpay:tlf")).toBe(true);
    expect(engine.decision()!.seat).toBe("Bob");
    const before = seatOf(state, "Bob").pool;
    runTrace(engine, [["Bob", "cancelpay:tlf"]]);
    expect(seatOf(state, "Bob").pool).toBe(before - 1);
    // The as-played cycle finishes before the play resolves as cancelled,
    // so walk on before reading the log.
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp || state.eventLog.some((e) => e.type === "CardCanceled")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);
    // The block attempt survives: the card never resolved.
    expect(state.eventLog.some((e) => e.type === "BlockFailed")).toBe(false);
  });

  it("basic: +1 bleed, and only during a bleed", () => {
    const { state, engine } = bleedGame("basic");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:True Love's Face:basic")).toBe(true);
    runTrace(engine, [
      ["Alice", optionIds(engine).find((o) => o.startsWith("play:True Love's Face:basic"))!],
    ]);
    // The as-played cycle runs before the card resolves.
    for (let i = 0; i < 12; i++) {
      const dp = engine.decision();
      if (!dp || state.eventLog.some((e) => e.type === "BleedAmountModified")) break;
      runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
    }
    expect(
      state.eventLog.some(
        (e) => e.type === "BleedAmountModified" && e.source === "True Love's Face" && e.delta === 1,
      ),
    ).toBe(true);
  });

  it("NEGATIVE SPACE: the basic mode is not offered on a HUNT", () => {
    const { engine } = bleedGame("basic");
    runTrace(engine, [
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "play:True Love's Face", 20)).toBe(false);
  });
});
