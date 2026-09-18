/**
 * Card effect primitives — the data vocabulary most cards are made of
 * (docs/card-primitives.md; architecture principle 6). A CardSpec is pure
 * data; compileSpec() turns it into the engine's CardHandler.
 */

import type { ActionKind, DelayedDrawCondition, ConditionalStatic, DisciplineLevel, OutcomeCondition, PermanentAura, PermanentCostSource, PermanentCounterSink, PermanentStatics, PlayCostCardType, PlayCostMod, Sect, VampireTitle } from "../../engine/index.ts";

/**
 * Which cards in hand a `playFromHand` effect may bring into play, and on
 * what terms (docs/play-from-hand-design.md §5). The chosen card, its
 * printed version and any payment split ride in the option id, so no
 * ChoiceFrame is needed: the seat playing the card is already being asked.
 */
export interface PlayFromHandFilter {
  /** Printed card types that qualify ("equipment", "retainer", "ally"). */
  types: PlayCostCardType[];
  /** Permanent tags the incoming card must carry ("melee", "animal"). */
  tags?: string[];
  /** "a NON-UNIQUE equipment" (Contraband). */
  nonUniqueOnly?: boolean;
  /** "…ignoring requirements (pay cost as normal)" (Biothaumaturgic
   *  Experiment) — drops the discipline and clan/sect/title gates, and
   *  nothing else. */
  ignoreRequirements?: boolean;
  /** "…can pay up to half the cost rounded down of that equipment with
   *  their blood" (Contraband superior): one option per legal split. */
  halfCostInBlood?: boolean;
  /** Piper: the bearer is a CHOSEN ready unlocked vampire of this sect,
   *  locked to do it, rather than the playing or acting minion. */
  actor?: { sect?: Sect; unlockedOnly?: boolean; lock?: boolean };
  /** "The weapon CANNOT COST 3 OR MORE POOL" (Concealed Weapon) — read
   *  against the cost this bearer would actually pay, because the ruling
   *  is explicit that cost modifications not limited to cards "played"
   *  count: Black Cat can conceal a Combat Shotgun, and Centralized
   *  Background Check makes a .44 Magnum too costly
   *  [LSJ 20040701] [ANK 20181216].
   *  docs/armed-mid-combat-design.md §4 */
  maxPoolCost?: number;
  /** "…or inflict (WITH A REGULAR STRIKE) 4 OR MORE DAMAGE" — the
   *  weapon's damage against a generic opponent [RTR 19980623], with no
   *  strength or other bonus counted [LSJ 20020821] [LSJ 20020904]. */
  maxDamage?: number;
  /** "…or inflict (WITH A REGULAR STRIKE) AGGRAVATED DAMAGE" — printed
   *  and unconditional only: Poker's aggravated damage against Kiasyd is
   *  a conditional effect and does not disqualify it [LSJ 20020729]. */
  noAggravated?: boolean;
}

/** A conditional extra on a bleed/stealth/intercept modifier: "+N more if
 *  <condition>" (Aire of Elation, Protection Racket, The Warrens). */
export type ModifierCondition =
  | { kind: "selfClan"; clan: string }
  | { kind: "selfTitled" }
  | { kind: "actingTitled" }
  | { kind: "targetPoolAtMost"; value: number }
  /** "…if the acting minion is an ALLY or a VAMPIRE WITH CAPACITY N OR
   *  LESS" (Nest of Eagles). An ally qualifies whatever its stats, which
   *  is why this is one condition and not a capacity test with a special
   *  case bolted on. docs/acting-minion-reactions-design.md §3 */
  | { kind: "actingSmall"; capacity: number };

