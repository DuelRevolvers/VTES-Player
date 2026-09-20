# Preying on a vampire in torpor

Wave 69 (2026-09-19). Cloak of Blood (100360), Stealing Years (101866),
Crematorium (100445), Corruption's Purge (100431).

A vampire in torpor is the game's one helpless target. Three of these cards
take something from one; the fourth puts vampires there.

| Card | What it does to a torpid vampire |
| --- | --- |
| Cloak of Blood | diablerises them, and takes a level of their Discipline |
| Stealing Years | diablerises an OLDER one, and grows by their capacity |
| Crematorium | burns one who has no blood left |
| Corruption's Purge | *creates* them: a clan bled to zero goes down |

---

## §1 — What already existed

`commitDiablerie` is the whole five-step resolution (p. 34): the blood
moves, the equipment is taken, the victim burns, step 4 offers the master
Discipline card, step 5 calls the blood hunt. The engine's own
`diablerize:` option is the built-in version of the action (p. 24). So the
two diablerie cards are a target filter, a rider, and a call into the
engine — or they should have been. See §2.

## §2 — The diablerie has to be QUEUED, not committed

**What the wave found.** Calling `commitDiablerie` from inside an action
card's resolution silently loses the **blood hunt**: step 5 pushes a
referendum frame, and a frame pushed while the action frame is still on the
stack is discarded when the action pops. The diablerie happened, the victim
burned — and the hunt that the rules attach to every diablerie never
occurred. Nothing threw.

The fix is the shape the engine already uses for exactly this problem:
`ActionFrame.pendingDiablerie`, flushed in `finishAction` beside
`queuedCombats`, whose comment says the same thing ("queued, not entered:
the action it was played into had to finish first"). `raiseChoice` has its
own version (`deferChoices`). **A frame pushed from inside action resolution
is thrown away — and this is the third mechanism in the engine that needs to
know it.**

The flush re-reads both minions: either can have left play in between, and a
victim who has left torpor cannot be diablerised at all.

## §3 — Reading the victim before the victim is gone

"…and this vampire may gain one level of a Discipline **the victim had**."
The victim's Disciplines are read at resolution and carried into the choice
frame's params, because step 3 burns them: by the time the question is
answered there is no victim to ask. The gain is a new event
(`DisciplineGained`) on the vampire itself, since the card that granted it
goes to the ash heap: absent → basic, basic → superior, superior is the
ceiling (p. 11).

**And a choice KEY is a global namespace.** The first draft raised this
question under `diablerieDiscipline` — which is the ENGINE's key for step
4's master-Discipline search. The answer went to the engine's handler and
the card's own question was never asked; the test saw the engine's "find
nothing" option where the card's two Disciplines should have been. Renamed
to `victimDiscipline`. Worth remembering: `choiceByKey` is per handler, but
the frame's *key* is matched by the engine first.

## §4 — A rider on ONE referendum

"In the resulting blood hunt referendum, this vampire gets an additional 2
votes" (Cloak of Blood) and "each anarch gets an additional vote" (Stealing
Years) are the same clause with a different filter. They are seeded on the
DIABLERIST (`bloodHuntVoteRiders`), moved onto the referendum frame as
`pushBloodHunt` builds it (`extraVotes`), and cleared — so the clause cannot
leak into a later referendum.

**What it found: a zero-vote skip ate the rider.** The vote enumerator
computed a vampire's votes, and `if (votes <= 0) continue;` skipped everyone
with no title before the per-vampire bonuses were read. That was correct
while every bonus modified an existing voice; it is wrong the moment a card
GIVES a voice to a titleless vampire. The rider is now summed INTO the
total. **An early return that means "nothing to do" stops being true the day
an effect can create the thing it was skipping** — the lesson from wave 61's
`refPerMinion`, in a different enumerator.

## §5 — Crematorium: the small one

"Lock during your unlock phase to burn a vampire in torpor with no blood."
Any Methuselah's — the card names no controller, and a vampire lying empty
in torpor is the same target whoever put them there. The apply re-reads
torpor and blood, because both can change between the option being offered
and the lock being paid.

## §6 — Corruption's Purge: two steps, in the card's order

"Each Follower of Set burns 2 blood. Each Follower of Set with zero blood
**then** goes into torpor." The torpor reads what the burn left, which is
the whole card — and a vampire who was already empty goes down too, which is
what "each with zero blood" says. "Follower of Set" is the card's word; the
registry's is Ministry.

## §7 — Two more things the tests had to learn

- **`attachSelf`'s statics are the EFFECT's, not the permanent block's.**
  Stealing Years' `capacityBonus` in `permanent.statics` attached a card that
  did nothing; the entry's real statics come from the effect (the Tier of
  Souls comment says so, and this wave proved it).
- **A walker that only knows `pass` stops at the engine's own questions.**
  Step 4's frame offers no `pass`, so the driver stalled there and the blood
  hunt after it never ran — which read exactly like the card being broken.
