/**
 * Core state for the headless VTES engine (phase 2 kernel).
 *
 * Everything in this file is plain JSON-serializable data — no classes, no
 * closures. The frame stack in GameState.frames IS the sequencing machine's
 * "program counter" (docs/impulse-design.md §2, §9.2). Events are the only
 * record of change; derived values (stealth, bleed, intercept) are never
 * stored — they are folds over the event log (§7).
 *
 * Phase 2 scope: full turn rotation (unlock/master/minion/influence/
 * discard), bleed and hunt, blocking A/B/C, hand-strike combat, library
 * drawing, ousting and victory points. Master cards, politics, influence
 * transfers/crypt, and the wider card pool arrive in later phases behind
 * the same shapes.
 */

export type SeatId = string;
export type MinionId = string;
export type CardInstanceId = string;
export type ActionId = string;

export type DisciplineLevel = "basic" | "superior";
export type Range = "close" | "long";
/** Strikes the engine offers as BUILT-IN options. "combatEnds" is
 *  granted by a rider rather than printed on a card (Night Terrors) —
 *  docs/blocker-riders-design.md §3. */
/** The built-in strike declarations. `hand` is always available;
 *  `combatEnds` and `burnEquipment` are GRANTED by a rider or a card and
 *  offered only while the frame says so. */
export type StrikeKind = "hand" | "combatEnds" | "burnEquipment" | "dodge" | "stealBlood";

/** A specified strike a card has granted, with whatever number it
 *  carries ("strike, ranged: steal 2 blood", Hunger of Marduk superior).
 *  docs/last-combat-design.md §3 */
export interface GrantedStrike {
  kind: StrikeKind;
  amount?: number;
  /** "THIS ROUND, this vampire can strike…" — cleared at the round
   *  boundary, unlike a once-per-combat grant. */
  roundOnly?: boolean;
}
export type ActionKind =
  | "bleed"
  | "hunt"
  | "leaveTorpor"
  | "diablerize"
  | "rescue"
  | "cardEffect";
export type TurnPhase = "unlock" | "master" | "minion" | "influence" | "discard";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/** Allies are minions other than vampires (p. 11); the few vampire-only
 *  rules (hunt, torpor, disciplines, influence) gate on this. */
export type MinionKind = "vampire" | "ally";

/** Vote-bearing titles (p. 28): primogen 1, prince/baron 2, justicar 3,
 *  Inner Circle 4. Contested titles are out of scope (CLAUDE.md). */
export type VampireTitle =
  | "primogen"
  | "prince"
  | "baron"
  | "justicar"
  | "innerCircle"
  // Sabbat titles (p. 28): bishop 1, archbishop 2, priscus 1, cardinal 3,
  // regent 4.
  | "bishop"
  | "archbishop"
  | "priscus"
  | "cardinal"
  | "regent";

/**
 * Titles "associated with a particular city" (p. 39–40) — the three the
 * rulebook says can be contested by another claim to the same city, and
 * the only three the V5 crypt prints as "\<title\> of \<city\>". Papillon
 * ("requires a ready vampire with a city title") is the card that needs
 * them; a test re-derives the list from the registry so it cannot rot.
 * docs/blood-locations-design.md §2
 */
export const CITY_TITLES: VampireTitle[] = ["prince", "baron", "archbishop"];

/**
 * The clans the V5 crypt contains — DERIVED from the registry, not
 * guessed, the same treatment `CITY_TITLES` gets and for the same reason
 * (the "Assamite" filter that matched nothing).
 *
 * Consanguineous Boon is what needs the list, and the rulebook is
 * explicit about which list it is (p. 49): "You must choose an EXISTING
 * clan, **even if no vampires of the chosen clan are in play**." So this
 * is every clan in the pool, not every clan on the table.
 * docs/referendum-terms-design.md §1
 */
export const CLANS: string[] = [
  "Banu Haqim",
  "Brujah",
  "Gangrel",
  "Hecata",
  "Lasombra",
  "Malkavian",
  "Ministry",
  "Nosferatu",
  "Ravnos",
  "Salubri",
  "Toreador",
  "Tremere",
  "Tzimisce",
  "Ventrue",
];

export const TITLE_VOTES: Record<VampireTitle, number> = {
  primogen: 1,
  prince: 2,
  baron: 2,
  justicar: 3,
  innerCircle: 4,
  bishop: 1,
  archbishop: 2,
  priscus: 1,
  cardinal: 3,
  regent: 4,
};

/** V5 sects (p. 39). A minion's sect and clan are static facts, set by
 *  fixtures now and parsed from crypt card text at deck import (phase 7). */
export type Sect = "camarilla" | "anarch" | "sabbat" | "independent";

export interface MinionState {
  id: MinionId;
  name: string;
  kind: MinionKind;
  controller: SeatId;
  /** Whose card this is (p. 16 Rules of Card Ownership): "your cards can
   *  become controlled by other Methuselahs but are never owned by them".
   *  Fixed for the game; `controller` may move (Cave of Apples). Optional
   *  so fixtures need not set it — it defaults to `controller` at entry.
   *  Read it, not `controller`, for "their owner's …" effects. */
  owner?: SeatId;
  /** Blood counters for vampires; life for allies (the rulebook says ally
   *  life IS blood counters from the bank, p. 22). An ally at 0 is burned;
   *  ally life may exceed `capacity` and does not drain off (p. 11). */
  blood: number;
  /** Vampire capacity; for allies, the printed starting life (reference —
   *  not a cap). */
  capacity: number;
  /** Pool cost as printed — recorded for allies, whose "cost" is what
   *  effects compare against (Cave of Apples: "…equals or exceeds their
   *  capacity or cost"). Undefined for vampires, who use `capacity`. */
  cost?: number;
  strength: number;
  bleedAmount: number;
  locked: boolean;
  /** Wake effect active for the current action — does NOT unlock (p. 44). */
  awake: boolean;
  inTorpor: boolean;
  /** Discipline name -> level, e.g. { dom: "superior" }. */
  disciplines: Record<string, DisciplineLevel>;
  /** One bleed action per minion per turn (p. 20). */
  bledThisTurn: boolean;
  /** One political action per vampire per turn (p. 24). */
  calledPoliticalThisTurn: boolean;
  /** "A vampire can gain blood from only one hunting ground each turn" —
   *  reset at the controller's unlock phase. Optional (undefined = false). */
  usedHuntingGroundThisTurn?: boolean;
  /** Corruption counters on this minion, keyed by the seat that placed them
   *  ("your corruption counters" — The Platinum Protocol, Cave of Apples). */
  corruption?: Record<SeatId, number>;
  /** Named counters sitting on this minion that belong to no particular
   *  Methuselah: "hostage" (Carver's Meat Packing), "nightmare" (Week of
   *  Nightmares). Distinct from `corruption`, which is keyed by the seat
   *  that placed it. */
  counters?: Record<string, number>;
  /** Fixture/import-set title (p. 28); votes derive via TITLE_VOTES.
   *  Null for untitled vampires and all allies. */
  title: VampireTitle | null;
  /** "Sterile vampires cannot perform actions to put new vampires in
   *  play" (glossary, p. 42). A real rulebook trait that **no V5 card
   *  grants** — only the two cards that require a non-sterile actor even
   *  mention it — so nothing sets this today and the filter correctly
   *  passes every vampire. It belongs here rather than nowhere because
   *  phase 7's crypt importer is where it would come from, exactly as
   *  `clan`/`sect`/`title` are set by fixtures now.
   *  docs/token-vampire-design.md §4 */
  sterile?: boolean;
  /** The Path of Enlightenment this vampire follows ("Cathari", "Power and
   *  the Inner Voice", "Death and the Soul").
   *
   *  **Nothing in the V5 pool can set this.** Six cards FILTER on a Path
   *  and none grants one — the master cards that do are legacy, which the
   *  scope lock excludes. So the set of Path-following vampires is
   *  permanently empty here, which makes a POSITIVE filter match nothing
   *  and a NEGATIVE one match everything (docs/path-cards-design.md §2).
   *  Modelled anyway because the filters must read something, and because
   *  the day the pool widens the three cut Path cards become ordinary
   *  work rather than a redesign. */
  path?: string;
  /** Clan (e.g. "Gangrel") and sect — static crypt facts for "Requires a
   *  …" gating and clan-locked cards. Null for allies and untagged. */
  clan: string | null;
  sect: Sect | null;
  /** A recruited ally "cannot act this turn" (p. 22) — blocking is fine.
   *  Cleared at end of turn; NOT set when entering play by other means. */
  cannotActThisTurn: boolean;
  /** "Take control of them UNTIL THE END OF YOUR TURN" (Puppet Master
   *  superior) — the seat control goes back to. Every other control
   *  change in the engine is permanent; this one reverts in `endTurn`,
   *  beside `cannotActThisTurn`, and takes everything on the minion back
   *  with it (p. 16). docs/taking-actions-design.md §3 */
  controlRevertsTo?: SeatId;
  /** "The chosen minions cannot play reaction cards, block or cast votes
   *  or ballots this turn" (Expulsion). It does NOT stop them acting —
   *  `canAct` is a separate predicate and the card does not say so.
   *  Cleared on TurnBegan. docs/abstain-gate-design.md */
  expelledThisTurn?: boolean;
  /** "Does not unlock as normal during their next unlock phase" in its
   *  one-shot form (Stolen Police Cruiser, On the Qui Vive's ally rider):
   *  consumed by the next unlock sweep. The persistent form lives on the
   *  card in play as PermanentInPlay.preventsUnlock. */
  skipNextUnlock?: boolean;
  /** "…this Tzimisce can burn 1 blood during your NEXT DISCARD PHASE to
   *  unlock" (Fiendish Tongue). The action card that granted it is burnt
   *  at resolution (p. 27), so there is no card in play to hang an
   *  ability on and the permission lives on the minion; the option is a
   *  built-in, the way a granted press or maneuver credit is. Cleared on
   *  TurnBegan — "your NEXT discard phase" is one chance, and the bleed
   *  necessarily happened earlier in the same turn.
   *  docs/last-buildable-design.md §1 */
  discardPhaseUnlock?: boolean;
  /** Card names this minion has played since its controller's last unlock
   *  phase — for "between their unlock phases" limits (On the Qui Vive). */
  playedSinceUnlock: string[];
  /** "…cannot perform the same action again this turn" (Change of Target,
   *  Obedience). Action KEYS: the card's name for an action announced by
   *  a card, the `ActionKind` otherwise. Cleared on TurnBegan.
   *  docs/end-action-design.md §4 */
  cannotRepeat?: string[];
  /** Equipment, retainers, and on-vampire masters (Blood Doll). */
  attached: PermanentInPlay[];
}

export interface CardInstance {
  id: CardInstanceId;
  /** Key into the handler registry. */
  name: string;
  /** A burnt VAMPIRE's card sitting in its owner's ash heap (p. 34).
   *
   *  Crypt cards have no handler, so every filter that asks the registry
   *  about a card ("is it an ally?", "what does it cost?") already skips
   *  them. This flag exists for the filters that do NOT ask — "a LIBRARY
   *  card at random in their ash heap" (The Gate of Acheron) and plain
   *  count removals — which would otherwise silently start counting
   *  vampires (docs/ledger-closeout.md §9). */
  crypt?: true;
}

/** Static modifiers a permanent contributes while in play. */
/** What a `PlayCostMod` can key on. A card counts under EVERY type its
 *  printed type line carries, so a dual-typed Action Modifier/Reaction is
 *  a reaction for Consign to Oblivion's purposes. "strike" is narrower
 *  than a type line: a combat card whose chosen mode sets a strike. */
export type PlayCostCardType =
  | "reaction"
  | "combat"
  | "strike"
  | "action"
  | "actionModifier"
  | "master"
  | "ally"
  | "retainer"
  | "equipment"
  | "politicalAction";

/**
 * "Cards requiring Dominate cost other minions +1 blood" / "reaction
 * cards cost +1 blood or life" / "recruit ally actions cost this vampire
 * −1 blood or pool" — one shape for every play-cost modifier, read by
 * `playCostFor` in derived.ts (docs/play-cost-design.md §2).
 *
 * Every filter that is PRESENT must match; an absent filter does not
 * constrain. Amounts are signed and the total is clamped at zero.
 */
export interface PlayCostMod {
  amount: number;
  /** Which resource the modifier moves. `bloodOrLife` is the
   *  ally-payable form (p. 22) and resolves identically to `blood`
   *  today — see the design doc §4. */
  pays: "blood" | "pool" | "bloodOrLife" | "bloodOrPool";
  cardTypes?: PlayCostCardType[];
  /** Exact printed card name (Villein names *Minion Tap*). */
  cardName?: string;
  /** KRCG abbreviations: the card's chosen mode must require one of
   *  these (Libertas). Uses `CardHandler.requiresDisciplines`, built for
   *  docs/discipline-filtered-design.md. */
  requiresDiscipline?: string[];
  /** "…a ghoul ally REQUIRING A TZIMISCE" (Szlachta Assistant) — the
   *  clan half, off `CardHandler.requiresClans`. */
  requiresClan?: string[];
  /** "…a GHOUL ally" — a printed sub-type, off
   *  `CardHandler.permanentTags`. docs/retainer-wave-design.md §4 */
  tags?: string[];
  /** "Cards requiring Hecata AND/OR Oblivion" (Roger de Camden): treat
   *  `requiresClan` and `requiresDiscipline` as a UNION rather than the
   *  default intersection. One modifier rather than two, so a card
   *  matching both is charged once. docs/crypt-wave-4.md §2 */
  clanOrDiscipline?: boolean;
  /** Whom the modifier charges, relative to the card in play that
   *  radiates it: the minion it sits on, or everyone else. */
  minions?: "bearer" | "others";
  /** Charges ONE named minion ("combat cards cost the OPPOSING vampire
   *  +1 blood", Terror Frenzy superior). Unlike `minions`, this needs no
   *  bearer, so it is what a frame-scoped modifier uses. */
  minionId?: MinionId;
  /** Consumed by the first card it applies to (Unleashing the Bestial
   *  Soul superior, "the NEXT reaction card"). Matched freely during
   *  enumeration and removed only at payment, so enumeration stays a
   *  pure read. */
  once?: boolean;
  /** "…while this Anarch is acting, attempting to block or in combat"
   *  (Libertas) — the bearer must currently be engaged for the modifier
   *  to bite. Only meaningful on a modifier radiated by a card in play,
   *  where there IS a bearer. */
  whileBearerEngaged?: boolean;
  /** "In combat, strike cards cost THE OPPOSING MINION +1 blood or life"
   *  (Djeneba), "…cost opposing YOUNGER vampires +1 blood" (Algirdas) —
   *  the payer is whoever is fighting the bearer right now.
   *
   *  A different question from `whileBearerEngaged`, which asks whether
   *  the BEARER is engaged and then charges by `minions`. Resolved off
   *  the live combat frame on every read, never stored: a combat ends
   *  four different ways (docs/retainer-wave-design.md §1).
   *  docs/crypt-wave-5.md §4 */
  opposingBearer?: { youngerOnly?: boolean };
  /** The modifier applies when the card being played TARGETS the minion
   *  this modifier's card sits on ("master cards targeting this minion
   *  cost 1 additional pool", Secure Haven; "Villein costs +1 pool to
   *  play ON THIS VAMPIRE"). A different question from `minions`, which
   *  asks who PAYS — both can hold at once.
   *  docs/granted-bleed-and-target-costs-design.md §2 */
  onTarget?: boolean;
  /** "Cards named Minion Tap cost YOU +1 pool" (Villein) — the
   *  controlling Methuselah alone, not the whole table. */
  controllerOnly?: boolean;
  /** This modifier was applied by a FRENZY card (Terror Frenzy superior)
   *  — the provenance a "cancel the effects of frenzy cards already used
   *  on this vampire" clause needs to remove exactly what a frenzy card
   *  put there. docs/round-recurring-combat-design.md §6 */
  fromFrenzy?: boolean;
}

/**
 * A static that applies only during certain actions
 * (docs/conditional-statics-design.md §2). Every condition PRESENT must
 * hold; an absent one does not constrain, so `{ stealth: 1 }` alone would
 * be the unconditional case.
 */
