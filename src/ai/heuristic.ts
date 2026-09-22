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
import { preyOf, relationTo } from "./seats.ts";

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
  /**
   * A POLITICAL ACTION, whose success calls a referendum (p. 24, p. 27).
   *
   * `ActionKind` has six members and one of them is `"cardEffect"`,
   * meaning every action card in the game — so a Govern, an Embrace and a
   * Kine Resources Contested about to burn four pool off the table all
   * returned the same constant. **Blocking the action is the cheapest
   * answer to politics in VTES**: no votes needed, no cards spent beyond
   * the block, and the referendum never happens.
   *
   * Above `blockCardEffect` because a referendum is a TABLE-WIDE pool
   * event rather than one seat's private gain, and below the lethal-bleed
   * cliff because nothing outranks not being ousted.
   */
  blockPolitical: number;
  /**
   * WHOSE action it is, scaled by the actor's relation to you — and
   * **ZERO, on the `influenceUnlocks` precedent.** Read this before
   * raising it.
   *
   * The idea is reasonable: an action by your PREDATOR that grows their
   * board is worth more to stop than the same action by a cross-table
   * seat who is not coming for you. The information is real and the term
   * is LIVE rather than inert — measured over 20 games it would change
   * **30 of 255 block decisions (12%)** on the playtest table, which is
   * the same order as `influenceUnlocks` at 9%.
   *
   * It is 0 because "live" is not "better" — and that is now MEASURED
   * rather than assumed. Benched against the tuned default on three
   * mirror decks at two strengths, 240 games each:
   *
   * | deck | weight | gap vs default |
   * | --- | --- | --- |
   * | Nosferatu | 3 | +0.017 |
   * | Nosferatu | 8 | +0.017 |
   * | Gangrel | 6 | −0.029 |
   * | Brujah | 6 | −0.017 |
   *
   * Every one inside its ±0.20 margin, and the four straddle zero. §8 had
   * already found that **two quite different blocking policies produce
   * statistically identical games**; this is the same result arriving for
   * the same function a third time.
   *
   * Kept at 0 rather than deleted, on the `influenceUnlocks` criterion:
   * the project deletes a weight that flips NOTHING (`blockPressure`) and
   * keeps at zero one that flips decisions but has not earned its place.
   * This flips 12%. The experiment stays one flag away, and the bench
   * numbers above are why nobody should expect much from it.
   *
   * Note the asymmetry it encodes, which is the part worth arguing with:
   * on the politics table the same term flips **1 of 290**, so whatever
   * it is picking up is deck-shaped rather than general.
   */
  blockActorRelation: number;
  /** Anything `ActionKind` grows later. */
  blockOther: number;
  /** Blocking with a minion that will lose the fight badly. */
  blockOutmatched: number;
  /** Playing cards at all — a small positive so the AI uses its hand,
   *  scaled by how much pool it costs. */
  playCard: number;
  poolCost: number;
  /**
   * SURVIVAL (docs/ai-pool-preservation-design.md).
   *
   * Pool is life (p. 4) and the bots did not act like it. `poolCost` is a
   * flat price per point, so a card was worth the same at 30 pool and at
   * 4 — and the only brake was a single hard cliff in `scorePlay` that
   * refused to spend below 2. Between "comfortable" and "one point from
   * dead" there was nothing at all, which is how a bot at 5 pool pays 3
   * for a master and hands its predator the game.
   *
   * Three weights rather than one, because the three answer different
   * questions and the playstyles want to answer them differently:
   *
   *  - **`poolFloor`** — the pool this seat will not spend below,
   *    whatever the card promises. A cliff, priced at `selfOustGuard`.
   *    Defaults to 2, which is exactly the number that was hard-coded,
   *    so `balanced` keeps its measured behaviour at the cliff.
   *  - **`lowPoolThreshold`** — where thrift STARTS. Above it a point of
   *    pool costs `poolCost` and nothing more; from there down to the
   *    floor the price rises smoothly. The owner's number (2026-09-22).
   *  - **`lowPoolCaution`** — how steep that rise is. **At 0 the whole
   *    layer is off**, so the claim is falsifiable with
   *    `--weights lowPoolCaution=0` rather than by editing code.
   *
   * The gradient is applied only where it can change an argmax. Pool is
   * the same for every option in a decision, so by the §8 law a flat
   * discount on a decision whose options all cost the same flips nothing
   * — it is the *differences* in cost, and the comparison against `pass`,
   * that this moves (docs/richer-options-design.md §8).
   */
  poolFloor: number;
  lowPoolThreshold: number;
  lowPoolCaution: number;
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
  /**
   * A HAND STRIKE AT LONG RANGE, which does not reach (p. 29) — the
   * engine resolves it to nothing at all: `range === "long" && !ranged`
   * returns before any damage.
   *
   * Neither agent had ever read `view.combat.range`; a grep for it
   * returned nothing. So the highest-scoring combat option was, in that
   * position, worth zero — and worse, `lethal` was awarded on a strike
   * that could not land, making a hand strike at long range the best
   * thing on the list precisely when it was the emptiest.
   *
   * Below every real alternative, and deliberately NOT below `pass`: a
   * strike must be chosen, so this only has to lose to the other strikes.
   * It is the `declareBlock.wouldSucceed` rule one frame over — an option
   * that cannot do the thing must not be priced as if it does.
   */
  strikeUnreachable: number;
  /**
   * Maneuvering to CLOSE the range, when the striker cannot reach.
   *
   * A maneuver is how you change the range (p. 29) and it was priced at
   * a flat `playCard` beside "burn a blood for intercept" — two things
   * that have nothing to do with each other. Worth roughly what the
   * strike it enables is worth, and this VARIES across the option list
   * (the maneuver and the strike are different options in the same
   * decision), so it is the shape §8 says a term must have to matter.
   */
  maneuverToClose: number;
  /**
   * Maneuvering to OPEN the range, when you are the one who can shoot.
   *
   * The mirror of `maneuverToClose`, and it is a real VTES play rather
   * than a curiosity: a ranged strike works at any range (p. 30) and a
   * hand strike does not, so a minion holding a gun is strictly better
   * off at long range against a minion holding nothing.
   *
   * Smaller than closing, because closing rescues a strike that would
   * otherwise do nothing, while opening only denies the opponent theirs —
   * and this policy cannot see whether the opponent has a gun too, in
   * which case opening buys nothing.
   */
  maneuverToOpen: number;
  /**
   * A weapon strike that REACHES, chosen at long range.
   *
   * Above `playCard`, which is what every ability was worth before: the
   * bot preferred its gun at long range only because the hand strike had
   * been penalised, so it was choosing by elimination. This is the
   * positive reason.
   */
  strikeRangedAtLong: number;
  dodgeWhenLosing: number;
  pressToFinish: number;
  pressWhenLosing: number;
  /**
   * A small bias toward your OWN referendum passing — you paid a card and
   * an action for it, so a genuinely neutral one should still pass.
   *
   * It used to be the whole vote policy, together with
   * `voteAgainstOthers`, and the pair were named for a condition —
   * "is this MY referendum" — that **nothing in scope could evaluate**,
   * because `PlayerView` did not project the referendum frame. So the
   * code was `inFavor ? 6 : 4` unconditionally and the bots voted FOR
   * everything: 70 for, 0 against, over 20 games
   * (docs/ai-decision-profile-2026-09-18.md).
   *
   * Now it is what its name says, and it is a TIE-BREAK rather than the
   * decision: the pool arithmetic below outranks it.
   */
  voteOwn: number;
  /**
   * The prior on a RIVAL's referendum whose pool effect this policy
   * cannot price — an "other" referendum, or one whose terms name no
   * seats (docs/ai-vote-scoring-design.md §3).
   *
   * Someone paid a card and an action for it, so it is probably good for
   * them and they are probably not you. That is a weak argument and it is
   * deliberately a weak weight; it exists so the bots do not simply
   * abstain from every title grant, which is what a pure
   * pool-arithmetic scorer would do.
   */
  voteAgainstOthers: number;
  /**
   * What a point of pool moving ONTO a seat is worth to you, by that
   * seat's relation (src/ai/seats.ts). Positive means "I want this".
   *
   * The signs are the game rather than a preference: pool on you is your
   * life (p. 4), pool on your prey is what you must remove to score, and
   * pool on your predator is what they will bleed you with. Cross-table
   * pool is somebody else's problem, and priced like it.
   *
   * These are what make a vote decision a real fork: the two options
   * differ in DIRECTION, so a term that reads the referendum necessarily
   * takes different values on them — which is exactly the condition
   * `richer-options-design.md` §8 says a new term must meet, and the one
   * `blockPressure` and `bleedPressure` structurally could not.
   */
  votePoolMe: number;
  votePoolPrey: number;
  votePoolPredator: number;
  votePoolCross: number;
  /**
   * A referendum that would take a seat to ZERO POOL.
   *
   * Ousting your prey pays twice over and the engine says so:
   * `processOusts` reads the predator before adjacency is rewritten and
   * awards them a victory point (p. 44) **and 6 pool** (p. 36),
   * whatever caused the oust. So a referendum that finishes your prey is
   * not merely progress — it IS the point, and it is worth roughly what
   * a lethal bleed is worth.
   *
   * There is no gradient below the cliff, for the reason §8 measured: the
   * seat's pool is the same for both sides of the fork, so only the
   * threshold can change a decision.
   */
  voteOustsPrey: number;
  voteOustsPredator: number;
  voteOustsCross: number;
  /**
   * Paying a cost in BLOOD rather than in POOL, when the choice is
   * offered (Smiling Jack's unlock toll: "burn 1 pool, or 1 blood from a
   * vampire").
   *
   * Pool is your life and the game is won by removing other people's
   * (p. 4); blood is fuel. So blood first — unless the vampire cannot
   * spare it, which is the guard below.
   *
   * This is the single commonest choice frame in real games: **53 of the
   * 106 answerable choice decisions over 40 games**, every one of them a
   * genuine pool-versus-blood fork, and every one of them previously
   * decided by the seeded tie-break.
   */
  choicePayBlood: number;
  /**
   * Paying blood from a vampire who has little left.
   *
   * "A vampire with no blood left to mend goes to torpor" (p. 31), a
   * vampire at 0 blood MUST hunt (p. 21), and one at 1 cannot pay the
   * next toll. The same judgement `scoreBlock` already makes about a
   * nearly-empty blocker, made in the one other place it matters.
   */
  choicePayBloodEmpty: number;
  /**
   * Discarding the card you can most afford to lose, per REDUNDANT copy —
   * copies the deck was BUILT with, plus copies still in your hand.
   *
   * A discard-down (p. 7) is 45 of those 106 decisions and was answered
   * in offered order. This scores what the policy can legitimately know:
   * the owner's ruling of 2026-09-06 gives an agent its own deck
   * COMPOSITION, so "how many more of these will I see" is arithmetic a
   * player at a table does all the time.
   *
   * It is deliberately NOT a judgement about what the card DOES. That
   * would need a table of card names, which is the failure mode every
   * doc in this set refuses — and the projection gives a card in hand as
   * `{id, name}` with no traits, so the policy could not make one
   * honestly even if it wanted to.
   */
  choiceDiscardRedundant: number;
  /** A blood hunt burns a VAMPIRE, not pool (p. 35), so it is priced by
   *  whose vampire it is rather than through `perSeat`. */
  voteBurnMyMinion: number;
  voteBurnTheirMinion: number;
  /**
   * Per point of BLOOD a cast costs — Alexander Silverson's toll on
   * voting against, or a vote bought with blood (Mob Rule, Rant!).
   *
   * The policy read `o.toll` nowhere at all before this, so it would
   * happily burn blood to add votes to a referendum that was going to
   * pass anyway. Blood is fuel rather than life, so this is smaller than
   * a point of pool — but it is not free, and a vampire at 1 blood
   * cannot pay tolls or mend (p. 31).
   */
  voteTollCost: number;
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
  blockPolitical: 7,
  blockActorRelation: 0,
  blockOther: 1,
  blockOutmatched: -6,
  playCard: 2,
  poolCost: -2,
  // The cliff that was hard-coded in `scorePlay`, now a weight.
  poolFloor: 2,
  // The owner's number: "low health, maybe like 8 or so".
  lowPoolThreshold: 8,
  lowPoolCaution: 1,
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
  strikeUnreachable: -2,
  maneuverToClose: 4,
  maneuverToOpen: 2.5,
  strikeRangedAtLong: 5,
  dodgeWhenLosing: 6,
  pressToFinish: 5,
  pressWhenLosing: -4,
  voteOwn: 2,
  voteAgainstOthers: 1.5,
  votePoolMe: 1,
  votePoolPrey: -1,
  votePoolPredator: -0.6,
  votePoolCross: -0.2,
  voteOustsPrey: 25,
  voteOustsPredator: 6,
  voteOustsCross: 2,
  voteBurnMyMinion: -20,
  voteBurnTheirMinion: 6,
  voteTollCost: 1.5,
  choicePayBlood: 1.5,
  choicePayBloodEmpty: -4,
  choiceDiscardRedundant: 0.4,
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

