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
import type { DecisionPoint, LegalOption, WindowId } from "../engine/options.ts";
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
  /** Getting vampires out is the whole early game. */
  influenceTransfer: number;
  cryptDraw: number;
  influenceOut: number;
  /** Rescuing and diablerising are situational but usually good. */
  rescue: number;
  diablerize: number;
  /** Blocking: worth roughly what the action would have cost you. */
  blockBleed: number;
  blockPerBleedPoint: number;
  blockOther: number;
  /** Blocking with a minion that will lose the fight badly. */
  blockOutmatched: number;
  /** Playing cards at all — a small positive so the AI uses its hand,
   *  scaled by how much pool it costs. */
  playCard: number;
  poolCost: number;
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
  /** Discarding: shed the least useful card, but discarding is a cost. */
  discard: number;
  /** A tiny bias toward passing, so the AI does not take pointless
   *  actions purely because they scored 0.001. */
  pass: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  bleedPrey: 8,
  bleedPerPoint: 4,
  bleedNonPrey: -6,
  huntWhenEmpty: 20,
  hunt: 1,
  influenceTransfer: 6,
  cryptDraw: 3,
  influenceOut: 12,
  rescue: 5,
  diablerize: 9,
  blockBleed: 3,
  blockPerBleedPoint: 3,
  blockOther: 1,
  blockOutmatched: -6,
  playCard: 2,
  poolCost: -2,
  selfOustGuard: -1000,
  strikeLethal: 12,
  strikeDamage: 2,
  dodgeWhenLosing: 6,
  pressToFinish: 5,
  pressWhenLosing: -4,
  voteOwn: 6,
  voteAgainstOthers: 4,
  gainEdge: 5,
  discard: -1,
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
  private score(o: LegalOption, dp: DecisionPoint, view: PlayerView): number {
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
        return w.influenceTransfer;
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
        // The engine has already restricted these to legal answers, and
        // reading them means parsing card text. Take them in offered
        // order, deterministically.
        return 0;
    }
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
        // The engine offers a bleed at the prey by default (p. 21). The
        // bleed amount is the minion's own, plus whatever its cards give
        // it — the view carries both.
        const amount = actor ? actor.bleedAmount : 1;
        // A bleed the target can absorb forever is still progress; a
        // bleed that can OUST them is the whole game.
        const target = prey ? seatOf(view, prey) : null;
        const lethal = target && amount >= target.pool ? 25 : 0;
        return w.bleedPrey + amount * w.bleedPerPoint + lethal;
      }
      case "hunt": {
        if (!actor) return 0;
        if (actor.blood === 0) return w.huntWhenEmpty;
        // Hunting is a wasted action for a vampire that can act.
        return actor.blood <= 1 ? w.hunt + 2 : w.hunt;
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
    const bleedAtMe =
      act.kind === "bleed" && act.target === me
        ? (findMinion(view, act.acting)?.m.bleedAmount ?? 1)
        : 0;
    let score =
      (bleedAtMe > 0 ? w.blockBleed + bleedAtMe * w.blockPerBleedPoint : w.blockOther) -
      toll;

    // A bleed that would oust us must be stopped almost regardless of
    // what the combat costs.
    const myPool = seatOf(view, me)?.pool ?? 0;
    if (bleedAtMe >= myPool) score += 50;

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
    // The view does not expose the combat frame, so the policy scores by
    // strike KIND — which is the part that generalises anyway.
    switch (o.strike) {
      case "hand":
        return w.strikeDamage;
      case "dodge":
        // Dodging is right when our combatants are fragile. Approximated
        // by our own weakest ready minion's blood, which is the resource
        // that pays for damage (p. 31).
        return this.fragile(view, me) ? w.dodgeWhenLosing : 0;
      case "combatEnds":
        return this.fragile(view, me) ? w.dodgeWhenLosing + 1 : 1;
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
    return this.fragile(view, me) ? w.pressWhenLosing : w.pressToFinish;
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
    // Prefer using cards during our own actions over speculative ones.
    if (windowIsOurAction(dp.window)) score += 1;
    return score;
  }
}

function windowIsOurAction(win: WindowId): boolean {
  return win === "action.announce" || win === "action.effects";
}
