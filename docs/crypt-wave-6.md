# Crypt wave 6 — the referendum tail, and two durations

2026-09-03. **Crypt 92/217 supported. 210 of 217 crypt cards play
correctly; 7 ability cards remain.** Total 536/661 (81.1%).

5 cards. Three reach into a referendum from three different angles; two
are durations the engine could not previously express.

---

## 1. A vote bonus that depends on which WAY you vote

Every vote static before this one folded into a vampire's single vote
count: a title, a card granting votes, an aura, a per-referendum
modifier. Jason Newberry's does not — *"+2 votes when casting votes
**against** blood hunt referendums"* is keyed to a direction that is only
chosen when the vote is cast.

So `PermanentStatics.voteBonus` is applied **per option** rather than
folded into the count, in the `both()` helper that emits the for/against
pair. `direction` and `variant` are independent filters; an absent one
does not constrain.

The test pins **absolute numbers** (`{ for: 1, against: 3 }`), not the
relation `against === for + 2` — which would also hold if the FOR option
were simply missing. That is the "passes for the wrong reason" shape one
level up, and this file has caught it twice before.

---

## 2. A toll on CASTING a vote

Alexander Silverson: *"Vampires must burn 1 blood to cast votes and
ballots against referendums called by Alexander."*

This is **the block-tax gate one frame over**, and it borrows that gate's
two rules exactly:

- **The toll gates the option as well as being charged.** A voter who
  cannot pay is not offered the against-vote at all, rather than offered
  one that fails. The control case is that they may still vote FOR — the
  gate is the toll, not the vampire.
- **It is paid in BLOOD, so only a minion can pay it.** A vote from the
  Edge or from a burned political card is untolled *by construction*
  rather than by a rule: `both()` only passes a `voter` when the source
  is a vampire.

The toll is carried by the **calling minion**, so it is read once per
polling step off `rf.callingMinion` and applies to every voter. A test
puts Silverson on a non-calling vampire and asserts the toll vanishes.

`LegalOption.castVote` gained `toll?: number` — the
`docs/richer-options-design.md` principle: the enumerator had already
computed affordability, so dropping the number would make every consumer
re-derive it.

---

## 3. "Canceled OR fails" is two outcomes, and they need one hook

`docs/abstain-gate-design.md` records the deliberate split: a **cancelled**
referendum never resolves — no tally, no `ReferendumResolved`, no
`applyReferendum` — while a **failed** one resolves normally with
`passed: false`. Two flags, on purpose.

Cedrick Calhoun is the first card that cares about both, so
`onReferendumLost` is fired from **both paths** with `how` saying which.
A hook hung on `ReferendumResolved` would miss the cancelled half
entirely, and a test drives exactly that case: it asserts no
`ReferendumResolved` was emitted and that he is in torpor anyway.

Fired **after the frame has left the stack** — the `notifyCombatEnded`
rule, because a hook fired before a frame's own `pop()` has any
ChoiceFrame it raises eaten by that pop.

Two guards the card needs: the calling minion must be the bearer (a
referendum somebody else lost costs him nothing), and he must still be in
play — a card can burn a minion mid-poll, and sending a vampire who is
gone to torpor would throw rather than do nothing.

---

## 4. A bonus applied where the value is COMPUTED

Ashur-uballit: *"While he is ready, zombies (allies and retainers) you
recruit or employ get +1 starting life."*

`startingLifeBonus` is read at the entry path, from the tags of the card
**arriving** — not from the minion, which does not exist yet: an ally's
own self-attached entry, where a printed sub-type lives, is emitted
*after* `AllyEnteredPlay`.

**It raises `capacity` too, and that is not incidental.** For an ally
that field IS the printed starting life (p. 11, "a reference, not a
cap"), so bumping the life without it would have `drainOverCapacity` burn
the extra point straight back off at the next settle. Emitting one number
that the applier writes to both fields is what makes that impossible to
get wrong.

The control case is **Screamer** — a real ally that simply lacks the tag.
An ally the engine did not recognise would look identical.

---

## 5. A third hand-size duration

`docs/temporary-hand-size-design.md` built two: a grant on the **turn
frame** ("until the end of the turn", Dreams of the Sphinx) and one on the
**combat frame** ("this combat", Rage of Apedemak). Both expire because
the frame holding them goes away, which is the whole design — nothing to
schedule, nothing to clear.

Fotini's *"until your next discard phase"* is neither. It lifts **as the
discard phase opens**, before the hand is measured — and the difference
is the point of the card: a bonus that lasted through the discard phase
would let its holder keep the extra card, where this one makes them shed
it. So `HandSizeGrant.until: "discardPhase"` is checked where the phase is
entered, ahead of p. 37's default action being set.

The expiry reuses `expireHandSizeBonus`, so p. 7's discard-down asks the
player which card to shed rather than trimming silently. A test walks to
the phase and asserts both halves: the hand size is back to 7, and the
engine is asking a `handSizeDown` question.

Reading on record: **any successful bleed, not only one against the
prey** — the card names no target, unlike Gostoso's next to it in
`cards.ts`.

---

## 6. Fixture traps this wave hit

- **The referendum cycle is `{ order, cursor, passes }`.** A hand-built
  frame with the wrong shape throws inside `cycleQuiescent`, not at the
  assertion, which makes it look like an engine bug. `pushReferendum` in
  the test file builds one correctly.
- **The polling step cycles every Methuselah starting with the CALLER.**
  A test about the defender's options has to pass through the caller's
  impulse first; reading `engine.decision()` straight after reaching
  polling asks the wrong seat. `pollingOptionsFor` walks to the seat it
  wants.

---

## 7. What is left: 7 cards

- **Elen Kamjian** — a MANDATORY bleed. The machinery exists for the
  0-blood hunt (p. 21); this is a second instance of it.
- **Ilonka** — looks at a hand and discards at random. Revelations'
  shape, and it lands on the recorded `PlayerView` memory gap.
- **Gathii** — reveals the top card of the library during an action.
- **Evan Klein** — a coin flip as an action is ANNOUNCED; `randomIndex`
  exists, that window does not.
- **Nonu Dis** — "after playing a master card" during your master phase.
- **Parijat, Tommaso** — both about wraith/zombie allies: a block toll
  paid in LIBRARY CARDS, and a combat ended from outside it.