export interface ConditionalStatic {
  stealth?: number;
  intercept?: number;
  /** Crypt cards carry conditional bleed, strength and votes as freely as
   *  conditional stealth ("while your prey has 10 or fewer pool, Üresség
   *  gets +1 vote and +1 bleed"), so the four traits the engine already
   *  derives are all available here (docs/crypt-wave-1.md §2). */
  bleed?: number;
  strength?: number;
  votes?: number;
  /** "…you get +1 hand size" (Carmelita Neillson, Khin Aye). Read by
   *  `handSizeOf`, which asks with NO action — so a static combining this
   *  with an action condition would never apply. */
  handSize?: number;
  /** Built-in action kinds (bleed, hunt, diablerize, …). */
  actionKinds?: ActionKind[];
  /** "Recruit and employ actions" — an ally or retainer played as an
   *  action announces as `cardEffect` like any other action card, so what
   *  tells them apart is the printed type of the announcing card. */
  actionCardTypes?: PlayCostCardType[];
  /** "…during actions directed at their controller" (Abbot, Guardian
   *  Angel) — read against the minion this static sits on. */
  directedAtController?: boolean;
  /** "The BEARER WITH AUSPEX [aus] gets +1 intercept" (Bowl of
   *  Convergence) — the first condition that is about the bearer rather
   *  than about the action. Read through `disciplinesOf`, never the
   *  printed field: a granted Auspex switches the card on and losing the
   *  granting master switches it off again, so it cannot be settled when
   *  the card attaches. docs/last-equipment-modifiers-design.md §2 */
  bearerDiscipline?: { discipline: string; level?: DisciplineLevel };
  /** "…during DIRECTED actions" / "…during UNDIRECTED actions" (The
   *  Dowager, Castellan, Ariane). Narrower than `directedAtController`,
   *  which also asks *who* the action names. */
  actionDirected?: boolean;
  /** A condition on the ACTING minion rather than on the action — "−1
   *  intercept against TITLED vampires" (Bret Stryker), "+1 intercept
   *  against YOUNGER Lasombra" (Azucena). `currentIntercept` already
   *  looks the actor up (docs/opposing-statics-design.md), so this costs
   *  a comparison rather than new plumbing.
   *
   *  `younger`/`older` are relative to the BEARER's derived capacity, so
   *  a granted point of capacity counts on both sides. */
  actingMinion?: {
    titled?: boolean;
    clan?: string;
    kind?: MinionKind;
    younger?: boolean;
    older?: boolean;
    maxCapacity?: number;
  };
  /** "…in combat WITH a Brujah" (Kevin Jackson), "with an ally or younger
   *  vampire" (Ragnar), "with titled vampires" (Roy) — a condition on the
   *  minion on the other side of the live combat.
   *
   *  DERIVED from the frame on every read, never stored: a combat ends by
   *  a strike, by a card, by a combatant leaving play, or by the frame
   *  being popped from three sites, and a flag that must be cleared at
   *  all of them is one that will survive one of them
   *  (docs/retainer-wave-design.md §1). `younger` compares DERIVED
   *  capacity against the bearer's. docs/crypt-wave-3.md §1 */
  inCombatWith?: {
    titled?: boolean;
    clan?: string;
    kind?: MinionKind;
    younger?: boolean;
  };
  /** A condition on the BEARER's controller and the board around them —
   *  "while you have 9 or fewer pool", "while you have the Edge", "while
   *  you control a ready cardinal", "while your prey has 10 or fewer
   *  pool". Every one of these is DERIVED on each read: an oust rewrites
   *  who your prey is, and a pool total moves constantly, so none of it
   *  can be settled when the vampire enters play (the rule
   *  docs/retainer-wave-design.md §1 states). */
  controller?: {
    poolAtMost?: number;
    hasEdge?: boolean;
    controlsReadyTitle?: VampireTitle[];
    /** "While you control NO locations" / "1 or more locations". */
    locations?: "none" | "some";
    preyPoolAtMost?: number;
    /** "While your predator controls more ready minions than you." */
    predatorHasMoreReadyMinions?: boolean;
    /** "…against a Methuselah controlling a Toreador or Ventrue"
     *  (Osvaldo Kühnemann) — a condition on the action's TARGET seat, so
     *  it needs an action to be meaningful. */
    targetControlsClan?: string[];
  };
}

export interface PermanentStatics {
  /** "This ally cannot have or use equipment (or retainers)" (Bone
   *  Shambler, Gravebound Drone) — a gate on OPTIONS: the minion is never
   *  offered as a bearer, which covers "have" and "use" at once.
   *  docs/wraith-zombie-design.md §4 */
  cannotBeEquipped?: { retainers?: boolean };
  /** "This ally cannot gain life" (Rotting Behemoth) — read in the
   *  `BloodGained` applier, so burning and paying are unaffected. */
  cannotGainLife?: boolean;
  /** "This ally cannot be the target of directed actions requiring
   *  Dominate [dom] or Presence [pre]" (Aggressive Corpse). Keyed on what
   *  the CARD being played requires, not on what the actor happens to
   *  have — the sibling of `untargetableExceptDiscipline`, which asks
   *  about the actor. Read through `untargetableBy`, so every one of its
   *  eight call sites honours it at once.
   *  docs/library-audit.md §2 */
  untargetableByDisciplines?: string[];
  /** "In combat, strikes made by this ally cannot be dodged" (Aggressive
   *  Corpse). Checked against the STRIKER at resolution rather than
   *  stamped onto each Strike as `Strike.undodgeable` is: the minion can
   *  strike by hand, by weapon or by a granted strike, and a flag that
   *  every construction site must remember is one a new site will forget.
   *  docs/library-audit.md §2 */
  strikesUndodgeable?: boolean;
  /** "During the first round of each combat, this ally can burn 1 life to
   *  get 1 press" (Rotting Behemoth SUPERIOR). Identical in shape to
   *  `allyAbilities.burnLifeForPress` and read by the same code — the
   *  difference is only where it can be declared: `allyAbilities` is
   *  card-level, and this clause belongs to one MODE, which per-mode
   *  statics already express. docs/wraith-zombie-design.md §4 */
  pressForLife?: { life: number; firstRoundOnly?: boolean; selfOnly?: boolean };
  /** "During your unlock phase, BURN THIS ALLY" — and, at superior, "you
   *  can burn N pool instead" (Spectral Servitor). The upkeep of a ghost
   *  that will not stay. Per-mode, so it lives in statics. */
  unlockSelfBurn?: { payPoolInstead?: number };
  /** "This ally can play NON-ACTION cards requiring basic \<D\> as a
   *  vampire" (Spectral Servitor) — p. 11's play-as-a-vampire rule with
   *  the action half withheld. `playsAsVampire` puts the Disciplines on
   *  the ally and every enumerator reads `disciplinesOf`, so the
   *  restriction is one gate where ACTION cards are offered. */
  playsAsVampireNonActionOnly?: boolean;
  /** "During a bleed action, LOCK ANOTHER COPY of this ally you control
   *  (or burn 1 life from one) to give this ally +N bleed" (Bone Shambler,
   *  Gravebound Drone superior). "Another copy" is a QUERY over minions
   *  with the same name, not stored state (§3). */
  bleedFromCopy?: { cost: "lockCopy" | "burnCopyLife"; amount: number };
  /** "During a bleed action, a \<clan\> you control can burn N blood to
   *  give this ally +M bleed" (Bone Shambler superior). */
  bleedFromClanBlood?: { clan: string; blood: number; amount: number };
  /** "This ally can burn N life to prevent M damage to ANOTHER COPY of
   *  this ally you control in combat" (Gravebound Drone) — the preventer
   *  is not the victim, which is what `preventDamageFor` exists for. */
  preventForCopy?: { life: number; amount: number };
  /** "+N bleed FOR EACH \<tagged\> card attached to him" (Hesha Ruhadze,
   *  "each unique equipment"). A count over the bearer's own attachments,
   *  so `currentBleed` needs no registry: uniqueness rides in as a tag
   *  (docs/crypt-wave-4.md §3). Every tag listed must be present. */
  bleedPerAttached?: { tags: string[]; amount: number };
  handSize?: number;
  /** "This vampire can burn this card to prevent N (non-aggravated)
   *  damage in combat" (Wall of Filth).
   *
   *  DENORMALIZED onto the entry rather than read back off the spec,
   *  because Wall of Filth's two modes differ by exactly the
   *  `nonAggravated` half: a handler-level lookup finds the FIRST mode's
   *  clause and would give the superior the basic's filter. The same
   *  reason `isMaster` and `frenzyOnOpponent` are stamped onto their
   *  frames. docs/combat-attachments-design.md §3 */
  burnToPrevent?: { amount: number; nonAggravated?: boolean };
  /** "Recruit ally actions cost this vampire −1 blood or pool"
   *  (Charisma), "cards requiring Dominate cost OTHER minions +1 blood"
   *  (Libertas), "Minion Tap costs you +1 pool" (Villein) — a play-cost
   *  modifier radiated by a card in play.
   *  docs/play-cost-design.md §2 */
  playCostMod?: PlayCostMod;
  /** "+1 hand size for each counter on this card" (Visit from the
   *  Capuchin) — a hand size that moves with the counters
   *  (docs/counter-sinks-design.md §3). */
  handSizePerCounter?: boolean;
  transfers?: number;
  /** Applies to the bearer (equipment/retainers). */
  intercept?: number;
  /** Stealth/intercept that applies only during CERTAIN actions
   *  ("+1 stealth during diablerie actions", "−2 stealth during bleed
   *  actions", "+1 intercept during actions directed at their
   *  controller") — a list, because one card can carry two, and signed,
   *  because Codex of the Edenic Groundskeepers is a penalty.
   *  docs/conditional-statics-design.md §2 */
  conditional?: ConditionalStatic[];
  /** "This vampire cannot recruit allies or employ retainers"
   *  (Depravity) — printed card types the bearer may not play as an
   *  action. The mirror of a conditional bonus, read off the same
   *  `CardHandler.costTypes` answer. */
  cannotPlayCardTypes?: PlayCostCardType[];
  /** "They cannot play cards named /Torn Signpost/" (Preternatural
   *  Strength) — by NAME rather than by printed type, and unlike
   *  `cannotPlayCardTypes` it is not limited to cards played as an
   *  action: Torn Signpost is a COMBAT card. Read inside `canPlayMode`,
   *  the single per-minion gate every compiler already funnels through,
   *  so a new card type cannot miss it (docs/ledger-closeout.md §2). */
  cannotPlayCardNames?: string[];
  /** "Allies AND vampires with capacity 3 or less cannot block this
   *  vampire" (Rexton "Savage" Abernathy) — a persistent BAR on who may
   *  attempt, keyed on the blocker, where `blockToll` beside it is a
   *  price. The English "and" is a UNION of two groups, the reading
   *  recorded in docs/opposing-statics-design.md, and it is matched with
   *  the same `blockerMatchesFilter` helper.
   *
   *  Distinct from `alliesCannotBlock`, which names one group and no
   *  capacity (docs/crypt-wave-1.md §3). */
  cannotBeBlockedBy?: { kinds?: MinionKind[]; maxCapacity?: number };
  /** Applies to the bearer's actions (an ally's own +1 stealth). */
  stealth?: number;
  /** Persistent bonus to the bearer's bleed amount (Heart of the City). */
  bleed?: number;
  /** "+N bleed AGAINST YOUR PREY" (Tier of Souls) — read in
   *  `currentBleed` against `preyOf(bearer.controller)`, the simpler
   *  direction of the `bleedAuraAgainst` question.
   *  docs/action-attachments-design.md §3 */
  bleedAgainstPrey?: number;
  /** "If the attached minion is BLOCKED, they burn N blood or life before
   *  block resolution" (Phantasmagoria superior). Not `blockCosts` (paid
   *  by the blocker to attempt) and not `notBlockPenalties` (paid for
   *  declining) — the bearer pays for having been blocked, at the moment
   *  p. 25 puts block resolution. docs/action-attachments-design.md §6 */
  blockedToll?: { amount: number; payWith: "blood" | "bloodOrLife" };
  /** "If this vampire is blocked, the BLOCKING MINION'S CONTROLLER burns N
   *  pool before block resolution" (Terrifying Visage; the same sentence is
   *  printed on the crypt card Aelswith, The Irresistible).
   *
   *  A sibling of `blockedToll` rather than a `payer` field on it: the
   *  timing is identical, but the payer is the OTHER side and the currency
   *  is pool, which `payWith: "blood" | "bloodOrLife"` — a union about a
   *  minion paying — cannot express.
   *
   *  Paid on a SUCCESSFUL block only ("if this vampire is blocked"), so it
   *  is not the block tax, which `blockCosts` charges to *attempt*. A
   *  Methuselah who cannot afford it pays what they have: the card names a
   *  penalty, not a price, so it never bars the block.
   *  docs/path-cards-design.md §3 */
  blockedPoolToll?: { amount: number };
  /** Votes the bearer casts from an attached card rather than from a
   *  title — "a unique Independent title worth 2 votes" (Saulot's Guiding
   *  Wisdom). `TITLE_VOTES` is a fixed map over the eleven printed titles
   *  and this is none of them, so the votes come from the card. A vampire
   *  with these and NO title is still a vote source.
   *  docs/outside-combat-design.md §4 */
  votes?: number;
  /** "Rescuing a non-Tremere vampire from torpor costs this Salubri -N
   *  blood, and if the action is successful the rescued vampire gains M
   *  blood" (Saulot's Healing Touch) — an action-cost modifier carried by
   *  a card in play. `notClan` is the exclusion the card names. */
  rescueDiscount?: { amount: number; notClan?: string; bonusBlood?: number };
  /** Persistent bonus to the bearer's printed combat strength
   *  (Preternatural Strength). */
  strength?: number;
  /** Retainer combat output: "inflicts N (R) damage on the opposing minion
   *  each round during normal strike resolution" — environmental damage,
   *  cannot be dodged (p. 31). Non-ranged applies at close range only. */
  combatRoundDamage?: { amount: number; ranged: boolean };
  /** "The employer gets N optional press(es) each combat" — credits that
   *  persist across rounds until spent (Dread Mastiff superior). */
  pressPerCombat?: number;
  /** "1 optional press, ONLY USABLE TO CONTINUE COMBAT, each combat"
   *  (Righteous Blade) — the restricted sibling, spent before a general
   *  credit. docs/weapon-riders-design.md §4 */
  continuePressPerCombat?: number;
  /** "While the employer is in combat, the opposing minion's controller
   *  plays with an OPEN HAND" (Owl Companion). Derived on read from the
   *  live combat frames — never stored, so it turns itself off whichever
   *  way the combat ended. docs/retainer-wave-design.md §1 */
  revealsOpposingHand?: boolean;
  /** "…the opposing minion's controller gets −N hand size" (Raptor
   *  superior). Same derivation, same reason. */
  opposingHandSizePenalty?: number;
  /** "If the action to employ this retainer is successful, unlock this
   *  vampire — during the next DISCARD PHASE (basic) or AFTER RESOLUTION
   *  of this action (superior)" (Feral Hound). A STATIC rather than a
   *  `retainerAbilities` field because it is the only per-MODE difference
   *  between the two, and mode statics already merge into the entry.
   *  docs/retainer-wave-design.md §3 */
  unlockEmployerAt?: "discardPhase" | "afterResolution";
  /** "The attached minion gets N optional maneuver(s) each combat"
   *  (Biothaumaturgic Experiment superior) — the maneuver sibling of
   *  `pressPerCombat`, granted at combat start. The aura already had this
   *  field (Brujah Debate radiates it); an attached card did not. */
  maneuverPerCombat?: number;
  /** "Minions in combat with the employer cannot strike: combat ends"
   *  (Dog Pack) — gates the opposing minion's combat-ends strikes.
   *
   *  The object form adds a filter on the opposing minion: "minions with
   *  ANY OF YOUR CORRUPTION COUNTERS in combat with Faruq cannot strike:
   *  combat ends". One field rather than two, because two fields for one
   *  idea is how `modifyVotes`/`restrictVotes` drifted apart.
   *  docs/crypt-wave-5.md §3 */
  opposingCannotCombatEnds?: boolean | { yourCorruption: true };
  /** "+1 capacity" (the Discipline master cards) — read through
   *  capacityOf(), never off the printed MinionState.capacity. */
  capacityBonus?: number;
  /** "+1 level of Celerity [cel]" (the Discipline master cards) — the
   *  3-letter code; read through disciplinesOf(). */
  disciplineBoost?: string;
  /** "This minion cannot block" (Pentex™ Subversion) — a persistent
   *  restriction on the bearer, unlike the action-scoped
   *  `ActionFrame.blockRestrictions`. */
  cannotBlock?: boolean;
  /** "Vagabond Mystic cannot block VAMPIRES" — the same restriction keyed
   *  on what is ACTING, where `cannotBlock` is unconditional. One
   *  direction only: the bearer may still be blocked by anything.
   *  docs/cheap-tail-design.md §2 */
  cannotBlockKind?: "vampire" | "ally";
  /** "Allies and younger vampires get −1 intercept against this Anarch"
   *  (Stolen Police Cruiser) — a PERSISTENT penalty carried by a card on
   *  the ACTING minion, so it holds for every action they take. The
   *  action-scoped twin is `ActionInterceptModified.filter`, and both
   *  read one helper. docs/opposing-statics-design.md §1 */
  opposingInterceptPenalty?: { amount: number; kinds?: MinionKind[]; younger?: boolean };
  /** "Vampires attempting to block the attached vampire burn 1 blood"
   *  (Archon) — the persistent twin of `ActionFrame.blockCosts`, keyed on
   *  the bearer rather than on one action. docs/opposing-statics-design.md §2 */
  blockToll?: {
    amount: number;
    payWith: "blood" | "bloodOrLife";
    /** "Minions with 1 or more of YOUR corruption counters must burn 1
     *  blood or life to attempt to block Sergio" — the toll falls only on
     *  a blocker the card's controller has corrupted.
     *  docs/crypt-wave-5.md §3 */
    yourCorruption?: boolean;
  };
  /** "\<Clan\> get +N strength in combat with \<this vampire\>" (Kevin
   *  Jackson) — a bonus the BEARER hands to whoever is fighting them, the
   *  mirror of every other combat static here. Read by
   *  `opposingGrantedStrength` off the live frame
   *  (docs/crypt-wave-3.md §1). */
  opposingStrengthBonus?: { amount: number; clan?: string };
  /** "\<This vampire\> gets +2 votes when casting votes AGAINST BLOOD HUNT
   *  referendums" (Jason Newberry). Unlike every other vote static, this
   *  one depends on which WAY the vote is being cast — a direction chosen
   *  at cast time — so it is applied per option rather than folded into
   *  the vampire's single vote count. docs/crypt-wave-6.md §1 */
  voteBonus?: {
    amount: number;
    direction?: "for" | "against";
    variant?: "political" | "bloodHunt";
  };
  /** "Vampires must burn 1 blood to cast votes and ballots AGAINST
   *  referendums called by \<this vampire\>" (Alexander Silverson) — a
   *  toll carried by the CALLING minion, paid by each voter to cast. The
   *  block-tax shape one frame over: it gates the option as well as being
   *  charged, and a voter who cannot pay simply cannot vote that way.
   *  docs/crypt-wave-6.md §2 */
  voteTollAgainst?: { blood: number };
  /** "If you control a LOCKED MINION, \<this vampire\> must bleed with +N
   *  bleed as a Ⓓ action unless she must hunt" (Elen Kamjian). Read in
   *  two places that must agree — the mandatory-action gate in
   *  `minionPhaseOptions` and the `+N` in `currentBleed` — because the
   *  compulsion and the bonus are one sentence, and a bonus that applied
   *  when she was free would be inventing text.
   *  docs/crypt-wave-7.md §2 */
  mustBleed?: { bonus: number; whileControlsLocked?: boolean };
  /** "Minions must burn the top card of their library to attempt to block
   *  \<tagged\> allies" (Parijat) — a block toll radiated at the whole
   *  table, in a third currency. docs/crypt-wave-7.md §6 */
  globalBlockToll?: { payWith: "libraryCard"; actorTags: string[] };
  /** "While \<this vampire\> is ready, ZOMBIES (allies and retainers) you
   *  recruit or employ get +1 starting life" (Ashur-uballit). Read at the
   *  entry path, where the life is computed — and it raises the minion's
   *  `capacity` too, because for an ally that field IS the printed
   *  starting life (p. 11, "a reference, not a cap"), so bumping one
   *  without the other would have `drainOverCapacity` burn the point
   *  back off immediately. docs/crypt-wave-6.md §4 */
  recruitLifeBonus?: { amount: number; tag: string };
  /** "Inflicts +N damage with RANGED strikes (even at close range)"
   *  (Noluthando). The parenthetical describes existing behaviour — a
   *  ranged strike already works at close range — so the only new thing
   *  is the bonus (docs/crypt-wave-3.md §4). */
  rangedDamageBonus?: number;
  /** "Blood hunts cannot be called on the attached vampire" (Archon). */
  noBloodHunt?: boolean;
  /** "Your prey plays with an OPEN HAND" (Revelations superior) — a
   *  seat-level card in play, read by `openHandsFor` alongside Owl
   *  Companion's combat-scoped version. Structural and continuous, which
   *  is what masking is good at; it is the *momentary* reveal of
   *  Revelations' basic mode that the phase-6 "who has looked at this
   *  card" gap is about. docs/last-buildable-design.md §2 */
  opensPreyHand?: boolean;
  /** "This minion cannot be the target of other Methuselahs' actions"
   *  (Secure Haven). A bleed targets a SEAT, not a minion, so a haven
   *  does not stop bleeds — that falls out of the model.
   *  docs/granted-bleed-and-target-costs-design.md §3 */
  untargetableByOthers?: boolean;
  /** "Allies cannot block this Anarch" (Libertas) — the PERSISTENT form
   *  of `ActionFrame.blockRestrictions.noAllies`, keyed on the bearer
   *  rather than on one action, so it covers every action they take.
   *  docs/play-cost-design.md §5 */
  alliesCannotBlock?: boolean;
  /** "Minions WITHOUT Auspex [aus] cannot perform actions directed at
   *  this vampire" (Shadow Cloak) — `untargetableByOthers` with a
   *  discipline escape hatch, read through `disciplinesOf` so a granted
   *  level counts. docs/after-resolution-design.md §5 */
  untargetableExceptDiscipline?: string;
}

