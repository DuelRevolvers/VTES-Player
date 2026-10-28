/**
 * Marked vampires (docs/marked-vampires-design.md) — cards that put
 * themselves on a minion and let OTHER minions enter combat with it:
 * Warrant (102148), Blood Hunt (100202), War Party (102145), Rogue
 * (101647) and Contract (100420). The rush is the existing
 * `permanent.rushGrant` (docs/granted-rush-design.md); what differs is who
 * may take it, what it costs, and where each card may go.
 */

import { describe, expect, it } from "vitest";
import type { ActionFrame, GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, currentStealth } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function seatOf(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function turnFrame(state: GameState) {
  const tf = state.frames[0];
  if (!tf || tf.kind !== "turn") throw new Error("no turn frame");
  return tf;
}

/** The named seat's minion phase (threeSeatGame starts in Alice's). */
function minionPhase(seat: string, edit?: (s: GameState) => void): GameState {
  const state = threeSeatGame();
  turnFrame(state).seat = seat;
  edit?.(state);
  return state;
}

/** Alice's master phase with one master action and `cards` in her hand. */
function mastersPhase(edit: (s: GameState) => void, ...cards: Array<{ id: string; name: string }>): GameState {
  const state = threeSeatGame();
  const tf = turnFrame(state);
  tf.phase = "master";
  tf.masterActionsLeft = 1;
  seatOf(state, "Alice").hand.push(...cards);
  edit(state);
  return state;
}

/** Put a card in play on a minion, as its play would. */
function attach(state: GameState, minionId: string, cardId: string, name: string, controller: string): void {
  find(state, minionId).attached.push({
    card: { id: cardId, name },
    controller,
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [],
  });
}

const ids = (engine: VtesEngine): string[] => engine.decision()?.options.map((o) => o.id) ?? [];

/** The targets a hand card's play options name, by card name. */
function playTargets(engine: VtesEngine, name: string): string[] {
  return (engine.decision()?.options ?? [])
    .filter((o) => o.kind === "playCard" && o.name === name)
    .map((o) => (o.kind === "playCard" ? (o.params["target"] ?? "") : ""));
}

/** Answer `pass` until `done()` holds. A decision with no `pass` that is
 *  not `done` is a failure, never a silent stop. */
function passUntil(engine: VtesEngine, done: () => boolean, max = 60): void {
  for (let i = 0; i < max && !done(); i++) {
    const options = ids(engine);
    if (!options.includes("pass")) throw new Error(`no pass offered: ${options.join(", ")}`);
    engine.choose("pass");
  }
  expect(done()).toBe(true);
}

/** `passUntil` through a combat: `pass` first, then the plain hand strike
 *  and ending the press, which are the decisions combat cannot pass. */
function walkUntil(engine: VtesEngine, done: () => boolean, max = 80): void {
  for (let i = 0; i < max && !done(); i++) {
    const options = ids(engine);
    const pick = ["pass", "press:end", "strike:hand"].find((p) => options.includes(p));
    if (!pick) throw new Error(`nothing to walk: ${options.join(", ")}`);
    engine.choose(pick);
  }
  expect(done()).toBe(true);
}

const actionFrame = (state: GameState): ActionFrame => {
  const af = [...state.frames].reverse().find((f) => f.kind === "action");
  if (!af || af.kind !== "action") throw new Error("no action frame");
  return af;
};

// ---------------------------------------------------------------------------
// Warrant — a referendum puts it on a younger ready vampire
// ---------------------------------------------------------------------------

describe("Warrant (102148)", () => {
  /** V1 (Alice, the caller, capacity 8, a prince for her 3 votes); W 5 and
   *  N 4 are younger; M 9 is older. */
  function warrantGame(edit?: (s: GameState) => void): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Alice", (s) => {
      Object.assign(find(s, "V1"), { capacity: 8, title: "prince" });
      find(s, "W").capacity = 5;
      find(s, "M").capacity = 9;
      find(s, "N").capacity = 4;
      seatOf(s, "Alice").hand.push({ id: "wa", name: "Warrant" });
      edit?.(s);
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }
  const termsOffered = (engine: VtesEngine) => () => ids(engine).some((i) => i.startsWith("terms:"));

  it("the terms are the YOUNGER READY vampires, anyone's", () => {
    const { engine } = warrantGame((s) => {
      find(s, "N").inTorpor = true; // younger, but not ready
    });
    runTrace(engine, [["Alice", "play:Warrant"]]);
    passUntil(engine, termsOffered(engine));
    const terms = ids(engine).filter((i) => i.startsWith("terms:"));
    expect(terms).toEqual(["terms:W"]);
    // Not the older M, not the caller herself, not the torpid N.
    expect(terms).not.toContain("terms:M");
    expect(terms).not.toContain("terms:V1");
    expect(terms).not.toContain("terms:N");
  });

  it("cannot be called with no younger ready vampire at the table [LSJ 20100129]", () => {
    const younger = warrantGame();
    expect(ids(younger.engine).some((i) => i.startsWith("play:Warrant"))).toBe(true);

    const none = warrantGame((s) => {
      find(s, "W").capacity = 9;
      find(s, "N").inTorpor = true;
    });
    expect(ids(none.engine).some((i) => i.startsWith("play:Warrant"))).toBe(false);
  });

  it("goes on the chosen vampire on a pass", () => {
    const { state, engine } = warrantGame();
    runTrace(engine, [["Alice", "play:Warrant"]]);
    passUntil(engine, termsOffered(engine));
    runTrace(engine, [
      ["Alice", "terms:W"],
      ["Alice", "vote:V1:for"],
    ]);
    passUntil(engine, () => find(state, "W").attached.some((p) => p.card.id === "wa"));
    expect(find(state, "W").attached.find((p) => p.card.id === "wa")!.controller).toBe("Alice");
  });

  it("any ready vampire may rush the bearer, the bearer's own side too, for 1 blood", () => {
    const carol = minionPhase("Carol", (s) => attach(s, "W", "wa", "Warrant", "Alice"));
    const ce = new VtesEngine(carol, testRegistry);
    expect(ids(ce)).toContain("act:Warrant:wa:rush:N:W");
    ce.choose("act:Warrant:wa:rush:N:W");
    expect(actionFrame(carol).grantedCost).toEqual({ blood: 1 });
    expect(currentStealth(carol, actionFrame(carol).actionId)).toBe(0);

    // "Any ready vampire" (owner ruling 2026-10-27, design §5).
    const bob = minionPhase("Bob", (s) => attach(s, "W", "wa", "Warrant", "Alice"));
    expect(ids(new VtesEngine(bob, testRegistry))).toContain("act:Warrant:wa:rush:M:W");
  });

  it("the 1 blood is paid: Warrant's rush costs the actor 1 blood and War Party's nothing", () => {
    // W cannot hurt N (strength 0), so N's blood moves only by the cost.
    // (A 0-blood actor never reaches the cost gate: it must hunt, p. 21.)
    const run = (card: string, cardId: string) => {
      const state = minionPhase("Carol", (s) => {
        attach(s, "W", cardId, card, "Alice");
        find(s, "W").strength = 0;
        find(s, "N").blood = 3;
      });
      const engine = new VtesEngine(state, testRegistry);
      engine.choose(`act:${card}:${cardId}:rush:N:W`);
      walkUntil(engine, () => !state.frames.some((f) => f.kind === "action"));
      return find(state, "N").blood;
    };
    expect(run("Warrant", "wa")).toBe(2);
    expect(run("War Party", "wp")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Blood Hunt and War Party — actions that put themselves on a vampire
// ---------------------------------------------------------------------------

describe("Blood Hunt (100202)", () => {
  function bloodHuntGame(): { state: GameState; engine: VtesEngine } {
    const state = minionPhase("Alice", (s) => {
      find(s, "V1").title = "prince";
      find(s, "M").title = "innerCircle";
      find(s, "N").inTorpor = true;
      seatOf(s, "Carol").minions.push(makeMinion("P", "Carol", { title: "justicar" }));
      seatOf(s, "Alice").hand.push({ id: "bh", name: "Blood Hunt" });
    });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("needs a prince or justicar to play", () => {
    const { state, engine } = bloodHuntGame();
    expect(playTargets(engine, "Blood Hunt").length).toBeGreaterThan(0);
    find(state, "V1").title = "baron";
    expect(playTargets(new VtesEngine(state, testRegistry), "Blood Hunt")).toEqual([]);
  });

  it("goes on a vampire with no prince, justicar or Inner Circle title — in torpor too", () => {
    const { engine } = bloodHuntGame();
    const targets = playTargets(engine, "Blood Hunt");
    expect(targets).toContain("W");
    expect(targets).toContain("N"); // in torpor: an eligible target (p. 44)
    expect(targets).not.toContain("M"); // Inner Circle
    expect(targets).not.toContain("P"); // justicar
    expect(targets).not.toContain("V1"); // prince
  });

  it("is a +1 stealth action that attaches on success and calls no referendum", () => {
    const { state, engine } = bloodHuntGame();
    const play = engine.decision()!.options.find(
      (o) => o.kind === "playCard" && o.name === "Blood Hunt" && o.params["target"] === "W",
    )!;
    engine.choose(play.id);
    passUntil(engine, () => state.frames.some((f) => f.kind === "action"));
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(1);
    expect(actionFrame(state).target).toBe("Bob"); // directed at W's controller
    passUntil(engine, () => find(state, "W").attached.some((p) => p.card.id === "bh"));
    // The CARD named Blood Hunt is not a blood hunt referendum (p. 35).
    expect(state.frames.some((f) => f.kind === "referendum")).toBe(false);
  });

  it("a second copy may go on the same vampire — the card prints no limit", () => {
    const { state } = bloodHuntGame();
    attach(state, "W", "bh0", "Blood Hunt", "Alice");
    expect(playTargets(new VtesEngine(state, testRegistry), "Blood Hunt")).toContain("W");
  });
});

describe("War Party (102145)", () => {
  it("goes on a vampire with no archbishop, priscus, cardinal or regent title — a Regent's title counts", () => {
    // Regent is the one title only a CARD gives, so play it for real.
    const state = mastersPhase(
      (s) => {
        Object.assign(find(s, "V1"), { title: "archbishop", sect: "sabbat" });
        seatOf(s, "Alice").minions.push(makeMinion("V2", "Alice", { sect: "sabbat", capacity: 9 }));
        find(s, "M").title = "cardinal";
        seatOf(s, "Alice").hand.push({ id: "wp", name: "War Party" });
      },
      { id: "rg", name: "Regent" },
    );
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", "play:Regent:-:V2:rg"]]);
    passUntil(engine, () => find(state, "V2").title === "regent");

    turnFrame(state).phase = "minion";
    const targets = playTargets(new VtesEngine(state, testRegistry), "War Party");
    expect(targets).toContain("W");
    expect(targets).toContain("N");
    expect(targets).not.toContain("V2"); // regent, from the card
    expect(targets).not.toContain("V1"); // archbishop
    expect(targets).not.toContain("M"); // cardinal
  });

  it("needs an archbishop, priscus, cardinal or regent to play", () => {
    const state = minionPhase("Alice", (s) => {
      find(s, "V1").title = "prince";
      seatOf(s, "Alice").hand.push({ id: "wp", name: "War Party" });
    });
    expect(playTargets(new VtesEngine(state, testRegistry), "War Party")).toEqual([]);
    find(state, "V1").title = "priscus";
    expect(playTargets(new VtesEngine(state, testRegistry), "War Party").length).toBeGreaterThan(0);
  });
});

describe("Blood Hunt against War Party: who may rush the bearer", () => {
  const both = (seat: string) =>
    minionPhase(seat, (s) => {
      attach(s, "W", "bh", "Blood Hunt", "Alice");
      attach(s, "W", "wp", "War Party", "Alice");
    });

  it("the bearer's own side: War Party's 'any vampire' yes, Blood Hunt's 'another Methuselah' no", () => {
    const options = ids(new VtesEngine(both("Bob"), testRegistry));
    expect(options).toContain("act:War Party:wp:rush:M:W");
    expect(options).not.toContain("act:Blood Hunt:bh:rush:M:W");
  });

  it("another Methuselah's vampire: both, each at +1 stealth", () => {
    for (const card of ["Blood Hunt:bh", "War Party:wp"]) {
      const state = both("Carol");
      const engine = new VtesEngine(state, testRegistry);
      expect(ids(engine)).toContain(`act:${card}:rush:N:W`);
      engine.choose(`act:${card}:rush:N:W`);
      expect(currentStealth(state, actionFrame(state).actionId)).toBe(1);
      expect(actionFrame(state).grantedCost).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Rogue — on a vampire who committed diablerie since your last turn
// ---------------------------------------------------------------------------

describe("Rogue (101647)", () => {
  it("diablerie stamps the diablerist with the turn", () => {
    const state = minionPhase("Alice", (s) => {
      find(s, "N").inTorpor = true;
    });
    const engine = new VtesEngine(state, testRegistry);
    expect(find(state, "W").lastDiablerieTurn).toBeUndefined();
    engine.commitDiablerie("W", "N");
    expect(find(state, "W").lastDiablerieTurn).toBe(turnFrame(state).turnNumber);
  });

  it("goes only on a vampire whose diablerie came after your last turn ended", () => {
    const state = mastersPhase(
      (s) => {
        const now = turnFrame(s).turnNumber;
        seatOf(s, "Alice").lastTurnEnded = now - 3;
        find(s, "W").lastDiablerieTurn = now - 1; // Carol's turn, since then
        find(s, "M").lastDiablerieTurn = now - 3; // during Alice's last turn
        find(s, "V1").lastDiablerieTurn = now; // this turn qualifies [LSJ 20020429]
      },
      { id: "rg", name: "Rogue" },
    );
    const options = ids(new VtesEngine(state, testRegistry));
    expect(options).toContain("play:Rogue:-:W:rg");
    expect(options).toContain("play:Rogue:-:V1:rg");
    expect(options).not.toContain("play:Rogue:-:M:rg");
    expect(options).not.toContain("play:Rogue:-:N:rg"); // never diablerized
  });

  it("any vampire may rush the bearer; one with Auspex at +1 stealth", () => {
    const run = (actor: string) => {
      const state = minionPhase("Carol", (s) => {
        attach(s, "W", "rg", "Rogue", "Alice");
        find(s, "N").disciplines = { aus: "basic" };
        seatOf(s, "Carol").minions.push(makeMinion("P", "Carol"));
      });
      const engine = new VtesEngine(state, testRegistry);
      engine.choose(`act:Rogue:rg:rush:${actor}:W`);
      return currentStealth(state, actionFrame(state).actionId);
    };
    expect(run("N")).toBe(1); // Auspex
    expect(run("P")).toBe(0); // none
  });
});

// ---------------------------------------------------------------------------
// Contract — any Assamite, any ready minion
// ---------------------------------------------------------------------------

describe("Contract (100420)", () => {
  function contractGame(assamites: string[]): { state: GameState; engine: VtesEngine } {
    const state = mastersPhase(
      (s) => {
        for (const id of assamites) find(s, id).clan = "Banu Haqim";
        seatOf(s, "Carol").minions.push(makeMinion("P", "Carol", { clan: "Banu Haqim" }));
        seatOf(s, "Carol").minions.push(makeMinion("T", "Carol", { inTorpor: true }));
      },
      { id: "ct", name: "Contract" },
    );
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("goes on any Methuselah's READY minion", () => {
    const { engine } = contractGame(["N"]);
    for (const t of ["V1", "W", "M", "N", "P"]) expect(ids(engine)).toContain(`play:Contract:-:${t}:ct`);
    expect(ids(engine)).not.toContain("play:Contract:-:T:ct"); // in torpor
  });

  it("cannot be played with no Assamite in play", () => {
    const { state } = contractGame([]);
    for (const m of state.seats.flatMap((s) => s.minions)) m.clan = null;
    expect(ids(new VtesEngine(state, testRegistry)).some((i) => i.startsWith("play:Contract"))).toBe(false);
  });

  it("asks for the Assamite after the minion — any Methuselah's — and only it may rush", () => {
    const { state, engine } = contractGame(["W", "N"]);
    runTrace(engine, [["Alice", "play:Contract:-:M:ct"]]);
    passUntil(engine, () => ids(engine).some((i) => i.startsWith("choice:Contract")));
    const choices = ids(engine).filter((i) => i.startsWith("choice:Contract"));
    expect(choices.sort()).toEqual([
      "choice:Contract:ct:assamite:N",
      "choice:Contract:ct:assamite:P",
      "choice:Contract:ct:assamite:W",
    ]);
    expect(ids(engine)).not.toContain("pass"); // "Choose an Assamite" is not optional
    engine.choose("choice:Contract:ct:assamite:N"); // Carol's, not Alice's
    const entry = find(state, "M").attached.find((p) => p.card.id === "ct")!;
    expect(entry.chosen).toBe("N");
    expect(entry.controller).toBe("Alice");

    // Carol's minion phase: the chosen N may rush M at +1 stealth; her other
    // Assamite P may not.
    turnFrame(state).phase = "minion";
    turnFrame(state).seat = "Carol";
    const carol = new VtesEngine(state, testRegistry);
    expect(ids(carol)).toContain("act:Contract:ct:rush:N:M");
    expect(ids(carol)).not.toContain("act:Contract:ct:rush:P:M");
    carol.choose("act:Contract:ct:rush:N:M");
    expect(currentStealth(state, actionFrame(state).actionId)).toBe(1);
  });
});
