# Equipment rush — cards on a vampire that let the bearer enter combat

Wave 113, designed 2026-11-02. **Status: BUILT (0.11.58)** — the owner
took (b) for §5 Q1, "yes" for §5 Q2, and accepted every §4 reading; §9
records what was built and where it differs from §3. This is
the survey that `docs/bearer-rush-grants-design.md` §8 left for later, and
the design for what it found.

## 0. The family

Wave 112 built four cards that let their bearer enter combat as a Ⓓ action.
This wave is the rest of that family that the pool can use: three cards
that sit on a vampire and give that vampire a rush.

| Card | Type | Rush target | Stealth | Other clauses |
| --- | --- | --- | --- | --- |
| Alastor | Political action | A vampire | +1 | Fetches an equipment card from the library; the bearer can't commit diablerie |
| Eye of Hazimel | Equipment | A minion | 0 | +1 bleed, +1 strength, superior Potence and Chimerstry, cheaper combat cards, can't be moved, pool upkeep, 5 damage when burned |
| Talbot's Chainsaw | Equipment, weapon | A minion | +1 | Strike 3, can't hunt, a mandatory first-round press, prevent 1 each combat, 3 damage to your own minion each unlock |

All three are tranche T1: none needs a discipline to play.

**The shared primitive is `permanent.rushGrant` with `who.scope:
"bearer"`.** Archon and Scourge use it today. The providers that install it
run in `compileSpec` for every card type, so it should reach an equipment
entry unchanged. That's a claim to check, so it's the first thing §7 tests.

**The new rule the three share is [RTR 19960221]** (§1): an action that a
card on the bearer provides fizzles if that card is no longer on the bearer
when the action resolves unblocked.

### 0.1 The survey

`data/vtes-raw.json` has 61 cards that aren't in the pool and whose text
contains "enter combat with". After filtering out inert cards first, as the
lessons require, the following cards remain outside this wave:

- **Inert: the requirement names something no V5 card has.** Powerbase:
  Luanda (Laibon), Shakar and Shakar: the Hunt (Black Hand), Hand Contract
  (Black Hand), Unacceptable Appearance (Nosferatu antitribu), and Familial
  Bond (Laibon). The V5 crypt's text has no Laibon, Black Hand or Inner
  Circle vampire.
- **Out of scope: Redline.** "This vampire is independent" is a sect
  change, and clan and sect changes are a known deviation. Its last clause,
  "Burn this card if the vampire changes sects", depends on the same model.
