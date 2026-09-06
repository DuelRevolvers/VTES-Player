/**
 * Decision points and legal options — the contract between the sequencing
 * machine and every Agent (human UI, AI, multiplayer host validation).
 * The engine only ever offers options from this vocabulary; agents only
 * ever answer with one of the offered option ids (design §1, §6).
 */

import type {
  ActionKind,
  CardInstanceId,
  DisciplineLevel,
  MinionId,
  SeatId,
  StrikeKind,
} from "./state.ts";

/** Stable public window names — the vocabulary card handlers register
 *  against (design §2.3). */
export type WindowId =
  | "turn.unlock"
  | "turn.master"
  | "turn.minion"
  | "turn.influence"
  | "turn.discard"
  | "action.announce"
  | "action.effects"
  /** After the action has resolved, before its frame leaves the stack
   *  (Freak Drive) — docs/after-resolution-design.md. */
  | "action.afterResolution"
  | "card.asPlayed"
  | "combat.beforeRange"
  | "combat.range"
  | "combat.beforeStrikes"
  | "combat.chooseStrike"
  | "combat.damageResolution"
  | "combat.press"
  | "combat.endOfRound"
  | "referendum.terms"
  | "referendum.polling"
  /** After a PASSED referendum has been tallied, before its frame leaves
   *  the stack (docs/referendum-margin-design.md §2). */
  | "referendum.afterResolution"
  | "diablerie.offer"
  /** A card asking one Methuselah a question (docs/choice-frames-design.md). */
  | "choice";

