# Bearer rush grants — cards that let their bearer enter combat

Wave 112, designed 2026-10-28. **Status: BUILT (0.11.55).** The owner
answered §5 on 2026-10-28: pickers before announcement (1a), and the Grove
cancels action-time frenzy cards (yes). All §4 readings were accepted. §9
records what the build changed from this design and what it found; the
owner answered both §9.2 questions the same day, with no code change.

## 0. The family

Wave 111 built cards that let OTHER minions enter combat with the bearer.
This wave is the sibling: a card that lets its BEARER (or its chosen
minions) enter combat with someone else as a Ⓓ action. The shared
primitive already exists: `permanent.rushGrant` with `who.scope: "bearer"`
or `"chosen"` (`docs/granted-rush-design.md` §3). Archon uses it today.

The four cards differ in ways worth asserting against each other:

| Card | Type | Who gets the action | Who they can enter combat with | Stealth | How long it lasts |
| --- | --- | --- | --- | --- | --- |
| Scourge | Political action | The chosen vampire of the caller's sect | A vampire with capacity 4 or less, or an ally | +1 | No burn clause |
| Templar | Political action | The chosen Sabbat vampire | A ready vampire controlled by another Methuselah | +1 | Until a Sabbat vampire's referendum burns it |
| Enrage, inferior | Action, Presence | A vampire you control, with +1 strength | Any minion | 0 | End of this turn |
| Bloodlust | Action, Presence, X blood | X chosen minions (X+1 at superior), each with an optional press each combat | Any minion | 0 | End of this turn |

**Enrage superior is not a grant.** It puts a tax on a vampire: 2 blood to
attempt any action except hunts and actions to enter combat. It's in the
wave because it's half of Enrage, and Enrage can't be admitted half-built.

Scourge and Templar are tranche T1 (no discipline). Enrage and Bloodlust
are T2: Presence is in the V5 crypt.

**The pool can produce every target.** Checked before reading any rulings:

- Scourge requires a titled vampire. The V5 crypt has 67: 23 princes, 10
  primogen, 1 justicar, 14 barons, and 19 titled Sabbat vampires.
- Templar requires a titled Sabbat vampire (19) and chooses a Sabbat
  vampire (48 in the V5 crypt).
- Scourge's rush targets: 60 V5 vampires have capacity 4 or less, and the
  pool has 44 ally cards.
- Enrage and Bloodlust need Presence, which the V5 crypt has.
- **The V5 crypt has 12 Salubri**, which makes Meditative Grove live
  against these two frenzy cards (§5, question 2).

## 1. Printed text and rulings

Read from `data/vtes-raw.json`. None of the four is in the registry yet.

- **Scourge** (101695), political action: "Requires a titled vampire.
  Choose a vampire of the same sect. If this referendum is successful, put
  this card on the chosen vampire and unlock this acting vampire. The
  vampire with this card may enter combat with a vampire with capacity 4 or
  less or with an ally as a +1 stealth Ⓓ action." No rulings.
- **Templar** (101952), political action: "Requires a ready titled Sabbat
  vampire. Choose a Sabbat vampire. If this referendum is successful, put
  this card on the chosen vampire. This vampire is a Templar. He or she may
  enter combat with a ready vampire controlled by another Methuselah as a
  +1 stealth Ⓓ action. Any Sabbat vampire may call a referendum to burn
  this card as a +1 stealth political action." Rulings:
  - Each copy provides its own action. A vampire that unlocks during the
    minion phase can take the action once per copy [RTR 20030519].
  - The two actions aren't cross-restrictive: the same minion can take
    each once in the same turn [LSJ 20100909].
  - A granted action counts as requiring the clan, sect, capacity or title
    its grant lists [LSJ 20080604]. Built in 0.11.54.
