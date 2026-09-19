/**
 * What an action is worth BLOCKING
 * (docs/ai-block-action-value-design.md).
 *
 * `ActionKind` has six members and one of them is `"cardEffect"` —
 * every action card in the game. So a Govern, an Embrace and a Kine
 * Resources Contested about to burn the table all returned the same
 * constant to the seat deciding whether to stop them, because `viewFor`
 * projected the action's KIND and dropped its identity.
 *
 * The projection now carries the card's name and one flag: whether it is
 * a political action. That is the only distinction drawn, and
 * deliberately — anything finer would be a table of card names in the AI,
 * which is the failure mode every doc in this set refuses.
 */

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { viewFor } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import type { ActionFrame, GameState } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** Carol (Alice's predator) acts; Alice may block with V1. */
function acting(extra: Partial<ActionFrame>): GameState {
  const state = threeSeatGame();
  state.frames.push({
    kind: "action",
    actionId: "a1",
    actionKind: "cardEffect",
    card: null,
    acting: "N",
    actingSeat: "Carol",
    target: null,
    directed: false,
    targetMinion: null,
    blockedBy: null,
    ...extra,
  } as unknown as ActionFrame);
  return state;
}

const PASS: LegalOption = { id: "pass", kind: "pass", label: "pass" };
/** A block that would work — the gate that makes every other one moot. */
const BLOCK: Extract<LegalOption, { kind: "declareBlock" }> = {
  id: "block:V1",
  kind: "declareBlock",
  label: "Block with V1",
  minion: "V1",
  intercept: 1,
  stealth: 0,
  wouldSucceed: true,
  toll: 0,
};

function decide(state: GameState, options: LegalOption[] = [PASS, BLOCK]): string {
  const dp: DecisionPoint = { seq: 1, seat: "Alice", window: "action.announce", options };
  return new HeuristicAgent({ seed: 9 }).decide(dp, options, viewFor(state, "Alice"));
}

describe("the projection carries what the card IS", () => {
  it("reports the card name for an action announced from hand", () => {
    const state = threeSeatGame();
    const cardFrame = acting({
      card: {
        instance: { id: "c1", name: "Kine Resources Contested" },
        mode: null,
        params: {},
      },
      political: true,
    } as unknown as Partial<ActionFrame>);
    const view = viewFor(cardFrame, "Alice");
    expect(view.action?.cardName).toBe("Kine Resources Contested");
    expect(view.action?.political).toBe(true);
    void state;
  });

  it("reports NULL for a built-in action, which is the case that gets forgotten", () => {
    const view = viewFor(acting({ actionKind: "bleed", target: "Bob" }), "Alice");
    expect(view.action?.cardName).toBeNull();
    expect(view.action?.political).toBe(false);
  });
});

describe("a political action is worth more to stop", () => {
  it("blocks a referendum where it lets a hunt through", () => {
    // SAME seat, SAME blocker, SAME weights — only what is being
    // announced differs. `blockHunt` is deliberately below `pass`, so a
    // hunt is let through; a referendum must not be.
    const hunt = acting({ actionKind: "hunt" });
    expect(decide(hunt)).toBe("pass");

    const referendum = acting({
      actionKind: "cardEffect",
      political: true,
      card: { instance: { id: "c1", name: "Parity Shift" }, mode: null, params: {} },
    } as unknown as Partial<ActionFrame>);
    expect(decide(referendum)).toBe("block:V1");
  });

  it("outranks a plain action card", () => {
    // Both are blocked, so this compares the SCORES rather than the
    // choices — a referendum is a table-wide pool event and a Govern is
    // one seat's private gain.
    const agent = new HeuristicAgent({ seed: 9 });
    const score = (state: GameState): number =>
      agent.score(BLOCK, { seq: 1, seat: "Alice", window: "action.announce", options: [PASS, BLOCK] }, viewFor(state, "Alice"));

    const political = score(
      acting({
        political: true,
        card: { instance: { id: "c1", name: "Parity Shift" }, mode: null, params: {} },
      } as unknown as Partial<ActionFrame>),
    );
    const plain = score(
      acting({
        card: { instance: { id: "c2", name: "Govern the Unaligned" }, mode: null, params: {} },
      } as unknown as Partial<ActionFrame>),
    );
    expect(political).toBeGreaterThan(plain);
  });

  it("does not outrank stopping a bleed that would oust us", () => {
    // Nothing outranks not being ousted. The +50 cliff and the new weight
    // now share a scale, so the ordering is asserted rather than assumed.
    const state = threeSeatGame();
    state.seats[0]!.pool = 1;
    state.frames.push({
      kind: "action",
      actionId: "a1",
      actionKind: "bleed",
      card: null,
      acting: "N",
      actingSeat: "Carol",
      target: "Alice",
      directed: true,
      targetMinion: null,
      blockedBy: null,
    } as unknown as ActionFrame);
    const agent = new HeuristicAgent({ seed: 9 });
    const dp: DecisionPoint = { seq: 1, seat: "Alice", window: "action.announce", options: [PASS, BLOCK] };
    const lethalBleed = agent.score(BLOCK, dp, viewFor(state, "Alice"));

    const referendum = acting({
      political: true,
      card: { instance: { id: "c1", name: "Parity Shift" }, mode: null, params: {} },
    } as unknown as Partial<ActionFrame>);
    expect(lethalBleed).toBeGreaterThan(agent.score(BLOCK, dp, viewFor(referendum, "Alice")));
  });
});

describe("negative space", () => {
  it("never blocks when the block could not succeed", () => {
    // The gate that makes everything above moot, and the reason the
    // political weight is unreachable in real games on these decks: an
    // undirected political action carries +1 stealth (p. 22) and nothing
    // in these decks answers it.
    const referendum = acting({
      political: true,
      card: { instance: { id: "c1", name: "Parity Shift" }, mode: null, params: {} },
    } as unknown as Partial<ActionFrame>);
    const hopeless: LegalOption = { ...BLOCK, wouldSucceed: false };
    expect(decide(referendum, [PASS, hopeless])).toBe("pass");
  });

  it("the actor-relation term is OFF and changes nothing by default", () => {
    // Kept at 0 on the `influenceUnlocks` precedent: live (it would flip
    // 12% of block decisions) but unvalidated. If a default ever turns it
    // on, this fails and says so.
    const referendum = acting({
      political: true,
      card: { instance: { id: "c1", name: "Parity Shift" }, mode: null, params: {} },
    } as unknown as Partial<ActionFrame>);
    const dp: DecisionPoint = { seq: 1, seat: "Alice", window: "action.announce", options: [PASS, BLOCK] };
    const view = viewFor(referendum, "Alice");
    const off = new HeuristicAgent({ seed: 9 }).score(BLOCK, dp, view);
    const on = new HeuristicAgent({ seed: 9, weights: { blockActorRelation: 3 } }).score(
      BLOCK,
      dp,
      view,
    );
    expect(on).not.toBe(off);
    expect(new HeuristicAgent({ seed: 9 }).score(BLOCK, dp, view)).toBe(off);
  });
});