/** "Instead of <X> as normal, burn 1 counter from this card"
 *  (docs/counter-sinks-design.md): the Capuchin pays for replacement
 *  draws, Touch of Oblivion pays to keep a minion locked. The counter is
 *  spent *in place of* the thing, and the card burns when it runs out. */
export interface PermanentCounterSink {
  instead: "replacement" | "unlock";
  /** "Burn this card if it has no counters." */
  burnWhenEmpty?: boolean;
}

/** Counters on a card in play that may pay another card's cost
 *  (docs/cost-sources-design.md): "Ravnos you control can use those
 *  counters to pay some or all of the blood cost of action cards they
 *  play". Denormalized at entry like `statics`, so neither the option
 *  enumeration nor the payment needs a registry lookup. */
export interface PermanentCostSource {
  pays: Array<"blood" | "pool">;
  /** Which card type it pays for — "action" is card type Action, not
   *  "anything played as an action" (equipment is its own type). */
  for: "action" | "equipment";
  /** "Ravnos you control can use those counters…" */
  clan?: string;
  /** "…can lock this location to use those counters": it must be
   *  unlocked to be used, and spending locks it. */
  locks?: boolean;
  /** "If this location has no counters, burn it." */
  burnWhenEmpty?: boolean;
}

/** Statics a card in play radiates onto *other* minions rather than its
 *  bearer: "Gangrel you control get +1 strength" (Gangrel Revel),
 *  "Assamites get +1 stealth when bleeding" (The Khabar: Community).
 *  Denormalized at entry like `statics`, so derived values never need the
 *  registry. */
export interface PermanentAura {
  /** Whose minions it reaches: only the card's controller's, or every
   *  Methuselah's ("Gangrel **you control**" vs a bare "Assamites"). */
  scope: "controller" | "global";
  clan?: string;
  sect?: Sect;
  /** "**Titled** Brujah get +1 bleed and +1 vote" (New Carthage) — the
   *  aura must not turn an untitled vampire into a vote source.
   *  docs/politics-locations-design.md §2 */
  titledOnly?: boolean;
  /** "WHILE YOUR PREY CONTROLS A VAMPIRE IN TORPOR, vampires you control
   *  get +1 bleed" (Raising the Portcullis) — the first aura whose
   *  condition reads ANOTHER seat's board. Derived on every read, like
   *  the combat-scoped retainer statics, so nothing has to notice when it
   *  stops being true. docs/opposing-statics-design.md §3 */
  whilePreyHasTorporVampire?: boolean;
  /** "…get +1 vote" / "Ventrue get −1 vote" (New Carthage) — a global
   *  vote static, folded into the per-minion count in `pollingOptions`
   *  and CLAMPED AT ZERO there: a negative never becomes votes against. */
  votes?: number;
  /** Persistent bonus to printed combat strength. */
  strength?: number;
  /** "+N stealth when bleeding" — applies only to bleed actions. */
  bleedStealth?: number;
  /** Persistent bonus to bleed amount ("Ravnos get +1 bleed"). */
  bleed?: number;
  /** "…and do not hunt as normal" (Week of Nightmares) — the hunt action
   *  is simply not offered to them. */
  cannotHunt?: boolean;
  /** "Sabbat vampires you control get +1 hunt" (The Hungry Coyote) — the
   *  positive sibling of `cannotHunt`, read by `huntAmountFor`.
   *  docs/blood-locations-design.md §4 */
  hunt?: number;
  /** "…and N optional maneuver(s) each combat" (Brujah Debate) — credits
   *  granted at combat start, persisting until spent. */
  maneuverPerCombat?: number;
  /** "Vampires with capacity N or less…" — an upper bound to go with the
   *  clan/sect filters (Aranthebes). */
  maxCapacity?: number;
  /** "…get -N bleed against you": applies only when the bleed's target is
   *  this card's controller (Aranthebes). */
  bleedAgainstController?: number;
  /** "While <this card> is unlocked, …" — the aura is live only while the
   *  card in play is unlocked (Aranthebes). */
  requiresUnlocked?: boolean;
}

/** A card in play: a seat-level permanent (location, most masters) or a
 *  card attached to a minion (equipment, retainers, Blood Doll). Statics
 *  and tags are denormalized from the handler at entry so derived values
 *  never need the registry. */
export interface PermanentInPlay {
  card: CardInstance;
  /** Who controls this card in play (p. 16): the Methuselah who played it
   *  — "even if it is played on a card controlled by another Methuselah",
   *  so an attached master is NOT controlled by the minion's controller.
   *  Optional: defaults to the seat/bearer holding it. */
  controller?: SeatId;
  /** Whose card it is (p. 16); burned cards go to the owner's ash heap. */
  owner?: SeatId;
  locked: boolean;
  /** "During X, do Y" latch — one use per phase (p. 16); reset at unlock. */
  usedThisPhase: boolean;
  /** How many times this phase, for the rare card that allows more than
   *  one ("…and, if you control a ready baron, ANOTHER ready Anarch you
   *  control can gain 1 blood as well" — Carfax Abbey). Reset beside
   *  `usedThisPhase`, which is deliberately left a boolean: every other
   *  latch in the engine means exactly one.
   *  docs/blood-locations-design.md §3 */
  phaseUses?: number;
  /** "Once each turn …" latch (the archetypes) — cleared on TurnBegan,
   *  beside `grantedActionUses`. Set when the benefit is TAKEN, so
   *  declining an optional offer does not spend the turn's use. Optional:
   *  undefined reads as false, leaving existing fixtures untouched. */
  usedThisTurn?: boolean;
  statics: PermanentStatics;
  tags: string[];
  /** Statics this card radiates onto other minions (Gangrel Revel). */
  aura?: PermanentAura;
  /** The same, for a card printing MORE THAN ONE aura clause with
   *  different filters ("Titled Brujah get +1 bleed and +1 vote. Ventrue
   *  get −1 vote" — New Carthage). Additive with `aura` rather than
   *  replacing it: migrating the singular field would have rewritten an
   *  event, an applier and a dozen specs to serve one card.
   *  docs/politics-locations-design.md §2 */
  auras?: PermanentAura[];
  /** Counters here may pay another card's cost (Ravnos Carnival/Cache,
   *  docs/cost-sources-design.md). */
  costSource?: PermanentCostSource;
  /** "Instead of X as normal, burn 1 counter from this card" (Visit from
   *  the Capuchin, Touch of Oblivion). */
  counterSink?: PermanentCounterSink;
  /** "The <named> minion does not unlock as normal" for as long as this
   *  card is in play (Toreador Grand Ball). The one-shot form is
   *  MinionState.skipNextUnlock. */
  preventsUnlock?: MinionId;
  /** "That minion's non-bleed actions cannot be blocked" (Toreador Grand
   *  Ball) while this card is in play. */
  unblockable?: { minion: MinionId; exceptBleed?: boolean };
  /** "The chosen vampire" — an answer to a ChoiceFrame that a later
   *  clause on the same card reads back (The Rack). */
  chosen?: MinionId;
  /** Retainers only: life counters from the blood bank (p. 22). A retainer
   *  whose life reaches 0 is burned (p. 31–32). */
  life?: number;
  /** Generic counters sitting on the card (Dreams of the Sphinx, Powerbase,
   *  the many bespoke counter cards). Distinct from `life`/blood — a plain
   *  tally the card's own rules accumulate and spend. */
  counters?: number;
  /** "A minion cannot perform *each action* via the same copy of a card in
   *  play more than once each turn, even if they unlock" (p. 20) — the
   *  limit is per minion, per granted action, per copy, so one seat-level
   *  card granting an action to several minions is spent once per minion
   *  (docs/granted-actions-design.md §4.3). Recorded at announcement;
   *  reset for every entry each turn. */
  grantedActionUses?: Array<{ minion: MinionId; key: string }>;
  /** Cards moved OUT OF PLAY onto this card — neither hand, nor library,
   *  nor in play (Black Market Cache, Shilmulo Tarot, Fleshforge
   *  Chamber). The rulebook's own precedent for such a zone is a
   *  contested unique, "turned face down and out of play" (p. 14).
   *  docs/library-search-design.md §5 */
  stored?: CardInstance[];
  /** "During an action directed at the SAME Methuselah" (Shadow Cast) —
   *  the seat the action that placed this card was directed at.
   *  docs/after-resolution-design.md §5 */
  againstSeat?: SeatId;
  /** A minion this card is ABOUT but is not attached to (Slaughtering the
   *  Herd sits on the predator's vampire and feeds — and dies with — the
   *  vampire that played it). docs/taking-actions-design.md §6 */
  linkedMinion?: MinionId;
  /** Face up (public) or face down — the owner may look at them at any
   *  time, nobody else may (Shilmulo Tarot). Masked in `redactFor`. */
  storedFaceUp?: boolean;
}

/** A face-down-ish crypt card sitting in the uncontrolled region with the
 *  pool counters invested in it so far (p. 35). Counters may exceed
 *  capacity; the excess drains only when the vampire enters play. */
export interface UncontrolledEntry {
  card: MinionState;
  counters: number;
}