export type LegalOption =
  | { id: string; kind: "pass"; label: string }
  | {
      id: string;
      kind: "takeAction";
      label: string;
      minion: MinionId;
      action: ActionKind;
      /** Torpor target for diablerize/rescue (rush-style targeting). */
      targetMinion?: MinionId;
      /** Rescue only: blood paid by the acting vampire (0/1/2), the rest
       *  by the rescued vampire (p. 23 split cost). */
      rescueActorPortion?: number;
    }
  | { id: string; kind: "endMinionPhase"; label: string }
  | { id: string; kind: "gainEdgePool"; label: string }
  | { id: string; kind: "discard"; label: string; card: CardInstanceId }
  | {
      id: string;
      kind: "playCard";
      label: string;
      card: CardInstanceId;
      name: string;
      minion: MinionId | null;
      mode: DisciplineLevel | null;
      params: Record<string, string>;
      /** What this play costs, LIVE — the printed cost plus every
       *  modifier in force (docs/play-cost-design.md). The enumerator
       *  computed it to decide the card was affordable; reporting it lets
       *  the UI price the button and an agent weigh one play against
       *  another, instead of each re-deriving it
       *  (docs/richer-options-design.md §2).
       *
       *  Optional because a hand-rolled handler may not supply one; every
       *  spec-compiled card does. */
      cost?: { blood: number; pool: number };
    }
  /** An answer to a ChoiceFrame;  carries the picked value(s). */
  | {
      id: string;
      kind: "answerChoice";
      label: string;
      params: Record<string, string>;
      /**
       * The NAME of the card this answer picks, when it picks one.
       *
       * A search's candidates are card ids in a zone the viewer cannot
       * read — `redactFor` masks every library including your own — so
       * without this the only place the name exists is inside the label,
       * as prose. The engine is the only thing that knows which card an
       * option is about (docs/richer-options-design.md §1), so it says.
       *
       * Backfilled centrally in `choiceOptionsFor` rather than by each
       * handler, so a handler cannot forget it — the
       * `backfillCentralQueries` pattern.
       */
      card?: string;
    }
  /**
   * A block attempt, WITH the numbers that decide it.
   *
   * The enumerator already computes all three to decide the option is
   * legal at all, and used to throw them away — so the UI put the totals
   * elsewhere on screen for the player to compare themselves, and the AI
   * had to cross-reference `PlayerView`. The engine is the only thing
   * that actually knows; when it does not say, every consumer re-derives
   * it (docs/richer-options-design.md §1).
   */
  | {
      id: string;
      kind: "declareBlock";
      label: string;
      minion: MinionId;
      /** This minion's intercept against this action, as it stands. */
      intercept: number;
      /** The acting minion's stealth, as it stands. */
      stealth: number;
      /** Whether the attempt would succeed RIGHT NOW (p. 26: intercept ≥
       *  stealth). Not a promise — either side may still play a card. */
      wouldSucceed: boolean;
      /** Blood or life this minion pays to ATTEMPT (docs/block-tax-design.md).
       *  Paid to attempt, not to succeed. */
      toll: number;
    }
  | {
      id: string;
      kind: "chooseStrike";
      label: string;
      strike: StrikeKind;
      /** Which equipment a `burnEquipment` strike destroys — chosen with
       *  the strike, so it rides in the option id. */
      params?: Record<string, string>;
    }
  | { id: string; kind: "usePress"; label: string; toContinue: boolean }
  | {
      id: string;
      kind: "useAbility";
      label: string;
      /** Card instance in play providing the ability. */
      source: CardInstanceId;
      params: Record<string, string>;
    }
  /** An action granted by a card in play ("can enter combat as a Ⓓ
   *  action" — rush design §2.5): announcing it locks the minion and
   *  marks the copy used for the turn (p. 20). */
  | {
      id: string;
      kind: "useEntryAction";
      label: string;
      source: CardInstanceId;
      minion: MinionId;
      params: Record<string, string>;
    }
  /** Spend a "1 optional maneuver during that combat" credit. */
  | { id: string; kind: "useManeuver"; label: string }
  /** Spend a "can prevent N damage during the resulting combat" credit
   *  (Beast Meld) — one point of prevention, repeatable while credit
   *  remains. */
  | { id: string; kind: "preventCredit"; label: string }
  /** "Burn 1 blood for +1 intercept during this action" (Eyes of the
   *  Wild) — a repeatable grant recorded on the action frame. */
  | { id: string; kind: "burnForIntercept"; label: string; minion: MinionId }
  /** "…can burn 1 blood during your next discard phase to unlock"
   *  (Fiendish Tongue) — a permission recorded on the MINION, because the
   *  action card that granted it was burnt at resolution.
   *  docs/last-buildable-design.md §1 */
  | { id: string; kind: "burnForUnlock"; label: string; minion: MinionId }
  /** The blocking seat withdrawing an attempt already underway (Dawn
   *  Operation) — not a failure: they may attempt again. */
  | { id: string; kind: "cancelBlock"; label: string; minion: MinionId }
  /** "Their controller can burn N pool to cancel this card as it is
   *  played" (Golconda: Inner Peace) — a cancel paid in POOL, with no
   *  card involved, offered as a built-in in the as-played window the
   *  paying seat is already cycled through.
   *  docs/cross-table-masters-design.md §2 */
  | {
      id: string;
      kind: "payToCancel";
      label: string;
      pool: number;
      /** Which cards the payment discards, when the currency is cards
       *  rather than pool (Target Vitals). */
      params?: Record<string, string>;
    }
  /** Referendum terms — the caller's choices, made only on success
   *  (p. 25 exception, p. 27). */
  | { id: string; kind: "chooseTerms"; label: string; params: Record<string, string> }
  /** Cast all votes from one source, for or against (p. 28). */
  | {
      id: string;
      kind: "castVote";
      label: string;
      /** Minion id, "edge", "caller", or "card:<cardInstanceId>". */
      source: string;
      count: number;
      inFavor: boolean;
      /** Blood the CASTING VAMPIRE burns to cast this way (Alexander
       *  Silverson). Already checked affordable — an option carrying a
       *  toll the voter cannot pay is not enumerated.
       *  docs/crypt-wave-6.md §2 */
      toll?: number;
    }
  /** A blocking vampire's chance to diablerise the acting torpor vampire
   *  after a blocked leave-torpor (p. 24). */
  | { id: string; kind: "diablerizeOffer"; label: string }
  // Influence phase (p. 35–36).
  | { id: string; kind: "transferToVampire"; label: string; minion: MinionId }
  | { id: string; kind: "transferToPool"; label: string; minion: MinionId }
  | { id: string; kind: "cryptDraw"; label: string }
  | { id: string; kind: "influenceOut"; label: string; minion: MinionId };

export interface DecisionPoint {
  seq: number;
  seat: SeatId;
  window: WindowId;
  options: LegalOption[];
}

export function passOption(label = "Pass"): LegalOption {
  return { id: "pass", kind: "pass", label };
}
