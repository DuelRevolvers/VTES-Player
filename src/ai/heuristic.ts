/**
 * AI v1 — a scoring policy agent (phase 5, docs/ai-v1-design.md).
 *
 * Three rules govern this file, and they are not style preferences:
 *
 * 1. **It sees only the `PlayerView`.** Architecture principle 5 makes
 *    that projection the hidden-information boundary, and an AI that
 *    reaches around it would be cheating *and* would stop working the
 *    moment it ran as a remote seat in phase 6. There is no `GameState`
 *    import here on purpose.
 * 2. **It is deterministic.** Every tie is broken by a seeded RNG the
 *    caller supplies, never `Math.random`. Architecture principle 2 says
 *    a game is its seed plus its command log; an AI that rolled its own
 *    dice would make replays a lie.
 * 3. **It only ever returns an offered option id.** It scores the list it
 *    is given and picks from it — the legal-move generator is the single
 *    source of legality (principle 4), and the AI never reasons about
 *    whether something is allowed.
 *
 * It is a POLICY, not a search: one pass over the options, a score each,
 * highest wins. No lookahead, no simulation of its own. That is enough to
 * play a coherent game and is the honest v1; a searching agent needs
 * `applyTo`-style cloning and belongs in v2.
 */

import type { Agent, PlayerView } from "../engine/agent.ts";
import type { DecisionPoint, LegalOption, PlayEffect, PlayEffectTag, WindowId } from "../engine/options.ts";
import type { MinionState, SeatId } from "../engine/state.ts";

/**
 * Every weight the policy uses, in one place so it can be read, argued
 * with and tuned without reading the code. Positive is "want to do",
 * negative is "avoid".
 */