export interface SeatState {
  id: SeatId;
  pool: number;
  minions: MinionState[];
  /** Uncontrolled region (p. 15): vampires being influenced into play. */
  uncontrolled: UncontrolledEntry[];
  /** Remaining crypt draw pile (top = index 0). */
  crypt: MinionState[];
  hand: CardInstance[];
  /** Face-down draw pile; cards played from hand are replaced from here
   *  (p. 7). Empty library just means no more replacement. */
  library: CardInstance[];
  /** The discard pile (p. 16). Cards that are BURNED or DISCARDED go to
   *  their OWNER's ash heap — not their controller's — and it "can be
   *  examined by any Methuselah at any time", so it is the one fully
   *  public zone in the game. Optional so existing fixtures and saved
   *  command logs are untouched (the `idSeq` precedent).
   *  docs/ash-heap-design.md */
  ashHeap?: CardInstance[];
  /**
   * This Methuselah has announced a withdrawal and it is still on track
   * (p. 38, "Withdrawing from the Game").
   *
   * Announced in your unlock phase once your library is exhausted and you
   * begin a turn with less than a full hand. It succeeds at your NEXT
   * unlock phase provided that, in between, none of your minions entered
   * combat, none of your minions lost or spent blood, and you lost or
   * spent no pool. Any one of those clears the flag — "the withdrawal
   * fails if you lose a single blood or pool counter, EVEN IF you also
   * gain enough to make up for the loss", which is why this is a latch
   * tripped by the loss rather than a comparison of totals.
   */
  withdrawing?: boolean;
  ousted: boolean;
  victoryPoints: number;
  /** Cards awaiting "do not replace until your next unlock phase". */
  delayedDraws: number;
  /** "Do not replace until your next DISCARD phase" (Mirror Walk) —
   *  flushed as that phase opens, before the discard-down check, which
   *  reproduces p. 49's "a hand size of 6 until your discard phase"
   *  without modelling hand size. docs/end-action-design.md §6 */
  delayedDrawsDiscard?: number;
  /** Action keys no minion of this seat may perform again this turn
   *  ("minions controlled by the acting Methuselah cannot perform the
   *  same political action again this turn" — Delaying Tactics). Cleared
   *  on TurnBegan. docs/end-action-design.md §4 */
  cannotRepeat?: string[];
  /** An out-of-turn master card was played; it consumes a master phase
   *  action from this seat's next master phase (p. 8). */
  outOfTurnMasterUsed: boolean;
  /** Seat-level cards in play (locations and other masters). */
  permanents: PermanentInPlay[];
  /**
   * Owner decision (§9.4): the game never skips a player, even when their
   * only option is Pass — unless this per-seat setting is toggled on.
   * Honored by the runner layer (nextDecision), never by the engine core.
   */
  autoPassWhenOnlyPass: boolean;
  /** Play-cost modifiers this Methuselah is holding that belong to no
   *  frame and no card in play — "burn this retainer to reduce the cost
   *  of the next \<card\> you play" (Szlachta Assistant). Optional, so
   *  every existing fixture and saved log is untouched.
   *  docs/retainer-wave-design.md §4 */
  playCostMods?: PlayCostMod[];
  /** "Give the next X actions minions you control perform this turn +1
   *  stealth" (Veil the Legions superior) — a bank of charges, one spent
   *  per action this seat announces, cleared on TurnBegan ("this turn").
   *  A counter rather than a list of specific actions: spent one per
   *  action it is the same rule, and it serialises and replays.
   *  docs/other-vampire-modifiers-design.md */
  stealthCharges?: number;
  /** "The FIRST referendum a Sabbat vampire you control calls on this
   *  turn passes automatically" (Día de los Muertos) — cleared on
   *  `TurnBegan` beside `stealthCharges`, and consumed by the first
   *  qualifying referendum push, so a second one polls normally.
   *  docs/politics-locations-design.md §4 */
  autoPassReferendum?: boolean;
  /** Card names this seat has played at superior this turn, for "only one
   *  <card> can be played at superior each turn" (Veil the Legions). */
  superiorPlaysThisTurn?: string[];
}

// ---------------------------------------------------------------------------
// Events — past-tense facts, the only mutations (§7)
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: "TurnBegan"; seat: SeatId; turnNumber: number }
  /** `cardTypes` is the printed type line of the card that announced this
   *  action, when one did — the only thing that tells a "recruit"/"employ"
   *  action apart from any other `cardEffect` (conditional statics §2).
   *  Optional, so existing fixtures and saved logs are untouched. */
  /** `targetMinion` is optional (the `idSeq` precedent, so every existing
   *  fixture and saved log is untouched) and rides on the EVENT rather
   *  than being read off the frame, because the frame is not pushed until
   *  after this is emitted — which is exactly the trap Evan Klein's
   *  announce-time hook would have fallen into. docs/crypt-wave-7.md §1 */
  | { type: "ActionAnnounced"; actionId: ActionId; actionKind: ActionKind; acting: MinionId; seat: SeatId; target: SeatId | null; directed: boolean; targetMinion?: MinionId | null; cardTypes?: PlayCostCardType[]; cardTags?: string[] }
  | { type: "CardPlayed"; cardId: CardInstanceId; name: string; seat: SeatId; minion: MinionId | null; mode: DisciplineLevel | null }
  | { type: "CardResolved"; cardId: CardInstanceId; name: string; seat?: SeatId }
  | { type: "CardCanceled"; cardId: CardInstanceId; name: string }
  | { type: "CardDrawn"; seat: SeatId; cardId: CardInstanceId }
  /** "You must shuffle it afterwards" (p. 14) — emitted after EVERY
   *  search, including one that found nothing. */
  | { type: "LibraryShuffled"; seat: SeatId }
  /** "Move a card from your hand to the BOTTOM of your library" (Heart of
   *  Nizchetus). Not a discard: it never reaches the ash heap and draws
   *  no replacement. docs/cheap-tail-design.md §5 */
  | { type: "CardBuried"; seat: SeatId; cardId: CardInstanceId; name: string }
  /** "Flip a coin" (Evan Klein) — the outcome, so a replay of the command
   *  log reproduces it without re-rolling. */
  | { type: "CoinFlipped"; minion: MinionId; tails: boolean }
  /** "REVEAL the top card of your library" (Gathii). Named, unlike
   *  `LibraryCardMoved`: revealing is exactly what makes it public. The
   *  card stays on top of the library. */
  | { type: "LibraryTopRevealed"; seat: SeatId; name: string }
  /** "Burn the top card of their library to attempt to block" (Parijat) —
   *  a block toll paid in cards rather than blood. */
  | { type: "LibraryTopBurned"; seat: SeatId; cardId: CardInstanceId; name: string }
  /** "Move a library card from your ash heap to the BOTTOM of your
   *  library" (Mora). The card has already left the ash heap by its own
   *  `CardLeftZone`; this puts it back into the deck. */
  | { type: "CardToLibraryBottom"; seat: SeatId; cardId: CardInstanceId; name: string }
  /** "Look at and reorder the top N cards of your library" (Eulogio) —
   *  one card moved to a position WITHIN the library. Carries no name:
   *  the cards never leave the library and nothing is revealed to the
   *  table, so a log entry naming them would leak. */
  | { type: "LibraryCardMoved"; seat: SeatId; cardId: CardInstanceId; position: number }
  /** A card moved out of play onto a card in play (Black Market Cache,
   *  Shilmulo Tarot, Fleshforge Chamber). docs/library-search-design.md §5 */
  | {
      type: "CardStored";
      seat: SeatId;
      holder: CardInstanceId;
      cardId: CardInstanceId;
      name: string;
      from: "library" | "hand";
      faceUp: boolean;
    }
  /** "…you can draw one of those cards instead" — a stored card taken
   *  into hand in place of a library draw. */
  | { type: "StoredCardDrawn"; seat: SeatId; holder: CardInstanceId; cardId: CardInstanceId }
  | { type: "CardDiscarded"; seat: SeatId; cardId: CardInstanceId }
  | { type: "BleedAmountModified"; actionId: ActionId; delta: number; source: string; limited: boolean }
  | { type: "StealthModified"; actionId: ActionId; delta: number; source: string }
  | { type: "InterceptModified"; actionId: ActionId; minion: MinionId; delta: number; source: string }
  | { type: "TargetChanged"; actionId: ActionId; from: SeatId; to: SeatId }
  | { type: "BlocksDeclined"; actionId: ActionId; seat: SeatId }
  | { type: "BlockDeclared"; actionId: ActionId; seat: SeatId; blocker: MinionId }
  | { type: "BlockSucceeded"; actionId: ActionId; blocker: MinionId }
  | { type: "BlockFailed"; actionId: ActionId; blocker: MinionId }
  /** The blocker WITHDREW rather than failed: a deliberate choice, and
   *  unlike a failure it neither locks them nor spends their chance to
   *  attempt again (Dawn Operation; p. 25 — only declining is final). */
  | { type: "BlockAttemptCancelled"; actionId: ActionId; blocker: MinionId }
  | { type: "MinionLocked"; minion: MinionId }
  | { type: "MinionUnlocked"; minion: MinionId }
  | { type: "MinionWoke"; minion: MinionId }
  | { type: "TitleGranted"; minion: MinionId; title: VampireTitle }
  /** The card that carried a title left play (docs/granted-rush-design.md
   *  §7) — a title held by a card does not outlive it. */
  | { type: "TitleLost"; minion: MinionId }
  /** An attached card moved from one minion to another (Regent's
   *  diablerie clause); `controller` is who controls it afterwards. */
  | { type: "PermanentMoved"; cardId: CardInstanceId; to: MinionId; controller: SeatId }
  | { type: "HuntingGroundUsed"; minion: MinionId }
  | { type: "CorruptionChanged"; minion: MinionId; seat: SeatId; delta: number }
  /** A named counter on a minion changed (hostage, nightmare). */
  | { type: "MinionCountersChanged"; minion: MinionId; kind: string; delta: number }
  | { type: "BloodBurned"; minion: MinionId; amount: number }
  | { type: "BloodGained"; minion: MinionId; amount: number }
  | { type: "PoolBurned"; seat: SeatId; amount: number }
  | { type: "PoolGained"; seat: SeatId; amount: number }
  | { type: "EdgeTaken"; seat: SeatId }
  | { type: "ActionResolved"; actionId: ActionId; success: boolean }
  /** "Continue the action as if unblocked" (Go-getter superior). A
   *  DISTINCT event rather than a second `ActionResolved` for the same
   *  actionId: the log is the record, one resolution really did happen and
   *  fail, and every fold that counts resolutions would double-count.
   *  docs/ledger-closeout.md §11 */
  | { type: "ActionContinued"; actionId: ActionId; acting: MinionId }
  /** "Minions get -1 intercept" (Unthinkable Humiliation superior) — an
   *  action-wide intercept change, as opposed to InterceptModified, which
   *  names one minion. Read by currentIntercept for every minion. */
  | {
      type: "ActionInterceptModified";
      actionId: ActionId;
      delta: number;
      source: string;
      /** "ALLIES get -1 intercept" (Obedient Flesh) — limits the change to
       *  one kind of minion. Absent = every minion. */
      appliesTo?: MinionKind;
      /** "Allies AND YOUNGER VAMPIRES get −1 intercept" (Perfect Paragon
       *  superior) — two clauses, and the English "and" is a UNION of two
       *  sets, not an intersection: a minion qualifies by being one of
       *  `kinds` OR by being younger than `youngerThan`.
       *  docs/opposing-statics-design.md §1 */
      filter?: { kinds?: MinionKind[]; youngerThan?: MinionId; sects?: Sect[] };
    }
  /** "Minions must burn 1 blood to attempt to block this action" (Seeds of
   *  Terror, Where the Veil Thins, Unthinkable Humiliation). */
  | { type: "BlockCostImposed"; actionId: ActionId; amount: number; source: string }
  | { type: "CombatBegan"; acting: MinionId; opposing: MinionId }
  | { type: "RangeSet"; range: Range }
  | { type: "StrikeChosen"; minion: MinionId; strike: string }
  | { type: "StrengthSet"; minion: MinionId; value: number }
  | { type: "DamagePrevented"; minion: MinionId; amount: number }
  | { type: "PressUsed"; seat: SeatId; toContinue: boolean }
  | { type: "PressGranted"; minion: MinionId }
  | { type: "DamageInflicted"; minion: MinionId; amount: number; source: MinionId | null; aggravated?: boolean }
  | { type: "DamageMended"; minion: MinionId; amount: number }
  | { type: "WentToTorpor"; minion: MinionId }
  | { type: "CombatEnded"; rounds: number }
  | { type: "Ousted"; seat: SeatId }
  | { type: "VictoryPointGained"; seat: SeatId }
  | { type: "GameEnded"; winner: SeatId | null }
  /** A Methuselah announced their intent to withdraw (p. 38). */
  | { type: "WithdrawalAnnounced"; seat: SeatId }
  /** …and it did not hold: they lost blood or pool, or a minion of theirs
   *  entered combat. `why` is for the log, which is read in English. */
  | { type: "WithdrawalFailed"; seat: SeatId; why: string }
  /** …or it did. Worth 1 victory point, and the predator gets NOTHING —
   *  neither a victory point nor pool, unlike an oust (p. 38). */
  | { type: "Withdrew"; seat: SeatId }
  /**
   * One seat was SHOWN cards it does not own (Revelations' "look at your
   * prey's hand"). An event rather than a direct write, so the knowledge
   * replays with the command log like everything else — a loaded save
   * remembers exactly what the original game's player remembered.
   *
   * The log records that the look HAPPENED and which cards were seen; it
   * is not itself hidden information, because the only client that can
   * read a name out of it is the one that was shown the card.
   */
  | { type: "CardsRevealed"; to: SeatId; cards: CardInstanceId[] }
  // Influence phase (p. 35–36) and torpor transitions.
  | { type: "PermanentEnteredPlay"; seat: SeatId; cardId: CardInstanceId; name: string; attachedTo: MinionId | null; statics: PermanentStatics; tags: string[]; life?: number; counters?: number; aura?: PermanentAura; auras?: PermanentAura[]; costSource?: PermanentCostSource; counterSink?: PermanentCounterSink; controller?: SeatId; preventsUnlock?: MinionId; unblockable?: { minion: MinionId; exceptBleed?: boolean }; againstSeat?: SeatId; linkedMinion?: MinionId }
  | { type: "CountersChanged"; cardId: CardInstanceId; delta: number }
  /** `removed`: the card leaves play WITHOUT reaching the ash heap —
   *  "removed from the game … cannot be retrieved or affected in any way"
   *  (p. 16). Used for the self-attached card of a minion that is removed
   *  rather than burned; its equipment is still burned, which is what
   *  p. 16's own sentence says. docs/token-vampire-design.md §5 */
  | { type: "PermanentBurned"; cardId: CardInstanceId; name: string; removed?: boolean }
  /** A card in play shuffled back into a library (Aranthebes) — it leaves
   *  play and returns to its owner's library, which is then shuffled. */
  | { type: "PermanentShuffledIntoLibrary"; cardId: CardInstanceId; name: string; seat: SeatId }
  | { type: "PermanentLocked"; cardId: CardInstanceId }
  | { type: "PermanentUnlocked"; cardId: CardInstanceId }
  | { type: "PoolMovedToUncontrolled"; seat: SeatId; minion: MinionId }
  | { type: "CounterMovedToPool"; seat: SeatId; minion: MinionId }
  | { type: "CryptCardDrawn"; seat: SeatId; minion: MinionId }
  /** "…otherwise, move it to the BOTTOM of your crypt" (Family
   *  Gathering) — the crypt twin of `CardBuried`. The crypt is drawn from
   *  the FRONT (`shift`), so the bottom is `push`.
   *  docs/crypt-and-uncontrolled-design.md §1 */
  | { type: "CryptCardBuried"; seat: SeatId; minion: MinionId }
  /** "…remove a crypt card in your uncontrolled region from the game"
   *  (Wider View) — removal, not burning (p. 16), and the uncontrolled
   *  region's counterpart to `MinionRemovedFromGame`, which only knows
   *  about minions in PLAY. */
  | { type: "UncontrolledRemovedFromGame"; seat: SeatId; minion: MinionId }
  | { type: "VampireEnteredPlay"; seat: SeatId; minion: MinionId; blood: number }
  | { type: "LeftTorpor"; minion: MinionId }
  // Action cards (phase 3).
  | { type: "CardBurned"; cardId: CardInstanceId; name: string; seat?: SeatId }
  /** A card moved into an ash heap (p. 16). Emitted alongside the event
   *  that caused it rather than folded into one, so the log still says
   *  WHY the card left where it was. docs/ash-heap-design.md §3 */
  | { type: "CardToAshHeap"; seat: SeatId; cardId: CardInstanceId; name: string }
  /** "Remove a card in an ash heap from the game" — it leaves the state
   *  entirely, because p. 16 says such a card cannot be retrieved or
   *  affected in any way. docs/ash-heap-design.md §4 */
  | { type: "CardRemovedFromGame"; seat: SeatId; cardId: CardInstanceId; name: string }
  /** A card leaves one of a Methuselah's out-of-play zones for somewhere
   *  the ordinary draw/discard events do not cover: back into play as a
   *  minion (Split the Veil), or onto a minion as a searched-out master
   *  (Waters of Duat, Childe of the Revolution). One event for all three
   *  zones, because a search reads all three at once and two near-identical
   *  events is how vocabulary drifts.
   *  docs/wraith-zombie-design.md §5, docs/token-vampire-design.md §6 */
  | {
      type: "CardLeftZone";
      seat: SeatId;
      cardId: CardInstanceId;
      name: string;
      zone: "library" | "hand" | "ashHeap";
    }
  /** A card retrieved from an ash heap back into its owner's hand
   *  (Garibaldi-Meucci Museum). docs/ash-heap-design.md §6 */
  | { type: "CardTakenFromAshHeap"; seat: SeatId; cardId: CardInstanceId }
  /** "Search your library for a \<type\> card, REVEAL IT and move it to
   *  your hand" (Dominica, Sakhar). Distinct from a draw: the card is
   *  named, it is revealed to the table, and the library is shuffled
   *  afterwards (p. 14). docs/crypt-wave-2.md §3 */
  | { type: "CardSearchedToHand"; seat: SeatId; cardId: CardInstanceId; name: string }
  /** A card set aside for an action goes back to its OWNER's hand rather
   *  than to the ash heap (Telepathic Vote Counting cancelling a
   *  referendum). docs/abstain-gate-design.md */
  | { type: "CardReturnedToHand"; cardId: CardInstanceId; name: string; seat: SeatId }
  /** "Force a vampire to abstain (this cancels their votes and ballots)". */
  | { type: "VampireAbstained"; actionId: ActionId; minion: MinionId; votesCancelled: number }
  /** The referendum stopped without resolving — no result, no effects, and
   *  the calling card is NOT burned. Distinct from failing. */
  | { type: "ReferendumCancelled"; actionId: ActionId; cardName: string }
  /** "Cannot play reaction cards, block or cast votes or ballots this
   *  turn" (Expulsion). */
  | { type: "MinionExpelled"; minion: MinionId }
  | { type: "UncontrolledBloodAdded"; seat: SeatId; minion: MinionId; amount: number }
  // Allies and retainers (phase 3, allies gate).
  /** `disciplines`: "plays cards requiring \<X\> as a vampire" (p. 11) —
   *  optional, so every existing fixture and saved log is untouched.
   *  docs/vozhd-allies-design.md §3 */
  | { type: "AllyEnteredPlay"; seat: SeatId; minion: MinionId; cardId: CardInstanceId; name: string; life: number; strength: number; bleed: number; recruited: boolean; cost?: number; disciplines?: Record<string, DisciplineLevel> }
  /** "Put this card in play. It becomes a 1-capacity vampire" (Waters of
   *  Duat, Childe of the Revolution) — a LIBRARY card that becomes a
   *  vampire minion, which is the ally machinery with `kind: "vampire"`.
   *  It enters with 0 blood, so p. 21's mandatory hunt produces the
   *  printed "must hunt this turn" with no code.
   *  docs/token-vampire-design.md §§2–3 */
  | { type: "VampireTokenEnteredPlay"; seat: SeatId; minion: MinionId; cardId: CardInstanceId; name: string; capacity: number; clan: string | null; sect: Sect | null }
  | { type: "MinionBurned"; minion: MinionId }
  /** "Remove a vampire from the game" (Golconda: Inner Peace) — p. 16
   *  names this as a distinct fate from burning, and a card keyed on
   *  "burned" must not fire for it.
   *  docs/cross-table-masters-design.md §3 */
  | { type: "MinionRemovedFromGame"; minion: MinionId }
  | { type: "RetainerLifeBurned"; cardId: CardInstanceId; amount: number }
  | { type: "RetainerLifeGained"; cardId: CardInstanceId; amount: number }
  // Politics (docs/politics-design.md).
  | { type: "ReferendumCalled"; actionId: ActionId; seat: SeatId; cardName: string }
  | { type: "TermsChosen"; actionId: ActionId; terms: Record<string, string> }
  | { type: "VoteCast"; actionId: ActionId; seat: SeatId; source: string; count: number; inFavor: boolean }
  | { type: "EdgeBurned"; seat: SeatId }
  | { type: "ReferendumResolved"; actionId: ActionId; passed: boolean; votesFor: number; votesAgainst: number }
  | { type: "MovedToUncontrolled"; seat: SeatId; minion: MinionId }
  /** "Control can change through game effects" (p. 16) — a minion or a
   *  card in play passes to another Methuselah. Ownership is untouched. */
  | {
      type: "ControlChanged";
      target: "minion" | "permanent";
      id: string;
      from: SeatId;
      to: SeatId;
    }
  // Diablerie, rescue, and the blood hunt (docs/diablerie-design.md).
  | { type: "DiablerieCommitted"; diablerist: MinionId; victim: MinionId }
  | { type: "BloodHuntCalled"; diablerist: MinionId };

