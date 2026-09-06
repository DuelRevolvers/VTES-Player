# The partial-support ledger

**Every card marked `supported` that has a printed clause the engine does
not implement.** One file, so a deferral cannot rot in a comment nobody
re-reads.

## Why this file exists

The standard for marking a card supported is the **Wall Street Night
standard**: a card is honestly supported when its clauses work, not when
every word is modelled — a card with a clause that can never do anything
(Wall Street Night's investment half, Black Forest Base's changeling
filter) is still worth having, because the rest of it plays.

The failure mode is not the deferral, it is **forgetting it**. Two
instances on record:

- **Terror Frenzy superior** was deferred in `docs/frenzy-design.md` and
  the card was marked supported with only its basic mode implemented.
  Nothing asserts a mode that is not there, so neither `supported.test.ts`
  nor the fuzz could find it; it surfaced only when somebody read the
  deferral. (It is implemented now — and its spec comment still said
  "deferred" until 2026-09-01, which is the same rot one layer down.)
- **`compileActionCard` never copied `poolCost`**, so Aranthebes was free
  to play. A value nothing asserts.

So: an entry here, and a test that keeps the list honest.

## The test

`tests/cards/partial-support.test.ts` asserts, in both directions:

1. every card named in this ledger is **actually marked supported** — an
   entry that names an unsupported card is stale and must be removed;
2. every `PARTIAL:` marker in `src/cards/effects/cards.ts` names a card
   **that has an entry here** — a deferral cannot be written into a
   comment and forgotten.

Marker format, in the spec's own comment block:

```ts
// PARTIAL: <card name> — <the clause that is missing>
```

## THE LEDGER IS CLOSED — 2026-09-03

**Every printed clause on every library card is implemented.** The owner
asked for exactly that, and the ten open rows were closed in one pass
(`docs/ledger-closeout.md`): Preternatural Strength, Wind Dance,
Putrescent Sustenance, Dead Pool, .44 Magnum, Melange, Heroic Might,
Rotting Behemoth, Rutor's Hand and Go-getter.

Two rows were already true and only their notes were stale — **Dead
Pool**'s optional counter had been a real choice since choice frames
landed, and **War Ghoul**'s "deviation" was settled as a reading in the
Vozhd wave. Two more are not clause gaps at all and are kept below with
their reasons.

### Clauses that need engine work

**NONE.**

### Clauses that are a deliberate simplification

Neither of these is an unimplemented clause. They are kept because
deleting them would lose the reason.

| Card | id | Deviation |
|---|---|---|
| **War Ghoul** | 102144 | ~~its enter-play burn offers the Ghoul itself as a victim~~ — **resolved 2026-09-02, not a deviation.** "Burn an ally or retainer you control" names a set the newcomer belongs to and prefers no alternative, so `self` is a legal choice; the four Vozhd print the same clause and `ally.enterPlayBurn` takes the same reading (docs/vozhd-allies-design.md §1). What remains is only that War Ghoul still hand-rolls the clause — see Retrofits. |
| **Revelations** | 101627 | **the first card in the pool that reveals hidden information**, and it makes the recorded phase-6 gap real. Its basic mode's *look* is modelled correctly at the moment it happens — the prey's hand appears only inside a ChoiceFrame addressed to the actor, and the event log records only what was discarded — but "who has looked at this card" is unmodelled, so the actor's lasting **memory** of the cards they did not take is not in `PlayerView`. A human hotseat player simply remembers; a phase-5 AI seat will not. The card is honestly supported; the gap is a property of `PlayerView`. docs/last-buildable-design.md §2 |

### Clauses that correctly do nothing (not deferrals)

**These two cannot be "made functional" and are not skipped work.** Each
filter is written, correct, and enumerates nothing because the pool
contains no card it could ever match — implementing them harder would
mean inventing cards. If the pool widens (phase 8) they start matching on
their own, with no code change.

| Card | id | Clause |
|---|---|---|
| **Wall Street Night, Financial Newspaper** | 102142 | investment cards — it is the only card in the pool that mentions them. |
| **Black Forest Base** | 100165 | changelings — the only card in all 661 that says the word. |
*Sword of the Archangel's "cancel a grapple or aim card" was listed here
on 2026-09-02 and **left the list the same day**: the round-end wave
shipped Immortal Grapple and Target Vitals, and the Sword needed no
change to reach them — which is what the row predicted. Its test flipped
from asserting the empty set to asserting exactly those two, which is why
the negative was pinned to a **reason** rather than to a number.*

## Cards deliberately CUT or deferred whole

Not partial support — these are **not implemented at all**, listed so the
reason is recorded once instead of re-derived each time somebody surveys
the pool. A row here is a claim that the card is UNSUPPORTED, and the test
asserts that too: when one of them ships, the row must go.

Read these before designing against them. A deferral is a claim about the
code **as it was** — Touch of Valeren and New Carthage were both blocked
on plumbing that had since been built, and the second one had *two* docs
saying so.

### Cut from a wave, with a named blocker

**Six rows left this section on 2026-09-02** (`docs/cheap-tail-design.md`)
— Garibaldi-Meucci Museum, Vagabond Mystic, Underbridge Stray, Voracious
Vermin, Heart of Nizchetus and True Love's Face were all one clause away,
and several of their rows named pieces that had since been built.

**And the section is now EMPTY (2026-09-03).** Its last three rows —
Rotting Behemoth, Waters of Duat and Childe of the Revolution — left with
the wraith/zombie gate (2026-09-02) and the token-vampire gate
(2026-09-03). **Nothing in the library is cut any more**: what is left
unsupported is four Path cards, and Paths are out of scope by the scope
lock rather than by a per-card decision, so they live under Blocked below.