export interface Weights {
  /** Bleeding the prey is how you win (p. 4: you win by ousting them). */
  bleedPrey: number;
  /** …per point of bleed the action is actually worth. */
  bleedPerPoint: number;
  /** Bleeding anyone else transfers pool to a player you do not oust. */
  bleedNonPrey: number;
  /** A vampire with no blood MUST hunt (p. 21), and one nearly empty is
   *  about to be useless. */
  huntWhenEmpty: number;
  hunt: number;
  /**
   * A hunt that would put NO blood on the vampire — 43.9% of the hunt
   * options in real games, because the vampire is already at capacity and
   * p. 6 sends the excess to the blood bank rather than to the
   * Methuselah's pool.
   *
   * It is not free: acting LOCKS the vampire (p. 25), so a futile hunt
   * trades the ability to block for nothing. Hence below `pass`. Kept as
   * a weight rather than written into the code so the claim is
   * falsifiable — `--weights huntFutile=1` restores the old behaviour of
   * pricing it like any other hunt.
   */
  huntFutile: number;
  /** Getting vampires out is the whole early game. */
  influenceTransfer: number;
  /**
   * WHICH vampire the counter goes on, which the policy used not to ask
   * at all: every transfer scored the same, so ties broke on the random
   * stream and the AI chose by coin flip.
   *
   * Divided by the counters still needed, so it is worth most on a
   * vampire that is nearly out. That one term does both jobs — **finish
   * what you started**, because counters already spent do nothing until
   * the vampire is in play, and **cheap first**, because a 4-capacity
   * body arrives four turns before an 11.
   */
  influenceProgress: number;
  /**
   * Among vampires needing the SAME number of counters, prefer the bigger
   * one: same price, more vampire. Deliberately small, so it breaks ties
   * without ever outweighing being closer to done.
   *
   * **Unproven, and kept knowingly.** Two bench runs put it at +0.033 and
   * +0.049 VP — consistently positive and consistently inside the margin
   * (±0.113 over 800 games), so showing it would take some 4,000. Kept
   * because the reasoning stands on its own and because a deterministic
   * tie-break is better hygiene than the random one it replaces; not
   * claimed as an improvement.
   */
  influenceCapacity: number;
  /**
   * Per card in hand this vampire could actually play — and **ZERO, as a
   * MEASURED NEGATIVE RESULT.** Do not raise it without reading this.
   *
   * The idea is obvious and wrong: a vampire whose Disciplines unlock six
   * cards you are holding looks worth more than one that unlocks none.
   * The engine reports the count (`LegalOption.playableCards`), the
   * candidates really do differ on it in **28.1%** of the influence
   * choices with more than one candidate, and at a weight of 0.5 it
   * changes **9.0%** of those decisions — so it is live, not inert.
   *
   * It just does not help, and at strength it HURTS: weight 2 is
   * **−0.177 VP on Hecata** (margin ±0.110), with the other three decks
   * neutral. A behavioural probe says exactly why — the first vampire
   * reaches play at turn **6.46 instead of 5.08**, because preferring a
   * *better* vampire diverts counters from *finishing* a nearly-done one.
   * That works directly against the one change that has produced a large
   * measured win (bodies out fast, turn 8 → 3), and getting a body onto
   * the table beats getting the right body onto it.
   *
   * Kept at 0, with the option field left in place, so the experiment is
   * one flag away and nobody re-derives a dead end
   * (docs/richer-options-design.md §7).
   */
  influenceUnlocks: number;
  cryptDraw: number;
  influenceOut: number;
  /** Rescuing and diablerising are situational but usually good. */
  rescue: number;
  diablerize: number;
  /** Blocking: worth roughly what the action would have cost you. */
  blockBleed: number;
  blockPerBleedPoint: number;
  /**
   * Blocking something that is not a bleed, BY WHAT THE ACTION IS.
   *
   * This was a single `blockOther` for every one of them, which put
   * stopping a **diablerie** — a vampire destroyed for good, its blood and
   * a Discipline handed to the eater (p. 34) — at the same price as
   * stopping a **hunt**, which gains its actor a point of blood and costs
   * the blocker a lock and a combat to prevent.
   */
  blockDiablerize: number;
  blockHunt: number;
  /** Rescuing a vampire out of torpor, or walking one out (p. 23): a body
   *  the table is about to get back. */
  blockRescue: number;
  /** An action card — unknown in detail, but it cost them a card and an
   *  action, which is a floor on what it was worth to them. */
  blockCardEffect: number;
  /** Anything `ActionKind` grows later. */
  blockOther: number;
  /** Blocking with a minion that will lose the fight badly. */
  blockOutmatched: number;
  /** Playing cards at all — a small positive so the AI uses its hand,
   *  scaled by how much pool it costs. */
  playCard: number;
  poolCost: number;
  /**
   * What the card DOES, per family, per point
   * (docs/richer-options-design.md §5).
   *
   * Until these existed the policy scored every play by its cost and the
   * window alone, so a master that wins the game and a master that does
   * nothing were worth the same. The engine now reports the families on
   * the option, so this is a price list rather than a second model of the
   * card pool.
   *
   * The ordering is the claim, not the exact numbers: pool moves the game
   * (VTES is won by ousting), a bleed is how pool moves, denial is worth
   * about what it denies, and a card on the table is worth having but
   * pays out later than any of them.
   */
  effectValue: Record<PlayEffectTag, number>;
  /** Never oust yourself. Dominates everything. */
  selfOustGuard: number;
  /** Combat. */
  strikeLethal: number;
  strikeDamage: number;
  dodgeWhenLosing: number;
  pressToFinish: number;
  pressWhenLosing: number;
  /** Voting with the referendum you called, against everyone else's. */
  voteOwn: number;
  voteAgainstOthers: number;
  /** Taking the Edge is nearly free pool. */
  gainEdge: number;
  /** Announcing a withdrawal (p. 38). Offered only once the library is
   *  exhausted, which is a losing position — 1 guaranteed victory point
   *  beats decking out, so this is worth taking when it appears. */
  withdraw: number;
  /** Discarding: shed the least useful card, but discarding is a cost. */
  discard: number;
  /**
   * Answering a card's question rather than declining it.
   *
   * Must stay above `pass`: declining an OPTIONAL ChoiceFrame is a plain
   * pass, so anything lower makes the AI refuse every optional payoff in
   * the game. Which answer it picks is still offered order.
   */
  answerChoice: number;
  /** A tiny bias toward passing, so the AI does not take pointless
   *  actions purely because they scored 0.001. */
  pass: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  bleedPrey: 8,
  bleedPerPoint: 4,
  bleedNonPrey: -6,
  huntWhenEmpty: 20,
  // Below `pass` (0.5): a hunt that gains nothing still locks the vampire.
  huntFutile: -0.5,
  hunt: 1,
  influenceTransfer: 6,
  influenceProgress: 6,
  influenceCapacity: 0.1,
  // ZERO by measurement, not by omission — see the Weights comment.
  influenceUnlocks: 0,
  cryptDraw: 3,
  /**
   * Left at 12, and MEASURED rather than assumed.
   *
   * Raising it to 30 looked obviously right — moving a finished vampire
   * into play costs no transfer, where a transfer that would finish a
   * different one now scores up to ~12.4 and could outrank it. The bench
   * says it changes **nothing**: 240 games, an exactly identical result,
   * because the ordering does not matter — the AI adds the last counter
   * first and then moves BOTH vampires out in the same phase.
   *
   * Reverted rather than shipped, because a weight that provably does
   * nothing is noise in a table whose whole purpose is to be argued with.
   */
  influenceOut: 12,
  rescue: 5,
  diablerize: 9,
  blockBleed: 3,
  blockPerBleedPoint: 3,
  // A vampire eaten is gone for good and its eater is stronger for it, so
  // this is worth a bad combat.
  blockDiablerize: 25,
  // A hunt gains its actor 1 blood. Blocking costs a lock, a combat, and
  // the chance to block something that matters — so it is deliberately
  // BELOW `pass`, and the AI lets hunts through.
  blockHunt: 0,
  blockRescue: 4,
  blockCardEffect: 3,
  blockOther: 1,
  blockOutmatched: -6,
  playCard: 2,
  poolCost: -2,
  /**
   * MEASURED, and the result was not the one I expected.
   *
   * The first version priced all sixteen families on plausible reasoning
   * (a card on the table is worth having, combat advantage is worth
   * having, denial is worth about what it denies). Four mirror matches of
   * 800 games said that policy was **better on Hecata (+0.115 ±0.112) and
   * WORSE on Toreador (−0.155, replicated on fresh deals)** — which fails
   * this project's own bar of "never measurably worse".
   *
   * Pricing only what moves POOL — the currency the game is actually won
   * in (p. 43) — clears the bar: Toreador **+0.106 ±0.105**, Hecata
   * +0.056, Brujah +0.045, Nosferatu −0.099, the last three inside their
   * margins. So that is what ships.
   *
   * THE ZEROES ARE A RESULT, NOT AN OMISSION. What is NOT established is
   * which of the twelve is responsible: they were only ever measured
   * together, and "board and combat are harmful" would be over-claiming
   * from the runs actually made. The plausible reading is that this policy
   * has no way to CONVERT board presence or combat advantage into pool, so
   * paying for them only diverts it from bleeding — but that is a
   * hypothesis, and isolating the twelve is a measurement someone can
   * make. The tags stay in the vocabulary because they are correct facts
   * about the option, wanted by the UI and by any search agent.
   */
  effectValue: {
    bleed: 3,
    poolDrain: 3,
    poolGain: 2.5,
    steal: 3,
    deny: 0,
    board: 0,
    bloodGain: 0,
    damage: 0,
    votes: 0,
    unlock: 0,
    combat: 0,
    stealth: 0,
    intercept: 0,
    prevent: 0,
    search: 0,
    wake: 0,
  },
  selfOustGuard: -1000,
  strikeLethal: 12,
  strikeDamage: 2,
  dodgeWhenLosing: 6,
  pressToFinish: 5,
  pressWhenLosing: -4,
  voteOwn: 6,
  voteAgainstOthers: 4,
  gainEdge: 5,
  withdraw: 12,
  discard: -1,
  answerChoice: 2,
  pass: 0.5,
};