- **Enrage** (100647), action, Presence: "+1 stealth action. Frenzy.
  [pre] Put this card on a vampire you control. This vampire has +1
  strength and may enter combat with any minion as a Ⓓ action. Burn this
  card at the end of this turn. [PRE] Ⓓ Put this card on any vampire. This
  vampire must burn 2 blood to attempt any action except hunts and actions
  to enter combat. Burn this card after resolving this vampire's action."
  Rulings, both on the superior:
  - A vampire that can't burn 2 blood can't attempt an action other than a
    hunt or an action to enter combat [ANK 20180327].
  - If the bearer attempts an action and it's canceled (for example, by
    Direct Intervention), they don't burn 2 blood [LSJ 20090208].
- **Bloodlust** (100222), action, Presence, cost X blood: "+1 stealth
  action. Frenzy. [pre] Choose X minions and put this card in play. Each
  chosen minion gets an optional press each combat and may enter combat
  with any minion as a Ⓓ action. Burn this card at the end of the turn.
  [PRE] As above, but choose X+1 minions." No rulings.

Rulebook passages this design leans on:

- p. 25: "All details of the action are defined when the action is
  announced, including the target(s), the cost, the effects, and so on."
  The exception is a referendum's terms, which wait until the action
  succeeds.
- p. 27: "the action's cost, if any, is only paid if the action succeeds."
- Glossary, *Target*: "A Methuselah or a card being affected by another
  card or effect (usually an action) that is not a referendum." Vampires
  in torpor are eligible targets by default.
- Glossary, *Directed Action*: "An action of one Methuselah's minion that
  targets one or more other Methuselahs, or the minions or cards they
  control."

## 2. What already exists

- **`permanent.rushGrant`** (`compile.ts`, `permanentRushGrant`): `who.scope`
  of `bearer` or `chosen`, `target.scope: "any"` with `kind` and `notClan`,
  `stealth`, and `who.othersOnly`. Its per-minion, per-copy, per-turn latch
  (`grantedActionUses`, key `enterCombat`) is exactly Templar's
  [RTR 20030519] ruling.
- **`refAttachToChosen`** and its one candidate helper,
  `attachToChosenCandidates`, which also serves the [LSJ 20100129] play
  gate (Archon, Warrant).
- **`vulnerableTo` with `via: "politicalAction"`**: Archon's "Camarilla
  vampires can call a referendum to burn this card". Templar's last clause
  is the same with `sect: "sabbat"`.
- **`requiresTitled`** (Cold War) beside `requiresSect`.
- **`attachSelf`** with `target: "ownMinion" | "anyMinion"`,
  `targetFilter.kind`, `targetFilter.inTorporToo` and `strength`.
- **`spec.frenzy`**, which sets `isFrenzy` on the handler. Terror Frenzy,
  Tranquility Shield and Meditative Grove read it.
- **`onActionResolved`**, fired over `allEntries()` whether or not the
  action succeeded.
- **`statics.pressPerCombat`**, summed when a combat begins (Hawg, Dread
  Mastiff). It reads attached cards only.
- **One option per X**, with `x=N` in the option id (Monkey Wrench's
  `xRange`).
- **Kaymakli Barrier's `directedActionBloodTax`**, the one toll charged at
  announcement today. It's in the wrong place for this wave (§6).

## 3. New pieces

1. **`rushGrant.target.vampireMaxCapacity`** (Scourge). A vampire target
   must have `capacityOf` at or below N. An ally passes, because the card
   says "or with an ally". The name says it bounds vampires, so nobody
   reads it as a filter that bars allies.
2. **`rushGrant.target.othersOnly`** (Templar). The target's controller
   isn't the acting Methuselah. This is the target-side twin of
   `who.othersOnly`.
3. **`refAttachToChosen.who.sameSectAsCaller`** (Scourge). The terms list
   vampires whose sect matches the calling vampire's. It goes in
   `attachToChosenCandidates`, so the [LSJ 20100129] gate gets it for free.
4. **`refAttachToChosen.unlockCaller`** (Scourge). "…and unlock this acting
   vampire" on a pass only.
