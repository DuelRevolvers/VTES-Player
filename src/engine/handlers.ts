/**
 * Card handlers — how cards plug into windows (design §6). The engine
 * never special-cases a card: it asks every registered handler for legal
 * options at the current window, and runs the handler's resolve() when
 * the card's as-played window closes uncanceled.
 */

import type { WindowId, LegalOption, PlayEffect } from "./options.ts";
import type {
  ActionFrame,
  ActionId,
  ActionKind,
  AfterCombatRider,
  AimRider,
  AmmoLoad,
  BlockAttemptFrame,
  CardInstance,
  CardInstanceId,
  CardPlayFrame,
  ChoiceFrame,
  CombatFrame,
  CombatRoundDamageRider,
  DisciplineLevel,
  GameEvent,
  GameState,
  MinionId,
  MinionState,
  PermanentAura,
  VampireTitle,
  PermanentCostSource,
  PermanentCounterSink,
  PermanentInPlay,
  PermanentStatics,
  PlayCostCardType,
  DelayedDrawCondition,
  PlayCostMod,
  ReferendumFrame,
  Sect,
  SeatId,
  StrikeKind,
  GrantedStrike,
  VoteGrants,
} from "./state.ts";

/** What a handler may see when enumerating options. Pure — no mutation. */
export interface PlayContext {
  state: GameState;
  seat: SeatId;
  window: WindowId;
  /** Whose game turn it is. `turn.unlock` is offered to other seats too
   *  ("during ANY Methuselah's unlock phase", Homunculus), so a card that
   *  says "during YOUR unlock phase" must compare this to its controller,
   *  not just `seat`. */
  turnSeat: SeatId;
  /** Innermost action frame, if an action is underway. */
  action: ActionFrame | null;
  /** The unresolved block attempt (action state B), if any — while it
   *  exists the target cannot be changed and the stealth/intercept
   *  "only when needed" rules apply (§3.3). */
  blockAttempt: BlockAttemptFrame | null;
  /** Convenience: blockAttempt !== null. */
  inBlockAttempt: boolean;
  /** The current combat, if any — combat cards check their combatant and
   *  the current step through this. */
  combat: CombatFrame | null;
  /** The card currently in its as-played window, if that is where we are —
   *  cancel-as-played effects target this. */
  pendingCard: CardPlayFrame | null;
  /** The referendum underway, if the current window is a referendum step
   *  (polling-step vote cards read the caller/calling minion here). */
  referendum: ReferendumFrame | null;
  /** Every registered handler, for a card that must reason about a
   *  DIFFERENT card — "equip this vampire with a melee weapon from your
   *  hand" has to know each hand card's type, tags, modes and cost, and
   *  the hand holds only `{ id, name }`. Denormalization answers what a
   *  card knows about itself; this is the one question it cannot.
   *  docs/play-from-hand-design.md §7 */
  registry: HandlerRegistry;
}

/** What a handler may do when resolving. emit() is the only mutation
 *  channel — the engine applies each event to entities and frames. */