export type EffectPrimitive =
  | {
      kind: "modifyBleed";
      amount: number;
      limited: boolean;
      bonus?: { extra: number; when: ModifierCondition };
      /** "Reduce a bleed against you by 1 FOR EACH POINT OF STEALTH the
       *  acting minion has WHEN THIS CARD IS PLAYED" (Keep it Simple) —
       *  the amount is read off the action at play time and `amount` is
       *  ignored. A snapshot, not a subscription: stealth played
       *  afterwards does not grow the reduction, and because the bleed
       *  amount is a fold the emitted delta stands on its own.
       *  docs/acting-minion-reactions-design.md §2 */
      perActingStealth?: boolean;
      /** "+X bleed (limited). X must be 1, 2 or 3" (Monkey Wrench) — the
       *  amount is chosen as the card is played, so one option per X with
       *  `x=N` in the option id (the `bankStealth` shape). `amount` is
       *  ignored when this is present.
       *  docs/last-equipment-modifiers-design.md §5 */
      xRange?: { min: number; max: number };
    }
  | { kind: "modifyStealth"; amount: number }
  /** "Choose another ready \<sect\> vampire you control. THE CHOSEN
   *  VAMPIRE BURNS N BLOOD, or this card has no effect" (Stealth Ritus) —
   *  a price paid by a minion that is neither the actor nor the card's
   *  target. The chooser rides in the option id, so an unaffordable
   *  helper is simply not offered rather than fizzling later.
   *  docs/second-minion-modifiers-design.md §3 */
  | {
      kind: "otherMinionPaysBlood";
      amount: number;
      sect?: Sect;
      clan?: string;
      /** What the payment buys. It lives INSIDE this primitive rather than
       *  beside it as a `modifyStealth`, because "or this card has no
       *  effect" has to be able to withhold it — two independent effects
       *  in one mode cannot, and the stealth would land unpaid for. */
      thenStealth?: number;
    }
  | { kind: "modifyIntercept"; amount: number; bonus?: { extra: number; when: ModifierCondition } }
  /** "This vampire gets +N votes" during the polling step (p. 28). */
  | { kind: "modifyVotes"; amount: number }
  /** "Vampires who do not follow the Path of \<x\> get −1 vote" (Absolute
   *  Tyranny superior) — a modifier on EVERY vampire's vote count for this
   *  referendum, not a bonus to the player. `exceptPath` names the Path
   *  that is spared; with no card in the pool able to put a vampire on a
   *  Path, that exemption is currently empty and the modifier is therefore
   *  universal. docs/path-cards-design.md §§2, 4 */
  | { kind: "modifyAllVotes"; amount: number; exceptPath?: string }
  /** "Non-<sect> vampires cannot cast votes or ballots this referendum"
   *  (Closed Session, Private Audience) — a polling-step action modifier. */
  | { kind: "restrictVotes"; sect: Sect }
  | { kind: "wake" }
  /** "Choose a locked wraith or zombie ally you control. The CHOSEN ally
   *  wakes" (Shadow Sentinel superior). Unlike `wake`, the player need not
   *  be locked — the superior drops the "Only" from "Only usable by a
   *  locked vampire" — and the target rides in the option id.
   *  docs/wraith-zombie-design.md §4 */
  | { kind: "wakeOther"; who: "undeadAlly" | "youngerLockedVampire" }
  /** "If the action is successful, this vampire can burn 1 blood to unlock
   *  AFTER ACTION RESOLUTION" (Paths in Two Worlds superior), and "after
   *  action resolution, this vampire can burn 1 blood to unlock THE
   *  ACTING ALLY" (Gifts From Hereafter superior). One clause, two
   *  targets. The modifier is played at announcement and the offer comes
   *  much later, so it is registered on the action frame and raised as an
   *  OPTIONAL ChoiceFrame during resolution — `raiseChoice` queues while an
   *  action resolves and flushes the moment it is over, which is exactly
   *  "after action resolution". docs/wraith-zombie-design.md §4 */
  | {
      kind: "unlockAfterResolution";
      blood: number;
      /** Who unlocks: the vampire that played the card, or the acting
       *  minion it was played for. The PAYER is always the player. */
      target: "self" | "actingMinion";
      ifSuccessful?: boolean;
    }
  /** "If this vampire blocks, it gets N optional maneuvers/presses (and/or
   *  neither combatant strikes the first round) in the resulting combat"
   *  (Spirit's Touch, One With the Land) — a reaction rider. */
  | {
      kind: "blockerCombatRider";
      maneuver?: number;
      press?: number;
      noStrikeFirstRound?: boolean;
      /** "…can prevent 1 damage during the FIRST ROUND" (Precognition). */
      prevent?: number;
      /** "…and cannot use equipment during the resulting combat". */
      noEquipment?: boolean;
      /** "…can burn N blood to unlock after block resolution". */
      unlockForBlood?: number;
      /** "…can strike: combat ends during the first round". */
      combatEndsStrike?: boolean;
    }
  /** The mirror, for the ACTING minion: "if this vampire is blocked, they
   *  can prevent 1 damage during the resulting combat" (Beast Meld);
   *  "+1 strength this action" / "hand strikes are aggravated this action"
   *  (Invigorate) — docs/actor-riders-design.md. */
  | {
      kind: "actorCombatRider";
      prevent?: number;
      strength?: number;
      maneuver?: number;
      press?: number;
      handStrikesAggravated?: boolean;
      /** "All damage inflicted on vampires during the resulting combat is
       *  aggravated" (Dawn Operation). Unlike every other field here it
       *  hits BOTH combatants — docs/dawn-operation-design.md. */
      combatAggravated?: boolean;
      /** "…and cannot use equipment during the resulting combat" (Form
       *  of the Bat) — the actor restricting itself. */
      noEquipment?: boolean;
    }
  /** "If a vampire is currently attempting to block, they can cancel their
   *  block attempt" (Dawn Operation inferior). Offers the blocking seat a
   *  built-in option in its own impulse; a no-op with no attempt open, so
   *  the card stays playable for its other clause. */
  | { kind: "offerBlockerCancel" }
  /** "This vampire unlocks and attempts to block" (Sense the Savage Way,
   *  Second Tradition: Domain). `ignoreRestrictions` skips the normal
   *  prey/predator/target eligibility (Eagle's Sight). `penaltyIfNoBlock`
   *  locks or self-attaches the vampire if it did not block (Dogged
   *  Pursuit). */
  | {
      kind: "unlockAndAttemptBlock";
      interceptBonus?: number;
      bloodCost?: number;
      ignoreRestrictions?: boolean;
      penaltyIfNoBlock?: "lock" | "attach";
    }
  /** "Unlock this vampire" so its controller can block normally (Guard
   *  Dogs, Rat's Warning). `bloodCost` is the price some cards put on it
   *  ("this vampire burns 1 blood to unlock", Deep Ecology) — it gates
   *  the option as well as charging it (p. 9). */
  | { kind: "unlockMinion"; bloodCost?: number }
  /** "During this action, this vampire can burn 1 blood to get +1
   *  intercept" (Eyes of the Wild) — a repeatable, action-scoped grant. */
  | { kind: "grantBurnForIntercept" }
  /** "If this vampire blocks, put this card on the acting minion; you still
   *  control it" (Melange) — attached at block success. */
  | { kind: "attachToActorOnBlock" }
  /** "Change the target of the bleed" (Deflection: to a chosen other
   *  Methuselah; My Enemy's Enemy: to your predator's predator). */
  | {
      kind: "redirectBleed";
      lockSelf: boolean;
      toPredatorsPredator?: boolean;
      /** "Only usable if a YOUNGER vampire is bleeding you" (Redirection
       *  basic; its superior drops the clause). Age is `capacityOf` on
       *  both sides, so a granted capacity counts.
       *  docs/bleed-answers-design.md §2 */
      youngerOnly?: boolean;
      /** "Only usable when an ALLY OR YOUNGER vampire is bleeding you"
       *  (Lost in Translation) — the same comparison one step wider: an
       *  ally has no capacity to compare, and always qualifies.
       *  docs/lock-as-currency-design.md §2 */
      allyOrYoungerOnly?: boolean;
    }
  /** "This vampire doesn't lock for successfully blocking" (Minor
   *  Irritation) — played in the first window after the block succeeded,
   *  so the lock has already happened and this undoes it.
   *  docs/lock-as-currency-design.md §1 */
  | { kind: "noLockForBlocking" }
  /** "Each vampire with a capacity above N can burn blood to gain votes"
   *  (Mob Rule), "each ready anarch may burn 1 blood to gain 1 additional
   *  vote" (Rant!) — an open offer registered on the referendum frame.
   *  docs/referendum-blood-design.md §1 */
  | {
      kind: "bloodForVotes";
      minCapacity?: number;
      sect?: Sect;
      votesPerBlood: number;
      bigCapacity?: number;
      bigVotesPerBlood?: number;
      maxBloodPerMinion?: number;
    }
  /** "Any vampire casting votes or ballots against this referendum burns
   *  N blood when the results are tallied" (Cheval de Bataille).
   *  docs/referendum-blood-design.md §2 */
  | { kind: "taxVotesAgainst"; blood: number }
  /** "Reduce a bleed against you to 0. (The acting minion can still
   *  increase the bleed amount.)" (Visions of Zapathasura superior) — the
   *  `currentBleed` twin of `setStealthZero`, and it works for the same
   *  reason: the amount is a fold, so subtracting the current total is
   *  the reduction and later increases still land.
   *  docs/bleed-answers-design.md §3 */
  | { kind: "setBleedZero"; lockSelf?: boolean }
  /** "That block attempt fails and the blocking minion cannot attempt to
   *  block this action again" (Elder Impersonation, Relentlessness,
   *  Forced Confessional, Stygian Shroud) — played by the ACTING minion
   *  while a block attempt is underway. `bloodCost` is an extra cost the
   *  mode charges on top of the card (Stygian Shroud superior). */
  | { kind: "failBlockAttempt"; bloodCost?: number }
  /** "That attempt fails and the blocking minion cannot attempt to block
   *  this action again. Lock this vampire and the blocking minion, and
   *  queue a combat between them" (Hedonism) — one of your OTHER vampires
   *  stepping in front of a blocker. `combat: false` is the superior mode,
   *  which breaks the block without the fight.
   *  docs/other-vampire-modifiers-design.md */
  | { kind: "interposeOnBlocker"; combat: boolean }
  /** "This vampire can burn X blood to give the next X actions minions you
   *  control perform this turn +1 stealth" (Veil the Legions superior).
   *  X is chosen at play time, so the compiler emits one option per
   *  affordable X and the choice rides in the option id (`x=N`), the way
   *  `paymentSplits` already does for cost sources. `max` caps the offer
   *  so a big-blood vampire does not flood the option list. */
  | { kind: "bankStealth"; max: number }
  /** "Force a vampire to abstain (this cancels their votes and ballots)"
   *  (Scalpel Tongue, Telepathic Vote Counting superior). `onlyIfVoted`
   *  is Scalpel Tongue's "a vampire who HAS CAST votes or ballots in this
   *  referendum"; `lockTarget` and `burnTargetBlood` are its extras.
   *  docs/abstain-gate-design.md */
  | {
      kind: "forceAbstain";
      onlyIfVoted?: boolean;
      lockTarget?: boolean;
      burnTargetBlood?: number;
      /** "…a vampire who belongs to the SAME CLAN as this reacting minion"
       *  (Conflict of Interests) — the target set is filtered against the
       *  minion playing the card, not chosen freely. */
      sameClanAsReactor?: boolean;
      /** "…force THE ACTING VAMPIRE to abstain" (Irregular Protocol) —
       *  one target, named by the referendum rather than chosen. */
      callingMinionOnly?: boolean;
      /** "LOCK THIS REACTING VAMPIRE to force…" (Irregular Protocol) — a
       *  cost paid by the player, the mirror of `lockTarget`. */
      lockSelf?: boolean;
      /** *"Cannot be used during a referendum that is automatically
       *  passing"* [PIB 20150105] — an auto-passing referendum casts no
       *  votes at all, so there is nothing to cancel. Carried per card
       *  rather than applied to every abstain, because the two V5 cards
       *  using this effect do not print the ruling. */
      notWhenAutoPassing?: boolean;
    }
  /** "Cancel the referendum. If you played a political action card to call
   *  this referendum, return it to its owner's hand" (Telepathic Vote
   *  Counting inferior). NOT the same as failing it. */
  | {
      kind: "cancelReferendum";
      /** "Unlock the acting vampire" (Delaying Tactics). */
      unlockCaller?: boolean;
      /** "Minions controlled by the acting Methuselah cannot perform the
       *  same political action again this turn" (Delaying Tactics). */
      barRepeat?: "minion" | "seat";
    }
  /** "Methuselahs casting votes or ballots against the referendum burn N
   *  pool once results are tallied" (Scorn of Adonis). */
  | { kind: "burnPoolVotedAgainst"; amount: number }
  /**
   * The three REFERENDUM OUTCOME riders (wave 21): played in the polling
   * step, they register a payload that fires when the result is known.
   * docs/referendum-riders-design.md
   */
  /** "If the referendum fails, the Methuselah calling the referendum
   *  burns N pool plus M for each vote difference" (Elder Kindred
   *  Network). */
  | { kind: "burnCallerOnFail"; base: number; perMargin: number }
  /** "Any other Methuselah who casts one or more votes or ballots in
   *  favor of and does not cast votes or ballots against the referendum
   *  gains N pool when the results are tallied" (Bribes). */
  | { kind: "payVotedForOnly"; amount: number }
  /** "If the referendum passes, the next referendum a vampire you
   *  control calls passes automatically" (Malkavian Rider Clause) —
   *  played during POLLING, so it has to wait for the tally. */
  | { kind: "autoPassNextOnPass"; thisTurnOnly?: boolean }
  /** "The next referendum a vampire you control calls this turn passes
   *  automatically" (Cryptic Rider) — played in the after-resolution
   *  window of a referendum that has ALREADY passed, so the grant is
   *  immediate. Two kinds rather than one with a flag, because the two
   *  are legal in different windows and `POLLING_ONLY_EFFECTS` keys on
   *  the kind; they share one op. */
  | { kind: "autoPassNextNow"; thisTurnOnly?: boolean }
  /** "Prevent N damage to a minion or retainer in combat", played by a
   *  vampire NOT in that combat (Martyr's Resilience, Touch of Valeren
   *  superior). The victim is chosen at play time and rides in the option
   *  id. `perBlood` is the "burn X blood to prevent X+1" shape: one option
   *  per affordable X, like `bankStealth`. `ownOnly` restricts the choice
   *  to a minion the player controls ("that minion").
   *  docs/outside-combat-design.md */
  | {
      kind: "preventForOther";
      amount: number;
      all?: boolean;
      perBlood?: { max: number; plus: number };
      ownOnly?: boolean;
    }
  /** "The blocking minion gets -N intercept" — the acting minion pushing
   *  the blocker down, as opposed to `modifyIntercept`, which the blocker
   *  plays for itself. */
  | { kind: "modifyBlockerIntercept"; amount: number }
  /** "Once this action, burn 1 of your corruption counters from a blocking
   *  minion to fail their block (and they cannot block again)" (Enchanting
   *  Gaze). */
  | { kind: "corruptFailBlock" }
  /** "If the bleed is successful, burn 2 of your corruption from a minion of
   *  the target to unlock this vampire" (Revelation of the Serpent). */
  | { kind: "unlockViaCorruption" }
  /** "X cannot block this action" (p. 26): allies/vampires/titled outright,
   *  or a `chosen` vampire (Seduction — `chosenScope` limits the pick). */
  | {
      kind: "blockRestriction";
      /** "all" is "this action is UNBLOCKABLE" (Mantle of the Moon) — the
       *  union of the allies and vampires bars, not a new kind of state. */
      who: "allies" | "vampires" | "titled" | "chosen" | "all";
      chosenScope?: "younger" | "locked" | "any";
    }
  /** "Minions [without Oblivion] must burn 1 blood [or life] to attempt to
   *  block this action" (docs/block-tax-design.md) — a toll on the attempt
   *  itself, so a minion that cannot pay cannot attempt. */
  | {
      kind: "blockCost";
      amount: number;
      payWith: "blood" | "bloodOrLife";
      exemptDiscipline?: string;
      /** "VAMPIRES must burn 1 blood to attempt to block" (Stiff Contempt)
       *  — the printed clause names a kind, and taxing allies as well
       *  would be a stricter card than the one printed. Absent = every
       *  minion, which is what every existing card says. */
      kinds?: Array<"vampire" | "ally">;
    }
  /** "Minions get -1 intercept" (Unthinkable Humiliation superior) — every
   *  minion, for this action, as opposed to `modifyBlockerIntercept`.
   *  `kind` narrows it: "ALLIES get -1 intercept" (Obedient Flesh). */
  | {
      kind: "modifyAllIntercept";
      amount: number;
      appliesTo?: "vampire" | "ally";
      /** "Minions WITHOUT Necromancy or Obtenebration get -1 intercept"
       *  (Acheron Vortex) — an exemption, so a minion holding any of these
       *  is unaffected. KRCG abbreviations. */
      exemptDisciplines?: string[];
    }
  /** "During this action, minions cannot unlock" (The Sleeping Mind sup.). */
  | { kind: "preventUnlockDuringAction" }
  /** "This vampire takes N unpreventable environmental aggravated damage
   *  after action resolution" (Daring the Dawn). */
  | {
      kind: "selfDamageAfterAction";
      amount: number;
      aggravated: boolean;
      /** "…and this vampire can burn N blood to be IMMUNE to this
       *  aggravated damage" (Rutor's Hand superior). The offer rides with
       *  the damage so the question can be asked before it lands
       *  (docs/ledger-closeout.md §10). */
      optOutBlood?: number;
    }
  // Action-card primitives: what the announced action IS.
  | { kind: "actionBleed"; bonus: number }
  | { kind: "actionStealth"; amount: number }
  | { kind: "addUncontrolledBlood"; amount: number; youngerOnly: boolean; clan?: string; sect?: Sect; titledOnly?: boolean }
  /** "This vampire gains N blood" on a successful action (Restoration).
   *  `ifActorBloodAtLeast` is "IF this vampire has 4 or more blood, he or
   *  she gains 4 blood" (Entrenching) — read at RESOLUTION on the actor,
   *  so blood spent getting there counts against the threshold. */
  | { kind: "actionGainBlood"; amount: number; ifActorBloodAtLeast?: number }
  /** "…and YOU gain N pool" (Spoils of War) — the acting minion's
   *  controller, the pool twin of `actionGainBlood`. */
  | { kind: "actionGainPool"; amount: number }
  /** "Add N blood to another vampire" — a chosen in-play vampire, fixed
   *  at announcement (Fifth Tradition: Hospitality). */
  /** "Add N blood to another vampire" (Fifth Tradition: Hospitality) and,
   *  with the flags, "add N blood or life to a MINION, not to exceed their
   *  starting life" (Touch of Valeren). `allies` widens the target set
   *  past vampires, `self` lets the actor heal itself, and `capped` clamps
   *  the gain to `capacityOf` — which for an ALLY is its printed starting
   *  life, already stored there. Defaults keep the original behaviour. */
  | {
      kind: "actionAddBloodToVampire";
      amount: number;
      allies?: boolean;
      self?: boolean;
      capped?: boolean;
    }
  /** "+1 stealth action. Put this card in play with N counters" (Under
   *  Siege and many counter actions) — the card becomes a seat-level
   *  permanent on a successful action instead of being burned. */
  | { kind: "putInPlayOnSuccess"; counters?: number; tags?: string[] }
  /** "Put this card in play. It becomes a 1-capacity (non-unique)
   *  \<clan/sect\> vampire and must hunt this turn" (Waters of Duat,
   *  Childe of the Revolution). The token enters with 0 blood, so the
   *  "must hunt" clause is p. 21's mandatory hunt and needs no code.
   *  `clanFromActor` is "…of the same clan as the acting vampire".
   *  docs/token-vampire-design.md */
  | {
      kind: "becomesVampire";
      capacity: number;
      clan?: string;
      clanFromActor?: boolean;
      sect?: Sect;
      /** "You can search your library (shuffle afterward), hand, and/or
       *  ash heap for a Discipline master card and put it on this new
       *  vampire" — optional, and finding nothing is always legal
       *  (p. 14, p. 48). §6 */
      searchDisciplineMaster?: boolean;
    }
  /** "Put this card on this vampire; it gets +bleed/+strength" — a
   *  successful action attaches the played card to the acting vampire as a
   *  persistent static (Heart of the City, Preternatural Strength). At most
   *  one per vampire (own-duplicate prevention by card name). */
  | {
      kind: "attachSelf";
      bleed?: number;
      strength?: number;
      /** Conditional statics the attached card grants its bearer
       *  (docs/conditional-statics-design.md). */
      conditional?: ConditionalStatic[];
      /** "…and unlock them" (Abbot) — the acting minion locked at
       *  announcement (p. 25), so this is a real effect. */
      unlockActor?: boolean;
      /** "The attached minion gets 1 optional maneuver each combat"
       *  (Biothaumaturgic Experiment superior). */
      maneuverPerCombat?: number;
      /** "Put this card on A MINION YOU CONTROL" rather than on the
       *  acting vampire — the target is chosen at announcement (p. 25)
       *  and rides in the option id, like every other action target.
       *  `"anyMinion"` is "put this card on a minion" with no
       *  restriction (Phantasmagoria); the card stays controlled by the
       *  player who played it (p. 16).
       *  docs/action-attachments-design.md §2 */
      target?: "ownMinion" | "anyMinion";
      /** "Put this card on this vampire, LOCKED" (Rutor's Hand). */
      locked?: boolean;
      /** "…to represent the unique Anarch title of Baron OF BOSTON"
       *  (Fee Stake) — the Praxis Seizure clause on an ACTION rather than
       *  on a referendum. The city is what the title contests on (p. 39),
       *  exactly as it is for `refPutInPlay`.
       *  docs/fee-stake-design.md §2 */
      grantsTitle?: VampireTitle;
      grantsTitleCity?: string;
      /** Extra statics the attached card grants, beyond the shorthand
       *  fields above (Phantasmagoria's −1 stealth, Tier of Souls'
       *  bleed-against-prey). */
      statics?: PermanentStatics;
      /** "Burn this card if this vampire is in torpor" (Heroic Might). */
      burnWhenBearerLeavesReady?: boolean;
      /** "Burn this card during your unlock phase" (Khabar: Glory). */
      burnAtControllerUnlock?: boolean;
      /** "If your prey is ousted, you gain N additional pool"
       *  (Khabar: Glory) — read on the `onSeatOusted` hook, the only
       *  moment `preyOf(controller)` still names the seat going out. */
      poolWhenPreyOusted?: number;
      /** "This vampire can strike: burn equipment" (Heroic Might) — a
       *  strike granted by the card in play, offered in
       *  `combat.chooseStrike` like a weapon's. §4 */
      grantsBurnEquipmentStrike?: boolean;
      /** "…and this vampire can strike: 2R damage" (Heroic Might
       *  superior) — a SECOND granted strike on the same card, so the
       *  bearer chooses between burning equipment and firing. Offered
       *  through the same `chooseStrike` ability block, dispatched on the
       *  verb in the option id, which is the granted-action merge shape
       *  (docs/ledger-closeout.md §8). */
      grantsRangedDamageStrike?: number;
      /** "During combat, you can lock this card to give this vampire +1
       *  strength this round, or 1 maneuver or press" (Monstrous Form
       *  superior) — a lock-to-use ability offered in COMBAT windows
       *  rather than action windows, the shape the weapons already use.
       *  docs/combat-attachments-design.md §7 */
      combatLockGrant?: { strengthRound?: number; maneuver?: boolean; press?: boolean };
    }
  // Rush: "Ⓓ Enter combat with a minion/vampire" — target fixed at
  // announcement; directedness derives from the target's controller
  // (docs/rush-actions-design.md).
  | {
      kind: "actionEnterCombat";
      targets: "minion" | "vampire";
      /** Fleetness superior: "a locked minion". */
      lockedOnly?: boolean;
      /** "Ⓓ Enter combat with AND LOCK a vampire" (Deep Song superior). */
      lockTarget?: boolean;
      /** "The target vampire is considered the ACTING MINION during that
       *  combat" (Deep Song superior). docs/last-buildable-design.md §3 */
      invertRoles?: boolean;
      /** "During that combat" credits for the acting minion. */
      riders?: {
        maneuver?: number;
        press?: number;
        /** "+1 strength during that combat" (Make the Misere `[pot]`). */
        strength?: number;
        /** "The opposing minion cannot strike: combat ends during the
         *  first round of that combat" (Hunter's Mark superior). */
        noCombatEndsFirstRound?: boolean;
      };
      /** "At the end of that combat, if <who is standing>, <payoff>"
       *  (Abuse of Power, Pillars Fall, Hunting the Beast).
       *  docs/rush-outcome-design.md §2 */
      outcome?: {
        when: OutcomeCondition;
        effect:
          | { kind: "burnOpposingControllerPool"; amount: number }
          /** "…put this card on this acting vampire" — the played card
           *  becomes a permanent on the actor, with these statics. */
          | { kind: "attachToActor"; statics: PermanentStatics; tags?: string[] }
          | { kind: "bloodToUncontrolled"; amount: number; clan?: string };
      };
    }
  /** "This Anarch gets 1 optional maneuver / +1 strength during that
   *  combat" as a clause of its OWN, separate from the rush that starts
   *  it (Make the Misere, where the rush is unconditional and each rider
   *  hangs off a different Discipline). It merges into the same
   *  `rushRiders` accumulator `actionEnterCombat.riders` writes to, so the
   *  two spellings cannot drift. docs/rush-outcome-design.md §6 */
  | {
      kind: "rushRiders";
      maneuver?: number;
      press?: number;
      strength?: number;
      noCombatEndsFirstRound?: boolean;
    }
  // Combat-card primitives; each implies the combat window it lives in.
  | {
      kind: "strikeHandBonus";
      bonus: number;
      /** "Strike: hand strike, AGGRAVATED" (Sculpt the Flesh basic) — the
       *  strike declaration itself is aggravated, unlike
       *  `handStrikesAggravated`, which is a round-scoped rider on every
       *  hand strike the side makes. */
      aggravated?: boolean;
      /** "This strike CANNOT BE DODGED" (Dust Up `[ani]`) — a property of
       *  the blow. docs/last-combat-design.md §1 */
      undodgeable?: boolean;
      /** "…WITH FIRST STRIKE" (Quick Jab) — resolved before a normal
       *  strike (p. 33). docs/first-strike-design.md §1 */
      firstStrike?: boolean;
      /** "If more than N damage is inflicted with this strike, ignore the
       *  excess" (Quick Jab). docs/first-strike-cards-design.md §1 */
      capDamage?: number;
      /** "Strike: hand strike OR USE A MELEE WEAPON STRIKE, at +N damage"
       *  (Anticipation) — one option per legal weapon alongside the hand
       *  strike, the choice riding in the option id. §4 */
      orMeleeWeapon?: boolean;
      riders?: {
        maneuver?: number;
        press?: number;
        /** "Damage from this strike cannot be prevented by cards
         *  requiring Fortitude [for]" — KRCG abbreviations.
         *  docs/discipline-filtered-design.md §3 */
        noPreventBy?: string[];
      };
    }
  /** "Choose a weapon possessed by the opposing minion. Strike: X damage,
   *  where X is THE POOL COST OF THE CHOSEN WEAPON" (Up Yours!) — the
   *  first strike whose size is printed on somebody else's card. The
   *  weapon is chosen as the card is played and rides in the option id,
   *  so a weapon burned before resolution cannot change the figure.
   *  docs/strike-sources-design.md §2 */
  | { kind: "strikeWeaponCost" }
  /** "Strike: PREVENT N DAMAGE from the opposing minion's next hand
   *  strike this round (including any currently-resolving hand strike).
   *  If another round of combat occurs, this minion gets first strike on
   *  their initial strike that round" (Forearm Block) — a strike that
   *  deals nothing and arms two riders instead.
   *  docs/first-strike-cards-design.md §2 */
  | {
      kind: "strikePreventHandStrike";
      amount: number;
      firstStrikeNextRound?: boolean;
    }
  /** "This minion's initial strike this round will be strike: hand strike
   *  at +N damage, and the OPPOSING minion's initial strike this round
   *  gets first strike. If either minion inflicts more damage than the
   *  other this round, that minion gets an optional press this round"
   *  (Haymaker) — three riders that only make sense together, so one
   *  primitive rather than three that must be kept in step.
   *  docs/first-strike-cards-design.md §3 */
  | {
      kind: "haymaker";
      bonus: number;
      /** "Not usable if this minion played a <this card> LAST round." */
      notAfterOwnLastRound?: boolean;
    }
  /**
   * "Cancel the block and combat" (Clan Loyalty), "Combat does not occur"
   * (Blood Brother Ambush) — played in the first window of a combat that
   * came from a block, and the combat never happened.
   * docs/no-combat-design.md §1
   */
  | {
      kind: "cancelBlockCombat";
      /** `continueAction`: "the action continues as normal" (Clan
       *  Loyalty). `ambush`: the card itself becomes an ally and fights
       *  the blocker instead (Blood Brother Ambush). */
      outcome: "continueAction" | "ambush";
      /** "Only usable when this vampire is successfully blocked BY A
       *  VAMPIRE OF THE SAME CLAN." */
      requiresSameClanBlocker?: boolean;
      /** "…and no vampires of that clan may block the acting vampire for
       *  the remainder of the turn." */
      barBlockerClanThisTurn?: boolean;
    }
  | { kind: "strikeCombatEnds"; unlockSelf: boolean }
  /** "Strike: dodge" — no damage, cancels the opposing strike's effects
   *  on this minion (p. 33). `riders` is "…WITH AN OPTIONAL PRESS"
   *  (Backflip): a rider ON the strike, not a second effect in the mode,
   *  because the mode resolves in ONE window and a standalone `press`
   *  belongs to the press step. The shape `strikeDamage` already uses.
   *  docs/strike-sources-design.md §3 */
  | { kind: "strikeDodge"; riders?: { press?: number; maneuver?: number } }
  /** "Strike: N (R) (aggravated) damage" — a card weapon-like strike
   *  (Body Flare); optional maneuver/press riders (Aid from Bats). */
  | {
      kind: "strikeDamage";
      amount: number;
      ranged: boolean;
      aggravated: boolean;
      riders?: { maneuver?: number; press?: number; noPreventBy?: string[] };
    }
  /** "The opposing vampire's strikes with weapons inflict no damage this
   *  round" (Blood Fury, Blood Rage, Soul Burn) — the strike still
   *  happens, it just deals nothing. docs/discipline-filtered-design.md §4 */
  | { kind: "nullifyOpposingWeaponDamage" }
  /** "After combat ends, <do X>" — a rider on a "Strike: combat ends"
   *  card (Catatonic Fear, Pass Through Shadow, Form of Mist).
   *  docs/after-combat-ends-design.md §1 */
  | {
      kind: "afterCombatEnds";
      /** "…if the range is close, N unpreventable damage." */
      damage?: { amount: number; closeRangeOnly: boolean };
      /** "…put this card on this vampire", burnable for +1 stealth. */
      attachSelf?: boolean;
      /** "…if this vampire was blocked, they can burn N blood to continue
       *  the action as if unblocked, with +M stealth." */
      continueAction?: { bloodCost: number; stealth: number };
      /** "…if the range is close, stun the opposing minion" (Kiss of
       *  Cathari). docs/stun-design.md §5 */
      stun?: { closeRangeOnly: boolean };
    }
  /** "Burn 1 blood to prevent all damage from the opposing minion's
   *  strikes THIS ROUND" (Rolling with the Punches superior) — broader
   *  than `preventAll`, which is one pending item.
   *  docs/after-combat-ends-design.md §4 */
  | { kind: "preventAllThisRound"; bloodCost: number }
  /** "Reaction cards cost +1 blood or life" (Consign to Oblivion), "the
   *  NEXT reaction card costs +1" (Unleashing the Bestial Soul superior)
   *  — a play-cost modifier scoped to this action.
   *  docs/play-cost-design.md §2 */
  | { kind: "playCostMod"; mod: PlayCostMod }
  /** "Those cards are not replaced until the end of the action" (Consign
   *  to Oblivion superior) — the dynamic form of the handler's static
   *  `delayedReplace: "afterAction"`. */
  | { kind: "delayReplaceFor"; cardTypes: PlayCostCardType[] }
  /** "Choose a minion. The chosen minion cannot play reaction cards this
   *  action" (Unleashing the Bestial Soul). Enumerates one option per
   *  minion, the shape `blockRestriction.chosen` established. */
  | { kind: "noReactionsFromChosen" }
  /** "Strike cards cost the acting minion +1 blood or life during the
   *  resulting combat if this vampire blocks" (Ensnare a Beast superior)
   *  — a play-cost modifier that rides the blocker-combat-rider path,
   *  since it is conditional on the block actually happening. */
  | { kind: "blockerCombatCostMod"; mod: PlayCostMod }
  /** "This combat, combat cards cost the OPPOSING vampire +1 blood"
   *  (Terror Frenzy superior) — a combat-scoped modifier whose payer is
   *  resolved at play time to the side opposite the player. */
  | { kind: "combatCostModOnOpponent"; mod: PlayCostMod }
  /** "Put this card with N counters on it on this minion; it becomes a
   *  weapon equipment" (Weighted Walking Stick) — a combat card that
   *  becomes equipment on its own player mid-combat. */
  | { kind: "attachSelfWeapon"; counters: number }
  /** "RANGED STRIKE: put this card on this minion; it becomes a weapon
   *  equipment" (Molotov Cocktail) — `attachSelfWeapon`'s sibling for the
   *  card whose attachment IS its strike. The distinction is not
   *  cosmetic: the attach happens when the strike RESOLVES, which is what
   *  makes *"if the opponent strikes: combat ends, this strike is not
   *  resolved and the Cocktail is not put on this minion"* fall out
   *  [ANK 20200203-1]. docs/armed-mid-combat-design.md §2 */
  | { kind: "strikeAttachSelfWeapon"; ranged: boolean }
  /** "Instead, the bleed … is unsuccessful" (Spying Mission). The action
   *  simply fails where it stands: no block attempt is underway, so there
   *  is no blocker to spare — which is what separates this from
   *  `endAction`. A failed bleed transfers no pool, so "burns no pool"
   *  needs no clause of its own.
   *  docs/last-equipment-modifiers-design.md §6 */
  | { kind: "failAction" }
  /** "This vampire burns N blood to CONTINUE THE ACTION AS IF UNBLOCKED"
   *  (Go-getter superior). Only meaningful in `action.afterResolution` on
   *  a blocked action; the engine runs the action's success effects — and
   *  only those — once that window closes.
   *  docs/ledger-closeout.md §11 */
  | { kind: "continueAsUnblocked"; bloodCost: number }
  /** "The action ends (unsuccessfully)", played before block resolution
   *  (Change of Target, Mirror Walk superior, Obedience). The pending
   *  block attempt is CANCELLED, not failed — p. 47: "the blocking minion
   *  is not locked for blocking". docs/end-action-design.md §3 */
  | {
      kind: "endAction";
      /** "Unlock this minion" / "unlock the acting vampire". */
      unlockActor?: boolean;
      /** "…lock the blocking minion" — the one thing p. 49 says Mirror
       *  Walk does and Change of Target does not. */
      lockBlocker?: boolean;
      /** "…cannot perform the same action again this turn": barred for
       *  that minion, or for every minion of that Methuselah (Delaying
       *  Tactics). */
      barRepeat?: "minion" | "seat";
    }
  /** "Minions who attempt to block this action and fail become locked
   *  before action resolution" (Faceless Night). */
  | { kind: "lockFailedBlockers" }
  /** "Unlock this vampire" in the after-resolution window (Freak Drive). */
  | { kind: "unlockActor" }
  /** "Reduce the acting minion's stealth to 0. (The acting minion can
   *  still increase their stealth.)" (Night Terrors) — an ordinary
   *  `StealthModified` of minus the current total, because
   *  `currentStealth` is a fold: anything played afterwards still adds on
   *  top, which is exactly what the parenthetical asks for.
   *  docs/blocker-riders-design.md §4 */
  | { kind: "setStealthZero" }
  /** "This vampire gains 1 blood for each vote by which the referendum
   *  passed" (Voter Captivation). `toPool` is the superior half: "move up
   *  to N of those blood to your pool instead", chosen at play time, so
   *  the compiler emits one option per amount. */
  | { kind: "bloodPerVoteMargin"; toPool?: number }
  /** "For each vote by which the referendum passed, distribute 1 blood
   *  among the ready <clan> you control and your pool" (Amici Noctis).
   *  Every recipient is capped at 1, so a distribution is a SUBSET plus a
   *  pool amount (docs/referendum-margin-design.md §4). */
  | {
      kind: "distributePerVoteMargin";
      clan: string;
      poolCap: number;
      /** "…or more than N pool this way if this acting <clan> is titled". */
      poolCapIfTitled: number;
    }
  /** "Add N blood to a <sect> vampire in your uncontrolled region"
   *  (Magnetic Authority); `each` is the superior half. */
  | { kind: "uncontrolledSectBlood"; amount: number; sect: Sect; each?: boolean }
  /**
   * "EACH ready \<filter\> vampire gains N blood from the blood bank"
   * (Blood Feast, Patshiv) — no choice at all, so no announced target
   * (docs/blood-bank-actions-design.md §2).
   *
   * `who.ownOnly` is the field to get right and the easy one to assume:
   * Blood Feast says "each ready Sabbat vampire YOU CONTROL", Patshiv
   * says "each ready unlocked Ravnos" and names no controller, so it
   * feeds the whole table's Ravnos — including a predator's.
   */
  | { kind: "bankBloodSweep"; amount: number; who: BankBloodFilter }
  /**
   * "Move N blood from the blood bank to an \<filter\> vampire, OR move M
   * blood to each of K such vampires" (Esbat) — the player picks the
   * split AND the vampires, both at announcement, the Fifth Tradition:
   * Hospitality precedent (docs/blood-bank-actions-design.md §3).
   *
   * Each split rides in the announced `target` param as its recipients
   * joined by `|`, so the existing one-target rider carries a two-target
   * card without new plumbing.
   */
  | {
      kind: "bankBloodSplit";
      who: BankBloodFilter;
      /** One entry per way the card lets the blood be divided. */
      splits: Array<{ amount: number; targets: number }>;
    }
  /** "Put this card on this vampire" from the after-resolution window —
   *  the action-MODIFIER form of `attachSelf`, cashed in later
   *  (docs/after-resolution-design.md §5). */
  | {
      kind: "afterResolutionAttach";
      /** Tags the attached card carries, for the ability that spends it. */
      tags: string[];
      /** Statics it grants while it sits there (Shadow Cloak). */
      statics?: PermanentStatics;
      /** Record the Methuselah the action was directed at, so a later
       *  clause can require "the same Methuselah" (Shadow Cast). */
      recordTarget?: boolean;
      /** "During your unlock phase, burn this card" (Shadow Cloak). */
      burnInUnlockPhase?: boolean;
    }
  /** "Search your library for an equipment card and equip this vampire
   *  with it (shuffle afterward)" (Magic of the Smith). Resolved at
   *  ACTION RESOLUTION and never announced (p. 14, p. 48) — the one
   *  documented exception to targets-at-announcement.
   *  docs/library-search-design.md §2 */
  | {
      kind: "searchEquip";
      cardTypes: PlayCostCardType[];
      /** Vast Wealth: "the FIRST equipment you find, working down from
       *  the top" — named by position, so there is nothing to ask. */
      deterministic?: boolean;
    }
  /** "Ⓓ Stun an unlocked vampire" (Mind Numb) — a directed action card
   *  that NAMES a minion without fighting it. The target is chosen at
   *  announcement (p. 25) and rides in the option id.
   *  docs/stun-design.md §6 */
  | { kind: "actionStun" }
  /** "Equip this vampire with a melee weapon FROM YOUR HAND" and its
   *  siblings — bring a permanent card into play outside its own
   *  equip/employ/recruit action (docs/play-from-hand-design.md). */
  | ({ kind: "playFromHand" } & PlayFromHandFilter)
  /** "This round, this vampire gets 1 optional maneuver, only usable to
   *  get to close range" (Angel's Gift). */
  | { kind: "roundCloseManeuver" }
  /** "Burn an animal retainer employed by this vampire to put this card
   *  on this vampire" (Pack Alpha superior) — the first cost paid in a
   *  card already in play. The victim rides in the option id. */
  | { kind: "burnAttachedToAttach"; tags: string[]; strength?: number }
  /** "Strike: put this card on the opposing minion with N counters"
   *  (Touch of Oblivion) — the played card becomes an entry on the victim,
   *  paying its counters for whatever the sink intercepts. */
  | {
      kind: "strikeAttachToVictim";
      counters?: number;
      counterSink?: PermanentCounterSink;
      /** "Strike: hand strike at +N damage AND put this card on the
       *  opposing minion" (Sculpt the Flesh superior) — the attach is a
       *  rider on an ordinary hand strike, not a strike of its own. */
      handBonus?: number;
      statics?: PermanentStatics;
      /** "During their unlock phase, the attached minion burns 1 blood or
       *  life" — blood for a vampire, life for an ally (p. 22). */
      bearerUnlockBurn?: number;
    }
  /** "Put this card in play and move up to N blood from the opposing
   *  vampire to this card. After combat ends, move all the blood from
   *  this card to the opposing vampire and burn this card" (Morbidity).
   *  The store is `PermanentInPlay.counters` — the Wasserschloss Anif
   *  precedent, blood in and blood out. docs/combat-attachments-design.md §6 */
  | { kind: "combatBloodStore"; max: number }
  /** "Strike: send the opposing vampire to torpor or burn the opposing
   *  ally" (Touch of Oblivion superior). */
  | { kind: "strikeIncapacitate" }
  /** "Strike, ranged: steal N blood" (Theft of Vitae). */
  | { kind: "strikeStealBlood"; amount: number; riders?: { maneuver?: number; press?: number } }
  /** "THIS ROUND, this vampire can strike, ranged: steal N blood or life"
   *  (Hunger of Marduk) — a GRANTED strike offered later in the round,
   *  not one taken now. docs/last-combat-design.md §3 */
  | { kind: "grantStealBloodStrike"; amount: number }
  /** "Burn N blood to cancel the opposing minion's STRIKE CARD as it is
   *  played, and its cost is not paid (the minion chooses a strike
   *  again)" (Anticipation superior) — the Vozhd of Gravesend's clause
   *  from a card in hand. docs/last-combat-design.md §4 */
  | { kind: "cancelStrikeCard"; bloodCost: number }
  /** "This vampire gains blood equal to the amount of blood lost by the
   *  opposing vampire to damage this round" (Taste of Vitae) — blood
   *  LOST, which is not damage taken. §2 */
  | { kind: "gainOpposingBloodLost" }
  /** "Ⓓ Steal 1 blood or life from a minion controlled by your prey"
   *  (Tier of Souls) — an ACTION, not a strike: the target is named for
   *  directedness (p. 25) and no combat follows (the Mind Numb shape).
   *  docs/action-attachments-design.md §8.3 */
  | { kind: "actionStealBlood"; amount: number; from: "prey" | "any" }
  /**
   * "Ⓓ Steal <a thing> controlled by <somebody else>" — the whole
   * take-it-from-them family (docs/taking-actions-design.md §2).
   *
   * `what` picks the ZONE, and the two are not interchangeable: a
   * retainer is a `PermanentInPlay` attached to a minion and moves with
   * `moveAttachment`; an ally is a `MinionState` and moves with
   * `changeMinionControl`. A spec vocabulary that treated them as one
   * primitive would be wrong about where the card lives (§4).
   */
  | {
      kind: "actionSteal";
      what: "retainer" | "ally" | "torporVampire";
      /** "…controlled by another VAMPIRE" (Far Mastery inferior) is a
       *  weaker restriction than "…another METHUSELAH" (its superior):
       *  the first allows taking from your own other vampire. */
      from: "otherVampire" | "otherMethuselah";
      /** "…and this acting vampire can burn N blood to move the stolen
       *  vampire to your ready region" (Graverobbing superior) — optional
       *  and priced, so it is one option per choice at announcement. */
      thenReady?: { bloodCost: number };
      /** Borrowed rather than kept: "until the end of your turn". */
      untilEndOfTurn?: boolean;
    }
  /**
   * "Put this card on <an opponent's vampire>" from an ACTION, where the
   * card then works against its bearer rather than for them (Puppet
   * Master, Slaughtering the Herd). The action-side sibling of
   * `attachInCombat`'s `to: "opposing"`.
   */
  | {
      kind: "attachToOpponent";
      /** Whose vampire may be chosen. */
      whose: "younger" | "predator";
      /** "…and lock them"; "The attached vampire does not unlock as
       *  normal" (Puppet Master). */
      lockBearer?: boolean;
      preventsUnlock?: boolean;
      /** "Each time the attached vampire announces an action, they move N
       *  blood from themselves to this acting vampire" (Slaughtering the
       *  Herd) — the blood MOVES, so the actor gains what the bearer
       *  burns (§6). */
      siphonOnAnnounce?: number;
      /** "Burn this card after THIS ACTING VAMPIRE leaves the ready
       *  region" — keyed on the player's vampire, not the bearer, which
       *  is why the entry records `linkedMinion`. */
      burnWhenActorLeavesReady?: boolean;
      /** "During your next minion phase, burn this card to unlock the
       *  attached vampire and take control of them until the end of your
       *  turn" (Puppet Master). */
      cashIn?: { unlockBearer: boolean; borrowUntilEndOfTurn: boolean };
    }
  /** "If the bleed is successful, you can lock a minion controlled by the
   *  target Methuselah" (Break the Bonds `[obf]`). */
  | { kind: "lockTargetMinionOnBleed" }
  /** "If the bleed is successful (for 1 or more), the target Methuselah
   *  discards N cards OF THEIR CHOICE" (Shroud of Decay) — a repeated
   *  ChoiceFrame addressed to the TARGET, not the actor.
   *  docs/ash-heap-design.md §6 */
  | { kind: "targetDiscardsOnBleed"; count: number }
  /** "Ⓓ Look at your prey's hand and discard one card of your choice from
   *  it" (Revelations basic).
   *
   *  **The first card in the pool that reveals hidden information.** The
   *  option list IS the look (the library-search shape): the prey's hand
   *  appears only inside a ChoiceFrame addressed to the ACTOR, and the
   *  event log records only what was discarded, never what was seen — so
   *  nothing leaks to the table and a replay reproduces the game. What is
   *  not expressible is that the actor now KNOWS the cards they did not
   *  take, which is the phase-6 "who has looked at this card" gap, a
   *  property of PlayerView rather than of this card.
   *  docs/last-buildable-design.md §2 */
  | { kind: "peekAndDiscard"; whose: "prey"; count: number }
  /** "If this vampire is \<clan\> and the bleed is successful, they can
   *  burn N blood during your next discard phase to unlock" (Fiendish
   *  Tongue). The permission outlives its own card — the action card is
   *  burnt at resolution (p. 27) — so it is recorded on the MINION and the
   *  option is a built-in. docs/last-buildable-design.md §1 */
  | { kind: "discardPhaseUnlockOnBleed"; clan: string; bloodCost: number }
  /**
   * "Ⓓ Remove N cards in your prey's ash heap from the game to burn M of
   * their pool" (Shroud of Decay superior); "Remove an ally in any
   * Methuselah's ash heap from the game to <payoff>" (Psychophagia).
   *
   * **An action that targets an ash heap is always UNDIRECTED** (rulebook
   * glossary) — which runs against every targeting instinct this engine
   * has built up, so it is stated here as well as in the doc (§5).
   */
  | {
      kind: "actionRemoveFromAshHeap";
      /** Whose ash heap, and how many cards. */
      whose: "prey" | "any";
      count: number;
      /** Only cards of these printed types count (Psychophagia: allies).
       *  Answered by `CardHandler.costTypes`. */
      cardTypes?: PlayCostCardType[];
      /** "…to burn M of their pool". */
      burnPool?: number;
      /** "…to gain N blood", optionally "or gain N-1 blood and unlock" —
       *  one option per payoff, chosen at announcement. */
      gainBlood?: number;
      unlockInstead?: { blood: number };
      /** "…to gain 2 blood OR to add 2 life to a zombie ally you control"
       *  (Putrescent Sustenance). A third payoff alongside `gainBlood`,
       *  enumerated once per eligible recipient so the choice of ally is
       *  made at announcement like every other target (p. 25). Capped at
       *  the ally's printed starting life, which is what `capacityOf`
       *  returns for an ally. docs/ledger-closeout.md §4 */
      addAllyLife?: { amount: number; tag: string };
    }
  /** "During your minion phase, this vampire can lock this card to
   *  unlock" (Rutor's Hand) — an ability of the attached card. */
  | { kind: "lockCardToUnlockBearer" }
  /** "Additional strike(s)" (p. 32). `limited` consumes the one granting
   *  source per round; `perBloodX` enumerates X (Lightning Reflexes sup:
   *  burn X for X strikes). */
  | {
      kind: "additionalStrike";
      count: number;
      limited: boolean;
      perBloodX?: boolean;
      /** "1 additional ranged strike: BURN WEAPON" (Voracious Vermin
       *  superior) — the extra strike is SPECIFIED, not free. Without
       *  this the sub-round would offer only a hand strike, because
       *  nothing else grants a burn-weapon strike, and the card's whole
       *  superior mode would be inert. docs/cheap-tail-design.md §4 */
      burnEquipment?: boolean;
      /** "1 additional strike: DODGE" (Wind Dance superior) — the extra
       *  sub-round's strike is FORCED, not merely offered. Unlike
       *  `burnEquipment`, which adds an option nothing else would grant,
       *  this one takes every other option away: the card does not say
       *  "can strike: dodge", it says the additional strike IS a dodge.
       *  docs/ledger-closeout.md §3 */
      forcedDodge?: boolean;
    }
  /** "This combat, the opposing minion cannot maneuver / press / use
   *  equipment" (Terror Frenzy) — set on the opposing side, before range. */
  | { kind: "restrictOpponent"; maneuver?: boolean; press?: boolean; equipment?: boolean }
  /** "Damage from this vampire's hand strikes is aggravated this round"
   *  (Claws of the Dead, Wolf Claws) — before strikes. */
  | { kind: "handStrikesAggravated" }
  | { kind: "setStrength"; value: number }
  /** "Gets +N strength this combat" — additive, before range (Form of
   *  the Wolf). */
  | { kind: "addStrength"; amount: number }
  /** "This combat, YOU get +1 hand size" (Rage of Apedemak) — the card's
   *  player, not their vampire. Held on the combat frame, so the bonus
   *  lifts itself however the combat ended and p. 7's discard-down runs
   *  at the pop. docs/temporary-hand-size-design.md */
  | { kind: "handSizeBonus"; amount: number }
  /** `onlyToLong` is the mirror of `onlyToClose` — "Maneuver, only usable
   *  to go to LONG range" (High Ground, Backstep). Same reasoning: worth
   *  nothing once the range is already long.
   *  docs/one-each-round-design.md §3 */
  | { kind: "maneuver"; onlyToClose?: boolean; onlyToLong?: boolean }
  /** "Cancel a COMBAT CARD played by the opposing minion as it is played,
   *  and its cost is not paid" (Death Seeker) — `cancelStrikeCard` with
   *  the strike condition dropped, so it reaches any combat card the foe
   *  plays. `CardPlayFrame.isCombat` is already denormalized for exactly
   *  this family, so no card reads another card's spec.
   *  docs/one-each-round-design.md §2 */
  | {
      kind: "cancelCombatCard";
      /** "BURN 1 BLOOD to cancel …" (Disengage, Groundfighting) — a
       *  play-time gate, not just a payment: *"the card cannot be played
       *  if the minion cannot afford to burn the blood"*, and the burn is
       *  NOT reduced by cost reducers, because it is an effect rather
       *  than the card's cost [ANK 20210226].
       *  docs/cancel-in-combat-design.md §2 */
      bloodCost?: number;
      /** "…cancel A GRAPPLE CARD as it is played" (Disengage) — matched
       *  against `CardPlayFrame.keywords`, which is denormalized at push
       *  precisely so no card reads another card's spec. */
      keywords?: string[];
      /** "…cancel a combat card that would RESTRICT THIS ANARCH'S CHOICE
       *  OF STRIKES this round" (Groundfighting) — matched against
       *  `CardPlayFrame.restrictsStrikeChoice`, which the compiler
       *  answers centrally. The rulings draw the line tightly: it reaches
       *  "cannot use equipment" and "hand strikes only", and NOT range,
       *  maneuvers, dodges, additional strikes, equipment destruction or
       *  Discipline restrictions [LSJ 20050221].
       *  docs/cancel-in-combat-design.md §3 */
      restrictsStrikeChoice?: boolean;
      /** Death Seeker and Disengage print "(no cost is paid for that
       *  card)"; Groundfighting does not, and the general rule is that a
       *  cancelled non-action card's cost IS still paid
       *  [RBK cancel-a-card] [ANK 20260216]. The refund is therefore the
       *  card's own clause, not the cancel's — but the existing callers
       *  all refund, so the flag names the exception.
       *  docs/cancel-in-combat-design.md §2 */
      costIsStillPaid?: boolean;
    }
  /** "If the OPPOSING minion's strike successfully inflicts any damage on
   *  this minion this round, the opposing minion gets an optional press"
   *  (Backstep) — a rider installed on the round, paid out at infliction.
   *  Needs no round bookkeeping of its own: press credits are per-round
   *  already, so *"the optional press can only be used during the current
   *  round"* [TOM 19960521] falls out.
   *  docs/cancel-in-combat-design.md §4 */
  | { kind: "pressToStrikerIfDamaged" }
  /** "YOU GAIN THE EDGE" (Esteem) — the Edge is a single shared token
   *  (p. 28), so taking it is always taking it FROM whoever held it, and
   *  `EdgeTaken` already says so. docs/the-edge-design.md §2 */
  | { kind: "takeEdge" }
  /** "BURN THE EDGE to get +1 bleed that does not count against the
   *  limit. You cannot gain the Edge this action; if you would get the
   *  Edge, it is burned instead" (Leverage). One primitive, because the
   *  three clauses are one bargain: the bleed bonus is bought with the
   *  Edge, and the rider exists so the successful bleed cannot hand it
   *  straight back (p. 21 gives the Edge to a bleeder of 1+).
   *  docs/the-edge-design.md §3 */
  | { kind: "burnEdgeForBleed"; amount: number }
  /** "Only usable if your prey controls the Edge OR THE EDGE IS
   *  UNCONTROLLED. Your prey MAY TAKE THE EDGE if it is uncontrolled"
   *  (Instability) — a master whose gate is where the Edge sits and whose
   *  first effect is an offer to somebody else.
   *  docs/the-edge-design.md §4 */
  | { kind: "preyMayTakeEdge" }
  /** "Successful referendum means THE CHOSEN METHUSELAH GETS THE EDGE"
   *  (Regaining the Upper Hand) — the referendum outcome that moves the
   *  token. docs/the-edge-design.md §5 */
  | { kind: "refGiveEdge" }
  /** "Play before range is determined to SET THE RANGE for the round to
   *  long" (High Ground's flight clause). Setting is not maneuvering:
   *  *"once the range is set, no other effect can be used to reset the
   *  range that round"* and the Determine Range step is skipped
   *  [RTR 19970630] [ANK 20180720], which `setCombatRange` already does.
   *  `requiresFlightAdvantage` is "if THIS minion has flight and the
   *  opposing minion does not". docs/one-each-round-design.md §3 */
  | { kind: "setRangeLong"; requiresFlightAdvantage?: boolean }
  /** `continueOnly` is "only usable to CONTINUE combat" (Dead-End Alley,
   *  Righteous Blade); `endOnly` is its mirror, "only usable to END
   *  combat" (Open Grate, Disengage) — which can only ever cancel a
   *  standing press (p. 32), so it is offered nowhere else. */
  | { kind: "press"; continueOnly: boolean; endOnly?: boolean }
  /** "Only usable if combat would end. Instead, start a new round"
   *  (Hunting the Quarry superior, Telepathic Tracking superior).
   *  docs/round-end-design.md §1 */
  | { kind: "startNewRound"; bloodCost?: number }
  /** "Strikes that are not hand strikes cannot be used this round (by
   *  EITHER combatant)" (Immortal Grapple). §2 */
  | { kind: "handStrikesOnly"; skipNextRange?: boolean }
  /**
   * An AIM card (Target Vitals, Head, Hand, Leg): played as this minion
   * chooses a strike, with a payload that waits for that strike to
   * SUCCESSFULLY INFLICT DAMAGE on the opposing minion.
   *
   * `strikeDamage` is the exception and the only thing applied at once:
   * "the strike does +2 damage" (Target Head) is part of what the strike
   * deals and prevention eats it, where `damage` — "if any damage is
   * successfully inflicted, they take +N from this strike" — rides damage
   * that already got through. docs/aim-design.md
   */
  | {
      kind: "aimRider";
      /** Added to the strike's own damage, before prevention. */
      strikeDamage?: number;
      /** Added to damage that landed ("they take +N from this strike"). */
      damage?: number;
      barPress?: boolean;
      barAdditionalStrikes?: boolean;
      setRangeNextRound?: boolean;
      strengthPenalty?: number;
      destroyWeapon?: boolean;
      /** Discipline abbreviations that a maneuver or press must require. */
      moveDisciplines?: string[];
    }
  /** "Once this round, this vampire can burn N blood to get 1 additional
   *  maneuver, only usable to get to close range" (Dance with the Devil
   *  superior) — a credit, where `maneuver` performs one. §4 */
  | { kind: "grantCloseManeuver"; bloodCost?: number }
  /** "Prevent N damage". `nonAggravated` is the printed clause "prevent N
   *  NON-AGGRAVATED damage" (Soak, Wall of Filth basic) — a gate on the
   *  OPTION, like `PendingDamage.noPreventBy`: a card that provably
   *  cannot touch this damage is never offered against it.
   *  docs/combat-attachments-design.md §3 */
  | { kind: "prevent"; base: number; perBloodX: boolean; nonAggravated?: boolean }
  /** "Put this card on this vampire / on the opposing vampire" from a
   *  combat card that is NOT a strike (Wall of Filth, Disarm). The window
   *  is DATA rather than a fixed case in `combatWindowFor`, because one
   *  mechanic is printed with two different timings (§2). */
  | {
      kind: "attachInCombat";
      /** `anyInCombat` is "put this card on A NOSFERATU IN COMBAT" — either
       *  combatant, whoever controls them, which is what lets a seat not in
       *  the fight play it at all. `gunOnSelf` lands on a GUN this minion
       *  carries rather than on the minion (Magazine).
       *  docs/before-range-attachments-design.md §2, §4 */
      to: "self" | "opposing" | "anyInCombat" | "gunOnSelf";
      when: "beforeRange" | "endOfRound";
      statics?: PermanentStatics;
      tags?: string[];
      /** "…on a NOSFERATU in combat" — the target's clan, not the
       *  player's, so it is not `requiresClan`. */
      targetClan?: string;
      /** "…and send them to torpor" (Disarm). */
      torporTarget?: boolean;
      /** "This vampire can burn this card to prevent N damage"
       *  (Wall of Filth) — an ability of the attached card. */
      burnToPrevent?: { amount: number; nonAggravated?: boolean };
      /** "Put this card AND 1 BLOOD on this Assamite" (Focus the Blood) —
       *  the bearer's own blood moves onto the entry as counters, the
       *  Wasserschloss Anif precedent. docs/before-range-attachments-design.md §3 */
      bloodOnCard?: number;
      /** "…burn this card to reduce the cost of a combat card they play by
       *  N blood" — a one-shot `playCostMod` the BEARER spends, offered as
       *  an ability of the attached entry. */
      burnToDiscountCombatCard?: number;
      /** "…and put an AMMO CARD FROM YOUR HAND on this card" (Magazine).
       *  An ammo card is one whose handler answers `ammoLoad`, so the
       *  filter cannot drift from what the ammo cards actually are. */
      storeAmmoFromHand?: boolean;
    }
  /**
   * "Ammo. Only usable before resolution of a gun's strike … for the
   * remainder of this combat" — a card loaded into one gun
   * (docs/ammo-design.md).
   *
   * The gun is named in the option id, because the bearer may carry two
   * and the choice is the player's. Every field below matches a field on
   * `AmmoLoad`, which is what this compiles into; the rules that are the
   * SAME on all five cards — one ammo per gun per combat, your own gun
   * only ([LSJ 20020425]), only on a gun whose strike is declared — live
   * in the enumerator rather than here, so no card can forget one.
   */
  | {
      kind: "loadAmmo";
      /** Flat bonus in the base damage's own properties [TOM 19960225]. */
      damage?: number;
      /** Scattershot's "+2 at close range and -2 at long range". */
      damageByRange?: { close: number; long: number };
      /** Dragon's Breath's separate aggravated packet [LSJ 20030419-2]. */
      aggravatedDamage?: number;
      burnGunAfterStrike?: boolean;
      additionalStrikeSelf?: boolean;
      /**
       * Glaser Rounds: "not usable the first time the gun is used in a
       * given combat" — [RTR 19941109] reads that as "wait until the
       * second time", so this is 2 and the enumerator compares it against
       * `cf.gunUses`, which counts the strike being asked about.
       */
      minGunUses?: number;
    }
  /** "Prevent ALL damage from the opposing minion's strike", played by the
   *  minion taking it (Touch of Valeren's inferior combat mode). */
  | { kind: "preventAll" }
  /** Grant a press credit: per-round by default, or the whole combat
   *  (Form of the Wolf's "1 optional press this combat"). */
  | { kind: "grantPress"; combat?: boolean }
  /** "This round, this vampire gets +1 strength and 1 optional maneuver,
   *  and can prevent 1 damage" (Obedient Flesh) — one combat card handing
   *  its player several credits to spend later in the round. Lives in the
   *  before-range window, since that is where such cards are played, and
   *  grants CREDITS rather than performing the actions, so it does not
   *  need to span three windows. */
  | {
      kind: "combatCredits";
      /** Round-scoped, unlike `addStrength`, which lasts the combat. */
      strength?: number;
      maneuver?: number;
      press?: number;
      prevent?: number;
    }
  /** "This combat, this vampire can prevent N damage EACH ROUND" (Bear's
   *  Skin superior, Tranquility Shield) — a rate that refreshes, unlike
   *  `combatCredits.prevent` (this round only) and the `preventCredits`
   *  pool (combat-long, spend once).
   *  docs/round-recurring-combat-design.md §2 */
  | { kind: "preventEachRound"; amount: number }
  /** "This combat, <the opposing minion | both combatants> take N damage
   *  each round" (Carrion Crows, Weather Control) — the combat-card form
   *  of the retainer static `combatRoundDamage`. §3 */
  | {
      kind: "roundDamage";
      amount: number;
      targets: "opposing" | "both";
      /** "1R" — applies at any range, like a ranged strike (p. 30). */
      ranged: boolean;
      when: "beforeRange" | "strikeResolution";
      /** "…and each retainer on them" (Weather Control). */
      retainers?: boolean;
      unpreventable?: boolean;
      /** "…increased by 1 in each subsequent round" (Weather Control
       *  superior). */
      escalate?: boolean;
    }
  /** "This combat, if a damage is successfully inflicted on this vampire
   *  in a given round, any additional damage in the same round is
   *  automatically prevented" (Flesh of Marble). `aggravated` is the
   *  superior's "…aggravated damage is prevented this way as well". §5 */
  | { kind: "autoPreventAfterFirst"; aggravated: boolean }
  /** "This combat, frenzy cards cannot be used on this vampire; cancel
   *  the effects of frenzy cards already used on them this combat"
   *  (Tranquility Shield) — closes the deferral in docs/frenzy-design.md.
   *  docs/round-recurring-combat-design.md §6 */
  | { kind: "frenzyShield" }
  // Referendum effects (docs/politics-design.md §3): what a passed
  // referendum does; terms enumeration derives from the same primitive.
  | { kind: "refBurnPerMinion"; lockedOnly: boolean }
  | {
      kind: "refAllocateBurn";
      points: number | "numSeats";
      minTargets: number;
      excludeSelf?: boolean;
      /** "CHOOSE a Methuselah and allocate 5 points among two or more
       *  OTHER Methuselahs … the chosen Methuselah gains N pool"
       *  (Camarilla's Iron Fist). "Other" is measured from the CHOSEN
       *  seat, not the caller — the sentence names the chosen one as the
       *  beneficiary. docs/referendum-terms-design.md §2 */
      beneficiary?: { gainPool: number };
    }
  /** "Each ready \<sect\> gains N blood and each Methuselah controlling
   *  a \<sect\> gains M pool" (Anarch Salon) — a payout with NO terms.
   *  The two halves count different things: vampires, then Methuselahs.
   *  docs/referendum-terms-design.md §3 */
  | { kind: "refSectPayout"; sect: Sect; blood: number; poolPerController: number }
  /** "Choose a CLAN. Each Methuselah gains N pool for each vampire of the
   *  chosen clan they control" (Consanguineous Boon). The terms range
   *  over every clan in the POOL, not every clan in play (p. 49). §1 */
  | { kind: "refClanBoon"; poolPerVampire: number }
  /** "Each Methuselah gains/burns N pool for each \<minion\> they control",
   *  or "all \<vampires\> burn N blood" — one filtered per-minion tally
   *  covering four legacy referendums that differ only in the filter and
   *  the resource (docs/pool-widening-design.md §6, tranche 3 wave 6).
   *
   *  `burnBlood` is charged to each MINION, the other two to the seat, so
   *  the effect decides who pays as well as what. */
  | {
      kind: "refPerMinion";
      effect: "gainPool" | "burnPool" | "burnBlood";
      amount: number;
      /** Every filter present must match; absent does not constrain. */
      who?: {
        kind?: "vampire" | "ally";
        ready?: boolean;
        inTorpor?: boolean;
        /** "…with capacity BELOW 4" is `maxCapacity: 3`. */
        maxCapacity?: number;
        /** "…with capacity of 8 OR MORE" (Political Stranglehold). */
        minCapacity?: number;
        /** "…the number of Assamites he or she controls" (Treaty of Tyre
         *  Enforced) — THE REGISTRY CLAN, which is Banu Haqim. */
        clan?: string;
        /** "…Independent OR Anarch" — a union, one modifier per minion. */
        sects?: Sect[];
      };
      /** "Each Methuselah burns **X+1** pool, where X is …" (Treaty of
       *  Tyre Enforced) — a flat term on top of the tally, charged even
       *  to a Methuselah whose tally is ZERO, which is the whole point of
       *  the card and the one thing an `if (hits.length === 0) continue;`
       *  guard gets wrong (docs/table-pool-swings-design.md §3). */
      plus?: number;
    }
  /**
   * "Each Methuselah gains/burns N pool for each \<card\> they control",
   * where the thing counted is NOT a minion
   * (docs/table-pool-swings-design.md §2).
   *
   * `refPerMinion`'s sibling. Two primitives rather than one with a
   * discriminated count, because the payment rule is shared in a helper
   * and the COUNT is the only part that differs — merging them would put
   * a union inside a filter that four existing cards read.
   */
  | {
      kind: "refPerSeatCards";
      effect: "gainPool" | "burnPool";
      amount: number;
      /** "Each Methuselah GAINS 1 POOL. Each Methuselah THEN burns 1 pool
       *  for each …" (Can't Take it with You) — the flat gain everybody
       *  receives before the tally is charged. Both halves resolve for
       *  every standing Methuselah, so a seat with nothing in play comes
       *  out 1 pool ahead. */
      everyoneGains?: number;
      count:
        /** "…for each equipment, location or retainer card he or she
         *  controls" — matched on the permanent TAGS that already answer
         *  "location / equipment / retainer" elsewhere, rather than by
         *  asking the registry: an equipment or retainer entry lives on a
         *  MINION, not in `seat.permanents`, and the tag travels with the
         *  entry wherever it sits. */
        | { of: "permanents"; tags: string[] }
        /** "…the number of vampires in his or her PREY's ash heap"
         *  (Mark of the Damned). Each Methuselah's own count is read off
         *  somebody else's zone, which is what makes it not a
         *  `refPerMinion`. */
        | { of: "preyAshHeapCrypt" };
    }
  /** "Choose a Methuselah OR a location — or BOTH if the acting vampire
   *  is one of \<titles\>" (Cold War). §2 */
  | {
      kind: "refBurnSeatOrLocation";
      poolBurn: number;
      /** Titles that let the caller choose both instead of either. */
      bothIfTitle: VampireTitle[];
    }
  /** "Choose a location and a Methuselah. The chosen Methuselah takes
   *  control of the chosen location" (Disputed Territory). §2 */
  | { kind: "refMoveLocation" }
  /** "Move up to N blood from a ready vampire you control to a YOUNGER
   *  vampire of the same clan in your uncontrolled region" (Grooming the
   *  Protégé) — a ONE-SHOT master, so it resolves and goes to the ash
   *  heap rather than sitting in play.
   *  docs/crypt-and-uncontrolled-design.md §3 */
  | { kind: "bloodToUncontrolledKin"; max: number }
  /** "Choose a \<filter\> vampire. Successful referendum means this card
   *  is put ON the chosen vampire" (Archon) — `refPutInPlay` with a
   *  bearer chosen in the terms. docs/opposing-statics-design.md §2 */
  | { kind: "refAttachToChosen"; who: { sect?: Sect; clan?: string } }
  /** "Allies and younger vampires get −1 intercept" (Perfect Paragon
   *  superior) — the ACTION-scoped twin of
   *  `PermanentStatics.opposingInterceptPenalty`. The English "and" is a
   *  UNION of two sets. docs/opposing-statics-design.md §1 */
  | {
      kind: "modifyFilteredIntercept";
      amount: number;
      kinds?: Array<"vampire" | "ally">;
      younger?: boolean;
      /** "…younger than THIS MODIFYING RAVNOS" (Zapaderin) — the yardstick
       *  is the minion PLAYING the card, who is explicitly not the acting
       *  minion. Every earlier card measured against the actor, so the
       *  reference was hard-coded to them.
       *  docs/second-minion-modifiers-design.md §2 */
      youngerThanPlayer?: boolean;
      /** "ANARCHS get −1 intercept during this action" (Fiendish Tongue)
       *  — a third arm of the same union. */
      sects?: Sect[];
    }
  /** "Choose X ready unlocked \<sect\>s you control and allocate 2X points
   *  among one or more Methuselahs, locations, and equipment. Successful
   *  referendum means each chosen minion is locked, each Methuselah burns
   *  1 pool per point, and each location or equipment allocated a point is
   *  burned" (Revolutionary Council).
   *
   *  The first HETEROGENEOUS allocation: the recipients are seats and
   *  cards in play at once, and the cards are capped at 1 because a point
   *  burns them. docs/last-buildable-design.md §4 */
  | {
      kind: "refLockAndAllocate";
      /** Which of the caller's minions may be chosen. */
      sect: Sect;
      /** Points per chosen minion. */
      pointsEach: number;
    }
  | {
      kind: "refChooseSeatsBurn";
      base: number;
      /** Extra burn if the chosen seat controls a ready vampire whose
       *  capacity is `atMost` (Neonate Breach) or `atLeast` (Empires
       *  Fall) the bound. */
      capBonus?: { atMost?: number; atLeast?: number; extra: number };
      /** "Choose A Methuselah" (Screw the Masquerade!) — exactly one,
       *  where the primitive's default is any non-empty subset. The terms
       *  are the legal-move generator's answer to "who may this name", so
       *  the card's own arity belongs there rather than in the tally. */
      chooseExactly?: number;
      /** "…means EACH Methuselah burns 1 pool and the chosen Methuselah
       *  burns an ADDITIONAL pool" (Screw the Masquerade!). Charged to
       *  every standing seat; `base` is then what the chosen seat pays on
       *  top, not instead. */
      everySeatBurns?: number;
    }
  /** "Choose up to N minions. Successful referendum means the chosen
   *  minions cannot play reaction cards, block or cast votes or ballots
   *  this turn" (Expulsion). docs/abstain-gate-design.md §5 */
  | { kind: "refExpelMinions"; upTo: number }
  /** "Successful referendum means this card is put in play" (War of
   *  Ages) — the calling card becomes the permanent its own `permanent`
   *  clause describes, instead of being burned at resolution.
   *  docs/pool-drain-design.md §6 */
  /** "Successful referendum means this card is put in play" (War of
   *  Ages). With `onActor`, it goes ON THE CALLING VAMPIRE instead of at
   *  seat level, and `grantsTitle` is the title it then represents — the
   *  Praxis Seizure shape, which `ReferendumFrame.cardInstanceId` was
   *  always kept for ("so a title-granting referendum can attach it on a
   *  pass"). */
  /** `grantsTitleCity` is "…the unique Camarilla title of Prince OF
   *  CHICAGO" (Praxis Seizure) or "…Sabbat title of Archbishop OF
   *  CHICAGO" (Crusade). It is what the title contests ON. */
  | {
      kind: "refPutInPlay";
      onActor?: boolean;
      grantsTitle?: VampireTitle;
      grantsTitleCity?: string;
    }
  /** "Successful referendum means YOU steal 1 pool from each Methuselah
   *  who \<condition\>" (Transfer of Power, Tithings).
   *
   *  A steal is a TRANSFER, not a burn: the victim loses and the caller
   *  gains the same amount, and a victim with less than `amount` gives
   *  what they have — so the two halves are computed per victim rather
   *  than a burn-all-then-gain-the-total.
   *
   *  The condition is read ONCE, before any pool moves. Transfer of Power
   *  says "who has more pool than you do", and taking from the richest
   *  seat first would otherwise change who qualifies partway down the
   *  table — the same seat order dependence `refAllocateBurn` avoids.
   *  docs/pool-widening-design.md §6 (tranche 1 wave 13) */
  | {
      kind: "refStealPerSeat";
      amount: number;
      /** Exactly one arm is set; both are per-VICTIM questions. */
      from:
        | { morePoolThanCaller: true }
        /** "…who does not control a vampire with a capacity ABOVE 6"
         *  (Tithings) — `aboveCapacity: 6` means capacity 7 or more. */
        | { noVampireAboveCapacity: number };
    }
  /** "Successful referendum means each Methuselah gains X pool, where X is
   *  the number of CLANS to which his or her ready vampires belong"
   *  (Diversity).
   *
   *  A tally of DISTINCT clans, not of vampires — three ready Brujah are
   *  one clan and pay once. Allies have no clan and never count, and an
   *  unready vampire's clan does not count even when a ready stablemate
   *  shares it, because the sentence quantifies over ready vampires. */
  | { kind: "refClanDiversity"; poolPerClan: number }
  /** "Choose a clan. Successful referendum LOCKS all vampires of that
   *  clan" (Consanguineous Condemnation) — every Methuselah's, the
   *  caller's own included, and an already-locked vampire is simply
   *  already locked. Terms range over the clans in the POOL, the
   *  `refClanBoon` rule (p. 49). */
  | { kind: "refLockClan" }
  /** "Choose a ready \<filter\>. Successful referendum means it \<outcome\>"
   *  — Command of the Harpies, Excommunication, Tradition Upheld,
   *  Permanent Vacation. One primitive, four filters, three outcomes
   *  (docs/pool-widening-design.md §6, tranche 1 wave 14).
   *
   *  The three outcomes are NOT interchangeable and the difference is
   *  visible at the table:
   *   - `loseTitle` leaves the minion in play with no title. A contested
   *     title is a different thing again — this is the plain loss.
   *   - `burn` sends it to the ash heap, where cards can still reach it.
   *   - `removeFromGame` does not: a card removed from the game "cannot
   *     be retrieved or affected in any way" (p. 16).
   *
   *  The chosen minion is re-read at RESOLUTION, never assumed: the whole
   *  polling step happens between the choice and the effect, and the
   *  minion can be burned, moved to torpor or removed in it. */
  | {
      kind: "refRemoveChosenMinion";
      /** Every filter present must match; absent does not constrain. */
      who: {
        kind?: "vampire" | "ally";
        ready?: boolean;
        /** "…a ready PRINCE" / "…a ready ARCHBISHOP". */
        title?: VampireTitle[];
        /** A literal clan name. Note the `clan-vocabulary.test.ts` guard:
         *  a clan no vampire in the POOL has makes the card inert. */
        clan?: string;
        /** "…who belongs to the same clan as THE ACTING VAMPIRE"
         *  (Sacrifice) — a filter relative to the caller rather than a
         *  fixed clan, so it stays correct as the crypt widens. Read from
         *  the calling minion at terms time; a caller with no clan
         *  matches nothing, which is the print-faithful answer. */
        sameClanAsCaller?: boolean;
        /** "…with a capacity BELOW 7" is `maxCapacity: 6`. */
        maxCapacity?: number;
      };
      outcome: "loseTitle" | "burn" | "removeFromGame";
    }
  /** "Successful referendum means all \<X\> are burned. Any Methuselah can
   *  keep \<theirs\> by repaying their pool cost" — Jericho Founding
   *  (locations), Kindred Segregation (allies), Peace Treaty (weapons).
   *  docs/pool-widening-design.md §6, tranche 1 wave 15.
   *
   *  A table-wide sweep with a PER-CARD ransom, so it raises one choice
   *  per card rather than burning first and refunding after. The question
   *  has to precede the burn — the Rutor's Hand rule, learned when a
   *  ChoiceFrame raised during resolution turned out only to QUEUE, and
   *  the obvious build asked after the damage had landed.
   *
   *  The choice is MANDATORY with two answers rather than optional with a
   *  decline: a declined optional choice is a plain `pass` the handler is
   *  never told about, and the burn lives on the decline. When the seat
   *  cannot afford the ransom only "let it burn" is offered, which is the
   *  card working rather than an option list that is empty. */
  | { kind: "refBurnAllKeepable"; what: "location" | "ally" | "weapon" }
  // One-shot master-card primitives.
  /** "Gain N pool" (Ascendance) — the whole card, and the simplest
   *  possible master (docs/pool-widening-design.md §6, tranche 3 wave 7). */
  | { kind: "gainPool"; amount: number }
  /** "If you have N or fewer pool, gain X pool. Otherwise, gain Y"
   *  (King's Rising) — the pool is read BEFORE anything is gained, and the
   *  card is played, so the master-phase action is spent either way. */
  | { kind: "gainPoolThreshold"; atOrBelow: number; ifAtOrBelow: number; otherwise: number }
  /** "Choose a vampire in your ash heap. Gain X pool, where X is HALF OF
   *  THE CAPACITY of that vampire (round down). Remove that vampire from
   *  the game" (Redeem the Lost Soul). The capacity is read off the ash
   *  entry, which records it as the vampire burns — see
   *  `CardInstance.capacity`. docs/ash-heap-resource-design.md §2 */
  | { kind: "redeemVampireFromAsh"; divisor: number }
  /** "Burn a vampire in torpor" (Vulnerability) — ANY Methuselah's, and
   *  torpor is the whole filter: a vampire in torpor is still in play. */
  | { kind: "burnTorpidVampire" }
  /** "Burn a location" (Unnatural Disaster) — any Methuselah's, keyed on
   *  the printed `location` tag rather than on the card type, because an
   *  equipment card can print "represents a location" (Living Manse,
   *  Sacré-Cœur). */
  | { kind: "burnLocation" }
  /** "Move the top card from your crypt to your uncontrolled region"
   *  (Effective Management). *"Cannot be played when the target crypt is
   *  empty"* [RTR 20000501], so the option is gated, not a no-op. */
  | { kind: "cryptToUncontrolled" }
  /** "Move N blood from EACH ready vampire you control to your pool"
   *  (Tribute to the Master). *"Can be played with no ready vampire"*
   *  [ANK 20210717] — deliberately NOT gated, the mirror of the ruling
   *  above. */
  | { kind: "eachOwnReadyVampireBloodToPool"; amount: number }
  /** "Lock all ready \<clan\>" (Letter from Vienna) — every Methuselah's,
   *  not just the player's. */
  | { kind: "lockAllMatching"; clan?: string; sect?: Sect }
  | { kind: "lockMinion" }
  /** "The first referendum a \<sect\> vampire you control calls on this
   *  turn passes automatically (skip the polling step)" (Día de los
   *  Muertos) — a one-shot master that arms
   *  `SeatState.autoPassReferendum`, consumed by the first qualifying
   *  referendum push. docs/politics-locations-design.md §4 */
  | { kind: "autoPassReferendum"; sect?: Sect }
  | { kind: "addBloodToReadyVampire"; amount: number }
  | { kind: "moveOwnVampireBloodToPool" }
  // Riders.
  | { kind: "burnIfNotBlocking"; amount: number }
  | { kind: "poolGainOnBleedSuccess"; amount: number }
  /** "Ⓓ Steal N pool from another Methuselah" (Line Brawl) — the target
   *  burns it and the acting Methuselah gains it, on success.
   *  docs/bleed-riders-sweep.md */
  | { kind: "actionStealPool"; amount: number }
  /** "Ⓓ Burn a location" / "Ⓓ Burn an equipment" / "Ⓓ Steal a location" —
   *  an action card from hand that targets a CARD IN PLAY, chosen at
   *  announcement and directed at its controller (Conceal, Rewilding,
   *  Dominate Kine). `poolFromController` is Rewilding's extra burn.
   *  docs/permanent-target-actions-design.md */
  | {
      kind: "actionOnPermanent";
      what: "location" | "equipment";
      outcome: "burn" | "steal";
      poolFromController?: number;
    }
  /** "Ⓓ Steal an ally controlled by another Methuselah" (Entrancement) —
   *  control moves on a successful action; the target is fixed at
   *  announcement like every other action target (p. 25). */
  | { kind: "stealMinionOnSuccess"; kindFilter: "ally" | "vampire" }
  /** "…this vampire can burn N blood to draw 1 card from your crypt"
   *  (Enthrall) — a crypt card drawn goes to the uncontrolled region
   *  (p. 3). Optional, so it is offered as a choice. */
  | { kind: "cryptDrawOnBleedSuccess"; bloodCost: number }
  /** "The target Methuselah locks a ready unlocked minion they control"
   *  (Propaganda superior) — the choice belongs to the TARGET, so it is a
   *  ChoiceFrame raised to that seat. */
  | { kind: "targetLocksOwnMinion" }
  | {
      kind: "bloodOnBleedSuccess";
      amount: number;
      /** Where the target vampire may be. */
      scope: "uncontrolled" | "anywhere";
      youngerOnly: boolean;
    };

