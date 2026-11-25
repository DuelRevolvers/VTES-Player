# Wave 119: First Blood Toreador

**Status: BUILT (0.11.69, 2026-11-25).** The owner approved decisions 1,
3 and 4 as written. On decision 2 the owner ruled for the card: Kateline
works while in torpor. That ruling is general, and is recorded in §0.1.
What the build found is in §4.

First Blood Toreador is at 85%. Seven cards are missing: six Toreador
vampires in groups 4–5 and one library card. When this wave is done, the
deck is at 100% and joins the chooser (`libertine-ball-design.md` §5).

| Card | Kind | Group | What it needs |
| --- | --- | --- | --- |
| Gwendolyn Fleming | Vampire | 5 | Nothing. She prints no ability. |
| Thomas De Lutrius | Vampire | 4 | An existing clause (Fame's torpor drain). |
| Tyler McGill | Vampire | 5 | A vote bonus and a block bar by clan. |
| Vasily | Vampire | 5 | A cost on contesting a title. |
| Kateline Nadasdy | Vampire | 4 | A crypt ability that forces an abstain. |
| Epikasta Rigatos | Vampire | 4 | An after-resolution retrieval. |
| Crocodile's Tongue | Action Modifier | — | A blocker filter, a seat-wide block bar, and a cancel paid in blood or life. |

## 0. Decisions for the owner

1. **Open Toreador groups 4–5?** This is a widening, so it needs your
   word. It adds `{ "clan": "Toreador", "groups": [4, 5] }` to
   `config/crypt-groups.json`. The builder admits only whole vampires: the
   five in this wave, Gwendolyn, and the other Toreador in groups 4–5 that
   print no ability (four more by a text scan: Fahd al-Zawba'a, Lindsay
   Yates, Masdela and Sean Andrews). The count is re-derived from
   `data/registry-report.txt` at build time. About 15 Toreador in those
   groups print an ability and stay out until a later wave.

2. **Kateline and the ready-only rule.** Her rulings say the ability "can
   be used while locked or in torpor, only once per referendum" [ANK
   20220705] [LSJ 20100705]. Your ruling of November 13, 2026 says a
   vampire's abilities work only while the vampire is ready, unless the
   card says otherwise. Her card says nothing about torpor, so the design
   follows your ruling: **she can use it while locked, but not while in
   torpor.** Locked is still ready. The "once per referendum" half of the
   ruling is kept. Confirm, or say if Kateline is an exception.

3. **Epikasta: is a political action card an "action card"?** Her text
   is "You can move an ACTION CARD Epikasta played from your ash heap to
   your library after resolution." Action and Political Action are
   separate card types. The design reads "action card" as the card type
   Action only, so a political action card she calls is not retrieved.
   The other reading takes both. The rulings don't settle it. I'll cite
   the rulebook's card-type page in the doc at build time.

4. **Tyler: what if he has already voted when the Edge is burned?** His
   text is "In a referendum, Tyler gets +1 vote after a Methuselah burns
   the Edge for a vote." A vampire's votes are cast as one group (p. 28).
   The design gives the +1 to his group **only if he hasn't cast it yet**.
   His controller can wait for the Edge to be burned. The alternative is a
   late, separate vote for Tyler, which breaks the one-group rule. Any
   Methuselah's Edge counts, his own controller's included.

### 0.1 Owner ruling, 2026-11-25: the card's own word wins

> If a card specifically goes against a previously built ruling, go with
> what the card says. Fall back to other rulings only if the card is not
> specific about what it can do.

"What the card says" includes the rulings attached to that card. So
Kateline's rulings ("can be used while locked or in torpor") beat the
ready-only house rule of 2026-11-13, and she is built that way. Epikasta
and Vasily have no ruling about torpor, so the house rule still applies to
them. The planned readiness audit needs this: its opt-out must cover a
card whose own rulings allow torpor use, not only a card whose text does.

## 1. Card by card

Printed text is from `data/vtes-raw.json`. Rulings are quoted where KRCG
has them; Gwendolyn, Thomas, Tyler, Vasily and Crocodile's Tongue have
none.

### Gwendolyn Fleming (G5)

"Camarilla." No ability. She enters free when the group opens.

### Thomas De Lutrius (G4)

"Camarilla primogen: Burn 1 pool after Thomas goes to torpor."

This is Fame's clause at 1 pool instead of 3:
`leaveReadyDrain: { amount: 1, how: "torpor", bearerOnly: true }` on a
`cryptPerm`. The hook fires as he leaves the ready region, so he is still
ready when it is asked, and the ready-only rule doesn't stop it.