export interface EngineOps {
  readonly state: GameState;
  /** Every registered handler — for a card that must reason about a
   *  DIFFERENT card while RESOLVING (the enumeration-time counterpart is
   *  `PlayContext.registry`). A search reads the type and cost of cards
   *  it finds in the library. docs/library-search-design.md §4 */
  readonly registry: HandlerRegistry;
  /** Innermost action frame, if any. */
  action(): ActionFrame | null;
  emit(ev: GameEvent): void;
  /** Action cards call this from resolve(): lock the minion, announce the
   *  action, push the ActionFrame. The engine owns the mechanics; the
   *  handler owns the card-specific parameters. */
  announceCardAction(play: CardPlayFrame, params: CardActionParams): void;
  // Combat-card operations (all called from resolve(); the engine owns
  // the frame mechanics):
  /** Set the playing minion's strike for this round. */
  chooseCardStrike(play: CardPlayFrame, strike: CardStrikeParams): void;
  /** Toggle range; the opponent gets the next maneuver opportunity. */
  applyManeuver(play: CardPlayFrame): void;
  /** Use a press: continue combat, or cancel a standing press to
   *  continue (playing a press card IS the press). */
  applyPressCard(play: CardPlayFrame, toContinue: boolean): void;
  /** Register "this minion burns N before action resolution unless they
   *  block" (Forced Awakening). */
  registerNotBlockPenalty(play: CardPlayFrame, amount: number): void;
  /** The seat-charged variant: "if that minion does not block, burn N
   *  POOL after action resolution" (WMRH Talk Radio).
   *  docs/action-time-locations-design.md §3 */
  registerNotBlockPoolPenalty(minion: MinionId, amount: number, seat: SeatId): void;
  /** "After action resolution, if that action was successful, unlock the
   *  acting minion" (Warsaw Station). */
  registerUnlockOnSuccess(minion: MinionId): void;
  /** Announce an action granted by a card in play (rush design §2.5,
   *  generalized in docs/granted-actions-design.md §4.1): the engine locks
   *  the minion, records the per-minion per-copy use (p. 20), applies the
   *  action's inherent stealth, and pushes the ActionFrame. Directedness
   *  derives from the target minion's controller; an action with no target
   *  minion is undirected (p. 25). */
  announceEntryAction(
    entry: PermanentInPlay,
    minion: MinionId,
    args: {
      /** Omit for a rush (combat is the effect); set for anything else,
       *  dispatched back to the card's `resolveGrantedAction` on success. */
      effect?: { key: string; params?: Record<string, string> };
      /** "This vampire can BLEED as a Ⓓ action" (Codex of the Edenic
       *  Groundskeepers). Defaults to `cardEffect`, which every granted
       *  action was before; a granted bleed follows all bleed rules
       *  (p. 23). docs/granted-bleed-design.md */
      actionKind?: ActionKind;
      targetMinion?: MinionId | null;
      /** A card in play this action targets ("burn this card as a Ⓓ
       *  action") — directed at that card's controller. */
      targetPermanent?: CardInstanceId | null;
      /** The action's own stealth bonus ("as a +1 stealth action"). */
      stealth?: number;
      /** "…as a Ⓓ action that costs 2 pool / 1 blood" — paid at
       *  resolution, only on success (p. 27). */
      cost?: { pool?: number; blood?: number };
      riders?: { maneuver?: number; press?: number };
      /** "…as a +1 stealth POLITICAL action" (Anarch Revolt, War of Ages):
       *  one per vampire per turn (p. 24), and undirected — such a grant
       *  passes no `targetPermanent` even though it aims at a card in
       *  play. docs/pool-drain-design.md §6 */
      political?: boolean;
      /** The card whose referendum a successful political action calls. */
      referendumSource?: {
        cardName: string;
        cardInstanceId: CardInstanceId;
        fromCardInPlay?: boolean;
      };
    },
  ): void;
  /** Ability-based prevention (War Ghoul's "prevent 1 each round"):
   *  prevents on the current pending damage and marks the card's
   *  per-round use in the combat frame. */
  preventDamageAbility(
    minion: MinionId,
    cardId: CardInstanceId,
    amount: number,
    scope?: "round" | "combat",
  ): void;
  /** "Gets a strength of N this combat" (frame-scoped). */
  setCombatStrength(play: CardPlayFrame, value: number): void;
  /** "Gets +N strength this combat" — additive, whole-combat. */
  addCombatStrength(play: CardPlayFrame, amount: number): void;
  /** "Damage from this vampire's hand strikes is aggravated this round"
   *  (Claws of the Dead, Wolf Claws). */
  setHandStrikesAggravated(play: CardPlayFrame): void;
  /** The same, keyed on the MINION — an ability of a card in play has no
   *  CardPlayFrame (Crossbreaker). */
  setHandStrikesAggravatedFor(minion: MinionId | null): void;
  /** "Reaction cards cost +1 blood or life" (Consign to Oblivion) — a
   *  play-cost modifier for the rest of this action.
   *  docs/play-cost-design.md §2 */
  /** "This vampire can strike: burn equipment" (Heroic Might) — a strike
   *  that destroys instead of damaging; the victim's equipment card was
   *  chosen at strike time. docs/action-attachments-design.md §4 */
  chooseBurnEquipmentStrike(
    minion: MinionId,
    name: string,
    equipment: CardInstanceId,
  ): void;
  addPlayCostMod(mod: PlayCostMod): void;
  /** A play-cost modifier held by a METHUSELAH rather than by a frame or
   *  a card in play — the granting card burned itself to give it
   *  (Szlachta Assistant). docs/retainer-wave-design.md §4 */
  addSeatPlayCostMod(seat: SeatId, mod: PlayCostMod): void;
  /** "This combat, combat cards cost the OPPOSING vampire +1 blood"
   *  (Terror Frenzy superior). */
  addCombatCostModOnOpponent(play: CardPlayFrame, mod: PlayCostMod): void;
  /** "Those cards are not replaced until the end of the action"
   *  (Consign to Oblivion superior). */
  delayReplaceFor(types: PlayCostCardType[]): void;
  /** "The chosen minion cannot play reaction cards this action"
   *  (Unleashing the Bestial Soul). */
  barReactionsFrom(minion: MinionId): void;
  /** "The opposing vampire's strikes with weapons inflict no damage this
   *  round" (Blood Fury, Blood Rage, Soul Burn) — set on the side
   *  opposite the player. docs/discipline-filtered-design.md §4 */
  nullifyOpposingWeaponDamage(play: CardPlayFrame): void;
  /** "After combat ends, <do X>" — queue a rider on the current combat.
   *  docs/after-combat-ends-design.md §2 */
  addAfterCombatRider(rider: AfterCombatRider): void;
  /** "Put this card on this vampire / on the opposing vampire" from a
   *  combat card that is not a strike (Wall of Filth, Disarm). Returns
   *  the bearer, or null when there is none left to attach to — a
   *  combatant can be burned before End of Round runs (p. 32).
   *  docs/combat-attachments-design.md §2 */
  attachInCombat(
    play: CardPlayFrame,
    to: "self" | "opposing" | "anyInCombat" | "gunOnSelf",
    statics: PermanentStatics,
    tags: string[],
    extra?: { counters?: number; bearerId?: MinionId },
  ): MinionId | null;
  /** "Put this card in play and move up to N blood from the opposing
   *  vampire to this card" (Morbidity) — the store is the entry's
   *  counters. docs/combat-attachments-design.md §6 */
  storeCombatBlood(play: CardPlayFrame, amount: number): void;
  /** "…and send them to torpor" (Disarm) — a vampire sent to torpor
   *  outside the damage pipeline; an ally is burned instead, as
   *  `strikeIncapacitate` already reads it (p. 22). */
  sendToTorpor(minion: MinionId): void;
  /** "Prevent all damage from the opposing minion's strikes this round"
   *  (Rolling with the Punches superior). */
  preventAllFromOpponentThisRound(play: CardPlayFrame): void;
  /** "This combat, the opposing minion cannot maneuver / press / use
   *  equipment" (Terror Frenzy). */
  restrictCombatOpponent(
    play: CardPlayFrame,
    r: { maneuver: boolean; press: boolean; equipment: boolean },
  ): void;
  /** Grant N additional strikes this round (Blur etc.); a "(limited)"
   *  source consumes the one-per-round allowance (p. 32). */
  grantAdditionalStrike(play: CardPlayFrame, count: number, limited: boolean): void;
  /** "1 additional ranged strike: BURN WEAPON" (Voracious Vermin
   *  superior) — grants the SPECIFIED strike that the extra sub-round
   *  will offer, alongside the extra strike itself.
   *  docs/cheap-tail-design.md §4 */
  grantBurnEquipmentStrike(play: CardPlayFrame): void;
  /** "1 additional strike: DODGE" (Wind Dance superior) — the additional
   *  sub-round's strike is forced to this kind, not merely offered.
   *  docs/ledger-closeout.md §3 */
  forceAdditionalStrike(play: CardPlayFrame, kind: StrikeKind): void;
  /** A specified strike granted to a combatant by a card IN PLAY — "once
   *  each combat, this Ravnos can strike: dodge" (Treasured Samadji).
   *  Spent when taken. docs/weapon-riders-design.md §1 */
  grantStrikeToMinion(minion: MinionId, grant: GrantedStrike): void;
  /** "Gains blood equal to the amount of blood LOST by the opposing
   *  vampire to damage this round" (Taste of Vitae).
   *  docs/last-combat-design.md §2 */
  gainOpposingBloodLost(play: CardPlayFrame): void;
  /** "…and their initial strike that round must be with this weapon"
   *  (Sniper Rifle) — the .44 ruling's commitment, set from a card in
   *  play rather than by a maneuver. docs/weapon-riders-design.md §3 */
  commitStrikeTo(minion: MinionId, cardId: CardInstanceId): void;
  /** "Set the range for the first round of the resulting combat to long"
   *  (Sniper Rifle). */
  setCombatRange(range: "close" | "long"): void;
  /** "1 optional press, only usable to CONTINUE combat, each combat"
   *  (Righteous Blade) — a restricted credit, spent before a general one.
   *  docs/weapon-riders-design.md §4 */
  grantContinueOnlyPress(minion: MinionId, count: number): void;
  /** "Only usable if combat would end. Instead, start a new round"
   *  (Hunting the Quarry, Telepathic Tracking).
   *  docs/round-end-design.md §1 */
  startNewRound(): void;
  /** "Strikes that are not hand strikes cannot be used this round (by
   *  either combatant)" (Immortal Grapple). */
  restrictToHandStrikes(): void;
  /** "If another round of combat occurs, that round is at close range
   *  (skip the determine range step)" (Immortal Grapple superior). */
  skipNextRangeStep(): void;
  /** "If any damage from this strike is successfully inflicted, they take
   *  +N damage from this strike, and they cannot press this round"
   *  (Target Vitals). docs/round-end-design.md §3 */
  /** Play an aim card: `strikeDamage` applies to the strike now, the
   *  rider waits for the strike to actually inflict damage. */
  addAimRider(play: CardPlayFrame, rider: Omit<AimRider, "seat">, strikeDamage?: number): void;
  /** "Once each combat" for an ability that is not a prevention — the
   *  same latch `preventDamageAbility` writes with `scope: "combat"`. */
  markUsedThisCombat(cardId: CardInstanceId): void;
  /** "Once each round" — the sibling latch, emptied at the start of every
   *  round by the engine. */
  markUsedThisRound(cardId: CardInstanceId): void;
  /** The minion-addressed form of `grantAdditionalStrike`, for a card in
   *  play (which has no `CardPlayFrame`). */
  grantAdditionalStrikeTo(minion: MinionId, count: number, limited: boolean): void;
  /** "Ammo. … for the remainder of this combat" — load one ammo card into
   *  one gun, by the gun's card id (docs/ammo-design.md §4). */
  loadAmmo(gun: CardInstanceId, load: AmmoLoad): void;
  /** A one-shot play-cost modifier on the COMBAT frame rather than the
   *  action's (Focus the Blood). docs/before-range-attachments-design.md §3 */
  addCombatPlayCostMod(mod: PlayCostMod): void;
  /** Move a card stored on a card in play to its owner's ash heap — a
   *  magazine's round, once fired. */
  burnStoredCard(holder: CardInstanceId, cardId: CardInstanceId): void;
  /** Move a card stored on a card in play to the top or bottom of its
   *  owner's library (Maabara). docs/ash-heap-resource-design.md §3 */
  storedToLibrary(holder: CardInstanceId, cardId: CardInstanceId, to: "top" | "bottom"): void;
  /** Move a card straight from a seat's ash heap to its library
   *  (Waste Management Operation). docs/ash-heap-resource-design.md §3 */
  ashToLibrary(seat: SeatId, cardId: CardInstanceId, to: "top" | "bottom"): void;
  /** "Gains 1 optional press this combat" — a combat-persistent credit. */
  grantCombatPress(play: CardPlayFrame): void;
  /** The same per-combat press credit, from a card in play (Mob
   *  Connections) rather than a card being played. */
  grantCombatPressTo(side: "acting" | "opposing"): void;
  /** The mid-combat grants a card IN PLAY hands its bearer (Monstrous
   *  Form superior). Keyed on the minion, because an in-play ability has
   *  no `CardPlayFrame`. docs/combat-attachments-design.md §7 */
  addRoundStrengthTo(minion: MinionId, amount: number): void;
  /** "+N strength THAT COMBAT" (Kasim Bayar) — combat-long, unlike
   *  `addRoundStrengthTo`. docs/crypt-wave-4.md §1 */
  addCombatStrengthTo(minion: MinionId | null, amount: number): void;
  /** "You get +N discard phase actions" (Sreelekha). */
  addDiscardPhaseActions(n: number): void;
  /** "Look at and reorder the top N cards of your library" (Eulogio) —
   *  move one card to a position within the library. */
  moveLibraryCardTo(seatId: SeatId, cardId: CardInstanceId, position: number): void;
  /** "Move a library card from your ash heap to the BOTTOM of your
   *  library" (Mora). */
  ashHeapToLibraryBottom(seatId: SeatId, cardId: CardInstanceId): void;
  grantManeuverCreditTo(minion: MinionId): void;
  grantCombatPressToMinion(minion: MinionId): void;
  /** "…with 1 optional maneuver" — a combat maneuver credit. */
  grantManeuverCredit(play: CardPlayFrame): void;
  /** "This round, this vampire gets +N strength" (Obedient Flesh) — reset
   *  each round, unlike addCombatStrength. */
  addRoundStrength(play: CardPlayFrame, amount: number): void;
  /** "…and can prevent N damage" — a credit spent in the damage-resolution
   *  step, not prevention applied now. */
  /** "…can prevent N damage later this round" — `disciplines` is what the
   *  granting mode required, so `noPreventBy` can filter the credit. */
  grantPreventCredit(play: CardPlayFrame, amount: number, disciplines?: string[]): void;
  /** "This vampire treats aggravated damage as normal damage for the
   *  remainder of this round" (Skin of Night). */
  /** "Unlock this vampire at the end of the turn" (Zephyr basic). */
  oweUnlockAtEndOfTurn(minion: MinionId): void;
  /** "Remove the top card of that Methuselah's crypt from the game"
   *  (Innocent Bystander). */
  removeTopOfCryptFromGame(seat: SeatId): void;
  /** "This vampire's strikes may not be dodged this round" (Sanguinary Wind). */
  setStrikesUndodgeableRound(play: CardPlayFrame): void;
  /** "Instead, the opposing minion chooses his or her strike first." */
  swapStrikeOrder(): void;
  /** "…if another round of combat starts, you get +N hand size." */
  oweHandSizeNextRound(seat: SeatId, amount: number): void;
  treatAggravatedAsNormal(play: CardPlayFrame): void;
  /** The same at ONE STRIKE's scope, marked on the damage items
   *  (Adaptability basic). docs/aggravated-damage-design.md §3 */
  treatOpposingStrikeAggravatedAsNormal(play: CardPlayFrame): void;
  /** "Prevent all AGGRAVATED damage from the opposing minion's strike"
   *  (Adaptability superior) — normal damage from it still lands. */
  preventAllAggravatedFrom(play: CardPlayFrame): void;
  /** "…for the remainder of this COMBAT, this vampire's hand damage is
   *  aggravated" (Bone Spur superior). §2 */
  setHandStrikesAggravatedForCombat(play: CardPlayFrame): void;
  /** "This combat, this vampire can prevent N damage EACH ROUND" (Bear's
   *  Skin superior, Tranquility Shield) — a rate that refreshes, unlike
   *  the credit above. docs/round-recurring-combat-design.md §2 */
  grantPreventEachRound(play: CardPlayFrame, amount: number): void;
  /** "This combat, <X> takes N damage each round" (Carrion Crows, Weather
   *  Control) — installed and fired once immediately. §3 */
  addRoundDamage(
    play: CardPlayFrame,
    r: Omit<CombatRoundDamageRider, "from" | "startRound">,
  ): void;
  /** "…if a damage is inflicted on this vampire in a round, any
   *  additional damage that round is automatically prevented" (Flesh of
   *  Marble). §5 */
  setAutoPreventAfterFirst(play: CardPlayFrame, aggravated: boolean): void;
  /** "Frenzy cards cannot be used on this vampire this combat; cancel the
   *  effects of those already used on them" (Tranquility Shield). §6 */
  shieldFromFrenzy(play: CardPlayFrame): void;
  /** Prevent damage on the currently-resolving pending damage. */
  preventDamage(play: CardPlayFrame, amount: number): void;
  /** Grant a press credit spendable in this round's press step. */
  /** "You gain the Edge" (Esteem) / "the chosen Methuselah gets the Edge"
   *  (Regaining the Upper Hand). docs/the-edge-design.md §2 */
  takeEdge(seat: SeatId): void;
  /** "Burn the Edge to …" (Leverage) — a no-op if this seat does not hold
   *  it, which the option gate has already made impossible. */
  burnEdge(seat: SeatId): void;
  /** "You cannot gain the Edge this action; if you would get the Edge, it
   *  is burned instead" (Leverage). docs/the-edge-design.md §3 */
  suppressEdgeGainThisAction(): void;
  grantPress(play: CardPlayFrame): void;
  /** "If the opposing minion's strike successfully inflicts any damage on
   *  this minion this round, the opposing minion gets an optional press"
   *  (Backstep). docs/cancel-in-combat-design.md §4 */
  grantPressToStrikerIfDamaged(play: CardPlayFrame): void;
  /** Cancel the card whose as-played window we are in (p. 7). With
   *  refund, its already-paid cost is returned (Sudden Reversal). */
  cancelPendingCard(refundCost: boolean): void;
  /** Grant a seat bonus votes in the current referendum, cast as a source
   *  in the polling step (docs/polling-votes-design.md §3). `direction` is
   *  what the granting CARD printed, not what the seat wants: "+3 votes
   *  against the referendum" (Protected District) cannot be cast for it.
   *  Omitted means "any", which is every other vote grant in the pool. */
  grantVotes(seat: SeatId, amount: number, direction?: keyof VoteGrants): void;
  /** "If this vampire blocks, it gets N maneuvers/presses in the resulting
   *  combat" (Spirit's Touch). */
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
  ): void;
  /** "This vampire unlocks and attempts to block" (Sense the Savage Way) —
   *  unlock + queue a forced block with an optional intercept bonus and an
   *  optional "if it did not block" penalty (Dogged Pursuit). */
  unlockAndAttemptBlock(
    minion: MinionId,
    opts: {
      interceptBonus?: number;
      bloodCost?: number;
      noBlockPenalty?: { kind: "lock" } | { kind: "attach"; cardId: CardInstanceId; cardName: string };
    },
  ): void;
  /** "Unlock this vampire" (Guard Dogs) — unlock so the controller can then
   *  block through the normal flow. */
  unlockReactingMinion(minion: MinionId): void;
  /** "During this action, this vampire can burn 1 blood for +1 intercept"
   *  (Eyes of the Wild) — a repeatable, action-scoped grant. */
  grantBurnForIntercept(minion: MinionId): void;
  /** Mark a card-in-play's "once each action" ability as used (Under
   *  Siege) — action-scoped. */
  markInPlayAbilityUsed(cardId: CardInstanceId): void;
  /** "If this vampire blocks, put this card on the acting minion; you still
   *  control it" (Melange). */
  attachToActorOnBlock(minion: MinionId, cardId: CardInstanceId, cardName: string, seat: SeatId): void;
  /** Add/remove generic counters on a card in play (counter cards). */
  addCounters(cardId: CardInstanceId, amount: number): void;
  removeCounters(cardId: CardInstanceId, amount: number): void;
  /** "Control can change through game effects" (p. 16 —
   *  docs/control-change-design.md): move a minion, or a card in play, to
   *  another Methuselah. Ownership is untouched. */
  changeMinionControl(minion: MinionId, to: SeatId): void;
  /** "Take control of them UNTIL THE END OF YOUR TURN" (Puppet Master
   *  superior) — `changeMinionControl` plus the return address, honoured
   *  in `endTurn`. docs/taking-actions-design.md §3 */
  borrowMinion(minion: MinionId, to: SeatId): void;
  changePermanentControl(cardId: CardInstanceId, to: SeatId): void;
  /** The Methuselah controlling a card in play, or null if it has left. */
  controllerOfEntry(cardId: CardInstanceId): SeatId | null;
  /** Add/remove a seat's corruption counters on a minion. */
  addCorruption(minion: MinionId, seat: SeatId, amount: number): void;
  removeCorruption(minion: MinionId, seat: SeatId, amount: number): void;
  /** Named counters on a minion that belong to no Methuselah (hostage
   *  counters, nightmare counters). Removal clamps at 0. */
  addMinionCounters(minion: MinionId, kind: string, amount: number): void;
  /** "Stun a minion": lock them and put a stun counter on them. A minion
   *  with one or more stun counters does not unlock as normal at the
   *  beginning of their controller's unlock phase, and the counters they
   *  held at the beginning of that turn are burned during it.
   *  Owner ruling 2026-08-31 — docs/stun-design.md */
  stun(minion: MinionId): void;
  /** "Non-<sect> vampires cannot cast votes or ballots this referendum"
   *  (Closed Session, Private Audience; p. 28). */
  restrictReferendumVotes(sect: Sect): void;
  /** "Vampires who do not follow the Path of \<x\> get −1 vote" (Absolute
   *  Tyranny superior) — a per-vampire modifier on this referendum's vote
   *  counts, clamped at zero where votes are counted.
   *  docs/path-cards-design.md §4 */
  modifyAllReferendumVotes(amount: number, exceptPath?: string): void;
  /** "Burn 1 of your corruption counters from a blocking minion to have
   *  their block attempt fail" (Enchanting Gaze). */
  /** "That block attempt fails and the blocking minion cannot attempt to
   *  block this action again" (Elder Impersonation, Relentlessness). */
  failBlockAttempt(): void;
  /** "The blocking minion gets -N intercept", played by the acting
   *  minion against the current blocker. */
  modifyBlockerIntercept(delta: number, source: string): void;
  corruptFailBlock(seat: SeatId): void;
  /** "If the bleed is successful, burn 2 of your corruption from a minion of
   *  the target to unlock" (Revelation of the Serpent). */
  registerCorruptionUnlock(minion: MinionId, seat: SeatId): void;
  /** "X cannot block this action" — allies/vampires/titled outright, or a
   *  chosen vampire by id (Seduction, Visions of Gehenna; p. 26). */
  restrictBlocking(
    who: "allies" | "vampires" | "titled" | "chosen" | "all",
    chosen?: MinionId,
  ): void;
  /** "Minions [without X] must burn 1 blood [or life] to attempt to block
   *  this action" (docs/block-tax-design.md). Cumulative. */
  imposeBlockCost(
    cost: { amount: number; payWith: "blood" | "bloodOrLife"; exemptDiscipline?: string },
    source: string,
  ): void;
  /** "Minions get -1 intercept" — action-wide, unlike modifyBlockerIntercept,
   *  which pushes down the minion currently attempting the block. */
  modifyAllIntercept(
    delta: number,
    source: string,
    appliesTo?: "vampire" | "ally",
    exemptDisciplines?: string[],
  ): void;
  /** "Allies and younger vampires get −1 intercept" (Perfect Paragon
   *  superior) — the same event with a two-clause filter; the English
   *  "and" is a UNION. docs/opposing-statics-design.md §1 */
  modifyFilteredIntercept(
    delta: number,
    source: string,
    filter: { kinds?: Array<"vampire" | "ally">; younger?: boolean; sects?: Sect[] },
  ): void;
  /** "If this vampire is blocked, they get X in the resulting combat"
   *  (Beast Meld, Invigorate) — the acting-minion mirror of
   *  grantBlockerCombatRider. */
  grantActorCombatRider(riders: {
    prevent?: number;
    strength?: number;
    maneuver?: number;
    press?: number;
    handStrikesAggravated?: boolean;
    /** "All damage inflicted on vampires during the resulting combat is
     *  aggravated" (Dawn Operation) — symmetric, and combat-long. */
    combatAggravated?: boolean;
    /** "…and cannot use equipment during the resulting combat" (Form of
     *  the Bat) — the actor restricting itself. */
    noEquipment?: boolean;
  }): void;
  /** "If a vampire is currently attempting to block, they can cancel their
   *  block attempt" (Dawn Operation) — offers the blocking seat a way out
   *  in its own impulse. A no-op with no attempt underway. */
  offerBlockerCancel(): void;
  /** "Lock this vampire and the blocking minion, and queue a combat
   *  between them" (Hedonism) — neither is the acting minion, and the
   *  combat waits until this action is off the stack. */
  /** A combat between two minions, entered after the action pops —
   *  optionally carrying an after-combat rider, which is how Yawp Court
   *  charges its own vampire for a failed ambush.
   *  docs/crypt-and-uncontrolled-design.md §5 */
  queueCombat(a: MinionId, b: MinionId, outcome?: AfterCombatRider): void;
  /** Hedonism's whole effect: fail the current block attempt, lock the
   *  interposing vampire and the blocker, and (inferior only) queue the
   *  combat between them. */
  interposeOnBlocker(interposer: MinionId, combat: boolean): void;
  /** "Give the next X actions minions you control perform this turn +1
   *  stealth" (Veil the Legions superior). */
  grantStealthCharges(seat: SeatId, count: number): void;
  /** "The first referendum a \<sect\> vampire you control calls on this
   *  turn passes automatically" (Día de los Muertos).
   *  docs/politics-locations-design.md §4 */
  armAutoPassReferendum(seat: SeatId, cond?: { sect?: Sect; thisTurnOnly?: boolean }): void;
  /** "Only one <card> can be played at superior each turn". */
  recordSuperiorPlay(seat: SeatId, card: string): void;
  // Referendum interference (docs/abstain-gate-design.md):
  /** "Force a vampire to abstain (this cancels their votes and ballots)" —
   *  removes votes already cast AND bars them from casting again. */
  forceAbstain(minion: MinionId): void;
  /** "Cancel the referendum" — it never resolves, and the calling card
   *  goes back to its owner's hand rather than burning. */
  cancelReferendum(): void;
  /** "…have the referendum fail" — it DOES resolve, as a failure. */
  failReferendum(): void;
  /** "…have the action fail" (Yoruba Shrine) — no cost paid, no effect. */
  failAction(): void;
  /** "The action ends (unsuccessfully)" before block resolution: the
   *  pending block attempt is CANCELLED, not failed, so the blocker is
   *  not locked for blocking (p. 47). docs/end-action-design.md §3 */
  endAction(args?: { unlockActor?: boolean; lockBlocker?: boolean }): void;
  /** "…cannot perform the same action again this turn" — for the acting
   *  minion, or for every minion of the acting Methuselah. */
  barRepeatAction(scope: "minion" | "seat"): void;
  /** "Minions who attempt to block this action and fail become locked
   *  before action resolution" (Faceless Night) — from now on, never
   *  retroactively (p. 48). */
  lockFailedBlockers(): void;
  /** "Prevent N damage to a minion or retainer in combat" played by a
   *  vampire NOT in that combat — the victim is named, not assumed.
   *  docs/outside-combat-design.md */
  preventDamageFor(minion: MinionId, amount: number): void;
  /** "End a combat involving another minion you control", from outside it
   *  (Saulot's Guiding Wisdom). End of Round still runs (p. 32). */
  endCombatFromOutside(): void;
  /** "…once results are tallied" — an effect that outlives the tally. */
  addPostTally(effect: NonNullable<ReferendumFrame["postTally"]>[number]): void;
  /** "Cannot play reaction cards, block or cast votes or ballots this
   *  turn" (Expulsion). */
  expelMinion(minion: MinionId): void;
  /** "During this action, minions cannot unlock" (The Sleeping Mind). */
  preventUnlockDuringAction(): void;
  /** "This vampire takes N unpreventable environmental aggravated damage
   *  after action resolution" (Daring the Dawn). */
  damageAfterAction(
    minion: MinionId,
    amount: number,
    aggravated: boolean,
    /** "…can burn N blood to be immune to this damage" (Rutor's Hand
     *  superior): the offer travels with the damage, because the question
     *  must be asked before it lands. */
    optOut?: { blood: number; cardName: string; cardId: string },
  ): void;
  /** Environmental damage outside combat — `source: null`, no prevention
   *  window (p. 31). The one place after-resolution damage is applied, so
   *  a card answering a pay-to-opt-out question lands it the same way the
   *  engine would have (docs/ledger-closeout.md §10). */
  applyEnvironmentalDamage(minion: MinionId, amount: number, aggravated: boolean): void;
  /** "Continue the action as if unblocked" (Go-getter superior) — flags
   *  the action frame; the engine runs its success effects (and not its
   *  tail) when the after-resolution window closes.
   *  docs/ledger-closeout.md §11 */
  continueActionAsUnblocked(): void;
  // Permanents:
  /** Put a card into play as a permanent (seat-level, or attached). */
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
    /** Shadow Cast: the Methuselah the placing action was directed at. */
    againstSeat?: SeatId;
    /** A minion this card is ABOUT but not attached to (Slaughtering the
     *  Herd). docs/taking-actions-design.md §6 */
    linkedMinion?: MinionId;
  }): void;
  /** Ask one Methuselah a question as part of this card's resolution
   *  (docs/choice-frames-design.md). Optional questions get a decline. */
  raiseChoice(args: {
    seat: SeatId;
    cardName: string;
    cardId: CardInstanceId;
    key: string;
    params?: Record<string, string>;
    optional?: boolean;
  }): void;
  /** Draw N cards from the library (extra cards, not replacements). */
  drawCards(seat: SeatId, count: number): void;
  /** "…and draw a new one" / "…draws back up to his or her hand size"
   *  (Deal with the Devil, Lupine Assault). docs/hand-churn-design.md §2 */
  drawUpToHandSize(seat: SeatId): void;
  /** Discard a card; No files replaced false skips the replacement draw (a
   *  "discard down" is not a play, p. 7). */
  discardFromHand(seat: SeatId, cardId: CardInstanceId, replace: boolean): void;
  /** "Shuffle this card into your library" (Aranthebes) — leaves play,
   *  back to its owner's library, which is shuffled. */
  shuffleIntoLibrary(cardId: CardInstanceId): void;
  /** Burn a permanent in play (Vessel eating a Blood Doll). */
  burnPermanent(cardId: CardInstanceId): void;
  /** "…can burn 1 blood during your next discard phase to unlock"
   *  (Fiendish Tongue) — recorded on the minion, since the card granting
   *  it is burnt at resolution. docs/last-buildable-design.md §1 */
  grantDiscardPhaseUnlock(minion: MinionId): void;
  /** "Equip this vampire with a melee weapon from your hand" / "employ an
   *  animal retainer from your hand" / "recruit or employ an ally or
   *  retainer from your hand" — bring a permanent card into play from
   *  hand with no action wrapped around it. The card leaves hand, a
   *  `CardPlayed` is emitted, the cost is paid NOW (there is no action to
   *  fail, §4), and it enters play on `minion` exactly as a successful
   *  equip/employ/recruit would have put it there.
   *  docs/play-from-hand-design.md */
  playCardFromHand(args: {
    cardId: CardInstanceId;
    seat: SeatId;
    minion: MinionId;
    /** The incoming card's chosen printed version, fixed here (p. 22). */
    mode: DisciplineLevel | null;
    /** Blood the bearer pays in place of pool (Contraband superior). */
    blood?: number;
    /** Which pile the card comes from — hand by default; the LIBRARY for
     *  a search (Magic of the Smith) and a card's out-of-play STORE for
     *  Fleshforge Chamber. docs/library-search-design.md §7 */
    from?: { zone: "hand" | "library" } | { zone: "store"; holder: CardInstanceId };
  }): void;
  /** "You must shuffle it afterwards" (p. 14) — after every search,
   *  including one that found nothing. */
  shuffleLibrary(seat: SeatId): void;
  /** "Move a card from your hand to the BOTTOM of your library" (Heart of
   *  Nizchetus) — not a discard: it never reaches the ash heap and draws
   *  no replacement. docs/cheap-tail-design.md §5 */
  buryInLibrary(seat: SeatId, cardId: CardInstanceId): void;
  /** "Draw 1 card from your crypt" — it goes to the UNCONTROLLED region
   *  (p. 3). docs/crypt-and-uncontrolled-design.md §1 */
  drawFromCrypt(seat: SeatId): void;
  /** "…otherwise, move it to the bottom of your crypt" (Family
   *  Gathering). */
  buryInCrypt(seat: SeatId, minion: MinionId): void;
  /** "Remove a crypt card in your uncontrolled region from the game"
   *  (Wider View) — the uncontrolled counterpart to
   *  removeMinionFromGame, which only knows about minions in PLAY. */
  removeUncontrolledFromGame(seat: SeatId, minion: MinionId): void;
  /** "You can use N transfers to …" (Wider View) — the influence phase's
   *  currency, spent by a card in play. §2 */
  spendTransfers(n: number): void;
  /** "…(discarding and shuffling afterward)" (Inconnu Tutelage) — p. 7's
   *  discard-down, asked of the engine, which owns the question. */
  discardDownToHandSize(seat: SeatId, cardName: string, cardId: CardInstanceId): void;
  /** "Move that vampire from your uncontrolled region to your ready region,
   *  with any counters he or she has" (Gather, Tomb of Rameses III) — the
   *  same move `inf:out` makes, pool tax and all.
   *  docs/uncontrolled-graduation-design.md §2 */
  moveUncontrolledToReady(seat: SeatId, minion: MinionId): void;
  /** "Choose a vampire in your uncontrolled region" (Gather, Tomb of
   *  Rameses III) — the card in play remembers which one. §2 */
  linkUncontrolled(cardId: CardInstanceId, minion: MinionId): void;
  /** An integer in [0, n) from the seeded RNG — "a card at random"
   *  (Constant Revolution, The Gate of Acheron). Principle 2 says all
   *  randomness flows through the one generator, and this is the
   *  card→engine boundary, so no card reads `state.rngState` itself.
   *  docs/unlock-tolls-design.md §2 */
  randomIndex(n: number): number;
  /** Move a card out of play onto a card in play: the top of the library
   *  when `cardId` is omitted, else that named card from the library or
   *  hand. docs/library-search-design.md §5 */
  storeCard(args: {
    holder: CardInstanceId;
    from: "library" | "hand" | "ashHeap";
    cardId?: CardInstanceId;
    faceUp: boolean;
    /** Whose pile, when that is not the holder's controller. */
    fromSeat?: SeatId;
  }): void;
  /** Draw the top library card with NO redirect check — for the redirect
   *  choice's own answer, which must not go back through the ordinary
   *  draw or it would re-raise itself forever.
   *  docs/library-search-design.md §6 */
  drawFromLibrary(seat: SeatId): void;
  /** "This round, this vampire gets 1 optional maneuver, only usable to
   *  get to close range" (Angel's Gift). */
  grantCloseManeuver(play: CardPlayFrame): void;
  /** Burn a minion from play: attached cards burn with it (p. 11); if it
   *  was a combatant, the combat ends (p. 30). */
  burnMinion(minion: MinionId): void;
  /** The diablerie resolution as one indivisible unit (p. 34): all the
   *  victim's blood moves to the diablerist, the victim is burned, then a
   *  blood-hunt referendum is conducted (p. 35). */
  commitDiablerie(diablerist: MinionId, victim: MinionId): void;
  /** Burn life from a retainer; at 0 life the retainer is burned (p. 22). */
  burnRetainerLife(cardId: CardInstanceId, amount: number): void;
  /** "Remove a vampire from the game" (Golconda: Inner Peace) — p. 16
   *  names it as a fate distinct from burning, so a card keyed on
   *  `how: "burned"` does not fire. docs/cross-table-masters-design.md §3 */
  removeMinionFromGame(minion: MinionId): void;
  /** "Remove a card in <somebody's> ash heap from the game" — it leaves
   *  the state entirely (p. 16: it "cannot be retrieved or affected in
   *  any way"). docs/ash-heap-design.md §4 */
  removeFromAshHeap(seat: SeatId, cardId: CardInstanceId): void;
  /** "Search your library, hand, and/or ash heap for a \<card\> and PUT IT
   *  ON this vampire" — moved out of an out-of-play zone straight onto a
   *  minion. Not a play: no cost and no `CardPlayed`.
   *  docs/token-vampire-design.md §6 */
  attachFromZone(args: {
    seat: SeatId;
    cardId: CardInstanceId;
    zone: "library" | "hand" | "ashHeap";
    attachTo: MinionId;
  }): void;
  /** "Move a wraith or zombie ally from your ash heap to your ready region
   *  with life equal to its starting life" (Split the Veil) — the first
   *  effect that puts a MINION back into play. It is a MOVE, not a
   *  recruit, so the ally can act at once.
   *  docs/wraith-zombie-design.md §5 */
  returnAllyFromAshHeap(seat: SeatId, cardId: CardInstanceId): void;
  /** Move a card OUT of an ash heap and into a hand (Garibaldi-Meucci
   *  Museum's exchange). */
  takeFromAshHeap(seat: SeatId, cardId: CardInstanceId): void;
  /** Lock a permanent (lock-to-use abilities). */
  lockPermanent(cardId: CardInstanceId): void;
  /** "Methuselahs can use a master phase action and … to burn this card"
   *  (Tension in the Ranks) — an ability that costs the master phase
   *  action a master card would otherwise have used (p. 10). */
  spendMasterAction(): void;
  /** Move an attached card onto another minion (Regent's diablerie
   *  clause), keeping its counters and state. */
  moveAttachment(cardId: CardInstanceId, to: MinionId, controller?: SeatId): void;
  /** Discard a card from a seat's hand and draw up (The Barrens).
   *  `replace` (default true) draws a replacement — a forced "discard
   *  down" is not a play, so it passes false (p. 7). */
  discardFromHand(seat: SeatId, cardId: CardInstanceId, replace?: boolean): void;
  /** "\<This vampire\> can burn N blood to unlock \<self | the acting
   *  ally\> after action resolution" (Paths in Two Worlds superior, Gifts
   *  From Hereafter superior). Registered on the action frame now, offered
   *  as an optional question the moment the action resolves.
   *  docs/wraith-zombie-design.md §4 */
  addAfterResolutionUnlock(entry: {
    payer: MinionId;
    target: MinionId;
    blood: number;
    ifSuccessful?: boolean;
    cardName: string;
    cardId: CardInstanceId;
  }): void;
  /** "Lock when an anarch announces a hunting action. If that action is
   *  successful, the anarch gains an additional blood" (Hospital Food) — the
   *  announcement-time sibling of the after-resolution payout, and the reason
   *  the two hunt locations are one wave: same blood, different moment of
   *  commitment. docs/hunt-payouts-design.md §2 */
  addHuntBonusBlood(minion: MinionId, amount: number): void;
  /** "Cancel that blood hunt" (Absolution of the Diabolist) — called from the
   *  after-resolution impulse of a passed blood hunt, the one moment a vampire
   *  is "about to be burned" by one. docs/blood-hunt-answers-design.md §2 */
  cancelBloodHunt(): void;
  /** "+2 hand size until the end of the turn" (Dreams of the Sphinx),
   *  "this combat, you get +1 hand size" (Rage of Apedemak). The grant is
   *  recorded on the turn or combat frame whose lifetime it shares, so the
   *  frame going away IS the expiry; the seat draws up now (p. 7) and
   *  discards down when it lapses.
   *  docs/temporary-hand-size-design.md */
  addHandSizeBonus(args: {
    seat: SeatId;
    amount: number;
    scope: "turn" | "combat";
    cardName: string;
    cardId: CardInstanceId;
    /** "…until your next DISCARD PHASE" (Fotini) — lifts as that phase
     *  opens, earlier than the frame that holds it. */
    until?: "discardPhase";
  }): void;
  /** "That minion's initial strike this round gets FIRST STRIKE"
   *  (Haymaker) — a round-scoped grant, cleared with the round's other
   *  riders. docs/first-strike-design.md §1 */
  /** "Cancel the block and combat" — a combat that never happened.
   *  docs/no-combat-design.md §1 */
  cancelCombat(outcome: "continueAction" | "actionBlocked"): void;
  /** "No vampires of that clan may block the acting vampire for the
   *  remainder of the turn" (Clan Loyalty). docs/no-combat-design.md §2 */
  barClanFromBlocking(acting: MinionId, clan: string): void;
  /** "Put this card into play; it represents an ally" (Blood Brother
   *  Ambush) — returns the new minion's id. docs/no-combat-design.md §3 */
  putAllyFromCardInPlay(play: CardPlayFrame, mode: DisciplineLevel | null): MinionId | null;
  grantFirstStrike(side: "acting" | "opposing"): void;
  /** "If another round occurs, this minion gets first strike that round"
   *  (Forearm Block). docs/first-strike-cards-design.md §2 */
  grantFirstStrikeNextRound(play: CardPlayFrame): void;
  /** "Prevent N damage from the opposing minion's next HAND strike this
   *  round" (Forearm Block). docs/first-strike-cards-design.md §2 */
  armHandStrikePrevention(play: CardPlayFrame, amount: number): void;
  /** "This minion's initial strike this round will be strike: hand strike
   *  at +N damage" (Haymaker). docs/first-strike-cards-design.md §3 */
  forceHandStrike(play: CardPlayFrame, bonus: number): void;
  /** "If either minion inflicts more damage than the other this round,
   *  that minion gets an optional press" (Haymaker).
   *  docs/first-strike-cards-design.md §3 */
  armBiggerHitterPress(): void;
  /** Weapon maneuver: maneuvers AND commits the weapon's strike for the
   *  round; one weapon maneuver per combat (.44 ruling p. 47). */
  useWeaponManeuver(minion: MinionId, cardId: CardInstanceId): void;
  /** Choose a weapon's strike for the round. `damage: null` = strength +
   *  `handBonus` (melee); a number = fixed (gun). */
  chooseWeaponStrike(
    minion: MinionId,
    cardId: CardInstanceId,
    strike: {
      name: string;
      damage: number | null;
      ranged: boolean;
      handBonus?: number;
      aggravated?: boolean;
      /** "For each damage inflicted by this strike (even if prevented),
       *  burn 1 counter from this card" (Weighted Walking Stick). */
      depletes?: boolean;
      /** "Burn after use" (Grenade) — at strike RESOLUTION, not choice. */
      burnAfterUse?: boolean;
      /** "End combat as a strike" (Smoke Grenade). */
      combatEnds?: boolean;
      /** "…the bearer takes N damage" when used at close range (Grenade). */
      selfDamageAtCloseRange?: { amount: number; aggravated?: boolean };
      /** "…the bearer takes N damage during strike resolution when
       *  striking with this gun, but only once each combat" (Zip Gun) —
       *  the same damage, at any range, latched per combat. */
      selfDamageOnStrike?: { amount: number; aggravated?: boolean; oncePerCombat?: boolean };
    },
  ): void;
}