5. **`PermanentInPlay.level`**, set when a card's mode puts it in play, and
   **`rushGrant.level`** (Enrage). Only the inferior grants the rush; the
   superior puts the same card on a vampire and grants nothing. A spec-level
   grant can't tell the two apart, so the mode is written onto the entry
   (the "denormalize onto the entry" lesson).
6. **`burnAtEndOfTurn`** (Enrage inferior, Bloodlust). Nothing in the pool
   burns at the end of a turn today. One sweep at the turn's end, beside
   `returnBorrowedMinions(null, "endOfTurn")`.
7. **An action toll on the bearer** (Enrage superior):
   `statics.actionToll: { blood: 2, exempt: ["hunt", "enterCombat"] }`.
   - **Charged in one helper, called from both announce paths.** The hand
     and basic-action path and `announceEntryAction` (granted actions) both
     call it. Today only the first charges Kaymakli Barrier's surcharge
     (§6).
   - **Gated in one place.** A minion-phase option whose actor can't pay is
     removed, so a vampire with too little blood isn't offered the action
     [ANK 20180327]. The gate and the charge read the same helper.
   - **"An action to enter combat" is one predicate.** It's extracted from
     the existing `rushLike` test that starts a rush's combat, so the toll's
     exemption and the combat it exempts can't disagree.
8. **`burnAfterBearerAction`** (Enrage superior). On `onActionResolved`,
   when the acting minion is the bearer, the card burns. The action that
   put the card in play is skipped. Without that, Enrage superior played
   on your own acting vampire would burn on its own resolution.
9. **Bloodlust's machinery:**
   - **An X blood cost**, paid on success (p. 27), one option per X.
   - **A list of chosen minions on the entry** (`chosenMinions`), which
     `rushGrant`'s `who.scope: "chosen"` reads beside the single `chosen`.
   - **Press credits from a card in play that names the minion.** The
     combat-start sum learns to read seat permanents whose
     `chosenMinions` holds the combatant.
   - **The menu** is question 1 in §5.
10. **Meditative Grove sees action-time frenzy cards**, if the answer to
    question 2 in §5 is yes.

## 4. Readings taken

Each of these follows the printed text or a cited rule. Tell me if any of
them is wrong.

- **Scourge's "a vampire of the same sect" includes the calling vampire.**
  The card says "a vampire", not "another vampire". Sect is checked when
  the terms are chosen, after the referendum passes (p. 25).
- **Scourge's and Templar's terms list ready vampires of any Methuselah.**
  This is Archon's reading on record (`opposing-statics-design.md` §2).
- **Scourge's rush can target your own minions.** Its text names no
  controller, and the wave 111 ruling was to follow each card's text.
  Templar's text excludes your minions, so its rush can't.
- **"Capacity 4 or less" is the current capacity** (`capacityOf`),
  checked at announcement like every other rush target (p. 25).
- **"This vampire is a Templar" has no reader in the pool.** It's recorded
  as a descriptor. Templar gets no own-name tag, because that tag bars a
  second copy and [RTR 20030519] allows several.
- **Enrage inferior's "a vampire you control"** includes the acting vampire
  and a vampire in torpor (Glossary, *Target*).
- **Enrage superior's "any vampire"** includes your own and one in torpor.
  The action is directed only when the vampire belongs to someone else, as
  Blood Hunt and Kaymakli Barrier already work.
- **Enrage superior's toll covers every action the bearer attempts** except
  hunts and actions to enter combat. That includes granted actions,
  political actions and leaving torpor.
  - **It's paid at announcement.** The engine already defers an action
    card's lock and cost until after the as-played window, so a card
    Direct Intervention cancels pays nothing [LSJ 20090208].
  - **The gate asks for 2 blood plus the action's own blood cost.** The
    toll burns at announcement and the cost is paid on success (p. 27), so
    a vampire who can only cover the toll can't finish the action.
- **Enrage superior burns after the bearer's next action resolves,
  whatever the outcome.** That includes a blocked action, a hunt and a
  rush. A card canceled as it's played isn't an attempted action, so the
  Enrage stays.
