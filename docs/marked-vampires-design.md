# Marked vampires — cards that let others enter combat with the bearer

Wave 111, designed 2026-10-27. **Status: BUILT (0.11.53).** Both questions
in §5 were answered by the owner on 2026-10-27; §8 is what building found.

## 0. The family

Each card here puts itself on a minion, and the card lets OTHER minions
enter combat with that minion as a Ⓓ action. The shared primitive already
exists: `permanent.rushGrant` with `target: { scope: "bearer" }`
(`docs/granted-rush-design.md` §3). Haven Uncovered, Regent and Priority
Contract use it today.

The five cards differ in ways worth asserting against each other:

| Card | Type | Who can rush the bearer | What it costs | Where it goes |
| --- | --- | --- | --- | --- |
| Warrant | Political action | Any ready vampire | 1 blood | A younger ready vampire |
| Blood Hunt | Action, +1 stealth | Any vampire controlled by another Methuselah, +1 stealth | — | A vampire with no prince, justicar or Inner Circle title |
| War Party | Action, +1 stealth | Any vampire, +1 stealth | — | A vampire with no archbishop, priscus, cardinal or regent title |
| Rogue | Master, trifle | Any vampire; +1 stealth with Auspex | — | A vampire who committed diablerie since your last turn |
| Contract | Master | The one chosen Assamite, +1 stealth | — | A ready minion |

All five are in tranche T1: none requires a discipline.

**The pool can produce every target.** I checked this before reading the
card text (CLAUDE.md, "Filter the candidate list FIRST"):

- Blood Hunt requires a prince or justicar. The V5 crypt has 23 vampires
  whose text names a prince title, and Praxis Seizure grants the title too.
- War Party requires an archbishop, priscus, cardinal or regent. The V5
  crypt has 6 archbishops, and the Regent master card grants regent.
- Contract needs an Assamite. The V5 crypt has 15 Banu Haqim, which is the
  name the registry uses for Assamite.
- Rogue's +1 stealth needs Auspex. 83 V5 vampires have it.
- Diablerie is built (`commitDiablerie`).

## 1. Printed text and rulings

Read from `data/vtes-raw.json`.

- **Warrant** (102148): "Choose a younger ready vampire. If this
  referendum succeeds, put this card on that vampire. Any ready vampire may
  enter combat with this vampire as a Ⓓ action that costs 1 blood."
  Ruling: it "Cannot be used or played if the conditions for the terms of
  the referendum cannot be met (e.g. no legal selection…)" [LSJ 20100129].
- **Blood Hunt** (100202): "+1 stealth action. Requires a ready prince or
  justicar. Ⓓ Put this card on a vampire who is not a prince, a justicar or
  an Inner Circle member. Any vampire controlled by another Methuselah may
  enter combat with this vampire as a +1 stealth Ⓓ action." No rulings.
- **War Party** (102145): "+1 stealth action. Requires an archbishop,
  priscus, cardinal or regent. Ⓓ Put this card on a vampire who is not an
  archbishop, priscus, cardinal or regent. Any vampire may enter combat
  with that vampire as a +1 stealth Ⓓ action." No rulings.
- **Rogue** (101647): "Master: trifle. Play on a vampire who has committed
  diablerie since your last turn. Any vampire can enter combat with this
  vampire as a Ⓓ action. Vampires with Auspex [aus] get +1 stealth on that
  action." Ruling: "'Since your last turn' means between the end of your
  last turn and now. Your last turn does not qualify, your current turn
  does." [LSJ 20020429]
- **Contract** (100420): "Contract. Choose an Assamite and put this card
  on a ready minion. The chosen Assamite can enter combat with the attached
  minion as a +1 stealth Ⓓ action." Ruling: "The action provided by this
  card is considered to be an action requiring the listed clan…"
  [LSJ 20080604].

## 2. What already exists

- **`permanent.rushGrant`** with `who.scope` (`bearer`, `chosen`,
  `controller`, `any`), `who.kind`, `who.sect`, `target.scope: "bearer"`,
  `stealth` and `stealthByTarget` (`compile.ts`, `permanentRushGrant`).
- **`refAttachToChosen`**, the political action that puts itself on a
  chosen vampire when it passes (Archon).
- **`attachSelf`**, the action that puts itself on its target, with
  `targetFilter.youngerThanActor` (Kaymakli Barrier).
- **`attach.scope: "any"`** for a master put on anyone's minion (Haven
  Uncovered).
- **`seat.lastTurnEnded`** and the "since your last turn" test in
  `receivedVictoryPointSinceLastTurn` (Lextalionis). Rogue's ruling is the
  same comparison.
