# Card Effect Primitives — Design (Phase 3)

**Status: v1, in use.** Companion to `docs/impulse-design.md` (which governs
*when* effects may be played; this document governs *what cards are made
of*). Architecture principle 6: most cards are **data** referencing a small
vocabulary of parameterized primitives; a bespoke tail gets real code
behind the same interface.

## 1. The shape

A card implementation is a `CardSpec` — plain data:

```ts
interface CardSpec {
  krcgId: number;          // stable KRCG id, matches registry.json
  name: string;            // handler key; must match registry name
  cardType: "actionModifier" | "reaction";
  bloodCost: number;
  usable: UsabilityRule[]; // card-text timing clauses, as data
  modes: CardMode[];       // one per discipline level printed on the card
}

interface CardMode {
  level: "basic" | "superior";
  discipline: string | null;   // KRCG abbrev ("dom"); null = no requirement
  effects: EffectPrimitive[];  // applied in order on resolution
}
```

The **compiler** (`compileSpec`) turns a spec into the engine's
`CardHandler` — the `options()` legality function and the `resolve()`
event emitter. Cards never touch the engine loop (impulse-design §6); the
compiler is the single place where card-type rules live:

- Action modifiers: played only by the acting minion, which need not be
  unlocked; once per action per minion.
- Reactions: played by another Methuselah's ready minions, unlocked or
  woken (or *locked-only* for wake cards); once per action per minion;
  reactions never lock the minion.
- Cost is payable or the option is not offered; non-action cards pay on
  play regardless of outcome.
- A vampire with the superior level is offered **both** modes (rulebook
  p. 6: "may opt to use either").

## 2. The primitive vocabulary (v1)

| Primitive | Parameters | Emits | Extra legality the compiler enforces |
|---|---|---|---|
| `modifyBleed` | amount, limited | `BleedAmountModified` | bleed actions only; "(limited)": not if another modifier already increased the bleed (p. 20) |
| `modifyStealth` | amount | `StealthModified` | only "when needed": an ongoing block attempt with intercept ≥ stealth (p. 26) |
| `modifyIntercept` | amount | `InterceptModified` | only "when needed": played by the current blocking minion while stealth > intercept (p. 26) |
| `wake` | — | `MinionWoke` | playing minion is locked; also legal inside the as-played window (p. 44) |
| `redirectBleed` | lockSelf | `TargetChanged` (+ `MinionLocked`) | never while a block attempt is ongoing (p. 27 B.2); target may not be the acting minion's controller or an ousted seat |
| `actionBleed` | bonus | (announces a bleed action) | action cards only; the acting minion must not have bled this turn; the bonus is not "(limited)" |
| `actionStealth` | amount | `StealthModified` at announce | action cards only — "+1 stealth action" |
| `addUncontrolledBlood` | amount, youngerOnly | `UncontrolledBloodAdded` on success | action cards only; target (an uncontrolled vampire, younger than the actor if required) fixed at announcement |
| `strikeHandBonus` | bonus | strike set | combat, choose-strike window, own strike unchosen |
| `strikeCombatEnds` | unlockSelf | strike set (+`MinionUnlocked`) | combat, choose-strike window; resolves before all other strikes |
| `setStrength` | value | `StrengthSet` | combat, before-range window; lasts the whole combat (frame-scoped) |
| `maneuver` | — | `RangeSet` | combat, range step, own maneuver moment (alternation) |
| `pressToContinue` | — | `PressUsed` | combat, press step, own press moment; not once a press-to-continue stands |
| `prevent` | base, perBloodX | `DamagePrevented` (+`BloodBurned` X) | combat, damage resolution, only by the minion taking the damage |
| `grantPress` | — | `PressGranted` | rider: a press credit spendable in this round's press step (continue or cancel) |
| `press` | continueOnly | `PressUsed` | combat, press step, own press moment |
| `lockMinion` / `addBloodToReadyVampire` / `moveOwnVampireBloodToPool` | (various) | `MinionLocked` / `BloodGained` / `BloodBurned`+`PoolGained` | one-shot masters, master phase window, gated on a remaining master phase action |
| `burnIfNotBlocking` | amount | deferred `BloodBurned` | rider registered on the action; applies at resolution unless the minion was the successful blocker |
| `poolGainOnBleedSuccess` / `bloodOnBleedSuccess` | amount, scope, youngerOnly | `PoolGained` / `BloodGained` / `UncontrolledBloodAdded` | action-card riders, contingent on a successful bleed of 1+ |

