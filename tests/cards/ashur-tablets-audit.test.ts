import { describe, expect, it } from "vitest";
import { VtesEngine } from "../../src/engine/engine.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function tablet(id: string, controller: string) {
  return { card: { id, name: "Ashur Tablets" }, controller, locked: false, usedThisPhase: false, statics: {}, tags: ["Ashur Tablets"] };
}
function game(existing = 2) {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn");
  tf.phase = "master"; tf.masterActionsLeft = 3;
  const alice = state.seats[0]!;
  alice.hand = [{ id: "third", name: "Ashur Tablets" }, { id: "extra", name: "Ashur Tablets" }];
  alice.library = [];
  alice.ashHeap = [{ id: "a", name: "Conditioning" }, { id: "b", name: "Deflection" }, { id: "c", name: "Govern the Unaligned" }];
  alice.permanents.push(...Array.from({ length: existing }, (_, i) => tablet(`old${i}`, "Alice")));
  state.seats[1]!.permanents.push(tablet("foreign", "Bob"));
  return { state, alice, engine: new VtesEngine(state, testRegistry) };
}
function play(engine: VtesEngine) {
  engine.choose("play:Ashur Tablets:-:third");
  runTrace(engine, [["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"]]);
}

describe("Ashur Tablets", () => {
  it("stays in play without paying out before three, and only one may be played per turn", () => {
    const { state, alice, engine } = game(0);
    const pool = alice.pool;
    play(engine);
    expect(alice.pool).toBe(pool);
    expect(alice.permanents.some(p => p.card.id === "third")).toBe(true);
    expect(engine.decision()!.options.some(o => o.id.includes("Ashur Tablets"))).toBe(false);
    const tf = state.frames.find(f => f.kind === "turn");
    expect(tf?.kind === "turn" && tf.oncePerTurnCards).toContain("Ashur Tablets");
  });
  it("removes all table copies and lets the player select a card for hand and others for library", () => {
    const { state, alice, engine } = game();
    const pool = alice.pool;
    play(engine);
    expect(engine.decision()!.window).toBe("choice");
    engine.choose("choice:Ashur Tablets:third:ashurHand:b");
    // Save/load during the multi-card decision must retain the selection.
    const saved = JSON.parse(JSON.stringify(state));
    const resumed = new VtesEngine(saved, testRegistry);
    resumed.choose("choice:Ashur Tablets:third:ashurMore:a");
    resumed.choose("choice:Ashur Tablets:third:ashurMore:done");
    const a = saved.seats[0];
    expect(a.pool).toBe(pool + 3);
    expect(a.hand.some((c: { id: string }) => c.id === "b")).toBe(true);
    expect(a.library.map((c: { id: string }) => c.id)).toContain("a");
    expect(a.ashHeap.map((c: { id: string }) => c.id)).toEqual(["c"]);
    expect(saved.seats.flatMap((s: { permanents: Array<{ card: { name: string } }> }) => s.permanents).some((p: { card: { name: string } }) => p.card.name === "Ashur Tablets")).toBe(false);
    expect(saved.seats.flatMap((s: { ashHeap?: Array<{ id: string }> }) => s.ashHeap ?? []).some((c: { id: string }) => ["old0", "old1", "third", "foreign"].includes(c.id))).toBe(false);
    expect(saved.eventLog.some((e: { type: string }) => e.type === "LibraryShuffled")).toBe(true);
  });
  it("can choose zero cards", () => {
    const { state, alice, engine } = game();
    const pool = alice.pool;
    play(engine);
    engine.choose("choice:Ashur Tablets:third:ashurHand:done");
    expect(alice.pool).toBe(pool + 3);
    expect(alice.ashHeap!.map(c => c.id)).toEqual(["a", "b", "c"]);
    expect(state.seats[1]!.permanents).toHaveLength(0);
  });
  it("caps retrieval at thirteen and does not retrieve crypt cards", () => {
    const { alice, engine } = game();
    alice.ashHeap = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, name: "Conditioning" }));
    alice.ashHeap.push({ id: "crypt", name: "Anarch Convert (ANY)", crypt: true });
    play(engine);
    expect(engine.decision()!.options.some(o => o.id.endsWith(":crypt"))).toBe(false);
    engine.choose("choice:Ashur Tablets:third:ashurHand:r0");
    for (let i = 1; i < 13; i++) engine.choose(`choice:Ashur Tablets:third:ashurMore:r${i}`);
    expect(engine.decision()!.window).not.toBe("choice");
    expect(alice.hand.some(c => c.id === "r0")).toBe(true);
    expect(alice.library).toHaveLength(12);
    expect(alice.ashHeap.map(c => c.id).sort()).toEqual(["crypt", "r13"]);
  });
  it("gains pool with an empty ash heap without stranding a choice", () => {
    const { alice, engine } = game();
    alice.ashHeap = [];
    const pool = alice.pool;
    play(engine);
    expect(alice.pool).toBe(pool + 3);
    expect(engine.decision()!.window).not.toBe("choice");
    expect(alice.ashHeap.some(c => c.id === "third")).toBe(false);
  });

});