// ---------------------------------------------------------------------------
// The impulse cycle — the universal sequencing rule (§2.1, rulebook p. 8)
// ---------------------------------------------------------------------------

export interface ImpulseCycle {
  /** Seats in sequencing order: acting first, defender(s), then clockwise. */
  order: SeatId[];
  /** Whose impulse it is (index into order). */
  cursor: number;
  /** Consecutive passes; reaching order.length means quiescence. */
  passes: number;
}

export function newCycle(order: SeatId[]): ImpulseCycle {
  return { order: [...order], cursor: 0, passes: 0 };
}

export function cycleSeat(c: ImpulseCycle): SeatId {
  const seat = c.order[c.cursor];
  if (seat === undefined) throw new Error("impulse cycle has empty order");
  return seat;
}

export function cyclePass(c: ImpulseCycle): void {
  c.passes += 1;
  c.cursor = (c.cursor + 1) % c.order.length;
}

/** "If at any point any Methuselah uses a card or effect, the acting
 *  Methuselah again gets the impulse back" (p. 8). */
export function cycleRewind(c: ImpulseCycle): void {
  c.cursor = 0;
  c.passes = 0;
}

export function cycleQuiescent(c: ImpulseCycle): boolean {
  return c.passes >= c.order.length;
}

// ---------------------------------------------------------------------------
// Frames — the pushdown automaton (§2.2)
// ---------------------------------------------------------------------------

/**
 * "+2 hand size UNTIL THE END OF THE TURN" (Dreams of the Sphinx), "THIS
 * COMBAT, you get +1 hand size" (Rage of Apedemak) — a hand-size bonus
 * with a lifetime, held on the frame whose lifetime it shares and summed
 * by `handSizeOf` on every read.
 *
 * Nothing stores it on the seat and nothing clears it: a combat ends by a
 * strike, by a card, by a combatant leaving play or by the frame being
 * popped, and a flag that must be cleaned up at all of them is one that
 * will survive one of them (the Raptor rule, docs/retainer-wave-design.md
 * §1). The frame going away IS the expiry.
 *
 * `seat` rather than the frame's owner: Dreams prints no timing
 * restriction, so a Methuselah may lock it during somebody else's turn.
 * docs/temporary-hand-size-design.md §2
 */
export interface HandSizeGrant {
  seat: SeatId;
  amount: number;
  /** The granting card, carried only so the discard-down question reads
   *  as English — the question itself is answered by the engine (§4). */
  cardName: string;
  cardId: CardInstanceId;
  /** When the bonus lifts. Absent means with the frame that holds it —
   *  end of turn for a `TurnFrame` grant (Dreams of the Sphinx), end of
   *  combat for a `CombatFrame` one (Rage of Apedemak).
   *
   *  `"discardPhase"` lifts it EARLIER, as that seat's discard phase
   *  opens (Fotini Katsikaris, "until your next discard phase"). The
   *  difference is real and is the point of the card: a bonus that lasted
   *  through the discard phase would let its holder keep the extra card,
   *  where this one makes them shed it before discarding down.
   *  docs/crypt-wave-6.md §5 */
  until?: "discardPhase";
}

export interface TurnFrame {
  kind: "turn";
  seat: SeatId;
  phase: TurnPhase;
  turnNumber: number;
  /** Unlock-phase bookkeeping: cards unlocked (automatic, once). */
  unlockDone: boolean;
  /** Edge pool-gain decision handled (only asked of the Edge holder). */
  edgeDone: boolean;
  /** Unlock-phase permanent abilities declined/finished (Vessel etc.). */
  unlockAbilitiesDone: boolean;
  /** Other seats that passed their "during any Methuselah's unlock phase"
   *  abilities (Homunculus) — asked after the turn's seat, clockwise. */
  unlockOthersDone: SeatId[];
  /** Transfers remaining; granted at the start of the influence phase —
   *  1/2/3 on the game's first three turns, then 4 (p. 35). */
  transfersLeft: number;
  /** Master phase actions remaining (default 1, minus out-of-turn debt). */
  masterActionsLeft: number;
  /** Only one master phase action may be gained from trifles per master
   *  phase (p. 10). */
  trifleGained: boolean;
  /** "In your discard phase you receive by default one discard phase
   *  action" (p. 37) — spent by a discard, and unused ones are lost.
   *  Effects may grant more (Powerbase: Los Angeles). Optional so old
   *  fixtures keep working: undefined means the default 1. */
  discardActionsLeft?: number;
  /** Actions announced so far in this minion phase, counted so a card can
   *  ask "is this the first action in a minion phase?" (Channel 10).
   *  Incremented at ANNOUNCEMENT, in `applyToFrames` rather than at the
   *  three announce sites, so it cannot drift out of step with them — a
   *  blocked or cancelled action still counts as an action taken.
   *  Optional: undefined reads as 0, so existing fixtures are untouched. */
  minionActionsThisPhase?: number;
  /** "+2 hand size until the end of the turn" (Dreams of the Sphinx).
   *  `endTurn` REPLACES this frame, so the bonus lifts itself — and it
   *  lifts after the discard phase, which is the ordering p. 50 requires.
   *  docs/temporary-hand-size-design.md §3 */
  handSizeBonus?: HandSizeGrant[];
}

/** Steps mirror "Detailed course of an action" (rulebook p. 27) — §3. */
/** Action states A/B/C (p. 27), plus "blocked" and the post-resolution
 *  impulse the after-resolution family plays into
 *  (docs/after-resolution-design.md §2). */
export type ActionStep = "announce" | "A" | "B" | "C" | "blocked" | "afterResolution";

/** The action card an action was announced with — set aside, out of play,
 *  until resolution (p. 25); burned at resolution or on block (p. 27). */
export interface ActionCardRef {
  instance: CardInstance;
  mode: DisciplineLevel | null;
  /** Choices fixed at announcement (e.g. the uncontrolled target). */
  params: Record<string, string>;
}

