/**
 * The sequencing engine (design §2): compute whose decision it is and the
 * complete list of legal options; apply the chosen option; repeat.
 *
 * Structure:
 *  - decision()  — settle automatic transitions, then build the current
 *                  DecisionPoint from the top frame. Idempotent.
 *  - choose(id)  — apply one offered option, append to the command log.
 *  - settle()    — perform every transition that requires no decision
 *                  (quiescent windows closing, block/strike/action
 *                  resolution, phase advances, ousting, game end).
 *  - emit(ev)    — the single mutation channel: log the event, apply it
 *                  to entities, apply frame reactions (e.g. TargetChanged
 *                  reopening blocks, §3.4).
 */

import {
  actionUnblockable,
  auraBonus,
  conditionalStaticNoAction,
  opposingGrantedStrength,
  uncontrolledCanTakeCounters,
  blockEligibleSeats,
  blockTollFor,
  rescueDiscountFor,
  blockWouldSucceed,
  capacityOf,
  huntAmountFor,
  huntGain,
  libraryBlockToll,
  currentBleed,
  currentIntercept,
  currentStealth,
  defendersFor,
  handSizeOf,
  auraBlocksHunt,
  actionKeyOf,
  canRepeatAction,
  heldHostage,
  playCostFor,
  untargetableBy,
  playCostModApplies,
  predatorOf,
  preyOf,
  prospectiveBleed,
  sequencingOrder,
  startingLifeBonus,
  titleContestKey,
  unlockSuppressed,
} from "./derived.ts";
import { rngInt } from "./rng.ts";
import type {
  CardActionParams,
  CardHandler,
  CardStrikeParams,
  EngineOps,
  HandlerRegistry,
  PlayContext,
} from "./handlers.ts";
import type { DecisionPoint, LegalOption, WindowId } from "./options.ts";
import { passOption } from "./options.ts";
import type {
  ActionFrame,
  ActionKind,
  BlockAttemptFrame,
  CardInstance,
  CardInstanceId,
  CardPlayFrame,
  AfterCombatRider,
  ChoiceFrame,
  CombatFrame,
  CombatRoundDamageRider,
  ContestedCard,
  DisciplineLevel,
  Frame,
  GameEvent,
  GameState,
  HandSizeGrant,
  MinionId,
  RushRiders,
  MinionState,
  PermanentAura,
  PermanentInPlay,
  PermanentCostSource,
  PermanentCounterSink,
  PendingDamage,
  PermanentStatics,
  PlayCostCardType,
  PlayCostMod,
  ReferendumFrame,
  Sect,
  SeatId,
  Strike,
  StrikeKind,
  GrantedStrike,
  TurnFrame,
} from "./state.ts";
import { HAND_STRIKE, TITLE_VOTES } from "./state.ts";
import {
  canAct,
  canReact,
  cyclePass,
  cycleQuiescent,
  cycleRewind,
  cycleSeat,
  findMinion,
  findUncontrolled,
  getMinion,
  getSeat,
  isReady,
  newCycle,
  standingSeats,
} from "./state.ts";


/**
 * The one `ChoiceFrame` key the ENGINE answers rather than a card
 * handler: p. 7's "immediately discard down … to match your hand size",
 * reached when a timed hand-size bonus lapses.
 * docs/temporary-hand-size-design.md §4
 */
const HAND_SIZE_DOWN = "handSizeDown";
/** Diablerie step 4 (p. 34): the older-victim Discipline gain. An
 *  ENGINE-owned choice key like the discard-down — it is a rule of the
 *  game, and no card is involved in it at all. */
const DIABLERIE_DISCIPLINE = "diablerieDiscipline";
/** Paying for, or yielding, a contest during your unlock phase (p. 17-18).
 *  Engine-owned for the same reason again: it is a rule of the game, and
 *  a contest can be over a card whose handler knows nothing about it — or
 *  over a title, where there is no card to ask at all.
 *  docs/contested-design.md §4 */
const CONTEST = "contest";

/** "<cardId>/<blood>/<pool>[,…]" — the payment split a play option carried
 *  (docs/cost-sources-design.md §4). */
function parsePayFrom(
  raw: string | undefined,
): Array<{ cardId: CardInstanceId; blood: number; pool: number }> {
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const [cardId, blood, pool] = part.split("/");
    if (!cardId) throw new Error(`bad payFrom: ${raw}`);
    return { cardId, blood: Number(blood ?? 0), pool: Number(pool ?? 0) };
  });
}

/** Prevention points a combatant can still spend on the current damage:
 *  the round-1 pool (Precognition), whatever is left of a per-round RATE
 *  (Bear's Skin superior, Tranquility Shield) and the combat-long pool
 *  (Beast Meld). docs/round-recurring-combat-design.md §2 */
function preventPoints(cf: CombatFrame, side: "acting" | "opposing"): number {
  return (
    cf.preventCredits[side] +
    (cf.round === 1 ? cf.preventCreditsFirstRound[side] : 0) +
    Math.max(0, cf.preventPerRound[side] - cf.preventPerRoundUsed[side])
  );
}

export class VtesEngine implements EngineOps {
  constructor(
    public readonly state: GameState,
    readonly registry: HandlerRegistry,
  ) {}

  /** Fresh action ids. The counter lives in `GameState`, NOT in a module
   *  variable: two engines in one process (a replay for undo, a batch of
   *  AI simulations) must each start from 1, or the same command log
   *  reproduces a game whose ids differ from the original — which would
   *  break the reproduction guarantee `commandLog` documents. */
  private freshId(prefix: string): string {
    this.state.idSeq = (this.state.idSeq ?? 0) + 1;
    return `${prefix}${this.state.idSeq}`;
  }

  /** While an action is resolving, choices are queued rather than pushed:
   *  the action pops its own frame at the end, which would take a choice
   *  frame with it (docs/choice-frames-design.md §3). Transient — never
   *  part of the serializable state, because it is always empty between
   *  decisions. */
  private deferChoices = false;
  private deferredChoices: Array<Parameters<VtesEngine["raiseChoice"]>[0]> = [];

  // -- frame helpers --------------------------------------------------------

  private top(): Frame | null {
    return this.state.frames.at(-1) ?? null;
  }

  private pop(): void {
    this.state.frames.pop();
  }

  action(): ActionFrame | null {
    for (let i = this.state.frames.length - 1; i >= 0; i--) {
      const f = this.state.frames[i];
      if (f && f.kind === "action") return f;
    }
    return null;
  }

  /** Whose game turn it is (the turn frame sits at the bottom of the
   *  stack). Cards that say "during your X phase" compare their controller
   *  to this, since some phase windows are offered to every seat. */
  private turnSeat(): SeatId {
    const tf = this.state.frames[0];
    return tf && tf.kind === "turn" ? tf.seat : this.state.seats[0]!.id;
  }

  private referendum(): ReferendumFrame | null {
    for (let i = this.state.frames.length - 1; i >= 0; i--) {
      const f = this.state.frames[i];
      if (f && f.kind === "referendum") return f;
    }
    return null;
  }

  /**
   * Send a card that was set aside for an action back to its owner's hand
   * (Telepathic Vote Counting). "Discard down afterward" is the owner's
   * problem and is raised as a choice by the card that caused it — the
   * hand can belong to a Methuselah other than the one who played it.
   */
  private returnCardToHand(seat: SeatId, cardId: CardInstanceId, name: string): void {
    this.emit({ type: "CardReturnedToHand", cardId, name, seat });
  }

  private blockAttempt(): BlockAttemptFrame | null {
    for (let i = this.state.frames.length - 1; i >= 0; i--) {
      const f = this.state.frames[i];
      if (f && f.kind === "blockAttempt") return f;
    }
    return null;
  }

  private combatFrame(): CombatFrame | null {
    for (let i = this.state.frames.length - 1; i >= 0; i--) {
      const f = this.state.frames[i];
      if (f && f.kind === "combat") return f;
    }
    return null;
  }

  private requireCombat(): CombatFrame {
    const cf = this.combatFrame();
    if (!cf) throw new Error("no combat in progress");
    return cf;
  }

  private referendumFrame(): ReferendumFrame | null {
    for (let i = this.state.frames.length - 1; i >= 0; i--) {
      const f = this.state.frames[i];
      if (f && f.kind === "referendum") return f;
    }
    return null;
  }

  private sideOf(cf: CombatFrame, minion: MinionId | null): "acting" | "opposing" {
    if (minion === cf.acting) return "acting";
    if (minion === cf.opposing) return "opposing";
    throw new Error(`minion ${minion} is not a combatant`);
  }

  private findEntry(cardId: string): PermanentInPlay | null {
    for (const seat of this.state.seats) {
      const p = seat.permanents.find((x) => x.card.id === cardId);
      if (p) return p;
      for (const m of seat.minions) {
        const a = m.attached.find((x) => x.card.id === cardId);
        if (a) return a;
      }
    }
    return null;
  }

  private findPermanent(cardId: string): PermanentInPlay {
    const entry = this.findEntry(cardId);
    if (!entry) throw new Error(`no permanent in play: ${cardId}`);
    return entry;
  }

  /** Which Methuselah controls a card in play (p. 16). A recorded
   *  `controller` wins — a master card is controlled by the Methuselah who
   *  played it "even if it is played on a card controlled by another
   *  Methuselah". Absent that, the holder: the seat for a seat-level
   *  entry, the bearer's controller for a minion card (equipment,
   *  retainers), which is the p. 16 default. */
  /** The Methuselah controlling a card in play; null if it is gone.
   *  Public because a card effect needs it to aim at a permanent. */
  controllerOfEntry(cardId: CardInstanceId): SeatId | null {
    for (const seat of this.state.seats) {
      const own = seat.permanents.find((x) => x.card.id === cardId);
      if (own) return own.controller ?? seat.id;
      for (const m of seat.minions) {
        const att = m.attached.find((x) => x.card.id === cardId);
        if (att) return att.controller ?? m.controller;
      }
    }
    return null;
  }

  changeMinionControl(minionId: MinionId, to: SeatId): void {
    const m = getMinion(this.state, minionId);
    if (m.controller === to) return;
    // "You cannot voluntarily contest cards with yourself (IF SOME EFFECT
    // WOULD FORCE YOU TO CONTEST A CARD WITH YOURSELF, THEN YOU SIMPLY
    // BURN THE INCOMING COPY of the unique card)" (p. 17). Stealing is
    // the only effect that can force it, so this is where it belongs —
    // the sweep in settle cannot tell which copy is the incoming one.
    if (this.uniqueMinion(m) && getSeat(this.state, to).minions.some((x) => x.name === m.name)) {
      this.burnMinion(minionId);
      return;
    }
    this.emit({
      type: "ControlChanged",
      target: "minion",
      id: minionId,
      from: m.controller,
      to,
    });
  }

  /**
   * "…take control of them until the end of your turn" (Puppet Master
   * superior). The only borrowed control in the pool: the return address
   * is recorded on the minion and honoured in `endTurn`, beside where
   * "cannot act this turn" expires. docs/taking-actions-design.md §3
   */
  borrowMinion(minionId: MinionId, to: SeatId): void {
    const m = getMinion(this.state, minionId);
    if (m.controller === to) return;
    // Set BEFORE the move: `changeMinionControl` relocates the object
    // between seats, and the return address has to travel with it.
    m.controlRevertsTo = m.controller;
    this.changeMinionControl(minionId, to);
  }

  changePermanentControl(cardId: CardInstanceId, to: SeatId): void {
    const from = this.controllerOfEntry(cardId);
    if (from === null || from === to) return;
    // The same p. 17 rule as for a stolen minion: a forced self-contest
    // burns the incoming copy rather than starting one.
    const moving = this.findEntry(cardId);
    if (moving && this.registry[moving.card.name]?.isUnique === true) {
      const taker = getSeat(this.state, to);
      const already =
        taker.permanents.some((p) => p.card.name === moving.card.name) ||
        taker.minions.some((m) =>
          m.attached.some((p) => p.card.id !== m.id && p.card.name === moving.card.name),
        );
      if (already) {
        this.burnPermanent(cardId);
        return;
      }
    }
    this.emit({ type: "ControlChanged", target: "permanent", id: cardId, from, to });
    // "…or its controller changes" (The Rack): the new controller's copy
    // of the card text runs now.
    const entry = this.findEntry(cardId);
    if (entry) this.registry[entry.card.name]?.onControlChanged?.(entry, to, this);
  }

  /** Hand size = 7 + statics (p. 7): draw up when it grows. */
  private handSizeOf(seatId: SeatId): number {
    return handSizeOf(this.state, seatId);
  }

  private reconcileHandSize(seatId: SeatId): void {
    const seat = getSeat(this.state, seatId);
    while (seat.hand.length < this.handSizeOf(seatId) && seat.library.length > 0) {
      // STOP when the draw did not actually happen. A draw can be
      // redirected to a store (Black Market Cache, Shilmulo Tarot), which
      // asks a question instead of drawing — and this loop's condition is
      // unchanged by asking, so it span forever. Worse, inside action
      // resolution `raiseChoice` only queues, so it emitted no event and
      // pushed no frame: an invisible infinite loop that exhausted the
      // heap. The queued question draws when answered, and the next event
      // brings the hand back here.
      if (!this.drawToReplace(seatId, "extra")) return;
    }
  }

  // -- the mutation channel -------------------------------------------------

  emit(ev: GameEvent): void {
    this.state.eventLog.push(ev);
    this.applyToEntities(ev);
    this.applyToFrames(ev);
    // A withdrawal in progress is broken by losing blood or pool, or by a
    // minion entering combat (p. 38). Checked at the one point every event
    // passes through, so no future emit site can forget it.
    this.checkWithdrawal(ev);
  }

  private applyToEntities(ev: GameEvent): void {
    switch (ev.type) {
      case "TurnBegan": {
        // "…more than once each turn" (p. 20): entry-granted action uses
        // reset when a new game turn begins, for every seat.
        for (const seat of this.state.seats) {
          for (const p of seat.permanents) {
            p.grantedActionUses = [];
            p.usedThisTurn = false; // "once each turn" (the archetypes)
          }
          for (const m of seat.minions) {
            for (const p of m.attached) {
              p.grantedActionUses = [];
              p.usedThisTurn = false;
            }
          }
          // "…this turn" (Veil the Legions): unspent stealth charges do
          // not carry, and the superior-once-per-turn limit resets.
          seat.stealthCharges = 0;
          seat.superiorPlaysThisTurn = [];
          // "…on this turn" (Día de los Muertos): an unused auto-pass
          // does not carry into the next turn.
          seat.autoPassReferendum = false;
          // "…this turn" (Expulsion).
          for (const m of seat.minions) m.expelledThisTurn = false;
          // "…cannot perform the same action again THIS TURN" (Change of
          // Target, Obedience, Delaying Tactics).
          seat.cannotRepeat = [];
          for (const m of seat.minions) m.cannotRepeat = [];
          // "…during your NEXT discard phase" (Fiendish Tongue) is one
          // chance, and it is always the discard phase of the same turn
          // the bleed happened in.
          for (const m of seat.minions) m.discardPhaseUnlock = false;
        }
        break;
      }
      case "MinionExpelled": {
        const m = findMinion(this.state, ev.minion);
        if (m) m.expelledThisTurn = true;
        break;
      }
      case "CardReturnedToHand":
        getSeat(this.state, ev.seat).hand.push({ id: ev.cardId, name: ev.name });
        break;
      case "MinionLocked":
        getMinion(this.state, ev.minion).locked = true;
        break;
      case "MinionUnlocked":
        getMinion(this.state, ev.minion).locked = false;
        break;
      case "MinionWoke":
        getMinion(this.state, ev.minion).awake = true;
        break;
      case "TitleGranted":
        getMinion(this.state, ev.minion).title = ev.title;
        break;
      case "TitleLost": {
        const tm = findMinion(this.state, ev.minion);
        if (tm) tm.title = null;
        break;
      }
      case "HuntingGroundUsed":
        getMinion(this.state, ev.minion).usedHuntingGroundThisTurn = true;
        break;
      case "MinionCountersChanged": {
        const cm = findMinion(this.state, ev.minion);
        if (cm) {
          const cur = cm.counters ?? {};
          cur[ev.kind] = Math.max(0, (cur[ev.kind] ?? 0) + ev.delta);
          cm.counters = cur;
        }
        break;
      }
      case "CorruptionChanged": {
        const cm = findMinion(this.state, ev.minion);
        if (cm) {
          const cur = cm.corruption ?? {};
          cur[ev.seat] = Math.max(0, (cur[ev.seat] ?? 0) + ev.delta);
          cm.corruption = cur;
        }
        break;
      }
      case "BloodBurned": {
        const m = getMinion(this.state, ev.minion);
        m.blood = Math.max(0, m.blood - ev.amount);
        break;
      }
      case "BloodGained": {
        // "The excess is immediately returned to the blood bank" (p. 21) —
        // vampires only; ally life in excess of starting life does not
        // drain off (p. 11).
        const m = getMinion(this.state, ev.minion);
        // "This ally cannot gain life" (Rotting Behemoth) — read where
        // life is ADDED, so burning and paying still work normally.
        if (m.attached.some((e) => e.card.id === m.id && e.statics.cannotGainLife)) break;
        m.blood =
          m.kind === "ally"
            ? m.blood + ev.amount
            : Math.min(capacityOf(m), m.blood + ev.amount);
        break;
      }
      case "PoolBurned":
        getSeat(this.state, ev.seat).pool -= ev.amount;
        break;
      case "WithdrawalAnnounced":
        getSeat(this.state, ev.seat).withdrawing = true;
        break;
      case "Withdrew": {
        // 1 victory point, and the seat leaves the game. The PREDATOR gets
        // nothing — no victory point and no pool — which is what makes
        // withdrawing different from being ousted (p. 38).
        const seat = getSeat(this.state, ev.seat);
        seat.withdrawing = false;
        seat.ousted = true;
        seat.victoryPoints += 1;
        break;
      }
      case "PoolGained":
        getSeat(this.state, ev.seat).pool += ev.amount;
        break;
      case "EdgeTaken":
        this.state.edge = ev.seat;
        break;
      case "WentToTorpor":
        getMinion(this.state, ev.minion).inTorpor = true;
        break;
      case "VictoryPointGained":
        getSeat(this.state, ev.seat).victoryPoints += 1;
        break;
      case "Ousted": {
        // "If you are ousted, all the cards you control are removed from
        // the game" (p. 43) — minions and cards in play alike, including
        // any rival's cards this seat had taken control of. Cards this
        // seat OWNS but others control sit in those seats' arrays and
        // "remain in play as normal".
        const seat = getSeat(this.state, ev.seat);
        seat.ousted = true;
        seat.minions = [];
        seat.permanents = [];
        break;
      }
      case "PoolMovedToUncontrolled": {
        getSeat(this.state, ev.seat).pool -= 1;
        findUncontrolled(this.state, ev.seat, ev.minion).counters += 1;
        break;
      }
      case "CounterMovedToPool": {
        getSeat(this.state, ev.seat).pool += 1;
        findUncontrolled(this.state, ev.seat, ev.minion).counters -= 1;
        break;
      }
      case "CryptCardDrawn": {
        const seat = getSeat(this.state, ev.seat);
        const card = seat.crypt.shift();
        if (!card || card.id !== ev.minion) {
          throw new Error(`crypt draw mismatch for ${ev.seat}`);
        }
        seat.uncontrolled.push({ card, counters: 0 });
        break;
      }
      case "UncontrolledRemovedFromGame": {
        const seat = getSeat(this.state, ev.seat);
        seat.uncontrolled = seat.uncontrolled.filter((u) => u.card.id !== ev.minion);
        break;
      }
      case "CryptCardBuried": {
        // The crypt is drawn from the FRONT, so "the bottom" is `push` —
        // the same convention (and the same trap) as the library's.
        const seat = getSeat(this.state, ev.seat);
        const i = seat.crypt.findIndex((c) => c.id === ev.minion);
        if (i >= 0) {
          const [card] = seat.crypt.splice(i, 1);
          if (card) seat.crypt.push(card);
        }
        break;
      }
      case "VampireEnteredPlay": {
        const seat = getSeat(this.state, ev.seat);
        const idx = seat.uncontrolled.findIndex((u) => u.card.id === ev.minion);
        if (idx < 0) throw new Error(`no uncontrolled vampire ${ev.minion}`);
        const [entry] = seat.uncontrolled.splice(idx, 1);
        if (!entry) throw new Error("unreachable");
        entry.card.blood = ev.blood; // excess over capacity already drained
        entry.card.locked = false; // enters play face up, unlocked (p. 36)
        entry.card.owner ??= ev.seat; // p. 16: ownership, fixed for the game
        seat.minions.push(entry.card);
        break;
      }
      case "LeftTorpor":
        getMinion(this.state, ev.minion).inTorpor = false;
        break;
      case "PermanentEnteredPlay": {
        const entry: PermanentInPlay = {
          card: { id: ev.cardId, name: ev.name },
          locked: false,
          usedThisPhase: false,
          statics: ev.statics,
          tags: [...ev.tags],
        };
        if (ev.life !== undefined) entry.life = ev.life;
        if (ev.counters !== undefined) entry.counters = ev.counters;
        if (ev.aura !== undefined) entry.aura = ev.aura;
        if (ev.auras !== undefined) entry.auras = ev.auras;
        if (ev.costSource !== undefined) entry.costSource = ev.costSource;
        if (ev.counterSink !== undefined) entry.counterSink = ev.counterSink;
        if (ev.preventsUnlock !== undefined) entry.preventsUnlock = ev.preventsUnlock;
        if (ev.againstSeat !== undefined) entry.againstSeat = ev.againstSeat;
        if (ev.linkedMinion !== undefined) entry.linkedMinion = ev.linkedMinion;
        if (ev.unblockable !== undefined) entry.unblockable = ev.unblockable;
        // p. 16: a master is controlled by the Methuselah who played it,
        // even on another Methuselah's minion.
        if (ev.controller !== undefined) entry.controller = ev.controller;
        entry.owner = ev.controller ?? ev.seat;
        if (ev.attachedTo !== null) {
          getMinion(this.state, ev.attachedTo).attached.push(entry);
        } else {
          getSeat(this.state, ev.seat).permanents.push(entry);
        }
        // "+1 hand size" etc.: draw up immediately (p. 7) — including a
        // hand size that comes from the counters it arrives with (Visit
        // from the Capuchin).
        if (
          ev.statics.handSize ||
          (ev.statics.handSizePerCounter && (ev.counters ?? 0) > 0)
        ) {
          this.reconcileHandSize(ev.seat);
        }
        break;
      }
      case "CoinFlipped":
      case "LibraryTopRevealed":
        // Both are pure record: the coin's outcome so a replay reproduces
        // it, and the reveal so the log shows what the table saw. Neither
        // moves a card.
        break;
      case "LibraryTopBurned": {
        const seat = getSeat(this.state, ev.seat);
        const i = seat.library.findIndex((c) => c.id === ev.cardId);
        if (i >= 0) {
          const [card] = seat.library.splice(i, 1);
          // A burnt card goes to its OWNER's ash heap (p. 16).
          if (card) this.toAshHeap(ev.seat, card);
        }
        break;
      }
      case "CardToLibraryBottom": {
        // The library is drawn from the FRONT (`shift`), so the bottom is
        // `push` — the `CardBuried` rule.
        getSeat(this.state, ev.seat).library.push({ id: ev.cardId, name: ev.name });
        break;
      }
      case "LibraryCardMoved": {
        const seat = getSeat(this.state, ev.seat);
        const i = seat.library.findIndex((c) => c.id === ev.cardId);
        if (i >= 0) {
          const [card] = seat.library.splice(i, 1);
          if (card) seat.library.splice(ev.position, 0, card);
        }
        break;
      }
      case "CardBuried": {
        // The library is DRAWN FROM THE FRONT (`shift`), so "the bottom"
        // is `push`. Getting that backwards is invisible until a game
        // runs long enough to draw the card again.
        const seat = getSeat(this.state, ev.seat);
        const i = seat.hand.findIndex((c) => c.id === ev.cardId);
        if (i >= 0) {
          const [card] = seat.hand.splice(i, 1);
          if (card) seat.library.push(card);
        }
        break;
      }
      case "CardsRevealed": {
        // "Who has looked at this card" — the one thing structural masking
        // cannot express (docs/knowledge-design.md). Recorded per seat and
        // never expired: you saw that physical card.
        const known = (this.state.knowledge ??= {});
        const seen = new Set(known[ev.to] ?? []);
        for (const id of ev.cards) seen.add(id);
        known[ev.to] = [...seen];
        break;
      }
      case "LibraryShuffled": {
        // "If you search your library or crypt, you must shuffle it
        // afterwards" (p. 14) — through the seeded RNG, like every other
        // shuffle, so a replay reproduces the order.
        const lib = getSeat(this.state, ev.seat).library;
        for (let i = lib.length - 1; i > 0; i--) {
          const j = rngInt(this.state, i + 1);
          const a = lib[i]!;
          lib[i] = lib[j]!;
          lib[j] = a;
        }
        break;
      }
      case "CardStored": {
        const seat = getSeat(this.state, ev.seat);
        const pile = ev.from === "hand" ? seat.hand : seat.library;
        const i = pile.findIndex((c) => c.id === ev.cardId);
        if (i >= 0) pile.splice(i, 1);
        const holder = this.findPermanent(ev.holder);
        (holder.stored ??= []).push({ id: ev.cardId, name: ev.name });
        holder.storedFaceUp = ev.faceUp;
        break;
      }
      case "StoredCardDrawn": {
        const holder = this.findPermanent(ev.holder);
        const i = (holder.stored ?? []).findIndex((c) => c.id === ev.cardId);
        if (i >= 0) {
          const [card] = holder.stored!.splice(i, 1);
          if (card) getSeat(this.state, ev.seat).hand.push(card);
        }
        break;
      }
      case "PermanentShuffledIntoLibrary": {
        // Leaves play and goes back into its owner's library, shuffled
        // (Aranthebes). Counters and attached cards do not survive.
        for (const seat of this.state.seats) {
          const idx = seat.permanents.findIndex((p) => p.card.id === ev.cardId);
          if (idx >= 0) {
            seat.permanents.splice(idx, 1);
            break;
          }
        }
        const home = getSeat(this.state, ev.seat);
        home.library.push({ id: ev.cardId, name: ev.name });
        for (let i = home.library.length - 1; i > 0; i--) {
          const j = rngInt(this.state, i + 1);
          const a = home.library[i]!;
          home.library[i] = home.library[j]!;
          home.library[j] = a;
        }
        break;
      }
      case "PermanentBurned": {
        // "A burned card goes to its OWNER's ash heap" (p. 16) — read off
        // the entry BEFORE it is filtered out, and from `owner` rather
        // than `controller`, which is the whole reason both are recorded.
        // docs/ash-heap-design.md §2
        const leaving = this.allEntries().find((e) => e.entry.card.id === ev.cardId);
        // `owner` is optional on older fixtures; fall back to the seat
        // holding the card rather than losing it. `removed` skips the
        // filing entirely: a card removed from the game "cannot be
        // retrieved or affected in any way" (p. 16).
        if (leaving && !ev.removed) {
          this.toAshHeap(leaving.entry.owner ?? leaving.owner.seat, leaving.entry.card);
        }
        for (const seat of this.state.seats) {
          seat.permanents = seat.permanents.filter((p) => p.card.id !== ev.cardId);
          for (const m of seat.minions) {
            m.attached = m.attached.filter((p) => p.card.id !== ev.cardId);
          }
        }
        break;
      }
      // -- contests (p. 17-18) ---------------------------------------------
      case "ContestBegan": {
        // "Turned face down and are OUT OF PLAY": the card leaves its
        // zone entirely and parks, whole, in the contested pile. Whole,
        // because a contest ends by the card coming back with everything
        // on it — or by being yielded, when "any cards or counters
        // stacked on the yielded card are also burned".
        const seat = getSeat(this.state, ev.seat);
        const held: ContestedCard = { card: { id: ev.cardId, name: ev.name } };
        if (ev.minion !== undefined) {
          const m = seat.minions.find((x) => x.id === ev.minion);
          if (!m) break;
          held.minion = m;
          seat.minions = seat.minions.filter((x) => x.id !== ev.minion);
        } else {
          const found = this.allEntries().find((e) => e.entry.card.id === ev.cardId);
          if (!found) break;
          held.permanent = found.entry;
          if (ev.bearer !== undefined) held.bearer = ev.bearer;
          for (const s of this.state.seats) {
            s.permanents = s.permanents.filter((p) => p.card.id !== ev.cardId);
            for (const m of s.minions) {
              m.attached = m.attached.filter((p) => p.card.id !== ev.cardId);
            }
          }
        }
        (seat.contested ??= []).push(held);
        break;
      }
      case "ContestPaid":
        break; // the pool moves via PoolBurned; this is the log's record
      case "ContestYielded": {
        // "A yielded card is burned." The pile entry goes; the card is
        // filed in its OWNER's ash heap (p. 16) by the burn below.
        const seat = getSeat(this.state, ev.seat);
        seat.contested = (seat.contested ?? []).filter((c) => c.card.id !== ev.cardId);
        break;
      }
      case "ContestWon": {
        // "The card is UNLOCKED and turned face up during your next
        // unlock phase, ending the contest."
        const seat = getSeat(this.state, ev.seat);
        const held = (seat.contested ?? []).find((c) => c.card.id === ev.cardId);
        if (!held) break;
        seat.contested = (seat.contested ?? []).filter((c) => c.card.id !== ev.cardId);
        if (held.minion) {
          held.minion.locked = false;
          held.minion.controller = ev.seat;
          seat.minions.push(held.minion);
        } else if (held.permanent) {
          held.permanent.locked = false;
          const bearer =
            held.bearer === undefined ? null : findMinion(this.state, held.bearer);
          if (held.bearer === undefined) {
            seat.permanents.push(held.permanent);
          } else if (bearer) {
            bearer.attached.push(held.permanent);
          } else {
            // The bearer is gone, so an attached card has nowhere to
            // return to and is burned (§5) — a reading, not a citation.
            this.toAshHeap(held.permanent.owner ?? ev.seat, held.permanent.card);
          }
        }
        break;
      }
      case "TitleContested": {
        // "Treated as if they have no title" — the claim parks on the
        // minion and `title` goes null, so every site that reads a title
        // is right with no change of its own.
        const m = findMinion(this.state, ev.minion);
        if (!m) break;
        m.titleContest = ev.city === undefined ? { title: ev.title } : { title: ev.title, city: ev.city };
        m.title = null;
        break;
      }
      case "TitleYielded": {
        // "…will now have no title and loses the benefits of the title
        // for the remainder of the game." The city goes too, or the
        // vampire would re-enter the contest on the next sweep.
        const m = findMinion(this.state, ev.minion);
        if (!m) break;
        delete m.titleContest;
        delete m.titleCity;
        m.title = null;
        break;
      }
      case "CardBurned": {
        // Every burn of a card that is NOT in play (an action card at
        // resolution, a held-aside card, a burnt political vote card).
        // The seat is optional only so older logs still replay; every
        // emit site supplies it. docs/ash-heap-design.md §3
        if (ev.seat !== undefined) {
          const s = getSeat(this.state, ev.seat);
          (s.ashHeap ??= []).push({ id: ev.cardId, name: ev.name });
        }
        break;
      }
      case "CardToAshHeap": {
        const seat = getSeat(this.state, ev.seat);
        (seat.ashHeap ??= []).push({ id: ev.cardId, name: ev.name });
        break;
      }
      case "CardRemovedFromGame": {
        // p. 16: it "cannot be retrieved or affected in any way", so there
        // is deliberately no zone to move it to (§4).
        const seat = getSeat(this.state, ev.seat);
        if (seat.ashHeap) {
          seat.ashHeap = seat.ashHeap.filter((c) => c.id !== ev.cardId);
        }
        break;
      }
      case "CardLeftZone": {
        const seat = getSeat(this.state, ev.seat);
        const pile =
          ev.zone === "hand" ? seat.hand : ev.zone === "library" ? seat.library : seat.ashHeap;
        const idx = (pile ?? []).findIndex((c) => c.id === ev.cardId);
        if (idx >= 0) pile!.splice(idx, 1);
        break;
      }
      case "CardTakenFromAshHeap": {
        const seat = getSeat(this.state, ev.seat);
        const idx = (seat.ashHeap ?? []).findIndex((c) => c.id === ev.cardId);
        if (idx < 0) break;
        const [card] = seat.ashHeap!.splice(idx, 1);
        if (card) seat.hand.push(card);
        break;
      }
      case "CardSearchedToHand": {
        // The card is NAMED in the event because it is revealed to the
        // table (Dominica, Sakhar) — unlike a draw, which is private.
        const seat = getSeat(this.state, ev.seat);
        const idx = seat.library.findIndex((c) => c.id === ev.cardId);
        if (idx < 0) break;
        const [card] = seat.library.splice(idx, 1);
        if (card) seat.hand.push(card);
        break;
      }
      case "PermanentMoved": {
        // Detach from wherever it is and attach to the new bearer; the
        // card keeps its counters, lock state and life.
        let moved: PermanentInPlay | null = null;
        for (const seat of this.state.seats) {
          for (const m of seat.minions) {
            const idx = m.attached.findIndex((p) => p.card.id === ev.cardId);
            if (idx >= 0) moved = m.attached.splice(idx, 1)[0] ?? null;
          }
          const si = seat.permanents.findIndex((p) => p.card.id === ev.cardId);
          if (si >= 0) moved = seat.permanents.splice(si, 1)[0] ?? null;
        }
        if (!moved) throw new Error(`no card to move: ${ev.cardId}`);
        moved.controller = ev.controller;
        getMinion(this.state, ev.to).attached.push(moved);
        break;
      }
      case "CountersChanged": {
        const p = this.findPermanent(ev.cardId);
        p.counters = Math.max(0, (p.counters ?? 0) + ev.delta);
        break;
      }
      case "PermanentLocked":
        this.findPermanent(ev.cardId).locked = true;
        break;
      case "PermanentUnlocked":
        this.findPermanent(ev.cardId).locked = false;
        break;
      case "UncontrolledBloodAdded":
        // From the blood bank — no pool change (Govern/Enchant superior).
        findUncontrolled(this.state, ev.seat, ev.minion).counters += ev.amount;
        break;
      case "AllyEnteredPlay": {
        // Life comes from the blood bank (p. 22); capacity records the
        // printed starting life (a reference, not a cap — p. 11).
        getSeat(this.state, ev.seat).minions.push({
          id: ev.minion,
          name: ev.name,
          kind: "ally",
          controller: ev.seat,
          owner: ev.seat, // p. 16 — ownership never moves
          blood: ev.life,
          capacity: ev.life,
          // "…their capacity or cost" (Cave of Apples): an ally is measured
          // by its printed pool cost.
          cost: ev.cost ?? 0,
          strength: ev.strength,
          bleedAmount: ev.bleed,
          locked: false,
          awake: false,
          inTorpor: false,
          // Normally none. "Plays cards requiring basic Animalism as a
          // vampire" (p. 11) is exactly these levels: every enumerator
          // picks its player with `disciplinesOf`, not `kind`.
          disciplines: ev.disciplines ?? {},
          bledThisTurn: false,
          calledPoliticalThisTurn: false,
          title: null, // only vampires hold the p. 28 titles
          clan: null, // allies are not vampires; no clan/sect
          sect: null,
          cannotActThisTurn: ev.recruited,
          playedSinceUnlock: [],
          attached: [],
        });
        break;
      }
      case "VampireTokenEnteredPlay": {
        // A library card that became a vampire (docs/token-vampire-design
        // .md §2). Ready, unlocked and able to act — p. 22's "cannot act
        // the turn it is recruited" is an ALLY rule, and it has to be able
        // to act or "must hunt this turn" could not be satisfied.
        getSeat(this.state, ev.seat).minions.push({
          id: ev.minion,
          name: ev.name,
          kind: "vampire",
          controller: ev.seat,
          owner: ev.seat, // p. 16 — ownership never moves
          // 0 blood: the card says it must hunt, and a vampire that
          // arrived with blood would have no reason to (§3).
          blood: 0,
          capacity: ev.capacity,
          cost: 0,
          strength: 1,
          bleedAmount: 1,
          locked: false,
          awake: false,
          inTorpor: false,
          disciplines: {},
          bledThisTurn: false,
          calledPoliticalThisTurn: false,
          title: null,
          // "It becomes a 1-capacity (NON-UNIQUE) vampire" — the only
          // vampires in the game that never contest, which matters now
          // that "all crypt cards represent unique minions" (p. 17) is
          // modelled. Both cards print the word.
          nonUnique: true,
          clan: ev.clan,
          sect: ev.sect,
          cannotActThisTurn: false,
          playedSinceUnlock: [],
          attached: [],
        });
        break;
      }
      case "MinionBurned": {
        // "A burned vampire is put in their owner's ash heap" (p. 34).
        // Only VAMPIRES need doing here: an ally's card rides into play as
        // a self-attached entry, so `PermanentBurned` already files it.
        // Marked `crypt` because a vampire card has no handler and the
        // filters that do not consult the registry must be able to tell
        // (docs/ledger-closeout.md §9).
        const burnt = this.state.seats.flatMap((s) => s.minions).find((m) => m.id === ev.minion);
        if (burnt && burnt.kind === "vampire") {
          const owner = burnt.owner ?? burnt.controller;
          (getSeat(this.state, owner).ashHeap ??= []).push({
            id: burnt.id,
            name: burnt.name,
            crypt: true,
          });
        }
        for (const seat of this.state.seats) {
          seat.minions = seat.minions.filter((m) => m.id !== ev.minion);
        }
        break;
      }
      // The same effect on the board, and deliberately WITHOUT the ash
      // heap: a card removed from the game "cannot be retrieved or
      // affected in any way" (p. 16).
      // docs/cross-table-masters-design.md §3
      case "MinionRemovedFromGame": {
        for (const seat of this.state.seats) {
          seat.minions = seat.minions.filter((m) => m.id !== ev.minion);
        }
        break;
      }
      case "RetainerLifeBurned": {
        const entry = this.findPermanent(ev.cardId);
        entry.life = Math.max(0, (entry.life ?? 0) - ev.amount);
        break;
      }
      case "RetainerLifeGained": {
        const entry = this.findPermanent(ev.cardId);
        entry.life = (entry.life ?? 0) + ev.amount;
        break;
      }
      case "EdgeBurned":
        // "Return it, uncontrolled, to the central area" (p. 28).
        this.state.edge = null;
        break;
      case "ControlChanged": {
        if (ev.target === "minion") {
          // Control of a minion = which seat's array holds it (p. 16).
          // Everything on it travels: blood, counters, corruption,
          // attached cards, lock state, torpor.
          const from = getSeat(this.state, ev.from);
          const idx = from.minions.findIndex((m) => m.id === ev.id);
          if (idx < 0) throw new Error(`no minion to move: ${ev.id}`);
          const [m] = from.minions.splice(idx, 1);
          m!.controller = ev.to;
          getSeat(this.state, ev.to).minions.push(m!);
        } else {
          const entry = this.findPermanent(ev.id);
          const from = getSeat(this.state, ev.from);
          const idx = from.permanents.findIndex((p) => p.card.id === ev.id);
          if (idx >= 0) {
            const [p] = from.permanents.splice(idx, 1);
            p!.controller = ev.to;
            getSeat(this.state, ev.to).permanents.push(p!);
          } else {
            // Attached entries stay on their bearer; only control moves.
            entry.controller = ev.to;
          }
        }
        break;
      }
      case "MovedToUncontrolled": {
        // Banishment (p. 28 card text): blood becomes counters; attached
        // cards stay with it, out of play. `seat` is where the minion is
        // now (its controller); it lands in its OWNER's uncontrolled
        // region (p. 16 — ownership never moves), which differs only once
        // a vampire has been stolen.
        const seat = getSeat(this.state, ev.seat);
        const idx = seat.minions.findIndex((m) => m.id === ev.minion);
        if (idx < 0) throw new Error(`no minion to banish: ${ev.minion}`);
        const [m] = seat.minions.splice(idx, 1);
        const home = getSeat(this.state, m!.owner ?? ev.seat);
        m!.controller = home.id;
        home.uncontrolled.push({ card: m!, counters: m!.blood });
        break;
      }
      default:
        break; // other events are pure log facts; derived values fold them
    }
  }

  private applyToFrames(ev: GameEvent): void {
    if (ev.type === "BlockFailed") {
      // "Minions who attempt to block this action and fail become locked
      // before action resolution" (Faceless Night). Recorded here, at the
      // one point every failure passes through, rather than at the three
      // emit sites — the reason `minionActionsThisPhase` lives here too.
      // Only failures from NOW on: p. 48 says the card does not lock
      // retroactively, which is why this reads the flag instead of the log.
      const af = this.action();
      if (af && af.lockFailedBlockers && af.actionId === ev.actionId) {
        (af.failedBlockersToLock ??= []).push(ev.blocker);
      }
    }
    if (ev.type === "ActionAnnounced") {
      // "Not usable during the first action in a minion phase"
      // (Channel 10). Counted here rather than at the three announce
      // sites — card actions, built-in actions and granted actions — so
      // a fourth one cannot forget to do it.
      const tf = this.state.frames.find((f) => f.kind === "turn");
      if (tf && tf.kind === "turn" && tf.phase === "minion") {
        tf.minionActionsThisPhase = (tf.minionActionsThisPhase ?? 0) + 1;
      }
      // "The next X actions minions you control perform this turn get +1
      // stealth" (Veil the Legions superior) — one charge, spent here for
      // the same reason: every announce site passes through this point.
      // Emitting the StealthModified keeps `currentStealth` a pure fold of
      // the log, with no special case for the bank.
      const seat = this.state.seats.find((s) => s.id === ev.seat);
      if (seat && (seat.stealthCharges ?? 0) > 0) {
        seat.stealthCharges = (seat.stealthCharges ?? 0) - 1;
        this.emit({
          type: "StealthModified",
          actionId: ev.actionId,
          delta: 1,
          source: "Veil the Legions",
        });
      }
    }
    if (ev.type === "MinionBurned") {
      // Remaining damage against a burned minion is moot; combat itself
      // ends via the missing-combatant check in settleCombat (p. 30).
      const cf = this.combatFrame();
      if (cf) {
        cf.pendingDamage = cf.pendingDamage.filter((pd) => pd.minion !== ev.minion);
      }
    }
    if (ev.type === "TargetChanged") {
      // "If the target of the action is changed … this will reopen block
      // attempts, following the normal rules" (p. 26; p. 27 A.3/C.2).
      const af = this.action();
      if (af && af.actionId === ev.actionId) {
        af.target = ev.to;
        af.declinedBlocks = [];
        if (af.step === "C") af.step = "A";
        af.cycle = newCycle(
          sequencingOrder(this.state, af.actingSeat, defendersFor(this.state, af)),
        );
      }
    }
  }

  // -- settle: transitions that need no decision ----------------------------

  private settle(): void {
    for (;;) {
      const top = this.top();
      if (!top) return;

      // An ally or retainer that has lost its last life is burned (p. 22,
      // p. 31–32) — checked before any frame transition so a combat with a
      // burned combatant ends before its next step.
      if (this.burnDepleted()) continue;

      // "A vampire cannot have more blood than their capacity; the excess
      // is always moved to the blood bank immediately" (p. 11). Capacity is
      // derived, so it can FALL — a Discipline master card granting +1
      // capacity leaves play — which the p. 11 sentence does not explicitly
      // cover (it is written about blood being added). Read as: the
      // invariant holds whenever it becomes false, whichever side moved.
      if (this.drainOverCapacity()) continue;

      // "If more than one unique card with the same name is brought into
      // play … all of the contested cards are turned face down and are
      // out of play" (p. 17), and the same for a unique title (p. 18).
      // A sweep for the same reason as the two above: it holds whenever
      // it becomes false, however the card got there.
      if (this.settleContests()) continue;

      // A question with no legal answer is no question at all: pop it
      // rather than offer an empty decision (docs/choice-frames-design.md
      // — an optional choice always has its Decline, so only a mandatory
      // one can strand the loop, e.g. The Rack asking a Methuselah who
      // controls no ready vampire).
      if (top.kind === "choice" && !top.optional && this.choiceOptionsFor(top).length === 0) {
        this.pop();
        continue;
      }

      if (top.kind === "cardPlay" && cycleQuiescent(top.cycle)) {
        this.resolveCardPlay(top);
        continue;
      }

      if (top.kind === "blockAttempt" && cycleQuiescent(top.cycle)) {
        this.resolveBlockAttempt(top);
        continue;
      }

      if (top.kind === "action") {
        // A reaction ("unlock and attempt to block") queued a forced block;
        // convert it now that control is back on the action (p. 25).
        if (top.pendingAutoBlock && top.step === "A") {
          this.startAutoBlock(top);
          continue;
        }
        if (top.step === "announce" && cycleQuiescent(top.cycle)) {
          top.step = "A";
          cycleRewind(top.cycle);
          continue;
        }
        if (top.step === "A" && cycleQuiescent(top.cycle)) {
          // "Once every Methuselah has passed, switch to C" (p. 27 A.4).
          top.step = "C";
          cycleRewind(top.cycle);
          // The one moment an action is known to be going through while
          // the block window is already shut (Spying Mission). Hung on
          // this single transition, the `minionActionsThisPhase` pattern.
          this.notifyBlocksDeclined(top);
          continue;
        }
        if (top.step === "C" && cycleQuiescent(top.cycle)) {
          this.resolveAction(top, true);
          continue;
        }
        if (top.step === "blocked") {
          // Combat has finished; the blocked action fails (§3.5).
          this.resolveAction(top, false);
          continue;
        }
        if (top.step === "afterResolution" && cycleQuiescent(top.cycle)) {
          // The post-resolution impulse is over. THIS is where the window
          // closes — `resolveActionInner` only opens it — so anything that
          // acts on what was played in it belongs here.
          if (top.continueUnblocked) {
            this.continueActionUnblocked(top);
            continue;
          }
          this.finishAction(top, top.resolvedSuccess === true);
          continue;
        }
        return;
      }

      if (top.kind === "referendum") {
        // Cancelled (Telepathic Vote Counting): it never resolves — no
        // tally, no ReferendumResolved, no applyReferendum, and the
        // calling card was already handed back.
        if (top.cancelled) {
          this.pop();
          // "…is CANCELED or fails" (Cedrick) — fired after the pop, so a
          // ChoiceFrame a hook raises is not eaten by it.
          this.notifyReferendumLost(top, "cancelled");
          continue;
        }
        if (top.step === "terms") {
          const terms =
            this.handler(top.cardName).referendumTerms?.(top, this.state) ?? [];
          if (terms.length === 0) {
            // No terms to choose — straight to polling (p. 27).
            top.step = "polling";
            continue;
          }
          return;
        }
        // "Passes automatically (SKIP THE POLLING STEP)" — the terms above
        // are still chosen; only the vote is skipped, with a margin of 0
        // because no votes were cast (design §4, §7.1).
        if (top.autoPass && top.margin === undefined) {
          top.votesFor = 0;
          top.votesAgainst = 0;
          top.margin = 0;
          top.passed = true;
          this.resolveReferendum(top);
          continue;
        }
        if (cycleQuiescent(top.cycle)) {
          this.resolveReferendum(top);
          continue;
        }
        return;
      }

      if (top.kind === "combat") {
        if (this.settleCombat(top)) continue;
        return;
      }

      if (top.kind === "turn") {
        if (this.settleTurn(top)) continue;
        return;
      }

      return;
    }
  }

  /** Burn any ally at 0 life and any retainer at 0 life (p. 22). Returns
   *  true if anything burned. */
  /** Drain blood above a vampire's (derived) capacity — see the call site
   *  in settle() for the reading. Allies are exempt: their life may exceed
   *  their printed starting value and does not drain (p. 11). */
  private drainOverCapacity(): boolean {
    for (const seat of this.state.seats) {
      for (const m of seat.minions) {
        if (m.kind !== "vampire") continue;
        const excess = m.blood - capacityOf(m);
        if (excess > 0) {
          this.emit({ type: "BloodBurned", minion: m.id, amount: excess });
          return true;
        }
      }
    }
    return false;
  }

  /** Is this minion a unique card, and so contestable (p. 17)? */
  private uniqueMinion(m: MinionState): boolean {
    if (m.nonUnique === true) return false;
    // "In addition, ALL crypt cards represent unique minions."
    if (m.kind === "vampire") return true;
    // An ally is an ordinary library card: unique only if it says so. Its
    // own card rides in as the SELF-attached entry, which is where the
    // printed type and the "Unique." line live.
    const self = m.attached.find((e) => e.card.id === m.id);
    return self !== undefined && this.registry[self.card.name]?.isUnique === true;
  }

  /**
   * Start any contest that the board now demands (p. 17-18).
   *
   * A SWEEP, not a hook, and deliberately so. A unique card reaches play
   * down six different paths (a master, an equip action, a recruit, an
   * influence-out, a control change, a card that puts itself in play) and
   * a title arrives down three more — instrumenting each is how
   * `onAnyUnlock` missed attached cards, `onBleedSuccess` missed them
   * again and `onActionAnnounced` fired a step early. This asks the board
   * instead: the invariant holds whenever it becomes false, whichever
   * side moved, which is the reading `drainOverCapacity` above already
   * takes. Returns true if it changed anything, so settle loops.
   */
  private settleContests(): boolean {
    interface Claim {
      seat: SeatId;
      /** Already face down: counts as a claimant, but has nothing to move. */
      held: boolean;
      minion?: MinionState;
      entry?: PermanentInPlay;
      bearer?: MinionId;
    }
    const claims = new Map<string, Claim[]>();
    const add = (name: string, c: Claim): void => {
      const list = claims.get(name) ?? [];
      list.push(c);
      claims.set(name, list);
    };
    for (const s of this.state.seats) {
      if (s.ousted) continue;
      for (const c of s.contested ?? []) add(c.card.name, { seat: s.id, held: true });
      for (const p of s.permanents) {
        if (this.registry[p.card.name]?.isUnique === true) {
          // "CONTROL of the card is being contested" (p. 17), so the
          // claimant is the controller — which is not always the seat
          // holding the card, since a master played on another
          // Methuselah's minion stays yours (p. 16).
          add(p.card.name, { seat: p.controller ?? s.id, held: false, entry: p });
        }
      }
      for (const m of s.minions) {
        if (this.uniqueMinion(m)) add(m.name, { seat: m.controller, held: false, minion: m });
        for (const p of m.attached) {
          // The minion's own card is the minion, already counted; count
          // it twice and every unique ally would contest with itself.
          if (p.card.id === m.id) continue;
          if (this.registry[p.card.name]?.isUnique === true) {
            add(p.card.name, {
              seat: p.controller ?? m.controller,
              held: false,
              entry: p,
              bearer: m.id,
            });
          }
        }
      }
    }

    for (const [name, list] of claims) {
      // "If MORE THAN ONE unique card with the same name is brought into
      // play" — by more than one Methuselah. A seat cannot contest with
      // itself (p. 17's deck-construction note), and the one way that can
      // be forced is handled where control changes.
      if (new Set(list.map((c) => c.seat)).size < 2) continue;
      const toMove = list.filter((c) => !c.held);
      if (toMove.length === 0) continue; // already all face down: stable
      for (const c of toMove) {
        this.emit({
          type: "ContestBegan",
          seat: c.seat,
          cardId: c.minion ? c.minion.id : c.entry!.card.id,
          name,
          ...(c.minion ? { minion: c.minion.id } : {}),
          ...(c.bearer !== undefined ? { bearer: c.bearer } : {}),
        });
      }
      return true;
    }

    // Titles (p. 18). Same shape, keyed by what makes the title unique.
    const byTitle = new Map<string, MinionState[]>();
    for (const s of this.state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        if (m.kind !== "vampire") continue;
        const key = titleContestKey(m);
        if (key === null) continue;
        byTitle.set(key, [...(byTitle.get(key) ?? []), m]);
      }
    }
    for (const rivals of byTitle.values()) {
      if (rivals.length < 2) continue;
      // Unlike cards, a title contest CAN be within one Methuselah: p. 17
      // forbids contesting a card with yourself and p. 18 says no such
      // thing about titles, so two of your own vampires claiming one city
      // both lose the benefit until one yields.
      const fresh = rivals.filter((m) => m.titleContest === undefined && m.title !== null);
      if (fresh.length === 0) continue;
      for (const m of fresh) {
        this.emit({
          type: "TitleContested",
          minion: m.id,
          title: m.title!,
          ...(m.titleCity !== undefined ? { city: m.titleCity } : {}),
        });
      }
      return true;
    }
    return false;
  }

  /** Every seat holding a copy of this contested name, in play or held. */
  private contestClaimants(name: string): Set<SeatId> {
    const out = new Set<SeatId>();
    for (const s of this.state.seats) {
      if (s.ousted) continue;
      if ((s.contested ?? []).some((c) => c.card.name === name)) out.add(s.id);
      for (const p of s.permanents) {
        if (p.card.name === name) out.add(p.controller ?? s.id);
      }
      for (const m of s.minions) {
        if (m.name === name && this.uniqueMinion(m)) out.add(m.controller);
        for (const p of m.attached) {
          if (p.card.id !== m.id && p.card.name === name) out.add(p.controller ?? m.controller);
        }
      }
    }
    return out;
  }

  /**
   * This seat's half of a contest, during their unlock phase (p. 17-18):
   * collect anything won, force the yields the rules force, and ask about
   * the rest one at a time.
   *
   * Returns true while there is more to do, so `settleTurn` keeps coming
   * back — the repeated-ChoiceFrame shape `unlockToll` already uses,
   * because the answers change the board the next question is asked
   * against.
   */
  private settleUnlockContests(tf: TurnFrame): boolean {
    const seat = getSeat(this.state, tf.seat);
    const handled = (tf.contestsHandled ??= []);

    // 1. "If all other cards contesting your unique card are yielded,
    //    then the card is unlocked and turned face up during your NEXT
    //    unlock phase, ending the contest."
    for (const held of [...(seat.contested ?? [])]) {
      if (this.contestClaimants(held.card.name).size > 1) continue;
      this.emit({
        type: "ContestWon",
        seat: seat.id,
        cardId: held.card.id,
        name: held.card.name,
      });
      return true;
    }

    // 2. The same for a title: "your vampire acquires the title during
    //    your next unlock phase, ending the contest."
    for (const m of seat.minions) {
      const claim = m.titleContest;
      if (!claim) continue;
      const key = titleContestKey(m);
      const rivals = this.state.seats
        .filter((s) => !s.ousted)
        .flatMap((s) => s.minions)
        .filter((x) => x.id !== m.id && titleContestKey(x) === key);
      if (rivals.length > 0) continue;
      this.emit({ type: "TitleGranted", minion: m.id, title: claim.title });
      delete m.titleContest;
      return true;
    }

    // 3. "Only READY vampires can contest titles. Vampires in torpor must
    //    yield during the unlock phase" — and a vampire with no blood is
    //    "forced to yield". Neither is a question.
    for (const m of seat.minions) {
      const claim = m.titleContest;
      if (!claim || handled.includes(m.id)) continue;
      if (m.inTorpor || m.blood < 1) {
        handled.push(m.id);
        this.emit({ type: "TitleYielded", minion: m.id, title: claim.title });
        return true;
      }
    }

    // 4. Everything left is a real choice: pay, or yield.
    for (const held of seat.contested ?? []) {
      if (handled.includes(held.card.id)) continue;
      handled.push(held.card.id);
      this.raiseChoice({
        seat: seat.id,
        cardName: CONTEST,
        cardId: held.card.id,
        key: CONTEST,
        params: { what: "card", id: held.card.id },
      });
      return true;
    }
    for (const m of seat.minions) {
      if (!m.titleContest || handled.includes(m.id)) continue;
      handled.push(m.id);
      this.raiseChoice({
        seat: seat.id,
        cardName: CONTEST,
        cardId: m.id,
        key: CONTEST,
        params: { what: "title", id: m.id },
      });
      return true;
    }
    return false;
  }

  private burnDepleted(): boolean {
    for (const seat of this.state.seats) {
      for (const m of seat.minions) {
        if (m.kind === "ally" && m.blood <= 0) {
          this.burnMinion(m.id);
          return true;
        }
        for (const p of m.attached) {
          if (p.life !== undefined && p.life <= 0) {
            this.emit({ type: "PermanentBurned", cardId: p.card.id, name: p.card.name });
            return true;
          }
        }
      }
    }
    return false;
  }

  burnMinion(minionId: MinionId): void {
    const m = getMinion(this.state, minionId);
    // "About to leave the ready region" — cards get their say first
    // (docs/granted-rush-design.md §6); a minion already in torpor is not
    // leaving the ready region, it left when it went there.
    if (!m.inTorpor) this.notifyLeaveReady(minionId, "burned");
    // Attached cards (equipment, retainers, the ally's own card entry)
    // burn with the minion (p. 11).
    for (const p of [...m.attached]) {
      this.emit({ type: "PermanentBurned", cardId: p.card.id, name: p.card.name });
    }
    this.emit({ type: "MinionBurned", minion: minionId });
  }

  /**
   * "Remove a vampire from the game" (Golconda: Inner Peace).
   *
   * p. 16 lists burning and removing as two things in one sentence, and
   * the difference that is real TODAY is the hook: a card keyed on
   * `how: "burned"` (Fame) must not fire for a removal. What the sentence
   * says they share — "any counters or other cards on it are burned" — is
   * shared here too.
   *
   * The ash heap exists now, and this IS the branch that must not put the
   * card there. A minion that is itself a library card — an ally, a token
   * vampire — carries its own card as a SELF-attached entry, and that one
   * is removed rather than burned; its equipment and retainers are still
   * burned, which is exactly what p. 16's own sentence says ("any counters
   * or other cards on it are burned").
   * docs/cross-table-masters-design.md §3, docs/token-vampire-design.md §5
   */
  removeMinionFromGame(minionId: MinionId): void {
    const m = getMinion(this.state, minionId);
    if (!m.inTorpor) this.notifyLeaveReady(minionId, "removed");
    for (const p of [...m.attached]) {
      this.emit({
        type: "PermanentBurned",
        cardId: p.card.id,
        name: p.card.name,
        ...(p.card.id === minionId ? { removed: true } : {}),
      });
    }
    this.emit({ type: "MinionRemovedFromGame", minion: minionId });
  }

  burnRetainerLife(cardId: string, amount: number): void {
    this.emit({ type: "RetainerLifeBurned", cardId, amount });
    const entry = this.findPermanent(cardId);
    if ((entry.life ?? 0) <= 0) {
      this.emit({ type: "PermanentBurned", cardId, name: entry.card.name });
    }
  }

  /**
   * May this Methuselah announce a withdrawal (p. 38)?
   *
   * "If you have EXHAUSTED YOUR LIBRARY and begin your turn with LESS THAN
   * A FULL HAND, you have the option to withdraw." Both halves matter and
   * the second follows from the first: p. 7 draws you back up to hand size
   * after every play, so a short hand is only possible once there is
   * nothing left to draw.
   *
   * Not offered to a seat already withdrawing — the announcement is made
   * once and then has to survive a turn.
   */
  private canAnnounceWithdrawal(seatId: SeatId): boolean {
    const seat = getSeat(this.state, seatId);
    if (seat.ousted || seat.withdrawing) return false;
    return seat.library.length === 0 && seat.hand.length < handSizeOf(this.state, seatId);
  }

  /**
   * A withdrawal in progress is broken by any of p. 38's three conditions.
   *
   * Hung on `emit`, which is the one place every event passes through, for
   * the reason the `ActionAnnounced` chokepoint exists: three or four
   * sites can each lose blood, and a check written at each of them is a
   * check the fifth will forget.
   *
   * "The withdrawal fails if you lose a single blood or pool counter, EVEN
   * IF you also gain enough to make up for the loss" — so this is a latch
   * tripped by the LOSS, never a comparison of totals.
   */
  private checkWithdrawal(ev: GameEvent): void {
    const fail = (seat: SeatId, why: string): void => {
      const s = this.state.seats.find((x) => x.id === seat);
      if (!s?.withdrawing) return;
      s.withdrawing = false;
      this.state.eventLog.push({ type: "WithdrawalFailed", seat, why });
    };
    const ownerOf = (minion: MinionId): SeatId | null =>
      findMinion(this.state, minion)?.controller ?? null;

    switch (ev.type) {
      case "PoolBurned":
        fail(ev.seat, "lost pool");
        break;
      case "BloodBurned": {
        const seat = ownerOf(ev.minion);
        if (seat) fail(seat, "a minion lost blood");
        break;
      }
      case "CombatBegan": {
        // "None of your minions enter combat" — either side of it.
        for (const m of [ev.acting, ev.opposing]) {
          const seat = ownerOf(m);
          if (seat) fail(seat, "a minion entered combat");
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Resolve a withdrawal at the start of the announcing seat's next unlock
   * phase (p. 38): "if you have met these conditions when you would start
   * your unlock phase, you successfully withdraw."
   *
   * Worth 1 victory point — and the predator gets NOTHING, neither a
   * victory point nor the pool an oust would hand them. That asymmetry is
   * the whole point of withdrawing rather than being ousted, so it is
   * spelled out here rather than routed through `processOusts`.
   */
  private resolveWithdrawal(seatId: SeatId): void {
    const seat = getSeat(this.state, seatId);
    if (!seat.withdrawing || seat.ousted) return;
    seat.withdrawing = false;
    this.emit({ type: "Withdrew", seat: seatId });
  }

  commitDiablerie(diablerist: MinionId, victim: MinionId): void {
    // p. 34 — treated as a single unit; no effect interrupts.
    const v = getMinion(this.state, victim);
    // 1. All the victim's blood moves to the diablerist (excess drains).
    if (v.blood > 0) {
      this.emit({ type: "BloodGained", minion: diablerist, amount: v.blood });
    }
    // 2. The diablerist takes the victim's equipment — BEFORE the burn,
    //    or there would be nothing left to take.
    this.takeDiablerieEquipment(diablerist, v);
    // 5. Red List trophies: Red List is unmodelled, and no V5 card grants
    //    it — still deferred (docs/diablerie-design.md §6).
    this.emit({ type: "DiablerieCommitted", diablerist, victim });
    // Cards that answer a diablerie do so before the blood hunt is called
    // (Regent, docs/granted-rush-design.md §6). The victim is still in
    // play here, so a card on it can move itself off before the burn.
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onDiablerie?.(
        entry,
        owner,
        { diablerist, victim, bearer: owner.minion },
        this,
      );
    }
    // 3. The victim is burned; its cards and counters go with it.
    const victimCapacity = capacityOf(v);
    this.burnMinion(victim);
    // 4. "If the victim was older, the diablerist may gain a master
    //    Discipline card." A search, so it is a question — and unlike the
    //    equipment it has nothing to race: step 4 comes after the burn, so
    //    the deferred queue asking it once the action settles is exactly
    //    the right moment.
    this.offerDiablerieDiscipline(diablerist, victimCapacity);
    // The blood hunt: an automatic, immediate referendum (p. 35).
    this.pushBloodHunt(diablerist);
  }

  /**
   * Step 2 of the diablerie resolution (p. 34): the diablerist takes the
   * equipment off the victim, instead of it burning with them.
   *
   * TAKEN AUTOMATICALLY, and that is a recorded reading rather than an
   * oversight. The card says "may", and this project's direction is that
   * an optional payoff with a COST is a real choice (Cave of Apples, Dead
   * Pool) while a costless, purely beneficial one is taken (Show of
   * Force). Equipment costs nothing to hold. The stronger reason is the
   * rulebook's own: the resolution is an INDIVISIBLE unit that no effect
   * may interrupt, and asking here cannot work anyway — a choice raised
   * inside action resolution is deferred until the action settles
   * (docs/choice-frames-design.md §3), by which time the victim, and its
   * equipment, are already burned.
   *
   * The one thing that is NOT taken is equipment that would give its new
   * controller a second copy of a unique they already control — that is
   * the engine's own-duplicate rule, and it burns with the victim.
   */
  private takeDiablerieEquipment(diablerist: MinionId, victim: MinionState): void {
    const taker = findMinion(this.state, diablerist);
    if (!taker) return;
    const held = new Set(
      getSeat(this.state, taker.controller)
        .minions.flatMap((m) => m.attached)
        .filter((p) => p.tags.includes("unique"))
        .map((p) => p.card.name),
    );
    for (const p of [...victim.attached]) {
      if (!p.tags.includes("equipment")) continue;
      if (p.tags.includes("unique") && held.has(p.card.name)) continue;
      this.moveAttachment(p.card.id, diablerist);
    }
  }

  /**
   * Step 4 (p. 34, advanced): a diablerist who drank someone OLDER may
   * search their library, hand and ash heap for a master Discipline card
   * and put it on themselves.
   *
   * "Older" is DERIVED capacity on both sides, so a granted point counts —
   * the rule the rest of the engine uses for younger/older everywhere.
   * The library-search rules carry over unchanged: finding nothing is
   * always legal (p. 48), and the library is shuffled either way (p. 14),
   * which is why "Find nothing" is an ordinary answer rather than a
   * decline — an optional frame's decline never applies, and would skip
   * the shuffle.
   */
  private offerDiablerieDiscipline(diablerist: MinionId, victimCapacity: number): void {
    const m = findMinion(this.state, diablerist);
    if (!m || capacityOf(m) >= victimCapacity) return;
    this.raiseChoice({
      seat: m.controller,
      cardName: DIABLERIE_DISCIPLINE,
      cardId: diablerist,
      key: DIABLERIE_DISCIPLINE,
      params: { minion: diablerist },
    });
  }

  /** Conduct the automatic blood-hunt referendum on a diablerist (p. 35):
   *  not an action, so no terms and no calling-card vote; on a pass the
   *  diablerist is burned. */
  private pushBloodHunt(diablerist: MinionId): void {
    const hunted = getMinion(this.state, diablerist);
    // "Blood hunts cannot be called on the attached vampire" (Archon) —
    // the referendum is never pushed at all, rather than pushed and
    // ignored, so nobody is asked a question with no consequence.
    // docs/opposing-statics-design.md §2
    if (hunted.attached.some((p) => p.statics.noBloodHunt)) return;
    const seat = hunted.controller;
    const actionId = this.freshId("bloodhunt-");
    this.state.frames.push({
      kind: "referendum",
      actionId,
      caller: seat, // sequencing starts with the diablerist's controller
      cardName: "",
      variant: "bloodHunt",
      bloodHuntTarget: diablerist,
      callingMinion: null,
      voteGrants: {},
      step: "polling", // no terms
      terms: {},
      votes: [],
      usedSources: [],
      cycle: newCycle(sequencingOrder(this.state, seat, [])),
    });
  }

  /** Returns true if a transition was made and settling should continue. */
  private settleTurn(tf: TurnFrame): boolean {
    // Pool can only change at frame boundaries in phase 2, so ousting and
    // game end are checked whenever the turn frame surfaces.
    if (this.processOusts()) return true;
    if (this.state.frames.length === 0) return false;

    if (getSeat(this.state, tf.seat).ousted) {
      this.endTurn(tf);
      return true;
    }

    if (tf.phase === "unlock") {
      if (!tf.unlockDone) {
        // "If you have met these conditions WHEN YOU WOULD START YOUR
        // UNLOCK PHASE, you successfully withdraw" (p. 38) — before the
        // unlock sweep, because a seat that has just left the game has no
        // cards to unlock and no contests to settle.
        this.resolveWithdrawal(tf.seat);
        if (getSeat(this.state, tf.seat).ousted) {
          this.processOusts();
          return true;
        }
        // "Unlock all of your cards" — then unlock-phase effects (p. 17).
        const seat = getSeat(this.state, tf.seat);
        for (const m of seat.minions) {
          // "Does not unlock as normal": persistent (a card in play names
          // this minion), one-shot ("during their next unlock phase"), or
          // stun counters.
          //
          // The stun count is SNAPSHOT here, at the top of the sweep,
          // because the ruling burns "all stun counters they had at the
          // beginning of the turn" — and the unlock phase is a window
          // cards act in ("during any Methuselah's unlock phase",
          // Homunculus). A stun landing later in this phase must survive
          // to the next turn rather than being burned the moment it
          // arrives. docs/stun-design.md §2
          const stunCounters = m.counters?.["stun"] ?? 0;
          const suppressed =
            stunCounters > 0 ||
            m.skipNextUnlock === true ||
            unlockSuppressed(this.state, m.id);
          m.skipNextUnlock = false; // the one-shot form is spent either way
          // Unconditional: the ruling burns them "during that unlock
          // phase", whether or not the minion was locked to begin with.
          if (stunCounters > 0) this.addMinionCounters(m.id, "stun", -stunCounters);
          // "Burns 1 counter from this card instead of unlocking as
          // normal" (Touch of Oblivion): only when unlocking is what
          // would otherwise happen, so no counter is wasted on a minion
          // that is unlocked already or held down by something else.
          const paidFor = m.locked && !suppressed && this.spendUnlockSink(m);
          if (m.locked && !suppressed && !paidFor) {
            this.emit({ type: "MinionUnlocked", minion: m.id });
          }
          m.awake = false;
          m.bledThisTurn = false;
          m.calledPoliticalThisTurn = false;
          m.usedHuntingGroundThisTurn = false;
          m.playedSinceUnlock = [];
          for (const p of m.attached) {
            if (p.locked) this.emit({ type: "PermanentUnlocked", cardId: p.card.id });
          }
        }
        // "Unlock all of your cards" includes permanents (p. 17).
        for (const p of seat.permanents) {
          if (p.locked) this.emit({ type: "PermanentUnlocked", cardId: p.card.id });
        }
        // "During X, do Y" is once per phase (p. 16), and an unlock phase
        // is a phase for every Methuselah ("during any Methuselah's
        // unlock phase", Homunculus) — reset every seat's latches.
        for (const s of this.state.seats) {
          for (const p of s.permanents) {
            p.usedThisPhase = false;
            p.phaseUses = 0; // the counted form (Carfax Abbey's second grant)
          }
          for (const m of s.minions) {
            for (const p of m.attached) {
              p.usedThisPhase = false;
              p.phaseUses = 0;
            }
          }
        }
        // Automatic unlock-phase card text (Double Deuce's regen).
        for (const m of seat.minions) {
          for (const p of [...m.attached]) {
            this.registry[p.card.name]?.onControllerUnlock?.(
              p,
              { seat: seat.id, minion: m.id },
              this,
            );
          }
        }
        for (const p of [...seat.permanents]) {
          this.registry[p.card.name]?.onControllerUnlock?.(
            p,
            { seat: seat.id, minion: null },
            this,
          );
        }
        // "During each (other) Methuselah's unlock phase, …" — every card in
        // play sees the unlocking seat (Constant Revolution, Smiling Jack).
        // ATTACHED cards too: this scanned only seat-level permanents until
        // 2026-08-31, which was invisible while every user was a location,
        // and wrong the moment one sat on a vampire (Fame).
        for (const { entry, owner } of this.allEntries()) {
          this.registry[entry.card.name]?.onAnyUnlock?.(entry, owner, seat.id, this);
        }
        // "Do not replace until your next unlock phase" comes due now.
        for (let i = 0; i < seat.delayedDraws; i++) this.drawToReplace(seat.id);
        seat.delayedDraws = 0;
        tf.unlockDone = true;
        return true;
      }
      // Contests are settled in the unlock phase (p. 17-18), after the
      // cards have unlocked — "any cards or effects that require or allow
      // you to do something during your unlock phase take effect AFTER
      // you have unlocked your cards" (p. 17).
      if (!tf.contestsDone) {
        if (this.settleUnlockContests(tf)) return true;
        tf.contestsDone = true;
        return true;
      }
      const edgeNeeded = this.state.edge === tf.seat && !tf.edgeDone;
      const unlockAbilities =
        !tf.unlockAbilitiesDone &&
        this.abilityOptionsFor(tf.seat, "turn.unlock").length > 0;
      // A withdrawal is ANNOUNCED in this phase (p. 38), so the phase must
      // not settle past it — the third reason the window stays open, and
      // it has to be named at all three sites that decide that (here,
      // `turnDecision`, and `applyTurnPass`).
      const mayWithdraw = !tf.unlockAbilitiesDone && this.canAnnounceWithdrawal(tf.seat);
      if (
        !edgeNeeded &&
        !unlockAbilities &&
        !mayWithdraw &&
        this.nextUnlockAbilitySeat(tf) === null
      ) {
        tf.phase = "master";
        // 1 master phase action by default, minus the out-of-turn debt
        // (p. 8, p. 18).
        const seat = getSeat(this.state, tf.seat);
        tf.masterActionsLeft = seat.outOfTurnMasterUsed ? 0 : 1;
        seat.outOfTurnMasterUsed = false;
        tf.trifleGained = false;
        // "During each Methuselah's master phase, that Methuselah …"
        // (Brujah Debate) — every card in play sees the phase begin.
        for (const s of this.state.seats) {
          for (const p of [...s.permanents]) {
            this.registry[p.card.name]?.onMasterPhase?.(
              p,
              { seat: p.controller ?? s.id, minion: null },
              tf.seat,
              this,
            );
          }
        }
        return true;
      }
      return false; // the Edge/ability holder decides
    }
    return false; // master/minion/influence/discard all need decisions
  }

  /** The next other seat (clockwise from the turn's seat) with pending
   *  "during any Methuselah's unlock phase" abilities (Homunculus). */
  private nextUnlockAbilitySeat(tf: TurnFrame): SeatId | null {
    for (const seatId of sequencingOrder(this.state, tf.seat, [])) {
      if (seatId === tf.seat) continue;
      if (tf.unlockOthersDone.includes(seatId)) continue;
      if (this.abilityOptionsFor(seatId, "turn.unlock").length > 0) return seatId;
    }
    return null;
  }

  private processOusts(): boolean {
    let changed = false;
    for (;;) {
      const victim = this.state.seats.find((s) => !s.ousted && s.pool <= 0);
      if (!victim) break;
      changed = true;
      // Identify the predator before the oust changes adjacency.
      const predator = predatorOf(this.state, victim.id);
      // "After your prey is ousted, burn this card and gain 3 pool" (War
      // of Ages) — fired BEFORE the event for the same reason the predator
      // is read before it: the oust rewrites adjacency, and this is the
      // last moment "your prey" still names this seat.
      for (const { entry, owner } of this.allEntries()) {
        this.registry[entry.card.name]?.onSeatOusted?.(entry, owner, victim.id, this);
      }
      this.emit({ type: "Ousted", seat: victim.id });
      if (predator !== victim.id && !getSeat(this.state, predator).ousted) {
        // "You receive 1 victory point when your prey is ousted" (p. 44);
        // the surviving predator also gains 6 pool (p. 36).
        this.emit({ type: "VictoryPointGained", seat: predator });
        this.emit({ type: "PoolGained", seat: predator, amount: 6 });
      }
    }
    const standing = standingSeats(this.state);
    if (standing.length <= 1 && this.state.frames.length > 0) {
      const winner = standing[0]?.id ?? null;
      if (winner !== null) {
        // "…and for being the last Methuselah in the game" (p. 44).
        this.emit({ type: "VictoryPointGained", seat: winner });
      }
      this.emit({ type: "GameEnded", winner });
      this.state.frames.length = 0;
      changed = true;
    }
    return changed;
  }

  private endTurn(tf: TurnFrame): void {
    // "Cannot act this turn" (recruited allies, p. 22) expires now.
    for (const seat of this.state.seats) {
      for (const m of seat.minions) m.cannotActThisTurn = false;
    }
    // "…take control of them until the END OF YOUR TURN" (Puppet Master
    // superior) — the one borrowed-control card in the pool. Reverting is
    // the same op in the other direction, so everything on the minion
    // goes home with it (p. 16). docs/taking-actions-design.md §3
    for (const seat of [...this.state.seats]) {
      for (const m of [...seat.minions]) {
        const back = m.controlRevertsTo;
        if (back === undefined) continue;
        delete m.controlRevertsTo;
        // Their Methuselah may have been ousted while the loan ran; there
        // is then nobody to give them back to and they stay put.
        if (back !== seat.id && !getSeat(this.state, back).ousted) {
          this.changeMinionControl(m.id, back);
        }
      }
    }
    const next = preyOf(this.state, tf.seat);
    const turnNumber = tf.turnNumber + 1;
    if (this.state.maxTurns !== null && turnNumber > this.state.maxTurns) {
      // Engine safeguard, not a game rule: stop with no winner.
      this.emit({ type: "GameEnded", winner: null });
      this.state.frames.length = 0;
      return;
    }
    this.emit({ type: "TurnBegan", seat: next, turnNumber });
    this.state.frames[this.state.frames.length - 1] = {
      kind: "turn",
      seat: next,
      phase: "unlock",
      turnNumber,
      unlockDone: false,
      edgeDone: false,
      unlockAbilitiesDone: false,
      unlockOthersDone: [],
      transfersLeft: 0,
      masterActionsLeft: 0,
      trifleGained: false,
    };
    // "+2 hand size UNTIL THE END OF THE TURN" has just lapsed with the
    // old frame: p. 7 sheds the excess now. AFTER the replacement, so
    // `handSizeOf` already excludes the bonus — and after the discard
    // phase, which is the ordering p. 50 spells out for Dreams of the
    // Sphinx. docs/temporary-hand-size-design.md §3
    this.expireHandSizeBonus(tf.handSizeBonus);
  }

  private settleCombat(cf: CombatFrame): boolean {
    switch (cf.step) {
      case "beforeRange":
        if (cycleQuiescent(cf.cycle)) {
          cf.step = "range";
          cf.awaiting = "acting";
          cf.declines = 0;
          return true;
        }
        return false;
      case "beforeStrikes":
        if (cycleQuiescent(cf.cycle)) {
          // "Neither combatant can strike this round" (One With the Land):
          // both strikes are fixed to a no-op (0 damage), so the round
          // resolves without any strike being chosen.
          if (cf.suppressStrikesRound === cf.round) {
            const none = (): Strike => ({ ...HAND_STRIKE, damage: 0 });
            cf.strikes = { acting: none(), opposing: none() };
          }
          cf.step = "chooseStrike";
          return true;
        }
        return false;
      case "chooseStrike":
        if (this.allStrikersChosen(cf)) {
          this.resolveStrikes(cf);
          return true;
        }
        return false;
      case "damageResolution":
        // Clear anything at the head that needs no decision before the
        // window is computed, so it never opens on an item nobody can
        // answer (docs/round-recurring-combat-design.md §5).
        if (this.drainAutoPrevented(cf)) return true;
        if (cf.pendingDamage.length === 0) {
          // A burned combatant (ally) no longer exists — "no longer
          // ready" covers it (p. 30).
          const actingReady = this.combatantReady(cf.acting);
          const opposingReady = this.combatantReady(cf.opposing);
          if (!actingReady || !opposingReady) {
            // "The round and the combat end immediately" (p. 30) — but the
            // End of Round step still occurs (p. 32).
            cf.endedPrematurely = true;
            cf.step = "endOfRound";
            cf.cycle = newCycle(cf.cycle.order);
          } else if (cf.additionalStrikes.acting > 0 || cf.additionalStrikes.opposing > 0) {
            // Additional strikes remain → an extra strike sub-round at the
            // same range, only for minions with additional strikes (p. 32).
            cf.strikeRound = "additional";
            cf.strikes = { acting: null, opposing: null };
            cf.step = "chooseStrike";
          } else {
            cf.step = "press";
            cf.awaiting = "acting";
            cf.declines = 0;
          }
          return true;
        }
        return false;
      case "endOfRound":
        if (cycleQuiescent(cf.cycle)) {
          if (cf.willContinue && !cf.endedPrematurely) {
            cf.round += 1;
            // "…that round is at close range (SKIP the determine range
            // step)" (Immortal Grapple superior). The boundary already
            // forces close range; the flag skips the step a maneuver
            // would otherwise reopen (docs/round-end-design.md §2).
            cf.step = cf.skipRangeNextRound ? "beforeStrikes" : "beforeRange";
            cf.skipRangeNextRound = false;
            cf.range = "close";
            cf.strikes = { acting: null, opposing: null };
            cf.strikeRound = "normal";
            cf.additionalStrikes = { acting: 0, opposing: 0 };
            cf.usedLimitedAddl = { acting: false, opposing: false };
            cf.presses = { acting: 0, opposing: 0 }; // per-round credits
            cf.usedThisRound = []; // "each round" abilities recharge
            cf.playedThisRound = []; // "one X each round" resets
            cf.handStrikesAggravated = { acting: false, opposing: false };
            // "…cannot be used THIS ROUND (by either combatant)"
            // (Immortal Grapple) and the aim rider that rides one strike.
            cf.handStrikesOnly = false;
            cf.aimBonus = { acting: 0, opposing: 0 };
            cf.aimsThisStrike = [];
            cf.bloodLostThisRound = { acting: 0, opposing: 0 };
            // "THIS ROUND, this vampire can strike…" (Hunger of Marduk) —
            // a round-scoped grant is gone; a once-per-combat one is not.
            if (cf.grantedStrikes) {
              cf.grantedStrikes.acting = cf.grantedStrikes.acting.filter((g) => !g.roundOnly);
              cf.grantedStrikes.opposing = cf.grantedStrikes.opposing.filter(
                (g) => !g.roundOnly,
              );
            }
            // "…strikes with weapons inflict no damage THIS ROUND".
            cf.weaponDamageNullified = { acting: false, opposing: false };
            // "…this round" (Rolling with the Punches superior).
            cf.preventAllFrom = { acting: false, opposing: false };
            // "This round, this vampire gets +1 strength" (Obedient Flesh)
            // — unlike strengthBonus, which lasts the whole combat.
            cf.strengthBonusRound = { acting: 0, opposing: 0 };
            // "THIS ROUND, 1 optional maneuver, only to get to close
            // range" (Angel's Gift) — unspent, it is gone.
            cf.closeManeuvers = { acting: 0, opposing: 0 };
            // "…can prevent N damage EACH ROUND" is a rate, so what
            // refreshes is the spend, not the grant.
            cf.preventPerRoundUsed = { acting: 0, opposing: 0 };
            // Flesh of Marble asks "in a given round", so the tally of
            // what has landed starts over.
            cf.damageTakenThisRound = { acting: 0, opposing: 0 };
            // Strike commitment is per round; the weapon-maneuver limit
            // and strength overrides last the whole combat.
            cf.committedStrike = { acting: null, opposing: null };
            cf.willContinue = false;
            cf.cycle = newCycle(cf.cycle.order);
            // "…before range is determined EACH ROUND this combat"
            // (Weather Control) — the new round has just reached that
            // point. The round it was played in was handled at play time.
            for (const r of cf.roundDamage) {
              if (r.when === "beforeRange") this.inflictRoundDamage(cf, r);
            }
          } else {
            this.emit({ type: "CombatEnded", rounds: cf.round });
            this.pop();
            // AFTER the pop, not before: a hook here may raise a choice
            // frame, and the combat's own pop() would eat it and leave the
            // combat frame in place — an infinite end-combat loop. The
            // combatants are read off the captured frame object, which
            // outlives its place on the stack (Monster).
            this.applyAfterCombatRiders(cf);
            this.notifyCombatEnded(cf);
            // "THIS COMBAT, you get +1 hand size" lapsed with the pop —
            // and this is the engine's single CombatEnded site, which is
            // what makes the derived model safe (§3).
            this.expireHandSizeBonus(cf.handSizeBonus);
          }
          return true;
        }
        return false;
      default:
        return false; // range/press/chooseStrike advance via choose()
    }
  }

  // -- resolutions ----------------------------------------------------------

  /** Tally and resolve (p. 28): more for than against passes; ties
   *  fail. Effects apply only on a pass, with the frame already popped
   *  (like action resolution). */
  private resolveReferendum(rf: ReferendumFrame): void {
    if (rf.margin === undefined) {
      let f = 0;
      let a = 0;
      for (const v of rf.votes) {
        if (v.inFavor) f += v.count;
        else a += v.count;
      }
      rf.votesFor = f;
      rf.votesAgainst = a;
      rf.margin = f - a;
      // Yoruba Shrine forces a FAILURE — the referendum still resolves, so
      // a title-granting card still burns (p. 27); not a cancellation.
      rf.passed = !rf.forcedFail && f > a;
    }
    // "Only usable after resolution of a political action whose referendum
    // PASSED" — an impulse before the frame leaves the stack, offered only
    // on a pass and only when some seat can use it
    // (docs/referendum-margin-design.md §2). The step is set BEFORE the
    // probe: each card's usable rule asserts it is in this window, so
    // asking first would always answer "nobody".
    if (rf.passed === true && rf.step !== "afterResolution") {
      const previous = rf.step;
      rf.step = "afterResolution";
      if (this.anyAfterReferendumPlay()) {
        cycleRewind(rf.cycle);
        return;
      }
      rf.step = previous;
    }
    const votesFor = rf.votesFor ?? 0;
    const votesAgainst = rf.votesAgainst ?? 0;
    const passed = rf.passed === true;
    this.pop();
    this.emit({
      type: "ReferendumResolved",
      actionId: rf.actionId,
      passed,
      votesFor,
      votesAgainst,
    });
    // "…once results are tallied" (Scorn of Adonis): after the result is
    // emitted and WHATEVER the outcome — the card does not say "if it
    // passes". Charged per Methuselah, once, however many against-votes
    // they cast, and read off `v.seat` so "including controlling a minion
    // casting" is covered by construction.
    for (const pt of rf.postTally ?? []) {
      if (pt.kind !== "burnPoolVotedAgainst") continue;
      const seats = new Set(rf.votes.filter((v) => !v.inFavor).map((v) => v.seat));
      for (const seat of seats) {
        if (getSeat(this.state, seat).ousted) continue;
        this.emit({ type: "PoolBurned", seat, amount: pt.amount });
      }
    }
    if (!passed) {
      // A failed title-granting referendum burns its held card — it was
      // set aside at action resolution rather than burned (p. 27). Guard on
      // cardInstanceId first: a blood hunt has no calling card.
      if (rf.cardInstanceId && this.handler(rf.cardName).holdsCardForReferendum) {
        this.emit({ type: "CardBurned", cardId: rf.cardInstanceId, name: rf.cardName, seat: rf.caller });
      }
      // "…is canceled or FAILS" (Cedrick). The frame is already popped.
      this.notifyReferendumLost(rf, "failed");
      return;
    }
    if (rf.variant === "bloodHunt") {
      // A passed blood hunt burns the diablerist (p. 35) — if still in
      // play (a mid-referendum effect could have removed them).
      if (rf.bloodHuntTarget && findMinion(this.state, rf.bloodHuntTarget)) {
        this.emit({ type: "BloodHuntCalled", diablerist: rf.bloodHuntTarget });
        this.burnMinion(rf.bloodHuntTarget);
      }
      return;
    }
    this.handler(rf.cardName).applyReferendum?.(rf, this);
  }

  /**
   * "Each time the attached vampire ANNOUNCES an action, …" (Slaughtering
   * the Herd, Evan Klein).
   *
   * Fired from the three sites that PUSH an action frame, not from
   * `applyToFrames` on `ActionAnnounced` — which is where it lived, and
   * which is one step too early: the event is emitted BEFORE the frame is
   * pushed, so a card acting on it saw no action at all. Slaughtering the
   * Herd only emits a bleed and never noticed; Evan Klein calls
   * `failAction()`, which needs a frame to fail and silently did nothing.
   *
   * The chokepoint property the old placement was chosen for is kept: the
   * three callers all go through this one helper, so a fourth announce
   * path cannot forget the hook without also forgetting to push a frame.
   * docs/crypt-wave-7.md §1
   */
  private notifyActionAnnounced(af: ActionFrame): void {
    const info = {
      minion: af.acting,
      seat: af.actingSeat,
      target: af.target,
      targetMinion: af.targetMinion ?? null,
    };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onActionAnnounced?.(entry, owner, info, this);
    }
  }

  /** "Minions must BURN THE TOP CARD OF THEIR LIBRARY to attempt to block
   *  \<tagged\> allies" (Parijat) — the third block-toll currency, paid at
   *  both attempt sites beside the blood one. Affordability was already
   *  settled by `blockTollFor`, which returns null for a blocker with an
   *  empty library. docs/crypt-wave-7.md §6 */
  private payLibraryBlockToll(blocker: MinionState, actor: MinionState | null): void {
    if (!actor) return;
    const n = libraryBlockToll(this.state, actor);
    for (let i = 0; i < n; i++) {
      const top = getSeat(this.state, blocker.controller).library[0];
      if (!top) return;
      this.emit({
        type: "LibraryTopBurned",
        seat: blocker.controller,
        cardId: top.id,
        name: top.name,
      });
    }
  }

  /** "If the referendum … is CANCELED or FAILS" (Cedrick Calhoun). Two
   *  outcomes the engine deliberately keeps apart — a cancelled
   *  referendum never resolves and emits no `ReferendumResolved` — so one
   *  hook is fired from both paths, with `how` saying which.
   *  docs/crypt-wave-6.md §3 */
  private notifyReferendumLost(rf: ReferendumFrame, how: "cancelled" | "failed"): void {
    const info = { callingMinion: rf.callingMinion ?? null, how };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onReferendumLost?.(entry, owner, info, this);
    }
  }

  /** Vote sources available to `seat` right now (p. 28): each unused
   *  ready titled vampire (locked is fine), the Edge, the calling card
   *  (caller only), and one political action card from hand — at most
   *  one card vote per Methuselah per referendum. */
  private pollingOptions(rf: ReferendumFrame, seat: SeatId): LegalOption[] {
    const options: LegalOption[] = [];
    // "Vampires must burn 1 blood to cast votes AGAINST referendums called
    // by Alexander Silverson" — a toll carried by the CALLING minion, paid
    // by each voter. The block-tax shape one frame over: it gates the
    // option as well as being charged (docs/crypt-wave-6.md §2).
    const caller = rf.callingMinion ? findMinion(this.state, rf.callingMinion) : null;
    const againstToll =
      caller?.attached.reduce((n, p) => n + (p.statics.voteTollAgainst?.blood ?? 0), 0) ?? 0;
    /** `voter` is the vampire casting, when the source is one — a toll is
     *  paid in BLOOD, so only a minion can pay it, and a card or Edge vote
     *  is untolled by construction. */
    const both = (
      source: string,
      count: number,
      label: string,
      voter?: MinionState,
      bonus?: { for: number; against: number },
    ): void => {
      for (const inFavor of [true, false]) {
        const n = count + (inFavor ? (bonus?.for ?? 0) : (bonus?.against ?? 0));
        if (n <= 0) continue;
        const toll = !inFavor && voter ? againstToll : 0;
        // A voter who cannot pay cannot vote that way — the option is not
        // offered, rather than offered and then failing.
        if (toll > 0 && voter!.blood < toll) continue;
        options.push({
          id: `vote:${source}:${inFavor ? "for" : "against"}`,
          kind: "castVote",
          label:
            `${label}: ${n} vote${n > 1 ? "s" : ""} ${inFavor ? "for" : "against"}` +
            (toll > 0 ? ` (burn ${toll} blood)` : ""),
          source,
          count: n,
          inFavor,
          ...(toll > 0 ? { toll } : {}),
        });
      }
    };
    for (const m of getSeat(this.state, seat).minions) {
      if (!isReady(m)) continue;
      // Votes come from a printed title AND from cards that grant them
      // (Saulot's Guiding Wisdom represents "a unique Independent title
      // worth 2 votes", which is not one of the eleven VampireTitles).
      const cardVotes = m.attached.reduce((n, p) => n + (p.statics.votes ?? 0), 0);
      const titleVotes = m.title === null ? 0 : TITLE_VOTES[m.title];
      // Global vote statics ("titled Brujah get +1 vote, Ventrue get −1",
      // New Carthage). CLAMPED at zero: a negative subtracts a Ventrue's
      // votes, it never hands their opponents votes against
      // (docs/politics-locations-design.md §2).
      // "Vampires who do not follow the Path of X get −1 vote" (Absolute
      // Tyranny superior) — scoped to this referendum, and clamped by the
      // same Math.max: a negative takes votes away, it never hands the
      // other side votes against (docs/path-cards-design.md §4).
      const refMod = (rf.voteModifiers ?? []).reduce(
        (n, v) => (v.exceptPath !== undefined && m.path === v.exceptPath ? n : n + v.amount),
        0,
      );
      const votes = Math.max(
        0,
        titleVotes +
          cardVotes +
          auraBonus(this.state, m, "votes") +
          // "While you control 1 or more locations, Neserian gets +1
          // vote" — a crypt card's conditional static, board-conditioned.
          conditionalStaticNoAction(this.state, m, "votes") +
          refMod,
      );
      if (votes <= 0) continue;
      if (rf.usedSources.includes(m.id)) continue;
      // Forced to abstain this referendum (Scalpel Tongue, Telepathic Vote
      // Counting) — separate from usedSources, which means "spent".
      if (rf.abstaining?.includes(m.id)) continue;
      // "…or cast votes or ballots this turn" (Expulsion).
      if (m.expelledThisTurn) continue;
      // "Non-<sect> vampires cannot cast votes or ballots" (p. 28).
      if (rf.voteRestriction && m.sect !== rf.voteRestriction.sect) continue;
      // "+2 votes when casting votes AGAINST blood hunt referendums"
      // (Jason Newberry) — the only vote static that depends on which WAY
      // the vote goes, so it is applied per option rather than folded
      // into the count above (docs/crypt-wave-6.md §1).
      const bonus = { for: 0, against: 0 };
      for (const p of m.attached) {
        const vb = p.statics.voteBonus;
        if (!vb) continue;
        if (vb.variant !== undefined && vb.variant !== rf.variant) continue;
        if (vb.direction !== "against") bonus.for += vb.amount;
        if (vb.direction !== "for") bonus.against += vb.amount;
      }
      both(m.id, votes, `${m.name} (${m.title ?? "titled by a card"})`, m, bonus);
    }
    if (this.state.edge === seat && !rf.usedSources.includes("edge")) {
      both("edge", 1, "Burn the Edge");
    }
    // Bonus votes granted by cards played this polling step (§3).
    const grant = rf.voteGrants[seat] ?? 0;
    if (grant > 0 && !rf.usedSources.includes(`grant:${seat}`)) {
      both("grant", grant, "Granted votes");
    }
    const cardVoteSpent = rf.usedSources.includes(`cardvote:${seat}`);
    // A blood hunt has no calling card, so no caller vote (p. 35).
    if (
      rf.variant === "political" &&
      seat === rf.caller &&
      !rf.usedSources.includes("caller") &&
      !cardVoteSpent
    ) {
      both("caller", 1, `${rf.cardName} (calling card)`);
    }
    if (!cardVoteSpent) {
      for (const card of getSeat(this.state, seat).hand) {
        const h = this.registry[card.name];
        if (!h?.isPoliticalAction) continue;
        both(`card:${card.id}`, 1, `Burn ${card.name}`);
      }
    }
    return options;
  }

  private combatantReady(minionId: MinionId): boolean {
    const m = findMinion(this.state, minionId);
    return m !== null && isReady(m);
  }

  private resolveCardPlay(cp: CardPlayFrame): void {
    // Pop before resolving: an action card's resolve() pushes the new
    // ActionFrame, which must land on top of the enclosing frame.
    this.pop();
    const parent = this.top();
    const handler = this.handler(cp.card.name);
    if (!cp.canceled) {
      handler.resolve(cp, this);
      this.emit({ type: "CardResolved", cardId: cp.card.id, name: cp.card.name });
      // "A card is played by … placing it from the hand in the ash heap
      // UPON RESOLUTION" (p. 8) — but only if it did not go INTO PLAY
      // instead, and not for an action card, which is burned separately
      // at action resolution (p. 27). Both exclusions are checked here
      // rather than guessed: filing a card that entered play would file
      // it a second time when it is later burnt.
      // docs/ash-heap-design.md §3
      if (!cp.asAction && !this.allEntries().some((e) => e.entry.card.id === cp.card.id)) {
        this.toAshHeap(cp.seat, cp.card);
      }
      // "When a Methuselah successfully plays a trifle, they gain an
      // additional master phase action" — once per master phase (p. 10).
      if (
        handler.isTrifle &&
        parent &&
        parent.kind === "turn" &&
        parent.phase === "master" &&
        !parent.trifleGained
      ) {
        parent.masterActionsLeft += 1;
        parent.trifleGained = true;
      }
    } else {
      // A canceled action card never locked its minion and may be played
      // again (p. 16); nothing to undo because everything was deferred.
      this.emit({ type: "CardCanceled", cardId: cp.card.id, name: cp.card.name });
    }
    // Playing an effect hands the impulse back to the acting Methuselah in
    // the enclosing window (p. 8). During damage resolution the live cycle
    // is the per-damage-item one, not the combat's round cycle — rewinding
    // the wrong one would let the window close on a seat that had just
    // been given something new to answer.
    if (parent?.kind === "combat" && parent.step === "damageResolution" && parent.damageCycle) {
      cycleRewind(parent.damageCycle);
    } else if (parent && "cycle" in parent) {
      cycleRewind(parent.cycle);
    }
  }

  announceCardAction(play: CardPlayFrame, params: CardActionParams): void {
    if (!play.minion) throw new Error("action card without a minion");
    const m = getMinion(this.state, play.minion);
    const seat = m.controller;
    const actionId = this.freshId("action-");
    this.emit({ type: "MinionLocked", minion: m.id });
    // "A minion cannot play the same named action card more than once
    // each turn, even if they unlock" (p. 20) — recorded here, not at
    // play time, so a canceled card can be replayed.
    m.playedSinceUnlock.push(play.card.name);

    let target: SeatId | null = null;
    let directed = false;
    if (params.actionKind === "bleed") {
      // An enhanced bleed follows all bleed rules (p. 23): one bleed per
      // minion per turn, prey as default target, directed.
      m.bledThisTurn = true;
      target = preyOf(this.state, seat);
      directed = true;
    }
    if (params.targetMinion) {
      // Rush: directed iff the target minion belongs to another
      // Methuselah (p. 25; Warrens ruling p. 52).
      const controller = getMinion(this.state, params.targetMinion).controller;
      if (controller !== seat) {
        target = controller;
        directed = true;
      }
    }
    if (params.targetPermanent) {
      // "Ⓓ Burn a location" / "Ⓓ Steal a location" from hand — directed
      // at the card's CONTROLLER, who alone may block (p. 25), the same
      // rule a granted action targeting a card in play already uses.
      const controller = this.controllerOfEntry(params.targetPermanent);
      if (controller !== null && controller !== seat) {
        target = controller;
        directed = true;
      }
    }
    if (params.targetSeat && params.targetSeat !== seat) {
      // "Steal 1 pool from another Methuselah" — an action aimed at a
      // SEAT: directed, so only that Methuselah may block (p. 25).
      target = params.targetSeat;
      directed = true;
    }
    if (params.political) {
      // One political action per vampire per turn (p. 24) — recorded at
      // announcement, like bledThisTurn.
      m.calledPoliticalThisTurn = true;
    }
    // The announcing card's printed types ride along: "recruit and employ
    // actions" are ally/retainer cards, and nothing else distinguishes
    // them from any other cardEffect action (conditional statics §2).
    const announcedTypes =
      this.handler(play.card.name).costTypes?.(play.mode, play.params["variant"]) ?? [];
    // …and its printed SUB-TYPES, the sibling of the above off the same
    // central query: "an action to recruit or employ a WRAITH OR ZOMBIE"
    // (Paths in Two Worlds) is a question about the announcing card, and
    // the ally is not in play yet to be asked.
    // docs/wraith-zombie-design.md §4
    const announcedTags = this.handler(play.card.name).permanentTags ?? [];
    this.emit({
      type: "ActionAnnounced",
      actionId,
      actionKind: params.actionKind,
      acting: m.id,
      seat,
      target,
      directed,
      ...(params.targetMinion ? { targetMinion: params.targetMinion } : {}),
      ...(announcedTypes.length > 0 ? { cardTypes: announcedTypes } : {}),
      ...(announcedTags.length > 0 ? { cardTags: announcedTags } : {}),
    });
    const frame: ActionFrame = {
      kind: "action",
      actionId,
      actionKind: params.actionKind,
      card: { instance: play.card, mode: play.mode, params: play.params },
      acting: m.id,
      actingSeat: seat,
      target,
      directed,
      targetMinion: params.targetMinion ?? null,
      rushRiders: params.rushRiders
        ? {
            maneuver: params.rushRiders.maneuver ?? 0,
            press: params.rushRiders.press ?? 0,
            ...(params.rushRiders.strength ? { strength: params.rushRiders.strength } : {}),
            ...(params.rushRiders.noCombatEndsFirstRound
              ? { noCombatEndsFirstRound: true }
              : {}),
          }
        : null,
      // "At the end of that combat, …" — fixed at announcement (p. 25)
      // like every other action detail (docs/rush-outcome-design.md §2).
      combatOutcome: params.combatOutcome ?? null,
      targetPermanent: params.targetPermanent ?? null,
      ...(params.noCombat ? { noCombatOnSuccess: true } : {}),
      ...(params.invertCombatRoles ? { invertCombatRoles: true } : {}),
      ...(params.lockTarget ? { lockTargetOnSuccess: true } : {}),
      grantedEffect: null,
      grantedCost: null,
      // "…can use those counters to pay some or all of the cost" — the
      // split the play option carried (docs/cost-sources-design.md §4).
      costFromCards: parsePayFrom(play.params["payFrom"]),
      rescueSplit: null,
      step: "announce",
      declinedBlocks: [],
      played: [],
      blockedBy: null,
      notBlockPenalties: [],
      unlockOnSuccess: [],
      drawAfter: [],
      playCostMods: [],
      delayReplaceTypes: [],
      noReactionsFrom: [],
      blockerCombatRiders: {},
      actorCombatRider: {
        prevent: 0,
        strength: 0,
        maneuver: 0,
        press: 0,
        handStrikesAggravated: false,
        combatAggravated: false,
      },
      blockPenalties: [],
      interceptBurnGrants: [],
      attachOnBlock: [],
      usedInPlayAbilities: [],
      corruptionUnlocks: [],
      blockCosts: [],
      noUnlock: false,
      afterResolutionDamage: [],
      queuedCombats: [],
      blockRestrictions: { noAllies: false, noVampires: false, noTitled: false, cannotBlock: [] },
      cycle: newCycle([seat]),
    };
    frame.cycle = newCycle(
      sequencingOrder(this.state, seat, defendersFor(this.state, frame)),
    );
    this.state.frames.push(frame);
    this.notifyActionAnnounced(frame);
    if (params.inherentStealth) {
      this.emit({
        type: "StealthModified",
        actionId,
        delta: params.inherentStealth,
        source: play.card.name,
      });
    }
    if (params.bleedBonus) {
      this.emit({
        type: "BleedAmountModified",
        actionId,
        delta: params.bleedBonus,
        source: play.card.name,
        limited: false, // the card's own bonus is not a bleed modifier
      });
    }
  }

  /** Convert a reaction's queued "unlock and attempt to block" into a real
   *  block attempt — identical to a manual `declareBlock`, plus the card's
   *  intercept bonus applied up front (docs/unlock-and-block-design.md). */
  private startAutoBlock(af: ActionFrame): void {
    const pending = af.pendingAutoBlock!;
    delete af.pendingAutoBlock;
    const blocker = getMinion(this.state, pending.minion);
    // The vampire may have left the ready region since (torpor); if so the
    // forced block simply does not happen.
    if (!isReady(blocker) || af.step !== "A") return;
    // A forced block is still an attempt to block, so it pays the action's
    // toll — and does not happen if the vampire cannot (block-tax design).
    const actor = findMinion(this.state, af.acting);
    const toll = blockTollFor(af, blocker, actor, this.state);
    if (toll === null) return;
    if (toll > 0) this.emit({ type: "BloodBurned", minion: blocker.id, amount: toll });
    this.payLibraryBlockToll(blocker, actor);
    if (pending.interceptBonus !== 0) {
      this.emit({
        type: "InterceptModified",
        actionId: af.actionId,
        minion: blocker.id,
        delta: pending.interceptBonus,
        source: "unlock-and-block",
      });
    }
    af.step = "B";
    this.emit({
      type: "BlockDeclared",
      actionId: af.actionId,
      seat: blocker.controller,
      blocker: blocker.id,
    });
    this.state.frames.push({
      kind: "blockAttempt",
      actionId: af.actionId,
      blockerSeat: blocker.controller,
      blocker: blocker.id,
      cycle: newCycle(
        sequencingOrder(this.state, af.actingSeat, defendersFor(this.state, af)),
      ),
    });
    // A forced block is still a block, so it triggers the same cards a
    // declared one does (docs/block-tax-design.md made the same point
    // about the toll). After the frame push, so a hook that raises a
    // choice gets it answered before the attempt resolves — which is what
    // "before block resolution" asks for (Rebel).
    this.notifyBlockDeclared(af, blocker.id);
  }

  /** "This vampire unlocks and attempts to block" (Sense the Savage Way):
   *  unlock it (persists), pay any blood cost, and queue the forced block. */
  unlockAndAttemptBlock(
    minion: MinionId,
    opts: {
      interceptBonus?: number;
      bloodCost?: number;
      noBlockPenalty?: { kind: "lock" } | { kind: "attach"; cardId: CardInstanceId; cardName: string };
    },
  ): void {
    const af = this.action();
    if (!af) throw new Error("unlockAndAttemptBlock outside an action");
    if (opts.bloodCost) {
      this.emit({ type: "BloodBurned", minion, amount: opts.bloodCost });
    }
    this.emit({ type: "MinionUnlocked", minion });
    af.pendingAutoBlock = { minion, interceptBonus: opts.interceptBonus ?? 0 };
    // "If this vampire does not block this action, lock/attach it after
    // action resolution" (Dogged Pursuit).
    if (opts.noBlockPenalty) {
      af.blockPenalties.push({ minion, ...opts.noBlockPenalty });
    }
  }

  /** "Unlock this vampire" (Guard Dogs) — a locked vampire unlocks so its
   *  controller can block it through the normal flow. */
  unlockReactingMinion(minion: MinionId): void {
    this.emit({ type: "MinionUnlocked", minion });
  }

  /** "During this action, this vampire can burn 1 blood to get +1
   *  intercept" (Eyes of the Wild) — a repeatable, action-scoped grant. */
  grantBurnForIntercept(minion: MinionId): void {
    const af = this.action();
    if (!af) throw new Error("grantBurnForIntercept outside an action");
    if (!af.interceptBurnGrants.includes(minion)) af.interceptBurnGrants.push(minion);
  }

  /**
   * "They can cancel their block attempt" (Dawn Operation) — a built-in
   * option in the blocking seat's own impulse, beside the burn-for-
   * intercept option that established this shape.
   *
   * The card says "if a **vampire** is currently attempting to block", so
   * an ally blocker has no way out. The blocker can also have left play
   * while the attempt was open, hence `findMinion`.
   */
  /**
   * "Their controller can burn N pool to cancel this card as it is
   * played" (Golconda: Inner Peace) — a cancel paid in POOL, by a
   * Methuselah, with no card involved.
   *
   * Built-in rather than a ChoiceFrame for the Dawn Operation reason: the
   * as-played window already cycles every seat, so the payer is already
   * being asked and a frame would interrupt a decision they were about to
   * get anyway. docs/cross-table-masters-design.md §2
   */
  private payToCancelOptions(cp: CardPlayFrame, seat: SeatId): LegalOption[] {
    const p = cp.payToCancel;
    if (!p || cp.canceled || seat !== p.seat) return [];
    // "They can DISCARD TWO COMBAT CARDS to cancel this card as it is
    // played" (Target Vitals) — the same gate with a different currency,
    // one option per pair (docs/round-end-design.md §3).
    if (p.discardCombatCards) {
      const hand: CardInstance[] = getSeat(this.state, seat).hand.filter(
        (c) => this.registry[c.name]?.isCombatCard,
      );
      const out: LegalOption[] = [];
      // One option per PAIR, the `combinations()` shape — the player
      // chooses which two go, rather than the engine choosing for them.
      const pairs: CardInstance[][] = [];
      const pick = (start: number, acc: CardInstance[]): void => {
        if (acc.length === p.discardCombatCards) {
          pairs.push([...acc]);
          return;
        }
        for (let i = start; i < hand.length; i++) {
          acc.push(hand[i]!);
          pick(i + 1, acc);
          acc.pop();
        }
      };
      pick(0, []);
      for (const pair of pairs) {
        out.push({
          id: `cancelpay:${cp.card.id}:${pair.map((c) => c.id).join(",")}`,
          kind: "payToCancel",
          label: `Discard ${pair.map((c) => c.name).join(" + ")} to cancel ${cp.card.name}`,
          pool: 0,
          params: { discard: pair.map((c) => c.id).join(",") },
        });
      }
      return out;
    }
    // Never oust yourself to cancel: the pool must survive the payment,
    // the same gate every master's own cost uses.
    if (getSeat(this.state, seat).pool <= p.pool) return [];
    return [
      {
        id: `cancelpay:${cp.card.id}`,
        kind: "payToCancel",
        label: `Burn ${p.pool} pool to cancel ${cp.card.name}`,
        pool: p.pool,
      },
    ];
  }

  private cancelBlockOptions(ba: BlockAttemptFrame, seat: SeatId): LegalOption[] {
    if (!ba.mayCancel || ba.cancelled || seat !== ba.blockerSeat) return [];
    const m = findMinion(this.state, ba.blocker);
    if (!m || m.kind !== "vampire") return [];
    return [
      {
        id: `cancelblock:${ba.blocker}`,
        kind: "cancelBlock",
        label: `${m.name}: cancel the block attempt`,
        minion: ba.blocker,
      },
    ];
  }

  /** Built-in "burn 1 for +1 intercept" options during a block attempt, for
   *  a granted blocker whose intercept still falls short (p. 26). */
  private burnForInterceptOptions(ba: BlockAttemptFrame, seat: SeatId): LegalOption[] {
    if (seat !== ba.blockerSeat) return [];
    const af = this.action();
    if (!af || !af.interceptBurnGrants.includes(ba.blocker)) return [];
    // The blocker can have left play since the attempt began (an ally that
    // paid its last life), and an option enumerator must be total.
    const m = findMinion(this.state, ba.blocker);
    if (!m || m.blood < 1) return [];
    if (
      currentIntercept(this.state, ba.actionId, ba.blocker) >=
      currentStealth(this.state, ba.actionId)
    ) {
      return [];
    }
    return [
      {
        id: `burn:intercept:${ba.blocker}`,
        kind: "burnForIntercept",
        label: `${m.name}: burn 1 blood for +1 intercept`,
        minion: ba.blocker,
      },
    ];
  }

  /** Every card in play with the owner record its hooks expect: seat-level
   *  cards and cards attached to a minion, the latter reporting their
   *  bearer. A snapshot, so a hook may burn or move entries safely. */
  private allEntries(): Array<{
    entry: PermanentInPlay;
    owner: { seat: SeatId; minion: MinionId | null };
  }> {
    const out: Array<{
      entry: PermanentInPlay;
      owner: { seat: SeatId; minion: MinionId | null };
    }> = [];
    for (const s of this.state.seats) {
      for (const p of [...s.permanents]) {
        out.push({ entry: p, owner: { seat: p.controller ?? s.id, minion: null } });
      }
      for (const m of [...s.minions]) {
        for (const p of [...m.attached]) {
          out.push({ entry: p, owner: { seat: p.controller ?? s.id, minion: m.id } });
        }
      }
    }
    return out;
  }

  /** Notify in-play cards that a minion is about to leave the ready
   *  region (docs/granted-rush-design.md §6). Fired before the burn or
   *  torpor event so the minion, its controller and its attached cards
   *  are all still readable. */
  private notifyLeaveReady(minion: MinionId, how: "burned" | "torpor" | "removed"): void {
    const m = findMinion(this.state, minion);
    if (!m) return;
    const info = { minion, controller: m.controller, how };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onLeaveReady?.(entry, owner, info, this);
    }
  }

  /** Notify in-play cards that every Methuselah has declined to block, so
   *  the action is going through (Spying Mission —
   *  docs/last-equipment-modifiers-design.md §6). */
  private notifyBlocksDeclined(af: ActionFrame): void {
    const info = {
      actionId: af.actionId,
      acting: af.acting,
      actingSeat: af.actingSeat,
      actionKind: af.actionKind,
      target: af.target,
    };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onBlocksDeclined?.(entry, owner, info, this);
    }
  }

  /** Notify in-play cards that an action resolved, win or lose (the
   *  archetypes — docs/archetypes-design.md §2). */
  private notifyActionResolved(af: ActionFrame, success: boolean): void {
    const info = {
      actionId: af.actionId,
      success,
      acting: af.acting,
      actingSeat: af.actingSeat,
      actionKind: af.actionKind,
    };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onActionResolved?.(entry, owner, info, this);
    }
  }

  /**
   * "After combat ends, <do X>" (docs/after-combat-ends-design.md §2).
   * Runs after the frame has POPPED — the captured frame still reads
   * fine, and a rider that raises a ChoiceFrame would otherwise be eaten
   * by the combat's own pop (the lesson `notifyCombatEnded` taught).
   */
  private applyAfterCombatRiders(cf: CombatFrame): void {
    for (const r of cf.afterCombatEnds) {
      switch (r.kind) {
        case "damage": {
          // "…if the range is close" means the range as combat ENDED,
          // which is what the captured frame holds.
          if (r.closeRangeOnly && cf.range !== "close") break;
          const victim = r.source === cf.acting ? cf.opposing : cf.acting;
          if (!findMinion(this.state, victim)) break;
          // Unpreventable needs no modelling: there is no combat frame
          // left, so there is no prevention window (Daring the Dawn).
          this.applyResolvedDamage({
            minion: victim,
            amount: r.amount,
            source: r.source,
            aggravated: false,
          });
          break;
        }
        case "stun": {
          // "…if the range is close" is the range as combat ENDED, read
          // off the captured frame, exactly as the damage rider does.
          if (r.closeRangeOnly && cf.range !== "close") break;
          this.stun(r.source === cf.acting ? cf.opposing : cf.acting);
          break;
        }
        case "returnStoredBlood": {
          // "Move ALL the blood from this card to the opposing vampire
          // and burn this card" (Morbidity). The card burns either way:
          // the recipient can have been burned during the combat, which
          // is the case the card is written for.
          const found = this.allEntries().find((e) => e.entry.card.id === r.cardId);
          if (!found) break;
          const held = found.entry.counters ?? 0;
          const to = findMinion(this.state, r.to);
          if (held > 0 && to) {
            this.emit({ type: "CountersChanged", cardId: r.cardId, delta: -held });
            this.emit({ type: "BloodGained", minion: to.id, amount: held });
          }
          this.burnPermanent(r.cardId);
          break;
        }
        case "attachSelf": {
          if (!findMinion(this.state, r.minion)) break;
          this.putPermanentInPlay({
            card: { id: r.cardId, name: r.name },
            seat: r.seat,
            attachTo: r.minion,
            statics: {},
            tags: [r.name, "burnForStealth"],
          });
          break;
        }
        case "outcome": {
          this.applyOutcomeRider(cf, r);
          break;
        }
        case "continueAction": {
          // "…continue the action as if unblocked, with +N stealth."
          // Returns to state A, not C: the card grants stealth "even if
          // not yet needed", which is only worth anything while somebody
          // may still block (design §3 — a reading, flagged for review).
          const af = this.action();
          if (!af || af.step !== "blocked") break;
          const m = findMinion(this.state, r.minion);
          if (!m || m.blood < r.bloodCost) break;
          if (r.bloodCost > 0) {
            this.emit({ type: "BloodBurned", minion: r.minion, amount: r.bloodCost });
          }
          af.blockedBy = null;
          af.step = "A";
          cycleRewind(af.cycle);
          if (r.stealth > 0) {
            this.emit({
              type: "StealthModified",
              actionId: af.actionId,
              delta: r.stealth,
              source: "Form of Mist",
            });
          }
          break;
        }
      }
    }
  }

  /**
   * "At the end of that combat, if <who is still standing>, <payoff>"
   * (Abuse of Power, Pillars Fall, Hunting the Beast).
   *
   * Read off the CAPTURED frame, which outlives its place on the stack —
   * the rider runs after the combat's own `pop()`, or a ChoiceFrame it
   * raises would be eaten by that pop (the archetypes lesson). Every
   * survivor question goes through `findMinion`: a combatant burned during
   * the combat is the case these cards exist for, not an edge case.
   * docs/rush-outcome-design.md §2
   */
  private applyOutcomeRider(
    cf: CombatFrame,
    r: Extract<AfterCombatRider, { kind: "outcome" }>,
  ): void {
    const other = r.actor === cf.acting ? cf.opposing : cf.acting;
    const actorReady = (() => {
      const m = findMinion(this.state, r.actor);
      return !!m && isReady(m);
    })();
    const otherM = findMinion(this.state, other);
    const otherReady = !!otherM && isReady(otherM);
    const holds =
      r.when === "oneCombatantReady"
        ? actorReady !== otherReady
        : r.when === "opposingNotReady"
          ? !otherReady
          : // "If the acting vampire is STILL READY" (Yawp Court) — the
            // mirror, and the only condition that fires on a FAILURE.
            r.when === "opposingStillReady"
            ? otherReady
            : actorReady && !otherReady;
    const e = r.effect;
    if (!holds) {
      // A card held back for a possible attachment goes to the ash heap
      // after all when the condition misses (p. 27) — see the `entered`
      // suppression at action resolution.
      if (e.kind === "attachToActor") {
        this.emit({ type: "CardBurned", cardId: r.cardId, name: r.name, seat: r.seat });
      }
      return;
    }
    switch (e.kind) {
      case "selfDamage": {
        // "…takes N ENVIRONMENTAL damage" — `source: null` is what
        // environmental has meant since Daring the Dawn, and the combat
        // is over, so this goes through the shared resolution path
        // rather than a pending-damage queue that no longer exists.
        if (!actorReady) return;
        this.applyResolvedDamage({
          minion: r.actor,
          amount: e.amount,
          source: null,
          aggravated: false,
        });
        return;
      }
      case "burnOpposingControllerPool": {
        // "The controller of the opposing minion" — read off the minion
        // if it is still there, else off the frame, since a burned
        // combatant still had a controller when the combat began.
        const seat = otherM?.controller ?? (other === cf.acting ? cf.actingSeat : cf.opposingSeat);
        if (getSeat(this.state, seat).ousted) return;
        this.emit({ type: "PoolBurned", seat, amount: e.amount });
        return;
      }
      case "attachToActor": {
        // "A vampire can have only one <card>" — the tag carries the name.
        const actor = actorReady ? getMinion(this.state, r.actor) : null;
        if (!actor || actor.attached.some((p) => p.tags.includes(r.name))) {
          this.emit({ type: "CardBurned", cardId: r.cardId, name: r.name, seat: r.seat });
          return;
        }
        // "You CAN put this card on this acting vampire" — a choice, not
        // an auto-take (§4). NOT optional: declining an optional frame
        // pops it without calling applyChoice, and the card would then
        // never be burned (the library-search lesson). "Decline" is an
        // ordinary answer that burns it.
        this.raiseChoice({
          seat: r.seat,
          cardName: r.name,
          cardId: r.cardId,
          key: "attachOutcome",
          params: { minion: r.actor },
          optional: false,
        });
        return;
      }
      case "bloodToUncontrolled": {
        const seat = getSeat(this.state, r.seat);
        const targets = seat.uncontrolled.filter(
          (u) => e.clan === undefined || u.card.clan === e.clan,
        );
        if (targets.length === 0) return;
        if (targets.length === 1) {
          // Exactly one recipient: no question to ask (Brujah Debate).
          this.emit({
            type: "UncontrolledBloodAdded",
            seat: r.seat,
            minion: targets[0]!.card.id,
            amount: e.amount,
          });
          return;
        }
        this.raiseChoice({
          seat: r.seat,
          cardName: r.name,
          cardId: r.cardId,
          key: "bloodToUncontrolled",
          params: { amount: String(e.amount), ...(e.clan ? { clan: e.clan } : {}) },
          optional: false,
        });
        return;
      }
    }
  }

  /** Notify in-play cards that a combat ended (Monster). */
  private notifyCombatEnded(cf: CombatFrame): void {
    const info = {
      acting: cf.acting,
      opposing: cf.opposing,
      rounds: cf.round,
      burnedByStrike: cf.burnedByStrike ?? [],
    };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onCombatEnded?.(entry, owner, info, this);
    }
  }

  /** Notify in-play cards that a block was declared, before the attempt
   *  resolves (Rebel). */
  private notifyBlockDeclared(af: ActionFrame, blocker: MinionId): void {
    const info = {
      actionId: af.actionId,
      blocker,
      acting: af.acting,
      actingSeat: af.actingSeat,
    };
    for (const { entry, owner } of this.allEntries()) {
      this.registry[entry.card.name]?.onBlockDeclared?.(entry, owner, info, this);
    }
  }

  /** Notify in-play cards that a combatant left the ready region (Dead
   *  Pool) — `other` is the surviving combatant, if this combat has one. */
  private notifyCombatLeave(minion: MinionId): void {
    const cf = this.combatFrame();
    if (!cf) return;
    const other = cf.acting === minion ? cf.opposing : cf.opposing === minion ? cf.acting : null;
    if (other === null) return;
    const info = { leaver: minion, other };
    for (const s of this.state.seats) {
      for (const p of [...s.permanents]) {
        this.registry[p.card.name]?.onCombatLeave?.(p, { seat: s.id, minion: null }, info, this);
      }
    }
  }

  private resolveBlockAttempt(ba: BlockAttemptFrame): void {
    const af = this.action();
    if (!af) throw new Error("block attempt without an action");
    this.pop();
    if (ba.cancelled) {
      // WITHDRAWN, not failed. The blocker is not locked (locking follows
      // a successful block, p. 25) and is NOT added to `cannotBlock`:
      // only a Methuselah's decision to make no further attempts is final,
      // and cancelling is not that decision.
      this.emit({ type: "BlockAttemptCancelled", actionId: ba.actionId, blocker: ba.blocker });
      // "The action ends (unsuccessfully)" cancels the attempt AND ends
      // the action (Change of Target). The attempt frame outlives that
      // op, so without this guard it would reset the ended action back to
      // state A and the bleed would resolve after all.
      if (af.step === "blocked") return;
      af.step = "A";
      cycleRewind(af.cycle);
      return;
    }
    if (ba.forceFail) {
      // "Their block attempt fails, and they cannot attempt to block this
      // action again" (Enchanting Gaze). Does not lock the blocker.
      this.emit({ type: "BlockFailed", actionId: ba.actionId, blocker: ba.blocker });
      if (!af.blockRestrictions.cannotBlock.includes(ba.blocker)) {
        af.blockRestrictions.cannotBlock.push(ba.blocker);
      }
      af.step = "A";
      cycleRewind(af.cycle);
      return;
    }
    // The blocker can leave play while the attempt is still open (burned
    // by a card played in the same window). There is then nobody blocking:
    // the attempt fails and the action carries on.
    if (!findMinion(this.state, ba.blocker)) {
      this.emit({ type: "BlockFailed", actionId: ba.actionId, blocker: ba.blocker });
      af.step = "A";
      cycleRewind(af.cycle);
      return;
    }
    if (blockWouldSucceed(this.state, ba.actionId, ba.blocker)) {
      // Two simultaneous consequences (p. 27): lock the blocker, enter
      // combat. The action is blocked; its cost is never paid.
      this.emit({ type: "BlockSucceeded", actionId: ba.actionId, blocker: ba.blocker });
      // "If the attached minion is BLOCKED, they burn 1 blood or life
      // BEFORE block resolution" (Phantasmagoria superior) — ahead of the
      // two consequences p. 25 names, which is exactly where the card
      // puts it (docs/action-attachments-design.md §6).
      const actor = findMinion(this.state, af.acting);
      if (actor) {
        for (const p of actor.attached) {
          const toll = p.statics.blockedToll;
          if (!toll) continue;
          // "1 blood" excludes an ally, who has none; "1 blood or life"
          // lets them pay out of life (p. 22, the block-tax distinction).
          if (actor.kind === "ally" && toll.payWith !== "bloodOrLife") continue;
          const pay = Math.min(actor.blood, toll.amount);
          if (pay > 0) this.emit({ type: "BloodBurned", minion: actor.id, amount: pay });
        }
        // The mirror: "the BLOCKING MINION'S CONTROLLER burns 1 pool before
        // block resolution" (Terrifying Visage). Same moment, other side of
        // the block, and paid in pool — hence its own static rather than a
        // payer flag on the one above (docs/path-cards-design.md §3).
        const blockerMinion = findMinion(this.state, ba.blocker);
        if (blockerMinion) {
          for (const p of actor.attached) {
            const toll = p.statics.blockedPoolToll;
            if (!toll) continue;
            // A penalty, not a price: a Methuselah with less pool than the
            // toll pays what they have rather than being barred.
            const owed = Math.min(
              getSeat(this.state, blockerMinion.controller).pool,
              toll.amount,
            );
            if (owed > 0) {
              this.emit({ type: "PoolBurned", seat: blockerMinion.controller, amount: owed });
            }
          }
        }
      }
      this.emit({ type: "MinionLocked", minion: ba.blocker });
      af.blockedBy = ba.blocker;
      af.step = "blocked";
      // "If this vampire blocks, put this card on the acting minion; you
      // still control it" (Melange) — a seat-level permanent of the blocker,
      // tagged with the actor it sits on.
      for (const a of af.attachOnBlock) {
        if (a.blocker !== ba.blocker) continue;
        this.emit({
          type: "PermanentEnteredPlay",
          seat: a.seat,
          cardId: a.cardId,
          name: a.cardName,
          attachedTo: null,
          statics: {},
          tags: [a.cardName, `melangeOn:${af.acting}`],
        });
      }
      if (af.actionKind === "leaveTorpor") {
        // A blocked leave-torpor causes no combat — torpor vampires
        // cannot fight (p. 24). If the blocker is a vampire, its
        // controller may diablerise the acting torpor vampire; either way
        // the action then fails (settle resolves af.step "blocked").
        // A blocker that has left play offers no diablerie — and reading
        // it with `getMinion` would throw out of settle (p. 24 only gives
        // the opportunity to a blocking VAMPIRE, which a gone one is not).
        // A blocker that has left play offers no diablerie. Defence in
        // depth rather than a fixed live bug: `resolveBlockAttempt`
        // already fails an attempt whose blocker is gone, so the success
        // path below is not reached today — but p. 24 gives the
        // opportunity to a blocking VAMPIRE, and a gone one is not that.
        const blocker = findMinion(this.state, ba.blocker);
        if (blocker?.kind === "vampire") {
          this.state.frames.push({
            kind: "diablerieOffer",
            diablerist: ba.blocker,
            victim: af.acting,
            offerSeat: ba.blockerSeat,
          });
        }
        return;
      }
      this.pushCombat(af.acting, af.actingSeat, ba.blocker, ba.blockerSeat, null, true);
      // "If this vampire blocks, it gets N maneuvers/presses" (Spirit's
      // Touch) — the blocker is the opposing side of this combat.
      const rider = af.blockerCombatRiders[ba.blocker];
      if (rider) {
        const cf = this.combatFrame();
        if (cf) {
          cf.maneuverCredits.opposing += rider.maneuver;
          cf.pressesCombat.opposing += rider.press;
          // "If they block, neither combatant strikes the first round."
          if (rider.noStrikeFirstRound) cf.suppressStrikesRound = cf.round;
          // "Strike cards cost the acting minion +1 blood or life during
          // the resulting combat" (Ensnare a Beast superior).
          if (rider.playCostMod) cf.playCostMods.push(rider.playCostMod);
          // The blocker-side riders this cluster added
          // (docs/blocker-riders-design.md §2).
          if (rider.prevent) cf.preventCreditsFirstRound.opposing += rider.prevent;
          if (rider.noEquipment) cf.restrict.opposing.equipment = true;
          if (rider.unlockForBlood) cf.unlockForBlood.opposing = rider.unlockForBlood;
          if (rider.combatEndsStrike) cf.grantedCombatEnds.opposing = true;
        }
      }
      // The mirror, for the acting minion: "if this vampire is blocked,
      // they can prevent 1 damage during the resulting combat" (Beast
      // Meld), "+1 strength this action" (Invigorate).
      const own = af.actorCombatRider;
      const cf = this.combatFrame();
      if (cf) {
        cf.preventCredits.acting += own.prevent;
        cf.strengthBonus.acting += own.strength;
        cf.maneuverCredits.acting += own.maneuver;
        cf.pressesCombat.acting += own.press;
        if (own.handStrikesAggravated) cf.handStrikesAggravated.acting = true;
        // "…and cannot use equipment during the resulting combat" (Form of
        // the Bat's modifier mode) — the actor restricting ITSELF, where
        // `restrictOpponent` restricts the other side.
        if (own.noEquipment) cf.restrict.acting.equipment = true;
        // Symmetric, and combat-long: "all damage inflicted on vampires
        // during the resulting combat is aggravated" (Dawn Operation).
        if (own.combatAggravated) cf.allDamageAggravated = true;
      }
    } else {
      // A failed attempt does not lock the blocker; back to state A; the
      // same Methuselah may attempt again (p. 25, p. 27 B.4).
      this.emit({ type: "BlockFailed", actionId: ba.actionId, blocker: ba.blocker });
      af.step = "A";
      cycleRewind(af.cycle);
    }
  }

  /** Begin a combat: from a successful block (p. 27) or a successful
   *  rush (rush design §2.3). Rider credits apply only to a rush's own
   *  combat — a blocked rush fights the blocker without them (p. 27). */
  private pushCombat(
    acting: MinionId,
    actingSeat: SeatId,
    opposing: MinionId,
    opposingSeat: SeatId,
    riders: RushRiders | null,
    fromBlock: boolean,
    /** "At the end of that combat, …" — installed only on a rush's OWN
     *  combat (docs/rush-outcome-design.md §2). */
    outcome: AfterCombatRider | null = null,
  ): void {
    this.emit({ type: "CombatBegan", acting, opposing });
    // "1 optional press each combat" statics (Dread Mastiff superior):
    // granted once, persisting across rounds until spent.
    const combatPresses = (minionId: MinionId): number => {
      let n = 0;
      for (const p of getMinion(this.state, minionId).attached) {
        n += p.statics.pressPerCombat ?? 0;
      }
      return n;
    };
    // The restricted sibling: "1 optional press, only usable to CONTINUE
    // combat, each combat" (Righteous Blade, weapon-riders §4).
    const continuePresses = (minionId: MinionId): number => {
      let n = 0;
      for (const p of getMinion(this.state, minionId).attached) {
        n += p.statics.continuePressPerCombat ?? 0;
      }
      return n;
    };
    // The maneuver sibling: "the attached minion gets 1 optional maneuver
    // each combat" (Biothaumaturgic Experiment superior).
    const combatManeuvers = (minionId: MinionId): number => {
      let n = 0;
      for (const p of getMinion(this.state, minionId).attached) {
        n += p.statics.maneuverPerCombat ?? 0;
      }
      return n;
    };
    this.state.frames.push({
      kind: "combat",
      acting,
      actingSeat,
      opposing,
      opposingSeat,
      fromBlock,
      round: 1,
      step: "beforeRange",
      range: "close",
      awaiting: "acting",
      declines: 0,
      strikes: { acting: null, opposing: null },
      strikeRound: "normal",
      additionalStrikes: { acting: 0, opposing: 0 },
      forcedAdditionalStrike: { acting: null, opposing: null },
      usedLimitedAddl: { acting: false, opposing: false },
      strengthOverride: { acting: null, opposing: null },
      // "+N strength during that combat" (Make the Misere) lands in the
      // combat-long slot that already owns it.
      strengthBonus: { acting: riders?.strength ?? 0, opposing: 0 },
      strengthBonusRound: { acting: 0, opposing: 0 },
      handStrikesAggravated: { acting: false, opposing: false },
      weaponDamageNullified: { acting: false, opposing: false },
      playCostMods: [],
      afterCombatEnds: outcome ? [outcome] : [],
      preventAllFrom: { acting: false, opposing: false },
      suppressStrikesRound: null,
      presses: { acting: 0, opposing: 0 },
      pressesCombat: {
        acting: combatPresses(acting) + (riders?.press ?? 0),
        opposing: combatPresses(opposing),
      },
      pressesContinueOnly: {
        acting: continuePresses(acting),
        opposing: continuePresses(opposing),
      },
      // Aura credits ("Brujah get … 1 optional maneuver each combat").
      maneuverCredits: {
        acting:
          (riders?.maneuver ?? 0) +
          auraBonus(this.state, getMinion(this.state, acting), "maneuverPerCombat") +
          combatManeuvers(acting),
        opposing:
          auraBonus(this.state, getMinion(this.state, opposing), "maneuverPerCombat") +
          combatManeuvers(opposing),
      },
      closeManeuvers: { acting: 0, opposing: 0 },
      preventCreditsFirstRound: { acting: 0, opposing: 0 },
      unlockForBlood: { acting: 0, opposing: 0 },
      grantedCombatEnds: { acting: false, opposing: false },
      // "The OPPOSING minion cannot strike: combat ends during the first
      // round" — the rider is the actor's, so the bar is on the other side.
      noCombatEndsFirstRound: {
        acting: false,
        opposing: riders?.noCombatEndsFirstRound ?? false,
      },
      preventCredits: { acting: 0, opposing: 0 },
      preventPerRound: { acting: 0, opposing: 0 },
      preventPerRoundUsed: { acting: 0, opposing: 0 },
      roundDamage: [],
      autoPreventAfterFirst: { acting: null, opposing: null },
      damageTakenThisRound: { acting: 0, opposing: 0 },
      frenzyImmune: { acting: false, opposing: false },
      frenzyRestrict: { acting: false, opposing: false },
      usedThisRound: [],
      usedThisCombat: [],
      playedThisRound: [],
      playedThisCombat: [],
      committedStrike: { acting: null, opposing: null },
      usedWeaponManeuver: { acting: null, opposing: null },
      restrict: {
        acting: { maneuver: false, press: false, equipment: false },
        opposing: { maneuver: false, press: false, equipment: false },
      },
      pendingDamage: [],
      willContinue: false,
      endedPrematurely: false,
      cycle: newCycle(sequencingOrder(this.state, actingSeat, [opposingSeat])),
    });
  }

  /** Does `side` strike this sub-round? Both minions in the normal pair;
   *  in an additional sub-round, only those with additional strikes. */
  private strikeParticipant(cf: CombatFrame, side: "acting" | "opposing"): boolean {
    return cf.strikeRound === "normal" || cf.additionalStrikes[side] > 0;
  }

  /** The next side to choose a strike this sub-round (acting first), or
   *  null when every participant has chosen. */
  private nextStriker(cf: CombatFrame): "acting" | "opposing" | null {
    if (this.strikeParticipant(cf, "acting") && cf.strikes.acting === null) return "acting";
    if (this.strikeParticipant(cf, "opposing") && cf.strikes.opposing === null) return "opposing";
    return null;
  }

  private allStrikersChosen(cf: CombatFrame): boolean {
    return this.nextStriker(cf) === null;
  }

  private resolveStrikes(cf: CombatFrame): void {
    // In an additional sub-round only the minions with additional strikes
    // strike (p. 32) — a non-striker's `strikes[side]` stays null.
    const sa = cf.strikes.acting;
    const so = cf.strikes.opposing;
    if (cf.strikeRound === "normal" && (!sa || !so)) {
      throw new Error("strikes not both chosen");
    }

    // "Combat ends" strikes resolve first of all — before first strike
    // and before any damage (p. 33); End of Round still runs (p. 32).
    if (sa?.combatEnds || so?.combatEnds) {
      if (sa?.combatEnds && sa.unlockSelf) {
        this.emit({ type: "MinionUnlocked", minion: cf.acting });
      }
      if (so?.combatEnds && so.unlockSelf) {
        this.emit({ type: "MinionUnlocked", minion: cf.opposing });
      }
      cf.endedPrematurely = true;
      cf.step = "endOfRound";
      cf.cycle = newCycle(cf.cycle.order);
      return;
    }

    // Hand-based strikes hit for effective strength ("this combat"
    // override or printed strength) plus any card bonus, at close range
    // only; weapon strikes hit for fixed damage, at any range when
    // ranged (p. 30, p. 33). Resolution is simultaneous (p. 30);
    // prevention and mending run acting-minion-first (p. 29).
    const strengthOf = (side: "acting" | "opposing"): number => {
      const minion = getMinion(this.state, side === "acting" ? cf.acting : cf.opposing);
      // Persistent +strength statics (Preternatural Strength) fold into the
      // printed base; a "strength of N this combat" override replaces it.
      let base = minion.strength;
      for (const p of minion.attached) base += p.statics.strength ?? 0;
      // Cards in play that radiate strength onto a clan (Gangrel Revel).
      base += auraBonus(this.state, minion, "strength");
      // "While you have the Edge, Anxo gets +1 strength" — a crypt card's
      // conditional static. Read with NO action: a combat can outlive the
      // action that started it (a rush pushes it after the frame pops),
      // so only board conditions are meaningful here.
      base += conditionalStaticNoAction(this.state, minion, "strength");
      // "Brujah get +1 strength in combat with him" (Kevin Jackson) — a
      // bonus granted by the OTHER combatant, read off the live frame.
      base += opposingGrantedStrength(this.state, minion);
      return (
        (cf.strengthOverride[side] ?? base) +
        cf.strengthBonus[side] +
        cf.strengthBonusRound[side]
      );
    };
    const inflict = (from: "acting" | "opposing", strike: Strike | null): void => {
      if (!strike) return;
      // A dodge deals no damage; a minion whose own strike is a dodge is
      // protected from the opposing strike's effects (p. 33).
      if (strike.dodge) return;
      const victimStrike = from === "acting" ? cf.strikes.opposing : cf.strikes.acting;
      const victim = from === "acting" ? cf.opposing : cf.acting;
      const source = from === "acting" ? cf.acting : cf.opposing;
      // "Steal blood" strikes move blood before damage (p. 33) — not
      // damage, so not dodged or prevented; ranged.
      if (strike.stealBlood > 0) {
        if (cf.range === "long" && !strike.ranged) return;
        const v = getMinion(this.state, victim);
        const taken = Math.min(v.blood, strike.stealBlood);
        if (taken > 0) {
          this.emit({ type: "BloodBurned", minion: victim, amount: taken });
          this.emit({ type: "BloodGained", minion: source, amount: taken });
        }
        return;
      }
      // A dodge "cancels the effects of the opposing strike on this
      // minion" (p. 33) — damage and these non-damage strike effects
      // alike, UNLESS the strike says otherwise (Dust Up: "this strike
      // cannot be dodged", docs/last-combat-design.md §1) or the STRIKER
      // does ("strikes made by this ally cannot be dodged", Aggressive
      // Corpse). The second is read off the striker here rather than
      // stamped onto each Strike: hand, weapon and granted strikes are
      // built at five sites, and a flag every site must remember is one a
      // sixth will forget (docs/library-audit.md §2).
      const strikerUndodgeable = findMinion(this.state, source)?.attached.some(
        (p) => p.statics.strikesUndodgeable,
      );
      if (victimStrike?.dodge && !strike.undodgeable && !strikerUndodgeable) return;
      // "Strike: put this card on the opposing minion with N counters"
      // (Touch of Oblivion) — close range only, and not damage, so
      // prevention has nothing to bite on.
      if (strike.attachToVictim) {
        if (cf.range !== "close") return;
        const a = strike.attachToVictim;
        this.putPermanentInPlay({
          card: { id: a.cardId, name: a.name },
          seat: getMinion(this.state, victim).controller,
          attachTo: victim,
          statics: a.statics ?? {},
          tags: [a.name, ...(a.tags ?? [])],
          ...(a.counters !== undefined ? { counters: a.counters } : {}),
          ...(a.counterSink !== undefined ? { counterSink: a.counterSink } : {}),
          // p. 16: the card answers to the Methuselah who played it, not
          // to the minion it sits on.
          controller: a.controller,
        });
        // "Strike: hand strike at +1 damage AND put this card on the
        // opposing minion" (Sculpt the Flesh superior) — the attach is a
        // RIDER on a damaging strike, where Touch of Oblivion's attach is
        // the whole strike. Only the latter stops here.
        if (!strike.handBonus && strike.damage === null) return;
      }
      // "Strike: burn equipment" (Heroic Might) — a strike that destroys
      // rather than damages. The card was chosen at strike time and rides
      // in the option id; it may have left play in between (a strike that
      // burned its bearer), so this is a total read.
      if (strike.burnEquipment) {
        const v = findMinion(this.state, victim);
        const eq = v?.attached.find((p) => p.card.id === strike.burnEquipment);
        if (eq) {
          this.emit({ type: "PermanentBurned", cardId: eq.card.id, name: eq.card.name });
        }
        return;
      }
      // "Strike: send the opposing vampire to torpor or burn the opposing
      // ally" (Touch of Oblivion superior).
      if (strike.incapacitate) {
        if (cf.range !== "close") return;
        const v = getMinion(this.state, victim);
        if (v.kind === "ally") {
          this.burnMinion(victim);
        } else if (!v.inTorpor) {
          this.notifyLeaveReady(victim, "torpor");
          this.emit({ type: "WentToTorpor", minion: victim });
        }
        this.notifyCombatLeave(victim);
        return;
      }
      // "The opposing vampire's strikes with weapons inflict no damage
      // this round" (Blood Fury, Blood Rage, Soul Burn). Keyed on the
      // STRIKING side, and only a real weapon: a card-granted
      // fixed-damage strike is not one. The strike still happens — it
      // just inflicts nothing. docs/discipline-filtered-design.md §4
      if (strike.source === "weapon" && cf.weaponDamageNullified[from]) return;
      let amount: number;
      // A hand strike is aggravated if the strike itself is, or if "this
      // vampire's hand strikes are aggravated this round" (Claws of the
      // Dead) — the latter only affects hand strikes, not weapon strikes.
      let aggravated = strike.aggravated;
      if (strike.damage !== null) {
        if (cf.range === "long" && !strike.ranged) return;
        amount = strike.damage;
      } else {
        if (cf.range !== "close") return;
        amount = strengthOf(from) + strike.handBonus;
        if (cf.handStrikesAggravated[from]) aggravated = true;
      }
      if (amount <= 0) return;
      this.pushPendingDamage(cf, {
        minion: victim,
        amount,
        source,
        aggravated,
        ...(strike.noPreventBy?.length ? { noPreventBy: strike.noPreventBy } : {}),
        ...(this.isGunStrike(strike) ? { fromGun: true } : {}),
      });
      // "For each damage inflicted by this strike (even if prevented),
      // burn 1 counter from this card" (Weighted Walking Stick) — spent
      // here, at infliction, so prevention never gets the counters back.
      if (strike.depletesCard) {
        const entry = this.findEntry(strike.depletesCard);
        if (entry) {
          this.addCounters(strike.depletesCard, -Math.min(amount, entry.counters ?? 0));
          if ((entry.counters ?? 0) <= 0) this.burnPermanent(strike.depletesCard);
        }
      }
    };
    inflict("opposing", so);
    inflict("acting", sa);
    // An additional sub-round consumes one additional strike from each
    // minion that struck (p. 32).
    if (cf.strikeRound === "additional") {
      if (sa) cf.additionalStrikes.acting = Math.max(0, cf.additionalStrikes.acting - 1);
      if (so) cf.additionalStrikes.opposing = Math.max(0, cf.additionalStrikes.opposing - 1);
      // A forced strike belongs to the additional strike it came with, so
      // it is spent alongside it: a second extra strike from another
      // source is a free choice again (Wind Dance superior).
      if (sa && cf.additionalStrikes.acting === 0) cf.forcedAdditionalStrike.acting = null;
      if (so && cf.additionalStrikes.opposing === 0) cf.forcedAdditionalStrike.opposing = null;
    }
    // Retainer combat output ("inflicts N damage on the opposing minion
    // each round during normal strike resolution") — environmental
    // damage, source null, cannot be dodged (p. 31). Non-ranged versions
    // apply at close range only.
    const retainerDamage = (side: "acting" | "opposing"): void => {
      // A strike can remove a combatant before this runs (Touch of
      // Oblivion superior burns an ally outright), and a minion that has
      // left play contributes nothing.
      const bearer = findMinion(this.state, side === "acting" ? cf.acting : cf.opposing);
      if (!bearer) return;
      const victim = side === "acting" ? cf.opposing : cf.acting;
      if (!findMinion(this.state, victim)) return;
      for (const p of bearer.attached) {
        const crd = p.statics.combatRoundDamage;
        if (!crd) continue;
        if (cf.range === "long" && !crd.ranged) continue;
        this.pushPendingDamage(cf, {
          minion: victim,
          amount: crd.amount,
          source: null,
          aggravated: false,
        });
      }
    };
    // Retainer output is "each round … during normal strike resolution"
    // (p. 31) — once per round, not in additional sub-rounds.
    if (cf.strikeRound === "normal") {
      retainerDamage("acting");
      retainerDamage("opposing");
      // "…takes 1R environmental damage each round during normal strike
      // resolution" (Carrion Crows) — the same sentence, from a combat
      // card rather than a retainer, so the same moment.
      for (const r of cf.roundDamage) {
        if (r.when === "strikeResolution") this.inflictRoundDamage(cf, r);
      }
    }
    // Acting minion's damage is handled first (p. 29); for a given
    // victim, normal damage resolves before aggravated (p. 34).
    cf.pendingDamage.sort((a, b) => {
      if (a.minion !== b.minion) {
        return a.minion === cf.acting ? -1 : b.minion === cf.acting ? 1 : 0;
      }
      return Number(a.aggravated) - Number(b.aggravated);
    });
    cf.step = "damageResolution";
  }

  // -- combat-card operations (EngineOps) -----------------------------------

  chooseCardStrike(play: CardPlayFrame, strike: CardStrikeParams): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    // "…OR USE A MELEE WEAPON STRIKE, at +N damage" (Anticipation): the
    // weapon's own strike, with the card's bonus added on top. It is a
    // WEAPON strike for every later question — `weaponDamageNullified`
    // and Kevlar Vest both ask (docs/last-combat-design.md §4).
    if (strike.useWeapon && play.minion) {
      const entry = this.findEntry(strike.useWeapon);
      const bearer = findMinion(this.state, play.minion);
      if (entry && bearer?.attached.some((p) => p.card.id === strike.useWeapon)) {
        cf.strikes[side] = {
          source: "weapon",
          name: entry.card.name,
          handBonus: strike.handBonus ?? 0,
          damage: null,
          ranged: false,
          combatEnds: false,
          unlockSelf: false,
          dodge: false,
          aggravated: strike.aggravated ?? false,
          stealBlood: 0,
          ...(strike.undodgeable ? { undodgeable: true } : {}),
        };
        this.emit({
          type: "StrikeChosen",
          minion: play.minion,
          strike: `${entry.card.name} (+${strike.handBonus ?? 0})`,
        });
        return;
      }
    }
    cf.strikes[side] = {
      source: "card",
      name: play.card.name,
      handBonus: strike.handBonus ?? 0,
      damage: strike.damage ?? null,
      ranged: strike.ranged ?? false,
      combatEnds: strike.combatEnds ?? false,
      unlockSelf: strike.unlockSelf ?? false,
      dodge: strike.dodge ?? false,
      aggravated: strike.aggravated ?? false,
      stealBlood: strike.stealBlood ?? 0,
      ...(strike.undodgeable ? { undodgeable: true } : {}),
      ...(strike.attachToVictim
        ? {
            attachToVictim: {
              cardId: play.card.id,
              name: play.card.name,
              controller: play.seat,
              ...(strike.attachToVictim.counters !== undefined
                ? { counters: strike.attachToVictim.counters }
                : {}),
              ...(strike.attachToVictim.counterSink !== undefined
                ? { counterSink: strike.attachToVictim.counterSink }
                : {}),
              ...(strike.attachToVictim.statics !== undefined
                ? { statics: strike.attachToVictim.statics }
                : {}),
              ...(strike.attachToVictim.bearerUnlockBurn !== undefined
                ? { bearerUnlockBurn: strike.attachToVictim.bearerUnlockBurn }
                : {}),
              ...(strike.attachToVictim.tags !== undefined
                ? { tags: strike.attachToVictim.tags }
                : {}),
            },
          }
        : {}),
      ...(strike.incapacitate ? { incapacitate: true } : {}),
      ...(strike.noPreventBy?.length ? { noPreventBy: strike.noPreventBy } : {}),
    };
    this.emit({
      type: "StrikeChosen",
      minion: side === "acting" ? cf.acting : cf.opposing,
      strike: play.card.name,
    });
  }

  /** Grant additional strikes for this round (Blur etc.); a "(limited)"
   *  source consumes the one-per-round allowance (p. 32). */
  grantAdditionalStrike(play: CardPlayFrame, count: number, limited: boolean): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.additionalStrikes[side] += count;
    if (limited) cf.usedLimitedAddl[side] = true;
  }

  /** "…: burn weapon" — a SPECIFIED strike offered in `chooseStrike`,
   *  the `grantedCombatEnds` shape. docs/cheap-tail-design.md §4 */
  grantBurnEquipmentStrike(play: CardPlayFrame): void {
    this.grantStrikeTo(this.sideOf(this.requireCombat(), play.minion), { kind: "burnEquipment" });
  }

  /** "1 additional strike: dodge" (Wind Dance superior) — the additional
   *  sub-round's strike is FORCED. Where `grantStrikeTo` adds an option,
   *  this removes the others (docs/ledger-closeout.md §3). */
  forceAdditionalStrike(play: CardPlayFrame, kind: StrikeKind): void {
    const cf = this.requireCombat();
    cf.forcedAdditionalStrike[this.sideOf(cf, play.minion)] = kind;
  }

  /** "This vampire gains blood equal to the amount of blood LOST by the
   *  opposing vampire to damage this round" (Taste of Vitae) — blood
   *  lost, which is not damage taken (docs/last-combat-design.md §2). */
  gainOpposingBloodLost(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    const other = side === "acting" ? "opposing" : "acting";
    const gained = cf.bloodLostThisRound?.[other] ?? 0;
    if (gained > 0 && play.minion) {
      this.emit({ type: "BloodGained", minion: play.minion, amount: gained });
    }
  }

  /** Is this strike a GUN's? A weapon strike whose card carries the
   *  `gun` tag — the same pair `weaponDamageNullified` reads. Kevlar
   *  Vest is the only card that asks. docs/last-combat-design.md §5 */
  private isGunStrike(strike: Strike): boolean {
    if (strike.source !== "weapon" || !strike.name) return false;
    for (const s of this.state.seats) {
      for (const m of s.minions) {
        for (const p of m.attached) {
          if (p.card.name === strike.name) return p.tags.includes("gun");
        }
      }
    }
    return false;
  }

  /** A specified strike granted to one side, spent when taken
   *  (docs/weapon-riders-design.md §1). */
  grantStrikeTo(side: "acting" | "opposing", grant: GrantedStrike): void {
    const cf = this.requireCombat();
    cf.grantedStrikes ??= { acting: [], opposing: [] };
    cf.grantedStrikes[side].push(grant);
  }

  /** The minion-addressed form, for a card in play whose bearer is a
   *  combatant (Treasured Samadji). */
  grantStrikeToMinion(minion: MinionId, grant: GrantedStrike): void {
    this.grantStrikeTo(this.sideOf(this.requireCombat(), minion), grant);
  }

  /** "…their initial strike that round must be with this weapon"
   *  (Sniper Rifle) — the .44 ruling's commitment, from a card in play. */
  commitStrikeTo(minion: MinionId, cardId: CardInstanceId): void {
    const cf = this.requireCombat();
    cf.committedStrike[this.sideOf(cf, minion)] = cardId;
  }

  setCombatRange(range: "close" | "long"): void {
    this.requireCombat().range = range;
  }

  /** "Once each combat" for an ability that is not a prevention (Sword of
   *  the Archangel's cancel) — the same latch `preventDamageAbility`
   *  writes with `scope: "combat"`. */
  markUsedThisCombat(cardId: CardInstanceId): void {
    const cf = this.requireCombat();
    if (!cf.usedThisCombat.includes(cardId)) cf.usedThisCombat.push(cardId);
  }

  /** The minion-addressed form of `grantAdditionalStrike`, for a card in
   *  play (which has no `CardPlayFrame`). */
  grantAdditionalStrikeTo(minion: MinionId, count: number, limited: boolean): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, minion);
    cf.additionalStrikes[side] += count;
    if (limited) cf.usedLimitedAddl[side] = true;
  }

  /** "Only usable if combat WOULD END. Instead, start a new round"
   *  (Hunting the Quarry superior, Telepathic Tracking superior) — the
   *  ending is replaced, so nothing that would have happened at the end
   *  has happened yet and nothing needs undoing.
   *  docs/round-end-design.md §1 */
  startNewRound(): void {
    this.requireCombat().willContinue = true;
  }

  /** "Strikes that are not hand strikes cannot be used this round (BY
   *  EITHER COMBATANT)" (Immortal Grapple). */
  restrictToHandStrikes(): void {
    this.requireCombat().handStrikesOnly = true;
  }

  /** "If another round of combat occurs, that round is at close range
   *  (skip the determine range step)" (Immortal Grapple superior). */
  skipNextRangeStep(): void {
    this.requireCombat().skipRangeNextRound = true;
  }

  /** "If any damage from this strike is successfully inflicted, they take
   *  +N damage from this strike" (Target Vitals). */
  addAimBonus(play: CardPlayFrame, amount: number): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.aimBonus ??= { acting: 0, opposing: 0 };
    cf.aimBonus[side] += amount;
    if (play.minion) (cf.aimsThisStrike ??= []).push(play.minion);
    // "…and they cannot press this round" — the restriction already
    // exists (Terror Frenzy sets it) and is round-scoped.
    cf.restrict[side === "acting" ? "opposing" : "acting"].press = true;
  }

  grantContinueOnlyPress(minion: MinionId, count: number): void {
    const cf = this.requireCombat();
    cf.pressesContinueOnly ??= { acting: 0, opposing: 0 };
    cf.pressesContinueOnly[this.sideOf(cf, minion)] += count;
  }

  applyManeuver(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.range = cf.range === "close" ? "long" : "close";
    // The opponent may now offset; no two maneuvers in a row (p. 29).
    cf.awaiting = side === "acting" ? "opposing" : "acting";
    cf.declines = 0;
    this.emit({ type: "RangeSet", range: cf.range });
  }

  applyPressCard(play: CardPlayFrame, toContinue: boolean): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.willContinue = toContinue;
    cf.awaiting = side === "acting" ? "opposing" : "acting";
    cf.declines = 0;
    this.emit({
      type: "PressUsed",
      seat: side === "acting" ? cf.actingSeat : cf.opposingSeat,
      toContinue,
    });
  }

  /** "If that minion does not block the action, burn N POOL after action
   *  resolution" (WMRH Talk Radio) — the seat-charged variant of the
   *  penalty below. docs/action-time-locations-design.md §3 */
  registerNotBlockPoolPenalty(minion: MinionId, amount: number, seat: SeatId): void {
    const af = this.action();
    if (!af) throw new Error("registerNotBlockPoolPenalty outside an action");
    af.notBlockPenalties.push({ minion, amount, seat });
  }

  /** "After action resolution, if that action was successful, unlock the
   *  acting minion" (Warsaw Station). */
  registerUnlockOnSuccess(minion: MinionId): void {
    const af = this.action();
    if (!af) throw new Error("registerUnlockOnSuccess outside an action");
    af.unlockOnSuccess.push(minion);
  }

  registerNotBlockPenalty(play: CardPlayFrame, amount: number): void {
    const af = this.action();
    if (!af) throw new Error("not-block penalty outside an action");
    if (!play.minion) throw new Error("not-block penalty without a minion");
    af.notBlockPenalties.push({ minion: play.minion, amount });
  }

  announceEntryAction(
    entry: PermanentInPlay,
    minionId: MinionId,
    args: {
      effect?: { key: string; params?: Record<string, string> };
      targetMinion?: MinionId | null;
      targetPermanent?: CardInstanceId | null;
      stealth?: number;
      cost?: { pool?: number; blood?: number };
      riders?: { maneuver?: number; press?: number };
      /** Defaults to `cardEffect`, which every granted action was before
       *  Codex of the Edenic Groundskeepers wanted a granted BLEED. */
      actionKind?: ActionKind;
      /** "…as a +1 stealth POLITICAL action" (Anarch Revolt, War of Ages):
       *  one per vampire per turn (p. 24), and undirected — which is why
       *  such a grant passes no `targetPermanent` even though it is aimed
       *  at a card in play. docs/pool-drain-design.md §6 */
      political?: boolean;
      /** The card whose referendum a successful political action calls. */
      referendumSource?: { cardName: string; cardInstanceId: CardInstanceId };
    },
  ): void {
    const m = getMinion(this.state, minionId);
    const seat = m.controller;
    const actionId = this.freshId("action-");
    // Taking an action locks the acting minion (p. 19); the per-minion
    // per-copy use is recorded at announcement — it holds even if the
    // action is blocked (p. 20; there is no cancel window for
    // entry-granted actions, only for cards).
    this.emit({ type: "MinionLocked", minion: m.id });
    const key = args.effect?.key ?? "enterCombat";
    (entry.grantedActionUses ??= []).push({ minion: m.id, key });

    // Directedness derives from what the action targets — the controller
    // of the target minion, or of the target card in play; an action with
    // neither is undirected (p. 25).
    let target: SeatId | null = null;
    let directed = false;
    // "This vampire can BLEED as a Ⓓ action" (Codex of the Edenic
    // Groundskeepers). A granted action was always `cardEffect`; a granted
    // bleed follows all bleed rules (p. 23) exactly as an enhanced bleed
    // from a card does — one per minion per turn, prey as the default
    // target, directed. docs/granted-bleed-design.md
    const actionKind = args.actionKind ?? "cardEffect";
    if (actionKind === "bleed") {
      m.bledThisTurn = true;
      target = preyOf(this.state, seat);
      directed = true;
    }
    // One political action per vampire per turn (p. 24), recorded at
    // announcement like `bledThisTurn`.
    if (args.political) m.calledPoliticalThisTurn = true;
    const targetMinion = args.targetMinion ?? null;
    const targetPermanent = args.targetPermanent ?? null;
    const targetController =
      targetMinion !== null
        ? getMinion(this.state, targetMinion).controller
        : targetPermanent !== null
          ? this.controllerOfEntry(targetPermanent)
          : null;
    if (targetController !== null && targetController !== seat) {
      target = targetController;
      directed = true;
    }
    this.emit({
      type: "ActionAnnounced",
      actionId,
      actionKind,
      acting: m.id,
      seat,
      target,
      directed,
      ...(targetMinion !== null ? { targetMinion } : {}),
    });
    const frame: ActionFrame = {
      kind: "action",
      actionId,
      actionKind,
      card: null,
      acting: m.id,
      actingSeat: seat,
      target,
      directed,
      targetMinion,
      targetPermanent,
      ...(args.referendumSource ? { referendumSource: args.referendumSource } : {}),
      rushRiders: {
        maneuver: args.riders?.maneuver ?? 0,
        press: args.riders?.press ?? 0,
      },
      combatOutcome: null,
      grantedCost: args.cost ? { ...args.cost } : null,
      grantedEffect: args.effect
        ? {
            cardId: entry.card.id,
            cardName: entry.card.name,
            key: args.effect.key,
            params: args.effect.params ?? {},
          }
        : null,
      rescueSplit: null,
      step: "announce",
      declinedBlocks: [],
      played: [],
      blockedBy: null,
      notBlockPenalties: [],
      unlockOnSuccess: [],
      drawAfter: [],
      playCostMods: [],
      delayReplaceTypes: [],
      noReactionsFrom: [],
      blockerCombatRiders: {},
      actorCombatRider: {
        prevent: 0,
        strength: 0,
        maneuver: 0,
        press: 0,
        handStrikesAggravated: false,
        combatAggravated: false,
      },
      blockPenalties: [],
      interceptBurnGrants: [],
      attachOnBlock: [],
      usedInPlayAbilities: [],
      corruptionUnlocks: [],
      blockCosts: [],
      noUnlock: false,
      afterResolutionDamage: [],
      queuedCombats: [],
      blockRestrictions: { noAllies: false, noVampires: false, noTitled: false, cannotBlock: [] },
      cycle: newCycle([seat]),
    };
    frame.cycle = newCycle(
      sequencingOrder(this.state, seat, defendersFor(this.state, frame)),
    );
    this.state.frames.push(frame);
    this.notifyActionAnnounced(frame);
    // "as a +N stealth action" — the granted action's own stealth, folded
    // in like any other inherent stealth (p. 19).
    if (args.stealth) {
      this.emit({
        type: "StealthModified",
        actionId,
        delta: args.stealth,
        source: entry.card.name,
      });
    }
  }

  preventDamageAbility(
    minionId: MinionId,
    cardId: string,
    amount: number,
    scope: "round" | "combat" = "round",
  ): void {
    const cf = this.requireCombat();
    const pd = cf.pendingDamage[0];
    if (!pd) throw new Error("no damage to prevent");
    if (pd.minion !== minionId) {
      throw new Error("only the minion taking damage may prevent it");
    }
    if (scope === "combat") cf.usedThisCombat.push(cardId);
    else cf.usedThisRound.push(cardId);
    this.emit({ type: "DamagePrevented", minion: pd.minion, amount });
    pd.amount -= amount;
    if (pd.amount <= 0) cf.pendingDamage.shift();
  }

  putPermanentInPlay(args: {
    card: CardInstance;
    seat: SeatId;
    attachTo: MinionId | null;
    statics: PermanentStatics;
    tags: string[];
    /** "Put this card in play with N counters" (counter cards). */
    counters?: number;
    /** Statics radiated onto other minions (Gangrel Revel). */
    aura?: PermanentAura;
    /** A card printing more than one aura clause (New Carthage). */
    auras?: PermanentAura[];
    /** Counters here may pay another card cost (Ravnos Carnival). */
    costSource?: PermanentCostSource;
    /** "Instead of X as normal, burn a counter from this card". */
    counterSink?: PermanentCounterSink;
    /** "The named minion does not unlock as normal" while this card is
     *  in play (Toreador Grand Ball). */
    preventsUnlock?: MinionId;
    /** "That minion's (non-bleed) actions cannot be blocked". */
    unblockable?: { minion: MinionId; exceptBleed?: boolean };
    /** The controlling Methuselah when it differs from the seat holding
     *  the card — a master on another Methuselah's minion (p. 16). */
    controller?: SeatId;
    againstSeat?: SeatId;
    linkedMinion?: MinionId;
  }): void {
    const ev: Extract<GameEvent, { type: "PermanentEnteredPlay" }> = {
      type: "PermanentEnteredPlay",
      seat: args.seat,
      cardId: args.card.id,
      name: args.card.name,
      attachedTo: args.attachTo,
      statics: args.statics,
      tags: args.tags,
    };
    if (args.counters !== undefined) ev.counters = args.counters;
    if (args.aura !== undefined) ev.aura = args.aura;
    if (args.auras !== undefined) ev.auras = args.auras;
    if (args.costSource !== undefined) ev.costSource = args.costSource;
    if (args.counterSink !== undefined) ev.counterSink = args.counterSink;
    if (args.controller !== undefined) ev.controller = args.controller;
    if (args.preventsUnlock !== undefined) ev.preventsUnlock = args.preventsUnlock;
    if (args.unblockable !== undefined) ev.unblockable = args.unblockable;
    if (args.againstSeat !== undefined) ev.againstSeat = args.againstSeat;
    if (args.linkedMinion !== undefined) ev.linkedMinion = args.linkedMinion;
    this.emit(ev);
    this.notifyEnterPlay(args.card.id);
  }

  /** "Put this card in play … and move the top 2 cards of your library
   *  onto it" — card text that runs the moment a permanent arrives. Fired
   *  from both entry paths: this op, and the equip/employ/recruit
   *  pipeline's `enterPermanent`. */
  notifyEnterPlay(cardId: CardInstanceId): void {
    const found = this.allEntries().find((e) => e.entry.card.id === cardId);
    if (!found) return;
    this.registry[found.entry.card.name]?.onEnterPlay?.(found.entry, found.owner, this);
  }

  raiseChoice(args: {
    seat: SeatId;
    cardName: string;
    cardId: CardInstanceId;
    key: string;
    params?: Record<string, string>;
    optional?: boolean;
  }): void {
    // Raised from inside action resolution, the frame would be popped by
    // the action's own pop(). Queue it and push once the action frame is
    // gone (docs/choice-frames-design.md §3).
    if (this.deferChoices) {
      this.deferredChoices.push(args);
      return;
    }
    this.state.frames.push({
      kind: "choice",
      seat: args.seat,
      cardName: args.cardName,
      cardId: args.cardId,
      key: args.key,
      params: args.params ?? {},
      optional: args.optional ?? false,
    });
  }

  /** Extra cards, not replacements — an empty library simply stops. */
  drawCards(seatId: SeatId, count: number): void {
    for (let i = 0; i < count; i++) this.drawToReplace(seatId, "extra");
  }

  /** "Shuffle this card into your library" (Aranthebes) — it leaves play
   *  and returns to its OWNER's library (p. 16), which is then shuffled. */
  shuffleIntoLibrary(cardId: CardInstanceId): void {
    const entry = this.findPermanent(cardId);
    const seat = entry.owner ?? this.controllerOfEntry(cardId) ?? this.state.seats[0]!.id;
    this.emit({
      type: "PermanentShuffledIntoLibrary",
      cardId,
      name: entry.card.name,
      seat,
    });
  }

  /**
   * "Equip this vampire with a melee weapon from your hand" and its
   * siblings (docs/play-from-hand-design.md §4). The card leaves hand and
   * enters play with no action wrapped around it.
   *
   * The cost is paid HERE and unconditionally. An equip action defers its
   * cost to resolution because a blocked action never resolves (p. 27);
   * there is no action to block in this family — Piper says as much in
   * its own text — so there is no failure branch to refund.
   */
  playCardFromHand(args: {
    cardId: CardInstanceId;
    seat: SeatId;
    minion: MinionId;
    mode: DisciplineLevel | null;
    blood?: number;
    /** Where the card comes from. Defaults to the hand; a search pulls it
     *  from the LIBRARY (Magic of the Smith, Vast Wealth) and Fleshforge
     *  Chamber plays it out of a STORE — the cost and requirement rules
     *  are identical, only the pile differs.
     *  docs/library-search-design.md §7 */
    from?: { zone: "hand" | "library" } | { zone: "store"; holder: CardInstanceId };
  }): void {
    const seat = getSeat(this.state, args.seat);
    const zone = args.from?.zone ?? "hand";
    const pile =
      zone === "store"
        ? (this.findPermanent(
            (args.from as { zone: "store"; holder: CardInstanceId }).holder,
          ).stored ?? [])
        : zone === "library"
          ? seat.library
          : seat.hand;
    const i = pile.findIndex((c) => c.id === args.cardId);
    if (i < 0) throw new Error(`card not in ${zone}: ${args.cardId}`);
    const [card] = pile.splice(i, 1);
    if (!card) throw new Error("unreachable");
    const handler = this.handler(card.name);
    const bearer = getMinion(this.state, args.minion);

    // It IS played (p. 9): the event log is what every "only one X in a
    // game" check reads, and the English log should say so.
    this.emit({
      type: "CardPlayed",
      cardId: card.id,
      name: card.name,
      seat: seat.id,
      minion: bearer.id,
      mode: args.mode,
    });

    const price = this.priceOf(handler, args.mode, undefined, bearer, bearer.id, seat.id);
    this.consumeOncePlayCostMods(handler, args.mode, undefined);
    // "…can pay up to half the cost rounded down with their blood"
    // (Contraband superior): blood substitutes for pool, one for one.
    const blood = Math.min(args.blood ?? 0, price.pool) + price.blood;
    const pool = price.pool - Math.min(args.blood ?? 0, price.pool);
    if (blood > 0) {
      this.emit({ type: "BloodBurned", minion: bearer.id, amount: blood });
    }
    if (pool > 0) this.emit({ type: "PoolBurned", seat: seat.id, amount: pool });

    this.enterPermanent({
      card,
      handler,
      mode: args.mode,
      seat: seat.id,
      bearer: bearer.id,
      cost: pool,
    });
  }

  burnPermanent(cardId: string): void {
    const entry = this.findPermanent(cardId);
    // A title exists only while the card representing it is in play
    // (docs/granted-rush-design.md §7).
    this.registry[entry.card.name]?.onLeavePlay?.(
      entry,
      { seat: this.controllerOfEntry(cardId) ?? entry.owner ?? this.state.seats[0]!.id, minion: null },
      this,
    );
    if (entry.tags.includes("title")) {
      const bearer = this.state.seats
        .flatMap((s) => s.minions)
        .find((m) => m.attached.some((p) => p.card.id === cardId));
      if (bearer) this.emit({ type: "TitleLost", minion: bearer.id });
    }
    this.emit({ type: "PermanentBurned", cardId, name: entry.card.name });
  }

  lockPermanent(cardId: string): void {
    this.emit({ type: "PermanentLocked", cardId });
  }

  /** Move an attached card onto another minion, keeping its counters and
   *  state. Control follows the new bearer unless `controller` says
   *  otherwise (Regent goes to the diablerist and answers to them). */
  moveAttachment(cardId: string, to: MinionId, controller?: SeatId): void {
    const bearer = getMinion(this.state, to);
    this.emit({
      type: "PermanentMoved",
      cardId,
      to,
      controller: controller ?? bearer.controller,
    });
  }

  /** `replace` defaults to true (a discard-phase discard draws a
   *  replacement, p. 7); a forced discard-down is not a play, so it
   *  passes false. */
  discardFromHand(seatId: SeatId, cardId: string, replace = true): void {
    this.discardCard(seatId, cardId, replace);
  }

  /** "Draw 1 card from your crypt" — the top crypt card goes to the
   *  UNCONTROLLED region (p. 3), not into play.
   *  docs/crypt-and-uncontrolled-design.md §1 */
  drawFromCrypt(seatId: SeatId): void {
    const top = getSeat(this.state, seatId).crypt[0];
    if (!top) return;
    this.emit({ type: "CryptCardDrawn", seat: seatId, minion: top.id });
  }

  /** "Remove a crypt card in your uncontrolled region from the game"
   *  (Wider View) — the uncontrolled region's counterpart to
   *  `removeMinionFromGame`, which only knows about minions in PLAY. */
  removeUncontrolledFromGame(seatId: SeatId, minion: MinionId): void {
    this.emit({ type: "UncontrolledRemovedFromGame", seat: seatId, minion });
  }

  /** "…otherwise, move it to the bottom of your crypt" (Family
   *  Gathering). */
  buryInCrypt(seatId: SeatId, minion: MinionId): void {
    this.emit({ type: "CryptCardBuried", seat: seatId, minion });
  }

  /** "You can use N transfers to …" (Wider View) — the influence phase's
   *  currency, spent by a card in play. The `spendMasterAction` shape.
   *  docs/crypt-and-uncontrolled-design.md §2 */
  spendTransfers(n: number): void {
    const tf = this.state.frames[0];
    if (tf?.kind !== "turn") throw new Error("spendTransfers outside a turn");
    tf.transfersLeft -= n;
  }

  /** "Move a card from your hand to the bottom of your library" (Heart of
   *  Nizchetus) — not a discard: no ash heap, no replacement draw. */
  buryInLibrary(seatId: SeatId, cardId: CardInstanceId): void {
    const card = getSeat(this.state, seatId).hand.find((c) => c.id === cardId);
    if (!card) return;
    this.emit({ type: "CardBuried", seat: seatId, cardId, name: card.name });
  }

  /** "Move a library card from your ash heap to the BOTTOM of your
   *  library" (Mora). Not `takeFromAshHeap`, which puts the card in the
   *  HAND; and the library is drawn from the FRONT, so "the bottom" is
   *  the end. Getting that backwards is invisible until a game runs long
   *  enough to draw the card again. docs/crypt-wave-5.md §5 */
  ashHeapToLibraryBottom(seatId: SeatId, cardId: CardInstanceId): void {
    const card = (getSeat(this.state, seatId).ashHeap ?? []).find((c) => c.id === cardId);
    if (!card) return;
    this.emit({ type: "CardLeftZone", seat: seatId, cardId, name: card.name, zone: "ashHeap" });
    this.emit({ type: "CardToLibraryBottom", seat: seatId, cardId, name: card.name });
  }

  /** "Look at and REORDER the top N cards of your library" (Eulogio) —
   *  move one card to a given position within the library. The library is
   *  drawn from the FRONT, so position 0 is the next card drawn.
   *
   *  A REORDER, not a search: the cards never leave the library and
   *  nothing is revealed to the table, so unlike `searchToHand` there is
   *  no shuffle and no `CardSearchedToHand`. docs/crypt-wave-5.md §2 */
  moveLibraryCardTo(seatId: SeatId, cardId: CardInstanceId, position: number): void {
    const seat = getSeat(this.state, seatId);
    const from = seat.library.findIndex((c) => c.id === cardId);
    if (from < 0 || from === position) return;
    this.emit({ type: "LibraryCardMoved", seat: seatId, cardId, position });
  }

  /** "A card at random" — the seeded RNG, reached through the ops surface
   *  so a card never touches `state.rngState` (principle 2).
   *  docs/unlock-tolls-design.md §2 */
  randomIndex(n: number): number {
    return n <= 0 ? 0 : rngInt(this.state, n);
  }

  useWeaponManeuver(minion: MinionId, cardId: string): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, minion);
    if (cf.usedWeaponManeuver[side] !== null) {
      throw new Error("weapon maneuver already used this combat");
    }
    cf.usedWeaponManeuver[side] = cardId;
    // Using the weapon's maneuver commits its strike (.44 ruling p. 47).
    cf.committedStrike[side] = cardId;
    cf.range = cf.range === "close" ? "long" : "close";
    cf.awaiting = side === "acting" ? "opposing" : "acting";
    cf.declines = 0;
    this.emit({ type: "RangeSet", range: cf.range });
  }

  chooseWeaponStrike(
    minion: MinionId,
    cardId: string,
    strike: {
      name: string;
      damage: number | null;
      ranged: boolean;
      handBonus?: number;
      aggravated?: boolean;
      /** "For each damage inflicted by this strike, burn 1 counter from
       *  this card" (Weighted Walking Stick). */
      depletes?: boolean;
    },
  ): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, minion);
    if (cf.committedStrike[side] !== null && cf.committedStrike[side] !== cardId) {
      throw new Error("strike committed to a different weapon");
    }
    cf.strikes[side] = {
      source: "weapon",
      name: strike.name,
      handBonus: strike.handBonus ?? 0,
      damage: strike.damage,
      ranged: strike.ranged,
      combatEnds: false,
      unlockSelf: false,
      dodge: false,
      aggravated: strike.aggravated ?? false,
      stealBlood: 0,
      ...(strike.depletes ? { depletesCard: cardId } : {}),
    };
    this.emit({ type: "StrikeChosen", minion, strike: strike.name });
  }

  /** "This vampire can strike: burn equipment" (Heroic Might) — a strike
   *  that destroys instead of damaging. The victim's equipment card was
   *  chosen at strike time, so it rides in with the choice.
   *  docs/action-attachments-design.md §4 */
  chooseBurnEquipmentStrike(minion: MinionId, name: string, equipment: CardInstanceId): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, minion);
    cf.strikes[side] = {
      source: "card",
      name,
      handBonus: 0,
      damage: null,
      ranged: true, // destroying a weapon is not a hand strike
      combatEnds: false,
      unlockSelf: false,
      dodge: false,
      aggravated: false,
      stealBlood: 0,
      burnEquipment: equipment,
    };
    this.emit({ type: "StrikeChosen", minion, strike: name });
  }

  /** "Reaction cards cost +1 blood or life" (Consign to Oblivion) — a
   *  play-cost modifier for the rest of this action.
   *  docs/play-cost-design.md §2 */
  addPlayCostMod(mod: PlayCostMod): void {
    const af = this.action();
    if (!af) throw new Error("addPlayCostMod outside an action");
    af.playCostMods.push(mod);
  }

  /** "Those cards are not replaced until the end of the action" (Consign
   *  to Oblivion superior) — the dynamic form of `delayedReplace`. */
  delayReplaceFor(types: PlayCostCardType[]): void {
    const af = this.action();
    if (!af) throw new Error("delayReplaceFor outside an action");
    af.delayReplaceTypes.push(...types);
  }

  /** "The chosen minion cannot play reaction cards this action"
   *  (Unleashing the Bestial Soul). It does NOT stop them blocking — the
   *  card says reaction CARDS. */
  barReactionsFrom(minion: MinionId): void {
    const af = this.action();
    if (!af) throw new Error("barReactionsFrom outside an action");
    if (!af.noReactionsFrom.includes(minion)) af.noReactionsFrom.push(minion);
  }

  /**
   * What a card costs to play right now (docs/play-cost-design.md §3) —
   * the printed cost put through every active modifier. Everything
   * `playCostFor` needs is denormalized onto the handler already, so this
   * is assembly, not lookup.
   */
  priceOf(
    handler: CardHandler,
    mode: DisciplineLevel | null,
    variant: string | undefined,
    minion: MinionState | null,
    target?: MinionId | null,
    payerSeat?: SeatId | null,
  ): { blood: number; pool: number } {
    return playCostFor(
      this.state,
      {
        name: handler.name,
        bloodCost: handler.bloodCost,
        poolCost: handler.poolCost ?? 0,
        types: handler.costTypes?.(mode, variant) ?? [],
        requires: handler.requiresDisciplines?.(mode, variant) ?? [],
        requiresClans: handler.requiresClans?.() ?? [],
        tags: handler.permanentTags ?? [],
      },
      minion,
      this.action(),
      this.combatFrame(),
      target,
      payerSeat,
    );
  }

  /**
   * Spend the one-shot modifiers this card just triggered ("the NEXT
   * reaction card costs +1", Unleashing the Bestial Soul superior).
   * Removal happens HERE, at payment, so option enumeration — which runs
   * many times per decision — stays a pure read.
   */
  private consumeOncePlayCostMods(
    handler: CardHandler,
    mode: DisciplineLevel | null,
    variant: string | undefined,
  ): void {
    const card = {
      name: handler.name,
      bloodCost: handler.bloodCost,
      poolCost: handler.poolCost ?? 0,
      types: handler.costTypes?.(mode, variant) ?? [],
      requires: handler.requiresDisciplines?.(mode, variant) ?? [],
      requiresClans: handler.requiresClans?.() ?? [],
      tags: handler.permanentTags ?? [],
    };
    for (const frame of [this.action(), this.combatFrame()]) {
      if (!frame) continue;
      const i = frame.playCostMods.findIndex(
        (mod) => mod.once && playCostModApplies(mod, card),
      );
      if (i >= 0) {
        frame.playCostMods.splice(i, 1);
        return; // one card spends one charge
      }
    }
    // Seat-held modifiers spend the same way (Szlachta Assistant).
    for (const seat of this.state.seats) {
      const list = seat.playCostMods;
      if (!list) continue;
      const i = list.findIndex((mod) => mod.once && playCostModApplies(mod, card));
      if (i >= 0) {
        list.splice(i, 1);
        return;
      }
    }
  }

  /** A play-cost modifier held by a Methuselah rather than by a frame or
   *  a card in play (docs/retainer-wave-design.md §4). */
  addSeatPlayCostMod(seatId: SeatId, mod: PlayCostMod): void {
    const seat = getSeat(this.state, seatId);
    (seat.playCostMods ??= []).push(mod);
  }

  cancelPendingCard(refundCost: boolean): void {
    // Called while the canceling card resolves: its own frame is already
    // popped, so the card being canceled is the top frame.
    const top = this.top();
    if (!top || top.kind !== "cardPlay") {
      throw new Error("no pending card play to cancel");
    }
    top.canceled = true;
    if (refundCost) {
      // Refund what was PAID, not what was printed — a surcharge was real
      // money and a `once` modifier has already been spent, so the live
      // cost would no longer be the right answer.
      if (top.paid.pool > 0) {
        this.emit({ type: "PoolGained", seat: top.seat, amount: top.paid.pool });
      }
      if (top.paid.blood > 0 && top.minion && !top.asAction) {
        this.emit({ type: "BloodGained", minion: top.minion, amount: top.paid.blood });
      }
    }
  }

  /** "You get +N discard phase actions" (Sreelekha). p. 37 grants one by
   *  default, set as the phase opens and just before the hook that calls
   *  this fires, so the bonus adds to it. docs/crypt-wave-4.md §4 */
  addDiscardPhaseActions(n: number): void {
    const tf = this.state.frames.find((f) => f.kind === "turn");
    if (tf?.kind !== "turn") return;
    tf.discardActionsLeft = (tf.discardActionsLeft ?? 1) + n;
  }

  grantVotes(seat: SeatId, amount: number): void {
    const rf = this.referendumFrame();
    if (!rf) throw new Error("grantVotes outside a referendum");
    rf.voteGrants[seat] = (rf.voteGrants[seat] ?? 0) + amount;
  }

  /** "If this vampire blocks, it gets N maneuvers/presses in the resulting
   *  combat" (Spirit's Touch) — recorded on the action, applied at block. */
  grantBlockerCombatRider(
    minion: MinionId,
    riders: {
      maneuver?: number;
      press?: number;
      noStrikeFirstRound?: boolean;
      playCostMod?: PlayCostMod;
      prevent?: number;
      noEquipment?: boolean;
      unlockForBlood?: number;
      combatEndsStrike?: boolean;
    },
  ): void {
    const af = this.action();
    if (!af) throw new Error("grantBlockerCombatRider outside an action");
    const cur = af.blockerCombatRiders[minion] ?? { maneuver: 0, press: 0 };
    cur.maneuver += riders.maneuver ?? 0;
    cur.press += riders.press ?? 0;
    if (riders.noStrikeFirstRound) cur.noStrikeFirstRound = true;
    if (riders.prevent) cur.prevent = (cur.prevent ?? 0) + riders.prevent;
    if (riders.noEquipment) cur.noEquipment = true;
    if (riders.unlockForBlood) cur.unlockForBlood = riders.unlockForBlood;
    if (riders.combatEndsStrike) cur.combatEndsStrike = true;
    if (riders.playCostMod) cur.playCostMod = riders.playCostMod;
    af.blockerCombatRiders[minion] = cur;
  }

  /** "If this vampire is blocked, they get X in the resulting combat"
   *  (Beast Meld, Invigorate) — the acting-minion mirror of
   *  grantBlockerCombatRider. Cumulative. */
  grantActorCombatRider(riders: {
    prevent?: number;
    strength?: number;
    maneuver?: number;
    press?: number;
    handStrikesAggravated?: boolean;
    combatAggravated?: boolean;
    noEquipment?: boolean;
  }): void {
    const af = this.action();
    if (!af) throw new Error("grantActorCombatRider outside an action");
    const cur = af.actorCombatRider;
    cur.prevent += riders.prevent ?? 0;
    cur.strength += riders.strength ?? 0;
    cur.maneuver += riders.maneuver ?? 0;
    cur.press += riders.press ?? 0;
    if (riders.handStrikesAggravated) cur.handStrikesAggravated = true;
    if (riders.combatAggravated) cur.combatAggravated = true;
    if (riders.noEquipment) cur.noEquipment = true;
  }

  /**
   * "If a vampire is currently attempting to block, they can cancel their
   * block attempt" (Dawn Operation inferior).
   *
   * A no-op with no attempt underway: the card's other clause ("if this
   * action is blocked …") is still worth playing, so this must not make
   * the card unplayable. The offer is scoped to the attempt that is open
   * right now — a later re-attempt is a new frame and gets no offer.
   */
  offerBlockerCancel(): void {
    const ba = this.blockAttempt();
    if (ba) ba.mayCancel = true;
  }

  /** "Queue a combat between them" (Hedonism) — a combat between two
   *  minions neither of which is the acting minion, entered once this
   *  action is off the stack. */
  queueCombat(a: MinionId, b: MinionId, outcome?: AfterCombatRider): void {
    const af = this.action();
    if (!af) throw new Error("queueCombat outside an action");
    af.queuedCombats.push({ a, b, ...(outcome ? { outcome } : {}) });
  }

  /**
   * Hedonism: "that attempt fails and the blocking minion cannot attempt
   * to block this action again. Lock this vampire and the blocking
   * minion, and queue a combat between them."
   *
   * The blocker is read here, before `failBlockAttempt` flags the frame,
   * because the id is needed for the locks and the queued combat.
   */
  /**
   * "Force a vampire to abstain (this cancels their votes and ballots)"
   * (Scalpel Tongue, Telepathic Vote Counting superior, and later
   * Saulot's Guiding Wisdom).
   *
   * Two halves, and both are needed: the votes already in the array are
   * removed (the tally is a fold, so that IS the cancellation), and the
   * vampire joins `abstaining` so the enumeration stops offering them.
   * Votes and ballots both key on the casting vampire's id, so removing by
   * source takes both — which is what the parenthetical promises.
   *
   * Deliberately does nothing else: Scalpel Tongue's lock and blood burn
   * belong to the card, not to abstaining.
   */
  forceAbstain(minion: MinionId): void {
    const rf = this.referendum();
    if (!rf) return;
    const cancelled = rf.votes
      .filter((v) => v.source === minion)
      .reduce((n, v) => n + v.count, 0);
    rf.votes = rf.votes.filter((v) => v.source !== minion);
    rf.abstaining = [...(rf.abstaining ?? []), minion];
    this.emit({
      type: "VampireAbstained",
      actionId: rf.actionId,
      minion,
      votesCancelled: cancelled,
    });
  }

  /**
   * "Cancel the referendum. If you played a political action card to call
   * this referendum, return it to its owner's hand" (Telepathic Vote
   * Counting inferior).
   *
   * A cancellation is NOT a failure: the frame is popped without
   * `ReferendumResolved` and without `applyReferendum`, so a title-granting
   * card does not burn (p. 27) — it goes back to hand instead.
   */
  cancelReferendum(): void {
    const rf = this.referendum();
    if (!rf) return;
    // NOT `this.pop()`: this runs while the cancelling card's own cardPlay
    // frame is on top, so popping would take that instead and leave the
    // referendum to resolve normally. Flag it and let settle drop it, the
    // way `forcedFail` is honoured at the tally.
    rf.cancelled = true;
    this.emit({ type: "ReferendumCancelled", actionId: rf.actionId, cardName: rf.cardName });
    if (rf.cardInstanceId) {
      this.returnCardToHand(rf.caller, rf.cardInstanceId, rf.cardName);
      // "(discard down afterward)" — p. 7's standing rule spelled out on
      // the card: a hand over its size sheds one, chosen by its OWNER,
      // who need not be the Methuselah who played the cancel.
      if (getSeat(this.state, rf.caller).hand.length > this.handSizeOf(rf.caller)) {
        this.raiseChoice({
          seat: rf.caller,
          cardName: "Telepathic Vote Counting",
          cardId: rf.cardInstanceId,
          key: "discardDown",
        });
      }
    }
  }

  /** Yoruba Shrine: the referendum resolves as a FAILURE rather than being
   *  cancelled — so a title-granting card still burns. */
  failReferendum(): void {
    const rf = this.referendum();
    if (rf) rf.forcedFail = true;
  }

  /**
   * "…have the action fail" (Yoruba Shrine). Reuses the step the diablerie
   * offer already uses for a failed action: settle resolves `"blocked"` as
   * an unsuccessful action, so the cost is never paid and no effect runs.
   */
  failAction(): void {
    const af = this.action();
    if (af) af.step = "blocked";
  }

  /**
   * "The action ends (unsuccessfully)" played BEFORE block resolution
   * (Change of Target, Mirror Walk, Obedience) — docs/end-action-design.md §3.
   *
   * The pending block attempt is **cancelled, not failed**: p. 47 says the
   * blocking minion "is not locked for blocking", and cancelling is the
   * flag that neither locks them nor spends their right to try again,
   * where `failBlockAttempt` would do both.
   */
  endAction(args: { unlockActor?: boolean; lockBlocker?: boolean } = {}): void {
    const af = this.action();
    if (!af) return;
    const ba = this.blockAttempt();
    if (ba) {
      // "Contrary to Change of Target, Mirror Walk explicitly locks the
      // blocking minion" (p. 49) — the one difference between the two.
      if (args.lockBlocker && findMinion(this.state, ba.blocker)) {
        this.emit({ type: "MinionLocked", minion: ba.blocker });
      }
      ba.cancelled = true;
    }
    if (args.unlockActor) {
      const actor = findMinion(this.state, af.acting);
      if (actor?.locked) this.emit({ type: "MinionUnlocked", minion: af.acting });
    }
    af.step = "blocked";
  }

  /** "…cannot perform the same action again this turn." The key is the
   *  card's name for a card-announced action, the ActionKind otherwise
   *  (docs/end-action-design.md §4). */
  barRepeatAction(scope: "minion" | "seat"): void {
    const af = this.action();
    // A political action's frame has already popped by the polling step —
    // the referendum outlives it — so "the same political action" is read
    // off the referendum instead (Delaying Tactics).
    const rf = af ? null : this.referendumFrame();
    const key = af ? actionKeyOf(af) : rf?.cardName;
    const seatId = af ? af.actingSeat : rf?.caller;
    const actorId = af ? af.acting : rf?.callingMinion;
    if (key === undefined || seatId === undefined) return;
    if (scope === "seat") {
      (getSeat(this.state, seatId).cannotRepeat ??= []).push(key);
      return;
    }
    const actor = actorId ? findMinion(this.state, actorId) : null;
    if (actor) (actor.cannotRepeat ??= []).push(key);
  }

  /** "Minions who attempt to block this action and fail become locked
   *  before action resolution" (Faceless Night) — from now on, not
   *  retroactively (p. 48). */
  lockFailedBlockers(): void {
    const af = this.action();
    if (af) af.lockFailedBlockers = true;
  }

  /** "…once results are tallied" (Scorn of Adonis) — an effect registered
   *  now and applied after the tally, whatever the outcome. */
  addPostTally(effect: { kind: "burnPoolVotedAgainst"; amount: number }): void {
    const rf = this.referendum();
    if (!rf) return;
    rf.postTally = [...(rf.postTally ?? []), effect];
  }

  /** "Cannot play reaction cards, block or cast votes or ballots this
   *  turn" (Expulsion). */
  expelMinion(minion: MinionId): void {
    const m = findMinion(this.state, minion);
    if (!m) return;
    this.emit({ type: "MinionExpelled", minion });
  }

  /** "Burn X blood to give the next X actions minions you control perform
   *  this turn +1 stealth" (Veil the Legions superior) — the bank; the
   *  blood is burned by the caller, since X is the mode's chosen cost. */
  /** "The first referendum a Sabbat vampire you control calls on this turn
   *  passes automatically" (Día de los Muertos) — arms the seat; the
   *  referendum push consumes it, and TurnBegan clears an unused one.
   *  docs/politics-locations-design.md §4 */
  armAutoPassReferendum(seat: SeatId): void {
    getSeat(this.state, seat).autoPassReferendum = true;
  }

  grantStealthCharges(seat: SeatId, count: number): void {
    const s = getSeat(this.state, seat);
    s.stealthCharges = (s.stealthCharges ?? 0) + count;
  }

  /** Record that this seat played `card` at superior this turn — for
   *  "only one <card> can be played at superior each turn". */
  recordSuperiorPlay(seat: SeatId, card: string): void {
    const s = getSeat(this.state, seat);
    s.superiorPlaysThisTurn = [...(s.superiorPlaysThisTurn ?? []), card];
  }

  interposeOnBlocker(interposer: MinionId, combat: boolean): void {
    const ba = this.blockAttempt();
    if (!ba) return;
    const blocker = ba.blocker;
    this.failBlockAttempt();
    this.emit({ type: "MinionLocked", minion: interposer });
    this.emit({ type: "MinionLocked", minion: blocker });
    if (combat) this.queueCombat(interposer, blocker);
  }

  /** Mark a card-in-play's "once each action" ability as used (Under
   *  Siege) — action-scoped. */
  markInPlayAbilityUsed(cardId: CardInstanceId): void {
    const af = this.action();
    if (af && !af.usedInPlayAbilities.includes(cardId)) af.usedInPlayAbilities.push(cardId);
  }

  /** "If this vampire blocks, put this card on the acting minion; you still
   *  control it" (Melange) — recorded on the action, attached at block. */
  attachToActorOnBlock(minion: MinionId, cardId: CardInstanceId, cardName: string, seat: SeatId): void {
    const af = this.action();
    if (!af) throw new Error("attachToActorOnBlock outside an action");
    af.attachOnBlock.push({ blocker: minion, cardId, cardName, seat });
  }

  /** Add/remove a seat's corruption counters on a minion (The Platinum
   *  Protocol, Cave of Apples). Removal clamps at 0. */
  addCorruption(minion: MinionId, seat: SeatId, amount: number): void {
    this.emit({ type: "CorruptionChanged", minion, seat, delta: amount });
  }

  removeCorruption(minion: MinionId, seat: SeatId, amount: number): void {
    this.emit({ type: "CorruptionChanged", minion, seat, delta: -amount });
  }

  /** "You must shuffle it afterwards" (p. 14) — after EVERY search,
   *  including one that deliberately found nothing (p. 48). */
  shuffleLibrary(seatId: SeatId): void {
    this.emit({ type: "LibraryShuffled", seat: seatId });
  }

  /** Move a card out of play onto a card in play. From the top of the
   *  library when `cardId` is omitted (Shilmulo Tarot), or a named card
   *  from the library (Black Market Cache) or hand (Fleshforge Chamber).
   *  docs/library-search-design.md §5 */
  storeCard(args: {
    holder: CardInstanceId;
    from: "library" | "hand";
    cardId?: CardInstanceId;
    faceUp: boolean;
  }): void {
    const seatId = this.controllerOfEntry(args.holder) ?? this.state.seats[0]!.id;
    const seat = getSeat(this.state, seatId);
    const pile = args.from === "hand" ? seat.hand : seat.library;
    const card = args.cardId ? pile.find((c) => c.id === args.cardId) : pile[0];
    if (!card) return; // an empty library is simply nothing to move
    this.emit({
      type: "CardStored",
      seat: seatId,
      holder: args.holder,
      cardId: card.id,
      name: card.name,
      from: args.from,
      faceUp: args.faceUp,
    });
  }

  /** Spend the current master phase action (p. 10) — for an ability that
   *  costs one without being a master card (Tension in the Ranks). */
  spendMasterAction(): void {
    const tf = this.state.frames.find((f) => f.kind === "turn");
    if (tf?.kind === "turn" && tf.phase === "master") tf.masterActionsLeft -= 1;
  }

  /** Named counters on a minion that belong to no Methuselah (hostage,
   *  nightmare). Removal clamps at 0. */
  addMinionCounters(minion: MinionId, kind: string, amount: number): void {
    this.emit({ type: "MinionCountersChanged", minion, kind, delta: amount });
  }

  /** "Stun a minion": lock them and put a stun counter on them (owner
   *  ruling 2026-08-31, docs/stun-design.md). Both halves live here so the
   *  two cards that stun cannot drift apart. The unlock suppression and
   *  the burn are the unlock sweep's business, off `counters["stun"]`. */
  stun(minion: MinionId): void {
    const m = findMinion(this.state, minion);
    if (!m) return; // it can leave play before an after-combat rider fires
    if (!m.locked) this.emit({ type: "MinionLocked", minion: m.id });
    this.addMinionCounters(m.id, "stun", 1);
  }

  /** Add/remove generic counters on a card in play (Dreams of the Sphinx,
   *  the bespoke counter cards). Removal clamps at 0. */
  addCounters(cardId: CardInstanceId, amount: number): void {
    this.emit({ type: "CountersChanged", cardId, delta: amount });
  }

  removeCounters(cardId: CardInstanceId, amount: number): void {
    this.emit({ type: "CountersChanged", cardId, delta: -amount });
  }

  /** "Non-<sect> vampires cannot cast votes or ballots this referendum." */
  restrictReferendumVotes(sect: Sect): void {
    const rf = this.referendumFrame();
    if (!rf) throw new Error("restrictReferendumVotes outside a referendum");
    rf.voteRestriction = { sect };
  }

  /** "Vampires who do not follow the Path of \<x\> get −1 vote" (Absolute
   *  Tyranny superior) — every vampire's count for this referendum, not a
   *  grant to one player. docs/path-cards-design.md §4 */
  modifyAllReferendumVotes(amount: number, exceptPath?: string): void {
    const rf = this.referendumFrame();
    if (!rf) throw new Error("modifyAllReferendumVotes outside a referendum");
    rf.voteModifiers = [
      ...(rf.voteModifiers ?? []),
      { amount, ...(exceptPath === undefined ? {} : { exceptPath }) },
    ];
  }

  /** "If the bleed is successful, this vampire can burn 2 of your
   *  corruption counters from a minion of the target to unlock" (Revelation
   *  of the Serpent) — recorded on the action, settled at resolution. */
  registerCorruptionUnlock(minion: MinionId, seat: SeatId): void {
    const af = this.action();
    if (af) af.corruptionUnlocks.push({ minion, seat });
  }

  /** "Burn 1 of your corruption counters from a blocking minion to have
   *  their block attempt fail" (Enchanting Gaze) — `seat` is whose
   *  corruption is spent (the acting seat). */
  /** "That block attempt fails and the blocking minion cannot attempt to
   *  block this action again" — the plain form of what Enchanting Gaze
   *  buys with a corruption counter. */
  failBlockAttempt(): void {
    const ba = this.blockAttempt();
    if (ba) ba.forceFail = true;
  }

  /** "The blocking minion gets -N intercept" — the acting minion pushing
   *  the current blocker down. */
  modifyBlockerIntercept(delta: number, source: string): void {
    const ba = this.blockAttempt();
    if (!ba) return;
    this.emit({
      type: "InterceptModified",
      actionId: ba.actionId,
      minion: ba.blocker,
      delta,
      source,
    });
  }

  corruptFailBlock(seat: SeatId): void {
    const ba = this.blockAttempt();
    if (!ba) return;
    this.emit({ type: "CorruptionChanged", minion: ba.blocker, seat, delta: -1 });
    ba.forceFail = true;
  }

  /** "X cannot block this action" (Seduction, Visions of Gehenna). */
  restrictBlocking(who: "allies" | "vampires" | "titled" | "chosen", chosen?: MinionId): void {
    const af = this.action();
    if (!af) throw new Error("restrictBlocking outside an action");
    if (who === "allies") af.blockRestrictions.noAllies = true;
    else if (who === "vampires") af.blockRestrictions.noVampires = true;
    else if (who === "titled") af.blockRestrictions.noTitled = true;
    else if (chosen) af.blockRestrictions.cannotBlock.push(chosen);
  }

  /** "Minions [without X] must burn 1 blood [or life] to attempt to block
   *  this action" (docs/block-tax-design.md). Cumulative. */
  imposeBlockCost(
    cost: { amount: number; payWith: "blood" | "bloodOrLife"; exemptDiscipline?: string },
    source: string,
  ): void {
    const af = this.action();
    if (!af) throw new Error("imposeBlockCost outside an action");
    af.blockCosts.push({ ...cost, source });
    this.emit({
      type: "BlockCostImposed",
      actionId: af.actionId,
      amount: cost.amount,
      source,
    });
  }

  /** "Minions get -1 intercept" (Unthinkable Humiliation superior) — an
   *  action-wide penalty, not one aimed at the current blocker. */
  modifyAllIntercept(delta: number, source: string, appliesTo?: "vampire" | "ally"): void {
    const af = this.action();
    if (!af) throw new Error("modifyAllIntercept outside an action");
    this.emit({
      type: "ActionInterceptModified",
      actionId: af.actionId,
      delta,
      source,
      ...(appliesTo ? { appliesTo } : {}),
    });
  }

  /** "Allies and younger vampires get −1 intercept" (Perfect Paragon
   *  superior) — the same event with a two-clause filter, where "younger"
   *  is relative to the ACTING minion and the English "and" is a UNION.
   *  docs/opposing-statics-design.md §1 */
  modifyFilteredIntercept(
    delta: number,
    source: string,
    filter: { kinds?: Array<"vampire" | "ally">; younger?: boolean; sects?: Sect[] },
  ): void {
    const af = this.action();
    if (!af) throw new Error("modifyFilteredIntercept outside an action");
    this.emit({
      type: "ActionInterceptModified",
      actionId: af.actionId,
      delta,
      source,
      filter: {
        ...(filter.kinds ? { kinds: filter.kinds } : {}),
        ...(filter.younger ? { youngerThan: af.acting } : {}),
        ...(filter.sects ? { sects: filter.sects } : {}),
      },
    });
  }

  /** "…can burn 1 blood during your next discard phase to unlock"
   *  (Fiendish Tongue). Not an event: it is a permission, and the option
   *  it enables is the thing that lands in the log. */
  grantDiscardPhaseUnlock(minion: MinionId): void {
    const m = findMinion(this.state, minion);
    if (m) m.discardPhaseUnlock = true;
  }

  /** "During this action, minions cannot unlock" (The Sleeping Mind). */
  preventUnlockDuringAction(): void {
    const af = this.action();
    if (!af) throw new Error("preventUnlockDuringAction outside an action");
    af.noUnlock = true;
  }

  /** "This vampire takes N unpreventable environmental aggravated damage
   *  after action resolution" (Daring the Dawn) — queued on the frame and
   *  applied once the action has resolved. */
  damageAfterAction(
    minion: MinionId,
    amount: number,
    aggravated: boolean,
    optOut?: { blood: number; cardName: string; cardId: string },
  ): void {
    const af = this.action();
    if (!af) throw new Error("damageAfterAction outside an action");
    af.afterResolutionDamage.push({ minion, amount, aggravated, ...(optOut ? { optOut } : {}) });
  }

  continueActionAsUnblocked(): void {
    const af = this.action();
    if (!af) throw new Error("continueActionAsUnblocked outside an action");
    af.continueUnblocked = true;
  }

  /** Environmental damage outside combat: `source: null`, so nothing can
   *  dodge or prevent it (p. 31). Extracted so a card that defers this
   *  damage behind a question (Rutor's Hand superior) lands it exactly the
   *  way the engine's own loop would. */
  applyEnvironmentalDamage(minion: MinionId, amount: number, aggravated: boolean): void {
    if (!findMinion(this.state, minion)) return;
    this.emit({ type: "DamageInflicted", minion, amount, source: null, aggravated });
    this.applyResolvedDamage({ minion, amount, source: null, aggravated });
  }

  setCombatStrength(play: CardPlayFrame, value: number): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.strengthOverride[side] = value;
    if (play.minion) {
      this.emit({ type: "StrengthSet", minion: play.minion, value });
    }
  }

  addCombatStrength(play: CardPlayFrame, amount: number): void {
    this.addCombatStrengthTo(play.minion, amount);
  }

  /** "Damage from this vampire's hand strikes is aggravated this round"
   *  (Claws of the Dead, Wolf Claws). */
  setHandStrikesAggravated(play: CardPlayFrame): void {
    this.setHandStrikesAggravatedFor(play.minion);
  }

  /** The same, keyed on the MINION rather than a card play — an ability of
   *  a card in play has no `CardPlayFrame` (Crossbreaker). The
   *  `addRoundStrengthTo` shape (docs/crypt-wave-3.md §3). */
  setHandStrikesAggravatedFor(minion: MinionId | null): void {
    const cf = this.requireCombat();
    cf.handStrikesAggravated[this.sideOf(cf, minion)] = true;
  }

  /** "After combat ends, <do X>" — queue a rider on the current combat
   *  (docs/after-combat-ends-design.md §2). */
  addAfterCombatRider(rider: AfterCombatRider): void {
    this.requireCombat().afterCombatEnds.push(rider);
  }

  /**
   * "Put this card on this vampire" / "…on the opposing vampire" from a
   * combat card that is NOT a strike (Wall of Filth, Disarm).
   *
   * Total in the bearer: End of Round runs even after a combatant has
   * left the ready region (p. 32), which is precisely when Disarm is
   * played, so the opposing minion may be gone by now.
   * docs/combat-attachments-design.md §2
   */
  attachInCombat(
    play: CardPlayFrame,
    to: "self" | "opposing",
    statics: PermanentStatics,
    tags: string[],
  ): MinionId | null {
    const cf = this.requireCombat();
    if (!play.minion) return null;
    const side = this.sideOf(cf, play.minion);
    const bearerId =
      to === "self" ? play.minion : side === "acting" ? cf.opposing : cf.acting;
    const bearer = findMinion(this.state, bearerId);
    if (!bearer) return null;
    this.putPermanentInPlay({
      card: play.card,
      seat: bearer.controller,
      attachTo: bearer.id,
      statics,
      tags: [play.card.name, ...tags],
      // p. 16: a card put on another Methuselah's minion still answers to
      // the player who played it.
      controller: play.seat,
    });
    return bearer.id;
  }

  /**
   * "…and send them to torpor" (Disarm) — the same reading
   * `strikeIncapacitate` takes: an ally has no torpor to go to (p. 22),
   * so it is burned; a vampire already in torpor is left alone.
   */
  sendToTorpor(minionId: MinionId): void {
    const m = findMinion(this.state, minionId);
    if (!m) return;
    if (m.kind === "ally") {
      this.burnMinion(minionId);
    } else if (!m.inTorpor) {
      this.notifyLeaveReady(minionId, "torpor");
      this.emit({ type: "WentToTorpor", minion: minionId });
    }
    this.notifyCombatLeave(minionId);
  }

  /**
   * "Put this card in play and move up to N blood from the opposing
   * vampire to this card" (Morbidity). The store is the entry's own
   * counters — blood in, blood out — which is the Wasserschloss Anif
   * precedent and needs no new state.
   * docs/combat-attachments-design.md §6
   */
  storeCombatBlood(play: CardPlayFrame, amount: number): void {
    const cf = this.requireCombat();
    if (!play.minion) return;
    const foeId = this.sideOf(cf, play.minion) === "acting" ? cf.opposing : cf.acting;
    const foe = findMinion(this.state, foeId);
    const moved = foe ? Math.min(amount, foe.blood) : 0;
    this.putPermanentInPlay({
      card: play.card,
      seat: play.seat,
      attachTo: null,
      statics: {},
      tags: [play.card.name],
      counters: moved,
    });
    if (moved > 0 && foe) {
      this.emit({ type: "BloodBurned", minion: foe.id, amount: moved });
    }
    // The return is queued now, while both the card and its victim are
    // known; the victim is re-read at flush, since it can be burned in
    // between (§6).
    this.addAfterCombatRider({
      kind: "returnStoredBlood",
      cardId: play.card.id,
      to: foeId,
    });
  }

  /** "Prevent all damage from the opposing minion's strikes this round"
   *  (Rolling with the Punches superior) — set on the side OPPOSITE the
   *  player, whose strikes are being blunted (§4). */
  preventAllFromOpponentThisRound(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const other = this.sideOf(cf, play.minion) === "acting" ? "opposing" : "acting";
    const source = other === "acting" ? cf.acting : cf.opposing;
    cf.preventAllFrom[other] = true;
    // The card is played in the damage-resolution window, so their strike
    // has ALREADY been pushed. "All damage from their strikes this round"
    // includes the item on the table, not only anything still to come.
    for (let i = cf.pendingDamage.length - 1; i >= 0; i--) {
      const pd = cf.pendingDamage[i]!;
      if (pd.source !== source) continue;
      this.emit({ type: "DamagePrevented", minion: pd.minion, amount: pd.amount });
      cf.pendingDamage.splice(i, 1);
    }
  }

  /** "The opposing vampire's strikes with weapons inflict no damage this
   *  round" (Blood Fury, Blood Rage, Soul Burn) — set on the side
   *  OPPOSITE the player, since it is their strikes the card blunts.
   *  docs/discipline-filtered-design.md §4 */
  nullifyOpposingWeaponDamage(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const other = this.sideOf(cf, play.minion) === "acting" ? "opposing" : "acting";
    cf.weaponDamageNullified[other] = true;
  }

  /** "This combat, combat cards cost the OPPOSING vampire +1 blood"
   *  (Terror Frenzy superior) — the payer is resolved here, at play time,
   *  to whichever combatant is not the player. docs/play-cost-design.md */
  addCombatCostModOnOpponent(play: CardPlayFrame, mod: PlayCostMod): void {
    const cf = this.requireCombat();
    const other = this.sideOf(cf, play.minion) === "acting" ? cf.opposing : cf.acting;
    const applied: PlayCostMod = { ...mod, minionId: other };
    // Provenance for "cancel the effects of frenzy cards already used on
    // this vampire" (Tranquility Shield) — §6.
    if (play.isFrenzy) applied.fromFrenzy = true;
    cf.playCostMods.push(applied);
  }

  /** "This combat, the opposing minion cannot maneuver / press / use
   *  equipment" (Terror Frenzy) — applied to the side opposite the player. */
  restrictCombatOpponent(
    play: CardPlayFrame,
    r: { maneuver: boolean; press: boolean; equipment: boolean },
  ): void {
    const cf = this.requireCombat();
    const opp = this.sideOf(cf, play.minion) === "acting" ? "opposing" : "acting";
    if (r.maneuver) cf.restrict[opp].maneuver = true;
    if (r.press) cf.restrict[opp].press = true;
    if (r.equipment) cf.restrict[opp].equipment = true;
    // Provenance for Tranquility Shield's cancel clause — §6.
    if (play.isFrenzy && (r.maneuver || r.press || r.equipment)) {
      cf.frenzyRestrict[opp] = true;
    }
  }

  /** Grant a "1 optional press this combat" credit (Form of the Wolf) —
   *  persists across rounds until spent, unlike a per-round grantPress. */
  grantCombatPress(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.pressesCombat[side] += 1;
  }

  /** Same credit, granted by a card in play rather than a card play
   *  (Mob Connections). */
  grantCombatPressTo(side: "acting" | "opposing"): void {
    this.requireCombat().pressesCombat[side] += 1;
  }

  /**
   * The three grants a card IN PLAY can hand its bearer mid-combat
   * (Monstrous Form superior). The card-play ops beside them
   * (`addRoundStrength`, `grantManeuverCredit`) all take a
   * `CardPlayFrame`, which an in-play ability does not have — so these
   * take the minion and resolve the side themselves.
   * docs/combat-attachments-design.md §7
   */
  addRoundStrengthTo(minion: MinionId, amount: number): void {
    const cf = this.requireCombat();
    cf.strengthBonusRound[this.sideOf(cf, minion)] += amount;
  }

  /** "+N strength THAT COMBAT" (Kasim Bayar) — the combat-long sibling of
   *  `addRoundStrengthTo`. `addCombatStrength` delegates here so there is
   *  one implementation (docs/crypt-wave-3.md §3). */
  addCombatStrengthTo(minion: MinionId | null, amount: number): void {
    const cf = this.requireCombat();
    cf.strengthBonus[this.sideOf(cf, minion)] += amount;
  }

  grantManeuverCreditTo(minion: MinionId): void {
    const cf = this.requireCombat();
    cf.maneuverCredits[this.sideOf(cf, minion)] += 1;
  }

  grantCombatPressToMinion(minion: MinionId): void {
    const cf = this.requireCombat();
    cf.pressesCombat[this.sideOf(cf, minion)] += 1;
  }

  /** Grant a "1 optional maneuver" credit (Aid from Bats), spendable in a
   *  later range step this combat. */
  /** "This round, this vampire gets +1 strength" (Obedient Flesh) — reset
   *  when the next round begins, unlike addCombatStrength. */
  addRoundStrength(play: CardPlayFrame, amount: number): void {
    const cf = this.requireCombat();
    cf.strengthBonusRound[this.sideOf(cf, play.minion)] += amount;
  }

  /** "This combat, this vampire can prevent N damage EACH ROUND" (Bear's
   *  Skin superior, Tranquility Shield) — a rate, not a pool: it is never
   *  reset, and the per-round SPEND is what the round boundary clears.
   *  docs/round-recurring-combat-design.md §2 */
  grantPreventEachRound(play: CardPlayFrame, amount: number): void {
    const cf = this.requireCombat();
    cf.preventPerRound[this.sideOf(cf, play.minion)] += amount;
  }

  /** "This combat, <X> takes N damage each round" (Carrion Crows, Weather
   *  Control). Installed with the round it was played in as its baseline,
   *  then fired immediately: the card is played inside the very window it
   *  names, so waiting for the next round would skip one. §3, §8.1 */
  addRoundDamage(
    play: CardPlayFrame,
    r: Omit<CombatRoundDamageRider, "from" | "startRound">,
  ): void {
    const cf = this.requireCombat();
    const rider: CombatRoundDamageRider = {
      ...r,
      from: this.sideOf(cf, play.minion),
      startRound: cf.round,
    };
    cf.roundDamage.push(rider);
    // Fire now only if this round has ALREADY reached the rider's moment.
    // A combat card is played in the before-range window, so a
    // `beforeRange` rider would otherwise skip the round it was cast in
    // (Weather Control), while a `strikeResolution` one has its moment
    // still ahead of it and must wait (Carrion Crows) — firing it here
    // would give the round two hits instead of one.
    if (rider.when === "beforeRange") this.inflictRoundDamage(cf, rider);
  }

  /** "This combat, once a damage lands on this vampire in a round, any
   *  additional damage that round is automatically prevented" (Flesh of
   *  Marble). §5 */
  setAutoPreventAfterFirst(play: CardPlayFrame, aggravated: boolean): void {
    const cf = this.requireCombat();
    cf.autoPreventAfterFirst[this.sideOf(cf, play.minion)] = aggravated ? "all" : "nonAgg";
  }

  /** "This combat, frenzy cards cannot be used on this vampire; cancel
   *  the effects of frenzy cards that have already been used on this
   *  vampire this combat" (Tranquility Shield).
   *
   * The cancel is a removal of TAGGED effects, not a general undo: the
   * two ops that aim a frenzy card at the other combatant record that
   * they did, and this clears exactly those. §6
   */
  shieldFromFrenzy(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.frenzyImmune[side] = true;
    if (cf.frenzyRestrict[side]) {
      cf.restrict[side] = { maneuver: false, press: false, equipment: false };
      cf.frenzyRestrict[side] = false;
    }
    const me = side === "acting" ? cf.acting : cf.opposing;
    cf.playCostMods = cf.playCostMods.filter((m) => !(m.fromFrenzy && m.minionId === me));
  }

  /** "…and can prevent 1 damage" (Obedient Flesh) — a credit spent in the
   *  damage-resolution step, not prevention applied now. */
  grantPreventCredit(play: CardPlayFrame, amount: number): void {
    const cf = this.requireCombat();
    cf.preventCredits[this.sideOf(cf, play.minion)] += amount;
  }

  grantManeuverCredit(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.maneuverCredits[side] += 1;
  }

  grantCloseManeuver(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    cf.closeManeuvers[this.sideOf(cf, play.minion)] += 1;
  }

  preventDamage(play: CardPlayFrame, amount: number): void {
    const cf = this.requireCombat();
    const pd = cf.pendingDamage[0];
    if (!pd) throw new Error("no damage to prevent");
    if (pd.minion !== play.minion) {
      throw new Error("only the minion taking damage may prevent it");
    }
    this.emit({ type: "DamagePrevented", minion: pd.minion, amount });
    pd.amount -= amount;
    if (pd.amount <= 0) {
      // Fully prevented — nothing left to mend.
      cf.pendingDamage.shift();
    }
  }

  /**
   * "Prevent N damage to a minion or retainer in combat" (Martyr's
   * Resilience, Touch of Valeren superior) — prevention aimed at a NAMED
   * victim, played by a vampire who is not in the combat at all.
   *
   * `preventDamage` above insists the preventer IS the victim, which is
   * right for an ordinary combat card and wrong for these; this one names
   * the victim instead and no-ops if that minion has nothing pending.
   * docs/outside-combat-design.md §3
   */
  preventDamageFor(minion: MinionId, amount: number): void {
    const cf = this.requireCombat();
    const idx = cf.pendingDamage.findIndex((p) => p.minion === minion);
    if (idx < 0) return;
    const pd = cf.pendingDamage[idx]!;
    const prevented = Math.min(amount, pd.amount);
    this.emit({ type: "DamagePrevented", minion: pd.minion, amount: prevented });
    pd.amount -= prevented;
    if (pd.amount <= 0) cf.pendingDamage.splice(idx, 1);
  }

  /** "End a combat involving another minion you control" (Saulot's
   *  Guiding Wisdom) — ended from OUTSIDE, by a minion not in it. */
  endCombatFromOutside(): void {
    const cf = this.combatFrame();
    if (!cf) return;
    // The same landing a "strike: combat ends" uses: End of Round still
    // runs (p. 32), so this jumps to that step rather than popping.
    cf.endedPrematurely = true;
    cf.step = "endOfRound";
    cf.cycle = newCycle(cf.cycle.order);
  }

  grantPress(play: CardPlayFrame): void {
    const cf = this.requireCombat();
    const side = this.sideOf(cf, play.minion);
    cf.presses[side] += 1;
    if (play.minion) {
      this.emit({ type: "PressGranted", minion: play.minion });
    }
  }

  /** A successful equip/employ attaches the card; a successful recruit
   *  makes the ally a minion with its card text self-attached (p. 20,
   *  p. 22). Returns true if the card entered play (i.e. is not burned). */
  private enterPermanentFromAction(af: ActionFrame): boolean {
    if (!af.card) return false;
    const handler = this.handler(af.card.instance.name);
    if (handler.becomesVampireOnSuccess) {
      // "Put this card in play. It becomes a 1-capacity vampire" — the
      // ally machinery with `kind: "vampire"`. Its own card rides as a
      // SELF-attached entry, which is what files the CARD in the ash heap
      // when the vampire is burned (p. 16); without it the card would
      // vanish. docs/token-vampire-design.md §2
      const actor = findMinion(this.state, af.acting);
      const token = handler.becomesVampireOnSuccess(af.card.mode, actor);
      if (token) {
        const card = af.card.instance;
        this.emit({
          type: "VampireTokenEnteredPlay",
          seat: af.actingSeat,
          minion: card.id,
          cardId: card.id,
          name: card.name,
          capacity: token.capacity,
          clan: token.clan,
          sect: token.sect,
        });
        this.emit({
          type: "PermanentEnteredPlay",
          seat: af.actingSeat,
          cardId: card.id,
          name: card.name,
          attachedTo: card.id,
          statics: {},
          tags: ["vampire"],
        });
        this.notifyEnterPlay(card.id);
        return true;
      }
    }
    // Null means THIS MODE does not put the card in play, even though
    // another mode of the same card does — so fall through to the
    // remaining clauses, and failing those the card burns as normal.
    const inPlayEntry = handler.putsInPlayOnSuccess?.(af.card.mode) ?? null;
    if (inPlayEntry) {
      // "Put this card in play with N counters" (Under Siege) — a seat-level
      // permanent, not attached, not burned.
      const entry = inPlayEntry;
      const ev: Extract<GameEvent, { type: "PermanentEnteredPlay" }> = {
        type: "PermanentEnteredPlay",
        seat: af.actingSeat,
        cardId: af.card.instance.id,
        name: af.card.instance.name,
        attachedTo: null,
        statics: entry.statics ?? {},
        tags: entry.tags,
      };
      if (entry.counters !== undefined) ev.counters = entry.counters;
      this.emit(ev);
      return true;
    }
    if (handler.attachOnSuccess) {
      // "Put this card on this vampire" — a static self-attach, not
      // equipment (Heart of the City, Preternatural Strength). "…on a
      // MINION YOU CONTROL" (Biothaumaturgic Experiment superior) chooses
      // its bearer at announcement, and it rides in the params.
      const entry = handler.attachOnSuccess(af.card.mode);
      if (!entry) return false;
      // `params.target` is the bearer ONLY when the card names its own
      // bearer. Otherwise it belongs to another clause of the same card —
      // Tier of Souls' `target` is the minion it steals blood FROM, and
      // reading it here put the card on the victim
      // (docs/action-attachments-design.md §9).
      const chosen = entry.bearerFromTarget ? af.card.params["target"] : undefined;
      const bearer = chosen && findMinion(this.state, chosen) ? chosen : af.acting;
      this.emit({
        type: "PermanentEnteredPlay",
        seat: af.actingSeat,
        cardId: af.card.instance.id,
        name: af.card.instance.name,
        attachedTo: bearer,
        statics: entry.statics,
        tags: entry.tags,
        // "You still control this card" (p. 16). Recorded ALWAYS, not just
        // when the bearer belongs to somebody else: without it
        // `controllerOfEntry` infers the controller from the bearer, which
        // p. 16 says is wrong — and it is wrong the moment a card like
        // Phantasmagoria lands on another Methuselah's minion.
        controller: af.actingSeat,
      });
      // "Put this card on this vampire, LOCKED" (Rutor's Hand) — the
      // event already exists, so entry stays one shape.
      if (entry.locked) {
        this.emit({ type: "PermanentLocked", cardId: af.card.instance.id });
      }
      return true;
    }
    return this.enterPermanent({
      card: af.card.instance,
      handler,
      mode: af.card.mode,
      seat: af.actingSeat,
      bearer: af.acting,
      cost: handler.poolCost ?? 0,
    });
  }

  /**
   * The last step of the equip / employ / recruit pipeline, keyed on
   * (card, mode, seat, bearer) rather than on an ActionFrame — so a card
   * that says "equip this vampire with a weapon from your hand" can reach
   * it with no action wrapped around it (docs/play-from-hand-design.md §3).
   *
   * `putsInPlayOnSuccess` and `attachOnSuccess` deliberately stay on the
   * action path: both are a card putting ITSELF in play on success, which
   * is not something another card can do to a card in hand.
   */
  private enterPermanent(args: {
    card: CardInstance;
    handler: CardHandler;
    mode: DisciplineLevel | null;
    seat: SeatId;
    bearer: MinionId;
    cost: number;
  }): boolean {
    const { card, handler, mode, seat, bearer } = args;
    if (handler.isEquipment || handler.isRetainer) {
      // The mode chosen at announcement fixes which printed version
      // enters play (p. 22).
      const entry = handler.permanentEntry?.(mode) ?? {
        statics: handler.permanentStatics ?? {},
        tags: handler.permanentTags ?? [],
      };
      const ev: Extract<GameEvent, { type: "PermanentEnteredPlay" }> = {
        type: "PermanentEnteredPlay",
        seat,
        cardId: card.id,
        name: card.name,
        attachedTo: bearer,
        statics: entry.statics,
        tags: entry.tags,
      };
      if (entry.life !== undefined) {
        ev.life = entry.life + startingLifeBonus(this.state, seat, entry.tags);
      }
      this.emit(ev);
      this.notifyEnterPlay(card.id);
      return true;
    }
    if (handler.isAlly && handler.allyEntry) {
      // The ally becomes a minion in the ready region with its life from
      // the blood bank, unable to act this turn (p. 22). Its own card
      // text rides along as a self-attached entry so statics/abilities
      // reuse the permanent machinery.
      const ally = handler.allyEntry(mode);
      this.emit({
        type: "AllyEnteredPlay",
        seat,
        minion: card.id,
        cardId: card.id,
        name: card.name,
        // "Zombies you recruit get +1 starting life" (Ashur-uballit).
        // Read from the ARRIVING card's tags: the minion does not exist
        // yet, and its own entry is emitted below this.
        life: ally.life + startingLifeBonus(this.state, seat, ally.tags),
        strength: ally.strength,
        bleed: ally.bleed,
        // "This ally can perform actions the turn it is recruited"
        // (Spectral Servitor) — the exemption from p. 22, which the
        // applier otherwise reads straight off this flag.
        recruited: ally.actsWhenRecruited !== true,
        cost: args.cost,
        ...(ally.disciplines ? { disciplines: ally.disciplines } : {}),
      });
      this.emit({
        type: "PermanentEnteredPlay",
        seat,
        cardId: card.id,
        name: card.name,
        attachedTo: card.id,
        statics: ally.statics,
        tags: ally.tags,
      });
      // The equipment/retainer path above has always fired this; the ALLY
      // path never did, so `onEnterPlay` — documented as firing from both
      // entry paths — was silently dead for every ally. Rotting Behemoth's
      // "after this ally enters play…" is the first card to need it.
      this.notifyEnterPlay(card.id);
      return true;
    }
    return false;
  }

  /** Can ANY seat play something in the after-resolution window? The
   *  window is opened only then — an unconditional impulse after every
   *  action would be a decision per seat per action for the whole game
   *  (docs/after-resolution-design.md §3). */
  /**
   * Does any seat have something to play in this window? Both probes ask
   * cards in HAND and cards IN PLAY — the ability half was missing, so a
   * window whose only user was a location (Cappadocian Crypt) would never
   * have opened. That is the recurring failure of a question asked in two
   * places where only one learns about a new case, so the two probes now
   * share one body. docs/blood-locations-design.md §5
   */
  private anyPlayIn(window: WindowId): boolean {
    return this.state.seats.some(
      (s) =>
        !s.ousted &&
        (this.handlerOptions(s.id, window).length > 0 ||
          this.abilityOptionsFor(s.id, window).length > 0),
    );
  }

  /** The referendum sibling of `anyAfterResolutionPlay`. */
  private anyAfterReferendumPlay(): boolean {
    return this.anyPlayIn("referendum.afterResolution");
  }

  private anyAfterResolutionPlay(): boolean {
    return this.anyPlayIn("action.afterResolution");
  }

  /** "\<This vampire\> can burn N blood to unlock … after action
   *  resolution" — registered when the modifier resolves, offered when the
   *  action does. docs/wraith-zombie-design.md §4 */
  addAfterResolutionUnlock(entry: {
    payer: MinionId;
    target: MinionId;
    blood: number;
    ifSuccessful?: boolean;
    cardName: string;
    cardId: CardInstanceId;
  }): void {
    const af = this.action();
    if (!af) return;
    af.afterResolutionUnlocks = [...(af.afterResolutionUnlocks ?? []), entry];
  }

  private resolveAction(af: ActionFrame, success: boolean): void {
    this.deferChoices = true;
    try {
      this.resolveActionInner(af, success);
      // The offers registered above. Raised here, they are QUEUED (the
      // action is resolving) and flushed the instant it is over, which is
      // exactly "after action resolution" — no new window, and no change
      // to the after-resolution probe, which only sees cards.
      for (const u of af.afterResolutionUnlocks ?? []) {
        if (u.ifSuccessful && !success) continue;
        const payer = findMinion(this.state, u.payer);
        const target = findMinion(this.state, u.target);
        // Both can have left play, and an unlocked target has nothing to
        // gain — the offer is simply not made.
        if (!payer || !target || payer.blood < u.blood || !target.locked) continue;
        this.raiseChoice({
          seat: payer.controller,
          cardName: u.cardName,
          cardId: u.cardId,
          key: "unlockAfterResolution",
          params: { payer: u.payer, target: u.target },
          optional: true,
        });
      }
    } finally {
      this.deferChoices = false;
      // The action frame (and anything it pushed) is settled; now the
      // questions it raised can be asked, in the order they were raised.
      const queued = this.deferredChoices;
      this.deferredChoices = [];
      for (const c of queued) this.raiseChoice(c);
    }
  }

  /** Spend the counters this action announced it would pay with, and
   *  report what they covered (docs/cost-sources-design.md §4). The spend
   *  clamps to what is actually on the card now — a source that lost its
   *  counters in between just pays less, and the rest comes out of blood
   *  and pool as normal. */
  private spendCostCounters(af: ActionFrame): { blood: number; pool: number } {
    const paid = { blood: 0, pool: 0 };
    for (const want of af.costFromCards ?? []) {
      const entry = this.findEntry(want.cardId);
      if (!entry?.costSource) continue;
      const available = entry.counters ?? 0;
      const spend = Math.min(available, want.blood + want.pool);
      if (spend <= 0) continue;
      // Blood first: no card in the pool pays both at once, and the split
      // only matters for which side of the cost it reduces.
      paid.blood += Math.min(spend, want.blood);
      paid.pool += Math.max(0, spend - want.blood);
      this.addCounters(want.cardId, -spend);
      // "…can lock this location to use those counters" (Ravnos Cache).
      if (entry.costSource.locks && !entry.locked) this.lockPermanent(want.cardId);
      // "If this location has no counters, burn it" (Ravnos Carnival).
      if (entry.costSource.burnWhenEmpty && (entry.counters ?? 0) <= 0) {
        this.burnPermanent(want.cardId);
      }
    }
    return paid;
  }

  /**
   * Everything an action does when it SUCCEEDS: pay the cost, put a
   * permanent into play, run the card's own effects, and take the
   * bleed/hunt/leave-torpor/rescue/diablerie branch.
   *
   * Split out of `resolveActionInner` so it has a second caller: "continue
   * the action as if unblocked" (Go-getter superior) has to run exactly
   * these effects and NOT the tail below, which has already happened for a
   * blocked action — the card is burned, the block penalties are paid, the
   * replacement draws are done (docs/ledger-closeout.md §11).
   *
   * One function with two callers rather than two copies of the rule: the
   * alternative was a second, drifting definition of what success does.
   */
  private applySuccessEffects(af: ActionFrame): boolean {
    let entered = false;
    {
      // The action's cost is paid at resolution, only on success (p. 27).
      if (af.card) {
        const handler = this.handler(af.card.instance.name);
        // "…can use those counters to pay some or all of the cost": what
        // the counters cover never reaches the minion or the pool
        // (docs/cost-sources-design.md §4).
        const paid = this.spendCostCounters(af);
        // The live cost, not the printed one — an action card's cost is
        // paid HERE, so a modifier in force now is the one that applies.
        const variant = af.card.params["variant"];
        const price = this.priceOf(
          handler,
          af.card.mode,
          variant,
          findMinion(this.state, af.acting),
        );
        this.consumeOncePlayCostMods(handler, af.card.mode, variant);
        const blood = Math.max(0, price.blood - paid.blood);
        const pool = Math.max(0, price.pool - paid.pool);
        if (blood > 0) {
          this.emit({ type: "BloodBurned", minion: af.acting, amount: blood });
        }
        if (pool > 0) {
          this.emit({ type: "PoolBurned", seat: af.actingSeat, amount: pool });
        }
      }
      if (af.actionKind === "bleed" && af.target !== null) {
        const bleed = currentBleed(this.state, af);
        if (bleed > 0) {
          this.emit({ type: "PoolBurned", seat: af.target, amount: bleed });
        }
        if (bleed >= 1) {
          // Successful bleed of 1+ → the acting minion's controller takes
          // the Edge, whoever the final target is (p. 21; FAQ p. 46).
          this.emit({ type: "EdgeTaken", seat: af.actingSeat });
          // "Burn 2 of your corruption from a minion of the target to
          // unlock" (Revelation of the Serpent) — auto-taken if affordable.
          for (const cu of af.corruptionUnlocks) {
            const target = af.target;
            if (target === null) continue;
            const victim = getSeat(this.state, target).minions.find(
              (mm) => (mm.corruption?.[cu.seat] ?? 0) >= 2,
            );
            if (victim) {
              this.emit({ type: "CorruptionChanged", minion: victim.id, seat: cu.seat, delta: -2 });
              this.emit({ type: "MinionUnlocked", minion: cu.minion });
            }
          }
          // Cards triggered by a successful bleed (Alamut, Gostoso).
          // `allEntries()`, not `seat.permanents`: this loop read only
          // seat-level cards, which was invisible while every user was a
          // LOCATION and wrong the moment one sat on a vampire. That is
          // the same bug `onAnyUnlock` had before Fame found it
          // (docs/pool-drain-design.md), and it made Gostoso's hook dead.
          const info = { actingMinion: af.acting, actingSeat: af.actingSeat, target: af.target, amount: bleed };
          for (const { entry, owner } of this.allEntries()) {
            this.registry[entry.card.name]?.onBleedSuccess?.(entry, owner, info, this);
          }
        }
      } else if (af.actionKind === "hunt") {
        // Hunt amount 1 by default (p. 21), plus any "+N hunt" aura (The
        // Hungry Coyote); excess over capacity drains.
        const hunter = findMinion(this.state, af.acting);
        this.emit({
          type: "BloodGained",
          minion: af.acting,
          amount: hunter ? huntAmountFor(this.state, hunter) : 1,
        });
        // Cards triggered by a successful hunt (The Anarch Free Press).
        // The mirror of onBleedSuccess above; reaching this branch IS the
        // success, since a blocked hunt never resolves.
        const huntInfo = { actingMinion: af.acting, actingSeat: af.actingSeat };
        for (const s of this.state.seats) {
          for (const p of [...s.permanents]) {
            this.registry[p.card.name]?.onHuntSuccess?.(p, { seat: s.id, minion: null }, huntInfo, this);
          }
        }
      } else if (af.actionKind === "leaveTorpor") {
        // Cost (2 blood) is paid at resolution, only on success (p. 24,
        // p. 27); the vampire is no longer wounded.
        this.emit({ type: "BloodBurned", minion: af.acting, amount: 2 });
        this.emit({ type: "LeftTorpor", minion: af.acting });
      } else if (af.actionKind === "rescue" && af.targetMinion) {
        // The 2-blood cost, split as fixed at announcement (p. 23) — the
        // exception to paying with the vampire's own resources.
        const split = af.rescueSplit ?? { fromActor: 2, fromVictim: 0 };
        const actorM = findMinion(this.state, af.acting);
        const victimM = findMinion(this.state, af.targetMinion);
        const { discount, bonusBlood } =
          actorM && victimM
            ? rescueDiscountFor(actorM, victimM)
            : { discount: 0, bonusBlood: 0 };
        const actorPays = Math.max(0, split.fromActor - discount);
        if (actorPays > 0) {
          this.emit({ type: "BloodBurned", minion: af.acting, amount: actorPays });
        }
        if (split.fromVictim > 0) {
          this.emit({ type: "BloodBurned", minion: af.targetMinion, amount: split.fromVictim });
        }
        // The rescued vampire moves to the ready region, no longer
        // wounded, and does NOT change lock state (p. 23).
        this.emit({ type: "LeftTorpor", minion: af.targetMinion });
        // "…and if the action is successful, the rescued vampire gains 1
        // blood" — after they are out of torpor.
        if (bonusBlood > 0) {
          this.emit({ type: "BloodGained", minion: af.targetMinion, amount: bonusBlood });
        }
      } else if (af.actionKind === "diablerize" && af.targetMinion) {
        // Cost none (p. 24). The diablerie resolution + blood hunt run
        // after the action frame pops (below), so the referendum sits
        // alone on top of the stack.
      }
      // A granted action's own cost ("…that costs 2 pool"), paid at
      // resolution and only on success (p. 27).
      if (af.grantedCost) {
        if (af.grantedCost.blood) {
          this.emit({
            type: "BloodBurned",
            minion: af.acting,
            amount: af.grantedCost.blood,
          });
        }
        if (af.grantedCost.pool) {
          this.emit({
            type: "PoolBurned",
            seat: af.actingSeat,
            amount: af.grantedCost.pool,
          });
        }
      }
      // A granted action that is not a rush: its effect belongs to the
      // card that granted it (docs/granted-actions-design.md §4.2). If the
      // granting card left play mid-action, the effect simply does not
      // happen — the same rule the rush branch applies to a lost target.
      if (af.grantedEffect) {
        const found = this.findEntry(af.grantedEffect.cardId);
        if (found) {
          this.registry[af.grantedEffect.cardName]?.resolveGrantedAction?.(
            found,
            af,
            this,
          );
        }
      }
      // Equipment/retainers attach and allies enter play first, so
      // resolveCardAction sees them in play ("after this ally enters
      // play…" riders, War Ghoul).
      if (af.card) entered = this.enterPermanentFromAction(af);
      // The card's own resolution effect (e.g. Govern superior).
      if (af.card) {
        this.handler(af.card.instance.name).resolveCardAction?.(af, this);
      }
    }
    return entered;
  }

  private resolveActionInner(af: ActionFrame, success: boolean): void {
    let entered = success ? this.applySuccessEffects(af) : false;
    // "They burn 1 blood before action resolution" unless they blocked
    // (Forced Awakening) — applies whether the action succeeded or not.
    // "…become locked BEFORE ACTION RESOLUTION" (Faceless Night). p. 48:
    // they lock "only once the action resolves, either because it is
    // successful, or because it is blocked" — so here, whichever way it
    // went, and never before.
    for (const id of af.failedBlockersToLock ?? []) {
      const m = findMinion(this.state, id);
      if (m && !m.locked) this.emit({ type: "MinionLocked", minion: id });
    }
    for (const p of af.notBlockPenalties) {
      if (af.blockedBy !== p.minion) {
        // A seat-charged penalty bills a Methuselah's pool instead of the
        // minion's blood (WMRH Talk Radio); the minion still names whose
        // failure to block triggers it.
        if (p.seat) this.emit({ type: "PoolBurned", seat: p.seat, amount: p.amount });
        else this.emit({ type: "BloodBurned", minion: p.minion, amount: p.amount });
      }
    }
    // "If this vampire did not block this action, lock / attach it"
    // (Dogged Pursuit) — for any forced-block minion that is not the
    // successful blocker and is still in play.
    for (const p of af.blockPenalties) {
      if (af.blockedBy === p.minion) continue;
      const m = findMinion(this.state, p.minion);
      if (!m || !isReady(m)) continue;
      if (p.kind === "lock") {
        this.emit({ type: "MinionLocked", minion: p.minion });
      } else {
        this.emit({
          type: "PermanentEnteredPlay",
          seat: m.controller,
          cardId: p.cardId,
          name: p.cardName,
          attachedTo: p.minion,
          statics: {},
          tags: [p.cardName, "did-not-block"],
        });
      }
    }
    // A title-granting political action holds its card aside until the
    // referendum resolves (attach on pass, burn on fail) — not burned now.
    if (af.card && success && this.handler(af.card.instance.name).holdsCardForReferendum) {
      entered = true;
    }
    // The same "held aside, not burned yet" treatment for a rush whose
    // payoff may put the card itself into play once the combat is over
    // (Pillars Fall). `applyOutcomeRider` burns it if the condition misses
    // or the player declines. docs/rush-outcome-design.md §2
    if (
      af.card &&
      success &&
      af.combatOutcome?.kind === "outcome" &&
      af.combatOutcome.effect.kind === "attachToActor"
    ) {
      entered = true;
    }
    if (af.card && !entered) {
      // The action card is burned at resolution — successful or blocked
      // (p. 27). It was already out of hand (set aside at announcement).
      this.emit({
        type: "CardBurned",
        cardId: af.card.instance.id,
        name: af.card.instance.name,
        seat: af.actingSeat,
      });
    }
    this.emit({ type: "ActionResolved", actionId: af.actionId, success });
    // Cards that answer an action having resolved (the archetypes). Fired
    // with the frame still on the stack, so a handler can still read what
    // was played during it (docs/archetypes-design.md §3).
    this.notifyActionResolved(af, success);
    // "After action resolution, if that action was SUCCESSFUL, unlock the
    // acting Nosferatu" (Warsaw Station) — unlike notBlockPenalties above,
    // this one is conditional on the outcome.
    if (success) {
      for (const id of af.unlockOnSuccess) {
        const m = findMinion(this.state, id);
        if (m?.locked) this.emit({ type: "MinionUnlocked", minion: id });
      }
    }
    // "This vampire takes N unpreventable environmental aggravated damage
    // after action resolution" (Daring the Dawn) — no combat, so no
    // prevention window: it resolves straight away.
    for (const d of af.afterResolutionDamage) {
      const victim = findMinion(this.state, d.minion);
      if (!victim) continue;
      // "…can burn N blood to be IMMUNE to this damage" (Rutor's Hand
      // superior). The question has to precede the damage, so the frame is
      // raised INSTEAD of inflicting and the card's `applyChoice` does one
      // or the other. Offered only when the price can actually be paid —
      // an unaffordable offer is not a choice
      // (docs/ledger-closeout.md §10).
      if (d.optOut && victim.blood >= d.optOut.blood) {
        this.raiseChoice({
          seat: victim.controller,
          cardName: d.optOut.cardName,
          cardId: d.optOut.cardId,
          key: "damageOptOut",
          params: {
            minion: d.minion,
            amount: String(d.amount),
            aggravated: d.aggravated ? "1" : "",
            blood: String(d.optOut.blood),
          },
          optional: false,
        });
        continue;
      }
      this.applyEnvironmentalDamage(d.minion, d.amount, d.aggravated);
    }
    // "Do not replace until after this action" comes due now.
    for (const seatId of af.drawAfter) this.drawToReplace(seatId);
    // "Only usable AFTER ACTION RESOLUTION" (Freak Drive and its family):
    // an impulse before the frame leaves the stack, so a card can still
    // read what the action was and how it went. Opened only when some seat
    // can actually use it — a recorded deviation, the same one already
    // taken for combat.damageResolution (docs/after-resolution-design.md §3).
    af.resolvedSuccess = success;
    if (af.step !== "afterResolution") {
      // The step has to be set BEFORE probing: a card's own usable rule
      // asserts it is in this window, so asking first would always answer
      // "nobody can play anything". Set it, ask, and put it back if the
      // window would be empty.
      const previous = af.step;
      af.step = "afterResolution";
      if (this.anyAfterResolutionPlay()) {
        cycleRewind(af.cycle);
        return;
      }
      af.step = previous;
    }
    this.finishAction(af, success);
  }

  /**
   * "This vampire burns 1 blood to CONTINUE THE ACTION AS IF UNBLOCKED"
   * (Go-getter superior).
   *
   * The `action.afterResolution` window is the only place it can be played
   * — p. 27 puts the block's combat INSIDE resolution — and by then the
   * action's tail has run: the card is burned, the block penalties are
   * paid, the replacement draws are done. So continuing runs the SUCCESS
   * EFFECTS ONLY, through `applySuccessEffects`, the same function the
   * ordinary path calls. The tail is simply not in the function being
   * called twice, which is what makes a "tail already run" guard
   * unnecessary (docs/ledger-closeout.md §11).
   *
   * The flag is cleared BEFORE it is acted on, so a second Go-getter
   * played into any window this re-opens cannot loop.
   */
  private continueActionUnblocked(af: ActionFrame): void {
    af.continueUnblocked = false;
    af.blockedBy = null;
    this.emit({ type: "ActionContinued", actionId: af.actionId, acting: af.acting });
    this.applySuccessEffects(af);
    // Cards keyed on "after a SUCCESSFUL action" read this.
    af.resolvedSuccess = true;
    this.finishAction(af, true);
  }

  /**
   * Everything that happens once the action frame is done with: wake
   * expiry, the pop, and the frames it queued. Split out of
   * `resolveActionInner` so the after-resolution window can sit between
   * the two (docs/after-resolution-design.md §2).
   */
  private finishAction(af: ActionFrame, success: boolean): void {
    // Wake effects last "for the duration of the action" (p. 44).
    for (const seat of this.state.seats) {
      for (const m of seat.minions) m.awake = false;
    }
    this.pop();
    // "Lock this vampire and the blocking minion, and queue a combat
    // between them" (Hedonism). Queued, not entered: the action it was
    // played into had to finish first, so this waits until the frame is
    // off the stack — the same place a political action pushes its
    // referendum. Checked HERE rather than when the card was played:
    // either minion can be burned or sent to torpor in between, and a
    // combat then simply does not happen.
    for (const q of af.queuedCombats) {
      const a = findMinion(this.state, q.a);
      const b = findMinion(this.state, q.b);
      if (!a || !b || !isReady(a) || !isReady(b)) continue;
      this.pushCombat(a.id, a.controller, b.id, b.controller, null, false, q.outcome ?? null);
    }
    // A successful political action calls its referendum (p. 27) — the
    // terms are chosen only now, the one exception to
    // details-at-announcement (p. 25).
    // The source is either the political action card itself, or a card in
    // play that granted the action ("vampires can call a referendum to
    // burn this card") — which has no `af.card` at all, so the old gate
    // could never see it (docs/pool-drain-design.md §6).
    const refSource =
      af.referendumSource ??
      (af.card && this.handler(af.card.instance.name).isPoliticalAction
        ? { cardName: af.card.instance.name, cardInstanceId: af.card.instance.id }
        : null);
    if (success && refSource) {
      const cardName = refSource.cardName;
      this.emit({
        type: "ReferendumCalled",
        actionId: af.actionId,
        seat: af.actingSeat,
        cardName,
      });
      const refFrame: ReferendumFrame = {
        kind: "referendum",
        actionId: af.actionId,
        caller: af.actingSeat,
        cardName,
        cardInstanceId: refSource.cardInstanceId,
        variant: "political",
        ...(refSource.fromCardInPlay ? { fromCardInPlay: true } : {}),
        bloodHuntTarget: null,
        callingMinion: af.acting,
        voteGrants: {},
        step: "terms",
        terms: {},
        votes: [],
        usedSources: [],
        cycle: newCycle(sequencingOrder(this.state, af.actingSeat, [])),
      };
      // "The FIRST referendum a SABBAT vampire you control calls on this
      // turn passes automatically" (Día de los Muertos) — consumed here,
      // so a second referendum the same turn polls normally.
      const callerSeat = getSeat(this.state, af.actingSeat);
      const caller = findMinion(this.state, af.acting);
      if (callerSeat.autoPassReferendum && caller?.sect === "sabbat") {
        callerSeat.autoPassReferendum = false;
        refFrame.autoPass = true;
      }
      this.state.frames.push(refFrame);
      // A card may seed per-seat bonus votes for this referendum ("each
      // Malkavian gets +1 vote", p. 28) before polling begins.
      this.handler(cardName).referendumSetup?.(refFrame, this.state);
    }
    // A successful diablerise commits the diablerie (blood + burn) and
    // conducts the blood-hunt referendum — after the frame pops so the
    // referendum sits alone on top.
    if (success && af.actionKind === "diablerize" && af.targetMinion) {
      const actor = findMinion(this.state, af.acting);
      const victim = findMinion(this.state, af.targetMinion);
      if (actor && isReady(actor) && victim && victim.inTorpor) {
        this.commitDiablerie(af.acting, af.targetMinion);
      }
    }
    // A successful rush enters combat with its target — if the target is
    // still ready; the target does NOT lock (only blockers lock, p. 27).
    // Pushed after the action frame pops so combat sits alone on top.
    // Only rush (a cardEffect action) starts combat on success; diablerise
    // and rescue also carry a targetMinion but resolve differently, and so
    // does a granted action that merely targets a minion without entering
    // combat (Cave of Apples' corruption placement) — or a card from HAND
    // that names a minion only for directedness (Mind Numb). That second
    // opt-out did not exist: `grantedEffect` is null for every hand play,
    // so a stun would have rushed its victim (docs/stun-design.md §6).
    const rushLike =
      !af.noCombatOnSuccess &&
      (af.grantedEffect === null || af.grantedEffect.key === "enterCombat");
    if (success && af.actionKind === "cardEffect" && af.targetMinion && rushLike) {
      const actor = findMinion(this.state, af.acting);
      const target = findMinion(this.state, af.targetMinion);
      if (actor && isReady(actor) && target && isReady(target)) {
        // "The target vampire is considered the ACTING MINION during that
        // combat" (Deep Song superior): the inversion is these two pairs
        // in the other order, because every "who is acting" question in a
        // combat reads `cf.acting` (docs/last-buildable-design.md §3).
        // "…and LOCK a vampire" — before the combat, so the frame opens
        // with the target already locked.
        if (af.lockTargetOnSuccess && !target.locked) {
          this.emit({ type: "MinionLocked", minion: target.id });
        }
        const [a, aSeat, b, bSeat] = af.invertCombatRoles
          ? ([target.id, target.controller, af.acting, af.actingSeat] as const)
          : ([af.acting, af.actingSeat, target.id, target.controller] as const);
        this.pushCombat(
          a,
          aSeat,
          b,
          bSeat,
          af.rushRiders,
          false, // a rush combat — the target did not block
          af.combatOutcome,
        );
      } else if (
        af.card &&
        af.combatOutcome?.kind === "outcome" &&
        af.combatOutcome.effect.kind === "attachToActor"
      ) {
        // The combat never happened (a combatant left play between
        // resolution and here), so the rider that would have burned the
        // held-aside card never runs. Burn it now, or it vanishes.
        this.emit({
          type: "CardBurned",
          cardId: af.card.instance.id,
          name: af.card.instance.name,
          seat: af.actingSeat,
        });
      }
    }
  }

  // -- decision building ----------------------------------------------------

  decision(): DecisionPoint | null {
    this.settle();
    const top = this.top();
    if (!top) return null;

    switch (top.kind) {
      case "turn":
        return this.turnDecision(top);
      case "action": {
        const window: WindowId =
          top.step === "announce"
            ? "action.announce"
            : top.step === "afterResolution"
              ? "action.afterResolution"
              : "action.effects";
        const seat = cycleSeat(top.cycle);
        return this.dp(seat, window, [
          passOption(),
          ...this.handlerOptions(seat, window),
          ...this.abilityOptionsFor(seat, window),
          // The action is over: nobody is blocking it any more.
          ...(top.step === "afterResolution" ? [] : this.blockOptions(top, seat)),
        ]);
      }
      case "blockAttempt": {
        const seat = cycleSeat(top.cycle);
        return this.dp(seat, "action.effects", [
          passOption(),
          ...this.cancelBlockOptions(top, seat),
          ...this.burnForInterceptOptions(top, seat),
          ...this.handlerOptions(seat, "action.effects"),
          ...this.abilityOptionsFor(seat, "action.effects"),
        ]);
      }
      case "cardPlay": {
        const seat = cycleSeat(top.cycle);
        return this.dp(seat, "card.asPlayed", [
          passOption(),
          ...this.payToCancelOptions(top, seat),
          ...this.handlerOptions(seat, "card.asPlayed"),
          // Cards IN PLAY that are themselves cancels (Meditative Grove).
          // `abilityOptionsFor` admits only handlers that opt in here.
          ...this.abilityOptionsFor(seat, "card.asPlayed"),
        ]);
      }
      case "combat":
        return this.combatDecision(top);
      case "referendum": {
        if (top.step === "terms") {
          // settle() guarantees at least one term option here.
          const terms =
            this.handler(top.cardName).referendumTerms?.(top, this.state) ?? [];
          return this.dp(top.caller, "referendum.terms", terms);
        }
        const seat = cycleSeat(top.cycle);
        if (top.step === "afterResolution") {
          // The vote is over: no more vote sources, only the cards that
          // answer a passed referendum.
          return this.dp(seat, "referendum.afterResolution", [
            passOption(),
            ...this.handlerOptions(seat, "referendum.afterResolution"),
            ...this.abilityOptionsFor(seat, "referendum.afterResolution"),
          ]);
        }
        return this.dp(seat, "referendum.polling", [
          passOption("Done voting"),
          ...this.pollingOptions(top, seat),
          // Vote-granting cards and location abilities (p. 28).
          ...this.handlerOptions(seat, "referendum.polling"),
          ...this.abilityOptionsFor(seat, "referendum.polling"),
        ]);
      }
      case "choice": {
        // One seat answers, immediately; no impulse cycle (design §3).
        const opts = this.choiceOptionsFor(top);
        return this.dp(top.seat, "choice", [
          ...opts,
          ...(top.optional ? [passOption("Decline")] : []),
        ]);
      }
      case "diablerieOffer": {
        const victim = getMinion(this.state, top.victim);
        const diablerist = getMinion(this.state, top.diablerist);
        return this.dp(top.offerSeat, "diablerie.offer", [
          {
            id: `diablerize:offer:${top.diablerist}:${top.victim}`,
            kind: "diablerizeOffer",
            label: `${diablerist.name}: diablerise ${victim.name}`,
          },
          passOption("Decline diablerie"),
        ]);
      }
    }
  }

  private dp(seat: SeatId, window: WindowId, options: LegalOption[]): DecisionPoint {
    return { seq: this.state.decisionSeq, seat, window, options };
  }

  private turnDecision(tf: TurnFrame): DecisionPoint {
    switch (tf.phase) {
      case "unlock": {
        // Reachable when this seat holds the Edge or has unlock-phase
        // permanent abilities (Vessel) — then other seats with "during
        // any Methuselah's unlock phase" abilities (Homunculus).
        const edgeNeeded = this.state.edge === tf.seat && !tf.edgeDone;
        const ownAbilities = tf.unlockAbilitiesDone
          ? []
          : this.abilityOptionsFor(tf.seat, "turn.unlock");
        // "Announce your intent to withdraw during your unlock phase"
        // (p. 38). Offered only while it is actually available, so a
        // player is never shown a button that cannot work.
        const mayWithdraw = this.canAnnounceWithdrawal(tf.seat) && !tf.unlockAbilitiesDone;
        if (edgeNeeded || ownAbilities.length > 0 || mayWithdraw) {
          const options: LegalOption[] = [];
          if (mayWithdraw) {
            options.push({
              id: "withdraw",
              kind: "announceWithdrawal",
              label: "Announce a withdrawal from the game",
            });
          }
          if (edgeNeeded) {
            options.push({
              id: "edge:gain",
              kind: "gainEdgePool",
              label: "Gain 1 pool from the Edge",
            });
          }
          options.push(...ownAbilities);
          options.push(passOption("End unlock phase"));
          return this.dp(tf.seat, "turn.unlock", options);
        }
        const other = this.nextUnlockAbilitySeat(tf);
        if (other === null) throw new Error("unlock decision with nothing to decide");
        return this.dp(other, "turn.unlock", [
          ...this.abilityOptionsFor(other, "turn.unlock"),
          passOption("Decline"),
        ]);
      }
      case "master":
        return this.dp(tf.seat, "turn.master", [
          passOption("End master phase"),
          // Master cards are only offered while an action remains;
          // in-play abilities (Blood Doll, The Barrens) are free.
          ...(tf.masterActionsLeft > 0
            ? this.handlerOptions(tf.seat, "turn.master")
            : []),
          ...this.abilityOptionsFor(tf.seat, "turn.master"),
        ]);
      case "minion":
        return this.dp(tf.seat, "turn.minion", this.minionPhaseOptions(tf));
      case "influence":
        return this.dp(tf.seat, "turn.influence", [
          ...this.influenceOptions(tf),
          ...this.abilityOptionsFor(tf.seat, "turn.influence"),
        ]);
      case "discard": {
        const options: LegalOption[] = [passOption("End discard phase")];
        // "You receive by default one discard phase action… Discard phase
        // actions not used are lost" (p. 37) — one discard unless an
        // effect granted more (Powerbase: Los Angeles).
        if ((tf.discardActionsLeft ?? 1) > 0) {
          for (const card of getSeat(this.state, tf.seat).hand) {
            options.push({
              id: `discard:${card.id}`,
              kind: "discard",
              label: `Discard ${card.name}`,
              card: card.id,
            });
          }
        }
        // "…can burn 1 blood during your next discard phase to unlock"
        // (Fiendish Tongue). A built-in, because the card that granted it
        // was burnt at resolution and there is nothing in play to enumerate
        // from. It does NOT consume the discard phase action: the card does
        // not say "discard phase action" (docs/last-buildable-design.md §1).
        for (const m of getSeat(this.state, tf.seat).minions) {
          if (!m.discardPhaseUnlock || !m.locked || !isReady(m) || m.blood < 1) continue;
          options.push({
            id: `unlock:discard:${m.id}`,
            kind: "burnForUnlock",
            label: `${m.name}: burn 1 blood to unlock`,
            minion: m.id,
          });
        }
        options.push(...this.abilityOptionsFor(tf.seat, "turn.discard"));
        return this.dp(tf.seat, "turn.discard", options);
      }
    }
  }

  /** In-play activated/phase abilities available to `seat` right now.
   *  Never inside the as-played period (only cancels and wakes there,
   *  p. 7). */
  private abilityOptionsFor(seat: SeatId, window: WindowId): LegalOption[] {
    // p. 7: only cancels and wakes live in the as-played period. A card in
    // play that IS a cancel (Meditative Grove) opts in per handler — the
    // `abilityAnySeat` shape, so the default stays right and the exception
    // is greppable. docs/blood-locations-design.md §6
    const asPlayed = window === "card.asPlayed";
    const blockAttempt = this.blockAttempt();
    const ctx: PlayContext = {
      state: this.state,
      seat,
      turnSeat: this.turnSeat(),
      window,
      action: this.action(),
      blockAttempt,
      inBlockAttempt: blockAttempt !== null,
      combat: this.combatFrame(),
      pendingCard: (() => {
        const top = this.top();
        return top && top.kind === "cardPlay" ? top : null;
      })(),
      referendum: this.referendumFrame(),
      registry: this.registry,
    };
    const options: LegalOption[] = [];
    // Every seat's cards in play, not just this one's: a card can offer an
    // ability to Methuselahs who do not control it ("during any unlock
    // phase, ANY ready vampire can burn 2 blood…" — Carver's Meat
    // Packing), the same way entryActionOptionsFor enumerates granted
    // actions across seats. `owner` is always the card's own controller,
    // so a card that means "you" still compares ctx.seat to it.
    for (const s of this.state.seats) {
      if (s.ousted) continue;
      const foreign = s.id !== seat;
      for (const p of s.permanents) {
        const h = this.registry[p.card.name];
        // A card another Methuselah controls only reaches this seat if it
        // says so: abilities belong to the controller unless the card
        // opts in ("ANY ready vampire can…" — Carver's Meat Packing).
        if (foreign && !h?.abilityAnySeat) continue;
        if (asPlayed && !h?.abilityInAsPlayed) continue;
        if (h?.abilityOptions) {
          options.push(
            ...h.abilityOptions(p, { seat: p.controller ?? s.id, minion: null }, ctx),
          );
        }
      }
      for (const m of s.minions) {
        for (const p of m.attached) {
          const h = this.registry[p.card.name];
          if (foreign && !h?.abilityAnySeat) continue;
          if (asPlayed && !h?.abilityInAsPlayed) continue;
          if (h?.abilityOptions) {
            options.push(
              ...h.abilityOptions(p, { seat: p.controller ?? s.id, minion: m.id }, ctx),
            );
          }
        }
      }
    }
    return options;
  }

  /** Actions granted by cards in play, for the minion phase (rush design
   *  §2.5): each entry's handler enumerates; the engine owns announce. */
  private entryActionOptionsFor(seat: SeatId): LegalOption[] {
    const ctx: PlayContext = {
      state: this.state,
      seat,
      turnSeat: this.turnSeat(),
      window: "turn.minion",
      action: this.action(),
      blockAttempt: null,
      inBlockAttempt: false,
      combat: null,
      pendingCard: null,
      referendum: this.referendumFrame(),
      registry: this.registry,
    };
    // Every seat's cards in play are scanned, not just the acting seat's:
    // "Minions can burn this card as a Ⓓ action" is a grant from an
    // opponent's card to your minion (docs/granted-actions-design.md §4.4).
    // Each handler decides whom it grants to; `ctx.seat` is the acting
    // seat, `owner` the granting card's side.
    const options: LegalOption[] = [];
    for (const s of this.state.seats) {
      if (s.ousted) continue;
      for (const m of s.minions) {
        for (const p of m.attached) {
          const h = this.registry[p.card.name];
          if (h?.actionOptions) {
            options.push(...h.actionOptions(p, { seat: s.id, minion: m.id }, ctx));
          }
        }
      }
      for (const p of s.permanents) {
        const h = this.registry[p.card.name];
        if (h?.actionOptions) {
          options.push(...h.actionOptions(p, { seat: s.id, minion: null }, ctx));
        }
      }
    }
    return options;
  }

  /** Transfer spends per rulebook p. 36; influencing a full vampire out is
   *  free and available "at any time during this phase". */
  private influenceOptions(tf: TurnFrame): LegalOption[] {
    const seat = getSeat(this.state, tf.seat);
    const options: LegalOption[] = [passOption("End influence phase")];
    for (const u of seat.uncontrolled) {
      // Not past capacity: those counters "drain back to the blood bank"
      // the instant the vampire enters play (p. 6), so the transfer would
      // burn a pool counter for nothing. Found in an owner playtest —
      // 8 counters onto a 7-capacity vampire (docs/futile-options-design.md).
      if (tf.transfersLeft >= 1 && seat.pool >= 1 && uncontrolledCanTakeCounters(u)) {
        options.push({
          id: `inf:add:${u.card.id}`,
          kind: "transferToVampire",
          label: `Move 1 pool onto ${u.card.name} (1 transfer)`,
          minion: u.card.id,
        });
      }
      if (tf.transfersLeft >= 2 && u.counters >= 1) {
        options.push({
          id: `inf:take:${u.card.id}`,
          kind: "transferToPool",
          label: `Take 1 counter back from ${u.card.name} (2 transfers)`,
          minion: u.card.id,
        });
      }
      if (u.counters >= capacityOf(u.card)) {
        options.push({
          id: `inf:out:${u.card.id}`,
          kind: "influenceOut",
          label: `Move ${u.card.name} to the ready region`,
          minion: u.card.id,
        });
      }
    }
    if (tf.transfersLeft >= 4 && seat.pool >= 1 && seat.crypt.length > 0) {
      options.push({
        id: "inf:crypt",
        kind: "cryptDraw",
        label: "Move the top crypt card to the uncontrolled region (4 transfers + 1 pool)",
      });
    }
    options.push(...this.handlerOptions(tf.seat, "turn.influence"));
    return options;
  }

  private minionPhaseOptions(tf: TurnFrame): LegalOption[] {
    const seat = getSeat(this.state, tf.seat);
    const options: LegalOption[] = [];
    const actors = seat.minions.filter((m) => canAct(m));
    // "A ready vampire with no blood must hunt as a mandatory action"; all
    // mandatory actions come before any non-mandatory ones (p. 19).
    // Vampires only — an ally's only basic action is bleed (p. 19), and
    // an ally at 0 life is burned, not hungry.
    // "…cannot perform the same action again this turn" (Change of
    // Target, Obedience). A 0-blood vampire barred from hunting is the
    // rulebook's "stuck" vampire (p. 47): unlocked, with no legal action.
    // A stuck vampire is already out of `actors`, because `canAct` returns
    // false for one — so this is every 0-blood vampire that can still hunt.
    const mustHunt = actors.filter((m) => m.kind === "vampire" && m.blood === 0);
    if (mustHunt.length > 0) {
      for (const m of mustHunt) {
        options.push({
          id: `hunt:${m.id}`,
          kind: "takeAction",
          label: `${m.name}: hunt (mandatory)`,
          minion: m.id,
          action: "hunt",
          gain: huntGain(this.state, m),
        });
      }
      return options;
    }
    // "If you control a LOCKED MINION, <this vampire> MUST bleed as a Ⓓ
    // action unless she must hunt" (Elen Kamjian) — the second instance of
    // p. 19's mandatory-action rule, and it sits below the hunt because
    // her own text defers to it. Derived on every read: the locked minion
    // that compels her can unlock, and then she is free again.
    // docs/crypt-wave-7.md §2
    const controlsLocked = seat.minions.some((m) => isReady(m) && m.locked);
    const mustBleed = actors.filter(
      (m) =>
        !m.bledThisTurn &&
        canRepeatAction(this.state, m, "bleed") &&
        m.attached.some(
          (p) => p.statics.mustBleed && (!p.statics.mustBleed.whileControlsLocked || controlsLocked),
        ),
    );
    // A bleed goes at the prey unless something redirects it later
    // (p. 21), so that is the target its value is computed against.
    const preySeat = preyOf(this.state, tf.seat);
    const bleedValue = (m: MinionState): number =>
      prospectiveBleed(this.state, m, preySeat);
    if (mustBleed.length > 0) {
      for (const m of mustBleed) {
        const amount = bleedValue(m);
        options.push({
          id: `bleed:${m.id}`,
          kind: "takeAction",
          label: `${m.name}: bleed ${preySeat} for ${amount} (mandatory)`,
          minion: m.id,
          action: "bleed",
          bleed: amount,
        });
      }
      return options;
    }
    for (const m of actors) {
      if (!m.bledThisTurn && canRepeatAction(this.state, m, "bleed")) {
        const amount = bleedValue(m);
        options.push({
          id: `bleed:${m.id}`,
          kind: "takeAction",
          label: `${m.name}: bleed ${preySeat} for ${amount}`,
          minion: m.id,
          action: "bleed",
          bleed: amount,
        });
      }
      // Hunting is legal for any ready vampire, even at full capacity
      // (the excess just drains, p. 21) — the generator states the rules,
      // not tactics. Allies cannot hunt (p. 19).
      // "…and do not hunt as normal" (Week of Nightmares).
      if (
        m.kind === "vampire" &&
        !auraBlocksHunt(this.state, m) &&
        canRepeatAction(this.state, m, "hunt")
      ) {
        options.push({
          id: `hunt:${m.id}`,
          kind: "takeAction",
          label: `${m.name}: hunt`,
          minion: m.id,
          action: "hunt",
          gain: huntGain(this.state, m),
        });
      }
    }
    // Action cards: their handlers enumerate legal announcements here.
    options.push(...this.handlerOptions(tf.seat, "turn.minion"));
    // Actions granted by cards in play (rush design §2.5) and in-play
    // abilities usable in the minion phase (The Barrens, ruling p. 47).
    options.push(...this.entryActionOptionsFor(tf.seat));
    options.push(...this.abilityOptionsFor(tf.seat, "turn.minion"));
    // A vampire in torpor can perform no action except leave torpor
    // (p. 34): cost 2 blood (paid at resolution, so they must have it),
    // and the vampire must still be unlocked to act.
    for (const m of seat.minions) {
      // "Vampires with any hostage counters cannot be moved to the ready
      // region" (Carver's Meat Packing).
      if (m.inTorpor && !m.locked && m.blood >= 2 && !heldHostage(m)) {
        options.push({
          id: `leave:${m.id}`,
          kind: "takeAction",
          label: `${m.name}: leave torpor`,
          minion: m.id,
          action: "leaveTorpor",
        });
      }
    }
    // Diablerise and rescue target any vampire in torpor, in any seat
    // (p. 23–24). Only ready vampires may perform them (not allies).
    // "…cannot be moved to the ready region or be diablerized" (Carver's
    // Meat Packing) rules a hostage out of both actions.
    const torpid = this.state.seats.flatMap((s) =>
      s.minions.filter((m) => m.kind === "vampire" && m.inTorpor && !heldHostage(m)),
    );
    for (const actor of actors) {
      if (actor.kind !== "vampire") continue;
      for (const victim of torpid) {
        if (victim.id === actor.id) continue;
        // "…cannot be the target of other Methuselahs' actions" (Secure
        // Haven) — a diablerie and a rescue both name a minion.
        if (untargetableBy(victim, actor.controller, actor)) continue;
        options.push({
          id: `diablerize:${actor.id}:${victim.id}`,
          kind: "takeAction",
          label: `${actor.name}: diablerise ${victim.name}`,
          minion: actor.id,
          action: "diablerize",
          targetMinion: victim.id,
        });
        // The 2-blood cost may be paid by the actor, the rescued
        // vampire, or split (p. 23) — fixed at announcement.
        // "Rescuing a non-Tremere vampire costs this Salubri -2 blood"
        // (Saulot's Healing Touch) — the discount is read here as well as
        // at payment, so an actor who could not otherwise afford a split
        // is still offered it.
        const { discount } = rescueDiscountFor(actor, victim);
        for (let fromActor = 0; fromActor <= 2; fromActor++) {
          const actorPays = Math.max(0, fromActor - discount);
          if (actor.blood < actorPays) continue;
          if (victim.blood < 2 - fromActor) continue;
          options.push({
            id: `rescue:${actor.id}:${victim.id}:${fromActor}`,
            kind: "takeAction",
            label: `${actor.name}: rescue ${victim.name} (pay ${actorPays}/${2 - fromActor})`,
            minion: actor.id,
            action: "rescue",
            targetMinion: victim.id,
            rescueActorPortion: fromActor,
          });
        }
      }
    }
    options.push({ id: "end", kind: "endMinionPhase", label: "End minion phase" });
    return options;
  }

  private blockOptions(af: ActionFrame, seat: SeatId): LegalOption[] {
    if (af.step !== "A") return [];
    // "That Toreador's non-bleed actions cannot be blocked" (Toreador
    // Grand Ball) — nobody is offered a block at all.
    if (actionUnblockable(this.state, af)) return [];
    if (!blockEligibleSeats(this.state, af).includes(seat)) return [];
    if (af.declinedBlocks.includes(seat)) return [];
    const br = af.blockRestrictions;
    // "Allies cannot block this Anarch" (Libertas) — the persistent form
    // of br.noAllies, carried by a card on the ACTING minion, so it holds
    // for every action they take rather than for one (play-cost §5).
    const actor = findMinion(this.state, af.acting);
    const noAllies =
      br.noAllies || !!actor?.attached.some((p) => p.statics.alliesCannotBlock);
    const options: LegalOption[] = [];
    for (const m of getSeat(this.state, seat).minions) {
      if (!canReact(m)) continue;
      // "This minion cannot block" — a persistent restriction from an
      // attached card (Pentex™ Subversion), not action-scoped.
      if (m.attached.some((p) => p.statics.cannotBlock)) continue;
      // "…cannot block VAMPIRES" (Vagabond Mystic) — the same restriction
      // keyed on the acting minion's kind (docs/cheap-tail-design.md §2).
      if (
        actor &&
        m.attached.some((p) => p.statics.cannotBlockKind === actor.kind)
      ) {
        continue;
      }
      // "Allies AND vampires with capacity 3 or less cannot block this
      // vampire" (Rexton) — a persistent bar carried by the ACTING
      // minion's own crypt card, naming a union of groups. `blockToll`
      // beside it is a price; this is a bar (docs/crypt-wave-1.md §3).
      if (
        actor &&
        actor.attached.some((p) => {
          const bar = p.statics.cannotBeBlockedBy;
          if (!bar) return false;
          if ((bar.kinds ?? []).includes(m.kind)) return true;
          return (
            bar.maxCapacity !== undefined &&
            m.kind === "vampire" &&
            capacityOf(m) <= bar.maxCapacity
          );
        })
      ) {
        continue;
      }
      // "X cannot block this action" (p. 26).
      if (noAllies && m.kind === "ally") continue;
      if (br.noVampires && m.kind === "vampire") continue;
      if (br.noTitled && m.kind === "vampire" && m.title !== null) continue;
      if (br.cannotBlock.includes(m.id)) continue;
      // "Minions must burn 1 blood to attempt to block this action" — a
      // minion that cannot pay the toll cannot attempt at all
      // (docs/block-tax-design.md).
      const toll = blockTollFor(af, m, findMinion(this.state, af.acting), this.state);
      if (toll === null) continue;
      // The numbers this decision turns on. They are computed here anyway
      // (the toll to know the minion may attempt at all), so reporting
      // them costs nothing and saves both the UI and an agent from
      // re-deriving them (docs/richer-options-design.md §1).
      const intercept = currentIntercept(this.state, af.actionId, m.id);
      const stealth = currentStealth(this.state, af.actionId);
      options.push({
        id: `block:${m.id}`,
        kind: "declareBlock",
        label:
          `${m.name}: attempt to block (${intercept} vs ${stealth}` +
          `${intercept >= stealth ? "" : ", would fail"})` +
          (toll > 0 ? ` (burn ${toll})` : ""),
        minion: m.id,
        intercept,
        stealth,
        wouldSucceed: intercept >= stealth,
        toll,
      });
    }
    return options;
  }

  private handlerOptions(seat: SeatId, window: WindowId): LegalOption[] {
    const blockAttempt = this.blockAttempt();
    const ctx: PlayContext = {
      state: this.state,
      seat,
      turnSeat: this.turnSeat(),
      window,
      action: this.action(),
      blockAttempt,
      inBlockAttempt: blockAttempt !== null,
      combat: this.combatFrame(),
      pendingCard: (() => {
        const top = this.top();
        return top && top.kind === "cardPlay" ? top : null;
      })(),
      referendum: this.referendumFrame(),
      registry: this.registry,
    };
    const options: LegalOption[] = [];
    for (const card of getSeat(this.state, seat).hand) {
      const handler = this.registry[card.name];
      if (handler) options.push(...handler.options(card, ctx));
    }
    return options;
  }

  /**
   * "They can burn N blood to unlock after block resolution" (Truth in
   * Darkness) — offered to that side once combat has begun, and only
   * while they are actually locked and can pay
   * (docs/blocker-riders-design.md §3).
   */
  private unlockForBloodOptions(cf: CombatFrame, seat: SeatId): LegalOption[] {
    const out: LegalOption[] = [];
    for (const side of ["acting", "opposing"] as const) {
      const cost = cf.unlockForBlood[side];
      if (cost <= 0) continue;
      const seatOf = side === "acting" ? cf.actingSeat : cf.opposingSeat;
      if (seatOf !== seat) continue;
      const m = findMinion(this.state, side === "acting" ? cf.acting : cf.opposing);
      if (!m || !m.locked || m.blood < cost) continue;
      out.push({
        id: `unlock:blood:${side}`,
        kind: "useAbility",
        label: `${m.name}: burn ${cost} blood to unlock`,
        source: `unlockForBlood:${side}`,
        params: { side },
      });
    }
    return out;
  }

  private combatDecision(cf: CombatFrame): DecisionPoint {
    switch (cf.step) {
      case "beforeRange":
      case "beforeStrikes":
      case "endOfRound": {
        const window: WindowId =
          cf.step === "beforeRange"
            ? "combat.beforeRange"
            : cf.step === "beforeStrikes"
              ? "combat.beforeStrikes"
              : "combat.endOfRound";
        const seat = cycleSeat(cf.cycle);
        return this.dp(seat, window, [
          passOption(),
          ...this.unlockForBloodOptions(cf, seat),
          ...this.handlerOptions(seat, window),
          ...this.abilityOptionsFor(seat, window),
        ]);
      }
      case "range":
      case "press": {
        const window: WindowId =
          cf.step === "range" ? "combat.range" : "combat.press";
        const seat = cf.awaiting === "acting" ? cf.actingSeat : cf.opposingSeat;
        const label = cf.step === "range" ? "No maneuver" : "No press";
        const options: LegalOption[] = [passOption(label)];
        if (cf.step === "range" && !cf.restrict[cf.awaiting].maneuver) {
          // "1 optional maneuver during that combat" (rush riders), or a
          // close-only credit for this round (Angel's Gift), which is
          // worth nothing once the range is already close.
          const closeOnly = cf.closeManeuvers[cf.awaiting] > 0 && cf.range === "long";
          if (cf.maneuverCredits[cf.awaiting] > 0 || closeOnly) {
            options.push({
              id: "maneuver:credit",
              kind: "useManeuver",
              label: closeOnly ? "Maneuver to close range" : "Maneuver (rush credit)",
            });
          }
        }
        // "1 optional press, only usable to CONTINUE combat" (Righteous
        // Blade) — a restricted pool that can only ever buy the first of
        // the two options below (docs/weapon-riders-design.md §4).
        const continueOnly = cf.pressesContinueOnly?.[cf.awaiting] ?? 0;
        if (
          cf.step === "press" &&
          !cf.restrict[cf.awaiting].press &&
          cf.presses[cf.awaiting] + cf.pressesCombat[cf.awaiting] + continueOnly > 0
        ) {
          // A press credit continues combat — or cancels a press to
          // continue (p. 32).
          if (!cf.willContinue) {
            options.push({
              id: "press:continue",
              kind: "usePress",
              label: "Press: continue combat",
              toContinue: true,
            });
          } else if (cf.presses[cf.awaiting] + cf.pressesCombat[cf.awaiting] > 0) {
            options.push({
              id: "press:end",
              kind: "usePress",
              label: "Press: cancel the press to continue",
              toContinue: false,
            });
          }
        }
        options.push(...this.handlerOptions(seat, window));
        options.push(...this.abilityOptionsFor(seat, window));
        return this.dp(seat, window, options);
      }
      case "chooseStrike": {
        // Acting minion chooses first, then the opponent (p. 30); in an
        // additional sub-round, only minions with additional strikes.
        const side = this.nextStriker(cf) ?? "acting";
        const seat = side === "acting" ? cf.actingSeat : cf.opposingSeat;
        const options: LegalOption[] = [];
        // "1 additional strike: DODGE" (Wind Dance superior) — the extra
        // sub-round's strike is the one the card names, not a free
        // choice. Offered alone, so the restriction is a property of the
        // option list and needs no second check at resolution.
        const forced = cf.strikeRound === "additional" ? cf.forcedAdditionalStrike[side] : null;
        if (forced === "dodge") {
          options.push({
            id: "strike:dodge",
            kind: "chooseStrike",
            label: "Strike: dodge (forced)",
            strike: "dodge",
          });
          options.push(...this.abilityOptionsFor(seat, "combat.chooseStrike"));
          return this.dp(seat, "combat.chooseStrike", options);
        }
        // A used weapon maneuver commits that weapon's strike (.44
        // ruling): no other initial strike may be chosen.
        if (cf.committedStrike[side] === null) {
          options.push({
            id: "strike:hand",
            kind: "chooseStrike",
            label: "Hand strike",
            strike: "hand",
          });
          // "…they can strike: combat ends during the first round of the
          // resulting combat" (Night Terrors) — a strike granted by a
          // rider rather than printed on a card.
          if (
            cf.grantedCombatEnds[side] &&
            cf.round === 1 &&
            // "…cannot strike: combat ends during the first round"
            // (Hunter's Mark superior) bars the granted strike too.
            !cf.noCombatEndsFirstRound[side]
          ) {
            options.push({
              id: "strike:combatEnds",
              kind: "chooseStrike",
              label: "Strike: combat ends",
              strike: "combatEnds",
            });
          }
          // SPECIFIED strikes a card has granted — "1 additional ranged
          // strike: burn weapon" (Voracious Vermin), "can strike: dodge"
          // (Treasured Samadji). Spent when taken.
          // docs/weapon-riders-design.md §1
          //
          // "Strikes that are not hand strikes cannot be used this round"
          // (Immortal Grapple) takes them all off the table, along with
          // every weapon and card strike — a gate on OPTIONS, so nothing
          // has to enforce it a second time at resolution (§2).
          for (const g of cf.handStrikesOnly ? [] : cf.grantedStrikes?.[side] ?? []) {
            if (g.kind === "burnEquipment") {
              // With nothing to burn it is simply not offered, the call
              // Heroic Might's version already takes.
              const foe = findMinion(this.state, side === "acting" ? cf.opposing : cf.acting);
              for (const p of foe?.attached ?? []) {
                if (!p.tags.includes("equipment")) continue;
                options.push({
                  id: `strike:burnEquipment:${p.card.id}`,
                  kind: "chooseStrike",
                  label: `Strike: burn ${p.card.name}`,
                  strike: "burnEquipment",
                  params: { equipment: p.card.id },
                });
              }
            } else if (g.kind === "dodge") {
              options.push({
                id: "strike:dodge",
                kind: "chooseStrike",
                label: "Strike: dodge",
                strike: "dodge",
              });
            } else if (g.kind === "stealBlood") {
              options.push({
                id: `strike:stealBlood:${g.amount ?? 1}`,
                kind: "chooseStrike",
                label: `Strike: steal ${g.amount ?? 1} blood (ranged)`,
                strike: "stealBlood",
                params: { amount: String(g.amount ?? 1) },
              });
            }
          }
          options.push(...this.handlerOptions(seat, "combat.chooseStrike"));
        }
        options.push(...this.abilityOptionsFor(seat, "combat.chooseStrike"));
        return this.dp(seat, "combat.chooseStrike", options);
      }
      case "damageResolution": {
        const pd = cf.pendingDamage[0];
        if (!pd) throw new Error("damageResolution with empty queue");
        const victim = findMinion(this.state, pd.minion);
        const victimSeat = victim?.controller ?? cf.actingSeat;
        // Prevention is an impulse cycle, not a single question: a minion
        // NOT in this combat may prevent damage in it, and it may belong
        // to any Methuselah (p. 28). The victim's controller still goes
        // first (p. 31).
        //
        // RECORDED DEVIATION: the cycle carries the victim's seat plus
        // only those other seats that actually HAVE something to play
        // here, where beforeRange/beforeStrikes/endOfRound ask every seat
        // unconditionally. Damage resolution runs once per pending damage
        // item — several times a round — so cycling four seats through an
        // empty window each time multiplies decisions with no content and
        // no outcome. No behaviour changes for a seat that could act.
        // See docs/outside-combat-design.md §2.
        if (!cf.damageCycle || cf.damageCycleLen !== cf.pendingDamage.length) {
          const order = sequencingOrder(this.state, victimSeat, []).filter(
            (s) =>
              s === victimSeat ||
              this.handlerOptions(s, "combat.damageResolution").length > 0 ||
              this.abilityOptionsFor(s, "combat.damageResolution").length > 0,
          );
          cf.damageCycle = newCycle(order);
          cf.damageCycleLen = cf.pendingDamage.length;
        }
        const seat = cycleSeat(cf.damageCycle);
        const side = pd.minion === cf.acting ? "acting" : "opposing";
        return this.dp(seat, "combat.damageResolution", [
          passOption("No (more) damage prevention"),
          // "Can prevent N damage during the resulting combat" (Beast
          // Meld) — a stored credit, spent one point at a time.
          // A prevention CREDIT belongs to a combatant (Beast Meld gave it
          // to them), so it is offered only to the victim's own seat — a
          // bystander cannot spend someone else's credit.
          // A first-round-only credit (Precognition) counts here too, and
          // is spent first — it expires with the round. So does a
          // per-round RATE (Bear's Skin superior, Tranquility Shield),
          // whose remaining points are the grant minus what this round
          // has already spent. One button, whichever bucket pays: the
          // player is choosing to prevent a point, not to do bookkeeping.
          ...(preventPoints(cf, side) > 0 && seat === victimSeat
            ? [
                {
                  id: "prevent:credit",
                  kind: "preventCredit" as const,
                  label: `Prevent 1 damage (credit, ${preventPoints(cf, side)} left)`,
                },
              ]
            : []),
          ...this.handlerOptions(seat, "combat.damageResolution"),
          // In-play prevention abilities (War Ghoul's each-round 1).
          ...this.abilityOptionsFor(seat, "combat.damageResolution"),
        ]);
      }
    }
  }

  // -- applying choices -----------------------------------------------------

  choose(optionId: string): void {
    const dp = this.decision();
    if (!dp) throw new Error("no decision pending");
    const option = dp.options.find((o) => o.id === optionId);
    if (!option) {
      throw new Error(
        `illegal option "${optionId}" for ${dp.seat} in ${dp.window}; ` +
          `legal: ${dp.options.map((o) => o.id).join(", ")}`,
      );
    }
    this.state.commandLog.push({
      seq: this.state.decisionSeq,
      seat: dp.seat,
      option: option.id,
    });
    this.state.decisionSeq += 1;
    this.applyOption(option);
    // Settle immediately so callers observe a stable state after every
    // choice (resolutions, ousting, game end) — decision() stays idempotent.
    this.settle();
  }

  private applyOption(option: LegalOption): void {
    const top = this.top();
    if (!top) throw new Error("no frame");

    switch (option.kind) {
      case "pass":
        this.applyPass(top);
        return;
      case "takeAction":
        this.announceAction(top as TurnFrame, option.minion, option.action, {
          targetMinion: option.targetMinion,
          rescueActorPortion: option.rescueActorPortion,
        });
        return;
      case "endMinionPhase": {
        const tf = top as TurnFrame;
        tf.phase = "influence";
        // Transfers are granted at the start of the influence phase:
        // 1/2/3 on the game's first three turns, then 4 (p. 35) — plus
        // statics from permanents (Information Highway).
        let bonus = 0;
        for (const p of getSeat(this.state, tf.seat).permanents) {
          bonus += p.statics.transfers ?? 0;
        }
        tf.transfersLeft = Math.min(tf.turnNumber, 4) + bonus;
        // "During your influence phase, …" (Frontal Assault) — every card
        // in play sees the phase begin (docs/granted-rush-design.md §6).
        for (const { entry, owner } of this.allEntries()) {
          this.registry[entry.card.name]?.onInfluencePhase?.(entry, owner, tf.seat, this);
        }
        return;
      }
      case "useAbility": {
        // A rider's offer, not a card in play: "burn N blood to unlock
        // after block resolution" (Truth in Darkness).
        if (option.source.startsWith("unlockForBlood:")) {
          if (top.kind !== "combat") throw new Error("unlock offer outside combat");
          const side = option.params["side"] === "acting" ? "acting" : "opposing";
          const id = side === "acting" ? top.acting : top.opposing;
          const cost = top.unlockForBlood[side];
          top.unlockForBlood[side] = 0; // one offer, spent either way
          if (cost > 0) this.emit({ type: "BloodBurned", minion: id, amount: cost });
          this.emit({ type: "MinionUnlocked", minion: id });
          return;
        }
        const dpSeat = this.currentSeatOfTop();
        const entry = this.findPermanent(option.source);
        const handler = this.handler(entry.card.name);
        if (!handler.useAbility) throw new Error(`${entry.card.name} has no ability`);
        // Locate the owner (seat + bearing minion, if attached).
        let owner: { seat: SeatId; minion: MinionId | null } = {
          seat: dpSeat,
          minion: null,
        };
        for (const s of this.state.seats) {
          for (const m of s.minions) {
            if (m.attached.some((p) => p.card.id === option.source)) {
              owner = { seat: s.id, minion: m.id };
            }
          }
        }
        handler.useAbility(entry, owner, option, this);
        // "If at any point any Methuselah uses a card or effect, the
        // acting Methuselah again gets the impulse back" (p. 8) — for
        // windows driven by the impulse cycle. The combat alternation
        // steps (range/press/strike/damage) sequence themselves.
        const t = this.top();
        if (
          t &&
          (t.kind === "action" || t.kind === "blockAttempt" || t.kind === "cardPlay")
        ) {
          cycleRewind(t.cycle);
        }
        if (
          t &&
          t.kind === "combat" &&
          (t.step === "beforeRange" || t.step === "beforeStrikes" || t.step === "endOfRound")
        ) {
          cycleRewind(t.cycle);
        }
        return;
      }
      case "transferToVampire": {
        const tf = top as TurnFrame;
        tf.transfersLeft -= 1;
        this.emit({
          type: "PoolMovedToUncontrolled",
          seat: tf.seat,
          minion: option.minion,
        });
        return;
      }
      case "transferToPool": {
        const tf = top as TurnFrame;
        tf.transfersLeft -= 2;
        this.emit({
          type: "CounterMovedToPool",
          seat: tf.seat,
          minion: option.minion,
        });
        return;
      }
      case "cryptDraw": {
        const tf = top as TurnFrame;
        tf.transfersLeft -= 4;
        const seat = getSeat(this.state, tf.seat);
        const cryptTop = seat.crypt[0];
        if (!cryptTop) throw new Error("crypt draw from empty crypt");
        this.emit({ type: "PoolBurned", seat: tf.seat, amount: 1 });
        this.emit({ type: "CryptCardDrawn", seat: tf.seat, minion: cryptTop.id });
        return;
      }
      case "influenceOut": {
        const tf = top as TurnFrame;
        const entry = findUncontrolled(this.state, tf.seat, option.minion);
        this.emit({
          type: "VampireEnteredPlay",
          seat: tf.seat,
          minion: option.minion,
          // Counters become blood; the excess drains immediately (p. 36).
          blood: Math.min(entry.counters, capacityOf(entry.card)),
        });
        return;
      }
      case "gainEdgePool": {
        const tf = top as TurnFrame;
        this.emit({ type: "PoolGained", seat: tf.seat, amount: 1 });
        tf.edgeDone = true;
        return;
      }
      case "announceWithdrawal": {
        // The announcement alone does nothing (p. 38): it starts a turn's
        // probation, and the withdrawal succeeds only if the seat reaches
        // its next unlock phase having lost no blood and no pool and
        // fought nothing.
        this.emit({ type: "WithdrawalAnnounced", seat: (top as TurnFrame).seat });
        return;
      }
      case "discard": {
        const tf = top as TurnFrame;
        // A discard spends a discard phase action (p. 37); with only the
        // default one, this ends the turn exactly as before.
        tf.discardActionsLeft = (tf.discardActionsLeft ?? 1) - 1;
        this.discardCard(tf.seat, option.card);
        if ((tf.discardActionsLeft ?? 0) <= 0) this.endTurn(tf);
        return;
      }
      case "playCard":
        this.playCard(option);
        return;
      case "payToCancel": {
        if (top.kind !== "cardPlay") throw new Error("payToCancel outside a card play");
        const payer = top.payToCancel?.seat;
        if (!payer) throw new Error("payToCancel with no payer");
        if (option.pool > 0) {
          this.emit({ type: "PoolBurned", seat: payer, amount: option.pool });
        }
        // The card currency (Target Vitals): the discards are a COST, but
        // p. 7 still replaces them — "whenever an effect removes cards
        // from your hand, immediately draw up to match your hand size".
        for (const id of (option.params?.["discard"] ?? "").split(",").filter(Boolean)) {
          this.discardFromHand(payer, id, true);
        }
        // "Cancel this card as it is played". The cost is NOT refunded:
        // Sudden Reversal prints "its cost is not paid" and Golconda
        // prints nothing of the kind (§2, reading 1).
        this.cancelPendingCard(false);
        return;
      }
      case "cancelBlock": {
        if (top.kind !== "blockAttempt") throw new Error("cancelBlock outside a block");
        // Only flag it. The attempt resolves when the impulse cycle goes
        // quiescent, exactly as `forceFail` does — others may still want
        // to respond in this window, and reusing that path means the
        // withdrawal cannot get the sequencing wrong on its own.
        top.cancelled = true;
        cyclePass(top.cycle);
        return;
      }
      case "burnForIntercept": {
        if (top.kind !== "blockAttempt") throw new Error("burnForIntercept outside a block");
        this.emit({ type: "BloodBurned", minion: option.minion, amount: 1 });
        this.emit({
          type: "InterceptModified",
          actionId: top.actionId,
          minion: option.minion,
          delta: 1,
          source: "Eyes of the Wild",
        });
        // An effect hands the impulse back to the acting Methuselah (p. 8);
        // the grant is repeatable, so the blocker may burn again on its
        // next turn in the cycle.
        cycleRewind(top.cycle);
        return;
      }
      case "burnForUnlock": {
        // Fiendish Tongue's discard-phase unlock. One chance: the
        // permission is spent whether or not the minion later re-locks.
        const m = getMinion(this.state, option.minion);
        this.emit({ type: "BloodBurned", minion: option.minion, amount: 1 });
        this.emit({ type: "MinionUnlocked", minion: option.minion });
        m.discardPhaseUnlock = false;
        return;
      }
      case "declareBlock": {
        if (top.kind !== "action") throw new Error("block outside action");
        const blocker = getMinion(this.state, option.minion);
        // The toll is paid to make the attempt, whether or not it succeeds
        // (docs/block-tax-design.md §3).
        const actor = findMinion(this.state, top.acting);
        const toll = blockTollFor(top, blocker, actor, this.state);
        if (toll) this.emit({ type: "BloodBurned", minion: blocker.id, amount: toll });
        this.payLibraryBlockToll(blocker, actor);
        top.step = "B";
        this.emit({
          type: "BlockDeclared",
          actionId: top.actionId,
          seat: blocker.controller,
          blocker: blocker.id,
        });
        this.state.frames.push({
          kind: "blockAttempt",
          actionId: top.actionId,
          blockerSeat: blocker.controller,
          blocker: blocker.id,
          cycle: newCycle(
            sequencingOrder(this.state, top.actingSeat, defendersFor(this.state, top)),
          ),
        });
        // Cards that answer a block being declared, before the attempt
        // resolves (Rebel). The forced-block path in startAutoBlock fires
        // the same hook — both are blocks.
        this.notifyBlockDeclared(top, blocker.id);
        return;
      }
      case "chooseStrike": {
        if (top.kind !== "combat") throw new Error("strike outside combat");
        const side = this.nextStriker(top);
        if (!side) throw new Error("no striker awaiting a strike");
        // A granted strike is SPENT when taken, whichever kind it is.
        const granted = top.grantedStrikes?.[side];
        const takenGrant = granted?.find((g) => g.kind === option.strike);
        if (granted && takenGrant) granted.splice(granted.indexOf(takenGrant), 1);
        if (option.strike === "burnEquipment") {
          const equipment = option.params?.["equipment"];
          if (!equipment) throw new Error("burnEquipment strike with no equipment");
          this.chooseBurnEquipmentStrike(
            side === "acting" ? top.acting : top.opposing,
            "burn weapon",
            equipment,
          );
          return;
        }
        if (option.strike === "stealBlood") {
          // "Strike, ranged: steal N blood or life (becoming blood)" —
          // the strike moves blood instead of dealing damage (p. 33), and
          // an ally's life is the same field (§3).
          top.strikes[side] = {
            ...HAND_STRIKE,
            damage: 0,
            ranged: true,
            stealBlood: Number(option.params?.["amount"] ?? "1"),
          };
          this.emit({
            type: "StrikeChosen",
            minion: side === "acting" ? top.acting : top.opposing,
            strike: "steal blood",
          });
          return;
        }
        if (option.strike === "dodge") {
          top.strikes[side] = { ...HAND_STRIKE, damage: 0, dodge: true };
          this.emit({
            type: "StrikeChosen",
            minion: side === "acting" ? top.acting : top.opposing,
            strike: "dodge",
          });
          return;
        }
        if (option.strike === "combatEnds") {
          top.grantedCombatEnds[side] = false; // one use
          // A combat-ends strike does no damage, so it is a hand strike
          // with the flag and no damage — the shape `strikeCombatEnds`
          // builds from a card.
          top.strikes[side] = { ...HAND_STRIKE, damage: 0, combatEnds: true };
          this.emit({
            type: "StrikeChosen",
            minion: side === "acting" ? top.acting : top.opposing,
            strike: "combat ends",
          });
          return;
        }
        top.strikes[side] = { ...HAND_STRIKE };
        this.emit({
          type: "StrikeChosen",
          minion: side === "acting" ? top.acting : top.opposing,
          strike: "hand",
        });
        return;
      }
      case "chooseTerms": {
        if (top.kind !== "referendum") throw new Error("terms outside referendum");
        top.terms = { ...option.params };
        this.emit({
          type: "TermsChosen",
          actionId: top.actionId,
          terms: top.terms,
        });
        top.step = "polling";
        return;
      }
      case "castVote": {
        if (top.kind !== "referendum") throw new Error("vote outside referendum");
        const seat = cycleSeat(top.cycle);
        // "Vampires must BURN 1 BLOOD to cast votes against" (Alexander
        // Silverson) — paid by the casting vampire, and affordability was
        // already settled at enumeration.
        if (option.toll) {
          this.emit({ type: "BloodBurned", minion: option.source, amount: option.toll });
        }
        top.votes.push({
          seat,
          source: option.source,
          count: option.count,
          inFavor: option.inFavor,
        });
        if (option.source === "edge") {
          top.usedSources.push("edge");
          this.emit({ type: "EdgeBurned", seat });
        } else if (option.source === "caller") {
          // The calling card's vote spends the seat's one-card-vote
          // allowance (p. 28: "no more than 1 vote from political
          // action cards").
          top.usedSources.push("caller", `cardvote:${seat}`);
        } else if (option.source.startsWith("card:")) {
          top.usedSources.push(`cardvote:${seat}`);
          const cardId = option.source.slice("card:".length);
          const hand = getSeat(this.state, seat).hand;
          const idx = hand.findIndex((c) => c.id === cardId);
          if (idx < 0) throw new Error(`political card not in hand: ${cardId}`);
          const [card] = hand.splice(idx, 1);
          this.emit({ type: "CardBurned", cardId: card!.id, name: card!.name, seat });
          this.drawToReplace(seat);
        } else if (option.source === "grant") {
          top.usedSources.push(`grant:${seat}`); // card-granted votes
        } else {
          top.usedSources.push(option.source); // a titled vampire
        }
        this.emit({
          type: "VoteCast",
          actionId: top.actionId,
          seat,
          source: option.source,
          count: option.count,
          inFavor: option.inFavor,
        });
        // Casting is using an effect: the impulse rewinds (p. 8).
        cycleRewind(top.cycle);
        return;
      }
      case "diablerizeOffer": {
        if (top.kind !== "diablerieOffer") throw new Error("offer outside frame");
        // Take the offer: pop first so commitDiablerie's blood-hunt
        // referendum lands on the still-pending (failed) leave-torpor
        // action frame, not on this offer.
        const { diablerist, victim } = top;
        this.pop();
        this.commitDiablerie(diablerist, victim);
        return;
      }
      case "answerChoice": {
        if (top.kind !== "choice") throw new Error("choice outside frame");
        // Pop first, so a handler that raises a follow-up question (the
        // discard-down loop) lands on a clean stack.
        const frame = top;
        this.pop();
        this.applyChoiceFor(frame, option);
        return;
      }
      case "useEntryAction": {
        // Locate the entry and its bearer; the handler announces via
        // ops.announceEntryAction.
        const entry = this.findPermanent(option.source);
        let owner: { seat: SeatId; minion: MinionId | null } = {
          seat: this.currentSeatOfTop(),
          minion: null,
        };
        for (const s of this.state.seats) {
          for (const m of s.minions) {
            if (m.attached.some((p) => p.card.id === option.source)) {
              owner = { seat: s.id, minion: m.id };
            }
          }
        }
        const handler = this.handler(entry.card.name);
        if (!handler.useActionOption) {
          throw new Error(`${entry.card.name} grants no actions`);
        }
        handler.useActionOption(entry, owner, option, this);
        return;
      }
      case "useManeuver": {
        if (top.kind !== "combat") throw new Error("maneuver outside combat");
        const side = top.awaiting;
        // Spend the close-only credit first when it is legal: it expires
        // with the round, where an ordinary credit lasts the combat.
        if (top.closeManeuvers[side] > 0 && top.range === "long") {
          top.closeManeuvers[side] -= 1;
        } else {
          top.maneuverCredits[side] -= 1;
        }
        top.range = top.range === "close" ? "long" : "close";
        top.awaiting = side === "acting" ? "opposing" : "acting";
        top.declines = 0;
        this.emit({ type: "RangeSet", range: top.range });
        return;
      }
      case "preventCredit": {
        if (top.kind !== "combat") throw new Error("prevention outside combat");
        const pd = top.pendingDamage[0];
        if (!pd) throw new Error("no damage to prevent");
        const side = pd.minion === top.acting ? "acting" : "opposing";
        // Shortest-lived bucket first: the first-round pool is gone at the
        // end of round 1, the per-round rate at the end of THIS round,
        // and only `preventCredits` survives the combat (the
        // `closeManeuvers` rule, extended to a third bucket).
        if (top.round === 1 && top.preventCreditsFirstRound[side] > 0) {
          top.preventCreditsFirstRound[side] -= 1;
        } else if (top.preventPerRound[side] - top.preventPerRoundUsed[side] > 0) {
          top.preventPerRoundUsed[side] += 1;
        } else {
          top.preventCredits[side] -= 1;
        }
        this.emit({ type: "DamagePrevented", minion: pd.minion, amount: 1 });
        pd.amount -= 1;
        // Fully prevented — nothing left to mend (p. 31).
        if (pd.amount <= 0) top.pendingDamage.shift();
        return;
      }
      case "usePress": {
        if (top.kind !== "combat") throw new Error("press outside combat");
        const side = top.awaiting;
        // Shortest-lived / most restricted first: a continue-only credit
        // is worthless for anything but this option, so spending a
        // general one ahead of it would strand it (the `closeManeuvers`
        // rule, docs/weapon-riders-design.md §4). Then round credits,
        // then per-combat ones (retainer statics).
        const restricted = top.pressesContinueOnly;
        if (option.toContinue && restricted && restricted[side] > 0) restricted[side] -= 1;
        else if (top.presses[side] > 0) top.presses[side] -= 1;
        else top.pressesCombat[side] -= 1;
        top.willContinue = option.toContinue;
        top.awaiting = side === "acting" ? "opposing" : "acting";
        top.declines = 0;
        this.emit({
          type: "PressUsed",
          seat: side === "acting" ? top.actingSeat : top.opposingSeat,
          toContinue: option.toContinue,
        });
        return;
      }
    }
  }

  private applyPass(top: Frame): void {
    switch (top.kind) {
      case "turn":
        this.applyTurnPass(top);
        return;
      case "action":
        // Passing in state A is the sticky decline: "that Methuselah
        // cannot declare any block attempt until the end of the action
        // unless the target of the action changes" (p. 27 A.3).
        if (top.step === "A") {
          const seat = cycleSeat(top.cycle);
          if (
            blockEligibleSeats(this.state, top).includes(seat) &&
            !top.declinedBlocks.includes(seat)
          ) {
            top.declinedBlocks.push(seat);
            this.emit({ type: "BlocksDeclined", actionId: top.actionId, seat });
          }
        }
        cyclePass(top.cycle);
        return;
      case "blockAttempt":
      case "cardPlay":
      case "referendum":
        cyclePass(top.cycle);
        return;
      case "choice":
        // "You can …" declined: the question simply goes away.
        this.pop();
        return;
      case "diablerieOffer":
        // Declined: pop the offer; the leave-torpor action then fails
        // (settle resolves the underlying af.step "blocked").
        this.pop();
        return;
      case "combat":
        this.applyCombatPass(top);
        return;
    }
  }

  private applyTurnPass(tf: TurnFrame): void {
    switch (tf.phase) {
      case "unlock": {
        // Mirror turnDecision: the turn's seat passes first; afterwards a
        // pass comes from the other seat currently holding the window.
        const edgeNeeded = this.state.edge === tf.seat && !tf.edgeDone;
        const ownAbilities =
          !tf.unlockAbilitiesDone &&
          this.abilityOptionsFor(tf.seat, "turn.unlock").length > 0;
        // The withdrawal offer opens this window too, so declining it has
        // to close the turn seat's turn at it — otherwise the pass falls
        // through and the OTHER seats' "during any unlock phase" cards
        // never get asked (which is what broke the Homunculus test).
        const mayWithdraw = !tf.unlockAbilitiesDone && this.canAnnounceWithdrawal(tf.seat);
        if (edgeNeeded || ownAbilities || mayWithdraw) {
          tf.edgeDone = true; // declined the Edge pool
          tf.unlockAbilitiesDone = true;
          return;
        }
        const other = this.nextUnlockAbilitySeat(tf);
        if (other !== null) tf.unlockOthersDone.push(other);
        return;
      }
      case "master":
        tf.phase = "minion";
        return;
      case "minion":
        throw new Error("minion phase uses endMinionPhase, not pass");
      case "influence": {
        tf.phase = "discard";
        // "You receive by default one discard phase action" (p. 37).
        tf.discardActionsLeft = 1;
        // "+1 hand size until your next DISCARD PHASE" (Fotini) — it
        // lifts as the phase OPENS, before the hand is measured, which is
        // what makes it different from an end-of-turn grant.
        {
          const expiring = (tf.handSizeBonus ?? []).filter(
            (g) => g.until === "discardPhase" && g.seat === tf.seat,
          );
          if (expiring.length > 0) {
            tf.handSizeBonus = (tf.handSizeBonus ?? []).filter((g) => !expiring.includes(g));
            this.expireHandSizeBonus(expiring);
          }
        }
        // "Do not replace until your next DISCARD phase" (Mirror Walk)
        // comes due as the phase opens — before the hand is measured for
        // discarding down, which is what p. 49's ruling describes.
        const dseat = getSeat(this.state, tf.seat);
        for (let i = 0; i < (dseat.delayedDrawsDiscard ?? 0); i++) {
          this.drawToReplace(tf.seat);
        }
        dseat.delayedDrawsDiscard = 0;
        // "During your discard phase, your predator takes control of this
        // card" (The Coven) — every card in play sees the phase begin,
        // the `onMasterPhase` / `onInfluencePhase` pattern.
        // docs/cross-table-masters-design.md §4
        for (const { entry, owner } of this.allEntries()) {
          this.registry[entry.card.name]?.onDiscardPhase?.(entry, owner, tf.seat, this);
        }
        return;
      }
      case "discard":
        this.endTurn(tf);
        return;
    }
  }

  private applyCombatPass(cf: CombatFrame): void {
    switch (cf.step) {
      case "beforeRange":
      case "beforeStrikes":
      case "endOfRound":
        cyclePass(cf.cycle);
        return;
      case "range":
      case "press": {
        // Declining in the alternation protocol; two consecutive declines
        // settle the step (p. 29 maneuvers, p. 32 presses).
        cf.declines += 1;
        cf.awaiting = cf.awaiting === "acting" ? "opposing" : "acting";
        if (cf.declines >= 2) {
          if (cf.step === "range") {
            this.emit({ type: "RangeSet", range: cf.range });
            cf.step = "beforeStrikes";
            cf.cycle = newCycle(cf.cycle.order);
          } else {
            cf.step = "endOfRound";
            cf.cycle = newCycle(cf.cycle.order);
          }
        }
        return;
      }
      case "damageResolution": {
        // Prevention is a cycle now (a bystander may prevent, p. 28), so
        // one seat passing is not the end of it — the damage resolves only
        // when everyone has declined.
        if (cf.damageCycle) {
          cyclePass(cf.damageCycle);
          if (!cycleQuiescent(cf.damageCycle)) return;
        }
        const pd = cf.pendingDamage.shift();
        if (!pd) throw new Error("no pending damage");
        delete cf.damageCycle; // the next item gets its own window
        delete cf.damageCycleLen;
        this.resolveCombatDamage(cf, pd);
        return;
      }
      case "chooseStrike":
        throw new Error("strike choice cannot be passed");
    }
  }

  /** Damage that is done being prevented, applied (p. 31). Vampires mend:
   *  burn 1 blood per point, torpor if they cannot mend everything. Allies
   *  burn 1 life per point, no mend decision, no torpor — at 0 life the
   *  settle sweep burns them (p. 31–32). Called from combat's damage
   *  resolution step and by unpreventable damage dealt outside combat
   *  (Daring the Dawn — docs/block-tax-design.md §6). */
  /**
   * The ONE place damage enters a combat's pending queue — strikes,
   * retainer output and the `combatRoundDamage` statics all come here.
   *
   * It exists so that "all damage inflicted on vampires during this combat
   * is aggravated" (Dawn Operation) has a single site to act on. There
   * were two push sites before, which is two chances for the next damage
   * source to quietly miss the rule.
   *
   * The clause says "on vampires", so an ally or retainer is untouched —
   * they treat aggravated as normal damage anyway (p. 32), but tagging
   * them would make the log say something the card does not.
   */
  private pushPendingDamage(cf: CombatFrame, pd: PendingDamage): void {
    // "Prevent all damage from the opposing minion's strikes this round"
    // (Rolling with the Punches superior). Checked HERE, at the single
    // chokepoint, so retainer output and combatRoundDamage statics are
    // covered too — a check in the prevention window would miss both.
    if (pd.source !== null) {
      const side = pd.source === cf.acting ? "acting" : "opposing";
      if (cf.preventAllFrom[side]) {
        this.emit({ type: "DamagePrevented", minion: pd.minion, amount: pd.amount });
        return;
      }
    }
    const victim = findMinion(this.state, pd.minion);
    const aggravated =
      pd.aggravated || (!!cf.allDamageAggravated && victim?.kind === "vampire");
    // "If ANY damage from this strike is SUCCESSFULLY INFLICTED, they
    // take +N damage from this strike" (Target Vitals) — so the bonus
    // rides an item that already has damage on it, which is neither a
    // strike bonus (applied even when prevented to nothing) nor separate
    // damage (which would get its own prevention window).
    // docs/round-end-design.md §3
    let amount = pd.amount;
    if (pd.source !== null && amount > 0 && cf.aimBonus) {
      amount += cf.aimBonus[pd.source === cf.acting ? "acting" : "opposing"];
    }
    // "Inflicts +N damage with RANGED strikes" (Noluthando). A property of
    // the STRIKER, added at this one chokepoint so it reaches the damage
    // however the strike was declared. Ranged strikes already work at
    // close range, which is what the card's parenthetical is confirming —
    // so only the bonus is new (docs/crypt-wave-3.md §4).
    if (pd.source !== null) {
      const striker = findMinion(this.state, pd.source);
      const side = pd.source === cf.acting ? "acting" : "opposing";
      if (striker && cf.strikes[side]?.ranged) {
        for (const p of striker.attached) amount += p.statics.rangedDamageBonus ?? 0;
      }
    }
    const resolved: PendingDamage = { ...pd, amount, aggravated };
    this.emit({
      type: "DamageInflicted",
      minion: resolved.minion,
      amount: resolved.amount,
      source: resolved.source,
      aggravated: resolved.aggravated,
    });
    cf.pendingDamage.push(resolved);
  }

  /**
   * "This combat, <X> takes N damage each round" (Carrion Crows, Weather
   * Control) — one firing of one rider.
   *
   * Environmental damage: `source: null`, so it cannot be dodged and
   * `preventAllFrom` (keyed on the damaging side) does not touch it. It
   * still goes through `pushPendingDamage`, the single chokepoint, so
   * Dawn Operation's combat-wide aggravation applies without this site
   * knowing about it. docs/round-recurring-combat-design.md §3
   */
  private inflictRoundDamage(cf: CombatFrame, r: CombatRoundDamageRider): void {
    // A non-ranged "each round" damage applies at close range only, the
    // same rule retainer output follows (p. 31).
    if (!r.ranged && cf.range === "long") return;
    const amount = r.escalate ? r.amount + (cf.round - r.startRound) : r.amount;
    if (amount <= 0) return;
    const victims: MinionId[] =
      r.targets === "both"
        ? [cf.acting, cf.opposing]
        : [r.from === "acting" ? cf.opposing : cf.acting];
    for (const id of victims) {
      const victim = findMinion(this.state, id);
      // A combatant can leave play at any point in a combat.
      if (!victim) continue;
      const pd: PendingDamage = { minion: id, amount, source: null, aggravated: false };
      if (r.unpreventable) pd.unpreventable = true;
      this.pushPendingDamage(cf, pd);
      if (!r.retainers) continue;
      // "…and each retainer on them". A retainer is a card in play, not a
      // MinionId, so it cannot be a PendingDamage victim; its life is
      // burned directly. Honest only because such damage is unpreventable
      // — there is no window being skipped.
      for (const p of [...victim.attached]) {
        if (p.life === undefined) continue;
        this.burnRetainerLife(p.card.id, Math.min(p.life, amount));
      }
    }
    // Damage inflicted outside the damage-resolution step (Weather
    // Control fires before range) has no window to wait for when nobody
    // can answer it; the drain resolves exactly those items.
    this.drainAutoPrevented(cf);
  }

  /**
   * Pop pending-damage items off the HEAD of the queue while they need no
   * decision, and report whether anything moved.
   *
   * Two kinds qualify. **Auto-prevented** (Flesh of Marble): a second
   * damage in a round where one has already landed — discarded with a
   * `DamagePrevented` event. **Unpreventable** (Weather Control): the
   * damage-resolution window contains nothing but prevention, so an item
   * nobody can prevent would open a window whose only option is Pass.
   *
   * Called from the `damageResolution` settle case, which covers both
   * entries into the step — the first item of the round, and every
   * subsequent item once one resolves. docs/round-recurring-combat-design.md §5
   */
  private drainAutoPrevented(cf: CombatFrame): boolean {
    let moved = false;
    for (;;) {
      const pd = cf.pendingDamage[0];
      if (!pd) return moved;
      const side = pd.minion === cf.acting ? "acting" : pd.minion === cf.opposing ? "opposing" : null;
      const rule = side ? cf.autoPreventAfterFirst[side] : null;
      const auto =
        !!side &&
        rule !== null &&
        cf.damageTakenThisRound[side] > 0 &&
        (rule === "all" || !pd.aggravated);
      if (auto) {
        this.emit({ type: "DamagePrevented", minion: pd.minion, amount: pd.amount });
        cf.pendingDamage.shift();
      } else if (pd.unpreventable) {
        cf.pendingDamage.shift();
        this.resolveCombatDamage(cf, pd);
      } else {
        return moved;
      }
      delete cf.damageCycle;
      delete cf.damageCycleLen;
      moved = true;
    }
  }

  /** Damage applied inside a combat: the ordinary resolution plus the
   *  per-round tally `autoPreventAfterFirst` reads. One wrapper rather
   *  than two call sites remembering to bump it — the `pushPendingDamage`
   *  lesson on the other end of the pipe. */
  private resolveCombatDamage(cf: CombatFrame, pd: PendingDamage): void {
    const side = pd.minion === cf.acting ? "acting" : pd.minion === cf.opposing ? "opposing" : null;
    // Only a point that actually lands counts as "successfully inflicted";
    // a fully prevented item never reaches here.
    if (side && pd.amount > 0) cf.damageTakenThisRound[side] += pd.amount;
    const before = findMinion(this.state, pd.minion);
    const wasInPlay = !!before;
    // "Blood LOST to damage" is not "damage taken": a vampire who cannot
    // mend everything burns only what they had, and an ally burns life,
    // not blood. Measured across the whole resolution so every path —
    // mend, torpor, aggravated — is covered by one read
    // (docs/last-combat-design.md §2).
    const bloodBefore = before?.kind === "vampire" ? before.blood : null;
    this.applyResolvedDamage(pd);
    // "…if the opposing vampire is BURNED during this weapon's strike
    // resolution" (Sword of the Archangel). Recorded here, the one
    // chokepoint for damage actually inflicted, because an after-combat
    // rider cannot see HOW the victim died (§6).
    if (side && bloodBefore !== null) {
      // A burned vampire is gone, and lost every drop they had.
      const after = findMinion(this.state, pd.minion);
      const lost = bloodBefore - (after?.blood ?? 0);
      if (lost > 0) {
        cf.bloodLostThisRound ??= { acting: 0, opposing: 0 };
        cf.bloodLostThisRound[side] += lost;
      }
    }
    if (side && wasInPlay && !findMinion(this.state, pd.minion)) {
      const striker = side === "acting" ? "opposing" : "acting";
      const name = cf.strikes[striker]?.name;
      if (name) (cf.burnedByStrike ??= []).push(name);
    }
  }

  private applyResolvedDamage(pd: PendingDamage): void {
    // A minion can leave play before its damage resolves.
    const m = findMinion(this.state, pd.minion);
    if (!m) return;
    if (m.kind === "ally") {
      // Allies treat aggravated as normal damage (p. 32).
      const burn = Math.min(m.blood, pd.amount);
      if (burn > 0) {
        this.emit({ type: "BloodBurned", minion: m.id, amount: burn });
      }
      return;
    }
    if (pd.aggravated) {
      // Aggravated cannot be mended (p. 34). An already-wounded (in
      // torpor) vampire burns 1 blood per point to prevent destruction,
      // else is burned; otherwise it goes straight to torpor (wounded).
      if (m.inTorpor) {
        if (m.blood >= pd.amount) {
          if (pd.amount > 0) this.emit({ type: "BloodBurned", minion: m.id, amount: pd.amount });
        } else {
          this.burnMinion(m.id);
          this.notifyCombatLeave(m.id);
        }
      } else {
        this.notifyLeaveReady(m.id, "torpor");
        this.emit({ type: "WentToTorpor", minion: m.id });
        this.notifyCombatLeave(m.id);
      }
      return;
    }
    const mendable = Math.min(m.blood, pd.amount);
    if (mendable > 0) {
      this.emit({ type: "BloodBurned", minion: m.id, amount: mendable });
      this.emit({ type: "DamageMended", minion: m.id, amount: mendable });
    }
    if (pd.amount > mendable) {
      this.notifyLeaveReady(m.id, "torpor");
      this.emit({ type: "WentToTorpor", minion: m.id });
      this.notifyCombatLeave(m.id);
    }
  }

  private announceAction(
    tf: TurnFrame,
    minionId: string,
    kind: ActionKind,
    opts: { targetMinion?: MinionId | undefined; rescueActorPortion?: number | undefined } = {},
  ): void {
    const m = getMinion(this.state, minionId);
    const actionId = this.freshId("action-");
    // "Taking an action locks the acting minion" (p. 19); all details are
    // fixed at announcement (p. 25).
    this.emit({ type: "MinionLocked", minion: m.id });

    let target: SeatId | null = null;
    let directed = false;
    let inherentStealth = 0;
    let targetMinion: MinionId | null = null;
    let rescueSplit: { fromActor: number; fromVictim: number } | null = null;
    if (kind === "bleed") {
      m.bledThisTurn = true; // one bleed per minion per turn (p. 20)
      target = preyOf(this.state, tf.seat); // default target: your prey
      directed = true;
    } else if (kind === "hunt" || kind === "leaveTorpor") {
      inherentStealth = 1; // +1 inherent stealth (p. 21, p. 24)
    } else if (kind === "diablerize" || kind === "rescue") {
      // Directed at the torpor vampire's controller if different, else
      // undirected; +1 stealth when same controller, 0 when different
      // (p. 23, p. 24).
      targetMinion = opts.targetMinion ?? null;
      if (!targetMinion) throw new Error(`${kind} without a target`);
      const controller = getMinion(this.state, targetMinion).controller;
      if (controller !== tf.seat) {
        target = controller;
        directed = true;
        inherentStealth = 0;
      } else {
        inherentStealth = 1;
      }
      if (kind === "rescue") {
        const fromActor = opts.rescueActorPortion ?? 2;
        rescueSplit = { fromActor, fromVictim: 2 - fromActor };
      }
    }
    this.emit({
      type: "ActionAnnounced",
      actionId,
      actionKind: kind,
      acting: m.id,
      seat: tf.seat,
      target,
      directed,
      ...(targetMinion !== null ? { targetMinion } : {}),
    });
    const frame: ActionFrame = {
      kind: "action",
      actionId,
      actionKind: kind,
      card: null,
      acting: m.id,
      actingSeat: tf.seat,
      target,
      directed,
      targetMinion,
      rushRiders: null,
      combatOutcome: null,
      targetPermanent: null,
      grantedEffect: null,
      grantedCost: null,
      rescueSplit,
      step: "announce",
      declinedBlocks: [],
      played: [],
      blockedBy: null,
      notBlockPenalties: [],
      unlockOnSuccess: [],
      drawAfter: [],
      playCostMods: [],
      delayReplaceTypes: [],
      noReactionsFrom: [],
      blockerCombatRiders: {},
      actorCombatRider: {
        prevent: 0,
        strength: 0,
        maneuver: 0,
        press: 0,
        handStrikesAggravated: false,
        combatAggravated: false,
      },
      blockPenalties: [],
      interceptBurnGrants: [],
      attachOnBlock: [],
      usedInPlayAbilities: [],
      corruptionUnlocks: [],
      blockCosts: [],
      noUnlock: false,
      afterResolutionDamage: [],
      queuedCombats: [],
      blockRestrictions: { noAllies: false, noVampires: false, noTitled: false, cannotBlock: [] },
      cycle: newCycle([tf.seat]), // placeholder; rebuilt below
    };
    frame.cycle = newCycle(
      sequencingOrder(this.state, tf.seat, defendersFor(this.state, frame)),
    );
    this.state.frames.push(frame);
    this.notifyActionAnnounced(frame);
    if (inherentStealth > 0) {
      this.emit({ type: "StealthModified", actionId, delta: inherentStealth, source: kind });
    }
  }

  /**
   * "Cards that are burned or discarded are returned to their OWNER's ash
   * heap" (p. 16). The single funnel, so a fifth caller cannot invent its
   * own spelling — the `minionActionsThisPhase` pattern.
   * docs/ash-heap-design.md §3
   */
  private toAshHeap(seatId: SeatId, card: CardInstance): void {
    this.emit({ type: "CardToAshHeap", seat: seatId, cardId: card.id, name: card.name });
  }

  /**
   * "Move a wraith or zombie ally from your ash heap to your ready region
   * with life equal to its starting life" (Split the Veil) — the first
   * effect in the pool that puts a MINION back into play. Every other
   * ash-heap card moves a library card.
   *
   * No new zone is needed: the ash heap holds `CardInstance`s and the
   * registry answers `allyEntry`, which is exactly what `AllyEnteredPlay`
   * wants. **`recruited: false`** — the ally is MOVED to the ready region,
   * not played as an action, so p. 22's "cannot act the turn it is
   * recruited" does not apply. docs/wraith-zombie-design.md §5
   */
  returnAllyFromAshHeap(seatId: SeatId, cardId: CardInstanceId): void {
    const seat = getSeat(this.state, seatId);
    const card = (seat.ashHeap ?? []).find((c) => c.id === cardId);
    if (!card) return;
    const handler = this.registry[card.name];
    const ally = handler?.allyEntry?.("basic");
    if (!ally) return;
    this.emit({
      type: "CardLeftZone",
      seat: seatId,
      cardId: card.id,
      name: card.name,
      zone: "ashHeap",
    });
    this.emit({
      type: "AllyEnteredPlay",
      seat: seatId,
      minion: card.id,
      cardId: card.id,
      name: card.name,
      life: ally.life,
      strength: ally.strength,
      bleed: ally.bleed,
      recruited: false,
      cost: handler?.poolCost ?? 0,
      ...(ally.disciplines ? { disciplines: ally.disciplines } : {}),
    });
    this.emit({
      type: "PermanentEnteredPlay",
      seat: seatId,
      cardId: card.id,
      name: card.name,
      attachedTo: card.id,
      statics: ally.statics,
      tags: ally.tags,
    });
  }

  /**
   * "Search your library (shuffle afterward), hand, and/or ash heap for a
   * Discipline master card and PUT IT ON this new vampire" (Waters of
   * Duat, Childe of the Revolution). The card is not PLAYED — no cost, no
   * `CardPlayed` — it is moved from an out-of-play zone straight onto a
   * minion, which is the same wording the rulebook uses for diablerie's
   * Discipline gain (p. 34). docs/token-vampire-design.md §6
   */
  attachFromZone(args: {
    seat: SeatId;
    cardId: CardInstanceId;
    zone: "library" | "hand" | "ashHeap";
    attachTo: MinionId;
  }): void {
    const seat = getSeat(this.state, args.seat);
    const pile =
      args.zone === "hand" ? seat.hand : args.zone === "library" ? seat.library : (seat.ashHeap ?? []);
    const card = pile.find((c) => c.id === args.cardId);
    if (!card) return;
    const handler = this.registry[card.name];
    this.emit({
      type: "CardLeftZone",
      seat: args.seat,
      cardId: card.id,
      name: card.name,
      zone: args.zone,
    });
    this.putPermanentInPlay({
      card,
      seat: args.seat,
      attachTo: args.attachTo,
      statics: handler?.permanentStatics ?? {},
      tags: handler?.permanentTags ?? [],
    });
  }

  removeFromAshHeap(seatId: SeatId, cardId: CardInstanceId): void {
    const card = (getSeat(this.state, seatId).ashHeap ?? []).find((c) => c.id === cardId);
    if (!card) return;
    this.emit({
      type: "CardRemovedFromGame",
      seat: seatId,
      cardId: card.id,
      name: card.name,
    });
  }

  /** "Exchange one card from your hand for one card in your ash heap"
   *  (Garibaldi-Meucci Museum) — the retrieval half. */
  takeFromAshHeap(seatId: SeatId, cardId: CardInstanceId): void {
    const seat = getSeat(this.state, seatId);
    const idx = (seat.ashHeap ?? []).findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    this.emit({ type: "CardTakenFromAshHeap", seat: seatId, cardId });
  }

  private discardCard(seatId: SeatId, cardId: string, replace = true): void {
    const seat = getSeat(this.state, seatId);
    const idx = seat.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new Error(`card not in hand: ${cardId}`);
    const [card] = seat.hand.splice(idx, 1);
    if (!card) throw new Error("unreachable");
    this.emit({ type: "CardDiscarded", seat: seatId, cardId: card.id });
    this.toAshHeap(seatId, card);
    if (replace) this.drawToReplace(seatId);
    // "If you use that discard phase action to discard a card requiring an
    // Anarch…" (Powerbase: Los Angeles) — cards in play see the discard.
    for (const s of this.state.seats) {
      for (const p of [...s.permanents]) {
        this.registry[p.card.name]?.onDiscard?.(
          p,
          { seat: p.controller ?? s.id, minion: null },
          { seat: seatId, cardName: card.name },
          this,
        );
      }
    }
  }

  /** "Whenever you play a card from your hand, you draw another from your
   *  library to replace it" (p. 7); an empty library just stops drawing.
   *  `kind` separates a real replacement from a plain draw-up (a hand-size
   *  increase, "draw N extra cards"), because a counter sink intercepts
   *  only the former (docs/counter-sinks-design.md §2). */
  /** Returns true only when a card actually moved from library to hand —
   *  a counter sink or a store redirect means it did not, and a caller
   *  looping until the hand is full must stop rather than ask again. */
  private drawToReplace(seatId: SeatId, kind: "replace" | "extra" = "replace"): boolean {
    const seat = getSeat(this.state, seatId);
    // "Each time you would replace a card, instead burn 1 counter from
    // this card" (Visit from the Capuchin). This goes FIRST and keeps
    // precedence over the redirect below: a draw that does not happen
    // cannot be redirected (docs/library-search-design.md §6).
    if (kind === "replace" && this.spendCounterSink(seatId)) return false;
    // "If you would draw a card from your library, you can draw one of
    // those cards instead" (Black Market Cache, Shilmulo Tarot). Only
    // asked when a live store can actually supply the draw, so an empty
    // or absent store costs no decision.
    const source = this.drawRedirectSource(seatId);
    if (source) {
      this.raiseChoice({
        seat: seatId,
        cardName: source.card.name,
        cardId: source.card.id,
        key: "drawFrom",
      });
      return false;
    }
    this.drawFromLibrary(seatId);
    return true;
  }

  /** The actual library draw, with no redirect check — called by
   *  `drawToReplace` and by the redirect choice's own answer, which must
   *  NOT go back through `drawToReplace` or it would re-raise forever. */
  drawFromLibrary(seatId: SeatId): void {
    const seat = getSeat(this.state, seatId);
    const card = seat.library.shift();
    if (card) {
      seat.hand.push(card);
      this.emit({ type: "CardDrawn", seat: seatId, cardId: card.id });
    }
  }

  /** A card in play of `seat`'s that may supply a draw in place of the
   *  library right now — it must hold cards, and its own condition must
   *  hold (Shilmulo Tarot: "while this Ravnos is ready"). */
  private drawRedirectSource(seatId: SeatId): PermanentInPlay | null {
    for (const { entry, owner } of this.allEntries()) {
      if ((entry.controller ?? owner.seat) !== seatId) continue;
      if (!entry.stored || entry.stored.length === 0) continue;
      if (!this.registry[entry.card.name]?.canRedirectDraw?.(entry, owner, this.state)) {
        continue;
      }
      return entry;
    }
    return null;
  }

  /** Burn a counter off a card attached to this minion that pays to keep
   *  it locked (Touch of Oblivion). Returns true when a counter was spent
   *  in place of the unlock. */
  private spendUnlockSink(m: MinionState): boolean {
    for (const p of [...m.attached]) {
      if (p.counterSink?.instead !== "unlock") continue;
      if ((p.counters ?? 0) <= 0) continue;
      this.addCounters(p.card.id, -1);
      if (p.counterSink.burnWhenEmpty && (p.counters ?? 0) <= 0) {
        this.burnPermanent(p.card.id);
      }
      return true;
    }
    return false;
  }

  /** Burn a counter off this seat's replacement sink, if it has one with
   *  counters left. Returns true when the counter was spent in place of
   *  the draw. */
  private spendCounterSink(seatId: SeatId): boolean {
    for (const p of [...getSeat(this.state, seatId).permanents]) {
      if (p.counterSink?.instead !== "replacement") continue;
      if ((p.counters ?? 0) <= 0) continue;
      this.addCounters(p.card.id, -1);
      if (p.counterSink.burnWhenEmpty && (p.counters ?? 0) <= 0) {
        this.burnPermanent(p.card.id);
      }
      return true;
    }
    return false;
  }

  private playCard(option: Extract<LegalOption, { kind: "playCard" }>): void {
    const dpSeat = this.currentSeatOfTop();
    const seat = getSeat(this.state, dpSeat);
    const idx = seat.hand.findIndex((c) => c.id === option.card);
    if (idx < 0) throw new Error(`card not in hand: ${option.card}`);
    const [card] = seat.hand.splice(idx, 1);
    if (!card) throw new Error("unreachable");
    const handler = this.handler(card.name);

    const asAction = handler.isActionCard === true;
    const isMaster = handler.isMasterCard === true;
    // "A vampire can play only one X each round/combat" (p. 32): record
    // the play against the current combat now.
    const modeLimit = handler.modeCombatLimit?.(option.mode, option.params["variant"]);
    if (handler.isCombatCard && (handler.combatLimit || modeLimit)) {
      const cf = this.combatFrame();
      if (cf) {
        if (handler.combatLimit === "round") cf.playedThisRound.push(card.name);
        else if (handler.combatLimit) cf.playedThisCombat.push(card.name);
        // A per-MODE limit ("only one at superior each combat", Terror
        // Frenzy) records the mode too, so the other mode stays free.
        if (modeLimit === "combat") cf.playedThisCombat.push(`${card.name}:${option.mode}`);
        else if (modeLimit === "round") cf.playedThisRound.push(`${card.name}:${option.mode}`);
      }
    }
    this.emit({
      type: "CardPlayed",
      cardId: card.id,
      name: card.name,
      seat: seat.id,
      minion: option.minion,
      mode: option.mode,
    });
    // Non-action cards pay their cost when played, win or lose; action
    // cards defer cost to resolution (p. 27) and the once-per-turn record
    // to announcement (a canceled action card is replayable, p. 16).
    const payer = option.minion ? findMinion(this.state, option.minion) : null;
    // The chosen attach target rides in `params.target` — but that key is
    // OVERLOADED: Deflection's target is a SEAT. Resolving it through
    // findMinion is total and answers null for a seat id, so a card that
    // targets a seat prices exactly as it always did (design §2).
    const targetMinion = findMinion(this.state, option.params["target"] ?? "")?.id ?? null;
    const price = asAction
      ? { blood: 0, pool: 0 }
      : this.priceOf(
          handler,
          option.mode,
          option.params["variant"],
          payer,
          targetMinion,
          seat.id,
        );
    if (!asAction) this.consumeOncePlayCostMods(handler, option.mode, option.params["variant"]);
    if (price.blood > 0 && option.minion) {
      this.emit({
        type: "BloodBurned",
        minion: option.minion,
        amount: price.blood,
      });
    }
    // Masters pay pool when played; equipment (an action card) pays at
    // resolution, only on success (p. 27).
    if (price.pool > 0) {
      this.emit({ type: "PoolBurned", seat: seat.id, amount: price.pool });
    }
    if (isMaster) {
      if (handler.isOutOfTurnMaster) {
        // Counts against the next master phase, even if cancelled (p. 8).
        seat.outOfTurnMasterUsed = true;
      } else {
        const top = this.top();
        if (top && top.kind === "turn" && top.phase === "master") {
          top.masterActionsLeft -= 1;
        }
      }
    }
    const af = this.action();
    if (af && option.minion) {
      af.played.push({ minion: option.minion, card: card.name, mode: option.mode });
    }
    if (!asAction && option.minion) {
      getMinion(this.state, option.minion).playedSinceUnlock.push(card.name);
    }
    const afForDraw = this.action();
    // "Those cards are not replaced until the end of the action" (Consign
    // to Oblivion superior) — the same deferral as the static handler
    // flag, decided at play time from the action rather than the card.
    const delayedByAction =
      !!afForDraw &&
      (handler.costTypes?.(option.mode, option.params["variant"]) ?? []).some((t) =>
        afForDraw.delayReplaceTypes.includes(t),
      );
    if (handler.delayedReplace === "unlock") {
      seat.delayedDraws += 1;
    } else if (handler.delayedReplace === "discard") {
      // "Do not replace until your next DISCARD phase" (Mirror Walk).
      seat.delayedDrawsDiscard = (seat.delayedDrawsDiscard ?? 0) + 1;
    } else if (delayedByAction && afForDraw) {
      afForDraw.drawAfter.push(seat.id);
    } else if (handler.delayedReplace === "afterAction" && afForDraw) {
      afForDraw.drawAfter.push(seat.id);
    } else {
      this.drawToReplace(seat.id);
    }
    // The as-played window: only cancel-as-played and wake effects may be
    // used inside it (p. 7); normal sequencing order applies — outside an
    // action, the impulse still starts with the turn's Methuselah (p. 8),
    // not necessarily the card's player (out-of-turn masters).
    const turnFrame = this.state.frames[0];
    const baseSeat =
      turnFrame && turnFrame.kind === "turn" ? turnFrame.seat : seat.id;
    const order = af
      ? sequencingOrder(this.state, af.actingSeat, defendersFor(this.state, af))
      : sequencingOrder(this.state, baseSeat, []);
    this.state.frames.push({
      kind: "cardPlay",
      card,
      seat: seat.id,
      minion: option.minion,
      mode: option.mode,
      params: option.params,
      asAction,
      isMaster,
      isCombat: !!this.handler(card.name).isCombatCard,
      isReaction: !!this.handler(card.name).isReactionCard,
      isFrenzy: !!this.handler(card.name).isFrenzy,
      // "Cancel a STRIKE card as it is played" (The Vozhd of Gravesend) —
      // per-MODE, since a dual-mode combat card can have a strike mode and
      // a non-strike one. docs/vozhd-allies-design.md §5
      isStrike: !!this.handler(card.name).isStrikeCard?.(option.mode),
      // Printed keywords ("Grapple.", "Aim.") — Sword of the Archangel
      // cancels by them. docs/weapon-riders-design.md §5
      ...(() => {
        const k = this.handler(card.name).cardKeywords?.() ?? [];
        return k.length > 0 ? { keywords: k } : {};
      })(),
      ...(this.handler(card.name).frenzyTargetsOpponent?.(
        option.mode,
        option.params["variant"],
      )
        ? { frenzyOnOpponent: true }
        : {}),
      // "Their controller can burn N pool to cancel this card as it is
      // played" (Golconda) — who may pay depends on what this play
      // TARGETS, so it is computed here, from the option, and stamped on
      // the frame like every other as-played question.
      // docs/cross-table-masters-design.md §2
      ...(() => {
        const p = this.handler(card.name).payToCancelFor?.(
          this.state,
          seat.id,
          option.params,
        );
        return p ? { payToCancel: p } : {};
      })(),
      paid: price,
      // Denormalized once, here, so a cancel-as-played effect reading
      // "a card requiring Auspex" is a plain array read on the frame —
      // the same treatment `isMaster` gets.
      requires:
        this.handler(card.name).requiresDisciplines?.(
          option.mode,
          option.params["variant"],
        ) ?? [],
      canceled: false,
      cycle: newCycle(order),
    });
  }

  private currentSeatOfTop(): SeatId {
    const top = this.top();
    if (!top) throw new Error("no frame");
    switch (top.kind) {
      case "turn":
        return top.seat;
      case "combat":
        return this.combatDecision(top).seat;
      case "diablerieOffer":
        return top.offerSeat;
      case "choice":
        return top.seat;
      default:
        return cycleSeat(top.cycle);
    }
  }

  private handler(name: string): CardHandler {
    const h = this.registry[name];
    if (!h) throw new Error(`no handler registered for card: ${name}`);
    return h;
  }

  // -- temporary hand size (docs/temporary-hand-size-design.md) --------------

  /**
   * "+2 hand size until the end of the turn" / "this combat, +1 hand
   * size": record the grant on the frame whose lifetime it shares, then
   * draw up immediately (p. 7).
   *
   * The frame going away is the expiry, so there is nothing to schedule
   * and nothing to clear.
   */
  addHandSizeBonus(args: {
    seat: SeatId;
    amount: number;
    scope: "turn" | "combat";
    cardName: string;
    cardId: CardInstanceId;
    /** "…until your next DISCARD PHASE" (Fotini) — lifts earlier than the
     *  frame that holds it. */
    until?: "discardPhase";
  }): void {
    const frame =
      args.scope === "combat"
        ? this.combatFrame()
        : ([...this.state.frames].reverse().find((f) => f.kind === "turn") as
            | TurnFrame
            | undefined);
    if (!frame) return;
    const grant: HandSizeGrant = {
      seat: args.seat,
      amount: args.amount,
      cardName: args.cardName,
      cardId: args.cardId,
      ...(args.until ? { until: args.until } : {}),
    };
    frame.handSizeBonus = [...(frame.handSizeBonus ?? []), grant];
    // "Whenever an effect changes your hand size … immediately draw up to
    // match your hand size" (p. 7).
    this.reconcileHandSize(args.seat);
  }

  /**
   * The other half of p. 7, which the engine had never had: a hand size
   * that FALLS sheds cards. Called where a grant's frame has already gone
   * — after the turn frame is replaced, after the combat frame is popped
   * — so `handSizeOf` no longer counts the bonus when the test runs.
   */
  private expireHandSizeBonus(grants: HandSizeGrant[] | undefined): void {
    for (const seat of new Set((grants ?? []).map((g) => g.seat))) {
      const g = grants!.find((x) => x.seat === seat)!;
      this.reconcileHandSizeDown(seat, g.cardName, g.cardId);
    }
  }

  /**
   * "Immediately discard down to … match your hand size" (p. 7), one card
   * at a time and re-raised until the hand matches — the `unlockToll`
   * shape, because each answer changes the board the next option list is
   * computed against.
   */
  private reconcileHandSizeDown(
    seatId: SeatId,
    cardName: string,
    cardId: CardInstanceId,
  ): void {
    const seat = getSeat(this.state, seatId);
    if (seat.ousted) return;
    if (seat.hand.length <= handSizeOf(this.state, seatId)) return;
    this.raiseChoice({ seat: seatId, cardName, cardId, key: HAND_SIZE_DOWN });
  }

  /**
   * The discard-down question is answered by the ENGINE, not by a card
   * handler: p. 7 is a rule of the game, and the two cards that reach it
   * are a bespoke handler and a pure `compileSpec` card, so a card-owned
   * version would be written twice — one question answered in two places,
   * which is how `modifyVotes`/`restrictVotes` and the two
   * after-resolution probes each drifted. §4
   */
  private choiceOptionsFor(frame: ChoiceFrame): LegalOption[] {
    if (frame.key === HAND_SIZE_DOWN) {
      return getSeat(this.state, frame.seat).hand.map((c) => ({
        id: `choice:${frame.cardName}:${frame.cardId}:${HAND_SIZE_DOWN}:${c.id}`,
        kind: "answerChoice" as const,
        label: `Discard down to hand size: ${c.name}`,
        params: { card: c.id },
      }));
    }
    if (frame.key === CONTEST) {
      const what = frame.params["what"];
      const id = frame.params["id"] ?? "";
      const out: LegalOption[] = [];
      if (what === "card") {
        const held = (getSeat(this.state, frame.seat).contested ?? []).find(
          (c) => c.card.id === id,
        );
        if (!held) return [];
        // "The cost to contest a card is 1 pool." A Methuselah who cannot
        // find it is not offered it — and is not forced to yield either;
        // p. 17 names no such rule, so the yield below is their only move.
        if (getSeat(this.state, frame.seat).pool >= 1) {
          out.push({
            id: `choice:${CONTEST}:${id}:${CONTEST}:pay`,
            kind: "answerChoice" as const,
            label: `Pay 1 pool to keep contesting ${held.card.name}`,
            params: { answer: "pay" },
          });
        }
        out.push({
          id: `choice:${CONTEST}:${id}:${CONTEST}:yield`,
          kind: "answerChoice" as const,
          label: `Yield ${held.card.name} (it is burned)`,
          params: { answer: "yield" },
        });
        return out;
      }
      const m = findMinion(this.state, id);
      if (!m?.titleContest) return [];
      // "The cost to contest a title is 1 blood, which is PAID BY THE
      // VAMPIRE" — not by their Methuselah, which is why an empty vampire
      // is forced to yield (handled before this frame is ever raised).
      if (m.blood >= 1) {
        out.push({
          id: `choice:${CONTEST}:${id}:${CONTEST}:pay`,
          kind: "answerChoice" as const,
          label: `${m.name} burns 1 blood to keep contesting ${m.titleContest.title}`,
          params: { answer: "pay" },
        });
      }
      out.push({
        id: `choice:${CONTEST}:${id}:${CONTEST}:yield`,
        kind: "answerChoice" as const,
        label: `${m.name} yields the title of ${m.titleContest.title}`,
        params: { answer: "yield" },
      });
      return out;
    }
    // Diablerie's older-victim Discipline gain (p. 34) — engine-owned for
    // the same reason as the discard-down: it is a RULE, not a card, and
    // no card is involved in it at all.
    if (frame.key === DIABLERIE_DISCIPLINE) {
      const minion = frame.params["minion"] ?? "";
      // The diablerist can be gone by now — the blood hunt may have burned
      // them. An empty MANDATORY frame is popped by settle, which is
      // exactly right: there is nobody left to put a card on.
      if (!findMinion(this.state, minion)) return [];
      const seat = getSeat(this.state, frame.seat);
      const zones: Array<["library" | "hand" | "ashHeap", CardInstance[]]> = [
        ["library", seat.library],
        ["hand", seat.hand],
        ["ashHeap", seat.ashHeap ?? []],
      ];
      const out: LegalOption[] = [];
      for (const [zone, pile] of zones) {
        for (const c of pile) {
          if (!(this.registry[c.name]?.permanentTags ?? []).includes("discipline")) continue;
          out.push({
            id: `choice:${DIABLERIE_DISCIPLINE}:${frame.cardId}:${DIABLERIE_DISCIPLINE}:${zone}:${c.id}`,
            kind: "answerChoice" as const,
            label: `Gain ${c.name} (${zone})`,
            params: { card: c.id, zone },
          });
        }
      }
      // "You are free not to find any" (p. 48), and the shuffle happens
      // either way (p. 14) — so this is an answer, not a decline.
      out.push({
        id: `choice:${DIABLERIE_DISCIPLINE}:${frame.cardId}:${DIABLERIE_DISCIPLINE}:none`,
        kind: "answerChoice" as const,
        label: "Gain no Discipline",
        params: { card: "none" },
      });
      return out.map((o) => this.withPickedCardName(o));
    }
    const options =
      this.handler(frame.cardName).choiceOptions?.(frame, this.state, this.registry) ?? [];
    return options.map((o) => this.withPickedCardName(o));
  }

  /**
   * Name the card an answer picks, if it picks one.
   *
   * A choice that searches a library, an ash heap or a store puts the card
   * ID in its params — and every library is face down in the masked view,
   * including its owner's, so a client cannot resolve that id to anything.
   * The name is only ever inside the label, as prose.
   *
   * Done HERE, once, rather than in each handler that builds a card
   * choice: there are a dozen of those and a thirteenth would forget. The
   * engine has the unredacted state, so it can look in every zone the card
   * could be in. Nothing is revealed that the answer itself does not
   * already reveal — this is the option the asking seat is being offered.
   */
  private withPickedCardName(o: LegalOption): LegalOption {
    if (o.kind !== "answerChoice" || o.card !== undefined) return o;
    for (const value of Object.values(o.params)) {
      const name = this.cardNameAnywhere(value);
      if (name) return { ...o, card: name };
    }
    return o;
  }

  private cardNameAnywhere(cardId: string): string | null {
    for (const s of this.state.seats) {
      for (const zone of [s.hand, s.library, s.ashHeap ?? []]) {
        const hit = zone.find((c) => c.id === cardId);
        if (hit) return hit.name;
      }
      for (const p of [...s.permanents, ...s.minions.flatMap((m) => m.attached)]) {
        const hit = p.stored?.find((c) => c.id === cardId);
        if (hit) return hit.name;
        if (p.card.id === cardId) return p.card.name;
      }
    }
    return null;
  }

  /** The answer to the above. `replace: false`: a discard-DOWN is not a
   *  cost and not a play — the hand is above its size, so nothing is drawn
   *  back. (A discard paid as a COST is replaced; the two look identical
   *  in code, which is the trap the unlock-tolls wave found.) */
  private applyChoiceFor(
    frame: ChoiceFrame,
    option: Extract<LegalOption, { kind: "answerChoice" }>,
  ): void {
    if (frame.key === HAND_SIZE_DOWN) {
      const card = option.params["card"];
      if (card) this.discardFromHand(frame.seat, card, false);
      // Still over? Ask again. The stack is clean: `choose()` pops before
      // calling this, for exactly this loop.
      this.reconcileHandSizeDown(frame.seat, frame.cardName, frame.cardId);
      return;
    }
    if (frame.key === CONTEST) {
      const yielding = option.params["answer"] === "yield";
      const id = frame.params["id"] ?? "";
      if (frame.params["what"] === "card") {
        const seat = getSeat(this.state, frame.seat);
        const held = (seat.contested ?? []).find((c) => c.card.id === id);
        if (!held) return;
        if (!yielding) {
          this.emit({ type: "PoolBurned", seat: frame.seat, amount: 1 });
          this.emit({
            type: "ContestPaid",
            seat: frame.seat,
            cardId: held.card.id,
            name: held.card.name,
          });
          return;
        }
        // "A yielded card is burned. ANY CARDS OR COUNTERS STACKED ON THE
        // YIELDED CARD ARE ALSO BURNED" — which is what keeping the whole
        // object in the pile makes possible.
        this.emit({
          type: "ContestYielded",
          seat: frame.seat,
          cardId: held.card.id,
          name: held.card.name,
        });
        const stacked = held.minion ? held.minion.attached : [];
        for (const p of stacked) {
          if (p.card.id === held.card.id) continue;
          this.toAshHeap(p.owner ?? frame.seat, p.card);
        }
        this.emit({
          type: "CardBurned",
          cardId: held.card.id,
          name: held.card.name,
          seat: held.permanent?.owner ?? frame.seat,
        });
        return;
      }
      const m = findMinion(this.state, id);
      if (!m?.titleContest) return;
      if (!yielding) {
        this.emit({ type: "BloodBurned", minion: m.id, amount: 1 });
        return;
      }
      this.emit({ type: "TitleYielded", minion: m.id, title: m.titleContest.title });
      return;
    }
    if (frame.key === DIABLERIE_DISCIPLINE) {
      const card = option.params["card"];
      const zone = option.params["zone"] as "library" | "hand" | "ashHeap" | undefined;
      const minion = frame.params["minion"];
      if (card && card !== "none" && zone && minion && findMinion(this.state, minion)) {
        this.attachFromZone({ seat: frame.seat, cardId: card, zone, attachTo: minion });
      }
      // "If you search your library … you must shuffle it afterwards"
      // (p. 14) — either way, because the searcher looked at it.
      this.shuffleLibrary(frame.seat);
      return;
    }
    this.handler(frame.cardName).applyChoice?.(frame, option, this);
  }
}

/**
 * The §9.4 policy layer, outside the engine core: advance to the next
 * decision the seat actually wants to see. With the per-seat toggle off
 * (the default, per owner decision) this returns every decision point.
 */
export function nextDecision(engine: VtesEngine): DecisionPoint | null {
  for (;;) {
    const dp = engine.decision();
    if (!dp) return null;
    const seat = getSeat(engine.state, dp.seat);
    const only = dp.options.length === 1 ? dp.options[0] : undefined;
    if (seat.autoPassWhenOnlyPass && only && only.kind === "pass") {
      engine.choose(only.id);
      continue;
    }
    return dp;
  }
}

export function readyUnlockedMinions(state: GameState, seat: SeatId): MinionState[] {
  return getSeat(state, seat).minions.filter((m) => isReady(m) && !m.locked);
}