- **Priority Contract's two-pick play** (`cards.ts`, `priorityContract`):
  a chosen Assamite stored in `entry.chosen`, which the rush grant reads.

## 3. New pieces

Each one is small. The wave's risk is in the readings (§4) and in the
negative space, not in the size of the code.

1. **`rushGrant.cost`** (Warrant). The `bleedGrant` sibling already has
   `cost` and passes it to `announceEntryAction`. The rush grant gets the
   same field and the same gate: an actor with less blood than the cost is
   not offered the action. The cost is paid at resolution, as the bleed
   grant's is (p. 27).
2. **`refAttachToChosen.who.younger`** (Warrant). The terms list only
   vampires younger than the calling vampire. **And the play gate**: by
   [LSJ 20100129], a vampire with no younger ready vampire at the table
   cannot call Warrant. The gate asks the same helper the terms use, as
   Lextalionis does, so the gate and the terms can't disagree.
3. **`attachSelf.targetFilter.notTitles`** (Blood Hunt, War Party). It
   reads the vampire's current title, including a title a card grants, the
   way `requiresTitle` does. A printed title and a card-held title must
   both bar the target. One test pins each.
4. **`rushGrant.who.othersOnly`** (Blood Hunt). "Any vampire controlled by
   another Methuselah" excludes the bearer's controller. Today a
   bearer-target grant offers the rush to the bearer's own controller too.
   See question 1 in §5.
5. **`rushGrant.stealthByActor`** (Rogue). The sibling of `stealthByTarget`,
   keyed on the actor's discipline at any level. It reads the derived
   disciplines, so a vampire that gains Auspex from a card counts.
6. **`MinionState.lastDiablerieTurn`**, stamped in `commitDiablerie`, and
   **`committedDiablerieSinceLastTurn(state, minion, seat)`** in
   `derived.ts`, beside the victory-point helper. Rogue's attach filter is
   `attach.diablerizedSinceYourLastTurn`. This records the answer as the
   event happens, because nothing else in the state remembers who
   diablerized whom (the "zone records what today's readers need" lesson).
