/**
 * The game log in plain English.
 *
 * `GameEvent` is the engine's internal record — precise, and unreadable to
 * a player ("BleedAmountModified actionId=action-12 delta=1"). This turns
 * each event into a sentence about what happened at the table.
 *
 * Two rules:
 *  - Names, not ids. A minion id means nothing to a human, so every event
 *    is rendered against the state to resolve `V1` to "Nikolaus Vermeulen".
 *  - Never leak. The log is rendered from the same redacted state the table
 *    is, so a card the viewer may not see is described as "a card".
 *
 * Anything without a sentence falls through to a readable last resort
 * rather than being hidden — an unnarrated event is a gap to fill, not a
 * thing to swallow.
 */

import type { GameEvent, GameState, MinionId } from "../engine/index.ts";
import { isFaceDown } from "../engine/index.ts";

/** How important a line is — the log dims the routine bookkeeping. */
export type LogWeight = "major" | "normal" | "minor";

export interface LogLine {
  text: string;
  weight: LogWeight;
}

/** Resolve a minion id to its name, wherever it is on the table. */
export function minionName(state: GameState, id: MinionId | null | undefined): string {
  if (!id) return "someone";
  for (const seat of state.seats) {
    for (const m of seat.minions) if (m.id === id) return isFaceDown(m) ? "a vampire" : m.name;
    for (const u of seat.uncontrolled) {
      if (u.card.id === id) return isFaceDown(u.card) ? "a face-down vampire" : u.card.name;
    }
    for (const m of seat.crypt) if (m.id === id) return "a vampire in the crypt";
  }
  // Burned or otherwise gone: the log still has to name it.
  for (const ev of state.eventLog) {
    if (ev.type === "AllyEnteredPlay" && ev.minion === id) return ev.name;
    if (ev.type === "VampireTokenEnteredPlay" && ev.minion === id) return ev.name;
  }
  return id;
}

/** "Alice's Nikolaus Vermeulen" — a minion with its controller. */
export function owned(state: GameState, id: MinionId | null | undefined): string {
  if (!id) return "someone";
  for (const seat of state.seats) {
    if (seat.minions.some((m) => m.id === id)) {
      return `${seat.id}'s ${minionName(state, id)}`;
    }
  }
  return minionName(state, id);
}