The trap to test: `onLeaveReady` on Fame reads a card attached to the
vampire. Thomas's ability is his own crypt entry. Both are attached, so
the same path serves, but the test asserts the pool burn rather than
trusting that.

Negative space: no burn when he is burned outright, and no burn when
another vampire goes to torpor.

### Tyler McGill (G5)

"Camarilla: In a referendum, Tyler gets +1 vote after a Methuselah burns
the Edge for a vote. He cannot block Nosferatu."

- **The vote.** Derived, never stored. `vampireVotes` in `derived.ts`
  (the one vote count) adds 1 when the referendum's `usedSources`
  includes `edge`. A vampire's votes are fixed when the group is cast, so
  a group cast earlier keeps its count (decision 4). Untitled Tyler has 0
  votes, so the bonus makes him a voter only after the Edge is burned.
  The build checks that the tally reads the count stamped at the cast,
  not a re-derived one.
- **The block bar.** A new crypt static, `cannotBlockClans: ["Nosferatu"]`,
  read where the existing `cannotBlockTitledWhileUntitled` is read. It is
  live: the pool has Nosferatu (groups 4–5 opened in wave 116).

Negative space: no vote before the Edge is burned; no block option against
a Nosferatu actor; a block option against a non-Nosferatu actor.

### Vasily (G5)

"Camarilla Prince of Prague: Contesting a title costs Vasily +1 blood
unless you have the Edge."

The contest cost is 1 blood, paid by the vampire, in the `contest` choice
in `engine.ts`. Vasily's cost is 2 unless his controller holds the Edge.
Two places ask what the cost is: the choice that offers **pay**, and the
check before the frame that forces an empty vampire to yield. Both must
read one helper, `titleContestBloodCost(state, minion)`, or they will
drift.

**Whole but inert today.** A title contest is keyed by title and city
(`titleContestKey`). Nothing else in the pool is Prince of Prague, so
Vasily never contests. The test builds a second Prince of Prague, on the
Rutor precedent from wave 118.

Under the ready-only rule, Vasily's surcharge doesn't apply while he is
in torpor. That is a consequence of the ruling, not a choice.

### Kateline Nadasdy (G4)

"Camarilla: During the polling step of a political action, Kateline can
burn 1 blood to force a non-acting vampire to abstain."

The effect already exists: `forceAbstain`, used by Irregular Protocol,
Pulling Strings and Kindred Coercion. It cancels the vampire's votes and
ballots, which her rulings require [LSJ 19971001] [LSJ 20100311]. What is
new is that a crypt ability uses it:

- A `useAbility` option in the polling step of a referendum called by a
  political action, not by any other means.
- The cost is 1 blood from Kateline.
- The target is any vampire except the acting one, at any age. Her text
  has no "younger".
- Once per referendum, by a latch on the referendum frame
  ("an enumerator in a window that re-offers needs its own latch").
- While locked or in torpor, by her rulings (§0.1).
- Not during a referendum that is automatically passing. The vote-changing
  cards carry this [PIB 20150105], and Kateline is in the same family, so
  she goes through the same gate rather than a second copy of it.

Negative space: not offered outside polling, not offered on a referendum
that isn't a political action, not offered twice, not offered with 0
blood, and the acting vampire is not a target.

### Epikasta Rigatos (G4)

"Camarilla Prince of New York: You can move an action card Epikasta
played from your ash heap to your library after resolution (shuffle
afterward)."

Rulings:
- "Can only retrieve a card played during that same action." [ANK 20180628]
- Only a card "played the normal way", not one put into play by another
  card (Concealed Weapon, Charming Lobby). [LSJ 20090430]

Shape: an optional choice in `action.afterResolution`, the window
`afterResolutionByActor` already opens. It is offered when all of these
hold:
- Epikasta was the acting minion.
- The action came from an Action card played from her controller's hand
  (decision 3).
- That card is in her controller's ash heap now. A card that stayed in
  play, or was cancelled, or went elsewhere is not there to move.
- Epikasta is ready (the ready-only rule). If she was blocked and sent to
  torpor, she retrieves nothing.

The answer moves the card to the library and shuffles it with the seeded
RNG.

**A check for the build:** when the action card reaches the ash heap. If
it is filed after the after-resolution window, the window looks at the
ash heap too early and the choice is never offered. The test asserts the
choice is offered, so this can't pass by accident.

Negative space: no choice after a built-in action (a bleed with no card),
after an action by another vampire, or for a political action card.

### Crocodile's Tongue

"Only usable if an ally or younger vampire attempts to block.
[aus] That attempt fails and the blocking minion's controller cannot
attempt to block this action again. The blocking minion can burn 1 blood
or life to cancel this card as it is played.
[AUS] As above, but canceling this card requires 1 additional blood or
life."