Mode features: `discipline` may be a list ("any one of"); multiple modes may
share a level (`variant` distinguishes "Maneuver or press"); `usable` rules
attach per-mode (Telepathic Misdirection's superior is a Deflection).
`delayedReplace` defers the replacement draw ("until your next unlock
phase" / "until after this action"). Master specs carry `poolCost` and
`trifle` (one refunded master phase action per phase); out-of-turn masters
(Sudden Reversal, hand-rolled) consume the next master phase's action.

**Permanents** (cards in play): a spec may declare `permanent` (seat-level
location or bearer-attached equipment) with `statics` — hand size,
transfers, intercept, stealth, `combatRoundDamage` (retainer combat
output), `pressPerCombat`, `opposingCannotCombatEnds` (Dog Pack) — that
derived values and the combat engine fold continuously, and `tags`
("vehicle": one per minion; "weapon"). Equipment compiles to an equip
action (undirected, +1 stealth, cost at resolution, attaches on success,
burned if blocked). `unique` blocks a second own copy (cross-player
uniqueness contests are NOT yet modeled — see CLAUDE.md gaps). Beyond
statics, in-play cards act through handler hooks: `abilityOptions` /
`useAbility` (lock-to-use, phase-limited "During X do Y" latches, weapon
maneuvers/strikes with the .44 commitment ruling) and
`onControllerUnlock` (automatic unlock-phase card text, Double Deuce).
The bespoke tail grew accordingly: The Barrens, Blood Doll, Vessel,
.44 Magnum, and the spec-plus-overlay allies/retainers (Double Deuce,
47th Street Royals, Homunculus).

**Retainers and allies** (allies/retainers gate,
docs/allies-retainers-design.md): `cardType: "retainer"` compiles to an
employ action (undirected, +1 stealth, attaches with `retainerLife` from
the mode chosen at announcement); `cardType: "ally"` compiles to a
recruit action — on success the ally becomes a minion (`kind: "ally"`,
life in the `blood` field, no disciplines, cannot act the turn it is
recruited) whose own card text rides as a self-attached permanent entry.

## 3. Usability rules (card-text timing clauses, as data)

`onlyDuringBleed` · `bleedTargetsYou` · `afterBlocksDeclined` ·
`byLockedMinion` · `oncePerUnlockPhase` · `byVampire` ("only usable by a
… vampire" — excludes allies, who may otherwise play requirement-free
minion cards). Each maps to one predicate in the compiler; card text like
Deflection's "after blocks are declined" becomes
`["bleedTargetsYou", "afterBlocksDeclined"]` and nothing else.

## 4. The bespoke tail

When a card's behavior exceeds the vocabulary (Forced Awakening's
"burn 1 blood if they do not block", Faceless Night's superior rider), the
choice is: **extend the vocabulary** if the pattern recurs, or write a
hand-rolled `CardHandler` beside the compiled ones — same interface, same
registration, same tests. Never special-case the engine.

## 5. Support flow (CLAUDE.md registry rules)

A card is flipped in `config/supported.json` only when it has (a) an
implementation in `src/cards/effects/cards.ts` and (b) a passing
deterministic scenario test. `tests/cards/supported.test.ts` enforces the
metadata side mechanically: every supported id has an implementation whose
name/cost/discipline match the generated registry, and every
implementation is flagged supported.

## 6. Current supported set

**174 cards** — the authoritative list is `config/supported.json`, enforced
against the implementations and the generated registry by
`tests/cards/supported.test.ts`; every card has a scenario test under
`tests/cards/`. Highlights of what each wave proved out:

| KRCG id | Card | Exercises |
|---|---|---|
| 100401 | Conditioning | bleed modifier, "(limited)" |
| 100518 | Deflection | redirect, basic-locks/superior-doesn't, decline timing |
| 101321 | On the Qui Vive | wake, locked-only, once per unlock phase |
| 100644 | Enhanced Senses | intercept "when needed", block-attempt scope |
| 101125 | Lost in Crowds | stealth "when needed" |
| 100845 | Govern the Unaligned | action card: enhanced bleed, deferred cost, superior uncontrolled-blood |
| 100999 | Intimidation | action card: modal basic/superior bleed |
| 100640 | Enchant Kindred | action card: younger-target enumeration |

Action cards additionally exercise: announcement as a card play (cancel
window applies; a canceled action card never locks its minion and is
replayable), cost paid only at resolution, card burned on success or
block, once-per-turn named-card limit, and enhanced bleeds counting as
real bleed actions (Deflection works on them; bleed-once-per-turn holds).

Combat cards (the combat gate):

| KRCG id | Card | Exercises |
|---|---|---|
| 102215 | Roundhouse | strike cards, hand-based damage bonus |
| 101144 | Majesty | combat-ends first-resolution, unlock rider, combat-card cost |
| 101993 | Torn Signpost | before-range window, combat-scoped strength override |
| 100918 | Hidden Strength | prevention, X-blood variable amounts, press-credit rider |
| 100077 | Apportation | maneuvers (range alternation), presses (continue) |

Allies and retainers (allies/retainers gate):

| KRCG id | Card | Exercises |
|---|---|---|
| 101411 | Political Ally | recruit action, cannot-act-this-turn, ally bleed (printed 3), unique |
| 102220 | Double Deuce | ally stealth static, automatic unlock-phase regen (`onControllerUnlock`) |
| 102217 | 47th Street Royals | in-play ally ability mid-action, burn-self, bleed reduction, impulse rewind on effect use |
| 101628 | Revenant | employ action, blood cost at resolution, retainer life, intercept static |
| 101249 | Mr. Winthrop | free employ, unique retainer |
| 101550 | Raven Spy | discipline-moded employ ([ani]/[ANI] life) |
| 101254 | Murder of Crows | `combatRoundDamage` ranged (environmental, source-less) |
| 102317 | Dread Mastiff | `combatRoundDamage` close-only; superior `pressPerCombat` |
| 100568 | Dog Pack | `opposingCannotCombatEnds` gating strike enumeration |
| 100932 | Homunculus | any-Methuselah unlock-phase ability window |

Rush actions (docs/rush-actions-design.md):

| KRCG id | Card | Exercises |
|---|---|---|
| 102306 | Umbrous Clutch | `actionEnterCombat` hand card; superior maneuver rider (`maneuver:credit`) |
| 100747 | Fleetness | modal bleed/rush; locked-only targets; +1 stealth action |
| 102344 | Twisted Bloodhound | employer rush via entry `actionOptions`; p. 20 per-copy per-turn limit |
| 102286 | Aggressive Corpse | ally self-rush; recruit blood cost |
| 102324 | Freakish Conglomeration | per-mode ally life; mandatory unlock life burn |
| 102144 | War Ghoul | rush (vampires only); enter-play burn chosen at announcement; each-round prevention; lock+burn-self to burn a location |

Politics (docs/politics-design.md): a `politicalAction` card compiles to
an undirected +1 stealth action (one per vampire per turn, vampires only)
whose success pushes a **referendum frame** — terms chosen only now
(`referendumTerms` hook), then polling on an impulse cycle (casting a
vote rewinds the impulse; quiescence closes it), then tally (more for
than against passes, ties fail) applying the card's `applyReferendum`
effects. Vote sources: titled ready vampires (`MinionState.title` ×
`TITLE_VOTES`), the Edge (burned for 1), the calling card, and one burned
political card per Methuselah. Referendum-effect primitives:
`refBurnPerMinion` (optionally locked-only), `refAllocateBurn`
(fixed or `"numSeats"` points), `refChooseSeatsBurn` (base + capacity
rider). Allocation/choice enumeration is shared helper code
(`enumerateAllocations`).

| KRCG id | Card | Exercises |
|---|---|---|
| 101056 | Kine Resources Contested | allocation terms (4 among ≥2); the full vote-source suite |
| 100059 | Anarchist Uprising | terms-less `refBurnPerMinion` |
| 100065 | Ancilla Empowerment | same primitive, second id |
| 100570 | Domain Challenge | `refBurnPerMinion` locked-only |
| 100414 | Conservative Agitation | `refAllocateBurn` with points = number of Methuselahs |
| 101271 | Neonate Breach | `refChooseSeatsBurn` chosen-seats + capacity rider |
| 101353 | Parity Shift | `requiresTitle`; bespoke take-from-richer allocation |
| 100131 | Banishment | bespoke minion-choice terms; ready younger vampire → uncontrolled |

Diablerie, rescue, and the blood hunt (docs/diablerie-design.md) are
**built-in actions**, not cards — no card specs, so the supported count is
unchanged. Diablerise and rescue-from-torpor are enumerated in the minion
phase against any vampire in torpor (directed/undirected by the torpor
vampire's controller; rescue's 2-blood cost split fixed at announcement).
A successful diablerise runs `commitDiablerie` (an indivisible unit:
victim's blood → diablerist, victim burned) then the automatic blood-hunt
referendum (`ReferendumFrame` variant "bloodHunt" — no terms, no
calling-card vote, burns the diablerist on a pass). A leave-torpor action
blocked by a vampire offers that blocker the diablerie via a
`DiablerieOfferFrame`. Deferred with TODOs: equipment-take (needs
equipment-move), older-victim Discipline gain (needs ash heap +
master-Discipline cards), Red List trophies. The V5 library has no
dedicated diablerie/rescue cards; the master modifiers (Depravity,
Carver's Meat Packing, Chantry, Saulot's Healing Touch) are a later sweep.

Second vocabulary sweep (tests/cards/sweep2.test.ts) — defensive/utility
cards fitting the existing primitives plus three small additions
(`actionGainBlood`; the combat `combatLimit: "round" | "combat"` "only
one X each round/combat" limit, recorded on the combat frame via
`isCombatCard`; and `requiresTitle` honored on action cards):

| KRCG id | Card | Exercises |
|---|---|---|
| 100834 | Glancing Blow | `prevent` 1, delayedReplace on a combat card |
| 101817 | Soak | `prevent` 2/4, `combatLimit: "round"` |
| 101588 | Rego Motum | `prevent` 2/4 at a blood cost, once per round |
| 101948 | Telepathic Counter | reaction bleed-reduction (`modifyBleed` negative) |
| 101613 | Restoration | `actionStealth` + `actionGainBlood` |
| 100782 | Fourth Tradition: The Accounting | `requiresTitle` + `addUncontrolledBlood` |

Weapons gate (docs/weapons-design.md, tests/cards/weapons.test.ts): a
data-driven `weapon` field on equipment specs (fixed `damage` gun or
`damage: null, handBonus` melee; `ranged`, `aggravated`,
`maneuverPerCombat`) drives a generic weapon handler mirroring the
`.44 Magnum` bespoke pattern. Cards: Assault Rifle, Flamethrower, Ivory
Bow, Femur of Toomler, Kali's Fang.

Strike-effects gate (docs/strike-effects-design.md,
tests/cards/strike-effects.test.ts): aggravated damage (no mend →
torpor; burns a wounded/torpor vampire that can't pay 1 blood/point),
`strikeDamage {amount, ranged, aggravated, riders}`, `strikeStealBlood`,
and the `onlyAfterFirstRound` combat usability. Cards: Body Flare (pro),
Walk of Flame (tha), Theft of Vitae (tha), Aid from Bats (ani).

Votes-during-polling gate (docs/polling-votes-design.md,
tests/cards/polling-votes.test.ts): the `referendum.polling` window
accepts card plays; `modifyVotes` grants the playing seat votes (an
action modifier by the caller, a reaction by others, dual via
`cardType: "modifierOrReaction"`); `lockGrant: "votes"` (+ `perPoolX`)
covers vote locations; and `{ all: [...] }` gives "requires all listed
disciplines" ([pot][pre]).

| KRCG id | Card | Exercises |
|---|---|---|
| 100157 | Bewitching Oration | action-modifier votes (+2/+4), caller-only |
| 101008 | Iron Glare | `{ all: [pot,pre] }`; vote mode / bleed mode |
| 101318 | Old Friends | bleed mode / vote mode; delayed replace |
| 102278 | Ominous Chorus | dual `modifierOrReaction`, Lasombra |
| 102231 | Party Out Of Bounds | Anarch reaction: reduce-bleed / votes / intercept |
| 102214 | Protected District | primogen reaction: reduce-bleed / +3 votes (flexible) |
| 102109 | Ventrue Headquarters | `lockGrant: "votes"` +3 |
| 101341 | Oxford University | `lockGrant: "votes"` `perPoolX` (burn X → +2X) |

Fourth sweep (tests/cards/sweep4.test.ts) reuses the clan tagging: the
`lockGrant` shape gained an `"uncontrolledBlood"` grant (lock in the
influence phase to add blood to an uncontrolled vampire of the clan —
Arcane Library / Art Museum / Ecoterrorists, for Tremere / Toreador /
Gangrel); `permanent.attachClan` attaches a static master to an own
clan vampire (Sight Beyond Sight → Salubri +1 intercept); and an
`onlyAtLongRange` combat usability (No Trace basic combat-ends).

Clan/sect gate (docs/clan-sect-design.md, tests/cards/clan-sect.test.ts)
— `MinionState.clan`/`sect`, a shared `meetsRequirements` (`requiresSect`
/ `requiresClan` / `requiresCapacity`, joining the existing
`requiresTitle`), and a generic clan/sect-locked location
(`permanent.lockGrant`: `grant` stealth/intercept, `clan`/`sect`,
`ownOnly`). Referendum tweaks: `refChooseSeatsBurn.capBonus` gained
`atLeast` (Empires Fall), `refAllocateBurn` gained `excludeSelf`
(Reckless Agitation).

| KRCG id | Card | Exercises |
|---|---|---|
| 100126/100629/101070/101326 | Backways / Elysian Fields / The Labyrinth / Opium Den | clan-lock stealth (Gangrel/Lasombra/Nosferatu/Ministry), ownOnly |
| 100777 | Fortune Teller Shop | clan-lock stealth (Ravnos), any actor |
| 101171 | Market Square | clan-lock intercept (Banu Haqim) |
| 100054 | Anarch Railroad | sect-lock stealth (Anarch) |
| 102318 | Empires Fall | `requiresSect` Sabbat; `refChooseSeatsBurn` atLeast-8 |
| 101567 | Reckless Agitation | `requiresSect` + `requiresCapacity`; `refAllocateBurn` excludeSelf |

Combat gate — dodge & additional strikes
(docs/dodge-additional-strikes-design.md, tests/cards/combat-strikes.test.ts)
— adds `strikeDodge` (a dodge strike) and `additionalStrike` (count,
`limited`, optional `perBloodX`), both in the `combat.chooseStrike`
window. The combat frame gained `strikeRound`, `additionalStrikes`, and
`usedLimitedAddl`; additional strikes run extra choose/resolve sub-rounds
after the normal pair.

| KRCG id | Card | Exercises |
|---|---|---|
| 100227 | Blur | 1 / 2 additional strikes (limited) |
| 101107 | Lightning Reflexes | additional strike / burn X for X (`perBloodX`) |
| 101523 | Pursuit | maneuver / additional strike |
| 101532 | Quickness | limited vs non-limited additional strike; one/round |
| 101778 | Side Strike | dodge / additional strike |
| 102185 | Wind Dance | dodge / dodge + additional strike |
| 102305 | Shadow Shift | additional strike / maneuver |
| 102275 | Arms of Ahriman | additional strike / dodge + additional strike |

Third sweep (tests/cards/sweep3.test.ts) adds `addStrength` (additive
"+N strength this combat", before-range), a combat-scoped `grantPress`
(`combat: true` → a `pressesCombat` credit), and `actionAddBloodToVampire`
(blood to a chosen in-play vampire):

| KRCG id | Card | Exercises |
|---|---|---|
| 102225 | Form of the Wolf | `addStrength`, combat-scoped press, `combatLimit: "combat"` |
| 100727 | Fifth Tradition: Hospitality | `requiresTitle` + `actionAddBloodToVampire` |
| 100594 | Dummy Corporation | bespoke reactive location: burn to reduce a bleed against you by 2 |

Known scope notes: On the Qui Vive's ally clause ("do not unlock as
normal next unlock phase") is a marked TODO — allies can play it, the
rider is not yet modeled; Lost in Crowds' Into Thin Air clause is moot
(card not in the V5 pool); contested titles (p. 19) are out of scope,
consistent with the cross-player-uniqueness non-invariant; a referendum
whose terms have no legal choice passes with no effect; Soak's
"non-aggravated" qualifier is a no-op (aggravated damage unmodeled);
Wind Dance superior's additional strike is modeled as free-choice rather
than a forced dodge (owner-approved deviation).
