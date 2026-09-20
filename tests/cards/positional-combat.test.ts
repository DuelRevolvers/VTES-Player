/**
 * The positional combat cards (docs/positional-combat-design.md).
 *
 * Fade from View (100688), Gleam of Red Eyes (100838),
 * Form of the Ghost (100772), Nimble Feet (101288), Quick Exit (101528),
 * Read Intentions (101558), Movement of the Mind (101246),
 * Dissolution (100558).
 *
 * Eight cards, no new primitive: each is a press, a maneuver, a dodge or an
 * additional strike at two levels. So the tests are a TABLE — what each mode
 * is offered in which window — plus the two cases a table cannot express: a
 * press that may only end a combat, and a pair of cards whose levels are
 * mirror images of each other.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** V1 (Alice, acting) bleeds; M (Bob) blocks → combat, at Before Range. */
function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

/** A combat with Alice's V1 holding `card`, and the discipline it needs. */
function armed(
  card: string,
  disciplines: Record<string, "basic" | "superior">,
): { state: GameState; engine: VtesEngine; v1: MinionState; m: MinionState } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { blood: 4, capacity: 4, disciplines });
  const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
  m.blood = 4;
  // NOT "c1": `threeSeatGame` already deals Alice a Conditioning with that
  // id, and the engine resolves a play by the FIRST instance of the id it
  // finds — so a duplicate id is offered under this card's name and then
  // resolves the other card, which every "is it offered" assertion passes
  // straight through.
  state.seats[0]!.hand.push({ id: "pos1", name: card });
  const engine = new VtesEngine(state, testRegistry);
  enterCombat(engine);
  return { state, engine, v1, m };
}

/** Pass until an option with this prefix is on the table for whoever is
 *  asked, and return it — never taking `options[0]`, which plays the board. */
function offered(engine: VtesEngine, prefix: string, limit = 16): string | null {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return null;
    const hit = dp.options.find((o) => o.id.startsWith(prefix));
    if (hit) return hit.id;
    // The choose-strike step offers no `pass` — a walker that only knows how
    // to pass stops there and never reaches the press step at all, which is
    // where half of these cards live.
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "strike:hand") ??
      dp.options.find((o) => o.id.startsWith("strike:"));
    if (!pick) return null;
    engine.choose(pick.id);
  }
  return null;
}

// ---------------------------------------------------------------------------

describe("the table: each mode is offered in the window its effect belongs to", () => {
  /** card, mode, discipline level needed, and the window it shows up in. */
  const rows: Array<{
    card: string;
    mode: string;
    d: Record<string, "basic" | "superior">;
    window: string;
  }> = [
    // A press is played at the press step, after damage.
    { card: "Fade from View", mode: "basic", d: { obf: "basic" }, window: "combat.press" },
    { card: "Gleam of Red Eyes", mode: "basic", d: { pro: "basic" }, window: "combat.press" },
    { card: "Nimble Feet", mode: "basic", d: { cel: "basic" }, window: "combat.press" },
    { card: "Form of the Ghost", mode: "superior", d: { pro: "superior" }, window: "combat.press" },
    // A maneuver is played in the RANGE step — "before range is determined"
    // on the card is the step's own name for itself, not the window before it.
    {
      card: "Gleam of Red Eyes",
      mode: "superior",
      d: { pro: "superior" },
      window: "combat.range",
    },
    { card: "Form of the Ghost", mode: "basic", d: { pro: "basic" }, window: "combat.range" },
    {
      card: "Movement of the Mind",
      mode: "superior",
      d: { tha: "superior" },
      window: "combat.range",
    },
    { card: "Dissolution", mode: "basic", d: { pro: "basic" }, window: "combat.range" },
    // A dodge and an additional strike are chosen with the strike.
    {
      card: "Fade from View",
      mode: "superior",
      d: { obf: "superior" },
      window: "combat.chooseStrike",
    },
    { card: "Quick Exit", mode: "superior", d: { obf: "superior" }, window: "combat.chooseStrike" },
    {
      card: "Read Intentions",
      mode: "superior",
      d: { aus: "superior" },
      window: "combat.chooseStrike",
    },
    {
      card: "Nimble Feet",
      mode: "superior",
      d: { cel: "superior" },
      window: "combat.chooseStrike",
    },
  ];

  for (const row of rows) {
    it(`${row.card} (${row.mode}) is offered in ${row.window}`, () => {
      const { engine } = armed(row.card, row.d);
      const want = `play:${row.card}:${row.mode}`;
      const id = offered(engine, want);
      expect(id, `${row.card} ${row.mode} never offered`).not.toBeNull();
      expect(engine.decision()!.window).toBe(row.window);
    });
  }
});

