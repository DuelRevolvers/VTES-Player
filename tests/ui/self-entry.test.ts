/**
 * A minion's own card text reaches play as a SELF-ATTACHED entry — that is
 * what lets the whole `permanent` vocabulary reach a crypt ability, an
 * ally's text and a token vampire's card without a second set of rules
 * (docs/crypt-plan.md §2, docs/wraith-zombie-design.md §2). The engine's
 * test for one is that its card id IS the minion's id (`minionTags`).
 *
 * It is not a card on the table, though, and drawing it put a small
 * duplicate of the vampire underneath itself. The table hides it.
 *
 * The property that matters is the SECOND test here, not the first: an
 * option indexed under a card nothing draws would vanish from the table
 * AND the action bar, and a missing option looks exactly like an illegal
 * one. Hiding this one is safe precisely because the self entry shares the
 * minion's id, so the minion tile already carries its actions.
 */

import { describe, expect, it } from "vitest";
import type { DecisionPoint } from "../../src/engine/index.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { render } from "../../src/ui/render.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** V1, carrying its own crypt card AND a real piece of equipment. */
function tableWithSelfEntry() {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  v1.attached.push(
    {
      // The self entry: card id === minion id.
      card: { id: v1.id, name: v1.name },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
    },
    {
      card: { id: "gun1", name: ".44 Magnum" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["weapon", "gun"],
    },
  );
  return { state, v1 };
}

function screen(state: unknown, dp: DecisionPoint | null): string {
  return render({
    state,
    dp,
    eventFilter: "",
    canUndo: false,
    canRewind: true,
    omniscient: true,
    selectedCard: null,
    handOrder: [],
    settingsOpen: false,
    helpOpen: false,
    helpOpenSections: [],
    helpQuery: "",
    autoPass: {},
    aiSeats: {},
    thinking: false,
    aiDelayMs: 0,
    cardTextPx: 15,
    seatFaces: {},
    localSeat: null,
    ashOpen: null,
    canLeave: false,
    canChat: false,
    canModerate: false,
    moderation: null,
  } as RenderInput);
}

describe("a minion's own card is not drawn twice", () => {
  it("hides the self-attached entry and keeps every real attachment", () => {
    const { state, v1 } = tableWithSelfEntry();
    const html = screen(state, null);

    // The equipment is still there, in the attachment strip.
    expect(html).toContain(`class="attached-card`);
    expect(html).toContain(".44 Magnum");

    // The vampire is drawn once: as a minion, never as an attachment.
    const asAttachment = html.split(`class="attached-card`).slice(1);
    for (const chunk of asAttachment) {
      expect(chunk.slice(0, 400)).not.toContain(v1.name);
    }
    // And exactly one tile claims the minion's id.
    const claims = html.split(`data-tcard="${v1.id}"`).length - 1;
    expect(claims).toBe(1);
  });

  it("a minion with ONLY its own card gets no attachment strip at all", () => {
    // The control: an empty strip must not be drawn as an empty box.
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.attached.push({
      card: { id: v1.id, name: v1.name },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
    });
    expect(screen(state, null)).not.toContain(`class="attached-cards"`);
  });

  it("STILL offers the ability that lives on the hidden card", () => {
    // The safety property. A crypt ability's option names the self entry
    // as its `source`; that id is the minion's, so the minion tile lights
    // and badges it. Nothing became unreachable by hiding the card.
    const { state, v1 } = tableWithSelfEntry();
    const dp: DecisionPoint = {
      seq: 1,
      seat: "Alice",
      window: "turn.minion",
      options: [
        { id: "pass", kind: "pass", label: "Pass" },
        {
          id: `ability:Crypt Ability:${v1.id}`,
          kind: "useAbility",
          label: "Use the ability",
          source: v1.id, // the self entry
          params: {},
        },
      ],
    };
    const html = screen(state, dp);

    // The minion tile is lit and badged with its one action. (The class
    // sits BEFORE `data-minion` in the tag, so read the opening tag whole
    // rather than splitting forwards from the id.)
    const tag = new RegExp(`<div class="minion [^"]*" *\\n? *data-minion="${v1.id}"`);
    expect(html).toMatch(tag);
    expect(html.match(tag)![0]).toContain("actionable");
    const tile = html.split(`data-minion="${v1.id}"`)[1] ?? "";
    expect(tile.slice(0, 800)).toContain(`class="playdot"`);
    // ...and the option is NOT left stranded on the action bar as well.
    expect(html).toContain("On the table");
  });
});