- **Other minions enter combat with the bearer** (wave 111's shape):
  Political Struggle, Clandestine Contract, Haqim's Law: Judgment, Cardinal
  Sin: Failure of Mission, and Highway Haven: RV.
- **A table-wide grant:** Covenant of Blood, Imperial Decree, Judgment:
  Death to the Brujah!, and Break the Code.
- **A rush action card played from the hand:** Big Game, Games of Instinct,
  Harass, Monomancy, Purity of the Beast, Rumble, and Taunt the Caged
  Beast.
- **An ally that can rush:** Cry Wolf, Order of Hermes Cabal, Ossian,
  Remnant of the Endless Storm, Renegade Garou, Wendell Delburton, and
  Abomination. Spell of Life and Mobile HQ, Operation Antigen make or serve
  such allies.

§8 lists the larger of these groups as candidate waves.

## 1. Printed text and rulings

Text is from `data/vtes-raw.json`. Rulings are from the KRCG card API.

- **Alastor** (100038), political action: "Requires a justicar or Inner
  Circle member. Choose a ready Camarilla vampire. Successful referendum
  means you search your library for an equipment card and put this card
  and the equipment on the chosen vampire (ignore requirements; shuffle
  afterward); pay half the cost rounded down of the equipment. The attached
  vampire can enter combat with a vampire as a +1 stealth Ⓓ action. The
  attached vampire cannot commit diablerie. A vampire can have only one
  Alastor." Rulings:
  - If the equipment costs blood, the chosen vampire pays it
    [LSJ 20040518].
  - Finding an equipment card is optional. When none is found, Alastor is
    still attached [LSJ 20050331-2].
  - An equipment card that requires a discipline comes into play as its
    inferior version [RBK equip].
  - An X cost is zero [LSJ 20100204].
  - The referendum can't be called if its terms can't be met, including a
    uniqueness violation [LSJ 20100129]. The play gate already enforces
    this for `refAttachToChosen`.
- **Eye of Hazimel** (100678), equipment: "Unique. The bearer gets +1 bleed
  and +1 strength. The bearer can enter combat with a minion as a Ⓓ
  action. This vampire gets superior Potence and superior Chimerstry, and
  combat cards cost this vampire 1 fewer blood. While the bearer is ready,
  this equipment cannot be moved or stolen. If this equipment is burned, it
  inflicts 5 unpreventable environmental damage on the bearer. During your
  unlock phase, burn 1 pool or burn this equipment." Ruling: the action
  provided by the equipment fizzles if the equipment isn't on the acting
  minion when the action resolves unblocked [RTR 19960221].
- **Talbot's Chainsaw** (101931), equipment: "Unique weapon. Strike: 3
  damage. If the bearer is ready during your unlock phase, this weapon
  inflicts 3 unpreventable damage on a ready minion you control. The bearer
  cannot hunt. The bearer can enter combat with a minion as a +1 stealth Ⓓ
  action. The bearer gets 1 press (mandatory), only usable to continue
  combat during the first round, and can prevent 1 damage each combat."
  Rulings:
  - Entering combat with the Chainsaw's action, or preventing damage with
    it, doesn't force the bearer to strike with it [LSJ 19971215].
  - The unlock-phase damage is weapon damage. The bearer doesn't inflict
    it, and it isn't environmental [LSJ 20090304-1].
  - The same fizzle rule as the Eye [RTR 19960221].

The rulebook passage this design leans on for the press:

- p. 30: "Presses can be used to continue combat or to end combat by
  cancelling a press to continue." And: "A minion cannot play two presses
  in a row … If there is an uncancelled press to continue, then another
  round of combat begins."

## 2. What already exists

- **`permanent.rushGrant`** with `who.scope: "bearer"`, `target.kind`,
  `stealth`, and the per-copy, per-turn latch (`compile.ts`,
  `permanentRushGrant`). Its target list asks `untargetableBy` since
  0.11.55.
- **`refAttachToChosen`** and `attachToChosenCandidates`, which already
  serve the [LSJ 20100129] play gate. Wave 112 added
  `sameSectAsCaller`.
- **`VampireTitle`** has both `justicar` and `innerCircle`.
- **The rush fizzle** at resolution (`engine.ts`, beside `lockedOk`): a
  successful rush whose conditions no longer hold pays its cost, counts as
  successful and starts no combat [Ambush ruling]. [RTR 19960221] is one
  more condition in the same place.
- **The hunt bar**, `auraBlocksHunt`. Since 0.11.57 the hunt option, the
  mandatory-hunt branch and granted hunts all call it.
- **Library search** (`searchToHand`, `searchDisciplineMaster`): finding
  nothing is legal, and the library is shuffled either way (p. 14).
- **Play-from-hand's `ignoreRequirements` and `halfCostInBlood`**
  (Biothaumaturgic Experiment, Contraband): the requirement waiver and the
  half-cost arithmetic, for a card from the hand.
- **Discipline-granting equipment** (`discipline-granting-equipment-design.md`)
  for the Eye's superior Potence and Chimerstry.
- **`PlayCostMod`** with `cardTypes: ["combat"]` and `pays: "blood"`, for
  "combat cards cost this vampire 1 fewer blood".
- **`preventByStrikeSource`** (Kevlar Vest): once each combat, on
  equipment. The Chainsaw's "prevent 1 damage each combat" is
  `{ fromGun: 1, otherwise: 1 }`.
- **`unlockUpkeep: { blood }`**, a pay-or-burn choice during the unlock
  phase, for retainers.
- **`onLeavePlay`**, fired from `burnPermanent`.
- **`EquipmentMoved` and `PermanentMoved`**, the events that move
  equipment between minions.

## 3. New pieces

1. **[RTR 19960221], the fizzle.** `announceEntryAction` gets the granting
   entry already. When the grant's `who.scope` is `bearer`, the action frame
   records `grantedBy: <card id>`. At resolution, the rush starts combat
   only if that card is still attached to the acting minion. The check goes
   beside `lockedOk`, so the two fizzles can't disagree. Whether this
   applies beyond equipment is question 1 in §5.
2. **The bearer's own hunt bar** (Chainsaw). `auraFlag` reads
   `seat.permanents` only, so a bar on an attached card is invisible to it.
   This is the attached-cards lesson again. `auraBlocksHunt` gains one
   clause: the minion's own attached entries with `statics.cannotHunt`.
   Every hunt path already calls it, so none of them needs editing.
3. **A diablerie bar** (Alastor). `statics.cannotDiablerize`, read through
   one helper at every site that offers diablerie: the diablerize action
   and the offer after a blood hunt.
4. **Equipment that stays put** (Eye). `statics.immovableWhileReady`, read
   through one predicate by every option that moves or steals equipment.
   Four sites emit a move today: the strike steal (`engine.ts`), the
   granted `stealEquipment` action (two cases in `compile.ts`), one more in
   `compile.ts`, and one bespoke handler in `cards.ts`. The predicate gates
   the OPTIONS. A reducer that refused a move would leave an option on
   screen that does nothing.
5. **Damage to the bearer when the card burns** (Eye).
   `statics.burnDamagesBearer: { amount: 5, unpreventable: true,
   environmental: true }`. `burnPermanent` finds the bearer before it
   removes the card, as it already does for a title, and inflicts the
   damage after the card leaves. A bearer burned first takes nothing,
   because no bearer is left (§4).
6. **Upkeep in pool, and on equipment** (Eye). `unlockUpkeep` gains a
   `pool` amount and moves out of the retainer-only statics, because the
   upkeep is a question about the card in play, not its type (the "rule
   welded to a card type" lesson). Robert Carter's blood upkeep is
   unchanged.
7. **Unlock-phase damage to your own minion** (Chainsaw).
   `statics.unlockDamageOwnMinion: { amount: 3, unpreventable: true }`,
   only while the bearer is ready. The controller chooses one of their
   ready minions, the bearer included, in a choice frame. It's weapon
   damage: not the bearer's, and not environmental [LSJ 20090304-1].
8. **A mandatory first-round press** (Chainsaw).
   `statics.mandatoryFirstRoundPress`. At the press step of round 1, if
   both combatants are ready and the bearer hasn't pressed, the bearer's
   controller is offered only `press:continue`. The opposing side can still
   cancel it with a press to end (p. 30). Question 2 in §5.
9. **Search the library onto the chosen vampire** (Alastor). A new
   `refAttachToChosen` rider, `fetchEquipment`, run on a pass:
   - The caller's Methuselah chooses an equipment card from their library,
     or finds nothing [LSJ 20050331-2]. Alastor is attached either way.
   - Requirements are ignored, and a discipline card comes in as its
     inferior version [RBK equip]. An X cost is 0.
   - Half the cost, rounded down, is paid. The chosen vampire pays a blood
     cost [LSJ 20040518], and the caller's Methuselah pays a pool cost.
   - A card whose halved cost can't be paid isn't offered.
   - The library is shuffled afterward, whatever was found (p. 14).

   The hand version's waiver and arithmetic are reused, not copied: one
   helper serves both, so the two can't drift.

## 4. Readings taken

Each of these follows the printed text or a cited rule. Tell me if any of
them is wrong.

- **Alastor's rush targets vampires only.** The card says "a vampire", so
  allies aren't offered.
- **"A vampire can have only one Alastor"** removes a vampire that already
  has one from the terms. That makes the [LSJ 20100129] gate refuse the
  call when every ready Camarilla vampire has one.
- **The Eye's Chimerstry is admitted, and is live only when a Chimerstry
  card joins the pool.** The discipline grant is the generic one and works
  today. No card in the pool requires Chimerstry, so nothing on the table
  shows it yet. The Eye is not inert: every other clause does something.
- **"Cannot be moved or stolen" applies only while the bearer is ready.**
  A bearer in torpor can lose it, for example to Tutu's steal from a
  vampire in torpor.
- **The Eye's 5 damage follows every burn**, including its own upkeep
  choice. The card says "if this equipment is burned", with no exception.
- **The Eye's upkeep is the controller's choice** every unlock phase: burn
  1 pool, or burn the Eye. With no pool to spare, only the burn is offered.
- **The Chainsaw's unlock damage is mandatory**, and the bearer is a legal
  choice. A seat whose only ready minion is the bearer must choose the
  bearer.
- **The Chainsaw's press applies in any combat the bearer is in**, whether
  the bearer is acting, blocking or the target of a rush.
- **Using the rush doesn't force a strike with the Chainsaw**
  [LSJ 19971215]. Nothing to build; one test pins it.

## 5. Questions for the owner

1. **How wide is [RTR 19960221]?** The ruling is about equipment: "The
   action provided by the equipment to the attached minion fizzles…". Two
   readings:
   - **(a) Equipment only**, which is exactly what the ruling says.
   - **(b) Any card on the acting minion that provides the action.** This
     also covers Archon, Scourge, Templar, Enrage and the retainers, but
     only when that card leaves the minion mid-action, which is rare.

   I recommend **(b)**. The reason in the ruling is that the card provides
   the action, and that's true of every bearer grant. Reading (a) welds the
   rule to a card type.
2. **Can an opposing press cancel the Chainsaw's mandatory press?** I read
   "mandatory" as "the bearer can't decline it", not "it can't be
   cancelled". p. 30 says any press to continue can be cancelled by a press
   to end. I recommend **yes, it can be cancelled**.

## 6. Found while designing

- **`auraBlocksHunt` can't see an attached card.** This isn't a defect
  today, because nothing attached bars hunting yet. It would have been the
  day the Chainsaw was admitted. §3 item 2 fixes it.
- **Moving equipment has four separate paths.** Nothing reads a shared
  "can this move" question today, because nothing has needed to. The Eye
  is the first card that does (§3 item 4).

## 7. Tests

One file, `tests/cards/equipment-rush.test.ts`. Each positive has a
negative beside it:

- **The shared grant:** an equipped bearer is offered the rush; an
  unequipped vampire isn't. This is the test that confirms
  `permanent.rushGrant` reaches an equipment entry.
- **The fizzle:** the Eye is stolen, or its bearer loses it, between
  announcement and resolution. The action succeeds and no combat starts.
  With the Eye still on, combat starts.
- **Alastor:** a justicar calls it. It's not playable by an untitled
  vampire. On a pass, the caller fetches an equipment card and pays half,
  rounded down. The chosen vampire pays a blood cost. Finding nothing still
  attaches Alastor, and the library is shuffled either way. A card whose
  halved cost can't be paid isn't offered. The bearer rushes a vampire, but
  not an ally, and isn't offered diablerie. A vampire that already has
  Alastor isn't among the terms.
- **Eye of Hazimel:** +1 bleed, +1 strength, superior Potence, and a combat
  card 1 blood cheaper. It's not offered to a steal while the bearer is
  ready, and it is offered while the bearer is in torpor. Burning it deals
  5 unpreventable damage to the bearer. The upkeep offers pool or burn, and
  only burn at 0 pool.
- **Talbot's Chainsaw:** strike 3. No hunt option, and no mandatory hunt at
  0 blood: the p. 19 stuck rule applies instead. The round-1 press is
  forced, and the opponent's press to end cancels it. There's no forced
  press in round 2. The bearer can prevent 1 damage once a combat. The
  unlock damage asks the controller, and it's not offered while the bearer
  is in torpor.

The three cards join the fuzz decks.

## 8. Left for later

The survey found two families big enough for their own waves:

- **Rush action cards played from the hand** (seven cards, §0.1). They
  share the hand-rush path that wave 112's Enrage already uses.
- **Allies that can rush** (seven cards, plus two that make such allies).

## 9. What was built (0.11.58)

Tests: `tests/cards/equipment-rush.test.ts`, 32 cases. Where the build
differs from §3:

- **The fizzle covers any card on the actor.** `grantedBy` is recorded
  whenever the granting entry is attached to the acting minion, not only
  for `who.scope: "bearer"`, which is reading (b).
- **Upkeep.** `statics.unlockSelfBurn { payPoolInstead }` already existed,
  but it burns the MINION (Spectral Servitor), not the card. So
  `unlockUpkeep` moved from `retainerAbilities` to `permanent` as
  `{ blood?, pool? }` behind one `addUnlockUpkeep`. Robert Carter's spec
  moved with it, and its choice key went from `retainerUpkeep` to `upkeep`.
  Pool is paid only from pool to spare, the Servitor's reading.
- **Discipline grants.** `disciplineGrants` (an array) sits beside the
  singular `disciplineGrant`, and `disciplinesOf` reads both.
- **A fifth move site.** The auction's `cardsControlledBy` also moves a
  card onto the buyer's minion, so it asks `equipmentMovable` too. The
  granted steal re-asks at resolution, in case a torpid bearer is rescued
  in between.
- **Alastor's fetch** is a non-optional choice frame whose "Find nothing"
  is an ordinary answer, so the library shuffles on both paths.
  `fetchEquipmentChoices` builds the options and re-derives them at apply.
  The play is `playCardFromHand` with `halfCost`, and the arithmetic
  lives once, in `halvedCost`. Own-copy uniqueness, the vehicle limit and
  Depravity's bar went into `bearerRefuses`, which the hand version now
  calls too.
- **[LSJ 20100204] (an X cost is 0) has nothing to act on.** No X-cost
  equipment is in the pool. Recheck this when one is admitted.
- **No engine defect.** §6's two notes held: `auraBlocksHunt` could not
  see attached cards, and moves had no shared predicate. A third suspected
  defect, that equipment entries lack an `"equipment"` tag, was false.
  `buildHandlerRegistry` adds the tag (`last-equipment-modifiers-design.md`
  §1).