/** A seeded, reproducible stream. The same shape the engine's RNG uses. */
export interface Rng {
  rngState: number;
}

/** xorshift32 — the engine's own generator, so an AI and a game seeded
 *  alike behave alike across runs and machines. */
function nextInt(rng: Rng, bound: number): number {
  let x = rng.rngState | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rng.rngState = x | 0;
  return Math.abs(x) % Math.max(1, bound);
}

/** Who is whose prey, from the seating order in the view. */
function preyOf(view: PlayerView, seat: SeatId): SeatId | null {
  const live = view.seats.filter((s) => !s.ousted);
  const i = live.findIndex((s) => s.id === seat);
  if (i < 0 || live.length < 2) return null;
  return live[(i + 1) % live.length]!.id;
}

function seatOf(view: PlayerView, id: SeatId) {
  return view.seats.find((s) => s.id === id);
}

/** Every minion on the table, with the seat that controls it. */
function allMinions(view: PlayerView): Array<{ m: MinionState; seat: SeatId }> {
  return view.seats.flatMap((s) => s.minions.map((m) => ({ m, seat: s.id })));
}

function findMinion(view: PlayerView, id: string): { m: MinionState; seat: SeatId } | null {
  return allMinions(view).find((x) => x.m.id === id) ?? null;
}

