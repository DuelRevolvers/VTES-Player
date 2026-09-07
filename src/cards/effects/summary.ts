/**
 * WHAT A PLAY WOULD DO, coarsely — the richer-options principle applied to
 * the largest remaining gap (docs/richer-options-design.md §5).
 *
 * The AI scored every `playCard` option by its live cost and the window it
 * was offered in, and by nothing else: a 4-pool master that wins the game
 * and a 4-pool master that does nothing scored identically. Measured, that
 * is **11.7% of every real choice** in a game.
 *
 * The fix is the same one the block arithmetic and the live bleed took:
 * **the engine is the only thing that knows what an option does, so it
 * says.** The alternative — teaching the policy to read card text — would
 * be a second model of the card pool, drifting away from the first from
 * the day it was written.
 *
 * This is deliberately a SUMMARY and not a description. It answers "what
 * family of thing does this do, and how big", which is what a scoring
 * policy needs and roughly what a player reads off a card at a glance. It
 * is not enough to simulate a play, and it is not meant to be: a search
 * agent evaluates by applying the move, not by reading this.
 *
 * THE TABLE IS EXHAUSTIVE ON PURPOSE. `Record<EffectPrimitive["kind"], …>`
 * means TypeScript refuses to compile when a 136th primitive is added
 * without classifying it. A `default:` case would have been shorter and
 * would have let a new primitive be silently worth nothing — this
 * project's oldest failure shape, where a value that is empty for the
 * wrong reason looks exactly like one that is correctly empty. Classifying
 * a new primitive is one line; noticing that a card silently scores as
 * furniture is an afternoon.
 */

import type { PlayEffect, PlayEffectTag } from "../../engine/options.ts";
import type { PermanentStatics } from "../../engine/state.ts";
import type { CardSpec, EffectPrimitive } from "./spec.ts";

/**
 * Every primitive, and the family it belongs to. `null` means "carries no
 * value a policy can weigh" rather than "not classified yet" — the
 * distinction matters, because the compiler cannot tell them apart and a
 * reader can.
 *
 * Signs are NOT encoded here. A tag says which currency a play deals in;
 * the amount says how much, and a modifier that reduces an opponent's
 * total carries a negative one. Who benefits is decided by the reader,
 * which is why `modifyBlockerIntercept` is tagged `stealth`: it lowers an
 * intercept, but it is played to get an action through.
 */