export interface ActionFrame {
  kind: "action";
  actionId: ActionId;
  actionKind: ActionKind;
  /** Non-null when the action was announced with an action card. */
  card: ActionCardRef | null;
  acting: MinionId;
  actingSeat: SeatId;
  /** Current target Methuselah for directed actions (bleed); null for
   *  undirected actions (hunt). Updated by TargetChanged, which reopens
   *  blocks (§3.4). */
  target: SeatId | null;
  directed: boolean;
  /** Non-null for actions directed at a minion (rush; later diablerie,
   *  rescue — docs/rush-actions-design.md). Directedness derives from
   *  the target's controller: another Methuselah's minion → directed at
   *  that seat; your own → undirected (p. 25, p. 52). */
  targetMinion: MinionId | null;
  /** "During that combat" rider credits fixed at announcement (Umbrous
   *  Clutch superior's maneuver) — folded into the combat frame if the
   *  rush succeeds. */
  rushRiders: RushRiders | null;
  /** "At the end of that combat, if <who is still standing>, <payoff>"
   *  (Abuse of Power, Pillars Fall, Hunting the Beast) — carried from
   *  announcement to `finishAction`, which installs it on the rush's OWN
   *  combat. A blocked rush fights the blocker and gets neither this nor
   *  `rushRiders`: "that combat" is the one the card announced.
   *  docs/rush-outcome-design.md §2 */
  combatOutcome: AfterCombatRider | null;
  /** "Ⓓ Stun an unlocked vampire" (Mind Numb) — an action card from hand
   *  that NAMES a minion but does not fight it. A successful cardEffect
   *  action with a `targetMinion` otherwise enters combat with it, and
   *  the opt-out existed only for granted actions (Cave of Apples), never
   *  for a card played from hand. docs/stun-design.md §6 */
  noCombatOnSuccess?: boolean;
  /** "The target vampire is considered the acting minion during that
   *  combat" (Deep Song superior) — the rush combat is pushed with the
   *  sides swapped. docs/last-buildable-design.md §3 */
  invertCombatRoles?: boolean;
  /** "…AND LOCK a vampire" (Deep Song superior) — applied with the combat
   *  push, on success. */
  lockTargetOnSuccess?: boolean;
  /** How the action turned out, recorded as it resolves so a card played
   *  in the after-resolution window can gate on "only usable if the
   *  action was successful" / "…was blocked" after the fact. */
  resolvedSuccess?: boolean;
  /** "This vampire burns 1 blood to continue the action AS IF UNBLOCKED"
   *  (Go-getter superior) — set in the `action.afterResolution` window and
   *  consumed the moment that window closes, which is the only point at
   *  which the action's success effects can still be run without
   *  repeating its tail (docs/ledger-closeout.md §11). */
  continueUnblocked?: boolean;
  /** "Minions who attempt to block this action and fail become locked
   *  before action resolution" (Faceless Night). Set when the card
   *  resolves; every `BlockFailed` from THAT MOMENT appends to
   *  `failedBlockersToLock`, because p. 48 says the card does not lock
   *  retroactively. docs/end-action-design.md §5 */
  lockFailedBlockers?: boolean;
  failedBlockersToLock?: MinionId[];
  /** A successful political action calls a referendum whose effects belong
   *  to this card (p. 27). Set from BOTH paths: a political action card
   *  played from hand, and a political action GRANTED by a card in play
   *  ("vampires can call a referendum to burn this card"), which has no
   *  `card` at all. docs/pool-drain-design.md §6 */
  referendumSource?: {
    cardName: string;
    cardInstanceId: CardInstanceId;
    /** True when a card ALREADY IN PLAY granted the political action, as
     *  opposed to a political action card played from hand. War of Ages is
     *  both — played from hand it puts itself in play, and once in play it
     *  can be voted out — so its handler needs to tell its own two
     *  referendums apart. */
    fromCardInPlay?: boolean;
  };
  /** Non-null for an action that targets a card in play ("Minions can burn
   *  this card as a Ⓓ action") — the action is directed at that card's
   *  controller, who is therefore the only seat that may block (p. 25 via
   *  p. 19's Ⓓ reminder; docs/granted-actions-design.md §3). */
  targetPermanent: CardInstanceId | null;
  /** Non-null for an action granted by a card in play whose effect is
   *  something other than entering combat ("Hecata you control can add 1
   *  counter to this card as a +1 stealth action" — Pit of Contemplation).
   *  On success the granting card's `resolveGrantedAction` runs
   *  (docs/granted-actions-design.md §4.2). */
  grantedEffect: {
    cardId: CardInstanceId;
    cardName: string;
    key: string;
    params: Record<string, string>;
  } | null;
  /** "…as a Ⓓ action that costs 2 pool" — a granted action's own cost,
   *  paid at resolution and only on success (p. 27). */
  grantedCost: { pool?: number; blood?: number } | null;
  /** "…can use those counters to pay some or all of the cost" — the split
   *  chosen at announcement, spent at resolution like the rest of the cost
   *  (docs/cost-sources-design.md §2). Empty for a play paid in full by
   *  its own Methuselah. */
  costFromCards?: Array<{ cardId: CardInstanceId; blood: number; pool: number }>;
  /** Rescue-from-torpor's 2-blood cost split, fixed at announcement
   *  (p. 23 — the cost is a detail defined at announcement, p. 25);
   *  `fromActor` + `fromVictim` = 2. Null for non-rescue actions. */
  rescueSplit: { fromActor: number; fromVictim: number } | null;
  step: ActionStep;
  /** Sticky per-seat "declined to block" flags (p. 27 A.3), cleared only by
   *  a target change. Distinct from the freely-rewinding impulse cursor. */
  declinedBlocks: SeatId[];
  /** Same modifier/reaction card once per action per minion (p. 10). */
  /** `mode` lets a per-action limit be scoped to ONE mode ("only one
   *  Form of Mist at superior each action") the way
   *  `oncePerCombatAtSuperior` does for a combat. */
  played: Array<{ minion: MinionId; card: string; mode?: DisciplineLevel | null }>;
  /** Who successfully blocked (for "if they do not block" riders). */
  blockedBy: MinionId | null;
  /** Deferred "burn N if this minion did not block" (Forced Awakening).
   *  `seat` set: the penalty is N POOL from that Methuselah instead of N
   *  blood from the minion (WMRH Talk Radio), the minion still naming
   *  whose failure to block triggers it.
   *  docs/action-time-locations-design.md §3 */
  notBlockPenalties: Array<{ minion: MinionId; amount: number; seat?: SeatId }>;
  /** "After action resolution, if that action was successful, unlock the
   *  acting minion" (Warsaw Station) — conditional on SUCCESS, unlike
   *  `notBlockPenalties`, which runs either way. */
  unlockOnSuccess: MinionId[];
  /** "\<This vampire\> can burn N blood to unlock \<self | the acting
   *  ally\> after action resolution" (Paths in Two Worlds superior, Gifts
   *  From Hereafter superior) — unlike `unlockOnSuccess`, it is an OFFER
   *  with a cost, so it is raised as an optional ChoiceFrame during
   *  resolution rather than applied. Optional so existing fixtures and
   *  saved logs are untouched. docs/wraith-zombie-design.md §4 */
  afterResolutionUnlocks?: Array<{
    payer: MinionId;
    target: MinionId;
    blood: number;
    ifSuccessful?: boolean;
    cardName: string;
    cardId: CardInstanceId;
  }>;
  /** Seats whose card replacement waits "until after this action". */
  drawAfter: SeatId[];
  /** "Reaction cards cost +1 blood or life" (Consign to Oblivion), "the
   *  next reaction card costs +1" (Unleashing the Bestial Soul superior)
   *  — play-cost modifiers scoped to this action.
   *  docs/play-cost-design.md §2 */
  playCostMods: PlayCostMod[];
  /** "Those cards are not replaced until the end of the action" (Consign
   *  to Oblivion superior) — the dynamic form of the handler's static
   *  `delayedReplace: "afterAction"`, matched against the same card
   *  types a `PlayCostMod` names. */
  delayReplaceTypes: PlayCostCardType[];
  /** "The chosen minion cannot play reaction cards this action"
   *  (Unleashing the Bestial Soul). Read where `canReact` gates reaction
   *  enumeration; it does NOT stop them blocking — the card says
   *  reaction CARDS. */
  noReactionsFrom: MinionId[];
  /** "If this vampire blocks, it gets N optional maneuvers/presses (and/or
   *  neither combatant strikes the first round) in the resulting combat"
   *  (Spirit's Touch, Rat's Warning, One With the Land) — keyed by the
   *  reacting minion, applied when its block starts combat. */
  blockerCombatRiders: Record<
    MinionId,
    {
      maneuver: number;
      press: number;
      noStrikeFirstRound?: boolean;
      /** "Strike cards cost the acting minion +1 blood or life during
       *  the resulting combat" (Ensnare a Beast superior) — conditional
       *  on the block actually happening, so it rides here rather than
       *  applying when the card is played. */
      playCostMod?: PlayCostMod;
      /** "…can prevent 1 damage during the FIRST ROUND of the resulting
       *  combat" (Precognition). Its own credit pool, because
       *  `preventCredits` is combat-long.
       *  docs/blocker-riders-design.md §3 */
      prevent?: number;
      /** "…and cannot use equipment during the resulting combat"
       *  (Form of the Bat). */
      noEquipment?: boolean;
      /** "…they can burn N blood to unlock after block resolution"
       *  (Truth in Darkness) — an OPTION offered once combat begins. */
      unlockForBlood?: number;
      /** "…they can strike: combat ends during the first round"
       *  (Night Terrors). */
      combatEndsStrike?: boolean;
    }
  >;
  /** The mirror of `blockerCombatRiders`, for the ACTING minion: "if this
   *  vampire is blocked, they can prevent 1 damage during the resulting
   *  combat" (Beast Meld), "this Anarch gets +1 strength this action"
   *  (Invigorate) — applied when a block turns into combat
   *  (docs/actor-riders-design.md). Cumulative across cards. */
  actorCombatRider: {
    prevent: number;
    strength: number;
    maneuver: number;
    press: number;
    handStrikesAggravated: boolean;
    /** "All damage inflicted on vampires during the resulting combat is
     *  aggravated" (Dawn Operation). Symmetric — it applies to BOTH
     *  combatants, unlike everything else on this record — but it is
     *  carried into combat the same way, so it rides here.
     *  docs/dawn-operation-design.md */
    combatAggravated: boolean;
    /** "…and cannot use equipment during the resulting combat" (Form of
     *  the Bat's modifier mode) — the mirror of the blocker's own.
     *  docs/blocker-riders-design.md §2 */
    noEquipment?: boolean;
  };
  /** "This vampire unlocks and attempts to block" (Sense the Savage Way) —
   *  a reaction records the forced block here; the settle loop converts it
   *  into a normal block attempt when control returns to the action. */
  pendingAutoBlock?: { minion: MinionId; interceptBonus: number };
  /** "If this vampire does not block this action, lock / attach after
   *  action resolution" (Dogged Pursuit) — settled at action resolution
   *  for any minion that is not the successful blocker. */
  blockPenalties: Array<
    | { minion: MinionId; kind: "lock" }
    | { minion: MinionId; kind: "attach"; cardId: CardInstanceId; cardName: string }
  >;
  /** Minions that may "burn 1 blood for +1 intercept during this action"
   *  (Eyes of the Wild) — a repeatable built-in offered in block attempts;
   *  action-scoped, so it clears when the action frame pops. */
  interceptBurnGrants: MinionId[];
  /** "If this vampire blocks, put this card on the acting minion; you still
   *  control it" (Melange) — attached (as a seat-level permanent of the
   *  blocker, tagged with the actor) when this blocker's block succeeds. */
  attachOnBlock: Array<{ blocker: MinionId; cardId: CardInstanceId; cardName: string; seat: SeatId }>;
  /** Card-in-play instance ids whose "once each action" ability was used
   *  this action (Under Siege) — action-scoped, clears when the frame pops. */
  usedInPlayAbilities: CardInstanceId[];
  /** "If the bleed is successful, this vampire can burn 2 of your corruption
   *  counters from a minion of the target to unlock" (Revelation of the
   *  Serpent) — settled at action resolution. */
  corruptionUnlocks: Array<{ minion: MinionId; seat: SeatId }>;
  /** "Minions [without Oblivion] must burn 1 blood [or life] to attempt to
   *  block this action" (docs/block-tax-design.md) — a toll paid when a
   *  block is declared. Several are cumulative; each entry names who is
   *  exempt and what may pay it. */
  blockCosts: Array<{
    amount: number;
    /** "1 blood" excludes allies, who have no blood; "1 blood or life"
     *  lets them pay out of their life counters. */
    payWith: "blood" | "bloodOrLife";
    /** "Minions without Oblivion" — a minion with this discipline owes
     *  nothing towards this entry. */
    exemptDiscipline?: string;
    source: string;
  }>;
  /** "During this action, minions cannot unlock" (The Sleeping Mind
   *  superior) — shuts off the unlock-and-block cluster for this action. */
  noUnlock: boolean;
  /** "This vampire takes N unpreventable environmental aggravated damage
   *  after action resolution" (Daring the Dawn) — settled once the action
   *  has resolved, outside any combat. */
  afterResolutionDamage: Array<{
    minion: MinionId;
    amount: number;
    aggravated: boolean;
    /** "This vampire can burn N blood to be IMMUNE to this aggravated
     *  damage" (Rutor's Hand superior) — a pay-to-opt-out on damage the
     *  card itself deals. The question has to be asked BEFORE the damage
     *  lands, so the item carries the offer and the damage loop raises a
     *  ChoiceFrame instead of inflicting (docs/ledger-closeout.md §10).
     *  `cardName`/`cardId` route that frame back to the card's handler. */
    optOut?: { blood: number; cardName: string; cardId: string };
  }>;
  /** "Queue a combat between them" (Hedonism) — a combat between two
   *  minions NEITHER of which is the acting minion, entered only once this
   *  action is off the stack. Same shape as `afterResolutionDamage`.
   *  docs/other-vampire-modifiers-design.md */
  queuedCombats: Array<{ a: MinionId; b: MinionId; outcome?: AfterCombatRider }>;
  /** "X cannot block this action" restrictions (Seduction, Visions of
   *  Gehenna) — consulted by the block-eligibility generator. */
  blockRestrictions: {
    noAllies: boolean;
    noVampires: boolean;
    noTitled: boolean;
    cannotBlock: MinionId[];
  };
  cycle: ImpulseCycle;
}

export interface BlockAttemptFrame {
  kind: "blockAttempt";
  actionId: ActionId;
  blockerSeat: SeatId;
  blocker: MinionId;
  cycle: ImpulseCycle;
  /** "Their block attempt fails, and they cannot attempt to block this
   *  action again" (Enchanting Gaze) — set by burning a corruption counter;
   *  resolveBlockAttempt fails it and adds the blocker to `cannotBlock`. */
  forceFail?: boolean;
  /** "If a vampire is currently attempting to block, they can cancel their
   *  block attempt" (Dawn Operation) — the offer, set on the attempt that
   *  is underway. A re-attempt is a NEW frame with this unset, which is
   *  what stops the offer repeating. */
  mayCancel?: boolean;
  /** The blocker took that offer. Distinct from `forceFail`: a withdrawal
   *  does not lock them and does not spend their right to attempt again
   *  (p. 25). docs/dawn-operation-design.md */
  cancelled?: boolean;
}

/** The seven combat round steps (rulebook p. 29) — §5. */
export type CombatStep =
  | "beforeRange"
  | "range"
  | "beforeStrikes"
  | "chooseStrike"
  | "damageResolution"
  | "press"
  | "endOfRound";

/** A rider that fires once a combat frame has popped
 *  (docs/after-combat-ends-design.md §2). */
export type AfterCombatRider =
  /** "…if the range is close, this vampire inflicts N unpreventable
   *  damage on the opposing minion" (Catatonic Fear). */
  | { kind: "damage"; source: MinionId; amount: number; closeRangeOnly: boolean }
  /** "…put this card on this vampire" (Pass Through Shadow). */
  | { kind: "attachSelf"; minion: MinionId; seat: SeatId; cardId: CardInstanceId; name: string }
  /** "…if this vampire was blocked, they can burn N blood to continue the
   *  action as if unblocked, with +M stealth" (Form of Mist). */
  | { kind: "continueAction"; minion: MinionId; bloodCost: number; stealth: number }
  /** "…if the range is close, stun the opposing minion" (Kiss of
   *  Cathari). docs/stun-design.md §5 */
  | { kind: "stun"; source: MinionId; closeRangeOnly: boolean }
  /** "After combat ends, move all the blood from this card to the
   *  opposing vampire and burn this card" (Morbidity). The recipient can
   *  have been burned during the combat — that is the case the card
   *  exists for — so the blood is simply gone and the card still burns.
   *  docs/combat-attachments-design.md §6 */
  | { kind: "returnStoredBlood"; cardId: CardInstanceId; to: MinionId }
  /** "At the end of that combat, if <who is still standing>, <payoff>" —
   *  a rider a RUSH ACTION installs on the combat it starts (Abuse of
   *  Power, Pillars Fall, Hunting the Beast). Condition and payoff travel
   *  together in one variant because the three cards are one shape.
   *  docs/rush-outcome-design.md §2 */
  | {
      kind: "outcome";
      /** The acting minion — "the opposing minion" is relative to them. */
      actor: MinionId;
      seat: SeatId;
      /** The action card that installed this. Both payoffs that ask a
       *  question raise a ChoiceFrame, which dispatches by CARD NAME, so
       *  it lives on the rider rather than on one of the effects. */
      cardId: CardInstanceId;
      name: string;
      when: OutcomeCondition;
      effect: OutcomeEffect;
    };

/** Which survivors the payoff is conditioned on. Every one is asked with
 *  `findMinion`, never `getMinion`: a combatant burned during the combat
 *  is exactly the case these cards are written for. */
/** "During that combat, this vampire gets …" — the credits a rush action
 *  fixes at announcement and hands to `pushCombat`. Each field lands in
 *  the frame slot that already owns it, so nothing new is spent or reset.
 *  docs/rush-outcome-design.md §5 */
export interface RushRiders {
  maneuver: number;
  press: number;
  /** "+1 strength during that combat" (Make the Misere `[pot]`). */
  strength?: number;
  /** "The opposing minion cannot strike: combat ends during the first
   *  round" (Hunter's Mark superior) — the combat-scoped sibling of
   *  `PermanentStatics.opposingCannotCombatEnds`. */
  noCombatEndsFirstRound?: boolean;
}

export type OutcomeCondition =
  /** "if only one combatant is ready" (Abuse of Power) — EITHER one; the
   *  card names no exception (docs/rush-outcome-design.md §3). */
  | "oneCombatantReady"
  /** "if the opposing vampire is not ready" (Pillars Fall). */
  | "opposingNotReady"
  /** "if this vampire is ready and the opposing vampire is not"
   *  (Hunting the Beast superior). */
  | "actorReadyOpposingNot"
  /** "If the acting vampire is STILL READY at the end of combat" (Yawp
   *  Court) — the mirror of opposingNotReady: the ambush did not work,
   *  and the price is paid for trying.
   *  docs/crypt-and-uncontrolled-design.md §5 */
  | "opposingStillReady";

export type OutcomeEffect =
  /** "…the controller of the opposing minion burns N pool". */
  | { kind: "burnOpposingControllerPool"; amount: number }
  /** "…you can put this card on this acting vampire" — optional, so it is
   *  raised as a ChoiceFrame (§4). */
  | { kind: "attachToActor"; statics: PermanentStatics; tags: string[] }
  /** "…add N blood to a <clan> in your uncontrolled region" — automatic
   *  when there is exactly one recipient, a ChoiceFrame when several
   *  (the Brujah Debate precedent). */
  | { kind: "bloodToUncontrolled"; amount: number; clan?: string }
  /** "…the \<sect\> vampire takes N ENVIRONMENTAL damage" (Yawp Court) —
   *  the actor takes it, and a null source is what "environmental" has
   *  meant since Daring the Dawn.
   *  docs/crypt-and-uncontrolled-design.md §5 */
  | { kind: "selfDamage"; amount: number };

export interface PendingDamage {
  minion: MinionId;
  amount: number;
  source: MinionId | null;
  /** Aggravated damage can't be mended and burns a wounded vampire
   *  (p. 34). */
  aggravated: boolean;
  /** "This damage cannot be prevented by cards requiring Fortitude
   *  [for]" (Blood Fury, Soul Burn) — KRCG discipline abbreviations. A
   *  prevention card whose chosen mode requires any of these is not
   *  OFFERED; this is a gate on options, not on the op.
   *  docs/discipline-filtered-design.md §3 */
  noPreventBy?: string[];
  /** "N unpreventable environmental damage" (Weather Control). The
   *  damage-resolution window contains nothing but prevention, so such an
   *  item has no decision in it and is applied in `drainAutoPrevented`
   *  rather than opening a window whose only option is Pass.
   *  docs/round-recurring-combat-design.md §4 */
  unpreventable?: boolean;
  /** This damage came from a GUN strike (Kevlar Vest prevents 2 of it,
   *  and 1 of anything else). Set at the push chokepoint rather than
   *  recomputed in the prevention window, because the strike may have
   *  been replaced by then — a fact about an item belongs on the item.
   *  docs/last-combat-design.md §5 */
  fromGun?: boolean;
}

/**
 * "This combat, <the opposing minion | both combatants> take N damage
 * each round" (Carrion Crows, Weather Control) — the combat-card form of
 * the retainer static `combatRoundDamage`, which says the same sentence
 * from a card in play. docs/round-recurring-combat-design.md §3
 */
export interface CombatRoundDamageRider {
  /** Whose card granted it — "the opposing minion" is relative to them. */
  from: "acting" | "opposing";
  /** "the opposing minion" (Carrion Crows) vs "both combatants and each
   *  retainer on them" (Weather Control). */
  targets: "opposing" | "both";
  amount: number;
  /** "1R": a ranged environmental damage applies at any range; a
   *  non-ranged one only at close range, like retainer output (p. 31). */
  ranged: boolean;
  /** "during normal strike resolution" (Carrion Crows) vs "before range
   *  is determined each round" (Weather Control). */
  when: "beforeRange" | "strikeResolution";
  /** "…and each retainer on them" — retainer life is burned directly,
   *  since `PendingDamage.minion` is a MinionId and a retainer is not a
   *  minion. Honest only because such damage is unpreventable. */
  retainers?: boolean;
  unpreventable?: boolean;
  /** "…but the amount is increased by 1 in each subsequent round"
   *  (Weather Control superior) — `amount + (round - startRound)`. */
  escalate?: boolean;
  /** The round the rider was installed in; the baseline `escalate`
   *  counts from, so the amount stays a pure function of the frame. */
  startRound: number;
}

/** A chosen strike — the default hand strike, one set by a strike card,
 *  or a weapon's strike. */