/** A rough "how hard does this minion hit" — printed strength plus any
 *  strength its attached cards advertise. The view shows attachments on
 *  face-up minions, so this is information the AI is entitled to. */
function power(m: MinionState): number {
  let s = m.strength;
  for (const p of m.attached) s += p.statics.strength ?? 0;
  return s;
}

/** Pool the seat would have left after paying `cost`. */
function poolAfter(view: PlayerView, seat: SeatId, cost: number): number {
  return (seatOf(view, seat)?.pool ?? 0) - cost;
}

export interface HeuristicOptions {
  weights?: Partial<Weights>;
  /** Seed for tie-breaking. Two agents with the same seed and the same
   *  decisions behave identically. */
  seed?: number;
}

export class HeuristicAgent implements Agent {
  private readonly w: Weights;
  private readonly rng: Rng;

  constructor(opts: HeuristicOptions = {}) {
    this.w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
    // A non-zero state: xorshift is stuck at zero.
    this.rng = { rngState: (opts.seed ?? 0x5eed) | 1 };
  }

  decide(dp: DecisionPoint, options: LegalOption[], view: PlayerView): string {
    if (options.length === 0) throw new Error("no options offered");
    let best: LegalOption = options[0]!;
    let bestScore = -Infinity;
    let ties = 0;
    for (const o of options) {
      const s = this.score(o, dp, view);
      if (s > bestScore) {
        best = o;
        bestScore = s;
        ties = 1;
      } else if (s === bestScore) {
        // Reservoir sampling on the seeded stream: every tied option is
        // equally likely, and the choice is reproducible.
        ties += 1;
        if (nextInt(this.rng, ties) === 0) best = o;
      }
    }
    return best.id;
  }