- **Bloodlust chooses only your own minions.** The card has no Ⓓ. By the
  glossary, an action that targets another Methuselah's minion is a
  directed action. Card text wins (p. 16), so the chosen minions are yours.
  They can be ready or in torpor, vampires or allies, and the acting
  vampire can be one of them.
- **Bloodlust's X can be 0.** At inferior that chooses no minions and the
  card does nothing, which is still a legal play (to cycle the card). At
  superior, X = 0 chooses one minion for free. X can't exceed the acting
  vampire's blood, and the minions must be distinct, so X is also capped by
  how many minions you control.
- **Enrage and Bloodlust burn at the end of the turn they're played in.**
  Both are action cards, so that's always your own turn.
- **Tranquility Shield doesn't touch Enrage or Bloodlust.** Its text covers
  frenzy cards "used on this vampire this combat". Both cards are played
  before the combat starts.

## 5. Questions for the owner

1. **How should a player choose Bloodlust's minions?** The card says
   "Choose X minions", and p. 25 fixes "all details of the action" at
   announcement, so the choice can't wait until the action resolves. Two
   ways to ask it:
   - **(a) Recommended: pickers before the action is announced.** The play
     option asks for X, then shows a minion picker X times, then announces.
     Nobody else gets a decision in between, so this is rules-neutral, the
     same argument as the Garibaldi-Meucci pickers
     (`cheap-tail-design.md` §1). It needs a new kernel piece: a hand play
     that raises its choice frames *before* it announces. Nothing does that
     today.
   - **(b) One option per set of minions.** No new machinery, but a player
     with N minions sees up to 2^N − 1 rows per level: 15 rows at four
     minions, 31 at five, 63 at six.
2. **Should Meditative Grove cancel action-time frenzy cards?** The Grove
   says: "You can lock this card to cancel a frenzy card as it is played on
   a Salubri you control (cost is still paid)." Today it only sees frenzy
   cards played in combat. Enrage superior can be put on a rival's Salubri,
   and the V5 crypt has 12 Salubri.
   - **Recommended: yes.** A frenzy action card "is played on" the vampire
     it names as it's played: the vampire Enrage goes on, the vampire Deep
     Song superior enters combat with, and any minion Bloodlust chooses.
   - **This changes a card already in the pool.** Deep Song superior
     ("Frenzy. Ⓓ Enter combat with and lock a vampire") becomes cancelable
     when it targets a Salubri the Grove's controller controls.

## 6. Found while designing

Both are defects in cards already in the pool. I'll fix them in this wave
unless you say otherwise.

- **War of Ages refuses a regent.** It prints "Requires a titled Sabbat
  vampire", but its spec lists `bishop, archbishop, priscus, cardinal` and
  leaves out `regent`, which the Regent master card grants. Every other
  Sabbat title list in `cards.ts` includes regent. The fix is the Cold War
  shape: `requiresSect: ["sabbat"], requiresTitled: true`.
- **A granted directed action skips Kaymakli Barrier's surcharge.** "Directed
  actions cost this vampire an additional blood" is charged in the
  basic-action announce path only. `announceEntryAction` emits its own
  `ActionAnnounced`, so a Kaymakli bearer who rushes with Archon or Warrant
  pays nothing extra. This is the "path that emits the event by hand"
  lesson again. Item 7 in §3 fixes it by putting both tolls in one helper.

## 7. Tests

One file, `tests/cards/bearer-rush-grants.test.ts`. Each positive has a
negative beside it:

- **Scourge:** called by a titled vampire, passes, lands on a same-sect
  vampire, and the caller unlocks. The bearer rushes a capacity-4 vampire
  and an ally. Not offered against a capacity-5 vampire. Not offered for
  terms of a different sect. Not playable by an untitled vampire. It can
  choose the caller itself.