/**
 * One thing a `permanent.bloodStore` location offers its controller
 * (docs/blood-banking-locations-design.md §2).
 *
 * The window is named rather than the option being built per card,
 * because the five Powerbases differ ONLY in which window their offer
 * sits in and how much moves — Chicago banks in the unlock phase, New
 * York buys in the master phase for a pool, and that is the whole
 * difference between them.
 */
export type BloodStoreOffer = {
  /** "During your unlock phase" / "as a master phase action". */
  window: "unlock" | "master";
  /** "As a MASTER PHASE ACTION" — spends the turn's one (p. 8). A card
   *  that merely says "during your master phase" does not. */
  usesMasterAction?: boolean;
  /** "…burn 1 pool to…" — a price, paid on use, not a cost of the card. */
  poolCost?: number;
} & (
  /** "Move N blood from the blood bank to this card." The bank is
   *  unbounded (p. 5), so this is a gain, not a transfer. */
  | { kind: "bankToCard"; amount: number }
  /** "Move N blood from this card to your pool", or ALL of it. */
  | { kind: "cardToPool"; amount: number | "all" }
  /** "Move up to N pool to this card and add 1 blood from the blood bank
   *  for each pool you move" (Powerbase: Washington, D.C.) — one option
   *  per amount, each leaving 2 counters per pool spent. */
  | { kind: "poolToCardMatched"; max: number }
);