  /** The whole policy. One score per option; no side effects. */
  /** PUBLIC so a search agent can blend this opinion with a lookahead and
   *  use it to order candidates (docs/ai-v2-design.md §4). Reading a score
   *  changes nothing, so exposing it costs no invariant. */
  score(o: LegalOption, dp: DecisionPoint, view: PlayerView): number {
    const w = this.w;
    const me = view.you;
    const prey = preyOf(view, me);

    switch (o.kind) {
      case "pass":
        return w.pass;

      case "takeAction":
        return this.scoreAction(o, view, me, prey);

      case "endMinionPhase":
        // Slightly worse than passing, so the AI does not close its phase
        // while it still has something worth doing. If nothing else
        // scores above `pass`, this is what is left.
        return w.pass - 0.1;

      case "gainEdgePool":
        return w.gainEdge;

      case "announceWithdrawal":
        // The engine offers this only when the library is EXHAUSTED and
        // the hand is short (p. 38) — a position with no way back, since
        // nothing will ever be drawn again. One certain victory point is
        // worth more than playing out the deck-out.
        return w.withdraw;

      case "declareBlock":
        return this.scoreBlock(o, view, me);

      case "chooseStrike":
        return this.scoreStrike(o, view, me);

      case "usePress":
        return this.scorePress(o, view, me);

      case "castVote":
        // Vote with your own referendum, against everybody else's. The
        // engine has already worked out that this source may cast.
        return (o.inFavor ? w.voteOwn : w.voteAgainstOthers) + o.count * 0.5;

      case "playCard":
        return this.scorePlay(o, dp, view, me);

      case "discard":
        return w.discard;

      case "transferToVampire":
        return this.scoreInfluence(o, view, me);
      case "influenceOut":
        return w.influenceOut;
      case "cryptDraw":
        return w.cryptDraw;
      case "transferToPool":
        // Pulling counters back off a vampire undoes your own influence.
        return -w.influenceTransfer;

      case "diablerizeOffer":
        return w.diablerize;

      case "useEntryAction":
      case "useAbility":
        // An ability of a card already in play costs nothing to try and
        // is usually why the card is there.
        return w.playCard;

      case "useManeuver":
      case "preventCredit":
      case "burnForIntercept":
      case "burnForUnlock":
        // Credits already paid for: spending them is free value.
        return w.playCard;

      case "payToCancel":
        // Only worth it if the pool is genuinely spare.
        return poolAfter(view, me, o.pool) >= 4 ? w.playCard : w.selfOustGuard;

      case "cancelBlock":
        // Withdrawing is rarely right for a policy this simple.
        return -1;

      case "answerChoice":
      case "chooseTerms":
        // WHICH answer still goes in offered order — reading them means
        // parsing card text, which would be a second model of the pool.
        //
        // But whether to answer AT ALL was decided wrongly and in one
        // direction: this scored 0 against `pass` at 0.5, and declining an
        // optional ChoiceFrame IS a plain pass — so the AI turned down
        // **every optional payoff in the game**. Those frames are how a
        // long list of cards deliver what they are for (Cave of Apples,
        // Dead Pool, Hunting the Beast, the rush-outcome riders), and they
        // are raised by a card their own controller has already paid for.
        //
        // A frame that is NOT optional has no pass to lose to, so this
        // changes nothing there — including the ones that are a cost
        // addressed to a victim (an unlock toll, the p. 7 discard-down),
        // where every answer is bad and one must be taken anyway.
        return w.answerChoice;
    }
  }

  /**
   * WHICH uncontrolled vampire gets the counter.
   *
   * The policy used not to ask: every transfer scored a flat
   * `influenceTransfer`, so the ties broke on the tie-breaking stream and
   * the AI decided by coin flip — spreading counters thinly across its
   * whole uncontrolled region and taking far longer to put anything on
   * the table. The data was in `PlayerView` the whole time: a seat's own
   * uncontrolled region is readable to its owner (p. 14).
   *
   * Two terms, and the first does most of the work:
   *
   *  - **`influenceProgress / remaining`.** Counters already spent buy
   *    nothing until the vampire is actually in play, so finishing one is
   *    worth more than starting two — and the same term prefers a cheap
   *    vampire over an expensive one, which is the right early-game
   *    instinct for the same reason.
   *  - **`influenceCapacity × capacity`**, a tie-break: among vampires
   *    needing the same number of counters, take the bigger one. Small
   *    enough that it never beats being closer to done.
   *
   * Capacity is read through the view's own `MinionState`, so a granted
   * point of capacity counts, and the score can never fall to where
   * passing the influence phase would win — a policy that stopped
   * influencing would never build a board at all.
   */
  private scoreInfluence(
    o: Extract<LegalOption, { kind: "transferToVampire" }>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    const seat = seatOf(view, me);
    const entry = seat?.uncontrolled.find((u) => u.card?.id === o.minion);
    // A vampire the view will not show us (it cannot be one of ours) —
    // score it as an ordinary transfer rather than guessing.
    if (!entry?.card) return w.influenceTransfer;
    const capacity = entry.card.capacity;
    const remaining = Math.max(1, capacity - entry.counters);
    // WHICH vampire unlocks the hand you are actually holding. A card's
    // requirements live in the handler registry, which this policy has no
    // access to and should not — so the engine counts them and says
    // (docs/richer-options-design.md §7). Absent on an old fixture's
    // option, which then scores exactly as it did before.
    const unlocks = o.playableCards ?? 0;
    return (
      w.influenceTransfer +
      w.influenceProgress / remaining +
      w.influenceCapacity * capacity +
      w.influenceUnlocks * unlocks
    );
  }