/** A card name the viewer is allowed to read, or a neutral placeholder. */
function cardName(state: GameState, cardId: string, known?: string): string {
  if (known && !isFaceDown({ name: known })) return known;
  for (const seat of state.seats) {
    for (const c of seat.hand) {
      if (c.id === cardId) return isFaceDown(c) ? "a card" : c.name;
    }
  }
  return known && known.length > 0 ? known : "a card";
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/**
 * One event as a sentence, or null to omit it — used only for events that
 * are pure internal bookkeeping with no table-visible effect.
 */
export function narrate(ev: GameEvent, state: GameState): LogLine | null {
  const M = (id: MinionId | null | undefined): string => owned(state, id);
  const m = (id: MinionId | null | undefined): string => minionName(state, id);

  switch (ev.type) {
    // -- turn structure ----------------------------------------------------
    case "TurnBegan":
      return { text: `— ${ev.seat}'s turn ${ev.turnNumber} —`, weight: "major" };

    // -- actions -----------------------------------------------------------
    case "ActionAnnounced": {
      const who = M(ev.acting);
      const at = ev.target ? ` targeting ${ev.target}` : "";
      const kind =
        ev.actionKind === "bleed"
          ? `bleeds ${ev.target ?? "their prey"}`
          : ev.actionKind === "hunt"
            ? "hunts"
            : ev.actionKind === "leaveTorpor"
              ? "tries to leave torpor"
              : ev.actionKind === "diablerize"
                ? "attempts diablerie"
                : ev.actionKind === "rescue"
                  ? "attempts a rescue"
                  : `takes an action${at}`;
      return { text: `${who} ${kind}.`, weight: "major" };
    }
    case "ActionResolved":
      return {
        text: ev.success ? "The action succeeds." : "The action fails.",
        weight: "normal",
      };
    case "CardPlayed":
      return {
        text: `${ev.minion ? M(ev.minion) : ev.seat} plays ${ev.name}${
          ev.mode === "superior" ? " (superior)" : ""
        }.`,
        weight: "normal",
      };
    case "CardCanceled":
      return { text: `${ev.name} is cancelled.`, weight: "major" };
    case "TargetChanged":
      return { text: `The action is redirected from ${ev.from} to ${ev.to}.`, weight: "major" };

    // -- blocking ----------------------------------------------------------
    case "BlockDeclared":
      return { text: `${M(ev.blocker)} attempts to block.`, weight: "normal" };
    case "BlockSucceeded":
      return { text: `${m(ev.blocker)} blocks!`, weight: "major" };
    case "BlockFailed":
      return { text: `${m(ev.blocker)} fails to block.`, weight: "normal" };
    case "BlockAttemptCancelled":
      // Withdrawing is a choice, not a failure — the log has to say which.
      return { text: `${M(ev.blocker)} withdraws from the block.`, weight: "normal" };
    case "StealthModified":
      return {
        text: `Stealth ${ev.delta >= 0 ? "+" : ""}${ev.delta} (${ev.source}).`,
        weight: "minor",
      };
    case "InterceptModified":
      return {
        text: `${m(ev.minion)}: intercept ${ev.delta >= 0 ? "+" : ""}${ev.delta} (${ev.source}).`,
        weight: "minor",
      };
    case "ActionInterceptModified":
      return {
        text: `All minions: intercept ${ev.delta >= 0 ? "+" : ""}${ev.delta} (${ev.source}).`,
        weight: "minor",
      };
    case "BlockCostImposed":
      return {
        text: `Blocking this action now costs ${plural(ev.amount, "blood")} (${ev.source}).`,
        weight: "normal",
      };
    case "BleedAmountModified":
      return {
        text: `Bleed ${ev.delta >= 0 ? "+" : ""}${ev.delta} (${ev.source}).`,
        weight: "minor",
      };

    // -- combat ------------------------------------------------------------
    case "CombatBegan":
      return { text: `Combat: ${m(ev.acting)} vs ${m(ev.opposing)}.`, weight: "major" };
    case "RangeSet":
      return { text: `Range is now ${ev.range}.`, weight: "minor" };
    case "StrikeChosen":
      return { text: `${m(ev.minion)} strikes: ${ev.strike}.`, weight: "normal" };
    case "DamageInflicted":
      return {
        text: `${m(ev.minion)} takes ${plural(ev.amount, "damage", "damage")}${
          ev.aggravated ? " (aggravated)" : ""
        }.`,
        weight: "normal",
      };
    case "DamagePrevented":
      return { text: `${m(ev.minion)} prevents ${plural(ev.amount, "damage", "damage")}.`, weight: "normal" };
    case "DamageMended":
      return { text: `${m(ev.minion)} mends ${plural(ev.amount, "damage", "damage")}.`, weight: "minor" };
    case "WentToTorpor":
      return { text: `${M(ev.minion)} goes to torpor.`, weight: "major" };
    case "CombatEnded":
      return { text: `Combat ends after ${plural(ev.rounds, "round")}.`, weight: "normal" };
    case "PressUsed":
      return {
        text: ev.toContinue ? `${ev.seat} presses to continue combat.` : `${ev.seat} cancels the press.`,
        weight: "normal",
      };
    case "StrengthSet":
      return { text: `${m(ev.minion)}: strength set to ${ev.value}.`, weight: "minor" };

    // -- counters ----------------------------------------------------------
    case "BloodGained":
      return { text: `${M(ev.minion)} gains ${plural(ev.amount, "blood")}.`, weight: "normal" };
    case "BloodBurned":
      return { text: `${M(ev.minion)} burns ${plural(ev.amount, "blood")}.`, weight: "normal" };
    case "PoolGained":
      return { text: `${ev.seat} gains ${plural(ev.amount, "pool")}.`, weight: "normal" };
    case "PoolBurned":
      return { text: `${ev.seat} burns ${plural(ev.amount, "pool")}.`, weight: "major" };
    case "EdgeTaken":
      return { text: `${ev.seat} takes the Edge.`, weight: "normal" };

    // -- minions in and out ------------------------------------------------
    case "MinionLocked":
      return { text: `${m(ev.minion)} locks.`, weight: "minor" };
    case "MinionUnlocked":
      return { text: `${m(ev.minion)} unlocks.`, weight: "minor" };
    case "MinionWoke":
      return { text: `${m(ev.minion)} wakes.`, weight: "minor" };
    case "MinionBurned":
      return { text: `${M(ev.minion)} is burned.`, weight: "major" };
    case "VampireEnteredPlay":
      return {
        text: `${ev.seat} brings ${minionName(state, ev.minion)} into play with ${plural(ev.blood, "blood")}.`,
        weight: "major",
      };
    case "AllyEnteredPlay":
      return { text: `${ev.seat} brings ${ev.name} into play.`, weight: "major" };
    case "VampireTokenEnteredPlay": {
      // "a capacity-1 anarch Brujah vampire" / "a capacity-1 vampire".
      const kind = [ev.sect, ev.clan, "vampire"].filter(Boolean).join(" ");
      return {
        text: `${ev.seat} creates ${ev.name}, a capacity-${ev.capacity} ${kind} with no blood.`,
        weight: "major",
      };
    }
    case "CardLeftZone":
      return {
        text: `${ev.seat} takes ${ev.name} from their ${
          ev.zone === "ashHeap" ? "ash heap" : ev.zone
        }.`,
        weight: "minor",
      };
    case "ControlChanged":
      return {
        text: `${ev.target === "minion" ? m(ev.id) : "A card"} now answers to ${ev.to}.`,
        weight: "major",
      };

    // -- cards in play -----------------------------------------------------
    case "PermanentEnteredPlay":
      return {
        text: `${ev.seat} puts ${ev.name} into play${
          ev.attachedTo ? ` on ${m(ev.attachedTo)}` : ""
        }.`,
        weight: "normal",
      };
    case "PermanentBurned":
      return { text: `${ev.name} is burned.`, weight: "normal" };
    case "PermanentLocked":
      return { text: `${cardName(state, ev.cardId)} is locked.`, weight: "minor" };
    case "CardBurned":
      return { text: `${ev.name} goes to the ash heap.`, weight: "minor" };

    // -- hidden zones (never name a card the viewer cannot see) ------------
    case "CardDrawn":
      return { text: `${ev.seat} draws ${cardName(state, ev.cardId)}.`, weight: "minor" };
    case "CardDiscarded":
      return { text: `${ev.seat} discards ${cardName(state, ev.cardId)}.`, weight: "minor" };
    case "CryptCardDrawn":
      return { text: `${ev.seat} draws a vampire from their crypt.`, weight: "minor" };
    case "LibraryShuffled":
      return { text: `${ev.seat} shuffles their library.`, weight: "minor" };
    case "CardStored":
      // A face-DOWN store must not name the card: the log is rendered
      // against the same redacted state the table sees, and `cardName`
      // resolves a hidden card to a placeholder, but the event itself
      // carries the real name, so it is only used when it is public.
      return {
        text: ev.faceUp
          ? `${ev.seat} puts ${ev.name} on ${cardName(state, ev.holder)}, out of play.`
          : `${ev.seat} puts a card face down on ${cardName(state, ev.holder)}.`,
        weight: "minor",
      };
    case "StoredCardDrawn":
      return {
        text: `${ev.seat} draws from ${cardName(state, ev.holder)} instead of their library.`,
        weight: "minor",
      };

    // -- politics ----------------------------------------------------------
    case "ReferendumCalled":
      return { text: `${ev.seat} calls a referendum with ${ev.cardName}.`, weight: "major" };
    case "VoteCast":
      return {
        text: `${ev.seat} casts ${plural(ev.count, "vote")} ${ev.inFavor ? "for" : "against"}.`,
        weight: "normal",
      };
    case "ReferendumResolved":
      return {
        text: `The referendum ${ev.passed ? "PASSES" : "fails"} (${ev.votesFor} for, ${ev.votesAgainst} against).`,
        weight: "major",
      };

    // -- endgame -----------------------------------------------------------
    case "Ousted":
      return { text: `${ev.seat} is ousted!`, weight: "major" };
    case "WithdrawalAnnounced":
      return {
        text: `${ev.seat} announces a withdrawal from the game — it succeeds at their next unlock phase if they lose no blood or pool and fight nothing.`,
        weight: "major",
      };
    case "WithdrawalFailed":
      return { text: `${ev.seat}'s withdrawal fails: ${ev.why}.`, weight: "major" };
    case "Withdrew":
      return {
        text: `${ev.seat} withdraws from the game for 1 victory point. Their predator gets nothing.`,
        weight: "major",
      };
    case "CardsRevealed":
      // WHAT was seen is deliberately not named: the log is read by
      // whoever is at the screen, and the look is the actor's alone.
      return {
        text: `${ev.to} looks at ${ev.cards.length} card${ev.cards.length === 1 ? "" : "s"}.`,
        weight: "normal",
      };
    case "VictoryPointGained":
      return { text: `${ev.seat} gains a victory point.`, weight: "major" };

    default: {
      // Readable last resort: the event name spaced out, plus its scalar
      // fields. A gap to fill, not a thing to hide.
      const { type, ...rest } = ev as GameEvent & Record<string, unknown>;
      const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const detail = Object.entries(rest)
        .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
        .map(([, v]) => String(v))
        .join(" ");
      return { text: `${words}${detail ? ` (${detail})` : ""}.`, weight: "minor" };
    }
  }
}