/**
 * Which vampires a blood-bank action may feed
 * (docs/blood-bank-actions-design.md §2).
 *
 * ONE filter for both primitives, because "who qualifies" is the only
 * question the three cards answer differently and a second copy of it is
 * a second place to forget `ownOnly`.
 */
export interface BankBloodFilter {
  clan?: string;
  sect?: Sect;
  /** "each ready UNLOCKED Ravnos" (Patshiv). Ready is always required:
   *  a vampire in torpor is not ready (p. 6). */
  unlockedOnly?: boolean;
  /** "…you control". ABSENT MEANS EVERY METHUSELAH'S — Patshiv names no
   *  controller and so feeds a predator's Ravnos too. */
  ownOnly?: boolean;
}

/** Card-text timing clauses, as data (docs/card-primitives.md §3). */
export type UsabilityRule =
  | "onlyDuringBleed"
  | "notDuringBleed"
  | "bleedTargetsYou"
  /** "Only usable during an action directed at you (or a card you control)"
   *  (The Warrens, Eyes of Argus). */
  | "actionDirectedAtYou"
  /** "Only usable if a minion controlled by your predator is bleeding you"
   *  and 3+ Methuselahs remain (My Enemy's Enemy). */
  /** "Only usable if a minion controlled by your predator is ACTING"
   *  (Instinctive Reaction) — the plain form of the rule below. */
  | "predatorIsActing"
  | "predatorBleedingYou"
  /** "Only usable by a locked vampire who has blocked, after block
   *  resolution" (Cats' Guidance, Forced Vigilance) — offered in the first
   *  window of the resulting combat, to the blocker (the `opposing`
   *  combatant). Checked structurally by the compiler, not in rulesHold. */
  | "afterBlockResolution"
  | "afterBlocksDeclined"
  /** "Only usable if a bleed would be successful" (Spying Mission) —
   *  p. 27 A.4's state C: every Methuselah has passed on blocking and the
   *  action has not resolved yet. Unlike `afterBlocksDeclined`, which asks
   *  whether the READER declined, this asks whether everyone did, so it is
   *  the rule the ACTING side needs.
   *  docs/last-equipment-modifiers-design.md §6 */
  | "ifActionWouldSucceed"
  /** "Only usable as an action to RECRUIT OR EMPLOY a wraith or zombie is
   *  announced" (Paths in Two Worlds). Read off `ActionAnnounced.cardTags`
   *  — the ally is not in play yet, so the question is about the
   *  announcing CARD. docs/wraith-zombie-design.md §4 */
  | "asUndeadRecruit"
  /** "Only usable by … other than the ACTING WRAITH OR ZOMBIE ALLY"
   *  (Gifts From Hereafter) — a condition on the acting minion, on top of
   *  whichever `byOther…` rule says who may play it. */
  | "actingIsUndeadAlly"
  | "byLockedMinion"
  /** "USABLE by a locked vampire" (Fillip) — locked is ALLOWED, where
   *  `byLockedMinion` is "ONLY usable by a locked vampire" and excludes an
   *  unlocked one. docs/lock-as-currency-design.md §3 */
  | "alsoByLockedMinion"
  /** "Only usable by a ready vampire other than the acting minion" (Cloak
   *  the Gathering superior). Still the ACTING Methuselah's card, played
   *  by one of their other vampires — p. 12: "only minions controlled by
   *  the same Methuselah can play those cards". Locked is fine.
   *  docs/other-vampire-modifiers-design.md */
  | "byOtherVampire"
  /** As above, but "a ready UNLOCKED vampire" (Veil the Legions,
   *  Hedonism) — a vampire that has already acted this turn cannot. */
  | "byOtherUnlockedVampire"
  /** "Only one <card> can be played each action" — across every minion,
   *  which is stricter than the per-minion p. 10 limit (Veil the
   *  Legions). */
  | "oncePerAction"
  /** "Only one <card> can be played at superior each turn" — per seat,
   *  per turn, for the superior mode alone (Veil the Legions). */
  | "oncePerTurnAtSuperior"
  | "oncePerUnlockPhase"
  /** "Only usable by a … vampire" — allies cannot play it, even when no
   *  discipline requirement would stop them (Wake with Evening's
   *  Freshness, Forced Awakening). */
  | "byVampire"
  /** Combat card mode only usable at long range (No Trace basic). */
  | "onlyAtLongRange"
  /** "Only usable at close range" (Blood Fury, Blood Rage) — the mirror
   *  of the above. Worth stating even on a hand-strike card: such a card
   *  usually carries riders that would otherwise apply at long range. */
  | "onlyAtCloseRange"
  /** "Only usable if combat would end" — read at `combat.endOfRound`,
   *  where `willContinue` is already a finished fact, and excluding a
   *  combat that ended prematurely (p. 30). docs/round-end-design.md §1 */
  | "onlyIfCombatWouldEnd"
  /** "Only usable if both combatants are still ready." */
  | "onlyIfBothCombatantsReady"
  /** "+1 stealth, EVEN IF stealth is not yet needed" (Form of the Cobra)
   *  — overrides the p. 26 "only when needed" gate for this mode. */
  | "evenIfNotNeeded"
  /** "Only usable as the action is announced" (Dominant Personality
   *  superior). Modifiers are only ever offered in the action's effect
   *  windows, so this is read as "before any block attempt has begun" —
   *  state A with no attempt underway. */
  /** "Only usable AFTER ACTION RESOLUTION" (Freak Drive and family) —
   *  played in the post-resolution impulse. The acting minion need only
   *  still exist and be able to pay: p. 48 says Freak Drive is playable
   *  "even if the vampire is in torpor".
   *  docs/after-resolution-design.md §4 */
  | "afterResolutionByActor"
  /** "Only usable after resolution of a political action whose
   *  referendum PASSED" (Voter Captivation, Amici Noctis, Magnetic
   *  Authority) — played in the after-referendum impulse.
   *  docs/referendum-margin-design.md */
  | "afterReferendumPassed"
  /** "…if the action was successful" — with afterResolutionByActor. */
  | "ifActionSucceeded"
  /** "…if the action was blocked" (Freak Drive superior). */
  | "ifActionBlocked"
  /** "…of a successful DIRECTED action" (Shadow Cast). */
  | "ifActionDirected"
  /** "Only usable at the end of a successful action DIRECTED AT THE
   *  METHUSELAH WITH THE EDGE" (Esteem). The target Methuselah is the
   *  bleed's `target` or the controller of a targeted minion — the Edge
   *  belongs to a seat, and an action reaches a seat both ways.
   *  docs/the-edge-design.md §2 */
  | "targetHasTheEdge"
  /** "…if the bleed is successful (for 1 or more)" (Fever Pitch). */
  | "ifBleedSucceeded"
  | "onlyAsAnnounced"
  /** "Only usable by a ready vampire NOT INVOLVED in the combat" (Touch of
   *  Valeren superior). p. 28: minions controlled by ANY Methuselah can
   *  play such a card, so this is not restricted to a combatant's seat.
   *  docs/outside-combat-design.md */
  | "byOutsideVampire"
  /** As above, but "an UNLOCKED vampire not involved in the combat"
   *  (Martyr's Resilience). */
  | "byOutsideUnlockedVampire"
  /** "A vampire can play only one <card> at superior each combat"
   *  (Terror Frenzy) — a per-MODE limit, unlike `spec.combatLimit`, which
   *  is per card and would wrongly restrict the basic mode too. */
  | "oncePerCombatAtSuperior"
  /** "A vampire can play only one <card> at superior each ACTION" (Form
   *  of Mist) — the per-action sibling, read off `ActionFrame.played`,
   *  which records the mode for exactly this. */
  | "oncePerActionAtSuperior"
  /** Combat card mode not usable during the first round (Walk of Flame). */
  | "onlyAfterFirstRound"
  /** Combat card mode only usable during the first round (Terror Frenzy). */
  | "onlyFirstRound"
  /** "Only usable at the end of a round during which this vampire
   *  successfully INFLICTED MORE DAMAGE than the opposing vampire"
   *  (Disarm). Read off `CombatFrame.damageTakenThisRound`, which is
   *  incremented after prevention — so it already means "successfully
   *  inflicted". docs/combat-attachments-design.md §4 */
  | "onlyIfInflictedMoreThisRound"
  /** "Not usable by a vampire being burned or going to torpor" (Disarm).
   *  End of Round runs even when a combatant has just left the ready
   *  region (p. 32), so this case really arises. */
  | "byStillReadyCombatant";

export interface CardMode {
  level: DisciplineLevel;
  /** KRCG discipline abbreviation(s): a string or array = "any one of
   *  these" ("[cel] or [pre]"); `{ all: [...] }` = "requires all"
   *  ("[pot][pre]", Iron Glare); null = no requirement. */
  discipline: string | string[] | { all: string[] } | null;
  /** Distinguishes multiple printed variants at the same level ("Maneuver
   *  or press") — becomes part of the option id. */
  variant?: string;
  /** Additional timing clauses that apply to this mode only. */
  usable?: UsabilityRule[];
  /**
   * Which half of a dual-typed `modifierOrReaction` card this mode
   * belongs to. REQUIRED on such a card unless its modes are polling-only
   * (Scalpel Tongue, Ominous Chorus), because the compiler picks its
   * candidate minions before the per-mode loop and would otherwise treat
   * the whole card as a reaction — which is exactly how Form of the Bat's
   * modifier half turned out to be unreachable.
   * docs/blocker-riders-design.md §5
   */
  role?: "modifier" | "reaction";
  /** Retainers: this mode's starting life ("[ani] 1 life / [ANI] 2
   *  life") — the mode chosen at announcement fixes the version (p. 22). */
  retainerLife?: number;
  /** Extra statics this printed version adds on top of permanent.statics
   *  (Dread Mastiff superior's press). */
  statics?: PermanentStatics;
  /** Allies: this mode's stat overrides (Freakish Conglomeration's
   *  superior has 4 life). */
  ally?: { life?: number; strength?: number; bleed?: number };
  effects: EffectPrimitive[];
}