  private scoreAction(
    o: Extract<LegalOption, { kind: "takeAction" }>,
    view: PlayerView,
    me: SeatId,
    prey: SeatId | null,
  ): number {
    const w = this.w;
    const actor = findMinion(view, o.minion)?.m;
    switch (o.action) {
      case "bleed": {
        // The engine offers a bleed at the prey by default (p. 21), and
        // now says what it is WORTH — every static, aura and conditional
        // already in the number.
        //
        // This used to read `bleedAmount`, the minion's PRINTED field, so
        // a card in play that made a bleed worth three looked like a
        // bleed worth one and the AI scored its most common decision on
        // the wrong number. Falling back to the printed value keeps old
        // fixtures working rather than assuming 1
        // (docs/richer-options-design.md).
        const amount = o.bleed ?? actor?.bleedAmount ?? 1;
        // A bleed the target can absorb forever is still progress; a
        // bleed that can OUST them is the whole game.
        const target = prey ? seatOf(view, prey) : null;
        // NOTE: between "ousts them" and "does not" there is nothing — a
        // bleed at a prey on 4 scores exactly like one at a prey on 25.
        // A pressure GRADIENT was built here and measured: it flips 0 of
        // 7361 decisions even at 5x strength, because the prey's pool is
        // the same for every bleed option in a decision and so cannot
        // change an argmax (docs/richer-options-design.md §8).
        const lethal = target && amount >= target.pool ? 25 : 0;
        return w.bleedPrey + amount * w.bleedPerPoint + lethal;
      }
      case "hunt": {
        if (!actor) return 0;
        // A vampire at 0 blood MUST hunt (p. 21) and is offered nothing
        // else, so this is really about the vampire that MAY.
        if (actor.blood === 0) return w.huntWhenEmpty;
        // What the hunt would actually put on them, which the engine now
        // says. A vampire at capacity gains NOTHING — p. 6 sends the
        // excess to the blood bank, not to the Methuselah's pool — so
        // that hunt is a minion phase spent on nothing and should lose to
        // passing. The option stays legal because hunting triggers cards
        // that care (docs/futile-options-design.md).
        const gain = o.gain ?? 1;
        if (gain === 0) return w.huntFutile;
        // Hunting is otherwise a wasted action for a vampire that can act,
        // and worth more the emptier they are.
        return (actor.blood <= 1 ? w.hunt + 2 : w.hunt) + (gain - 1);
      }
      case "leaveTorpor":
        return w.rescue;
      case "rescue":
        return w.rescue;
      case "diablerize":
        return w.diablerize;
      case "cardEffect":
        return w.playCard;
    }
    // A bleed aimed somewhere other than the prey (the option list can
    // carry a chosen target) is money handed to a player you cannot oust.
    return w.bleedNonPrey;
  }