export const EFFECT_TAGS: Record<EffectPrimitive["kind"], PlayEffectTag | null> = {
  // Getting an action through, and stopping one.
  actionStealth: "stealth",
  bankStealth: "stealth",
  modifyStealth: "stealth",
  blockCost: "stealth",
  blockRestriction: "stealth",
  modifyBlockerIntercept: "stealth",
  modifyAllIntercept: "intercept",
  modifyFilteredIntercept: "intercept",
  modifyIntercept: "intercept",
  grantBurnForIntercept: "intercept",
  setStealthZero: "intercept",
  unlockAndAttemptBlock: "intercept",

  // Bleeding.
  actionBleed: "bleed",
  modifyBleed: "bleed",

  // Pool, in both directions — the currency the game is won in.
  poolGainOnBleedSuccess: "poolGain",
  moveOwnVampireBloodToPool: "poolGain",
  refClanBoon: "poolGain",
  distributePerVoteMargin: "poolGain",
  actionStealPool: "poolDrain",
  burnPoolVotedAgainst: "poolDrain",
  refAllocateBurn: "poolDrain",
  refBurnSeatOrLocation: "poolDrain",
  refChooseSeatsBurn: "poolDrain",
  refLockAndAllocate: "poolDrain",

  // Blood.
  actionAddBloodToVampire: "bloodGain",
  actionGainBlood: "bloodGain",
  addBloodToReadyVampire: "bloodGain",
  addUncontrolledBlood: "bloodGain",
  bloodOnBleedSuccess: "bloodGain",
  bloodPerVoteMargin: "bloodGain",
  bloodToUncontrolledKin: "bloodGain",
  combatBloodStore: "bloodGain",
  gainOpposingBloodLost: "bloodGain",
  refSectPayout: "bloodGain",
  uncontrolledSectBlood: "bloodGain",

  // Hurting a minion.
  aimBonus: "damage",
  handStrikesAggravated: "damage",
  roundDamage: "damage",
  selfDamageAfterAction: "damage",
  strikeDamage: "damage",
  strikeHandBonus: "damage",
  strikeIncapacitate: "damage",

  // Not being hurt.
  autoPreventAfterFirst: "prevent",
  frenzyShield: "prevent",
  nullifyOpposingWeaponDamage: "prevent",
  prevent: "prevent",
  preventAll: "prevent",
  preventAllThisRound: "prevent",
  preventEachRound: "prevent",
  preventForOther: "prevent",
  strikeDodge: "prevent",

  // Positional advantage in a fight, which is not damage by itself.
  actionEnterCombat: "combat",
  actorCombatRider: "combat",
  addStrength: "combat",
  additionalStrike: "combat",
  afterCombatEnds: "combat",
  blockerCombatCostMod: "combat",
  blockerCombatRider: "combat",
  combatCredits: "combat",
  grantCloseManeuver: "combat",
  grantPress: "combat",
  maneuver: "combat",
  press: "combat",
  roundCloseManeuver: "combat",
  rushRiders: "combat",
  setStrength: "combat",
  startNewRound: "combat",

  // Politics.
  autoPassReferendum: "votes",
  forceAbstain: "votes",
  modifyAllVotes: "votes",
  modifyVotes: "votes",
  restrictVotes: "votes",

  // Being able to act, and being able to react.
  discardPhaseUnlockOnBleed: "unlock",
  lockCardToUnlockBearer: "unlock",
  unlockActor: "unlock",
  unlockAfterResolution: "unlock",
  unlockMinion: "unlock",
  unlockViaCorruption: "unlock",
  wake: "wake",
  wakeOther: "wake",

  // Taking away: cancels, failures, locks and bars. The whole family is
  // "the opponent does not get to do the thing", which is worth a lot in
  // VTES and was worth nothing to the policy.
  actionOnPermanent: "deny",
  actionRemoveFromAshHeap: "deny",
  actionStun: "deny",
  burnIfNotBlocking: "deny",
  cancelReferendum: "deny",
  cancelStrikeCard: "deny",
  combatCostModOnOpponent: "deny",
  continueAsUnblocked: "deny",
  corruptFailBlock: "deny",
  endAction: "deny",
  failAction: "deny",
  failBlockAttempt: "deny",
  handStrikesOnly: "deny",
  interposeOnBlocker: "deny",
  lockFailedBlockers: "deny",
  lockMinion: "deny",
  lockTargetMinionOnBleed: "deny",
  noReactionsFromChosen: "deny",
  peekAndDiscard: "deny",
  preventUnlockDuringAction: "deny",
  redirectBleed: "deny",
  refBurnPerMinion: "deny",
  refExpelMinions: "deny",
  restrictOpponent: "deny",
  setBleedZero: "deny",
  strikeCombatEnds: "deny",
  targetDiscardsOnBleed: "deny",
  targetLocksOwnMinion: "deny",

  // Taking what belongs to somebody else.
  actionSteal: "steal",
  actionStealBlood: "steal",
  grantStealBloodStrike: "steal",
  refMoveLocation: "steal",
  stealMinionOnSuccess: "steal",
  strikeStealBlood: "steal",

  // Putting something on the table that lasts.
  afterResolutionAttach: "board",
  attachInCombat: "board",
  attachSelf: "board",
  attachSelfWeapon: "board",
  attachToActorOnBlock: "board",
  attachToOpponent: "board",
  becomesVampire: "board",
  burnAttachedToAttach: "board",
  cryptDrawOnBleedSuccess: "board",
  putInPlayOnSuccess: "board",
  refAttachToChosen: "board",
  refPutInPlay: "board",
  strikeAttachToVictim: "board",
  // "Equip with a weapon from your hand, cost as normal" (Angel's Gift,
  // Contraband, Piper) — the card that arrives is what the play is for.
  playFromHand: "board",

  searchEquip: "search",

  // Real effects that a scoring policy has no way to weigh: they change
  // the price or the timing of something else rather than doing anything
  // themselves. Tagged `null` deliberately, not left out.
  delayReplaceFor: null,
  handSizeBonus: null,
  offerBlockerCancel: null,
  playCostMod: null,
};