- **Templar:** a regent can call it (pins the War of Ages fix's sibling).
  The rush is offered against another Methuselah's ready vampire, never
  your own. Two copies give two rushes after an unlock. The bearer can
  rush and then call the burn referendum in the same turn [LSJ 20100909].
  The burn referendum is offered to a Sabbat vampire and not to a
  Camarilla one.
- **Enrage inferior:** +1 strength in the bearer's combat, the rush against
  any minion including your own, and the card burns at the end of the turn
  (asserted on the next turn: no strength, no rush).
- **Enrage superior:** the bearer with 2 blood pays 2 to bleed. With 1
  blood they're offered a hunt and a rush but no bleed and no political
  action. A Direct Intervention cancel costs nothing. The card burns after
  the bearer's next action, and not on the action that played it.
- **Bloodlust:** X blood is paid on success and not when blocked. Chosen
  minions get a press in combat and the rush; an unchosen minion gets
  neither. Superior with X = 0 chooses one minion. It burns at the end of
  the turn.
- **Kaymakli Barrier:** a bearer's granted directed rush now pays the extra
  blood.
- **War of Ages:** a regent with no other title can call it.

The four cards join the fuzz decks with Presence.

## 8. Left for later

Not surveyed yet. Other legacy cards that grant their bearer a rush may
exist; the next wave in this family starts with that search.

## 9. As built (0.11.55)

### 9.1 Changes from §3

- **No `PermanentInPlay.level`.** Enrage's version rides on the entry as a
  tag (`attachSelf.tags: ["inferior"]`), and `rushGrant.requiresTag` reads
  it. This is how Distant Friend's card in play already remembers its
  version, so no new state field was needed.
- **The mode statics carry the rest.** The +1 strength, `burnAtEndOfTurn`,
  `actionToll` and `burnAfterBearerAction` are per-version statics on
  `attachSelf`, which every attached card already merges into its entry.
- **The pickers are an engine-owned choice key, `prePlayPick`.** A play
  whose handler answers `prePlayPicks` raises one picker per minion, with
  the card still in hand. Each answer folds into `params.chosen`, and the
  last answer plays the card. Nothing else is asked in between, so the
  as-played window opens on a play with every detail fixed (p. 25).
- **X is the existing `xBlood` param**, paid on success for an action card
  (`applySuccessEffects`) instead of as the card is played.
- **The gate's cost comes from the option.** A play option already carried
  `cost`; granted-action options now carry `cost` and `entersCombat` too,
  set by the four enumerators that have either.

### 9.2 Found while building

- **Kaymakli Barrier was charged on ONE of THREE announce paths.** §6 named
  the granted-action path. The action-card path (`announceCardAction`)
  skipped it too, so every directed action CARD a Kaymakli bearer played
  was free. All three paths now call `chargeActionTolls`.
- **Granted rushes ignored Secure Haven.** `permanentRushGrant` never asked
  `untargetableBy`, which the hand rush (`enumerateRushTargets`) always
  did. Archon, Warrant, Blood Hunt and the rest could rush a vampire that
  "cannot be the target of other Methuselahs' actions". Fixed in the one
  target list.
- **Meditative Grove's "(cost is still paid)" meets p. 16.** The rulebook
  says a cancelled action card costs nothing. The Grove says its cost is
  still paid, and card text wins (p. 16), so cancelling your own Bloodlust
  still costs its X blood (`payPendingActionCost`). Only Bloodlust has a
  cost among the three frenzy action cards. **Owner confirmed this reading
  on 2026-10-28.**
- **`attachSelf` with a target bars a second copy by default.** "A vampire
  can have only one" is printed on Heart of the City and Preternatural
  Strength. The targeted branch applies it to every card that names its own
  bearer, though most print no such limit. Enrage opts out with `stacks`,
  because two players' Enrages on one vampire is an ordinary board. The
  other targeted cards (Kaymakli Barrier, Phantasmagoria, Blood Hunt and
  their siblings) still bar a second copy. **Owner ruled on 2026-10-28:
  the default stays, and each card opts in with `stacks`.** Nothing was
  changed for them.
- **The frenzy classification test names every frenzy card.** It now lists
  Bloodlust and Enrage beside Deep Song as frenzy ACTION cards.