export interface CardSpec {
  /** Stable KRCG id — must match src/cards/registry.json. */
  krcgId: number;
  /** Handler key — must match the registry card name exactly. */
  name: string;
  cardType:
    | "actionModifier"
    | "reaction"
    /** Dual-use: playable as an action modifier (by the acting minion) or
     *  a reaction (by others) — Ominous Chorus. */
    | "modifierOrReaction"
    /** Dual-use: some modes are action modifiers, others are combat cards
     *  (Swallowed by the Night, Swift Cover) — each mode is dispatched to
     *  the compiler its effects belong to. */
    | "modifierOrCombat"
    /** Action/Combat (Touch of Valeren) — split by mode, each half handed
     *  to the compiler that owns its law. */
    | "actionOrCombat"
    | "action"
    | "combat"
    | "master"
    /** An EVENT: put into play with a DISCARD phase action, once each
     *  game (p. 37). Compiled as a master that lives in a different
     *  window. docs/events-design.md §1 */
    | "event"
    | "equipment"
    | "retainer"
    | "ally"
    | "politicalAction"
    /** A CRYPT card — a vampire. Never played from hand (it is influenced
     *  out of the uncontrolled region), so it has no cost, no modes and
     *  no play window. Its ability text rides into play as a
     *  SELF-ATTACHED ENTRY on the minion, exactly as an ally's does, which
     *  is what lets the whole `permanent` vocabulary apply to it
     *  unchanged (docs/crypt-plan.md §2). */
    | "crypt";
  bloodCost: number;
  /** Master cards burn pool when played; equipment at resolution. */
  poolCost?: number;
  /** Trifles refund one master phase action per phase (p. 10). */
  trifle?: boolean;
  /**
   * "More than one Discipline can be used to play this card" (Make the
   * Misere, Break the Bonds, The Platinum Protocol). Modes are normally
   * EXCLUSIVE — pick one — and these are ADDITIVE: the acting minion
   * applies every mode whose Discipline they have, plus every mode with
   * `discipline: null` (the card's unconditional clause).
   *
   * So enumeration emits no mode segment to choose — the actor's
   * Disciplines already decide, and offering a choice would offer a lie —
   * and the affordability and requirement gates run once, on the card.
   * docs/rush-outcome-design.md §6
   */
  multiDiscipline?: boolean;
  /** Combat cards: "a vampire can play only one X each round/combat". */
  combatLimit?: "round" | "combat";
  /** Unique: a seat may not voluntarily play a second copy (p. 17).
   *  Cross-player contests are not modeled yet (see CLAUDE.md gaps). */
  unique?: boolean;
  /** "The blocking minion's controller can burn 1 pool to cancel this
   *  card as it is played" (True Love's Face) — pay-to-cancel, the gate
   *  built for Golconda: Inner Peace. The payer is computed from the
   *  STATE at push time, not from the option's params, because "the
   *  blocking minion" is a fact about the live block attempt.
   *  The cost is NOT refunded: only a card that prints "its cost is not
   *  paid" (Sudden Reversal) refunds. docs/cheap-tail-design.md §6 */
  payToCancel?: {
    pool: number;
    /** `blocker` — the blocking minion's controller (True Love's Face).
     *  `opposingMinion` — the other combatant's controller, which is who
     *  "they" is on a combat card (Target Vitals). */
    who: "blocker" | "opposingMinion";
    /** The card currency: "discard two COMBAT cards to cancel this card
     *  as it is played" (Target Vitals). docs/round-end-design.md §3 */
    discardCombatCards?: number;
  };
  /** Masters/equipment/retainers that stay in play: their statics and
   *  tags. For allies this is the self-attached entry carrying the ally's
   *  own card text. */
  permanent?: {
    where: "seat" | "bearer";
    statics: PermanentStatics;
    tags?: string[];
    /** Clan/sect-locked location: "Lock to give a [clan/sect] minion you
     *  control +N stealth/intercept" (docs/clan-sect-design.md §4);
     *  "uncontrolledBlood" locks during the influence phase to add blood
     *  to an uncontrolled vampire of the clan (Arcane Library etc.). */
    lockGrant?: {
      grant:
        | "stealth"
        | "intercept"
        | "uncontrolledBlood"
        | "votes"
        /** "+1 bleed during that action" (Club Illusion). */
        | "bleed"
        /** "After action resolution, if that action was successful,
         *  unlock the acting minion" (Warsaw Station) — a rider, not a
         *  measurable bonus, so `amount` is ignored. */
        | "unlockOnSuccess";
      /** "…to give a Follower of Set you control +1 stealth, +1 intercept,
       *  OR +1 bleed" (Saatet-ta) — one lock, three answers, so the CHOICE
       *  is the option list rather than a frame. `grant` above stays the
       *  first of them, so no existing card moves.
       *  docs/mummies-design.md §2 */
      grants?: Array<"stealth" | "intercept" | "bleed">;
      amount: number;
      clan?: string;
      sect?: Sect;
      /** "…you control" vs any (Anarch Railroad). */
      ownOnly?: boolean;
      /** "During an undirected action, …" (Wall Street Night) — the
       *  intercept is only on offer against an undirected action (p. 25). */
      undirectedOnly?: boolean;
      /** Oxford University: "lock and burn X pool → +2X votes" — the
       *  amount is `amount` × X, enumerated over affordable X. */
      perPoolX?: boolean;
      /** Power Structure: "give each [clan] you control +N votes" — the
       *  granted total is `amount` × (# of your ready vampires of the
       *  clan/sect), rather than a flat `amount`. */
      perClanMinion?: boolean;
      /** "…a Ravnos with capacity 5 or more you control" (Kumpania).
       *  Read through capacityOf(), so a granted +1 capacity counts. */
      minCapacity?: number;
      /** "…each TITLED Camarilla vampire you control" (Elysium: The
       *  Palace of Versailles). docs/politics-locations-design.md §3 */
      titled?: boolean;
      /** "…you can burn N pool to get +M votes" (Ferraille) — a FIXED
       *  price, unlike `perPoolX`, which enumerates X. */
      poolCost?: number;
      /** "…with an ADDITIONAL +1 vote if the card named /Ventrue
       *  Headquarters/ is not in play" (The Mausoleum, Venice). "In play"
       *  is ANY Methuselah's, not just this card's controller.
       *
       *  The amount is now asked in two places — the option's label and
       *  the grant itself — so both go through one `voteAmount` helper.
       *  A label that disagrees with the grant is the exact drift CLAUDE.md
       *  warns about, and it would show up as a player being told "+2" and
       *  being given 1. */
      extraUnlessInPlay?: { card: string; amount: number };
      /** "ONCE EACH TURN, …" (Ferraille) — reads
       *  `PermanentInPlay.usedThisTurn`, cleared on TurnBegan. */
      oncePerTurn?: boolean;
      /** "Not usable during the first action in a minion phase"
       *  (Channel 10) — see docs/lock-grant-locations-design.md §2. */
      notFirstMinionAction?: boolean;
      /** "You can lock this card AND burn N pool to give a minion
       *  controlled by another Methuselah +X intercept" (KRCG News
       *  Radio): a second option off the same lock, for a blocker this
       *  card's controller does not control. */
      otherMethuselah?: { poolCost: number };
      /** "…even if stealth is not yet needed" (Creepshow Casino) —
       *  overrides the p. 26 gate, the same rule `evenIfNotNeeded`
       *  carries for a card in hand.
       *  docs/action-time-locations-design.md §2 */
      evenIfNotNeeded?: boolean;
      /** Fires "as the action is ANNOUNCED" (Creepshow Casino, Warsaw
       *  Station) rather than while a block attempt is live. Read, like
       *  `onlyAsAnnounced`, as state A with no attempt underway. */
      atAnnouncement?: boolean;
      /** "The chosen vampire CAN BURN 1 BLOOD to get +1 intercept" (The
       *  Rumor Mill), "an Anarch can burn 1 blood" (Club Illusion) — a
       *  cost paid by the RECIPIENT, not by this card's controller, and
       *  the reason they may decline. */
      recipientCost?: { blood: number };
      /** "Choose A VAMPIRE" (The Rumor Mill) — any Methuselah's, one
       *  option each, rather than the acting minion or the blocker. */
      anyVampire?: boolean;
      /** "Give A MINION +N intercept" (WMRH Talk Radio) — the blocker,
       *  but with no "you control", so any Methuselah's, and with no pool
       *  cost, unlike `otherMethuselah`. */
      anyController?: boolean;
      /** Club Illusion is a standing permission, not a lock: using it
       *  neither locks the card nor is limited by the card being locked. */
      noLock?: boolean;
      /** "Once as they announce a bleed action" (Club Illusion) — once
       *  per ACTION, tracked on the ActionFrame (§4). */
      oncePerAction?: boolean;
      /** "If that minion does not block the action, burn N pool after
       *  action resolution" (WMRH Talk Radio) — charged to this card's
       *  controller. */
      notBlockPoolPenalty?: number;
    };
    /**
     * "You can lock this location AFTER RESOLUTION OF A SUCCESSFUL ACTION
     * requiring Hecata or Oblivion [obl] to add 1 blood to a Hecata you
     * control" (Cappadocian Crypt).
     *
     * Its own clause rather than another `lockGrant` knob: `lockGrant`
     * grants a measurable bonus for an action in flight, and this fires
     * once the action is over and moves blood.
     * docs/blood-locations-design.md §5
     */
    afterActionBlood?: {
      amount: number;
      /** "add N blood to a \<clan\> you control" — the RECIPIENT. */
      clan?: string;
      /** "an action requiring \<clan\>" — read off the acting card's
       *  `CardHandler.requiresClans`. */
      requiresClan?: string[];
      /** "…or Oblivion [obl]" — `CardHandler.requiresDisciplines`. Either
       *  list matching is enough; the card says "or". */
      requiresDiscipline?: string[];
      /** "…of a SUCCESSFUL action". */
      successOnly?: boolean;
    };
    /**
     * "You can lock this card to CANCEL A FRENZY CARD as it is played on a
     * \<clan\> you control (cost is still paid)" (Meditative Grove) — an
     * in-play cancel, so the handler opts into the as-played window
     * (`abilityInAsPlayed`). docs/blood-locations-design.md §6
     */
    frenzyCancel?: { clan?: string };
    /**
     * "Once each turn, a Sabbat vampire can call a referendum to have
     * their controller gain 2 pool as a +1 stealth political action"
     * (Black Forest Base) — a granted POLITICAL action with an ordinary
     * payout, where `vulnerableTo.via: "politicalAction"` is specifically
     * a referendum to burn this card.
     * docs/politics-locations-design.md §5
     */
    politicalGrant?: {
      who?: { clan?: string; sect?: Sect; minCapacity?: number };
      stealth?: number;
      oncePerTurn?: boolean;
      /** What a passed referendum does. */
      effect: { gainPool: number };
    };
    /** Master that attaches to a chosen own vampire of this clan on play
     *  (Sight Beyond Sight), applying `statics` to the bearer. */
    attachClan?: string;
    /** Master put on ANY ready minion, including another Methuselah's
     *  (Pentex™ Subversion). The card stays controlled by the player who
     *  played it (p. 16), so its own clauses answer to them. */
    attachAnyMinion?: boolean;
    /** The general "put this card on <a minion>" targeting
     *  (docs/granted-rush-design.md §5) — `attachClan`/`attachAnyMinion`
     *  are the older sugar for two special cases of it. A card that lands
     *  on a minion its player does not control still answers to its
     *  player (p. 16). */
    attach?: {
      /** Whose minion: your own, your prey's, or any Methuselah's. */
      scope: "own" | "prey" | "any";
      kind?: "vampire" | "ally";
      clan?: string;
      sect?: Sect;
      /** "…on a ready vampire WHO FOLLOWS THE PATH OF \<x\>" (Terrifying
       *  Visage). A printed crypt trait, filtered exactly like clan and
       *  sect beside it (docs/path-cards-design.md §3). */
      path?: string;
      /** "…with capacity 8 or more" (Regent). */
      minCapacity?: number;
      /** "Cannot be put on a vampire with superior Celerity [CEL]" — the
       *  Discipline master cards have nothing to give a vampire already at
       *  superior in that Discipline. */
      notSuperiorDiscipline?: string;
    };
    /** "A vampire can have only one archetype" — at most one card
     *  carrying this key may sit on a given minion. */
    exclusiveKey?: string;
    /** "…they can equip with the FIRST equipment you find in your library
     *  as a +N stealth equip action" (Vast Wealth) — a granted action
     *  whose effect is a deterministic search (§4). */
    searchEquipGrant?: { stealth?: number; cardTypes: PlayCostCardType[] };
    /** Cards held OUT OF PLAY on this card (docs/library-search-design.md
     *  §5): Black Market Cache, Shilmulo Tarot, Fleshforge Chamber. */
    store?: {
      /** Face up (public) or face down (owner may look — p. 14). */
      faceUp: boolean;
      /** How the store is filled the moment the card enters play. */
      fillOnEntry?: {
        /** "Search your library for up to N …" vs "move the top N cards"
         *  vs "with any number of cards requiring Protean from YOUR HAND"
         *  (Gift of Proteus, Storage Annex). The hand fill is asked ONE
         *  CARD AT A TIME rather than as a subset: a subset choice over a
         *  hand is a power set of it (docs/store-plays-design.md §4). */
        from: "search" | "libraryTop" | "hand";
        /** "Up to four"; `"all"` is "any number" (Gift of Proteus). */
        count: number | "all";
        cardTypes?: PlayCostCardType[];
        nonUniqueOnly?: boolean;
        /** "…cards REQUIRING Protean [pro]" — the discipline a candidate
         *  must require in SOME mode, which is the printed requirement
         *  (a card requiring it only at superior still requires it). */
        requires?: string;
        /** "PUT a card from your hand face down on this card when you play
         *  it" (Storage Annex) — no "find nothing" answer. */
        mandatory?: boolean;
      };
      /** "If you would draw a card from your library, you can draw one of
       *  those cards instead." */
      redirectsDraw?: boolean;
      /** "…while this Ravnos is ready" — gates `redirectsDraw` only. */
      requiresReadyBearer?: boolean;
      /** "If this location has no cards on it, burn it." */
      burnWhenEmpty?: boolean;
      /** "During your unlock phase, you can move the top card of your
       *  library to this equipment." */
      addTopInUnlockPhase?: boolean;
      /** "During your master phase, you can put a <ghoul> from your hand
       *  on this location." */
      addFromHandInMasterPhase?: {
        cardTypes?: PlayCostCardType[];
        tags?: string[];
        /** "…IF IT DOESN'T ALREADY HAVE ONE" (Delivery Truck) — a store
         *  that holds at most this many. */
        max?: number;
        /** "…a NON-LOCATION equipment card" (Delivery Truck). The printed
         *  sub-types a candidate must NOT carry, the mirror of `tags`. */
        notTags?: string[];
      };
      /** "<Clan> you control can play cards from this location as if from
       *  your hand (requirements and cost apply as normal)."
       *
       *  "AS IF FROM YOUR HAND" is exactly that: the card is offered
       *  wherever the ordinary hand-play enumerator would offer it — in
       *  combat, in a reaction window, as an action — and not in one
       *  hand-picked window. `bearer` is "THIS Gangrel / THIS Follower of
       *  Set can play these cards", a store that only its own bearer may
       *  draw on. docs/store-plays-design.md §2 */
      playableFrom?: { clan?: string; bearer?: boolean };
      /** "During your master phase, you may EXCHANGE a card in your hand
       *  for the card on this Storage Annex" — a one-for-one swap, so the
       *  store never grows and never empties. */
      exchangeWithHandInMasterPhase?: boolean;
      /** "Lock this card to move a LIBRARY CARD FROM YOUR ASH HEAP (or
       *  your PREY's) to this card, face down" (Maabara, The Erciyes
       *  Fragments). The ash heap is public (p. 16), so the choice is a
       *  real one and the card names which heap.
       *  docs/ash-heap-resource-design.md §3 */
      addFromAshHeap?: {
        whose: "own" | "prey";
        /** "Only 1 card can be on this card at a time" (Erciyes). */
        max?: number;
      };
      /** "You may use a master phase action to move a card from this
       *  location to the TOP of your library" (Maabara) — the way back
       *  out, and the reason the store is worth filling. */
      toLibraryInMasterPhase?: "top" | "bottom";
      /** "When that card is burned, REMOVE IT FROM THE GAME instead"
       *  (Erciyes) — a card taken from a prey's ash heap never goes back
       *  into one. docs/ash-heap-resource-design.md §4 */
      removeFromGameWhenBurned?: boolean;
    };
    /** "Lock during your discard phase to move a card from your ash heap
     *  to the BOTTOM of your library" (Waste Management Operation) — the
     *  same family as `store.addFromAshHeap` with no store at all: the
     *  card goes straight back to the library. `window` is printed on the
     *  card and is not the master phase.
     *  docs/ash-heap-resource-design.md §3 */
    ashToLibrary?: { to: "top" | "bottom"; window: "discard" | "master" };
    /** "<Some Methuselah> burns N pool during their unlock phase" — the
     *  standing tax this whole family is built around
     *  (docs/pool-drain-design.md §3). */
    unlockDrain?: {
      /** Whose unlock phase fires it: anyone's, or the controller's prey. */
      whose: "any" | "prey";
      amount: number;
      /** What must hold for the drain to apply. Absent = unconditional. */
      when?:
        | { kind: "noReadySect"; sect: Sect }
        | { kind: "controlsNonSect"; sect: Sect }
        | { kind: "bearerInTorpor" };
      /** "…for EACH vampire in torpor they control" (Augury of Doom):
       *  charged once per matching vampire rather than once. */
      perTorporVampire?: boolean;
    };
    /** "For each counter on this card, that Methuselah burns 1 pool OR
     *  \<something else\>" — a toll of X units where the PAYER chooses how
     *  each unit is paid (docs/unlock-tolls-design.md §2).
     *
     *  The sibling of `unlockDrain`, which charges pool and asks nothing.
     *  Raised as a repeated, non-optional ChoiceFrame addressed to the
     *  Methuselah whose unlock phase it is. */
    unlockToll?: {
      /** Whose unlock phase pays it. */
      whose: "others" | "prey";
      /** The second way to pay one unit; pool is always the first.
       *  - `blood` — "burns 1 blood from a vampire they control"
       *  - `randomDiscard` — "cards at random from their hand"
       *  - `removeAshHeapCard` — "remove a library card at random in
       *    their ash heap from the game" */
      alternative: "blood" | "randomDiscard" | "removeAshHeapCard";
    };
    /** "During your unlock phase, add N counters to this card" — the
     *  unconditional accumulator (The Gate of Acheron, Constant
     *  Revolution). Powerbase: Madrid's capped, optional version is a
     *  different clause and stays bespoke (docs/unlock-tolls-design.md §3). */
    unlockCounter?: {
      amount: number;
      /** "MOVE 1 counter FROM YOUR POOL to this card" (Smiling Jack) — the
       *  counter is bought, not conjured. p. 50 rules it mandatory "even
       *  if it ousts you", so it is not gated on being able to afford it. */
      fromPool?: boolean;
    };
    /**
     * The Powerbases whose text is a BLOOD BANK on the table: blood sits
     * on the card, the controller draws it down a little each turn, and a
     * minion of another Methuselah can take the whole pile as a Ⓓ action
     * (docs/blood-banking-locations-design.md).
     *
     * The store is `PermanentInPlay.counters` — the Wasserschloss Anif
     * precedent. A blood on a card and a counter on a card are the same
     * physical counter (p. 5); nothing downstream needs to tell them
     * apart, and the raid clause (`vulnerableTo.outcome: "takeCounters"`)
     * reads the same field.
     */
    bloodStore?: {
      /** "Put 5 blood on this card when it is played" (Mexico City), or
       *  "put X blood on this card, where X is the capacity of a ready
       *  Sabbat vampire you control" (Barranquilla).
       *
       *  The second takes the LARGEST eligible vampire rather than raising
       *  a choice frame. That is not a shortcut: this card pays its
       *  controller 1 pool a turn and its counter-play BURNS it rather
       *  than stealing the blood, so more counters is strictly better in
       *  every line of play and the question has exactly one answer. A
       *  frame here would only ask it. */
      start?: number | { capacityOfReady: { sect?: Sect; clan?: string } };
      /** What the controller may do with the store, and in which window. */
      offers?: BloodStoreOffer[];
      /** "During each of your unlock phases, move N blood from this card
       *  to your pool" — no "may" (Powerbase: Mexico City). */
      unlockToPool?: number;
      /** "Burn this card if it has no blood" (Mexico City, Barranquilla)
       *  and "burn this card when the last blood counter on it is
       *  removed" (New York) are ONE rule here: the check runs after every
       *  CHANGE and never at put-in-play. That is what lets New York —
       *  which enters empty by design and is bought up later — survive its
       *  own first turn, without a second knob to get backwards. */
      burnWhenEmpty?: boolean;
    };
    /** "Lock this card and burn 1 pool OR 1 blood from a ready \<clan\>
     *  you control during your master phase to move a \<clan\> from
     *  torpor to THEIR CONTROLLER's ready region" (Chantry). Any
     *  Methuselah's, and they go home rather than to the location's
     *  controller. docs/crypt-and-uncontrolled-design.md §4 */
    torporRescue?: { clan: string };
    /** "You can use N transfers to \<draw from your crypt and remove an
     *  uncontrolled crypt card\>" and "…to burn this card and gain N
     *  pool" (Wider View). §2 */
    transferAbilities?: {
      cryptDraw?: { transfers: number };
      cashOut?: { transfers: number; gainPool: number };
      /** "Lock during your influence phase to get +1 transfer" (Ennoia's
       *  Theater) — the currency GAINED rather than spent, and the only
       *  thing in the pool that adds to it after the phase has opened.
       *  `burnEdge` is Mapatano Utando's price for four of them.
       *  docs/transfer-currency-design.md §2 */
      gain?: { transfers: number; lock?: boolean; burnEdge?: boolean };
      /** "ANY Methuselah can burn this card by burning N pool and spending
       *  M transfers during HIS OR HER influence phase" (Whispers of the
       *  Nictuku) — the counter-play to a card that taxes the table, paid
       *  in the payer's own currency on the payer's own turn. §4 */
      burnByAnySeat?: { transfers: number; poolCost: number };
      /** "A Methuselah may spend N transfers and remove a vampire in his or
       *  her uncontrolled region from the game to search for any card in
       *  his or her library and put it in his or her hand (discarding and
       *  shuffling afterward)" (Inconnu Tutelage). §5 */
      tutor?: { transfers: number };
    };
    /** "Lock to get +1 hand size this turn" (Ennoia's Theater) — a grant
     *  on the TURN frame, which is what makes it lapse after the discard
     *  phase rather than before it (docs/temporary-hand-size-design.md). */
    handSizeLock?: { amount: number };
    /** "If you control the Edge during your unlock phase, burn this card"
     *  (King's Rising) — a card that pays out and then leaves the moment
     *  its controller is doing well. §3 */
    burnWhenControllerHasEdgeAtUnlock?: boolean;
    /** "Reveal the top card of your crypt. If it is a \<clan\>, draw it
     *  and add N blood to it; otherwise, move it to the bottom of your
     *  crypt" (Family Gathering) — an instruction, not a choice. §1 */
    cryptPeek?: { clan: string; blood: number };
    /** "If a political action is successful, before the referendum, you
     *  can lock this location and a ready unlocked \<sect\> vampire you
     *  control to have that vampire enter combat with the acting
     *  vampire" (Yawp Court). §5 */
    preReferendumAmbush?: { sect: Sect; damageIfTargetReady: number };
    /** "During a bleed action, a \<clan\> you control can DISCARD A
     *  COMBAT CARD to get +N bleed" (Haqim's Law: Retribution) — a card
     *  in play selling a bleed bonus for a card from hand.
     *  docs/opposing-statics-design.md §4 */
    discardForBleed?: { amount: number; clan?: string; cardTypes: PlayCostCardType[] };
    /** "Lock this location and burn N pool during your unlock phase to
     *  exchange one card from your hand for one card in your ash heap
     *  requiring an Anarch" (Garibaldi-Meucci Museum). One option per
     *  (hand card, ash-heap card) pair: the card's own text makes it a
     *  single decision. docs/cheap-tail-design.md §1 */
    ashExchange?: { poolCost: number; requiresSect?: Sect[] };
    /** "Lock this location before range is determined to end a combat
     *  involving an \<X\> you control and another \<X\>" — the
     *  `endCombatFromOutside` path, from a card in play. */
    combatEndGrant?: {
      /** Garibaldi's form: BOTH combatants must be of this sect, and one
       *  of them must be yours. */
      sect?: Sect;
      /** Tommaso's form: one combatant is a minion you control carrying
       *  one of these printed sub-types. A LIST, because "a wraith OR
       *  zombie ally" is the union reading; the other side is
       *  unconstrained, the card naming only the ally.
       *  docs/crypt-wave-7.md §7 */
      ownMinionTags?: string[];
      /** Paid by the BEARER, in blood, instead of locking the card. */
      bloodCost?: number;
      oncePerTurn?: boolean;
      /** "If HE is ready" — Tommaso need not be in the combat at all, but
       *  he must not be in torpor. */
      requiresBearerReady?: boolean;
    };
    /** "The next time this vampire is about to successfully bleed the same
     *  Methuselah, burn this card and this vampire gets +N bleed" (Spying
     *  Mission). Fires from `onBlocksDeclined` — state C, where the bleed
     *  is known to be going through and no block can still be declared.
     *  MANDATORY (no "you can"), so it is not offered as an option.
     *  `sameSeat` reads `entry.againstSeat`, recorded when the card was
     *  put in play. docs/last-equipment-modifiers-design.md §6 */
    declinedBleedBonus?: { amount: number; sameSeat?: boolean; burnSelf?: boolean };
    /** "While in play, this card does not count as equipment" (Living
     *  Manse). Carried as a TAG rather than a flag, so it sits in the same
     *  vocabulary that already answers "is this a location, a vehicle, a
     *  ghoul" — and so the central "every equipment card is tagged
     *  `equipment`" backfill has one thing to test.
     *  docs/last-equipment-modifiers-design.md §1 */
    notEquipment?: boolean;
    /** Abilities an EQUIPMENT card's own text gives its bearer, keyed on
     *  the equipment entry the way `allyAbilities` is keyed on an ally's
     *  self-attached one. `permanent.lockGrant` is compiled inside
     *  `compileMaster` and cannot reach another card type, which is the
     *  recorded structural limit these work around.
     *  docs/last-equipment-modifiers-design.md §§2–4 */
    equipmentAbilities?: {
      /** "The bearer with superior \<D\> can burn N blood during an action
       *  to get an additional +M intercept" (Bowl of Convergence). Offered
       *  only while the bearer is attempting a block whose intercept still
       *  falls short (p. 26), which is what makes the absence of a printed
       *  limit harmless. */
      interceptForBlood?: {
        blood: number;
        amount: number;
        requiresDiscipline: string;
        level: "basic" | "superior";
      };
      /** "This vampire can burn N blood AND THIS CARD as they announce an
       *  action to make that action unblockable by \<who\>" (Flaming
       *  Candle) — the literal `action.announce` window. */
      announceUnblockable?: { blood: number; who: "vampires" | "allies" | "titled" };
      /** "They can burn this card before range is determined to end
       *  combat" (Living Manse). */
      burnToEndCombat?: boolean;
      /** "The vampire with this equipment MAY BURN IT to get +N intercept
       *  for the current action" (Changeling Skin Mask) —
       *  `interceptForBlood` with the CARD as the price instead of blood,
       *  and therefore no repeat: the card is gone. Offered on the same
       *  p. 26 terms, only while the bearer is the minion attempting the
       *  block and their intercept still falls short.
       *  docs/discipline-granting-equipment-design.md §2 */
      burnForIntercept?: number;
      /** "…may burn this card to PREVENT N POINTS OF DAMAGE in combat"
       *  (Blood Tears of Kephran). *"If fewer points of (preventable)
       *  damage are being resolved, then the effect prevents all of
       *  those points"* [RTR 20041202] and *"unused prevention points
       *  can't be carried over"* [ANK 20200318] — which is what
       *  `preventDamageFor` already does, so the ruling costs nothing.
       *  docs/burn-the-equipment-design.md §1 */
      burnToPrevent?: number;
      /** "…or to GAIN N BLOOD (ignore excess blood)" (Blood Tears of
       *  Kephran) — the second half of one "or", and the reason the price
       *  is a field of its own rather than part of either effect: one
       *  card, one card-shaped price, two unrelated windows.
       *  docs/burn-the-equipment-design.md §1 */
      burnForBlood?: number;
      /** "…can burn this card DURING YOUR MASTER PHASE to LOCK ANY
       *  VAMPIRE" (Mummy's Tongue). "Any" is the whole table, including
       *  your own; `skipNextUnlock` carries the second sentence.
       *  docs/burn-the-equipment-design.md §2 */
      burnToLockVampire?: { skipNextUnlock?: boolean };
      /** "…may burn this card to gain 1 level of ANY ONE DISCIPLINE until
       *  your next unlock phase. The vampire cannot choose a Discipline he
       *  or she already has AT THE SUPERIOR LEVEL" (Vial of Elder Vitae) —
       *  one option per Discipline in `DISCIPLINES`, minus the ones the
       *  bearer already maxes. docs/burn-the-equipment-design.md §3 */
      burnForDiscipline?: { levels: number; until: "nextUnlock" };
      /** "After resolving a successful action, this minion may LOCK THE
       *  HELICOPTER to UNLOCK" — the card is the price and the bearer is
       *  what it buys back. Offered in `action.afterResolution`, which is
       *  the only window that can say the action succeeded.
       *  docs/vehicles-and-havens-design.md §2 */
      lockToUnlockAfterSuccess?: boolean;
      /** "If the anarch with this card is ready, he or she can BURN 2
       *  BLOOD to cause an action DIRECTED AT HIM OR HER to fail" (Body
       *  Bag). `requiresSect` is on the ABILITY, not on the card: *"can be
       *  equipped by a non-Anarch and would still count as a haven,
       *  although the rest of his effect does not apply"* [LSJ 20030607] —
       *  "only usable by" is not "requires".
       *  docs/vehicles-and-havens-design.md §3 */
      burnBloodToFailAction?: { blood: number; requiresSect?: Sect };
    };
    /** Abilities a RETAINER's own card text gives its employer
     *  (docs/retainer-wave-design.md). Keyed on the retainer entry, the
     *  way `allyAbilities` is keyed on an ally's self-attached one. */
    /** "If a vampire SUCCESSFULLY HUNTS, move N blood from that vampire
     *  to this card after resolution. Burn this card if it has M blood"
     *  (Hunger Moon) — any vampire's hunt, not just the controller's.
     *  docs/events-design.md §2 */
    huntTax?: { blood: number; burnAt: number };
    retainerAbilities?: {
      /** "If this \<sect\> is blocked, they can burn N life from this
       *  retainer BEFORE BLOCK RESOLUTION to lock the blocking minion and
       *  continue the action as if unblocked" (Crypt's Sons, §2). */
      breakBlock?: { life: number };
      /** "You can LOCK this retainer to give the employer +N intercept"
       *  (Feral Hound). `permanent.lockGrant` is compiled inside the
       *  master compiler and never reaches a retainer. */
      lockForIntercept?: number;
      /** Feral Hound's "unlock this vampire" lives on
       *  `PermanentStatics.unlockEmployerAt` instead, because the two
       *  modes differ only in its timing and mode statics already merge
       *  into the entry (§3). This flag just turns the hook on. */
      unlockEmployer?: boolean;
      /** "The employer can LOCK this retainer to prevent N damage in
       *  combat" (Szlachta Bodyguard). */
      lockToPrevent?: number;
      /** "You can BURN this retainer to have an action directed at a
       *  minion you control FAIL" (Szlachta Bodyguard, §5). Not a block:
       *  the action fails, so no combat follows. */
      burnToFailAction?: boolean;
      /** "The employer can BURN this retainer to reduce the cost of \<a
       *  card\> they play by N blood or pool" (Szlachta Assistant, §4). */
      burnForDiscount?: { amount: number; mod: PlayCostMod };
      /** "The minion with this retainer may prevent N damage EACH COMBAT"
       *  (Resplendent Protector) — `lockToPrevent` without the lock, and
       *  once a combat rather than once a round. A separate field because
       *  the retainer is not spent either way: only the latch differs.
       *  docs/combat-retainers-design.md §3 */
      preventPerCombat?: number;
      /** "…can prevent 1 NON-AGGRAVATED damage each combat" (Nephren-Ka).
       *  Gates the option, so an aggravated blow simply does not offer it.
       *  docs/mummies-design.md §3 */
      preventNonAggOnly?: boolean;
      /** "Vampire with this retainer may BURN X BLOOD to get +X intercept
       *  for the current action" (Corpse Minion). Offered one point at a
       *  time and repeatable, which is *"may be used any number of times
       *  during a single action"* [TOM 19960109] — and the retainer is
       *  never spent, so there is no latch.
       *  docs/retainer-prices-design.md §1 */
      burnBloodForIntercept?: boolean;
      /** "The employer may LOCK this retainer to get +N stealth for the
       *  current action. If that action is BLOCKED, burn it" (Malajit
       *  Chandramouli). docs/retainer-prices-design.md §2 */
      lockForStealth?: { amount: number; burnIfBlocked?: boolean };
      /** "The employer can BURN N BLOOD to set the range for the round,
       *  before range is determined, during the FIRST round of combat"
       *  (Omael Kuman). docs/retainer-prices-design.md §3 */
      burnBloodToSetRange?: { blood: number };
      /** "When this vampire is BLOCKED, they may burn this retainer and
       *  UNLOCK INSTEAD OF ENTERING COMBAT" (Ghoul Escort). The block
       *  still succeeded and the action still fails; only the fight is
       *  skipped. docs/no-combat-design.md §2 */
      burnToAvoidCombat?: boolean;
      /** "If the vampire with this retainer is IN TORPOR, he or she gains
       *  N blood at the beginning of his or her minion phase" (Faithful
       *  Servant). Automatic — the card says "gains", not "you can".
       *  docs/retainer-upkeep-design.md §2 */
      torporBloodAtMinionPhase?: number;
      /** "During your unlock phase, \<this retainer\>'s employer burns N
       *  blood, OR \<the retainer\> is burned" (Robert Carter) — an
       *  upkeep, and a real choice only while the employer can afford it.
       *  docs/retainer-upkeep-design.md §3 */
      unlockUpkeep?: { blood: number };
      /** "During your minion phase, you may LOOK AT ONE CARD PICKED AT
       *  RANDOM from your prey's hand" (Fortune Teller). The look is the
       *  event (`CardsRevealed`), and the pick goes through
       *  `ops.randomIndex` so a replay sees the same card.
       *  docs/retainer-upkeep-design.md §4 */
      peekPreyRandomCard?: boolean;
    };
    /** "Once each combat, the bearer can prevent N damage from GUN
     *  strikes or M damage from any other source" (Kevlar Vest) — the
     *  first prevention that reads what dealt the damage.
     *  docs/last-combat-design.md §5 */
    preventByStrikeSource?: { fromGun: number; otherwise: number };
    /** "Once each combat, this Ravnos can strike: dodge" (Treasured
     *  Samadji) — equipment that grants a SPECIFIED strike without being
     *  a weapon. docs/weapon-riders-design.md §1, §7 */
    grantsStrikePerCombat?: {
      /** "Can strike: dodge" (Treasured Samadji, Flávio) or "can burn 1
       *  blood to strike: combat ends" (Agnieszka). */
      kind: "dodge" | "combatEnds";
      clan?: string;
      /** A price for the strike, paid by the striker when taken. */
      bloodCost?: number;
    };
    /** "Once each round of combat, \<this vampire\> can burn N blood to
     *  make the damage from their hand strikes aggravated that round"
     *  (Crossbreaker). Round-scoped, so it reuses the flag the combat
     *  cards set (docs/crypt-wave-3.md §3). */
    aggravatedForBlood?: { blood: number };
    /** "\<This vampire\> inflicts +N damage with RANGED strikes (even at
     *  close range)" (Noluthando). The parenthetical describes existing
     *  behaviour — a ranged strike already works at close range — so the
     *  only new thing is the bonus (docs/crypt-wave-3.md §4). */
    rangedDamageBonus?: number;
    /** "Once each combat involving \<a minion you control\>, \<this
     *  vampire\> can burn N blood to prevent up to M damage to that
     *  minion" (Opikun, Huldu). The bystander prevention built for
     *  Martyr's Resilience, as an ability of a card in play. */
    preventForOther?: {
      blood: number;
      amount: number;
      /** "…prevent up to 2 NON-AGGRAVATED damage" (Opikun). */
      nonAggravated?: boolean;
      /** Opikun says "a vampire you control"; Huldu "another minion you
       *  control". */
      kind?: "vampire" | "any";
    };
    /** "After a minion in combat with \<this vampire\> leaves the ready
     *  region, their controller burns N pool" (Egidia Arrú). */
    combatLeaveDrain?: number;
    /** "If \<this vampire\> is unlocked during your discard phase, lock
     *  them" (Roy) — a real drawback, and the price of his strength. */
    lockAtDiscardPhase?: boolean;
    /** "If the bearer is ready during your unlock phase, you can draw up
     *  to N cards without discarding and then move the same number of
     *  cards from your hand to the bottom of your library" (Heart of
     *  Nizchetus). docs/cheap-tail-design.md §5 */
    unlockDrawBury?: { max: number };
    /** Abilities an ALLY's own card text gives it, all keyed on the
     *  self-attached entry (docs/vozhd-allies-design.md §4). */
    allyAbilities?: {
      /** "This ally can prevent 1 damage each round of combat"
       *  (Gravesend) — War Ghoul's ability, as data. */
      preventPerRound?: number;
      /** "Once each combat, this ally can discard a card requiring
       *  Protean to prevent 2 damage" (Szczecin): the cost is a card in
       *  hand that requires one of these Disciplines. */
      preventByDiscard?: { amount: number; requiresDiscipline: string[] };
      /** "During your unlock phase, you can discard an \<ally or
       *  retainer\> card to add 2 life to this ally" (Sofia). */
      unlockDiscardForLife?: { life: number; cardTypes: PlayCostCardType[] };
      /** "During your unlock phase, this ally can steal any amount of
       *  blood (becoming life) from a \<clan\> you control, not to exceed
       *  its starting life" (Juiz de Fora). */
      unlockSiphon?: { clan: string; capped: boolean };
      /** "During any OTHER Methuselah's minion phase, a \<clan\> you
       *  control can burn 1 blood to unlock this ally" (Szczecin). */
      foreignPhaseUnlock?: { clan: string; blood: number };
      /** "During combat, this ally can burn 1 life to cancel a strike
       *  card as it is played by the OPPOSING minion, and its cost is not
       *  paid" (Gravesend, §5). */
      cancelOpposingStrikeCard?: { life: number };
      /** "Lock to add 1 life to an ally you control who has fewer life
       *  than its starting life" (Vagabond Mystic) — "starting life" is
       *  `capacityOf`, which an ally's `capacity` field holds. */
      lockToHealAlly?: { life: number };
      /** "Burn 1 life to give a minion you control 1 press"
       *  (Underbridge Stray). */
      burnLifeForPress?: {
        life: number;
        /** "During the FIRST ROUND of each combat" (Rotting Behemoth
         *  superior). Underbridge Stray's clause has no round limit. */
        firstRoundOnly?: boolean;
        /** "…THIS ALLY can burn 1 life to GET 1 press" — the press is for
         *  itself, where Underbridge Stray gives it to any minion you
         *  control. */
        selfOnly?: boolean;
      };
      /** "During an action directed at you (or a card you control), you
       *  can burn this ally IF IT IS NOT BLOCKING to unlock a ready
       *  minion you control" (Underbridge Stray) — the ally is spent
       *  instead of blocking, so the live block attempt's blocker is
       *  barred. docs/cheap-tail-design.md §3 */
      burnToUnlock?: boolean;
      /** "This ally can lock to give a Ravnos you control +1 stealth"
       *  (City Star Taxi) — `permanent.lockGrant`'s clause, but that one
       *  is compiled inside the MASTER compiler and never reaches an
       *  ally. Written here rather than moving 300 lines of working
       *  location code; the "only when needed" test (p. 26) is shared,
       *  so the two cannot drift on the rule that matters. */
      lockForStealth?: { amount: number; clan?: string; sect?: Sect };
      /** "Fiorella can lock to give ANOTHER wraith or zombie ally you
       *  control +1 stealth OR +1 intercept" — `lockForStealth` with two
       *  grants and a sub-type filter instead of a clan one. Generalizing
       *  it beats a third spelling of the same clause; `permanent.lockGrant`
       *  still cannot reach an ally, and ally is still only the SECOND card
       *  type to want it, so the 300-line lift is still not due.
       *  docs/wraith-zombie-design.md §4 */
      /** "You can BURN this ally to give a minion controlled by your
       *  predator or prey −N stealth" (Screamer). Stealth is
       *  action-scoped, so this is a negative `StealthModified` on the
       *  action that minion is taking — offered only while it can change
       *  whether a block succeeds, the mirror of p. 26. */
      burnForStealthPenalty?: { amount: number; whose: "predatorOrPrey" };
      /** "You can BURN this ally as an action directed at an ALLY you
       *  control is announced to have it FAIL" (Screamer). Not a block:
       *  the action fails, so no combat follows — the Szlachta Bodyguard
       *  clause, narrowed to allies. */
      burnToFailAction?: { targetKind: "ally" | "minion" };
      lockForGrant?: {
        amount: number;
        grants: Array<"stealth" | "intercept">;
        /** Who may receive it. `undeadAlly` = "another wraith or zombie
         *  ally you control"; the ally itself is never a legal target. */
        to: "undeadAlly";
      };
    };
    /** "\<who\> can add N counters to this card as a [+M stealth] action"
     *  — a granted action whose whole effect is an accumulator
     *  (docs/unlock-tolls-design.md §4). Dispatches on the `:counter:`
     *  verb segment. */
    counterGrant?: {
      who: { kind?: "vampire" | "ally"; clan?: string; sect?: Sect; minCapacity?: number };
      amount: number;
      stealth?: number;
    };
    /** "After a ready minion is burned or sent to torpor, their controller
     *  burns N pool" (Tension in the Ranks), "after THIS vampire goes to
     *  torpor…" (Fame). docs/pool-drain-design.md §4 */
    leaveReadyDrain?: {
      amount: number;
      /** Absent = either way; Fame names torpor alone. */
      how?: "burned" | "torpor";
      /** Fame: only when the leaver is this card's own bearer. */
      bearerOnly?: boolean;
    };
    /** When this card takes itself out of play (docs/pool-drain-design.md §5). */
    selfBurn?: {
      /** "After your prey is ousted, burn this card (and gain N pool)." */
      onPreyOusted?: { gainPool?: number };
      /** "If your prey controls no vampires in torpor, burn this card." */
      whenPreyHasNoTorpor?: boolean;
    };
    /** "Methuselahs can … during their master phase to burn this card" —
     *  the printed removal price, offered to EVERY Methuselah and only
     *  when they can pay it. docs/pool-drain-design.md §7 */
    masterPhaseBurn?: {
      /** "…use a master phase action and…" (Tension). Judgment does not. */
      usesMasterAction?: boolean;
      /** "…discard two master cards." */
      discardMasters?: number;
      /** "…burn a non-Camarilla vampire they control" — Camarilla is a
       *  SECT, not a clan. */
      burnOwnMinion?: { kind?: "vampire" | "ally"; notSect?: Sect };
    };
    /** "The action to equip with this vehicle is with an ADDITIONAL +1
     *  stealth" (Unlicensed Taxicab) — on top of the equip action's
     *  default +1 (p. 20). */
    extraEquipStealth?: number;
    /** "…to represent the unique Sabbat title of regent" — the bearer
     *  holds this title while the card is on them (§7). */
    grantsTitle?: VampireTitle;
    /** "<who> can enter combat with <target> as a [+N stealth] Ⓓ action"
     *  granted by this card in play (docs/granted-rush-design.md §3).
     *  The narrower `rush` field below is the ally/retainer shape. */
    rushGrant?: {
      /** The actor set, before the clan/sect filter. */
      who: {
        scope: "bearer" | "chosen" | "controller" | "any";
        kind?: "vampire" | "ally";
        /** A UNION when several clans are named: "any Tremere OR TREMERE
         *  ANTITRIBU" (Veneficorum Artum Sanguis). The second clan is not
         *  in the pool today, which is why writing the single string would
         *  have looked right — and been narrower than the card. */
        clan?: string | string[];
        sect?: Sect;
      };
      /** What they may enter combat with; "prey" is the *card
       *  controller's* prey, whoever is acting. */
      target: {
        scope: "bearer" | "prey" | "any";
        kind?: "vampire" | "ally";
        notClan?: string;
      };
      stealth?: number;
      /** "…if that vampire is Tremere, this is a +1 stealth action" —
       *  extra stealth decided by the target at announcement. */
      stealthByTarget?: Array<{ clan?: string; sect?: Sect; delta: number }>;
      /** "Vampires you control can BURN THIS CARD to attempt to enter
       *  combat with the attached minion" (Hunting the Quarry) — the
       *  grant spends the card that offers it.
       *  docs/round-end-design.md §5 */
      burnsCard?: boolean;
    };
    /** "This vampire can BLEED as a Ⓓ action that costs 1 blood" (Codex
     *  of the Edenic Groundskeepers) — the granted-action sibling of
     *  `rushGrant`, announced with `actionKind: "bleed"` so it follows
     *  every bleed rule (p. 23).
     *  docs/granted-bleed-and-target-costs-design.md §1 */
    bleedGrant?: {
      who: { scope: "bearer" | "controller"; clan?: string; sect?: Sect };
      stealth?: number;
      cost?: { blood?: number; pool?: number };
      /** "…gets +N bleed if the target Methuselah controls no ready
       *  unlocked minions" — evaluated at ANNOUNCEMENT (§1). */
      bonusIfTargetHasNoUnlocked?: number;
    };
    /** "Move 2 to 5 blood from that vampire to your pool" (Villein) — a
     *  variable amount chosen as the card is played, so the compiler
     *  emits one option per legal amount (`x=N`). */
    bloodToPool?: { min: number; max: number };
    /** Statics radiated onto other minions rather than the bearer
     *  ("Gangrel you control get +1 strength"). */
    aura?: PermanentAura;
    /** A card printing MORE THAN ONE aura clause with different filters
     *  ("Titled Brujah get +1 bleed and +1 vote. Ventrue get −1 vote" —
     *  New Carthage). Additive with `aura`.
     *  docs/politics-locations-design.md §2 */
    auras?: PermanentAura[];
    /** Counters here can pay another card's cost (Ravnos Carnival/Cache,
     *  docs/cost-sources-design.md). */
    costSource?: PermanentCostSource;
    /** Hunting ground: "during your unlock phase, a ready vampire you
     *  control can gain N blood; a vampire uses only one hunting ground per
     *  turn." Once per turn per location. `clan` limits eligible vampires. */
    /** "During your unlock phase, a ready \<who\> you control can gain N
     *  blood. A vampire can gain blood from only one hunting ground each
     *  turn" (p. 21). docs/blood-locations-design.md §3 */
    huntingGround?: {
      amount: number;
      clan?: string;
      /** "a ready ANARCH you control" (Carfax Abbey). */
      sect?: Sect;
      /** "a ready TITLED vampire" (Papillon) — any title, or specifically
       *  a city title (prince/baron/archbishop, §2). */
      title?: "any" | "city";
      /** "…and, if you control a ready baron, ANOTHER ready \<who\> you
       *  control can gain N blood as well" (Carfax Abbey): a second use of
       *  the same location this phase. The per-vampire limit still binds,
       *  so it necessarily goes to a different vampire. */
      extraIfControlsTitle?: VampireTitle[];
      /** "…or a WRAITH OR ZOMBIE ally you control can gain 1 LIFE, not to
       *  exceed its starting life" (Burial Site Hunting Ground). An ally
       *  holds life in the same field a vampire holds blood, and its
       *  printed starting life is what `capacityOf` returns, so the cap is
       *  the one every other "not to exceed" clause uses.
       *  docs/wraith-zombie-design.md §6 */
      undeadAllyLife?: number;
      /** "a ready vampire you control WHO FOLLOWS THE PATH OF \<x\>"
       *  (Burial Site Hunting Ground). Paths are out of scope per the
       *  scope lock, so this filter is recorded and correctly matches no
       *  vampire: `MinionState` has no path, and nothing sets one. Stated
       *  rather than omitted so the clause is visible to the next reader
       *  instead of looking like an oversight. */
      path?: string;
    };
    /** "After a ZOMBIE (ally or retainer) you control is burned, you can
     *  add 1 counter to this location" (Cursed Abattoir). Both halves are
     *  needed: an ally is a minion (`onLeaveReady`), a retainer is a card
     *  in play (`onLeavePlay`). Taken automatically — a counter on your
     *  own location is costless and purely beneficial, and this card has
     *  no clause that punishes holding them.
     *  docs/wraith-zombie-design.md §7 */
    counterOnUndeadBurned?: { tag: string; amount: number };
    /** "After a vampire who follows the Path of \<x\> you control BLEEDS,
     *  if the bleed is successful (for 1 or more), add 1 counter to this
     *  card; OTHERWISE, burn 1 counter from this card" (Forward Momentum).
     *
     *  Both directions are ONE clause on purpose. Splitting them across
     *  `onBleedSuccess` (add) and `onActionResolved` (burn) would put two
     *  separate definitions of "successful for 1 or more" in two files,
     *  and the day one drifted the card would add AND burn on the same
     *  bleed. A blocked bleed counts as unsuccessful (p. 27: it still
     *  resolves), and so does one reduced to 0.
     *  docs/path-cards-design.md §5 */
    pathBleedCounters?: { path: string; amount: number };
    /** "After a vampire who follows the Path of \<x\> you control PERFORMS
     *  AN ACTION, you can burn N counters from this card to unlock them"
     *  (Forward Momentum). Any action, successful or not — "performs" is
     *  not "successfully performs". Optional and costed, so it is offered
     *  rather than taken (the Cave of Apples direction). */
    pathUnlockForCounters?: { path: string; counters: number };
    /** "After a referendum called by a vampire you control PASSES, you can
     *  lock this card to burn N pool from your prey" (Privileged
     *  Position). Lives in the `referendum.afterResolution` window, which
     *  already opens only on a pass, so "passes" needs no test of its own.
     *  docs/path-cards-design.md §4 */
    afterReferendumBurn?: { amount: number; target: "prey" };
    /**
     * "\<This vampire\> can unlock after performing a successful action
     * …" and its family — the largest shape in the crypt
     * (docs/crypt-wave-2.md §2).
     *
     * Every field is one printed clause, and the defaults are the plain
     * reading: the bearer's own action, no cost, no limit, unlocking the
     * bearer. `whose: "other"` is the version where somebody else's
     * action wakes you (Aline) or where you wake THEM (Anja).
     */
    unlockAfterAction?: {
      /** Whose successful action triggers it. */
      whose: "self" | "other";
      /** For `whose: "other"` — the actor's sect or clan must match. */
      otherSect?: Sect;
      otherClan?: string;
      /** Who ends up unlocked: the bearer, or the minion who acted
       *  ("…to unlock that Hecata", Anja). */
      unlocks: "self" | "actor";
      /** "…can BURN 1 BLOOD to unlock" — paid by the bearer. */
      bloodCost?: number;
      /** "ONCE EACH TURN…" */
      oncePerTurn?: boolean;
      /** "DURING YOUR TURN…" (Sakura) — the bearer's controller's turn. */
      ownTurnOnly?: boolean;
      /** "…a successful POLITICAL action (even if the referendum
       *  failed)" (Aaradhya). A political action's own success is
       *  independent of how its referendum went. */
      actionKinds?: ActionKind[];
      actionCardTypes?: PlayCostCardType[];
      /** "…an action REQUIRING a Gangrel" / "requiring Hecata or
       *  Oblivion [obl]" — a property of the CARD played, answered by the
       *  `requiresClans`/`requiresDisciplines` central queries. */
      requiresClan?: string[];
      requiresDiscipline?: string[];
      /** "…requiring the Path of Death and the Soul" (Sakura). */
      requiresPath?: string;
    };
    /** "\<This vampire\> can search your library for a \<type\> card,
     *  reveal it and move it to your hand as a +N stealth action"
     *  (Dominica, Sakhar). The library-search gate's rules apply
     *  unchanged: you need not announce what you seek, FINDING NOTHING
     *  is always legal, and the library is shuffled either way (p. 14,
     *  p. 48). docs/crypt-wave-2.md §3 */
    searchToHand?: {
      cardTypes?: PlayCostCardType[];
      /** "a master ARCHETYPE card" — a printed sub-type, matched against
       *  the card's own tags. */
      tag?: string;
      stealth: number;
    };
    /** "\<This vampire\> can DISCARD a card requiring \<Discipline\> (or a
     *  \<type\> card, or a card AT RANDOM) to get \<bonus\>" — seven crypt
     *  cards, one clause. docs/crypt-wave-4.md §1
     *
     *  The cost and the payoff are independent: `requiresDiscipline` /
     *  `cardTypes` / `random` say which card leaves the hand, `grant` says
     *  what is bought, and `when` says in which window the trade is
     *  offered. The discarded card IS replaced (p. 7 does not care why a
     *  card left the hand — the unlock-tolls reading). */
    discardFor?: {
      /** Which card pays. `requiresDiscipline` reads the central
       *  `requiresDisciplines` query, `cardTypes` reads `costTypes`, and
       *  `random` takes the choice away from the player entirely. */
      requiresDiscipline?: string;
      cardTypes?: PlayCostCardType[];
      random?: boolean;
      /** "…can REMOVE SEVEN CARDS IN YOUR ASH HEAP FROM THE GAME to get
       *  an additional +1 bleed" (Marchesa Liliana) — the same trade with
       *  a different currency, which is what splitting cost from payoff
       *  bought. Removal, not a discard: p. 16 gives such a card no zone
       *  at all, so nothing can retrieve it. */
      fromAshHeap?: number;
      /** The window the trade is offered in.
       *  - `polling` — the polling step of ANY referendum (Alexa, Yewon).
       *  - `bleedAction` — during a bleed action (Larissa).
       *  - `anyAction` — during any action (Abraham).
       *  - `beforeRange` — before range in the bearer's own combat (Kasim).
       *  - `chooseStrike` — the bearer's strike choice (Phaibun).
       *  - `ownMinionCombat` — a combat involving a minion the bearer's
       *    controller controls, the bearer NOT needing to be in it
       *    (Roger). */
      when:
        | "polling"
        | "bleedAction"
        | "anyAction"
        | "beforeRange"
        | "chooseStrike"
        | "ownMinionCombat";
      /** What is bought. `interceptOrStealth` offers both, gated
       *  separately by p. 26's only-when-needed rule. */
      grant:
        | "votes"
        | "bleed"
        | "interceptOrStealth"
        | "combatStrength"
        | "dodge"
        | "maneuverToCombatant";
      amount: number;
      oncePerCombat?: boolean;
      oncePerTurn?: boolean;
    };
    /** "\<This vampire\> can \<do Y\> as a \[+N stealth\] \[Ⓓ\] action
     *  \[that costs 1 blood\]" — six crypt cards, one clause
     *  (docs/crypt-wave-5.md §1).
     *
     *  Every arm's effect is an op that already exists; what this clause
     *  supplies is the shared shape — enumerate one option per legal
     *  answer, fix it AT ANNOUNCEMENT (p. 25), pay at resolution (p. 27),
     *  and route back through `resolveGrantedAction` by effect key. The
     *  answer rides in the option id, so a blocked action costs nothing
     *  and changes nothing. */
    grantedAction?: {
      /** Which effect. Each is a different `resolveGrantedAction` arm.
       *  - `addBlood` — "add N blood or life to a minion you control"
       *    (Seraphina).
       *  - `stealEquipment` — "steal an equipment" (Saankaláxt).
       *  - `ashExchange` — "exchange a card from your hand for a library
       *    card in your ash heap" (Lenelle).
       *  - `reviveAlly` — "move an ally … from your ash heap to your
       *    ready region, LOCKED, with life equal to its starting life"
       *    (Hel-Blá).
       *  - `reorderTop` — "look at and reorder the top N cards of your
       *    library" (Eulogio).
       *  - `stripMinion` — "burn 1 corruption counter or a card requiring
       *    a Discipline from another ready minion" (Aniel). */
      do:
        | "addBlood"
        | "stealEquipment"
        | "ashExchange"
        | "reviveAlly"
        | "reorderTop"
        | "stripMinion"
        /** `burnSelfForBlood` — "this vampire can BURN THIS RETAINER to
         *  gain N blood" (Zombie). The cost is the card granting the
         *  action, which is why it is its own arm rather than `addBlood`
         *  with a price. */
        | "burnSelfForBlood"
        /** `burnPermanent` — "\<this ally\> may take a Ⓓ action to burn a
         *  LOCATION controlled by your prey" (The Bruisers), "…to burn an
         *  EQUIPMENT possessed by a minion controlled by your predator or
         *  prey" (Arcanum Investigator), "…burn a location as a +1
         *  stealth Ⓓ action that costs 1 pool" (Felix "Fix" Hessian).
         *  `what` and `scope` say which cards are legal targets.
         *  docs/destroyer-allies-design.md §1 */
        | "burnPermanent"
        /** `burnBlood` — "can burn 1 blood from a vampire as a +1 stealth
         *  Ⓓ action" (Thadius Zho). Another Methuselah's ready vampire
         *  with blood to burn; `amount` is how much, `steal` moves it to
         *  the actor as life instead (Gregory Winter's shape, unbuilt).
         *  docs/plain-allies-design.md §4 */
        | "burnBlood"
        /** `burnTorporVampire` — "can burn a vampire in torpor as a Ⓓ
         *  action" (ECTU Operative); `gainLife` for the shapes that feed
         *  on it. docs/plain-allies-design.md §4 */
        | "burnTorporVampire"
        /** `burnSelfAndBurnMinion` — "can burn HIMSELF and a \<clan\>
         *  \[with capacity N or less\] controlled by your prey as a Ⓓ
         *  action" (Akhenaten, Kherebutu). The price is the actor, so it
         *  is its own arm rather than a priced `burnPermanent`: both die,
         *  and the actor dies whether or not the target is still there.
         *  `targetClan`, `maxCapacity` and `scope` say who is legal.
         *  docs/mummies-design.md §4 */
        | "burnSelfAndBurnMinion";
      /** `burnSelfAndBurnMinion`: the clan the victim must be. */
      targetClan?: string;
      /** `burnBlood`: the blood becomes the actor's life. */
      steal?: boolean;
      /** `burnTorporVampire`: life the actor gains on success. */
      gainLife?: number;
      /** `stealEquipment`: "…from a vampire IN TORPOR" (Tutu). Gates the
       *  option. docs/mummies-design.md §5 */
      fromTorporOnly?: boolean;
      /** `burnPermanent`: which kind of card in play it destroys. */
      what?: "location" | "equipment";
      /** `burnPermanent`: whose cards are legal targets. Omitted = any
       *  other Methuselah's, the scope every `actionOnPermanent` action
       *  card already uses. Never your own: these are Ⓓ actions, and the
       *  convention is set by Arson, whose text is equally unqualified.
       *  docs/destroyer-allies-design.md §2 */
      scope?: "prey" | "predatorOrPrey";
      stealth?: number;
      bloodCost?: number;
      /** "…as a Ⓓ action THAT COSTS 1 POOL" (Felix). Pool, not blood: an
       *  ally's blood IS its life (p. 11), so charging this one in blood
       *  would make the card cost a third of the ally. */
      poolCost?: number;
      /** Ⓓ — directed at the target's controller, who alone may block
       *  (p. 25). Undirected otherwise, so anyone may. */
      directed?: boolean;
      /** Blood added (`addBlood`) or cards looked at (`reorderTop`). */
      amount?: number;
      /** `addBlood`: "…to a ready VAMPIRE you control" (Procurer), where
       *  Seraphina's arm says "minion" and reaches allies too.
       *  docs/plain-allies-design.md §2 */
      vampiresOnly?: boolean;
      /** "…NOT TO EXCEED STARTING LIFE" — `capacityOf` is the ceiling for
       *  vampires and allies alike, since an ally's `capacity` already
       *  holds its printed starting life. */
      capped?: boolean;
      /** Which card the ash heap may yield (`reviveAlly`): a UNION, the
       *  "Hecata OR Oblivion" reading. */
      requiresClan?: string[];
      requiresDiscipline?: string[];
      /** "…and UNLOCK" (Eulogio) — a real effect, since the actor locked
       *  at announcement (p. 25). */
      unlockActor?: boolean;
      /** `burnBlood`: "…from a LOCKED vampire" (Young Bloods). */
      lockedOnly?: boolean;
      /** `burnBlood`: "…with a capacity LESS THAN N" (Young Bloods).
       *  Exclusive, which is what the card prints; read through
       *  `capacityOf` so a granted +1 capacity counts. */
      maxCapacity?: number;
    };
    /** A SECOND (and third) granted action on the same card — "Gregory can
     *  steal 1 blood … as a +1 stealth Ⓓ action. He can burn a vampire in
     *  torpor to gain 2 life as a Ⓓ action." Each compiles independently
     *  and carries its index in the option params, so one grant's resolver
     *  never answers for another. `grantedAction` stays the first grant so
     *  no existing card moves. docs/plain-allies-design.md §5 */
    grantedActions?: Array<NonNullable<NonNullable<CardSpec["permanent"]>["grantedAction"]>>;
    /** "If \<this vampire\> is ready during your DISCARD phase, you can
     *  \<do Y\>" — a phase hook that asks its controller a question
     *  (Mora, Luciano). Optional, because both cards say "you can": an
     *  optional `ChoiceFrame`, whose decline is a plain pass.
     *  docs/crypt-wave-5.md §5 */
    discardPhaseChoice?: {
      /** `ashToLibraryBottom` — "move a library card from your ash heap
       *  to the BOTTOM of your library" (Mora). `moveAnimalRetainer` —
       *  "move an animal retainer from a vampire you control to another
       *  vampire you control" (Luciano). */
      do: "ashToLibraryBottom" | "moveAnimalRetainer";
      /** The printed sub-type the retainer must carry. */
      tag?: string;
    };
    /** "As a minion ANNOUNCES an action directed at \<this vampire\>,
     *  flip a coin; if it is tails, the action fails" (Evan Klein).
     *  Automatic — the card says "flip", not "you can flip".
     *  docs/crypt-wave-7.md §1 */
    coinFlipOnDirected?: { failOn: "tails" };
    /** "If \<this vampire\> is ready during your master phase, you can
     *  \<do Y\> AFTER PLAYING A MASTER CARD" (Nonu Dis). "After playing"
     *  needs no bookkeeping: the event log is the record of everything
     *  played (the Week of Nightmares lesson). docs/crypt-wave-7.md §3 */
    afterMasterPlayed?: { blood: number; clan: string };
    /** "During an action \<this vampire\> performs, you can REVEAL the top
     *  card of your library. If it is a \<type\> card, \<penalty\>;
     *  otherwise, \<bonus\>" (Gathii). docs/crypt-wave-7.md §4 */
    revealTopCard?: {
      ifTypes: PlayCostCardType[];
      thenBurnBlood: number;
      elseStealth: number;
    };
    /** "Once each turn, if \<this vampire\> is ready AFTER A SUCCESSFUL
     *  BLEED AGAINST YOU, she can look at the acting minion's
     *  controller's hand, then she can discard 1 card AT RANDOM from it"
     *  (Ilonka). docs/crypt-wave-7.md §5 */
    peekAndRandomDiscard?: boolean;
    /** "If the referendum of a political action called by \<this
     *  vampire\> is CANCELED OR FAILS, they go to torpor after
     *  resolution" (Cedrick Calhoun). Both outcomes, which the engine
     *  keeps apart on purpose — a cancelled referendum never resolves at
     *  all. docs/crypt-wave-6.md §3 */
    torporOnReferendumLoss?: boolean;
    /** "If \<this vampire\> is ready during YOUR unlock phase, your prey
     *  chooses a ready minion they control; the chosen minion takes N
     *  unpreventable damage" (Aemilius). The choice belongs to the PREY,
     *  which is what makes it a `ChoiceFrame` rather than an automatic
     *  effect — and it is MANDATORY, since the card says "chooses".
     *  docs/crypt-wave-5.md §5 */
    unlockPhaseDamage?: { amount: number; aggravated?: boolean };
    /** "If \<this vampire\> is ready at the start of your discard phase,
     *  you get +N discard phase actions" (Sreelekha). p. 37 grants one by
     *  default, and the hook fires after that default is set.
     *  docs/crypt-wave-4.md §4 */
    discardPhaseActions?: number;
    /** "During an action, \<this vampire\> can burn N blood to give an
     *  ally or younger vampire you control +M stealth" (Abderrahim). The
     *  bonus goes to the ACTING minion, so it is offered only when that
     *  minion is one of theirs and stealth is needed (p. 26). */
    stealthGrant?: {
      blood: number;
      amount: number;
      /** Who may receive it. `allies` and `younger` are a UNION — the
       *  English "an ally OR younger vampire" reading recorded in
       *  docs/opposing-statics-design.md. */
      who: { allies?: boolean; younger?: boolean };
    };
    /** "Once each turn, after resolution of an action performed by \<this
     *  vampire\> during which your prey burned 1 or more pool, you can
     *  gain N pool" (Věnceslava). "During which" is read off the event
     *  log for that action id — the record already exists, so there is
     *  nothing to bookkeep (the Week of Nightmares lesson). */
    actionPoolGain?: { amount: number; preyBurnedPool: boolean; oncePerTurn?: boolean };
    /** "After \<this vampire\> successfully bleeds (for 1 or more), you
     *  get +N hand size UNTIL YOUR NEXT DISCARD PHASE" (Fotini). A third
     *  duration beside the turn-frame and combat-frame grants: it lifts
     *  as the discard phase OPENS, before the hand is measured, which is
     *  what stops it being a free extra card at end of turn.
     *  docs/crypt-wave-6.md §5 */
    bleedSuccessHandSize?: { amount: number; preyOnly?: boolean };
    /** "After \<this vampire\> successfully bleeds your prey (for 1 or
     *  more), he can gain N blood" (Gostoso). Taken automatically:
     *  costless, purely beneficial and unpunished by anything on the card
     *  (the Cursed Abattoir reading), and `BloodGained` clamps at
     *  capacity so it can never hurt. docs/crypt-wave-4.md §3 */
    bleedSuccessBlood?: { amount: number; preyOnly?: boolean };
    /** "During your turn, you can BURN THE EDGE to unlock \<this
     *  vampire\>" (Kalinda). The Edge is a shared token, so this is a
     *  cost paid from the table rather than from a resource of yours. */
    unlockForEdge?: boolean;
    /** "You can unlock \<this vampire\> after a referendum called by them
     *  passes" (Sybren van Oosten). The `referendum.afterResolution`
     *  window, which already opens only on a PASS. */
    unlockAfterOwnReferendum?: boolean;
    /** "During a bleed action, you can burn 1 counter from this card to
     *  give a \<tagged\> ally you control +1 bleed" (Cursed Abattoir). Not
     *  "(limited)": p. 20's one-limited-bonus rule is about action
     *  MODIFIER cards, and this is an ability of a card in play (the Club
     *  Illusion precedent). */
    bleedForCounter?: { amount: number; tag: string };
    /** "Once each combat, you can burn 1 counter from this card to give a
     *  wraith or zombie ally you control 1 maneuver or press" (Dance of
     *  the Dead) — and "if this card has no counters, burn it". */
    combatGrantForCounter?: {
      grants: Array<"maneuver" | "press">;
      burnWhenEmpty?: boolean;
    };
    /** "During your unlock phase, you can burn 1 counter from this card.
     *  You can burn counters from no more than N \<card\>s each unlock
     *  phase. If this card has no counters, burn it and \<payoff\>"
     *  (Split the Veil) — a timer that pays out when it runs down.
     *  docs/wraith-zombie-design.md §5 */
    unlockCountdown?: {
      /** How many copies may be ticked in one unlock phase. */
      maxCardsPerPhase: number;
      /** What happens when the last counter goes. */
      payoff: "returnUndeadAllyFromAshHeap";
    };
    /** "They can burn N blood to burn this card" (Disarm) — the BEARER
     *  buying the card off. Not `vulnerableTo`, which costs a Ⓓ action
     *  and can be blocked: this costs only blood, and the card prints no
     *  timing restriction, so it is offered in the bearer's controller's
     *  own turn windows whenever they can pay.
     *  docs/combat-attachments-design.md §5 */
    bearerCanBurn?: { blood: number };
    /** "Minions can burn this card as a Ⓓ action" and its variants — the
     *  counter-play clause on ~25 cards (docs/granted-actions-design.md
     *  §4.5). Any Methuselah's minions may take it; it is directed at this
     *  card's controller, who alone may block. */
    vulnerableTo?: {
      /** Who may take it. Default: any minion, any Methuselah. */
      who?: {
        kind?: "vampire" | "ally";
        clan?: string;
        /** "Non-Ravnos minions", "Non-Ventrue minions". */
        notClan?: string;
        sect?: Sect;
        /** "Vampires with capacity 5 or more". */
        minCapacity?: number;
        /** "TITLED vampires can call a referendum to burn this card" (The
         *  New Inquisition) — any printed or card-granted title, which is
         *  the same `m.title` every other titled-vampire filter reads.
         *  docs/gehenna-unlock-design.md §5 */
        titled?: boolean;
        /** "Anarchs controlled by other Methuselahs" — excludes the
         *  card's own controller. */
        othersOnly?: boolean;
        /** "OTHER minions can burn this card" (Pentex™ Subversion) — the
         *  minion the card is attached to may not. */
        excludeBearer?: boolean;
        /** "THIS vampire can burn this card" (Haven Uncovered) — only the
         *  minion the card is attached to may. */
        bearerOnly?: boolean;
        /** A printed sub-type on the minion's own card ("CHANGELING
         *  allies", Black Forest Base) — matched against the tags of the
         *  entries attached to it, which for an ally is its own card text.
         *  The V5 pool has no changeling ally, so this correctly
         *  enumerates nothing today (docs/politics-locations-design.md §5). */
        tag?: string;
      };
      /** "as a +1 stealth Ⓓ action". */
      stealth?: number;
      /** "…that costs 1 blood / 2 pool" (paid at resolution, p. 27). */
      cost?: { pool?: number; blood?: number };
      /** Per-actor stealth riders: "Tremere get +1 stealth during that
       *  action"; "Nosferatu get −1 stealth during that action". */
      stealthFor?: Array<{ clan?: string; sect?: Sect; titled?: boolean; delta: number }>;
      /** What success does: burn the card (default), or move control of it
       *  to the acting minion's controller — "Vampires can steal this
       *  location as a Ⓓ action" (docs/control-change-design.md §6) — or
       *  strip its counters and leave it in play, "burn ALL THE COUNTERS
       *  from this card" (Powerbase: Madrid, docs/unlock-tolls-design.md
       *  §5) — or move every counter on it to the ACTING minion's
       *  controller's pool, "a vampire controlled by another Methuselah
       *  can move all the blood on this card to his or her controller's
       *  pool as a Ⓓ action" (the Powerbase raid,
       *  docs/blood-banking-locations-design.md §4). The raid is not
       *  `burnCounters`: the counters go somewhere. */
      outcome?: "burn" | "steal" | "shuffleIntoLibrary" | "burnCounters" | "takeCounters";
      /** "Vampires can call a REFERENDUM to burn this card as a +1 stealth
       *  political action" (Anarch Revolt, War of Ages) — the action is
       *  political and undirected, and the referendum decides, rather than
       *  success burning the card outright.
       *  docs/pool-drain-design.md §6 */
      via?: "politicalAction";
      /** "…; DURING THAT REFERENDUM, non-Anarch titles are worth -1 vote"
       *  (Fee Stake) — a rider on the referendum the card's own burn
       *  action calls, seeded in `referendumSetup`, which is the one hook
       *  that fires as a referendum opens. docs/fee-stake-design.md §3 */
      refVoteModifier?: { amount: number; titledOnly?: boolean; notSect?: Sect };
      /** "…if that action is successful, this Anarch is LOCKED and does
       *  not unlock as normal during their next unlock phase" (Stolen
       *  Police Cruiser) — a rider on the bearer, on top of the burn.
       *  `MinionState.skipNextUnlock` was built for Toreador Grand Ball
       *  and has been waiting for this. docs/opposing-statics-design.md §2 */
      bearerPenalty?: { lock?: boolean; skipNextUnlock?: boolean };
      /** "…as a Ⓓ action that INFLICTS 1 unpreventable environmental
       *  damage on acting vampires" (the four Path masters). A price on
       *  the ACTOR for taking the burn, not on the card's bearer — the
       *  mirror of `bearerPenalty`. Queued through `damageAfterAction`,
       *  the Daring the Dawn path, so it lands after the action resolves
       *  and cannot be prevented. */
      actorDamage?: { amount: number; aggravated?: boolean };
    };
  };
  /** Ally cards: printed stats — enters play with `life` from the blood
   *  bank (p. 22). docs/vozhd-allies-design.md for the rest. */
  ally?: {
    life: number;
    strength: number;
    bleed: number;
    /** "After this ally enters play, burn an ally or retainer you
     *  control" (the four Vozhd; War Ghoul prints it too and hand-rolls
     *  it). The victim is chosen at ANNOUNCEMENT and rides in the option
     *  id; `self` — the entering ally — is a legal choice, since the
     *  clause names a set the newcomer belongs to (§1). */
    enterPlayBurn?: { kinds: Array<"ally" | "retainer">; allowSelf?: boolean };
    /** "After this ally enters play, BURN IT UNLESS you remove an ally or
     *  vampire in your ash heap from the game" (Rotting Behemoth) — an
     *  entry cost paid out of the ash heap, asked the moment it arrives.
     *
     *  **Burnt vampires are deliberately not modelled in the ash heap**
     *  (docs/ash-heap-design.md), so the "vampire" half correctly matches
     *  nothing today and the ally half plays; when phase 7 puts crypt
     *  cards there, this card gains the other half for free.
     *  docs/wraith-zombie-design.md §6 */
    enterPlayAshCost?: {
      cardTypes: PlayCostCardType[];
      /** "…remove an ally OR VAMPIRE in your ash heap from the game"
       *  (Rotting Behemoth). A burnt vampire's card has no handler, so it
       *  answers no printed type and has to be admitted explicitly
       *  (docs/ledger-closeout.md §9). */
      includeCrypt?: boolean;
    };
    /** "Unlock this vampire if this is their FIRST successful recruit ally
     *  action this turn" (Spectral Servitor). "First this turn" is a
     *  question the event log already answers — no counter is stored.
     *  docs/wraith-zombie-design.md §7 */
    unlockRecruiterOnFirst?: boolean;
    /** "It can strike: 3R damage" — a strike printed on the MINION, not
     *  on a weapon. Compiled through the same `chooseWeaponStrike` path,
     *  minus the "cannot use equipment" restriction: an ally's own body
     *  is not equipment (§2). */
    strike?: { damage: number; ranged: boolean; aggravated?: boolean };
    /** "This ally can play cards requiring basic Animalism as a vampire
     *  with capacity 5" (p. 11 defines the whole rule; §3). The listed
     *  Disciplines go onto the ally's `MinionState.disciplines`, which is
     *  all the enumerators read — they ask `disciplinesOf`, never
     *  `m.kind`. */
    playsAsVampire?: Record<string, DisciplineLevel>;
    /** The printed sub-type — "Wraith with 1 life", "Zombie with 2 life".
     *  Sugar that puts the word in `permanent.tags`, so a card cannot
     *  declare its sub-type in one place and be filtered in another. The
     *  word carries no rules of its own: it appears nowhere in the
     *  rulebook, exactly like "ghoul". docs/wraith-zombie-design.md §§1–2 */
    subtype?: "wraith" | "zombie" | "ghoul" | "mortal";
    /** "This ally cannot have or use equipment (or retainers)" (Bone
     *  Shambler, Gravebound Drone) — a gate on OPTIONS: the ally is not
     *  offered as a bearer. */
    cannotEquip?: { retainers?: boolean };
    /** "This ally cannot gain life" (Rotting Behemoth). Read where life is
     *  ADDED, so burning and paying still work normally. */
    cannotGainLife?: boolean;
    /** "This ally can perform actions the turn it is recruited" (Spectral
     *  Servitor) — the exemption from p. 22, which `cannotActThisTurn`
     *  otherwise sets from `recruited`. */
    actsWhenRecruited?: boolean;
    /** "If a vampire controlled by ANOTHER Methuselah burns \<this ally\>
     *  in combat or as an action, he or she gains N blood" (Young Bloods).
     *  The burner is DERIVED at the moment the ally leaves the ready
     *  region — the other combatant, or the acting minion of an action
     *  aimed at it — rather than plumbed through every burn path.
     *  docs/plain-allies-design.md §5 */
    burnBounty?: { blood: number };
    /** "If \<this ally\> is burned, shuffle him into his owner's library"
     *  (Amam and the other mummies). Fired before the burn, so the entry
     *  leaves play through `shuffleIntoLibrary` instead of the ash heap.
     *  docs/plain-allies-design.md §5 */
    shuffleIntoLibraryOnBurn?: boolean;
    /** "If a minion OPPOSING \<this ally\> in combat is burned, \<the
     *  ally\> can gain N life" (Amam). Optional — the card says "can" —
     *  and capped at starting life like every other life gain. */
    opposingBurnedGainLife?: number;
  };
  /** Weapon equipment (docs/weapons-design.md): a strike it provides —
   *  fixed `damage` (gun) or strength-based (`damage: null, handBonus`);
   *  optionally aggravated / with a per-combat maneuver. */
  weapon?: {
    damage: number | null;
    handBonus?: number;
    ranged: boolean;
    aggravated: boolean;
    maneuverPerCombat?: boolean;
    /** "…with TWO optional maneuvers each combat" (Deer Rifle). The
     *  counted form of the flag above; 1 and the flag mean the same.
     *  docs/conditional-weapons-design.md §1 */
    maneuversPerCombat?: number;
    /** "…only usable to get to CLOSE RANGE" (Blade of Bellona) — offered
     *  only while the range is long, which is the only state the maneuver
     *  could change to close. docs/conditional-weapons-design.md §1 */
    maneuverToCloseOnly?: boolean;
    /** "Only usable AFTER THE FIRST ROUND of combat" (RPG Launcher) — a
     *  gate on the strike option, beside the range gates.
     *  docs/conditional-weapons-design.md §2 */
    notFirstRound?: boolean;
    /** "Strike: 2R damage, ONLY USABLE AT LONG RANGE" (Sniper Rifle) — a
     *  gate on options, so a close round simply does not list it.
     *  docs/weapon-riders-design.md §3 */
    onlyAtLongRange?: boolean;
    /** "…only usable once each COMBAT" (Chainsaw, Sawed-Off Shotgun,
     *  Brass Knuckles, Gas-Powered Chainsaw) or "once each ROUND" (Combat
     *  Shotgun, Mark V).
     *
     *  Keyed on the CARD INSTANCE, which is what the ruling asks for:
     *  *"a second copy allows a second use in the same combat"*
     *  [ANK 20230316]. A bearer holding two Chainsaws gets two strikes;
     *  keying it to the bearer would silently take one away. Note this is
     *  the opposite of `spec.combatLimit`, which is per combat FRAME —
     *  see the known-deviations list in CLAUDE.md. */
    usableOnce?: "combat" | "round";
    /** "After the bearer strikes with this gun, they get 1 optional
     *  additional strike (limited), ONLY USABLE TO STRIKE WITH THIS GUN,
     *  this round" (AK-47). The restriction is the .44 ruling's
     *  `committedStrike`. docs/weapon-riders-design.md §2 */
    additionalStrikeSelf?: boolean;
    /** "1 optional press, ONLY USABLE TO CONTINUE COMBAT, each combat"
     *  (Righteous Blade). docs/weapon-riders-design.md §4 */
    continuePressPerCombat?: number;
    /** "If the bearer BLOCKS, they can, before range is determined, set
     *  the range for the first round of the resulting combat to long, and
     *  their initial strike that round must be with this weapon"
     *  (Sniper Rifle). docs/weapon-riders-design.md §3 */
    blockSetsLongRange?: boolean;
    /** "Once each combat, the bearer can burn N blood to cancel a
     *  \<keyword\> card as it is played by the opposing minion, and its
     *  cost is not paid" (Sword of the Archangel). The V5 pool's only two
     *  keyword cards are unsupported, so this correctly matches nothing
     *  today. docs/weapon-riders-design.md §5 */
    cancelKeywordCard?: { blood: number; keywords: string[] };
    /** "Once each turn, if the opposing vampire is burned during this
     *  weapon's strike resolution and the bearer remains ready, the
     *  bearer can unlock at the end of combat" (Sword of the Archangel).
     *  docs/weapon-riders-design.md §6 */
    unlockOnKill?: boolean;
    /** "BURN AFTER USE" (Grenade, Smoke Grenade, White Phosphorus
     *  Grenade, Waxen Poetica) — the weapon is burned when its strike
     *  RESOLVES, not when it is chosen. The rulings are emphatic that
     *  these are different moments: *"does not burn if combat ends
     *  before it resolves"* [LSJ 19981006] [LSJ 20001127-2].
     *  docs/one-shot-weapons-design.md §1 */
    burnAfterUse?: boolean;
    /** "If \<this\> is used at CLOSE RANGE, the minion with this weapon
     *  takes N damage" (Grenade 1, White Phosphorus Grenade 1
     *  aggravated). Environmental damage [LSJ 19970801] — source null,
     *  so no one inflicted it. docs/one-shot-weapons-design.md §2 */
    selfDamageAtCloseRange?: { amount: number; aggravated?: boolean };
    /** "END COMBAT as a strike" (Smoke Grenade) — a strike that ends
     *  combat instead of dealing damage (p. 33). `damage` is ignored.
     *  docs/one-shot-weapons-design.md §3 */
    combatEndsStrike?: boolean;
    /** "NOT USABLE AGAINST a vampire with Celerity, an ally, or a
     *  retainer" (Waxen Poetica) — a gate on the option, read from the
     *  OPPOSING minion. docs/one-shot-weapons-design.md §4 */
    notUsableAgainst?: { disciplines?: string[]; allies?: boolean };
    /** "Bearer takes N damage during strike resolution when striking with
     *  this gun, but only ONCE EACH COMBAT" (Zip Gun). The close-range
     *  sibling above is `selfDamageAtCloseRange`; this one fires at any
     *  range, which is why it is a second field rather than a flag on the
     *  first — the two cards' gates have nothing in common.
     *  Environmental, like every other bearer self-damage
     *  [LSJ 19970801]. docs/armed-mid-combat-design.md §3 */
    selfDamageOnStrike?: { amount: number; aggravated?: boolean; oncePerCombat?: boolean };
    /** "Burn after use OR AT THE END OF COMBAT" (Molotov Cocktail) — the
     *  second half of a one-shot weapon that is a combat card, and so has
     *  no business surviving the fight it was played in.
     *  docs/armed-mid-combat-design.md §2 */
    burnAtEndOfCombat?: boolean;
    /** "…NOT USABLE THE ROUND IT IS PUT IN PLAY" (Molotov Cocktail). Read
     *  against `entry.attachedRound`, which the engine records when a
     *  card enters play during a combat — `notFirstRound` is a different
     *  question (the combat's first round, not the card's).
     *  docs/armed-mid-combat-design.md §2 */
    notUsableAttachRound?: boolean;
  };
  /** Printed KEYWORDS — a line above the card text, like "Grapple." or
   *  "Aim.", which are neither card types nor Disciplines. Answered
   *  centrally by `compileSpec` and denormalized onto `CardPlayFrame`, so
   *  a card that filters on one never reads another card's spec.
   *  docs/weapon-riders-design.md §5 */
  keywords?: string[];
  /** "Can enter combat with a minion/vampire as a Ⓓ action" granted by
   *  this card in play — to the ally itself, or to the employer for
   *  retainers (Twisted Bloodhound). */
  /** An ally that can enter combat as a Ⓓ action of its own (the Vozhd,
   *  Rotting Behemoth). `cost` is "…as a Ⓓ action that COSTS 1 LIFE": an
   *  ally's life is its blood field (p. 11), so it is an ordinary blood
   *  cost, paid at resolution and only on success (p. 27).
   *  docs/wraith-zombie-design.md §4 */
  rush?: {
    targets: "minion" | "vampire";
    cost?: { blood?: number; pool?: number };
    /** "…can enter combat with a LOCKED vampire" (Nathaniel Bordruff).
     *  `enumerateRushTargets` has always understood this; no crypt card
     *  had asked for it (docs/crypt-wave-2.md §1). */
    lockedOnly?: boolean;
    /** "…may enter combat with a ready vampire CONTROLLED BY ANOTHER
     *  METHUSELAH as a Ⓓ action" (Muddled Vampire Hunter). War Ghoul's
     *  rush is unqualified and reaches its own controller's vampires;
     *  this one may not. docs/plain-allies-design.md §2 */
    othersOnly?: boolean;
  };
  /** "Requires a prince or justicar" — the acting vampire's title must be
   *  one of these (p. 28 titles). */
  requiresTitle?: VampireTitle[];
  /** "Requires a TITLED Camarilla vampire" — any title at all, which is
   *  a different question from the named list above.
   *  docs/referendum-terms-design.md */
  requiresTitled?: boolean;
  /** "Requires a NON-STERILE \<x\>" (Waters of Duat, Childe of the
   *  Revolution). "Sterile vampires cannot perform actions to put new
   *  vampires in play" (glossary, p. 42) — a real rulebook trait that no
   *  V5 card grants, so this correctly passes every vampire today.
   *  docs/token-vampire-design.md §4 */
  requiresNonSterile?: boolean;
  /** "Requires an Anarch" / "…a Sabbat vampire" — the playing vampire's
   *  sect must be one of these. */
  requiresSect?: Sect[];
  /** "Requires a Ravnos" etc. — the playing vampire's clan. */
  requiresClan?: string[];
  /** "Only usable by a … minion WITH A GUN" (Suppressing Fire) — the
   *  playing minion must carry a card in play with one of these tags.
   *  Not a discipline, not a clan: a piece of equipment.
   *  docs/second-minion-modifiers-design.md §1 */
  requiresAttachedTag?: string[];
  /** A condition on the ACTING minion, which is a different question from
   *  every `requires*` above: those gate who may PLAY the card, this gates
   *  who the card may be played AGAINST. "Only usable if a Camarilla or
   *  Sabbat vampire is bleeding you" (Banner of Neutrality), "…if a
   *  Camarilla vampire is acting" (Venetian Conference), "NOT usable if
   *  the acting minion is an Assamite or wraith or has flight" (Nest of
   *  Eagles). Every field is ANDed; a list inside one field is an OR.
   *  docs/acting-minion-reactions-design.md §1 */
  requiresActing?: {
    /** The acting minion must be a vampire of one of these sects. */
    sects?: Sect[];
    /** "…a VAMPIRE is bleeding you" — an ally acting fails the clause. */
    vampire?: boolean;
    /** Clans the acting minion must NOT be. Use the name the REGISTRY
     *  uses: "Assamite" is printed, and the pool calls that clan Banu
     *  Haqim (the CLAUDE.md lesson about clan names, which has cost this
     *  project a filter that matched nothing before). */
    notClans?: string[];
    /** "…or a WRAITH" — read with `isUndeadAlly`, which is the engine's
     *  one answer to that question. */
    notUndeadAlly?: boolean;
    /** "…or has FLIGHT" — a printed advantage. No minion in the pool has
     *  it today, so this correctly excludes nobody; it is here because
     *  the card prints it and a clause that is not built is not built. */
    notTags?: string[];
  };
  /** "…with capacity N or more". */
  requiresCapacity?: number;
  /** "Requires a (ready) VAMPIRE" (Surprise Influence, Sense the Savage
   *  Way, Ghoul Escort) — the playing or employing minion must be a
   *  vampire, not an ally. Read by `meetsRequirements`. */
  requiresVampire?: boolean;
  /** The printed BURN OPTION icon (p. 17): "a Methuselah who does not
   *  control a minion who meets the requirements of this card or who is a
   *  legal target for it, may discard it during ANY Methuselah's unlock
   *  phase and replace it. Each Methuselah is limited to one such discard
   *  each unlock phase." Compiled into `burnOptionDiscardable`, which
   *  reads the spec's own requirement and attach filters.
   *  docs/burn-option-design.md */
  burnOption?: boolean;
  /** "Requires a prince, justicar or Inner Circle member" on a polling-step
   *  modifier — the *controller* must have a ready vampire with one of these
   *  titles (Closed Session, Private Audience), not the calling vampire. */
  /** "Requires 2 OR MORE ready vampires who follow the Path of \<x\>"
   *  (Privileged Position). The only counting requirement in the pool: its
   *  three siblings ask whether SOME ready vampire matches, which one
   *  `.some()` answers, and a count cannot be expressed that way.
   *  docs/path-cards-design.md §4 */
  requiresControlledPath?: { path: string; count: number };
  requiresControlledTitle?: VampireTitle[];
  /** "Requires a ready Anarch" / "…a ready Sabbat vampire" on a MASTER
   *  card — a condition on the Methuselah, not on any acting minion: you
   *  must control a ready vampire of this sect to play it. The sibling of
   *  requiresControlledTitle (docs/lock-grant-locations-design.md §6). */
  requiresControlledSect?: Sect[];
  /** "Requires a ready [clan]" on a Master card — the clan sibling. */
  requiresControlledClan?: string[];
  usable: UsabilityRule[];
  /** "If this referendum FAILS, the acting vampire burns 1 blood" (The
   *  Final Nights) — the other half of a referendum, and the first card
   *  in the pool to have one.
   *
   *  It cannot ride on `applyReferendum`, which by contract is never
   *  called for a failure, and it cannot ride on `onReferendumLost`,
   *  which iterates cards IN PLAY — the calling card is in the ash heap
   *  by then. It needs its own hook, `applyReferendumFailed`.
   *
   *  A CANCELLED referendum is not a failed one (docs/abstain-gate-design.md):
   *  it never resolves, so this never fires for it, which is what "if this
   *  referendum fails" says. */
  referendumFail?: {
    callingVampireBurnsBlood?: number;
    /** "If the referendum fails, this acting vampire takes N UNPREVENTABLE
     *  damage" (Rant!) — the same hook, a different currency.
     *  docs/referendum-blood-design.md §3 */
    callingVampireDamage?: number;
  };
  /** Frenzy keyword (p. 32): marks the card so frenzy-referencing effects
   *  (cancel/immunity) can find it. Adds a "frenzy" tag to the handler. */
  frenzy?: boolean;
  /** "Do not replace until …" — defers the replacement draw.
   *  `whileInPlay` is "do not replace AS LONG AS THIS CARD IS IN PLAY"
   *  (Dragonbound): the draw comes when the card leaves play, however it
   *  leaves. docs/gehenna-events-design.md §3 */
  /** "ONLY ONE <card> MAY BE PLAYED EACH TURN" (Instability) — by NAME
   *  and across the whole table, which is what the printed line means:
   *  the turn is the scope, not the seat. Recorded on the turn frame as
   *  the card resolves. docs/the-edge-design.md §4 */
  oncePerTurnByName?: boolean;
  /** "Only one \<card\> can be played or called in a GAME" (Political
   *  Stranglehold) — `oncePerTurnByName` with no reset, so it is a QUERY
   *  over the event log rather than a latch anywhere: a `CardPlayed` with
   *  this name, ever, bars it. Nothing to clear at a phase boundary and
   *  nothing to forget to serialize.
   *  docs/table-pool-swings-design.md §4 */
  oncePerGameByName?: boolean;
  /** "Only usable if your prey controls the Edge OR THE EDGE IS
   *  UNCONTROLLED" (Instability) — a gate on where the token sits, read
   *  at play time. docs/the-edge-design.md §4 */
  requiresEdge?: "preyOrUncontrolled" | "self";
  delayedReplace?: "unlock" | "afterAction" | "afterCombat" | "discard" | "whileInPlay";
  /** "Do not replace until a vampire commits diablerie" / "…moves from
   *  torpor to the ready region" / "…until your prey is ousted" — the
   *  CONDITION form of the clause above, which waits on an event rather
   *  than a phase. docs/gehenna-taxes-design.md §1 */
  delayedReplaceUntil?: DelayedDrawCondition;
  /** "Not usable by a vampire with more than 0 intercept" (Legwork) — a
   *  gate on the REACTING minion, which is why it cannot be a
   *  `UsabilityRule`: those are asked once per card play, and this has to
   *  be asked once per candidate minion.
   *  docs/buying-a-block-design.md §1 */
  onlyIfNoIntercept?: boolean;
  /** "A vampire may play only one \<this card\> each turn" (Fillip) — per
   *  VAMPIRE, read off `playedSinceUnlock`, which the unlock phase clears.
   *  Distinct from `oncePerTurnAtSuperior`, which is per SEAT.
   *  docs/lock-as-currency-design.md §3 */
  oncePerTurnPerVampire?: boolean;
  /** "A vampire cannot play both \<this\> and \<that\> during the same
   *  action" (Pack Tactics / Elder Intervention). Per VAMPIRE, per
   *  action — so it reads the action frame's `played` list, and BOTH
   *  cards have to name the other or the bar only works one way.
   *  docs/buying-a-block-design.md §2 */
  notWithThisAction?: string[];
  /** "Requires N or more OTHER Gehenna events in play" — a play-time gate
   *  only: *"the 'other Gehenna cards in play' requirement is only checked
   *  when playing the card"* [PIB 20121031], so the card stays in play and
   *  keeps working once the others are gone.
   *  docs/gehenna-events-design.md §1 */
  requiresOtherGehennaEvents?: number;
  /** "…other Gehenna cards CONTROLLED BY OTHER METHUSELAHS in play"
   *  (Becoming of Ennoia) — the same play-time gate, counting only the
   *  play areas that are not yours. docs/gehenna-unlock-design.md §2 */
  gehennaGateOthersOnly?: boolean;
  /** "During each Methuselah's PHASE, that Methuselah …" — the recurring
   *  event trigger. One card in one play area that fires in EVERY seat's
   *  phase, for that seat. docs/gehenna-events-design.md §2 */
  eachMethuselah?: {
    when: "unlock" | "discard" | "afterMinionPhase";
    effect:
      | {
          /** "…burns 1 pool for each vampire in torpor they control"
           *  (Dragonbound). */
          kind: "burnPoolPerTorpidVampire";
          amount: number;
        }
      | {
          /** "…each ready vampire they control with capacity less than the
           *  number of Gehenna events in play who did not hunt during that
           *  minion phase burns 1 blood" (Thirst). */
          kind: "burnBloodUnlessHunted";
          amount: number;
        }
      | {
          /** "…can choose a location controlled by their prey; it is burned
           *  unless its controller burns N pool" (Conquest of Humanity). */
          kind: "burnPreyLocation";
          ransom: number;
        }
      | {
          /** "…chooses a ready vampire, who takes N unpreventable
           *  damage." `whose` says which ready region is read — the
           *  phase's own Methuselah (Becoming of Ennoia) or their prey
           *  (The New Inquisition) — and `optional` is the difference
           *  between "can choose" and "chooses".
           *  docs/gehenna-unlock-design.md §3 */
          kind: "damageReadyVampire";
          whose: "self" | "prey";
          amount: number;
          optional?: boolean;
        }
      | {
          /** "…if that Methuselah controls N or more vampires of the same
           *  clan, they burn one of those vampires. If that vampire's
           *  capacity is M or more, that Methuselah ignores this effect
           *  until the end of the game" (Recalled to the Founder).
           *  docs/gehenna-unlock-design.md §4 */
          kind: "burnSameClanVampire";
          sameClan: number;
          exemptFromCapacity: number;
        };
  };
  modes: CardMode[];
}