describe("a press that may only END the combat", () => {
  /** Give the OPPOSING side (Bob's M, the blocker) a press credit, so there
   *  is a press for an end-only card to cancel. A plain combat hands nobody
   *  a credit, so without this the card is never offered and the test passes
   *  for the wrong reason. */
  function creditBob(state: GameState): void {
    const cf = state.frames.find((f) => f.kind === "combat");
    if (cf?.kind !== "combat") throw new Error("no combat frame to credit");
    cf.pressesCombat.opposing += 1;
  }

  /** Walk to the press step, let BOB press to continue, and stop where Alice
   *  may answer it. An end-only press has nothing to end until a press is
   *  standing — which is the card's own gate, not an accident. */
  function standingPress(engine: VtesEngine, card: string): string | null {
    for (let i = 0; i < 20; i++) {
      const dp = engine.decision();
      if (!dp) return null;
      const mine = dp.options.find((o) => o.id.startsWith(`play:${card}:basic`));
      if (mine) return mine.id;
      const press = dp.seat === "Bob" ? dp.options.find((o) => o.id === "press:continue") : undefined;
      const pick =
        press ??
        dp.options.find((o) => o.id === "pass") ??
        dp.options.find((o) => o.id === "strike:hand") ??
        dp.options.find((o) => o.id.startsWith("strike:"));
      if (!pick) return null;
      engine.choose(pick.id);
    }
    return null;
  }

  for (const [card, d] of [
    ["Quick Exit", { obf: "basic" as const }],
    ["Read Intentions", { aus: "basic" as const }],
  ] as const) {
    it(`${card}'s basic is offered only against a STANDING press, and ends the combat`, () => {
      // With no press standing there is nothing to end, so the card is not
      // offered at the press step at all.
      const quiet = armed(card, d);
      expect(offered(quiet.engine, `play:${card}:basic`)).toBeNull();

      // Once Bob presses to continue, the same mode appears — as a cancel.
      const live = armed(card, d);
      creditBob(live.state);
      const id = standingPress(live.engine, card);
      expect(id, `${card} never offered against a standing press`).not.toBeNull();
      runTrace(live.engine, [
        ["Alice", id!],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ]);
      for (let i = 0; i < 10; i++) {
        if (!live.state.frames.some((f) => f.kind === "combat")) break;
        const dp = live.engine.decision();
        if (!dp) break;
        const pick =
          dp.options.find((o) => o.id === "pass") ??
          dp.options.find((o) => o.id === "strike:hand");
        if (!pick) break;
        live.engine.choose(pick.id);
      }
      expect(live.state.frames.some((f) => f.kind === "combat")).toBe(false);
    });
  }
});

describe("Dissolution (100558) — 'maneuver OR press'", () => {
  it("offers each half of 'maneuver or press' in its OWN window", () => {
    // "Or" is two variants, and a variant is offered where its effect
    // belongs: the maneuver in the range step, the press at the press step.
    const a = armed("Dissolution", { pro: "basic" });
    const manId = offered(a.engine, "play:Dissolution:basic:V1:pos1");
    expect(manId).toBe("play:Dissolution:basic:V1:pos1");
    expect(a.engine.decision()!.window).toBe("combat.range");

    const b = armed("Dissolution", { pro: "basic" });
    const pressId = offered(b.engine, "play:Dissolution:basic:V1:press");
    expect(pressId).not.toBeNull();
    expect(b.engine.decision()!.window).toBe("combat.press");
  });

  it("superior maneuvers AND grants a press", () => {
    const { engine } = armed("Dissolution", { pro: "superior" });
    const id = offered(engine, "play:Dissolution:superior");
    expect(id).not.toBeNull();
    runTrace(engine, [
      ["Alice", id!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // The grant is observable where it matters: Alice can press at the press
    // step, which a vampire with no credit cannot do. The walk is long: the
    // maneuver re-opens the range step before strikes are even chosen.
    expect(offered(engine, "press:continue", 30)).toBe("press:continue");
  });
});

describe("the mirror pair", () => {
  it("Gleam of Red Eyes and Form of the Ghost swap their levels", () => {
    // Same two effects, opposite levels — the pair is in one wave because
    // getting a mode backwards is invisible in a single-card test.
    const gleam = armed("Gleam of Red Eyes", { pro: "basic" });
    expect(offered(gleam.engine, "play:Gleam of Red Eyes:basic")).not.toBeNull();
    expect(gleam.engine.decision()!.window).toBe("combat.press");

    const ghost = armed("Form of the Ghost", { pro: "basic" });
    expect(offered(ghost.engine, "play:Form of the Ghost:basic")).not.toBeNull();
    expect(ghost.engine.decision()!.window).toBe("combat.range");
  });
});