  private scoreBlock(
    o: Extract<LegalOption, { kind: "declareBlock" }>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    const blocker = findMinion(view, o.minion)?.m;
    const act = view.action;
    if (!blocker || !act) return 0;

    // NEVER attempt a block that cannot succeed. p. 25 lets a failed
    // attempt be retried "as often as the blocking Methuselah wishes",
    // so an agent that attempts a hopeless block does not merely waste a
    // decision — it can loop forever, which is exactly what the first
    // batch run did (docs/ai-v1-design.md §3). The termination is a
    // judgement, and this is the judgement.
    //
    // Read off the OPTION, which the engine now fills in: it computed
    // this to build the option in the first place, so asking it is both
    // cheaper and safer than re-deriving from the view
    // (docs/richer-options-design.md §1).
    if (!o.wouldSucceed) return -Infinity;
    // The toll is paid to ATTEMPT, not to succeed — so it is a real cost
    // even on a block that works.
    const toll = o.toll;

    // What is the action worth stopping? A bleed at us is pool; anything
    // else is worth less.
    // The LIVE value, which the view now reports. This read the acting
    // minion's PRINTED `bleedAmount` — the same wrong number the bleed
    // option itself used to carry, surviving one decision along, and in
    // the place it matters most: 236 of 269 block decisions in real games
    // are against a bleed. Falling back to the printed field keeps old
    // fixtures working rather than assuming 1.
    const bleedAtMe =
      act.kind === "bleed" && act.target === me
        ? (act.bleed ?? findMinion(view, act.acting)?.m.bleedAmount ?? 1)
        : 0;
    // What is this action worth stopping? A bleed is pool off our own
    // total; everything else is worth what it would have DONE, which
    // varies enormously — see the weights.
    const worthStopping = (): number => {
      if (bleedAtMe > 0) return w.blockBleed + bleedAtMe * w.blockPerBleedPoint;
      switch (act.kind) {
        case "diablerize":
          return w.blockDiablerize;
        case "hunt":
          return w.blockHunt;
        case "rescue":
        case "leaveTorpor":
          return w.blockRescue;
        case "cardEffect":
          return w.blockCardEffect;
        // A bleed aimed at somebody else. Stopping it protects a player
        // we are not trying to protect, and costs us the blocker.
        case "bleed":
          return w.blockOther;
      }
    };
    let score = worthStopping() - toll;

    // A bleed that would oust us must be stopped almost regardless of
    // what the combat costs.
    const myPool = seatOf(view, me)?.pool ?? 0;
    if (bleedAtMe >= myPool) score += 50;
    // Below that cliff there is NO gradient, and that was measured rather
    // than overlooked: a term scaling with "this bleed as a fraction of
    // the pool I have left" flips 0 of 7361 decisions even at 5x
    // strength, because it is identical for every blocker in the
    // decision and blocking already beats passing whenever it is legal
    // (docs/richer-options-design.md §8).

    // Blocking with someone who will be flattened is usually a mistake —
    // unless the bleed is lethal, which the bonus above outweighs.
    const actor = findMinion(view, act.acting)?.m;
    if (actor && power(actor) > power(blocker) + blocker.blood) score += w.blockOutmatched;
    // A nearly-empty blocker cannot pay tolls or mend damage (p. 31).
    if (blocker.kind === "vampire" && blocker.blood <= 1) score += w.blockOutmatched / 2;
    return score;
  }

  private scoreStrike(
    o: Extract<LegalOption, { kind: "chooseStrike" }>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    // WHO WE ARE FIGHTING, which the view now says. The policy used to
    // score strikes on kind alone and approximate "are we losing" from our
    // own weakest ready minion — a guess about the wrong minion, since the
    // one in the fight may be neither the weakest nor even in danger.
    const c = view.combat;
    const mine = c?.side ? findMinion(view, c.side === "acting" ? c.acting : c.opposing)?.m : null;
    const foe = c?.opponent ? findMinion(view, c.opponent)?.m : null;
    // "A vampire with no blood left to mend goes to torpor" (p. 31), so a
    // strike that meets their remaining blood is the one that ends it.
    const lethal = foe !== null && foe !== undefined && power(mine ?? foe) >= foe.blood;
    // Losing is about THIS combat: their strength against our blood.
    const losing =
      mine && foe ? power(foe) >= mine.blood : this.fragile(view, me);

    switch (o.strike) {
      case "hand":
        return w.strikeDamage + (lethal ? w.strikeLethal : 0);
      case "dodge":
        // Dodging is right when the minion in the fight is the one at
        // risk — and pointless when our own strike would end it first.
        return losing && !lethal ? w.dodgeWhenLosing : 0;
      case "combatEnds":
        return losing && !lethal ? w.dodgeWhenLosing + 1 : 1;
      case "burnEquipment":
        return w.strikeDamage + 1;
      case "stealBlood":
        return w.strikeDamage + 1;
    }
    return 0;
  }

