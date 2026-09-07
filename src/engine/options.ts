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

/**
 * The family of thing a play does — a coarse summary, not a description
 * (docs/richer-options-design.md §5).
 *
 * The vocabulary is deliberately small: it is what a player reads off a
 * card at a glance, and what a scoring policy can actually weigh. The
 * mapping from the card vocabulary onto these lives in the cards layer
 * (`src/cards/effects/summary.ts`), because that is where the primitives
 * are defined; the type lives here because an option is the engine's.
 */
export type PlayEffectTag =
  | "bleed"
  | "stealth"
  | "intercept"
  | "poolGain"
  | "poolDrain"
  | "bloodGain"
  | "damage"
  | "prevent"
  | "combat"
  | "votes"
  | "unlock"
  | "wake"
  | "deny"
  | "steal"
  | "board"
  | "search";

/** One family of effect, with its size when it has one. An ABSENT amount
 *  means the effect is not counted in units (a cancel, a wake) — it does
 *  NOT mean zero, and a reader that defaults it to zero will price every
 *  such card as doing nothing. */
export interface PlayEffect {
  tag: PlayEffectTag;
  amount?: number;
}

export type LegalOption =
  | { id: string; kind: "pass"; label: string }
  | {
      id: string;
      kind: "takeAction";
      label: string;
      minion: MinionId;
      action: ActionKind;
      /**
       * A BLEED's live value, if this is one — the number the action would
       * announce at, with every static, aura and conditional already in
       * it, not the minion's printed `bleedAmount`.
       *
       * The engine computed it to build this option; leaving it out meant
       * every reader guessed. The AI guessed with the printed field and so
       * could not see that a card in play had made a bleed worth three,
       * and the screen could not say so either
       * (docs/richer-options-design.md).
       */
      bleed?: number;
      /**
       * A HUNT's live gain — what this vampire would actually put on
       * itself, which is the hunt amount capped by what it can still hold
       * (p. 6: excess goes to the blood bank, not to the Methuselah).
       *
       * ZERO IS A REAL ANSWER and the useful one: a vampire at capacity
       * gains nothing by hunting, and the option is still legal because
       * hunting triggers cards that care (docs/futile-options-design.md
       * keeps the hunt deliberately ungated for exactly that reason). The
       * enumerator knows the number; without it a reader has to re-derive
       * capacity, auras and all.
       */
      gain?: number;
      /** Torpor target for diablerize/rescue (rush-style targeting). */
      targetMinion?: MinionId;
      /** Rescue only: blood paid by the acting vampire (0/1/2), the rest
       *  by the rescued vampire (p. 23 split cost). */
      rescueActorPortion?: number;
    }
  | { id: string; kind: "endMinionPhase"; label: string }
  /** "Announce your intent to withdraw during your unlock phase" (p. 38) —
   *  offered only when the library is exhausted and the hand is short. */
  | { id: string; kind: "announceWithdrawal"; label: string }
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
      /** What this play would DO, in families
       *  (docs/richer-options-design.md §5). Empty for a card whose whole
       *  content is outside the summary vocabulary — which is a real
       *  answer, not a missing one. */
      effects?: PlayEffect[];
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
  | {
      id: string;
      kind: "transferToVampire";
      label: string;
      minion: MinionId;
      /**
       * How many cards in this Methuselah's HAND this vampire could
       * actually play — its Disciplines, clan, sect, title and capacity
       * against every card's requirements
       * (docs/richer-options-design.md §7).
       *
       * Influence is the single largest class of real choice in a game
       * (39.6%), and the policy could not ask this: a card's requirements
       * live in the handler registry, which an agent has no access to and
       * should not — re-deriving them would be a second model of the pool.
       * The engine already answers it centrally with `modesPlayableBy`.
       *
       * Measured: the candidates differ on this in 28.1% of the influence
       * choices that have more than one candidate.
       */
      playableCards?: number;
    }
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