export interface CardStrikeParams {
  handBonus?: number;
  /** "Strike: put this card on the opposing minion with N counters". */
  attachToVictim?: {
    counters?: number;
    counterSink?: PermanentCounterSink;
    /** Statics the attached card grants its unwilling bearer. */
    statics?: PermanentStatics;
    /** "During their unlock phase, the attached minion burns 1 blood or
     *  life" (Sculpt the Flesh superior). */
    bearerUnlockBurn?: number;
    tags?: string[];
  };
  /** "Ranged strike: put this card on THIS minion; it becomes a weapon
   *  equipment" (Molotov Cocktail) — `attachToVictim` pointing the other
   *  way. docs/armed-mid-combat-design.md §2 */
  attachToSelf?: { statics?: PermanentStatics; tags?: string[] };
  /** "Strike: destroy equipment" / "Strike: steal weapon" — the card was
   *  chosen in the option id, so these carry its instance.
   *  docs/equipment-stripping-design.md §2 */
  burnEquipment?: CardInstanceId;
  stealEquipment?: CardInstanceId;
  /** "…This striking vampire ALSO takes N aggravated damage" (Burst of
   *  Sunlight) — what a weapon spells `selfDamageOnStrike`. Environmental
   *  (`source: null`), so no "damage from the opposing minion" prevention or
   *  reaction reads it. docs/aggravated-damage-design.md §4 */
  selfDamage?: { amount: number; aggravated?: boolean };
  /** "Strike: send the opposing vampire to torpor or burn the ally". */
  incapacitate?: boolean;
  combatEnds?: boolean;
  unlockSelf?: boolean;
  dodge?: boolean;
  /** Fixed damage (a card weapon-like strike, Body Flare). */
  damage?: number;
  ranged?: boolean;
  aggravated?: boolean;
  /** "Strike: steal N blood" (Theft of Vitae). */
  stealBlood?: number;
  /** "Damage from this strike cannot be prevented by cards requiring
   *  Fortitude [for]" (Blood Fury, Soul Burn, Soulgrinder superior).
   *  docs/discipline-filtered-design.md §3 */
  noPreventBy?: string[];
  /** "This strike cannot be dodged" (Dust Up).
   *  docs/last-combat-design.md §1 */
  undodgeable?: boolean;
  /** Use this WEAPON instead of a hand strike, keeping the card's bonus
   *  (Anticipation: "hand strike OR use a melee weapon strike"). */
  useWeapon?: CardInstanceId;
  /** "Strike: … WITH FIRST STRIKE" (Quick Jab) — this strike resolves
   *  before a normal one (p. 33). docs/first-strike-design.md §1 */
  firstStrike?: boolean;
  /** "If more than N damage is inflicted with this strike, ignore the
   *  excess" (Quick Jab). */
  capDamage?: number;
}