Three differences from True Love's Face, its nearest sibling:

1. **A blocker filter.** "An ally or younger vampire": younger than the
   acting vampire, meaning lower capacity. The `failBlockAttempt` usability
   check gains an optional `blocker: { allyOrYounger: true }`.
2. **A seat-wide bar.** "The blocking minion's CONTROLLER cannot attempt
   to block this action again", where Elder Impersonation bars only the
   minion. `af.blockRestrictions` gains `cannotBlockSeats: SeatId[]`, and
   the one place that offers blocks reads it.
3. **A cancel paid by the minion, in blood or life, varying by level.**
   `payToCancel` today is paid in pool by a Methuselah. It gains a
   `minionBlood` currency, paid by the blocking minion. An ally's life is
   its blood in this engine, so one field covers "blood or life". The
   amount is per level: 1 at basic, 2 at superior.

An ally that pays its last life is burned. The cancel stands, and the
attempt then fails anyway because the blocker has left play (the existing
branch in the block resolution). The payment is legal, and rarely wise.

Negative space: not offered against an older or same-capacity vampire
blocker; not offered with no block attempt; the cancel is not offered
when the blocker has too little blood (1 at superior); a second minion of
the same controller can't block after the attempt fails; a third seat's
minion can.

## 2. New vocabulary, in one list

- `cannotBlockClans` (crypt static): Tyler.
- `vampireVotes` term for "the Edge burned this referendum": Tyler.
- `titleContestBloodCost` helper, with a Vasily static
  (`contestSurchargeUnlessEdge: 1`).
- A crypt `useAbility` running `forceAbstain` in polling, with a
  once-per-referendum latch: Kateline.
- An after-resolution retrieval to the library: Epikasta.
- `failBlockAttempt.blocker.allyOrYounger`, `cannotBlockSeats`, and
  `payToCancel.minionBlood` with a per-level amount: Crocodile's Tongue.

Each one is read in exactly one place. Each new spec field gets a test
that fails if the field is ignored ("a spec field with no reader is a
partial card no test can see").

## 3. The rest of the wave

- `DISCIPLINES` gains `ser` if it isn't there: Vasily has Serpentis.
- Fuzz decks gain Crocodile's Tongue and a Toreador from groups 4–5.
- Playstyle for First Blood Toreador: decided at build from what the deck's
  cards do, as in `ai-playstyles-design.md`. Its library leans to Presence
  politics and bleed modifiers, so Politician is the likely fit.
- Version 0.11.69. The four checks, plus `simulate:politics` because
  Kateline and Tyler touch referendums.

## 4. What was built, and what it found

Tests: `tests/cards/first-blood-toreador.test.ts`, 33 cases, each clause
in both directions with a control. Counts after the wave: library 936,
crypt 265 (was 255), total 1,201. Ten vampires entered: the six in the
deck and four that print no ability.

- **The title contest price was written twice.** The option that offers
  to pay checked `m.blood >= 1`, and the payment burned a literal 1. They
  agreed only because nothing changed the price. Both now read
  `titleContestBloodCost` in `derived.ts`.
- **Pay-to-cancel knew two currencies, pool and combat cards**, both paid
  by a Methuselah. `minionBlood` is the first paid by a minion. The
  amount is chosen at push time from the mode played, so
  `payToCancelFor` now receives the mode.
- **Every "cannot attempt to block this action again" barred one
  minion.** `cannotBlockSeats` is the first bar on a seat, read in
  `mayAttemptBlock` beside `cannotBlock`.
- **A derived read that wasn't total.** The new Tyler term read
  `rf.usedSources` directly, and Foundation Exhibit's tests build a
  referendum frame without it. It now reads `rf.usedSources ?? []`, the
  rule for derived reads, rather than the fixture being patched.
- **Epikasta's design check passed.** The action card is in the ash heap
  when the after-resolution window opens, so the retrieval is offered.
- `DISCIPLINES` gained `ser` (Vasily).
- Playstyle: Politician, as every other Toreador precon has.

### 4.1 Known limits

- **Vasily is whole but inert today.** Nothing else in the pool is Prince
  of Prague. The test builds a second one.
- **Tyler's late Edge.** If his group is cast before the Edge is burned,
  the +1 is not cast (decision 4). The tally reads the count stamped on
  each vote, so a cast group never changes afterwards.
- **The fuzz adds a capacity-6 Toreador with superior Auspex per seat**
  so Crocodile's Tongue can be played. The crypt abilities themselves are
  covered by the scenario tests, not the fuzz, as in earlier crypt waves.