/**
 * What a play PAYS BACK in pool, so a card that costs 1 and returns 3 is
 * not read as a spend at all.
 *
 * Without this the survival layer would refuse exactly the cards a seat
 * on 4 pool most needs — the blood-to-pool masters whose entire purpose
 * is to undo the position that triggers the refusal.
 */
function poolGainOf(effects: PlayEffect[] | undefined): number {
  let gain = 0;
  for (const e of effects ?? []) if (e.tag === "poolGain") gain += e.amount ?? 1;
  return gain;
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
        return this.scoreVote(o, dp, view, me);

      case "playCard":
        return this.scorePlay(o, dp, view, me);

      case "discard":
        return w.discard;

      case "burnOptionDiscard":
        // A card no minion of ours can use, swapped for a fresh draw at no
        // cost (p. 17) — always worth more than holding it.
        return w.discard + 1;

      case "transferToVampire":
        return this.scoreInfluence(o, view, me);
      case "influenceOut":
        return w.influenceOut;
      case "cryptDraw":
        return w.cryptDraw;
      case "transferToPool":
        // Pulling counters back off a vampire undoes your own influence —
        // and is precisely what a seat about to be ousted should do with
        // them. Counters sitting in the uncontrolled region buy nothing
        // until the vampire arrives, and a seat that is ousted first never
        // gets there.
        //
        // The condition is the FLOOR rather than the gradient, so it is
        // self-limiting: each counter taken back raises the pool, and the
        // moment the pool clears the floor this goes back to being the
        // worst option on the list. No unbounded stripping of the region.
        if ((seatOf(view, me)?.pool ?? 0) <= w.poolFloor) return w.influenceTransfer;
        return -w.influenceTransfer;

      case "diablerizeOffer":
        return w.diablerize;

      case "useAbility":
        // A WEAPON THAT REACHES, at a range where hands do not. The
        // engine says which abilities are ranged strikes, so this is a
        // positive reason to pick the gun rather than the leftover after
        // the hand strike was penalised.
        if (o.strikeReaches && view.combat?.range === "long") return w.strikeRangedAtLong;
        return w.playCard;

      case "useEntryAction":
        // An ability of a card already in play costs nothing to try and
        // is usually why the card is there.
        return w.playCard;

      case "useManeuver":
        return this.scoreManeuver(o, view);

      case "preventCredit":
      case "burnForIntercept":
      case "burnForUnlock":
        // Credits already paid for: spending them is free value.
        return w.playCard;

      case "payToCancel":
        // Only worth it if the pool is genuinely spare — two clear of the
        // floor, which was a hard-coded 4 and is now whatever this style
        // calls safe.
        return poolAfter(view, me, o.pool) >= w.poolFloor + 2
          ? w.playCard
          : w.selfOustGuard;

      case "cancelBlock":
        // Withdrawing is rarely right for a policy this simple.
        return -1;

      case "chooseTerms":
        // WHERE TO AIM IT. The caller used to answer this in offered
        // order, so a bot that landed Parity Shift chose its victim by
        // coin flip — and terms are the PAYLOAD, chosen on success only
        // (p. 25's exception, p. 27), after the card, the action and the
        // referendum have all been paid for.
        return this.scoreTerms(o, view, me);

      case "answerChoice":
        return this.scoreChoice(o, view, me);

    }
  }

  /**
   * HOW PRESSED THIS SEAT IS FOR POOL: 0 when comfortable, rising to 1 at
   * the floor (docs/ai-pool-preservation-design.md).
   *
   * Linear between the two, and deliberately so: the only claim being
   * made is that the price of a point of pool goes UP as the pool goes
   * down, and a curve would be a second claim nobody has measured.
   *
   * Total over silly weights — a style that set its threshold below its
   * floor would otherwise divide by a negative span and get a policy that
   * spends harder the closer it is to death.
   */
  private poolPressure(view: PlayerView, me: SeatId): number {
    const w = this.w;
    const pool = seatOf(view, me)?.pool ?? 0;
    if (pool >= w.lowPoolThreshold) return 0;
    const span = w.lowPoolThreshold - w.poolFloor;
    if (span <= 0) return pool <= w.poolFloor ? 1 : 0;
    return Math.min(1, Math.max(0, (w.lowPoolThreshold - pool) / span));
  }

  /**
   * HOW MUCH THIS SEAT CARES, 0…1 — the position scaled by temperament
   * and clamped, so `lowPoolCaution` cannot push a style past certainty.
   *
   * ONE helper, read by every site that spends pool, because one question
   * asked in two places will drift — and a bot that refuses a 3-pool
   * master while cheerfully paying the same 3 as a card's toll has not
   * learned anything. Each site scales this by its OWN local price (a
   * per-point cost, a currency fork); what none of them re-derives is how
   * pressed the seat is.
   */
  private poolUrgency(view: PlayerView, me: SeatId): number {
    return Math.min(1, this.poolPressure(view, me) * this.w.lowPoolCaution);
  }

  /** The multiplier on a point of pool: 1 when comfortable, 3 at full
   *  urgency — so a `poolCost` of −2 becomes −6. */
  private poolBite(view: PlayerView, me: SeatId): number {
    return 1 + 2 * this.poolUrgency(view, me);
  }

  /**
   * "Unless it is absolutely necessary" — the one exemption.
   *
   * A seat with NO minion in play is not saving itself by hoarding: it
   * has no way to bleed, block or hunt, and pool it never spends is pool
   * its predator takes anyway. Boardless seats influence at full price.
   */
  private boardless(view: PlayerView, me: SeatId): boolean {
    return (seatOf(view, me)?.minions.length ?? 0) === 0;
  }

  /**
   * WHICH answer to a choice frame (docs/ai-answer-choice-design.md).
   *
   * Two families, and they are the two that actually occur — measured
   * over 40 games, 98 of the 106 answerable choice decisions are one or
   * the other:
   *
   *  - **53 are a COST with a currency** (Smiling Jack's unlock toll:
   *    "burn 1 pool, or 1 blood from a vampire");
   *  - **45 are a discard-down** (p. 7).
   *
   * Everything else keeps `answerChoice` and falls to the seeded
   * tie-break. THAT FALLBACK IS LOAD-BEARING and must never become 0:
   * declining an optional choice frame is a plain `pass`, and when this
   * scored 0 against `pass` at 0.5 the AI turned down **every optional
   * payoff in the game** — Cave of Apples, Dead Pool, Hunting the Beast,
   * the rush-outcome riders. The deltas below are added to it rather than
   * replacing it, so that fix survives.
   *
   * No card text is read. The scorer is total over params it does not
   * recognise, because a key means different things on different cards —
   * the trap that ate a first draft of the referendum terms
   * (docs/ai-referendum-view-design.md §5.1).
   */
  private scoreChoice(
    o: Extract<LegalOption, { kind: "answerChoice" }>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    const base = w.answerChoice;

    // A COST, with a choice of currency. Pool is life (p. 4); blood is
    // fuel — so blood, unless the vampire cannot spare it.
    const pay = o.params["pay"];
    // Priced off the same urgency as every other pool spend, so the
    // currency fork moves with the pool instead of being settled once at
    // design time.
    //
    // At a comfortable pool this is `base` exactly, as it was — which
    // matters more than it looks: `base` is what keeps an OPTIONAL frame
    // above `pass`, and the note above records what happened the last
    // time this fell to 0. At full urgency it lands just below
    // `choicePayBloodEmpty`, which is the claim in one line: a pressed
    // seat would rather send a vampire out to hunt (p. 21) than pay with
    // its life, and it declines an optional frame that only takes pool.
    if (pay === "pool") {
      return base + (w.choicePayBloodEmpty - 1) * this.poolUrgency(view, me);
    }
    if (pay === "blood") {
      const payer = o.params["pick"] ? findMinion(view, o.params["pick"]) : null;
      // A derived read must be TOTAL: the named vampire can have left
      // play between the frame opening and this decision.
      if (!payer) return base;
      // "A vampire with no blood left to mend goes to torpor" (p. 31) and
      // one at 0 MUST hunt (p. 21). Taking the last blood is not a saving.
      if (payer.m.blood <= 1) return base + w.choicePayBloodEmpty;
      return base + w.choicePayBlood;
    }

    // A DISCARD, or any choice that names one of my cards: shed the most
    // redundant one.
    //
    // `deckList` is the deck AS BUILT, not what is left in it — it is not
    // decremented as cards are drawn, and `search.ts` has to subtract the
    // ash heap and the table to get a remainder. Copies-as-built is a
    // deliberately cruder signal and the right one here: it is monotone
    // with what remains, it needs no second reconstruction of the deck,
    // and "I built four of these" is exactly the reason one of them is
    // cheap to lose.
    const mine = seatOf(view, me);
    const hand = Array.isArray(mine?.hand) ? mine.hand : [];
    // The engine backfills the card's NAME where it can — but a
    // discard-down names the card by INSTANCE ID in `params.card`, and
    // measured over 40 games that is the form 45 of 45 of them take, so
    // reading only `o.card` fired on none of them. Resolve the id against
    // the hand, which the viewer may read in full (p. 7).
    const name = o.card ?? hand.find((c) => c.id === o.params["card"])?.name;
    if (name) {
      const built = (mine?.deckList?.library ?? []).filter((n) => n === name).length;
      const inHand = hand.filter((c) => c.name === name).length;
      // −1 so a singleton scores 0 rather than a bonus: the term is about
      // REDUNDANCY, and one copy is not redundant.
      const redundancy = Math.max(0, built + inHand - 1);
      return base + redundancy * w.choiceDiscardRedundant;
    }

    return base;
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
    // A TRANSFER IS A POOL SPEND, and this scorer had no idea: every
    // transfer scored 6 or more against a `pass` of 0.5, so a bot on 4
    // pool moved four of them onto a 7-capacity vampire it would never
    // finish and handed its predator a one-bleed oust. This is the worst
    // of the three sites, because it is the one the bot reaches every
    // single turn.
    //
    // A CLIFF, not a gradient, and by the §8 law rather than by taste:
    // the pool is identical for every candidate in an influence decision,
    // so a smooth discount cannot choose between them, and it cannot beat
    // `pass` either without being large enough to stop the bot building a
    // board at all. What the floor does is stop the phase.
    //
    // The exemption is the one that matters: a seat with nothing in play
    // influences at full price, because hoarding pool behind an empty
    // table is a slower way of losing, not a way of surviving.
    if (!this.boardless(view, me) && poolAfter(view, me, 1) <= w.poolFloor) {
      return w.selfOustGuard;
    }
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

  /**
   * HOW TO VOTE (docs/ai-vote-scoring-design.md).
   *
   * Price the referendum, then take the side of the price. The bots used
   * to vote FOR everything — 70 of 70 over 20 games, including
   * referendums that burned their own pool — because the weights were
   * named for a condition nothing in scope could evaluate.
   *
   * `value` is "how much I want this to pass", so the two sides of the
   * fork are `+value` and `-value` and the argmax picks the side. That is
   * the structural property §8 demands and the reason this is worth
   * building where a pressure gradient was not.
   */
  private scoreVote(
    o: Extract<LegalOption, { kind: "castVote" }>,
    dp: DecisionPoint,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    const ref = view.referendum;
    const cost = (o.toll ?? 0) * w.voteTollCost;

    // NEVER PAY INTO A SETTLED REFERENDUM. "More for than against passes,
    // ties fail" (p. 28) — and the engine has already worked out that no
    // combination of remaining sources changes it. A blood toll or a
    // bought vote here buys nothing that exists.
    //
    // Gates the COST only, never the direction: a hand nobody can see can
    // still grant votes, so `decided` has a known false-positive mode and
    // must not be trusted with anything but money
    // (docs/ai-vote-economy-design.md §4).
    if (o.decided && cost > 0) return w.pass - 1;

    // No referendum projected (an older view, or a granted referendum
    // that declared nothing): fall back to the old prior rather than to
    // zero, so the bots still take part.
    if (!ref) return (o.inFavor ? w.voteOwn : w.voteAgainstOthers) + o.count * 0.5 - cost;

    const value = this.referendumValue(ref, view, me);

    // A DIRECTED GRANT can only be cast one way — "+N votes AGAINST the
    // referendum" (Protected District) is bucketed by direction and may
    // only be spent that way (docs/polling-votes-design.md §3). So this
    // is not a fork at all: it is cast-or-decline, and scoring it as one
    // half of a fork would compare it against `pass` by accident.
    //
    // Found by a test rather than by reading: 30 of 31 vote decisions on
    // the politics table fork, and the one that does not is a grant
    // (docs/ai-vote-scoring-design.md §2.1).
    const sameSource = dp.options.filter(
      (x): x is Extract<LegalOption, { kind: "castVote" }> =>
        x.kind === "castVote" && x.source === o.source,
    );
    const oneWay = !sameSource.some((x) => x.inFavor !== o.inFavor);
    const wanted = o.inFavor ? value : -value;
    if (oneWay) {
      // Cast it only if it pushes the way we want; otherwise leave the
      // source unspent, which is a real option and costs nothing.
      return wanted > 0 ? wanted + o.count * 0.5 - cost : w.pass - 1;
    }
    return wanted + o.count * 0.5 - cost;
  }

  /**
   * How much this seat wants the referendum to PASS. Positive means yes.
   *
   * Everything here is read off the projection, which carries only what
   * is face up at the table: who called it, what it declared, and which
   * seats its terms named.
   */
  private referendumValue(
    ref: NonNullable<PlayerView["referendum"]>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;

    // A BLOOD HUNT burns a vampire, not pool (p. 35), so `perSeat` is the
    // wrong instrument entirely — the question is whose vampire it is.
    if (ref.variant === "bloodHunt") {
      const target = ref.bloodHuntTarget ? findMinion(view, ref.bloodHuntTarget) : null;
      if (!target) return 0;
      return target.seat === me ? w.voteBurnMyMinion : w.voteBurnTheirMinion;
    }

    let value = 0;
    const perSeat = ref.perSeat;
    if (perSeat) {
      for (const [seat, delta] of Object.entries(perSeat)) {
        // `delta` is signed: positive means that seat GAINS pool.
        value += delta * this.poolWeight(view, me, seat);
        // The cliff. A seat this would take to zero is ousted, and the
        // seat that profits is their PREDATOR — 1 victory point and 6
        // pool (p. 44, p. 36), whoever caused it.
        const pool = seatOf(view, seat)?.pool ?? 0;
        if (delta < 0 && pool + delta <= 0) {
          value += this.oustWeight(view, me, seat);
        }
      }
    }

    // Nothing priceable — a title grant, or a card that charges the table
    // from the board rather than from its terms. Fall back to the prior:
    // mine is probably good for me, theirs is probably good for them.
    if (value === 0) {
      value += ref.caller === me ? w.voteOwn : -w.voteAgainstOthers;
    } else if (ref.caller === me) {
      // A tie-break, not a decision — it must never outweigh the pool
      // arithmetic, which is why it is small and added rather than
      // replacing anything. The bot CAN vote against its own referendum
      // when the terms turned out badly, which is a real VTES play.
      value += w.voteOwn * 0.25;
    }
    return value;
  }

  /**
   * WHERE TO AIM YOUR OWN REFERENDUM
   * (docs/ai-referendum-terms-design.md).
   *
   * Reads the deltas the engine resolved onto the option — no parsing of
   * `params` here, deliberately. The same keys carry opposite signs on
   * different cards, so a scorer that parsed them would aim a burn at its
   * own prey on one card and a gift at it on another.
   *
   * **The whole option list is ONE referendum**, so the polarity, the
   * card and the caller are constant across it — by the
   * `richer-options-design.md` §8 law only what VARIES can change the
   * choice, and what varies is exactly which seats the option names.
   * That is why this term works where a pressure gradient did not.
   *
   * An option the engine could not price (a clan, a location, a minion,
   * a title) scores at the old flat value and falls to the seeded
   * tie-break — which is the previous behaviour, kept on purpose so an
   * unpriceable card is no worse off than it was.
   */
  private scoreTerms(
    o: Extract<LegalOption, { kind: "chooseTerms" }>,
    view: PlayerView,
    me: SeatId,
  ): number {
    const w = this.w;
    if (!o.perSeat) return w.answerChoice;
    let value = w.answerChoice;
    for (const [seat, delta] of Object.entries(o.perSeat)) {
      value += delta * this.poolWeight(view, me, seat);
      // Aiming a referendum at a seat it would OUST is the best a
      // political action ever does — and at yourself, the worst.
      const pool = seatOf(view, seat)?.pool ?? 0;
      if (delta < 0 && pool + delta <= 0) value += this.oustWeight(view, me, seat);
    }
    return value;
  }

  /**
   * WHICH RANGE SUITS THIS MINION (docs/ai-combat-range-design.md §5.1).
   *
   * A ranged strike works at any range and a hand strike only at close
   * (p. 30), so the question is not "close is good" but "which of us is
   * armed for the range we would end up at":
   *
   *  - **no reach, and we are at LONG** — our strike does nothing where
   *    we stand. Closing rescues it, and this is the big one.
   *  - **reach, and we are at CLOSE** — opening denies a bare-handed
   *    opponent their strike while ours still works. Smaller, because it
   *    only denies rather than rescues, and because this policy cannot
   *    see whether they are armed too.
   *  - otherwise the range already suits us, and moving is a cost.
   *
   * Below `pass` in that last case rather than merely cheap: "spend the
   * credit because it is there" is how a bot maneuvers itself out of its
   * own combat.
   */
  private scoreManeuver(
    o: Extract<LegalOption, { kind: "useManeuver" }>,
    view: PlayerView,
  ): number {
    const w = this.w;
    const long = view.combat?.range === "long";
    const armed = o.rangedStrikeAvailable === true;
    if (long && !armed) return w.maneuverToClose;
    if (!long && armed) return w.maneuverToOpen;
    return w.pass - 1;
  }

  /** What a point of pool moving onto `seat` is worth to `me`. */
  private poolWeight(view: PlayerView, me: SeatId, seat: SeatId): number {
    const w = this.w;
    switch (relationTo(view, me, seat)) {
      case "me":
        return w.votePoolMe;
      case "prey":
        return w.votePoolPrey;
      case "predator":
        return w.votePoolPredator;
      case "cross":
        return w.votePoolCross;
    }
  }

  /** What ousting `seat` is worth to `me`. */
  private oustWeight(view: PlayerView, me: SeatId, seat: SeatId): number {
    const w = this.w;
    switch (relationTo(view, me, seat)) {
      // Ousting yourself dominates everything, exactly as it does
      // everywhere else in this file.
      case "me":
        return w.selfOustGuard;
      case "prey":
        return w.voteOustsPrey;
      // Good — the pressure on us stops — but their predator takes the
      // victory point, not us.
      case "predator":
        return w.voteOustsPredator;
      case "cross":
        return w.voteOustsCross;
    }
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
          // WHAT THE CARD IS, which the projection now says. Only one
          // distinction is drawn, and only one is safe to draw without a
          // table of card names: a political action's success calls a
          // referendum, and stopping the action is the cheapest way there
          // is to stop the referendum.
          return act.political ? w.blockPolitical : w.blockCardEffect;
        // A bleed aimed at somebody else. Stopping it protects a player
        // we are not trying to protect, and costs us the blocker.
        case "bleed":
          return w.blockOther;
      }
    };
    let score = worthStopping() - toll;

    // WHOSE action it is. At 0 by default — live, unvalidated, and one
    // flag away (see the weight). The actor is the same for every blocker
    // in this decision, so by the §8 law it cannot choose BETWEEN
    // blockers; what it can move is whether to block at all, which is a
    // real fork against `pass`.
    if (w.blockActorRelation !== 0) {
      const byRelation: Record<string, number> = {
        predator: 1,
        prey: 0.4,
        cross: -0.8,
        me: 0,
      };
      score += w.blockActorRelation * (byRelation[relationTo(view, me, act.actingSeat)] ?? 0);
    }

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

    // "A hand strike does not reach at long range" (p. 29) — the engine
    // resolves it to nothing. Only the BARE hand strike is affected: a
    // weapon's strike arrives as a `useAbility` option, never as a
    // `chooseStrike`, so this cannot silently disarm a gun.
    const unreachable = c?.range === "long";

    switch (o.strike) {
      case "hand":
        // Before the `lethal` bonus, not after: a strike that cannot land
        // cannot be the killing blow, and awarding it there made a futile
        // hand strike the best-scoring option on the list.
        return unreachable ? w.strikeUnreachable : w.strikeDamage + (lethal ? w.strikeLethal : 0);
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
    //
    // NET of what the play pays back: the cliff used to read the gross
    // cost, so a seat on 4 pool refused the blood-to-pool master that
    // would have put it back on 7 — it refused the cure because it had
    // the disease (docs/ai-pool-preservation-design.md §3).
    const netPool = cost.pool - poolGainOf(o.effects);
    if (netPool > 0 && pool - netPool <= w.poolFloor) return w.selfOustGuard;

    // A blood cost is real but recoverable — a vampire can hunt. Charge
    // it lightly, and refuse a play that would empty the payer, since a
    // vampire at 0 blood must hunt and can do nothing else (p. 21).
    const payer = o.minion === null ? null : findMinion(view, o.minion)?.m;
    if (payer && cost.blood > 0 && payer.blood - cost.blood <= 0) return w.selfOustGuard;

    // DO NOT GIVE CARDS AWAY. Several cards read "put this card on a
    // vampire" and enumerate EVERY seat's minions, because the card says
    // "a vampire" and the rules mean it — Vessel is the one that got
    // played on a prey's vampire in a real game (owner report), handing
    // them a blood engine for 1 pool.
    //
    // The test is what the play DOES, not which card it is: a permanent
    // landing on somebody else's minion is fine when it is hostile
    // (a corruption counter, a lock, a burn) and is a gift otherwise. So
    // an option that targets a minion this seat does not control has to
    // carry at least one effect that hurts, or it is not considered.
    const onTarget = o.params["target"];
    if (onTarget) {
      const holder = findMinion(view, onTarget);
      if (holder && holder.seat !== me) {
        const hostile = (o.effects ?? []).some(
          (e) =>
            e.tag === "deny" ||
            e.tag === "damage" ||
            e.tag === "poolDrain" ||
            e.tag === "steal",
        );
        if (!hostile) return w.selfOustGuard;
      }
    }

    // THE GRADIENT, above the cliff. A point of pool is dearer the less
    // of it there is, so a seat under the threshold stops preferring the
    // expensive card in hand and — when the price outweighs what the card
    // does — stops playing it at all, because `pass` is still 0.5.
    //
    // Charged on the GROSS cost, at a multiplier that is 1 unless the
    // seat is under the threshold — so at a comfortable pool this is
    // arithmetically the line it replaced, and every measurement behind
    // `poolCost` and `effectValue` still describes the policy. A play
    // that pays for itself keeps the ordinary price: the bite is a brake
    // on SPENDING pool, and a card that returns more than it takes is not
    // spending it.
    const bite = netPool > 0 ? this.poolBite(view, me) : 1;
    let score = w.playCard + cost.pool * w.poolCost * bite - cost.blood * 0.5;
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