  /** Are our minions in poor shape? Used to prefer defensive strikes. */
  private fragile(view: PlayerView, me: SeatId): boolean {
    const mine = seatOf(view, me)?.minions ?? [];
    const ready = mine.filter((m) => !m.inTorpor);
    if (ready.length === 0) return true;
    return ready.some((m) => m.blood <= 1);
  }

  private scorePress(
    o: Extract<LegalOption, { kind: "usePress" }>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    if (!o.toContinue) return 0;
    // Pressing keeps a combat going, so it is worth it exactly when we
    // are winning THIS one — measured against the minion we are actually
    // fighting rather than against our own weakest vampire elsewhere.
    const c = view.combat;
    const mine = c?.side ? findMinion(view, c.side === "acting" ? c.acting : c.opposing)?.m : null;
    const foe = c?.opponent ? findMinion(view, c.opponent)?.m : null;
    if (!mine || !foe) return this.fragile(view, me) ? w.pressWhenLosing : w.pressToFinish;
    // Close to finishing them, and not close to being finished.
    if (foe.blood <= power(mine)) return w.pressToFinish + 3;
    return power(foe) >= mine.blood ? w.pressWhenLosing : w.pressToFinish;
  }

  private scorePlay(
    o: Extract<LegalOption, { kind: "playCard" }>,
    dp: DecisionPoint,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    // The AI does not read card TEXT — that would be a second, drifting
    // model of what cards do. It reads what the engine now reports on the
    // option: the LIVE cost, already including every modifier in force
    // (docs/richer-options-design.md §2).
    const pool = seatOf(view, me)?.pool ?? 0;
    const cost = o.cost ?? { blood: 0, pool: 0 };

    // Pool is life. Never spend down to a position an ordinary bleed
    // would oust you from, whatever the card promises.
    if (cost.pool > 0 && pool - cost.pool <= 2) return w.selfOustGuard;

    // A blood cost is real but recoverable — a vampire can hunt. Charge
    // it lightly, and refuse a play that would empty the payer, since a
    // vampire at 0 blood must hunt and can do nothing else (p. 21).
    const payer = o.minion === null ? null : findMinion(view, o.minion)?.m;
    if (payer && cost.blood > 0 && payer.blood - cost.blood <= 0) return w.selfOustGuard;

    let score = w.playCard + cost.pool * w.poolCost - cost.blood * 0.5;
    // What the card actually does. Before this, everything a card did was
    // invisible here and only its price was not — so the policy reliably
    // preferred the cheapest card in hand, which is the opposite of how
    // the game is played.
    score += this.effectValue(o.effects);
    // Prefer using cards during our own actions over speculative ones.
    if (windowIsOurAction(dp.window)) score += 1;
    return score;
  }

  /**
   * Price a play's effect summary.
   *
   * An ABSENT amount counts as ONE, not as zero: a cancel, a wake or a
   * card put into play has no natural size, and treating "no number" as
   * "no value" would price exactly the cards whose whole point is not
   * numeric — which is the trap the summary's own doc warns about.
   *
   * A negative amount is a REDUCTION (a card that takes a bleed away),
   * and it keeps its sign: taking two bleed off an opponent's action is
   * worth about what adding two to your own is.
   */
  private effectValue(effects: PlayEffect[] | undefined): number {
    let total = 0;
    for (const e of effects ?? []) total += (this.w.effectValue[e.tag] ?? 0) * (e.amount ?? 1);
    return total;
  }
}

function windowIsOurAction(win: WindowId): boolean {
  return win === "action.announce" || win === "action.effects";
}