export interface Strike {
  source: "hand" | "card" | "weapon";
  /** Card name when not a plain hand strike. */
  name: string | null;
  /** Added to effective strength for hand-based damage (Roundhouse). */
  handBonus: number;
  /** Fixed damage (weapons) — replaces strength-based damage. */
  damage: number | null;
  /** Ranged strikes work at any range (p. 30); hand-based only at close. */
  ranged: boolean;
  /** "Strike: combat ends" — resolves before all other strikes (p. 33). */
  combatEnds: boolean;
  /** Rider: unlock the striking vampire before combat ends (Majesty sup.). */
  unlockSelf: boolean;
  /** "Strike: dodge" — deals no damage, cancels the effects of the
   *  opposing strike on this minion (not retainer/environmental damage,
   *  not combat-ends); effective at any range (p. 33). */
  dodge: boolean;
  /** Damage this strike inflicts is aggravated (p. 34). */
  aggravated: boolean;
  /** "This strike CANNOT BE DODGED" (Dust Up) — a property of the blow,
   *  not of the round. It defeats only the dodge's cancellation of THIS
   *  strike; everything else about the dodge is unchanged.
   *  docs/last-combat-design.md §1 */
  undodgeable?: boolean;
  /** "Strike: steal N blood" — moves N blood/life from the victim to the
   *  striker instead of dealing damage (p. 33); ranged. 0 = not a steal. */
  stealBlood: number;
  /** "Strike: put this card on the opposing minion with N counters"
   *  (Touch of Oblivion) — the played card becomes an entry on the
   *  victim when the strike resolves (docs/counter-sinks-design.md). */
  attachToVictim?: {
    cardId: CardInstanceId;
    name: string;
    counters?: number;
    counterSink?: PermanentCounterSink;
    controller: SeatId;
    /** Statics the attached card grants its (unwilling) bearer. */
    statics?: PermanentStatics;
    /** "During their unlock phase, the attached minion burns 1 blood or
     *  life" (Sculpt the Flesh superior) — blood for a vampire, life for
     *  an ally (p. 22). docs/combat-attachments-design.md §1 */
    bearerUnlockBurn?: number;
    /** Extra tags the entry carries, so a counter-play clause
     *  (`vulnerableTo`) can find it. */
    tags?: string[];
  };
  /** "For each damage inflicted by this strike (even if prevented), burn
   *  1 counter from this card" (Weighted Walking Stick) — the card whose
   *  counters this strike spends. */
  depletesCard?: CardInstanceId;
  /** "Strike: send the opposing vampire to torpor or burn the opposing
   *  ally" (Touch of Oblivion superior) — not damage, so not prevented,
   *  but a dodge cancels it (p. 33). */
  incapacitate?: boolean;
  /** "Strike: burn equipment" (Heroic Might) — a strike that destroys
   *  rather than damages: it inflicts nothing and burns the named
   *  equipment card on the opposing minion, chosen at strike time so it
   *  rides in the option id. docs/action-attachments-design.md §4 */
  burnEquipment?: CardInstanceId;
  /** "Damage from this strike cannot be prevented by cards requiring
   *  Fortitude [for]" — carried onto the PendingDamage this strike
   *  inflicts. docs/discipline-filtered-design.md §3 */
  noPreventBy?: string[];
}

export const HAND_STRIKE: Strike = {
  source: "hand",
  name: null,
  handBonus: 0,
  damage: null,
  ranged: false,
  combatEnds: false,
  unlockSelf: false,
  dodge: false,
  aggravated: false,
  stealBlood: 0,
};

export interface CombatFrame {
  kind: "combat";
  acting: MinionId;
  actingSeat: SeatId;
  opposing: MinionId;
  opposingSeat: SeatId;
  /** True when this combat arose from a successful block (the `opposing`
   *  minion is the blocker) — Cats' Guidance / Forced Vigilance's "a vampire
   *  who has blocked" post-block-resolution window keys off this. */
  fromBlock: boolean;
  round: number;
  step: CombatStep;
  range: Range;
  /** Alternation protocol for maneuvers/presses: "cannot play two in a
   *  row"; two consecutive declines settle the step (p. 29, p. 32). */
  awaiting: "acting" | "opposing";
  declines: number;
  strikes: { acting: Strike | null; opposing: Strike | null };
  /** "normal" = the round's first strike pair; "additional" = an extra
   *  strike sub-round where only minions with additional strikes strike
   *  (p. 32). */
  strikeRound: "normal" | "additional";
  /** Pending additional strikes granted this round (Blur etc.) — each is
   *  performed in an "additional" sub-round, then decremented. */
  additionalStrikes: { acting: number; opposing: number };
  /** "1 ADDITIONAL STRIKE: DODGE" (Wind Dance superior) — the extra
   *  sub-round's strike is not a free choice, it is the strike the card
   *  names. Held per side and consumed with the additional strike it
   *  belongs to; while set, the `chooseStrike` step offers that strike
   *  and nothing else, so nothing has to enforce it again at resolution.
   *
   *  Distinct from `grantedStrikes`, which ADDS an option to an ordinary
   *  choice (Treasured Samadji's "can strike: dodge"). This one REPLACES
   *  the choice (docs/ledger-closeout.md §3). */
  forcedAdditionalStrike: { acting: StrikeKind | null; opposing: StrikeKind | null };
  /** "A minion cannot use more than one card or effect to gain additional
   *  strikes per round" (p. 32) — the "(limited)" source is spent. */
  usedLimitedAddl: { acting: boolean; opposing: boolean };
  /** "Gets a strength of N this combat" (Torn Signpost) — frame-local so
   *  it reverts automatically when combat ends. */
  strengthOverride: { acting: number | null; opposing: number | null };
  /** "This combat, you get +1 hand size" (Rage of Apedemak). Frame-local
   *  for the same reason as `strengthOverride`, and the expiry runs where
   *  `notifyCombatEnded` does — after the pop, at the engine's single
   *  `CombatEnded` site. docs/temporary-hand-size-design.md §3 */
  handSizeBonus?: HandSizeGrant[];
  /** Additive "gets +N strength this combat" (Form of the Wolf) — stacks
   *  on top of the printed strength or the override, whole-combat scope. */
  strengthBonus: { acting: number; opposing: number };
  /** "THIS ROUND, this vampire gets +1 strength" (Obedient Flesh) — reset
   *  when a new round begins, unlike strengthBonus. */
  strengthBonusRound: { acting: number; opposing: number };
  /** "Damage from this vampire's hand strikes is aggravated this round"
   *  (Claws of the Dead, Wolf Claws) — per-round, reset each round. */
  handStrikesAggravated: { acting: boolean; opposing: boolean };
  /** "All damage inflicted on vampires during the resulting combat is
   *  aggravated" (Dawn Operation). Unlike `handStrikesAggravated` this is
   *  combat-scoped (never reset per round), covers BOTH sides, and applies
   *  to every source of damage rather than only hand strikes. Read in
   *  exactly one place: `pushPendingDamage`. */
  allDamageAggravated?: boolean;
  /** The impulse cycle for the CURRENT pending-damage item's prevention
   *  window. Damage resolution used to ask only the victim's controller,
   *  which made "prevent damage to a minion in combat" unplayable by a
   *  minion not in the combat — and p. 28 says ANY Methuselah's minions
   *  may play those cards. Rebuilt per damage item, victim's controller
   *  first (p. 31). docs/outside-combat-design.md */
  damageCycle?: ImpulseCycle;
  /** `pendingDamage.length` when `damageCycle` was built. Prevention can
   *  REMOVE the item at the head, which silently promotes the next one —
   *  and reusing the old cycle for it would skip that victim's prevention
   *  window entirely. Comparing lengths rebuilds the cycle whenever the
   *  head changes, without needing object identity to survive a reload. */
  damageCycleLen?: number;
  /** "Neither combatant can strike during this round" (One With the Land) —
   *  the round number in which strikes are suppressed, else null. */
  suppressStrikesRound: number | null;
  /** Press credits granted by cards this round, spendable in the press
   *  step to continue — or to cancel a press to continue (p. 32). */
  presses: { acting: number; opposing: number };
  /** "1 optional press each combat" credits (retainer statics): granted at
   *  combat start, persist across rounds until spent. */
  pressesCombat: { acting: number; opposing: number };
  /** "1 optional maneuver during that combat" credits (rush riders):
   *  persist across rounds until spent, usable in the range step. */
  maneuverCredits: { acting: number; opposing: number };
  /** "This round, this vampire gets 1 optional maneuver, ONLY usable to
   *  get to close range" (Angel's Gift). Its own counter because
   *  `maneuverCredits` is combat-long and unrestricted: this one is reset
   *  each round beside `handStrikesAggravated` and offered only at long
   *  range. It carries both restrictions because the one card that grants
   *  it carries both (docs/play-from-hand-design.md §8). */
  closeManeuvers: { acting: number; opposing: number };
  /** "…can prevent 1 damage during the FIRST ROUND of the resulting
   *  combat" (Precognition). Spent before `preventCredits`, being the
   *  use-it-or-lose-it pool — the rule `closeManeuvers` follows.
   *  docs/blocker-riders-design.md §3 */
  preventCreditsFirstRound: { acting: number; opposing: number };
  /** "They can burn N blood to unlock after block resolution" (Truth in
   *  Darkness) — an offer to that side while combat runs; 0 means none. */
  unlockForBlood: { acting: number; opposing: number };
  /** "…they can strike: combat ends during the first round" (Night
   *  Terrors) — a strike granted by a rider rather than by a card. */
  grantedCombatEnds: { acting: boolean; opposing: boolean };
  /** SPECIFIED strikes a card has granted, offered in the `chooseStrike`
   *  step and SPENT when taken: "1 additional ranged strike: burn weapon"
   *  (Voracious Vermin), "once each combat, this Ravnos can strike:
   *  dodge" (Treasured Samadji). A free additional strike would be a hand
   *  strike, because nothing else would ever offer these.
   *
   *  `grantedCombatEnds` is deliberately NOT folded in here: it is read
   *  at four sites with two conditions attached, so it stays a boolean
   *  meaning one specific thing (docs/weapon-riders-design.md §1).
   *  Optional, so existing fixtures are untouched. */
  grantedStrikes?: { acting: GrantedStrike[]; opposing: GrantedStrike[] };
  /** Blood a combatant actually BURNED to mend damage this round — not
   *  the damage INFLICTED, which `damageTakenThisRound` holds. The two
   *  come apart for a vampire who goes to torpor with too little blood,
   *  and for an ally (which burns life, not blood), which is why Taste
   *  of Vitae needs its own tally. docs/last-combat-design.md §2 */
  bloodLostThisRound?: { acting: number; opposing: number };
  /** "1 optional press, ONLY USABLE TO CONTINUE COMBAT, each combat"
   *  (Righteous Blade) — a third credit pool beside `presses` and
   *  `pressesCombat`, offered only for `press:continue` and SPENT FIRST,
   *  the `closeManeuvers` rule. docs/weapon-riders-design.md §4 */
  pressesContinueOnly?: { acting: number; opposing: number };
  /** "Strikes that are not hand strikes cannot be used this round (BY
   *  EITHER COMBATANT)" (Immortal Grapple) — a single boolean rather
   *  than the usual per-side pair, because reaching both combatants is
   *  what the card is. Round-scoped; gates OPTIONS.
   *  docs/round-end-design.md §2 */
  handStrikesOnly?: boolean;
  /** "If another round of combat occurs, that round is at close range
   *  (skip the determine range step for that round)" (Immortal Grapple
   *  superior). The boundary already forces close range; this skips the
   *  step a maneuver would otherwise reopen. */
  skipRangeNextRound?: boolean;
  /** "If any damage from this strike is successfully inflicted, they take
   *  +N damage FROM THIS STRIKE" (Target Vitals) — added at the damage
   *  chokepoint only to an item that already has amount > 0, which is
   *  what "successfully inflicted" means. docs/round-end-design.md §3 */
  aimBonus?: { acting: number; opposing: number };
  /** "A minion can play only one AIM each strike" — a per-KEYWORD limit,
   *  where `combatLimit` counts by card name. Cleared whenever a strike
   *  slot is filled or a new sub-round begins. */
  aimsThisStrike?: MinionId[];
  /** Strike NAMES whose resolution burned a combatant this combat
   *  (Sword of the Archangel's "if the opposing vampire is burned during
   *  this weapon's strike resolution"). Written at the one chokepoint for
   *  damage actually inflicted; the name is enough, since a weapon's
   *  strike carries its card's name. docs/weapon-riders-design.md §6 */
  burnedByStrike?: string[];
  /** The mirror: "the opposing minion CANNOT strike: combat ends during
   *  the first round of that combat" (Hunter's Mark superior). Keyed by
   *  the side that is BARRED; a gate on options, checked beside
   *  `PermanentStatics.opposingCannotCombatEnds`, which says the same
   *  thing from a card in play. docs/rush-outcome-design.md §5 */
  noCombatEndsFirstRound: { acting: boolean; opposing: boolean };
  /** "Can prevent N damage during the resulting combat" (Beast Meld) — a
   *  credit spent in the damage-resolution step, unlike a prevention card,
   *  which resolves on the spot. Persists across rounds until spent. */
  preventCredits: { acting: number; opposing: number };
  /** "This combat, this vampire can prevent N damage EACH ROUND" (Bear's
   *  Skin superior, Tranquility Shield) — a RATE, not a pool: granted
   *  once, never reset, and refreshed every round by zeroing
   *  `preventPerRoundUsed`. Neither `preventCredits` (a combat-long pool)
   *  nor `preventCreditsFirstRound` (a round-1 pool) can express it.
   *  docs/round-recurring-combat-design.md §2 */
  preventPerRound: { acting: number; opposing: number };
  /** How much of that rate has been spent this round — reset at the round
   *  boundary beside `handStrikesAggravated`. */
  preventPerRoundUsed: { acting: number; opposing: number };
  /** "This combat, <X> takes N damage each round" (Carrion Crows, Weather
   *  Control). docs/round-recurring-combat-design.md §3 */
  roundDamage: CombatRoundDamageRider[];
  /** "If a damage is successfully inflicted on this vampire in a given
   *  round, any ADDITIONAL damage inflicted on them in the same round is
   *  automatically prevented" (Flesh of Marble) — "nonAgg" at [pro],
   *  where aggravated damage is exempt, "all" at [PRO], which prints the
   *  exception away. docs/round-recurring-combat-design.md §5 */
  autoPreventAfterFirst: {
    acting: "nonAgg" | "all" | null;
    opposing: "nonAgg" | "all" | null;
  };
  /** Damage points actually APPLIED to each combatant this round — the
   *  input `autoPreventAfterFirst` reads ("successfully inflicted", not
   *  merely queued). Reset at the round boundary. */
  damageTakenThisRound: { acting: number; opposing: number };
  /** "This combat, frenzy cards cannot be used on this vampire"
   *  (Tranquility Shield) — a gate on OPTIONS: a frenzy mode is not
   *  offered when the combatant it would be used on is immune.
   *  docs/round-recurring-combat-design.md §6 */
  frenzyImmune: { acting: boolean; opposing: boolean };
  /** The flags in `restrict[side]` were set by a FRENZY card. Provenance,
   *  not an undo log: "cancel the effects of frenzy cards already used on
   *  this vampire" removes exactly what a frenzy card put there, and this
   *  plus `PlayCostMod.fromFrenzy` is everything a frenzy card in the V5
   *  pool can aim at the other combatant. */
  frenzyRestrict: { acting: boolean; opposing: boolean };
  /** Card instances whose "each round of combat" ability was used this
   *  round (War Ghoul's prevention) — cleared when a new round begins. */
  usedThisRound: CardInstanceId[];
  /** The same, scoped to the whole COMBAT rather than the round
   *  ("can prevent 1 damage each combat", Guardian Angel) — never reset
   *  while the frame lives. docs/conditional-statics-design.md §4 */
  usedThisCombat: CardInstanceId[];
  /** Combat-card names played this round / this combat, for the
   *  "only one X each round/combat" limits (p. 32). */
  playedThisRound: string[];
  playedThisCombat: string[];
  /** Using a weapon's maneuver commits that weapon's strike for the
   *  round (.44 ruling, p. 47); one weapon maneuver per combat. */
  committedStrike: { acting: CardInstanceId | null; opposing: CardInstanceId | null };
  usedWeaponManeuver: { acting: CardInstanceId | null; opposing: CardInstanceId | null };
  /** "This combat, the opposing minion cannot maneuver / press / use
   *  equipment" (Terror Frenzy) — per-side combat restrictions. */
  restrict: {
    acting: { maneuver: boolean; press: boolean; equipment: boolean };
    opposing: { maneuver: boolean; press: boolean; equipment: boolean };
  };
  /** "The opposing vampire's strikes with weapons inflict no damage this
   *  round" (Blood Fury, Blood Rage, Soul Burn) — keyed by the STRIKING
   *  side, reset each round beside `handStrikesAggravated`. Only true
   *  weapon strikes (`Strike.source === "weapon"`) are affected; a
   *  card-granted fixed-damage strike is not a weapon.
   *  docs/discipline-filtered-design.md §4 */
  weaponDamageNullified: { acting: boolean; opposing: boolean };
  /** "Strike cards cost the acting minion +1 blood or life during the
   *  resulting combat" (Ensnare a Beast superior) — play-cost modifiers
   *  scoped to this combat. docs/play-cost-design.md §2 */
  playCostMods: PlayCostMod[];
  /** "After combat ends, <do X>" (Catatonic Fear, Pass Through Shadow,
   *  Form of Mist) — riders applied once the frame has POPPED, where
   *  `notifyCombatEnded` runs. docs/after-combat-ends-design.md §2 */
  afterCombatEnds: AfterCombatRider[];
  /** "Prevent all damage from the opposing minion's strikes THIS ROUND"
   *  (Rolling with the Punches superior) — per side, reset each round,
   *  checked at the `pushPendingDamage` chokepoint (§4). */
  preventAllFrom: { acting: boolean; opposing: boolean };
  /** Damage awaiting prevention + mend, acting minion's first (p. 29). */
  pendingDamage: PendingDamage[];
  willContinue: boolean;
  endedPrematurely: boolean;
  cycle: ImpulseCycle;
}