/** Parameters an action-card handler passes back to the engine to
 *  announce the action its card describes. */
export interface CardActionParams {
  actionKind: "bleed" | "cardEffect";
  /** "Bleed with +N bleed" — folded into the bleed amount, not counted
   *  against the "(limited)" modifier rule (p. 20). */
  bleedBonus?: number;
  /** "+1 stealth action" — inherent stealth of the card's action. */
  inherentStealth?: number;
  /** Rush: the minion this action enters combat with. Directedness
   *  derives from its controller (rush design §2.1). */
  targetMinion?: MinionId;
  /** "During that combat" rider credits (rush design §2.4), widened for
   *  strength and the first-round combat-ends bar
   *  (docs/rush-outcome-design.md §5). */
  rushRiders?: {
    maneuver?: number;
    press?: number;
    strength?: number;
    noCombatEndsFirstRound?: boolean;
  };
  /** "At the end of that combat, if <who is standing>, <payoff>" — a
   *  rider installed on the rush's own combat (docs/rush-outcome-design.md
   *  §2). Fixed at announcement like every other action detail (p. 25). */
  combatOutcome?: AfterCombatRider;
  /** Political action: marks the one-per-vampire-per-turn use (p. 24). */
  political?: boolean;
  /** "Ⓓ Steal 1 pool from another Methuselah" (Line Brawl) — an action
   *  card that targets a SEAT rather than a minion, chosen at
   *  announcement. Directed, so only that Methuselah may block (p. 25). */
  targetSeat?: SeatId;
  /** "Ⓓ Burn a location" / "Ⓓ Steal a location" played from hand — an
   *  action card that targets a CARD IN PLAY, directed at its controller.
   *  docs/permanent-target-actions-design.md */
  targetPermanent?: CardInstanceId;
  /** "Ⓓ Stun an unlocked vampire" (Mind Numb): this action names a minion
   *  for directedness but does NOT enter combat with it on success.
   *  docs/stun-design.md §6 */
  noCombat?: boolean;
  /** "The target vampire is considered the ACTING MINION during that
   *  combat" (Deep Song superior) — the rush's combat is pushed with the
   *  two sides swapped. Everything that asks "who is the acting minion of
   *  this combat" reads `cf.acting`, so a frame built the other way round
   *  IS the inverted combat. docs/last-buildable-design.md §3 */
  invertCombatRoles?: boolean;
  /** "Ⓓ Enter combat with AND LOCK a vampire" (Deep Song superior) — the
   *  lock happens on success, with the combat. */
  lockTarget?: boolean;
  /** "…with a LOCKED minion" — re-checked at resolution (Ambush). */
  requiresLockedTarget?: boolean;
  /** "Unlock a vampire" (Precognizant Mobility) — this action names a minion
   *  but prints NO Ⓓ, so naming another Methuselah's vampire must not make it
   *  directed at them (p. 25: the Ⓓ is what directs an action, not the
   *  target's controller). The sibling of `noCombat`: both say "I named this
   *  minion for a narrower reason than the rush shape assumes".
   *  docs/choosing-a-minion-design.md §5 */
  targetNotDirecting?: boolean;
}