/**
 * A card whose work is done from PLAY has no effects to summarise.
 *
 * MEASURED, and the reason this half exists: with only the primitive
 * table above, 36% of the `playCard` options in real games carried an
 * empty summary — and they were dominated by masters, allies and
 * retainers (Vessel, hunting grounds, Raven Spy, the Vozhd). Those are
 * exactly the cards an economy decision turns on, so leaving them blank
 * would have priced a Blood Doll and a blank sheet of paper the same.
 *
 * THESE TWO MAPS ARE PARTIAL, deliberately, where `EFFECT_TAGS` is
 * exhaustive. The asymmetry is the point: an unclassified *primitive*
 * would make a card silently worth nothing, while an unclassified
 * *permanent clause* still reports `board` — coarse, but true, since the
 * card really does put something lasting on the table. A missing entry
 * here loses precision; a missing entry there loses the card.
 */
const STATIC_TAGS: Partial<Record<keyof PermanentStatics, PlayEffectTag>> = {
  bleed: "bleed",
  bleedAgainstPrey: "bleed",
  bleedPerAttached: "bleed",
  bleedFromCopy: "bleed",
  bleedFromClanBlood: "bleed",
  stealth: "stealth",
  intercept: "intercept",
  votes: "votes",
  voteBonus: "votes",
  strength: "combat",
  pressPerCombat: "combat",
  continuePressPerCombat: "combat",
  maneuverPerCombat: "combat",
  rangedDamageBonus: "combat",
  combatRoundDamage: "damage",
  burnToPrevent: "prevent",
  preventForCopy: "prevent",
  // Making yourself harder to stop is what a stealth card does, whether it
  // is spelled as stealth, as a toll on the blocker, or as a bar.
  blockToll: "stealth",
  globalBlockToll: "stealth",
  opposingInterceptPenalty: "stealth",
  cannotBeBlockedBy: "stealth",
  // Taking something away from the other side.
  cannotBlock: "deny",
  cannotBlockKind: "deny",
  cannotPlayCardTypes: "deny",
  cannotPlayCardNames: "deny",
  untargetableByOthers: "deny",
  opposingCannotCombatEnds: "deny",
  opposingHandSizePenalty: "deny",
  revealsOpposingHand: "deny",
  opensPreyHand: "deny",
};

/** The named clauses of a `permanent` / `ally` block, where one says
 *  something sharper than "puts a card in play". Partial, as above. */
const PERMANENT_TAGS: Record<string, PlayEffectTag> = {
  huntingGround: "bloodGain",
  afterActionBlood: "bloodGain",
  bleedSuccessBlood: "bloodGain",
  bloodToPool: "poolGain",
  actionPoolGain: "poolGain",
  unlockDrain: "poolDrain",
  unlockToll: "poolDrain",
  leaveReadyDrain: "poolDrain",
  combatLeaveDrain: "poolDrain",
  unlockPhaseDamage: "damage",
  bleedGrant: "bleed",
  declinedBleedBonus: "bleed",
  bleedForCounter: "bleed",
  stealthGrant: "stealth",
  extraEquipStealth: "stealth",
  rushGrant: "combat",
  combatGrantForCounter: "combat",
  grantsStrikePerCombat: "combat",
  strike: "combat",
  preventForOther: "prevent",
  grantsTitle: "votes",
  politicalGrant: "votes",
  searchToHand: "search",
  searchEquipGrant: "search",
  torporRescue: "board",
  frenzyCancel: "deny",
  preReferendumAmbush: "deny",
};