7. **Contract's play** generalizes Priority Contract's: any Assamite at
   the table (not only yours) and any ready minion (not only your prey's).
   That cross-product can reach about 60 rows at a full table, so the play
   picks the minion and then a choice frame asks for the Assamite. A
   master card isn't an action, so nothing is fixed at announcement and
   sequential pickers are rules-neutral (`cheap-tail-design.md` §1).

## 4. Readings taken

Each of these follows the printed text or a cited rule. Tell me if any of
them is wrong.

- **Blood Hunt and War Party can go on a vampire in torpor.** They print
  "a vampire", not "a ready vampire", and "vampires in the torpor region
  are eligible targets by default" (p. 44, "Target"). The rush itself still
  needs a ready bearer, because the existing grant only offers a ready
  target. So the card waits on the bearer until it leaves torpor.
- **Warrant's chosen vampire is fixed at the call.** If that vampire goes
  to torpor before the tally, a passed Warrant still goes on them ("put
  this card on that vampire"). This is the existing `refAttachToChosen`
  behaviour.
- **Warrant's "younger" is measured against the calling vampire**, by
  capacity, strictly lower.
- **Rogue's "since your last turn"** uses the existing
  `lastTurnEnded` comparison, which already matches the ruling: your
  current turn counts, your last turn doesn't. A diablerie that happened
  before your first turn counts too.
- **Contract's Assamite can belong to any Methuselah.** Priority Contract
  prints "a ready Assamite you control"; Contract prints only "an
  Assamite". Card text wins (p. 16). The chosen Assamite's controller is
  the one who can take the rush.
- **Contract's rush counts as an action requiring an Assamite**
  [LSJ 20080604]. While building, I'll check whether any card in the pool
  reads "an action requiring Banu Haqim" off a granted action. If one
  does, the requirement has to reach it; if none does, I'll record that
  the ruling is honoured by construction and has no reader yet.
- **"Blood Hunt" the card is not a blood hunt referendum.** Nothing in
  `src/` matches on the name today. One test asserts that playing the card
  opens no referendum and that the p. 35 blood-hunt rules don't apply.

## 5. Questions for the owner

1. **Can a minion enter combat with a minion its own Methuselah
   controls?** The rulebook doesn't say. It says only that an action is
   directed or undirected "depending on their targets" (p. 19). Today the
   engine offers it: if your vampire carries Haven Uncovered or Regent,
   your other vampires are offered a rush against it. It matters here
   because Blood Hunt prints "controlled by another Methuselah" and War
   Party prints "any vampire". Two options:
   - **(a) Follow each card's text (recommended).** War Party and Warrant
     allow your own vampires to rush the bearer. Blood Hunt doesn't. The
     difference between the cards is then something a test can assert.
   - **(b) Never offer a rush against your own minion.** This changes the
     existing cards too. It needs a rule citation I couldn't find.
   **Owner ruling (2026-10-27): (a), follow each card's text.**
2. **Do you want all five in one wave?** Rogue is the only card that
   needs new state (the diablerie stamp). If you'd rather keep the wave
   to four, Rogue is the one to defer.
   **Owner ruling (2026-10-27): all five.**

## 6. Tests

One file, `tests/cards/marked-vampires.test.ts`. For each card:

- The positive case: the card goes where it prints, and the rush is
  offered to the minions it names, at the stealth it prints.
- The negative space, card against card:
  - Blood Hunt doesn't offer the rush to the bearer's controller; War
    Party does (if question 1 is answered (a)).
  - Blood Hunt can't go on a prince, including one whose title comes from
    Praxis Seizure; War Party can't go on an archbishop or a Regent
    bearer.
  - Warrant can't be called with no younger ready vampire at the table,
    and an actor with 0 blood isn't offered its rush.
  - Rogue isn't offered for a vampire whose diablerie happened during your
    own last turn, and is offered when it happened during another seat's
    turn after that. The Auspex vampire's rush has +1 stealth; the
    non-Auspex vampire's doesn't.
  - Contract's rush is offered to the chosen Assamite only, including when
    a rival controls it, and to no other Banu Haqim.
- The Blood Hunt name: playing the card opens no referendum.

All five go into the fuzz decks (`tests/engine/fuzz.test.ts`).

## 7. Left for later

The sibling family is **a card that lets its BEARER enter combat**:
Scourge, Templar (political actions) and Enrage, Bloodlust (Presence
actions). They use the same `rushGrant` with `who: { scope: "bearer" }`
and need target filters this wave doesn't build (capacity 4 or less or an
ally; controlled by another Methuselah). They make a natural wave 112.

## 8. What building found

- **A passed `refAttachToChosen` recorded no controller.** The card went on
  the chosen vampire with `controller` unset, so `controllerOfEntry` read
  the bearer's player. By p. 16 it answers to the caller. Archon had the
  same gap and nothing in it reads the controller, so it never showed.
  Fixed: the put-in-play passes `controller: frame.caller`, as Priority
  Contract's does. The ash heap was never at risk: a burned card is filed
  by `owner`, which was right.
- **The [LSJ 20100129] play gate now covers every `refAttachToChosen`.**
  It existed for Lextalionis only. Archon could be called with no ready
  Camarilla vampire at the table. One helper,
  `attachToChosenCandidates`, serves the terms and the gate.
- **Warrant's blood check can't be reached through the table.** A vampire
  with 0 blood must hunt (p. 21, `mustHunt`), so it is offered nothing
  else, and a cost of 1 blood only bites at 0. The gate stays as a
  backstop, as the bleed grant's does. The test drives a rush to its end
  and checks that the 1 blood is paid. **Closed with no change, owner
  decision 2026-10-29:** no game can reach the gate, so neither deleting
  it nor testing it against a state the rules forbid changes play.
- **An own-name tag bars a second copy.** On an action that attaches to a
  chosen target, the code skips a minion whose attached cards carry the
  card's name in `tags`. Blood Hunt and War Party print no limit, so their
  tags are empty (the Phantasmagoria precedent), and a test pins a second
  Blood Hunt on the same vampire.
- **The rules glossary had to learn "contract".** Contract prints
  "Contract." on a line of its own, which the vocabulary test reads as a
  sub-type. Priority Contract's "Unique contract. Trifle." hid the word.
- **FIXED in 0.11.54** (`granted-action-requirements-design.md`, which
  corrects this bullet: the requirement is the clan the GRANT lists, not
  the card's, and two readers ask about a Hecata action, not four).
  **Not fixed at wave 111: a granted action does not count as requiring its card's
  clan** [LSJ 20080604]. The ruling's own examples are Open War (an action
  requiring an Anarch) and The Gate of Acheron (requiring Hecata). Every
  reader of "an action requiring X" asks about the card played from hand
  (`af.card`), which is `null` for a granted action. Contract is whole,
  because no reader in the pool asks about Banu Haqim. But four readers
  ask about Hecata, so The Gate of Acheron's counter action is missed by
  them. Fixing it means the action frame recording the granting card and
  each grant declaring its requirement. That touches every granted action
  and needs owner review, so it is a separate item.