export interface CardHandler {
  name: string;
  /** Cost burned from the playing minion. Non-action cards pay when
   *  played, win or lose; action cards pay at resolution, only on
   *  success (p. 27). */
  bloodCost: number;
  /** True for action cards: playing the card announces an action. */
  isActionCard?: boolean;
  /** "Do not replace until …" — defer the replacement draw (p. 7 default
   *  is immediate replacement). */
  /** `"afterResolve"` is "do not replace this card until AFTER you discard
   *  your hand" (Deal with the Devil): the replacement is drawn once the
   *  card's own resolution is done, so it is not drawn into the hand the card
   *  is about to throw away. docs/hand-churn-design.md §2 */
  delayedReplace?:
    | "unlock"
    /** "…until after the CURRENT turn" (Sonar). */
    | "turn"
    | "afterAction"
    | "afterCombat"
    | "discard"
    | "whileInPlay"
    | "afterResolve";
  /** "Do not replace until a vampire commits diablerie" and its siblings —
   *  the CONDITION form, which waits for an event rather than a phase.
   *  docs/gehenna-taxes-design.md §1 */
  delayedReplaceUntil?: DelayedDrawCondition;
  /** The burn option icon (p. 17): true when `seat` controls NO minion
   *  who meets this card's requirements or is a legal target for it, so
   *  the card may be discarded and replaced in any unlock phase.
   *  docs/burn-option-design.md */
  burnOptionDiscardable?(state: GameState, seat: SeatId): boolean;
  /** Does the chosen mode require a Discipline AT THE SUPERIOR LEVEL?
   *  ("Cards requiring 1 or more Disciplines at the superior level cost +1
   *  blood", The Slow Withering.) The sibling of `requiresDisciplines`,
   *  which answers WHICH but not at what level. */
  requiresSuperiorDiscipline?(mode: DisciplineLevel | null, variant?: string): boolean;
  /** Master cards: played by the Methuselah for a master phase action. */
  isMasterCard?: boolean;
  /** An EVENT card: put into play with a discard phase action, once each
   *  game (p. 37). docs/events-design.md §1 */
  isEventCard?: boolean;
  /** This card can CHANGE THE TARGET OF A BLEED (Deflection and its
   *  family) — what Narrow Minds taxes. docs/events-design.md §3 */
  redirectsBleed?: boolean;
  /** Trifles refund one master phase action per phase (p. 10). */
  isTrifle?: boolean;
  /** Out-of-turn masters: playable during another Methuselah's turn,
   *  consuming a master phase action from the next master phase (p. 8). */
  isOutOfTurnMaster?: boolean;
  /** Pool cost, burned by the Methuselah when the card is played (or at
   *  resolution for action/equipment cards). */
  poolCost?: number;
  /** Combat cards: recorded per round/combat for the "only one X each
   *  round/combat" limit; the limit itself is enforced in options(). */
  isCombatCard?: boolean;
  /** The load an AMMO card puts into a gun, or undefined for every other
   *  card. Exposed because Magazine reaches the same window holding an
   *  ammo card that was never in a hand: without this, "use the effect of
   *  the ammo card" would mean re-deriving five cards' effects in a
   *  second place. docs/before-range-attachments-design.md §4 */
  ammoLoad?(mode: DisciplineLevel | null): AmmoLoad | undefined;
  /** "A vampire can play only one X each round/combat" (p. 32). */
  combatLimit?: "round" | "combat";
  /** The same limit scoped to ONE MODE ("only one at superior each
   *  combat", Terror Frenzy), so the card's other mode stays free. */
  modeCombatLimit?(mode: DisciplineLevel | null, variant?: string): "round" | "combat" | undefined;
  /** Printed type includes Reaction — set from `spec.cardType`, the
   *  counterpart of `isCombatCard`, so a cancel-as-played effect can name
   *  the type it cancels. docs/discipline-filtered-design.md §5 */
  isReactionCard?: boolean;
  /** What this weapon would inflict WITH A REGULAR STRIKE against a
   *  generic opponent [RTR 19980623] — the figure Concealed Weapon's
   *  "cannot inflict 4 or more damage / aggravated damage" is measured
   *  against, and the only question anyone asks a weapon card that is
   *  still in a HAND. Denormalized here rather than looked up in the
   *  spec, because the asker holds a `CardHandler` and nothing else, and
   *  a card can become a weapon without being an equipment card.
   *  docs/armed-mid-combat-design.md §4 */
  /**
   * The weapon's own STRIKE, for a card that says "or use a melee/ranged
   * weapon strike at +N damage". `damage: null` means strength-based, which is
   * what every melee weapon in the pool is; a gun carries a number.
   * docs/bigger-strikes-design.md §3
   */
  weaponStrike?: {
    damage: number | null;
    handBonus: number;
    ranged: boolean;
    aggravated: boolean;
  };
  weaponProfile?: {
    /** Strength and other bonuses are NOT counted [LSJ 20020821]
     *  [LSJ 20020904], so a strength-based weapon is measured off the
     *  base 1 strength every minion has. A strike that ends combat
     *  inflicts nothing. */
    damage: number;
    /** PRINTED and unconditional only: Poker's aggravated damage against
     *  Kiasyd is conditional and does not count [LSJ 20020729]. */
    aggravated: boolean;
    /**
     * Does this weapon's strike REACH at long range (p. 30)?
     *
     * The thing a minion standing at long range most needs to know about
     * what it is holding. Without it the policy could only tell that a
     * bare hand strike does NOT reach, and preferred a gun by process of
     * elimination rather than because the gun works
     * (docs/ai-combat-range-design.md §5.1).
     */
    ranged: boolean;
  };
  /** Does this MODE restrict the opposing minion's CHOICE OF STRIKES?
   *  Answered centrally in `compileSpec` and stamped onto
   *  `CardPlayFrame.restrictsStrikeChoice` at push, so Groundfighting
   *  never reads another card's spec.
   *  docs/cancel-in-combat-design.md §3 */
  restrictsStrikeChoice?(
    mode: DisciplineLevel | null,
    variant?: string,
  ): "strikes" | "equipment" | null;
  /** Does this MODE declare a strike? Answered centrally in `compileSpec`
   *  from the mode's combat window, the same test `costTypes` uses to
   *  label a mode "strike". Stamped onto `CardPlayFrame.isStrike` at push
   *  so no card reads another card's spec.
   *  docs/vozhd-allies-design.md §5 */
  isStrikeCard?(mode: DisciplineLevel | null, variant?: string): boolean;
  /** Printed keywords ("Grapple.", "Aim.") — neither a card type nor a
   *  Discipline. Answered centrally in `compileSpec` and stamped onto
   *  `CardPlayFrame.keywords` at push, so a card filtering on one never
   *  reads another card's spec. docs/weapon-riders-design.md §5 */
  cardKeywords?(): string[];
  /** Equipment: played as an equip action; attaches on success. */
  isEquipment?: boolean;
  /** Retainer: played as an employ retainer action (undirected, +1
   *  stealth, p. 22); attaches to the acting minion with life on success. */
  isRetainer?: boolean;
  /** Ally: played as a recruit ally action (undirected, +1 stealth,
   *  p. 22); becomes a minion with life on success, cannot act this turn. */
  isAlly?: boolean;
  /** Political action card: success calls a referendum (p. 24, p. 27). */
  isPoliticalAction?: boolean;
  /**
   * Which way this card's referendum moves POOL — "burn", "gain", or
   * "other" for the many that move minions, cards or titles instead.
   *
   * Declared by the spec's referendum primitive and carried onto the
   * frame when the referendum is pushed, so an agent deciding how to vote
   * can tell a burn from a gift (docs/ai-referendum-view-design.md §5).
   * Absent for a bespoke handler with no referendum primitive, which
   * reads as "unknown" and must NOT be read as "other".
   */
  referendumEffect?: "burn" | "gain" | "other";
  /** Which terms key names the seats that lose pool and which names those
   *  that gain it. Absent where the terms name no seats — most
   *  pool-moving referendums charge the table from the BOARD instead. */
  referendumSeats?: {
    losers?: { key: string; each?: number };
    gainers?: { key: string; each?: number };
  };
  /** Which combatant this frenzy mode is used ON: true when its effects
   *  reach across at the other combatant (Terror Frenzy), false for a
   *  self-buff (Rage of Apedemak). Derived from the mode's own effects by
   *  `frenzyTargetSide`, so a new frenzy card classifies itself, and
   *  denormalized onto `CardPlayFrame.frenzyOnOpponent` at push time so a
   *  cancel effect never reads another card's spec.
   *  docs/round-recurring-combat-design.md §6 */
  frenzyTargetsOpponent?(mode: DisciplineLevel | null, variant?: string): boolean;
  /** "Their controller can burn N pool to CANCEL this card as it is
   *  played" (Golconda: Inner Peace; True Love's Face superior).
   *
   *  Answered at PUSH time and stamped onto `CardPlayFrame.payToCancel`,
   *  because who may pay depends on what this particular play targets —
   *  the option's own params. Returning null means nobody may.
   *  docs/cross-table-masters-design.md §2 */
  payToCancelFor?(
    state: GameState,
    seat: SeatId,
    params: Record<string, string>,
  ): { seat: SeatId; pool: number } | null;
  /** Frenzy keyword (p. 32) — a hook for cancel/immunity effects. */
  isFrenzy?: boolean;
  /** KRCG abbreviations of the Disciplines the given mode requires —
   *  the enabling query for every "cards requiring X" effect. Added
   *  centrally by `compileSpec`, so every spec-compiled card has it; the
   *  engine calls it once when it pushes the card's frame and caches the
   *  answer on `CardPlayFrame.requires`.
   *  docs/discipline-filtered-design.md §2 */
  requiresDisciplines?(mode: DisciplineLevel | null, variant?: string): string[];
  /** Every printed type this card counts as for a `PlayCostMod`, plus
   *  "strike" when the chosen mode sets a strike. Added centrally by
   *  `compileSpec` from `spec.cardType`, so no card author maintains it.
   *  docs/play-cost-design.md §2 */
  costTypes?(mode: DisciplineLevel | null, variant?: string): PlayCostCardType[];
  /** What playing this MODE would do, in families — the summary every
   *  `playCard` option carries (docs/richer-options-design.md §5). Added
   *  centrally by `compileSpec` from the mode's own effects, so no card
   *  author maintains it, and defaulted by `backfillCentralQueries` for a
   *  hand-rolled handler — which is the gap that left `costTypes`
   *  undefined on Blood Doll and .44 Magnum.
   *
   *  Per MODE, because the answer differs by mode: a handler-level lookup
   *  cannot answer a question whose answer differs by mode (the Wall of
   *  Filth bug, docs/combat-attachments-design.md §3). */
  playEffects?(mode: DisciplineLevel | null, variant?: string): PlayEffect[];
  /** Clans this card's "Requires a …" line names, if any — the clan
   *  sibling of `requiresDisciplines`, added centrally by `compileSpec`
   *  from `spec.requiresClan` for the same reason: a hand-rolled handler
   *  that answers `undefined` fails a filter silently (Secure Haven vs
   *  Blood Doll). Read by "after a successful action requiring Hecata or
   *  [obl]" (Cappadocian Crypt). docs/blood-locations-design.md §5 */
  requiresClans?(): string[];
  /** Sects this card requires ("Requires an Anarch"). The sibling of
   *  requiresClans; a hand-rolled handler answering undefined would fail
   *  a filter silently, so backfillCentralQueries supplies a default. */
  requiresSects?(): string[];
  /** Title-granting political action (Malkavian/Toreador Justicar, Cardinal
   *  Benediction): its card is held aside until the referendum resolves —
   *  attached to the chosen vampire on a pass, burned on a fail. */
  isTitleGrant?: boolean;
  /** "Do not burn this card at action resolution — the referendum decides
   *  what becomes of it." True for title grants (attached on a pass) and
   *  for a political action that puts itself in play on a pass (War of
   *  Ages). This is what the two engine sites were really asking when
   *  they read `isTitleGrant`. docs/pool-drain-design.md §6 */
  holdsCardForReferendum?: boolean;
  /** Seed per-seat bonus votes when the referendum is created, before
   *  polling ("each Malkavian gets +1 vote", p. 28). */
  referendumSetup?(frame: ReferendumFrame, state: GameState): void;
  /** Action card that, on success, attaches its own card to the acting
   *  vampire as a persistent static (Heart of the City, Preternatural
   *  Strength). Mode-aware (basic vs superior bonus), and **null for a
   *  mode that does not attach** — a card can carry the clause on one
   *  printed version only (Biothaumaturgic Experiment), and the other
   *  version must go to the ash heap like any other action card. */
  attachOnSuccess?(mode: DisciplineLevel | null): {
    statics: PermanentStatics;
    tags: string[];
    /** "…LOCKED" (Rutor's Hand). */
    locked?: boolean;
    /** True when the card names its OWN bearer ("put this card on a
     *  minion you control"), so `params.target` is that bearer. False —
     *  the default — means "put this card on THIS vampire", and
     *  `params.target` belongs to some other clause of the same card
     *  (Tier of Souls' steal target).
     *  docs/action-attachments-design.md §9 */
    bearerFromTarget?: boolean;
    /** "…to represent the unique Anarch title of Baron of Boston"
     *  (Fee Stake) — the title the bearer holds while the card is on
     *  them, and the CITY it contests on. docs/fee-stake-design.md §2 */
    grantsTitle?: VampireTitle;
    grantsTitleCity?: string;
  } | null;
  /**
   * Action card that, on success, puts its own card into play as a
   * seat-level permanent with N counters (Under Siege and the counter
   * actions), instead of being burned.
   *
   * NULL when the mode that was actually played does NOT do this. A card
   * may put itself in play on one mode and not the other (Revelations),
   * and the handler is registered if ANY mode does — so the answer has to
   * be per mode or the other mode silently leaves a permanent behind.
   */
  putsInPlayOnSuccess?(mode: DisciplineLevel | null): {
    counters?: number;
    tags: string[];
    /** Statics the card grants while it sits there ("your prey plays with
     *  an open hand", Revelations superior). Hard-coded empty until
     *  2026-09-02, which was invisible while all ten users had none. */
    statics?: PermanentStatics;
    /** "Put this card in play, LOCKED" (Gather) — so its own ability
     *  cannot be used until it unlocks, which is the turn's delay the card
     *  is paying for. docs/uncontrolled-graduation-design.md §3 */
    locked?: boolean;
  } | null;
  /** Referendum step 1: the caller's term choices (p. 27). Empty/absent
   *  means the referendum has no terms and goes straight to polling. */
  referendumTerms?(frame: ReferendumFrame, state: GameState): LegalOption[];
  /** Referendum step 3: apply the card's effects after the referendum
   *  passes. Failed referendums never call this. */
  applyReferendum?(frame: ReferendumFrame, ops: EngineOps): void;
  /**
   * The other half of step 3: apply the CALLING card's effects after its
   * referendum FAILED ("If this referendum fails, the acting vampire
   * burns 1 blood" — The Final Nights).
   *
   * `onReferendumLost` cannot serve: it iterates cards in play, and the
   * calling card has already gone to the ash heap. This is called on the
   * calling card's own handler, the mirror of `applyReferendum`, and only
   * for a referendum that RESOLVED — a cancelled one never reaches here,
   * which is what "if this referendum fails" means
   * (docs/abstain-gate-design.md).
   */
  applyReferendumFailed?(frame: ReferendumFrame, ops: EngineOps): void;
  /** Statics/tags this card carries while in play (denormalized onto the
   *  PermanentInPlay entry at entry time). */
  permanentStatics?: PermanentStatics;
  permanentTags?: string[];
  /**
   * "This Gangrel can play these cards AS IF FROM YOUR HAND" — this card
   * in play holds a store (`entry.stored`) whose cards are playable.
   *
   * Read by the engine's ONE hand-play enumerator and by `playCard`, so a
   * stored card is offered in every window its own handler would offer it
   * in and plays by exactly the ordinary rules. The pile is the only
   * difference, and the one consequence of it is that a card that was
   * never in hand is never REPLACED. docs/store-plays-design.md §2
   */
  /** "Only one \<name\> may be played in a game" (Lupine Assault, Reality
   *  Mirror and the wave-61 referendums) — the name to look for in the event
   *  log. Read by the engine's ONE hand-play enumerator, because the flag was
   *  honoured by the political-action compiler alone and a master carrying it
   *  could be played twice. docs/hand-churn-design.md §4 */
  oncePerGameName?: string;
  storePlay?: {
    /** "THIS Gangrel can play these cards": the bearer and nobody else. */
    bearerOnly?: boolean;
    /** "TZIMISCE you control can play cards from this location." */
    clan?: string;
    /** "Burn this card if it has no cards on it" — checked as the store
     *  shrinks, and playing out of it is a way for it to shrink. */
    burnWhenEmpty?: boolean;
  };
  /** Mode-aware entry payload for retainers/equipment whose printed
   *  versions differ (Raven Spy [ani]/[ANI] life) — the mode chosen at
   *  announcement fixes which version enters play (p. 22). Falls back to
   *  permanentStatics/permanentTags when absent. */
  /** "Unique." on the printed card — the game-wide keyword, as opposed to
   *  the own-copy check `seatControlsCopy` does. Read by "equip with a
   *  NON-UNIQUE equipment from your hand" (Contraband). */
  isUnique?: boolean;
  /** "…from your hand (requirements and cost apply as normal)": which
   *  printed versions of this card the given minion could bring into
   *  play, requirements included — empty when they could not. Answered
   *  centrally in `compileSpec`, for the same reason as `costTypes`: the
   *  card doing the asking has no reference to this card's spec.
   *  docs/play-from-hand-design.md §7 */
  modesPlayableBy?(minion: MinionState, ignoreRequirements?: boolean): Array<DisciplineLevel | null>;
  permanentEntry?(mode: DisciplineLevel | null): {
    statics: PermanentStatics;
    tags: string[];
    life?: number;
  };
  /** Ally stats entering play (mode-aware for the same reason), plus the
   *  self-attached entry carrying the ally's own card text (statics and
   *  abilities reuse the permanent machinery). */
  /** This card is a VAMPIRE (a crypt card), not a library card. */
  isCryptCard?: boolean;
  /** What a crypt card's own text puts on its vampire, as a self-attached
   *  entry — the ally treatment (`allyEntry` below), which is what lets
   *  the whole `permanent` vocabulary reach crypt abilities without a
   *  second set of rules. A vampire with a bare sect/title line has no
   *  spec at all and gets no entry (docs/crypt-plan.md §2). */
  cryptEntry?(): { statics: PermanentStatics; tags: string[] };
  allyEntry?(mode: DisciplineLevel | null): {
    life: number;
    strength: number;
    bleed: number;
    statics: PermanentStatics;
    tags: string[];
    /** "This ally can play cards requiring basic Animalism as a vampire"
     *  (p. 11) — the enumerators read `disciplinesOf`, never `m.kind`, so
     *  the whole rule is these levels on the ally's MinionState.
     *  docs/vozhd-allies-design.md §3 */
    disciplines?: Record<string, DisciplineLevel>;
    /** "This ally can perform actions the turn it is recruited" (Spectral
     *  Servitor) — the one exemption from p. 22 in the pool. */
    actsWhenRecruited?: boolean;
  };
  /** "Put this card in play. It becomes a 1-capacity (non-unique) vampire"
   *  (Waters of Duat, Childe of the Revolution). Returns what the token
   *  should be; the ACTING minion is passed because one of the two reads
   *  its clan ("…of the same clan as the acting vampire").
   *  docs/token-vampire-design.md §2 */
  becomesVampireOnSuccess?(
    mode: DisciplineLevel | null,
    actor: MinionState | null,
  ): { capacity: number; clan: string | null; sect: Sect | null } | null;
  /** Automatic (non-optional) card text that runs during the controller's
   *  unlock phase ("If Double Deuce has 2 or fewer life…, he gains 1
   *  life") — no decision, so it is a hook, not an ability. */
  onControllerUnlock?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ops: EngineOps,
  ): void;
  /** Automatic card text during *any* Methuselah's unlock phase, fired for
   *  every in-play card with the unlocking seat (Constant Revolution /
   *  Smiling Jack: "during each other Methuselah's unlock phase, that
   *  Methuselah burns … per counter"). */
  onAnyUnlock?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    unlockingSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** "After your prey is ousted, burn this card" (War of Ages, Augury of
   *  Doom). Fired for every card in play **before** the `Ousted` event:
   *  "your prey" is an adjacency relation and the oust rewrites it, so
   *  this is the only moment `preyOf(owner.seat)` still names the seat
   *  going out. docs/pool-drain-design.md §5 */
  onSeatOusted?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    oustedSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** Automatic card text triggered by a successful bleed (Alamut: "after an
   *  Assamite you control successfully bleeds a Methuselah, put the pool
   *  lost on this card"). Fired for every in-play card after a bleed of 1+. */
  onBleedSuccess?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { actingMinion: MinionId; actingSeat: SeatId; target: SeatId; amount: number },
    ops: EngineOps,
  ): void;
  /** An action has just resolved, successfully or not (the archetypes —
   *  docs/archetypes-design.md §2). Fired at the `ActionResolved` emit,
   *  with the action frame still on the stack, so `ops.action()` still
   *  reads its `played` list — which is how Dabbler and Perfectionist see
   *  what was played during it. */
  onActionResolved?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: {
      actionId: ActionId;
      success: boolean;
      acting: MinionId;
      actingSeat: SeatId;
      /** What KIND of action just resolved — "bleed", "hunt", "cardEffect"…
       *  It was always on the frame and simply never passed on; Forward
       *  Momentum needs to tell a bleed from anything else without a second
       *  lookup (docs/path-cards-design.md §5). */
      actionKind: ActionKind;
    },
    ops: EngineOps,
  ): void;
  /** A combat has ended (Monster). The `CombatEnded` event carries only
   *  the round count, so the combatants come from the frame, read before
   *  it pops. */
  onCombatEnded?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: {
      acting: MinionId;
      opposing: MinionId;
      rounds: number;
      /** Strike NAMES whose resolution burned a combatant — "if the
       *  opposing vampire is burned during this weapon's strike
       *  resolution" (Sword of the Archangel).
       *  docs/weapon-riders-design.md §6 */
      burnedByStrike: string[];
    },
    ops: EngineOps,
  ): void;
  /** A block has been DECLARED — before the attempt resolves (Rebel's
   *  "before block resolution", so it fires whether the block succeeds or
   *  fails). */
  onBlockDeclared?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { actionId: ActionId; blocker: MinionId; acting: MinionId; actingSeat: SeatId },
    ops: EngineOps,
  ): void;
  /** Automatic card text triggered by a successful hunt — the mirror of
   *  onBleedSuccess ("You can lock this card after an Anarch successfully
   *  hunts to add 1 blood to that Anarch", The Anarch Free Press). Fired
   *  from the hunt branch of action resolution, which a blocked hunt never
   *  reaches, so arriving here IS the success. */
  onHuntSuccess?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { actingMinion: MinionId; actingSeat: SeatId },
    ops: EngineOps,
  ): void;
  /** A combatant left the ready region (torpor/burned) during combat (Dead
   *  Pool: "after a vampire in combat with a Lasombra you control leaves
   *  the ready region…"). `other` is the surviving combatant. */
  onCombatLeave?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { leaver: MinionId; other: MinionId },
    ops: EngineOps,
  ): void;
  /** This card's in-play abilities are offered to EVERY Methuselah, not
   *  just its controller ("during any unlock phase, any ready vampire
   *  can…" — Carver's Meat Packing). Off by default: an ability belongs
   *  to the card's controller, and `owner.seat` is always the controller,
   *  so a card that means "you" compares ctx.seat to it. */
  abilityAnySeat?: boolean;
  /** This card's in-play abilities are also offered during the AS-PLAYED
   *  period of another card. p. 7 allows only cancels and wakes there, so
   *  the default is off and only a card that IS a cancel opts in
   *  (Meditative Grove). docs/blood-locations-design.md §6 */
  abilityInAsPlayed?: boolean;
  /** Actions granted by this card in play ("can enter combat with a
   *  minion as a Ⓓ action") — enumerated in the minion phase for the
   *  entry's controller; announcing goes through
   *  ops.announceEntryAction. */
  actionOptions?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ctx: PlayContext,
  ): LegalOption[];
  useActionOption?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    choice: Extract<LegalOption, { kind: "useEntryAction" }>,
    ops: EngineOps,
  ): void;
  /** A question this card raised (docs/choice-frames-design.md): the
   *  options for the deciding seat, and what the answer does. The engine
   *  adds the decline option for an optional choice and pops the frame
   *  before applying, so `applyChoice` may raise a follow-up question. */
  /** "If you would draw a card from your library, you can draw one of
   *  those cards instead" — may THIS card in play supply a draw right
   *  now? Asked only of cards that already hold stored cards, so a card
   *  answering true costs its controller a decision on each draw; answer
   *  false while the card's own condition fails (Shilmulo Tarot: "while
   *  this Ravnos is ready"). docs/library-search-design.md §6 */
  canRedirectDraw?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    state: GameState,
  ): boolean;
  /** `registry` is a third argument rather than a module global for the
   *  `freshId` reason: anything shared across engines in one process is a
   *  latent bug the moment two games run at once (phase 5's batch AI, and
   *  undo, which is literally two engines). */
  choiceOptions?(
    frame: ChoiceFrame,
    state: GameState,
    registry: HandlerRegistry,
  ): LegalOption[];
  applyChoice?(
    frame: ChoiceFrame,
    choice: Extract<LegalOption, { kind: "answerChoice" }>,
    ops: EngineOps,
  ): void;
  /** A minion left the ready region — burned or sent to torpor
   *  (docs/granted-rush-design.md §6). Fired *before* the event, so the
   *  leaver is still in play and its controller readable; a card may act
   *  on the strength of "is about to leave" (Priority Contract) or after
   *  the fact (Frontal Assault). Narrower than `onCombatLeave`, which
   *  also needs the other combatant. */
  onLeaveReady?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { minion: MinionId; controller: SeatId; how: "burned" | "torpor" | "removed" },
    ops: EngineOps,
  ): void;
  /** "Each time the attached vampire announces an action, …"
   *  (Slaughtering the Herd) — fired for every card in play from the
   *  single `ActionAnnounced` chokepoint in `applyToFrames`, the same one
   *  `minionActionsThisPhase` and `stealthCharges` use.
   *  docs/taking-actions-design.md §6 */
  onActionAnnounced?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    /** `targetMinion` comes off the EVENT, not the frame: the frame is not
     *  pushed until after `ActionAnnounced` is emitted, so anything read
     *  here through `ops.action()` would be the PREVIOUS action's.
     *  docs/crypt-wave-7.md §1 */
    info: {
      minion: MinionId;
      seat: SeatId;
      target: SeatId | null;
      targetMinion: MinionId | null;
    },
    ops: EngineOps,
  ): void;
  /** Every Methuselah has passed on blocking and the action has moved to
   *  state C (p. 27 A.4) — the one moment an action is known to be going
   *  through while the block window is already shut. "The next time this
   *  vampire is about to successfully bleed the same Methuselah" (Spying
   *  Mission). Fired from the single A→C transition in `settle`.
   *  docs/last-equipment-modifiers-design.md §6 */
  onBlocksDeclined?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: {
      actionId: ActionId;
      acting: MinionId;
      actingSeat: SeatId;
      actionKind: ActionKind;
      target: SeatId | null;
    },
    ops: EngineOps,
  ): void;
  /** "During your discard phase, your predator takes control of this
   *  card" (The Coven) — the third sibling of `onMasterPhase` and
   *  `onInfluencePhase`, fired for every card in play as a discard phase
   *  begins. docs/cross-table-masters-design.md §4 */
  onDiscardPhase?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** "…at the BEGINNING of his or her minion phase" (Faithful Servant) —
   *  the phase-hook family's missing opener. `onMinionPhaseEnd` existed
   *  and `onMasterPhase` / `onInfluencePhase` / `onDiscardPhase` all fire
   *  as their phase OPENS; the minion phase had only a closer.
   *  docs/retainer-upkeep-design.md §1 */
  onMinionPhase?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** "After each Methuselah's MINION PHASE ENDS, …" (Thirst) — the fourth
   *  sibling of `onMasterPhase` / `onInfluencePhase` / `onDiscardPhase`,
   *  and the only one that fires as a phase CLOSES rather than opens, so
   *  it can ask what happened during it.
   *  docs/gehenna-events-design.md §2 */
  onMinionPhaseEnd?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** "After any Methuselah plays a Gehenna card, …" (Servitor of Irad) —
   *  fired for every card in play as the Gehenna card is played, whoever
   *  played it. docs/hand-churn-design.md §5 */
  onGehennaPlayed?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ops: EngineOps,
  ): void;
  /** "AT THE END OF your influence phase, …" (Tomb of Rameses III) — the
   *  fifth sibling, and the second that fires as a phase CLOSES.
   *  docs/uncontrolled-graduation-design.md §4 */
  onInfluencePhaseEnd?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** "For each blood counter you TRANSFER to the chosen vampire during your
   *  influence phase, …" (Tomb of Rameses III) — one transfer of one
   *  counter onto `minion`, already applied. §4 */
  onTransferToUncontrolled?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    minion: MinionId,
    ops: EngineOps,
  ): void;
  /** "Burn this card when this vampire leaves the uncontrolled region"
   *  (Tomb of Rameses III) — read by the engine wherever a vampire leaves
   *  that region, so the clause cannot be missed by one of the ways out. §5 */
  burnWhenLinkedUncontrolledLeaves?: boolean;
  /**
   * A referendum did NOT pass (Cedrick Calhoun). Fired from BOTH paths,
   * because "cancelled or fails" names two outcomes the engine
   * deliberately keeps apart (docs/abstain-gate-design.md): a cancelled
   * referendum never resolves and emits no `ReferendumResolved` at all,
   * while a failed one resolves normally with `passed: false`. `how` says
   * which happened; `callingMinion` is the vampire who called it, and is
   * null for a blood hunt.
   *
   * Fired AFTER the frame has left the stack, the `notifyCombatEnded`
   * rule: a hook fired before a frame's own `pop()` has any ChoiceFrame
   * it raises eaten by that pop. docs/crypt-wave-6.md §3
   */
  onReferendumLost?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { callingMinion: MinionId | null; how: "cancelled" | "failed" },
    ops: EngineOps,
  ): void;
  /** "During your influence phase, …" (Frontal Assault) — the influence
   *  phase mirror of `onMasterPhase`. */
  onInfluencePhase?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** A diablerie was committed, fired before the blood hunt referendum is
   *  pushed ("move this card to the diablerist (before the blood hunt is
   *  called)" — Regent). The victim is already burned, so `bearer` names
   *  the minion this card was on. */
  onDiablerie?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { diablerist: MinionId; victim: MinionId; bearer: MinionId | null },
    ops: EngineOps,
  ): void;
  /** "During each Methuselah's master phase, that Methuselah …" (Brujah
   *  Debate) — fired for every card in play as a master phase begins,
   *  with the seat whose phase it is. */
  onMasterPhase?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    turnSeat: SeatId,
    ops: EngineOps,
  ): void;
  /** A card was discarded from a hand (Powerbase: Los Angeles watches for
   *  an Anarch-requiring card going to the ash heap). */
  onDiscard?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    info: { seat: SeatId; cardName: string },
    ops: EngineOps,
  ): void;
  /** The card is leaving play by being burned — its last chance to clean
   *  up what it put elsewhere ("after this card leaves play, burn all the
   *  hostage counters" — Carver's Meat Packing). */
  /** Card text that runs the moment this permanent arrives in play
   *  ("…and move the top 2 cards of your library onto it"). Fired from
   *  both entry paths — `putPermanentInPlay` and the
   *  equip/employ/recruit pipeline. docs/library-search-design.md §5 */
  onEnterPlay?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ops: EngineOps,
  ): void;
  onLeavePlay?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ops: EngineOps,
  ): void;
  /** "…or its controller changes" (The Rack) — fired on the entry after
   *  control of it moves, with the seat that now controls it. */
  onControlChanged?(
    entry: PermanentInPlay,
    to: SeatId,
    ops: EngineOps,
  ): void;
  /** The effect of a successful granted action that is not a rush
   *  (docs/granted-actions-design.md §4.2). Called at action resolution,
   *  after costs, with the frame that carries `grantedEffect`. */
  resolveGrantedAction?(
    entry: PermanentInPlay,
    af: ActionFrame,
    ops: EngineOps,
  ): void;
  /** In-play activated/phase abilities: enumerate options for the entry's
   *  controller at this window; apply one. */
  abilityOptions?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    ctx: PlayContext,
  ): LegalOption[];
  useAbility?(
    entry: PermanentInPlay,
    owner: { seat: SeatId; minion: MinionId | null },
    choice: Extract<LegalOption, { kind: "useAbility" }>,
    ops: EngineOps,
  ): void;
  /** Enumerate legal plays for `seat` at this window. Pure. */
  options(card: CardInstance, ctx: PlayContext): LegalOption[];
  /** Apply the card's effect after its as-played window closes. For
   *  action cards this announces the action via ops.announceCardAction. */
  resolve(play: CardPlayFrame, ops: EngineOps): void;
  /** Action cards only: the card's own resolution effect, run when the
   *  action succeeds (after generic effects like the bleed itself). */
  resolveCardAction?(af: ActionFrame, ops: EngineOps): void;
}

export type HandlerRegistry = Record<string, CardHandler>;

/** Helper for handlers: stable, self-describing option ids. */
export function playOptionId(
  name: string,
  mode: string | null,
  ...params: string[]
): string {
  return ["play", name, mode ?? "-", ...params].join(":");
}