/** A successful political action's referendum (p. 27–28, politics
 *  design): terms chosen by the caller only now (the one exception to
 *  details-at-announcement, p. 25), then polling on an impulse cycle
 *  (casting is an effect and rewinds; quiescence closes polling), then
 *  tally — more for than against passes, ties fail. */
export interface ReferendumFrame {
  kind: "referendum";
  actionId: ActionId;
  caller: SeatId;
  /** Handler key of the political action card that called this; empty
   *  for a blood-hunt referendum (not a card, p. 35). */
  cardName: string;
  /** Instance id of the calling card, kept so a title-granting referendum
   *  can attach it on a pass (or burn it on a fail). Null for blood hunts. */
  cardInstanceId?: CardInstanceId | null;
  /** "political": a political action's referendum (terms, calling-card
   *  vote). "bloodHunt": automatic after diablerie — no terms, no
   *  calling card, and on a pass the diablerist is burned. */
  variant: "political" | "bloodHunt";
  /** The diablerist, burned if a blood-hunt referendum passes. */
  bloodHuntTarget: MinionId | null;
  /** This referendum was called by a card ALREADY IN PLAY granting a
   *  political action ("vampires can call a referendum to burn this
   *  card"), not by a political action card from hand. Carried so one
   *  handler can tell its own two referendums apart (War of Ages).
   *  docs/pool-drain-design.md §6 */
  fromCardInPlay?: boolean;
  /** The vampire that called this political action — the "acting minion"
   *  for the polling-step action-modifier/reaction split (p. 28). Null
   *  for blood-hunt referendums (no calling minion). */
  callingMinion: MinionId | null;
  /** Bonus votes granted per seat by cards played during polling
   *  (docs/polling-votes-design.md §3), cast as a source. */
  voteGrants: Record<SeatId, number>;
  /** "Non-<sect> vampires cannot cast votes or ballots this referendum"
   *  (Closed Session, Private Audience, Cardinal Benediction) — restricts
   *  the per-vampire title vote sources to this sect. */
  voteRestriction?: { sect: Sect };
  /** "Force a vampire to abstain (this cancels their votes and ballots)"
   *  (Scalpel Tongue, Telepathic Vote Counting). Distinct from
   *  `usedSources`, which means "already spent" — a vampire who never
   *  voted has nothing spent but may still be made to abstain.
   *  docs/abstain-gate-design.md */
  abstaining?: MinionId[];
  /** "Vampires who do not follow the Path of \<x\> get −1 vote" (Absolute
   *  Tyranny superior) — a per-vampire vote modifier scoped to THIS
   *  referendum, where every other vote modifier is either a bonus to the
   *  player (`modifyVotes`) or a permanent aura from a card in play (New
   *  Carthage). Applied where votes are counted and clamped at zero the
   *  same way. Reaches only votes NOT YET CAST: a source spends its votes
   *  once, at a count read when it casts.
   *  docs/path-cards-design.md §§4–5 */
  voteModifiers?: Array<{ amount: number; exceptPath?: string }>;
  /** "…once results are tallied" (Scorn of Adonis) — effects that outlive
   *  the tally, applied after ReferendumResolved whatever the outcome. */
  postTally?: Array<{ kind: "burnPoolVotedAgainst"; amount: number }>;
  /** Yoruba Shrine: the referendum resolves normally but as a FAILURE.
   *  Not the same as cancelling it (§3 of the design doc). */
  forcedFail?: boolean;
  /** Día de los Muertos: this referendum "passes automatically (skip the
   *  polling step)". Terms are still chosen — the card names only the
   *  polling step, and terms are what the referendum DOES — and the tally
   *  is then written directly with a margin of 0: no votes were cast.
   *  docs/politics-locations-design.md §4 */
  autoPass?: boolean;
  /** Telepathic Vote Counting: the referendum never resolves at all — no
   *  result, no effects, and the calling card is returned rather than
   *  burned. Dropped by settle instead of being tallied. */
  cancelled?: boolean;
  /** "terms" and "polling" are the two steps of p. 27–28;
   *  "afterResolution" is the impulse a passed referendum offers before
   *  its frame leaves the stack (docs/referendum-margin-design.md §2). */
  step: "terms" | "polling" | "afterResolution";
  /** The tally, recorded when it is taken so the after-resolution window
   *  can read it and the second pass does not recompute it. `margin` is
   *  votesFor − votesAgainst — "each vote by which the referendum
   *  passed", which nothing had ever needed. */
  votesFor?: number;
  votesAgainst?: number;
  margin?: number;
  passed?: boolean;
  /** The caller's choices (allocations, chosen seats/minions). */
  terms: Record<string, string>;
  votes: Array<{ seat: SeatId; source: string; count: number; inFavor: boolean }>;
  /** Spent vote sources: minion ids, "edge", "caller", "cardvote:<seat>". */
  usedSources: string[];
  cycle: ImpulseCycle;
}

/** After a leave-torpor action is blocked by a vampire (p. 24), that
 *  blocker's controller may diablerise the acting torpor vampire or
 *  decline; either way the leave-torpor action then fails. */
export interface DiablerieOfferFrame {
  kind: "diablerieOffer";
  /** The blocking vampire, who may commit the diablerie. */
  diablerist: MinionId;
  /** The acting (torpor) vampire being offered up. */
  victim: MinionId;
  /** The blocker's controller — the seat that decides. */
  offerSeat: SeatId;
}

/**
 * "The card asks one Methuselah a question" (docs/choice-frames-design.md)
 * — a choice that is part of a card's own resolution: not an action, not a
 * card play, not a referendum. Only `seat` decides, immediately, with no
 * impulse cycle: nobody responds to which vampire you picked.
 */
export interface ChoiceFrame {
  kind: "choice";
  seat: SeatId;
  /** The card that raised it — the dispatch target for options/apply. */
  cardName: string;
  cardId: CardInstanceId;
  /** Which question, for cards that raise more than one. */
  key: string;
  /** Context fixed when the question was raised. */
  params: Record<string, string>;
  /** "You can …" offers a decline; "choose a …" does not (and the frame
   *  pops harmlessly when there is nothing to choose). */
  optional: boolean;
}

export interface CardPlayFrame {
  kind: "cardPlay";
  card: CardInstance;
  seat: SeatId;
  minion: MinionId | null;
  mode: DisciplineLevel | null;
  /** Handler-specific choices made at play time (e.g. Deflection target). */
  params: Record<string, string>;
  /** True when this play announces an action (action cards): cost and the
   *  once-per-turn record are deferred to the action, and a cancel means
   *  the minion never locks and may replay the card (p. 16). */
  asAction: boolean;
  /** True for master cards — cancel-as-played effects check this. */
  isMaster: boolean;
  /** Printed card type, denormalized beside `isMaster` for the same
   *  reason: a cancel-as-played effect names the type it may cancel
   *  ("cancel a COMBAT card requiring Auspex", "cancel a REACTION card…",
   *  Hide the Mind). A dual-typed card is both, which matches the printed
   *  type line. docs/discipline-filtered-design.md §5 */
  isCombat: boolean;
  isReaction: boolean;
  /** This play declares a STRIKE (its mode's window is
   *  `combat.chooseStrike`), denormalized for the same reason as the
   *  flags above: "cancel a strike card as it is played" (The Vozhd of
   *  Gravesend) must not read another card's spec. Optional, so every
   *  existing fixture and saved log is untouched.
   *  docs/vozhd-allies-design.md §5 */
  isStrike?: boolean;
  /** Printed keywords ("Grapple.", "Aim."), denormalized at push for the
   *  same reason as the flags above — Sword of the Archangel cancels "a
   *  grapple or aim card". docs/weapon-riders-design.md §5 */
  keywords?: string[];
  /** Frenzy keyword (p. 32), denormalized for the same reason: a frenzy
   *  card's effects have to be identifiable once applied, so the ops that
   *  aim one at the opposing combatant can tag what they set.
   *  docs/round-recurring-combat-design.md §6 */
  isFrenzy: boolean;
  /** For a frenzy card, whether this play is used ON the other combatant
   *  (Terror Frenzy) rather than on its own player (Rage of Apedemak) —
   *  the question "cancel a frenzy card as it is played ON a Salubri you
   *  control" (Meditative Grove) asks, denormalized so no card has to
   *  read another card's spec. docs/blood-locations-design.md §6 */
  frenzyOnOpponent?: boolean;
  /** "Their controller can burn N pool to CANCEL this card as it is
   *  played" (Golconda: Inner Peace; True Love's Face superior wants the
   *  same with a different payer).
   *
   *  A cancel paid in POOL by a Methuselah, with no card involved — every
   *  other cancel in the engine is a card cancelling a card. It is a
   *  built-in option (`cancelpay:<cardId>`) rather than a ChoiceFrame,
   *  because the as-played window already cycles every seat and the payer
   *  is therefore already being asked — the Dawn Operation ruling.
   *  docs/cross-table-masters-design.md §2 */
  payToCancel?: {
    seat: SeatId;
    pool: number;
    /** "They can DISCARD TWO COMBAT CARDS to cancel this card as it is
     *  played" (Target Vitals) — the same gate, a different currency.
     *  docs/round-end-design.md §3 */
    discardCombatCards?: number;
  };
  /** KRCG abbreviations of the Disciplines this card's chosen mode
   *  requires, denormalized when the frame is pushed so a
   *  cancel-as-played effect can filter by them ("cancel a combat card
   *  requiring Auspex", Hide the Mind) with a plain array read.
   *  docs/discipline-filtered-design.md §2 */
  requires: string[];
  /** What this play ACTUALLY cost, after every play-cost modifier
   *  (docs/play-cost-design.md §3). Recorded rather than recomputed so a
   *  refund returns what was paid — a `once` modifier is consumed at
   *  payment, so recomputing at cancel time would give a different
   *  answer. Zero for an action card, which pays at resolution. */
  paid: { blood: number; pool: number };
  canceled: boolean;
  cycle: ImpulseCycle;
}

export type Frame =
  | TurnFrame
  | ActionFrame
  | BlockAttemptFrame
  | CombatFrame
  | CardPlayFrame
  | ReferendumFrame
  | DiablerieOfferFrame
  | ChoiceFrame;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface CommandLogEntry {
  seq: number;
  seat: SeatId;
  option: string;
}

export interface GameState {
  /** Clockwise table order; the prey of seats[i] is the next standing seat
   *  clockwise (p. 15). */
  seats: SeatState[];
  edge: SeatId | null;
  frames: Frame[];
  eventLog: GameEvent[];
  /** Replaying (seq, option) pairs through the same engine version and RNG
   *  seed reproduces the game exactly (§7). */
  commandLog: CommandLogEntry[];
  decisionSeq: number;
  rngState: number;
  /** Counter behind generated action ids. Part of the state, like
   *  `rngState`, so that replaying a command log in a fresh engine — undo,
   *  a loaded save, a batch of AI games in one process — reproduces the
   *  SAME ids, not just the same game. Optional: undefined means 0, so
   *  existing fixtures need no change. */
  idSeq?: number;
  /**
   * WHO HAS LOOKED AT WHICH CARD — seat → the card instances that seat has
   * been shown and therefore still knows.
   *
   * This is the one thing structural masking cannot express, and it was
   * recorded as a gap from the day `PlayerView` was finished: an effect
   * that reveals a hand means the viewer keeps knowing those cards
   * afterwards, and `redactFor` is a pure function of the ZONE a card is
   * in, which has not changed.
   *
   * It became real with Revelations (101627): "look at your prey's hand
   * and discard one card of your choice from it". A hotseat human simply
   * remembers the cards they saw and did not take; an AI seat had nothing
   * to remember them with.
   *
   * Keyed by CARD INSTANCE, and deliberately never expired. You saw that
   * physical card; while it stays where it was, you still know it, and if
   * it is played or discarded it becomes public anyway. Optional — the
   * `idSeq` precedent — so every fixture and saved command log is
   * untouched. docs/knowledge-design.md
   */
  knowledge?: Record<SeatId, CardInstanceId[]>;
  /** Engine safeguard (not a game rule): a turn limit after which the game
   *  ends with no winner. Used by the fuzz harness; null = unlimited. */
  maxTurns: number | null;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function getSeat(state: GameState, id: SeatId): SeatState {
  const seat = state.seats.find((s) => s.id === id);
  if (!seat) throw new Error(`unknown seat: ${id}`);
  return seat;
}

export function getMinion(state: GameState, id: MinionId): MinionState {
  const m = findMinion(state, id);
  if (!m) throw new Error(`unknown minion: ${id}`);
  return m;
}

/** Null-safe lookup — a burned minion (ally) simply no longer exists. */
export function findMinion(state: GameState, id: MinionId): MinionState | null {
  for (const seat of state.seats) {
    const m = seat.minions.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

export function standingSeats(state: GameState): SeatState[] {
  return state.seats.filter((s) => !s.ousted);
}

export function findUncontrolled(
  state: GameState,
  seatId: SeatId,
  minionId: MinionId,
): UncontrolledEntry {
  const entry = getSeat(state, seatId).uncontrolled.find(
    (u) => u.card.id === minionId,
  );
  if (!entry) throw new Error(`no uncontrolled vampire ${minionId} for ${seatId}`);
  return entry;
}

export function isReady(m: MinionState): boolean {
  return !m.inTorpor;
}

/** May act/block/react without a wake: ready and unlocked. With a wake, a
 *  locked minion may block and react (but is still locked, p. 44). */
export function canReact(m: MinionState): boolean {
  // Expulsion's "cannot play reaction cards, block …" is read here because
  // this predicate gates BOTH reaction enumeration and blockOptions — one
  // chokepoint for two of the card's three verbs (the third, casting
  // votes, is read in the vote enumeration).
  if (m.expelledThisTurn) return false;
  return isReady(m) && (!m.locked || m.awake);
}

/** May take an action: ready, unlocked, and not a just-recruited ally
 *  (p. 22 — the flag never gates blocking or reacting). */
export function canAct(m: MinionState): boolean {
  if (!isReady(m) || m.locked || m.cannotActThisTurn) return false;
  // The rulebook's "stuck" vampire (p. 47): a vampire with no blood MUST
  // hunt (p. 21), and all mandatory actions come before any others
  // (p. 19) — so one barred from hunting again this turn (Change of
  // Target) has an outstanding mandatory action it can never take, and
  // can perform NO action at all. Gated here rather than at each
  // enumerator so a card action cannot slip past it.
  // docs/end-action-design.md §4
  if (m.kind === "vampire" && m.blood === 0 && (m.cannotRepeat ?? []).includes("hunt")) {
    return false;
  }
  return true;
}