**Two more left it on 2026-09-02** (`docs/last-buildable-design.md`): **Deep
Song** superior and **Revolutionary Council** shipped. Deep Song's row said
"it INVERTS combat roles" — the inversion is the two arguments to
`pushCombat` in the other order, because everything that asks who is acting
in a combat reads `cf.acting`. **That is the fifth cut-list row in eight
waves whose blocker had already been built or was cheaper than written
down**, after Touch of Valeren, New Carthage, Break the Bonds, Hunting the
Quarry and Spying Mission.

**And two more on 2026-09-02** (`docs/last-equipment-modifiers-design.md`):
**Spying Mission** shipped whole — its row claimed it needed "a window of
its own", and the window turned out to be p. 27 A.4's **state C**, which
the engine has always had; **Go-getter** shipped its basic mode and moved
UP to the partial table, where its blocker is now costed rather than named.
That is the fifth cut-list row in seven waves whose blocker had already
been built or was cheaper than written down.

| Card | id | What it needs |
|---|---|---|

### Blocked pending owner review — do NOT build unilaterally

**EMPTY. The blocked list is closed** (2026-09-03).

The last entry was the Path cards, and it was **wrong for a day** — worth
recording, because it is the failure mode this whole file exists to
catch. The claim was that no card grants a Path, that the cards which
could are legacy, and that the set of Path-following vampires is
therefore permanently empty. The first part is true and the conclusion
does not follow: **a Path is a printed trait of a CRYPT card**, like clan
and sect, and all 48 Sabbat V5 vampires already in the pool carry one.
Nothing needed to grant it; the registry pipeline was simply dropping the
field. All four Path cards now ship (`docs/path-cards-design.md` §0), and
so does Burial Site Hunting Ground's vampire branch.

**A blocker is a claim about the data as you read it, exactly as a
deferral is a claim about the code as it was.** Both go stale, and this
one went stale in under 24 hours.

## The 2026-09-03 audit

A sweep of all 444 supported cards (`docs/library-audit.md`) checked this
ledger against the code rather than trusting it. **The ledger was
accurate** — no row was stale, no row was missing for a card that needed
one — with one exception it found and fixed:

**Aggressive Corpse (102286)** had three unimplemented clauses recorded
in a **code comment** ("Remaining clauses are moot for now…") instead of
here. Every claim in that comment was true when written and false when
read: `undodgeable` arrived with Dust Up, `cannotGainLife` with the
wraith/zombie gate, and the `[dom]`/`[pre]` targeting bar was **live** —
Entrancement superior steals an ally, which is exactly what the card says
cannot happen to it. All three are built now, so no row is added.

**The lesson is this file's own founding one, one layer down:** a
deferral written into a comment is a deferral that will not be re-read.
The ledger test cannot see a comment that never says `PARTIAL:`.

Two smaller findings, both fixed: `stealMinionOnSuccess` was the only
minion-targeting branch that never called `untargetableBy` (so Secure
Haven did not stop a steal either), and 21 supported cards were named by
no test — 18 riding on a sibling's coverage, 2 with none at all. All are
in the fuzz decks now, behind a standing guard.

## Retrofits available now

**The four Ⓓ-burn retrofits are DONE (2026-09-02,
docs/unlock-tolls-design.md).** Constant Revolution, Smiling Jack,
Powerbase: Madrid and Wasserschloss Anif all carry
`permanent.vulnerableTo` now, and the two alternative currencies
("or 1 blood", "and/or cards at random") came with them, so six rows left
this file in one wave.

**The two temporary hand-size rows are DONE (2026-09-02,
docs/temporary-hand-size-design.md).** Dreams of the Sphinx and Rage of
Apedemak both left this file when `handSizeOf` learned to sum grants held
on the turn and combat frames, and p. 7's *other* direction — a hand size
that FALLS sheds cards — was built to go with them.

What is still open, recorded so the next survey does not re-derive it:

| Card | id | Retrofit |
|---|---|---|
| **Telepathic Vote Counting** | 101951 | Its `choiceOptions`/`applyChoice` pair is a card-owned discard-down, written before the engine had one. `HAND_SIZE_DOWN` now answers exactly that question generically (docs/temporary-hand-size-design.md §4), so the card could drop its hook — but its discard-down fires because a card came BACK to the hand, not because the size fell, so the retrofit is a real (small) change of trigger and not a deletion. Supported and green: the Platinum Protocol precedent. |
| **Pit of Contemplation** | 102291 | Its "Hecata you control can add 1 counter as a +1 stealth action" is hand-rolled; `permanent.counterGrant` now expresses it as data, and the option ids already agree (`:counter:`). Supported and green, so rewriting it is a separate checkable change — the Platinum Protocol precedent. |
| **The Platinum Protocol** | 102232 | Still bespoke where `CardSpec.multiDiscipline` would do it. Same reason. |
| **War Ghoul** | 102144 | Its enter-play burn is hand-rolled where `ally.enterPlayBurn` now expresses it (built for the four Vozhd, same reading). Same reason. |

**One structural retrofit, larger than the three above:**
`permanent.lockGrant` — the whole "lock this card to give a minion +N
stealth/intercept/votes/…" family, eleven knobs and about 300 lines — is
compiled **inside `compileMaster`**, so it cannot reach a card of any
other type. City Star Taxi is an ALLY that prints exactly that clause, so
it carries its own `allyAbilities.lockForStealth` instead (the p. 26
"only when needed" test is shared between them, so the two cannot drift
on the rule that matters). Lifting `lockGrant` into a grafted helper
called from `compileSpec` would let both use one path — worth doing when
a third card type needs it, not in the middle of a card wave.