/** Some primitives name a size; most of the useful ones spell it the same
 *  way. A missing amount is not zero — it is "this one does not count in
 *  units", which the reader must not treat as nothing. */
function amountOf(p: EffectPrimitive): number | undefined {
  const o = p as unknown as Record<string, unknown>;
  for (const key of ["amount", "base", "value", "bonus", "count"]) {
    const v = o[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

/** Accumulator: same tag twice collapses to one entry with the amounts
 *  added, because "+1 bleed and +1 bleed" is a two-bleed card and a policy
 *  reading a list would otherwise have to know to sum it. */
function add(byTag: Map<PlayEffectTag, number | undefined>, tag: PlayEffectTag, n?: number): void {
  if (!byTag.has(tag)) {
    byTag.set(tag, n);
    return;
  }
  const had = byTag.get(tag);
  byTag.set(tag, had === undefined ? n : had + (n ?? 0));
}

function finish(byTag: Map<PlayEffectTag, number | undefined>): PlayEffect[] {
  return [...byTag].map(([tag, amount]) => (amount === undefined ? { tag } : { tag, amount }));
}

/** Summarise one mode's effects. */
export function summariseEffects(effects: readonly EffectPrimitive[]): PlayEffect[] {
  const byTag = new Map<PlayEffectTag, number | undefined>();
  for (const e of effects) {
    const tag = EFFECT_TAGS[e.kind];
    if (tag) add(byTag, tag, amountOf(e));
  }
  return finish(byTag);
}

/**
 * Summarise what a card puts into PLAY — the half that has no effects.
 *
 * `board` is unconditional for anything lasting, and the refinements go on
 * top rather than replacing it: a hunting ground is a card on the table
 * *and* a source of blood, and a policy weighing whether to spend four
 * pool wants both facts.
 */
export function summarisePermanent(spec: CardSpec): PlayEffect[] {
  const byTag = new Map<PlayEffectTag, number | undefined>();
  const perm = spec.permanent as Record<string, unknown> | undefined;
  if (perm || spec.ally) add(byTag, "board");
  // A weapon is on the table to hit with, which is not what `board`
  // conveys on its own.
  // `damage: null` is a weapon whose strike is not a damage strike, so it
  // contributes the tag without a size rather than a zero.
  if (spec.weapon) add(byTag, "damage", spec.weapon.damage ?? undefined);
  if (spec.rush) add(byTag, "combat");
  if (spec.ally) add(byTag, "combat", spec.ally.strength);
  if (spec.ally?.bleed) add(byTag, "bleed", spec.ally.bleed);
  if (!perm) return finish(byTag);
  for (const key of Object.keys(perm)) {
    if (perm[key] === undefined) continue;
    const tag = PERMANENT_TAGS[key];
    if (tag) add(byTag, tag);
  }
  const statics = (perm["statics"] ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(statics)) {
    const v = statics[key];
    if (v === undefined || v === false) continue;
    const tag = STATIC_TAGS[key as keyof PermanentStatics];
    if (tag) add(byTag, tag, typeof v === "number" ? v : undefined);
  }
  return finish(byTag);
}

/** One card's whole summary for one mode: what it does, plus what it
 *  leaves on the table. */
export function summariseMode(spec: CardSpec, effects: readonly EffectPrimitive[]): PlayEffect[] {
  const byTag = new Map<PlayEffectTag, number | undefined>();
  for (const e of [...summariseEffects(effects), ...summarisePermanent(spec)]) {
    add(byTag, e.tag, e.amount);
  }
  return finish(byTag);
}
