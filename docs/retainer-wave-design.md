# Retainers, and what a combat does to the other player's hand

*Crypt's Sons (100476), Owl Companion (101340), Raptor (101545), Feral
Hound (102249), Szlachta Assistant (102360), Szlachta Bodyguard
(102361).*

**Retainer is the last card type with no wave of its own.** The
allies/retainers kernel has been built since
`docs/allies-retainers-design.md` — life counters, combat output,
per-combat presses, the employ action — and the six cards left are one
clause each over machinery that mostly exists. **All six of the
unsupported retainers ship here, so the type is finished.**

Two of them share a mechanism that is worth the doc on its own.

## 1. The thesis: a combat-scoped effect on the OTHER player is DERIVED

Owl Companion: "While the employer is in combat, the opposing minion's
controller **plays with an open hand**."
Raptor superior: "While the employer is in combat, the opposing minion's
controller gets **−1 hand size**."

Both are *state that must appear when a combat starts and vanish when it
ends*, and the tempting build is to set a flag at `pushCombat` and clear
it when the frame pops. **Do not.** Every flag that has to be cleaned up
is a chance to leak — a combat that ends by a strike, by a card, by a
combatant leaving play, or by the frame being popped from three different
sites. This engine has been bitten by exactly that shape before (a cached
damage cycle keyed to "exists" rather than to the thing it was about).

So both are **derived from the live combat frames**, computed on read:

- **`openHandsFor(state, viewer)`** — whose hands `viewer` may read.
- **`handSizeOf`** already exists and now subtracts the same way.

Nothing is stored, nothing is cleared, and the effect turns itself off
when the frame goes, whichever way it went.

### The masking side, and why it is two places

`redactFor` masks other seats' hand card NAMES; `viewFor` collapses them
to a **count**. An open hand has to defeat both, and `viewFor` is defined
in terms of `redactFor` precisely so there is one set of rules — so the
open-hand test goes in `redactFor` and `viewFor` asks the same helper
rather than re-deriving it.

**This is NOT the phase-6 "who has looked at this card" gap.** That gap
is about *memory*: an effect reveals a hand once, and the viewer keeps
knowing those cards afterwards, which structural masking cannot express.
An open hand is **structural and continuous** — it is true exactly while
the combat lasts, which is precisely what masking is good at. Recorded
because the two look alike and only one of them is hard.

**Reading on record: "the opposing minion's controller" is the seat, not
the minion.** A hand belongs to a Methuselah, so the reveal is to the
retainer's controller and about the other combatant's controller. If both
combatants are somehow the same seat's minions the clause is vacuous, and
the derivation returns nothing rather than special-casing it.

## 2. Crypt's Sons — a block broken from a card in play

```
Unique mortal with 3 life. Requires an Anarch. [1 pool]
If this Anarch is blocked, they can burn 1 life from this retainer before
  block resolution to lock the blocking minion and continue the action as
  if unblocked.
This retainer inflicts 1R damage on the opposing minion each round of
  combat during normal strike resolution.
```

The second clause is `statics.combatRoundDamage` — built for the
retainers gate, printed here in the same words.

The first is the **fail-block cluster's mechanic, bought with a life
instead of a card**. Two existing pieces and one ruling:

- **`failBlockAttempt`** already means "that attempt fails"; and p. 49
  rules that **Mirror Walk explicitly locks the blocking minion** where
  Change of Target does not, which is the distinction this card lands on.
  Crypt's Sons locks — so it is `failBlockAttempt` plus a `MinionLocked`.
- **"Continue the action as if unblocked" needs no code.** A failed block
  attempt already returns the action to state A with the action intact;
  that IS continuing as if unblocked. The phrase is describing the
  engine's behaviour, not asking for new behaviour — the same trap
  "the minion chooses a strike again" set in the Vozhd wave.

**"Before block resolution" is where it is offered**, which is the
`action.effects` window with a live `BlockAttemptFrame` — the same moment
the fail-block cards act.

## 3. Feral Hound — an unlock at two different times

```
Animal with 1 life. [Ravnos, ani]
[ani] If the action to employ this retainer is successful, unlock this
      vampire during the next discard phase. You can lock this retainer
      to give the employer +1 intercept.
[ANI] As above, but unlock this vampire after resolution of this action
      instead.
```

Two timings for one effect, and both hooks exist:
`ActionFrame.unlockOnSuccess` via `registerUnlockOnSuccess` (the superior)
and **`onDiscardPhase`** (the basic), built in the cross-table-masters
wave. The mode picks which.

**The basic's timing is a real drawback, not a flavour difference** — the
vampire stays locked through everyone else's turn — so modelling it as
"unlock now" would silently upgrade the card.

The intercept half is a lock-to-grant on a retainer rather than on a
location, which is the same shape City Star Taxi needed for an ally and
for the same reason: `permanent.lockGrant` is compiled inside
`compileMaster` and reaches neither.

## 4. Szlachta Assistant — a cost modifier bought by burning the retainer

"The employer can burn this retainer to reduce the cost of a **ghoul ally
requiring a Tzimisce** they recruit by 2 blood or pool."

`PlayCostMod` is the play-cost gate's shape and already carries
`amount`, `pays: "bloodOrPool"`, `cardTypes`, `minionId` and `once`. What
it cannot say is "a **ghoul** ally requiring a **Tzimisce**": a printed
sub-type and a clan requirement. Both queries exist —
`CardHandler.permanentTags` (the ally fix from the library-search wave)
and `CardHandler.requiresClans` (the blood-locations wave) — so
`PlayCostMod` gains `requiresClan` and `tags`, and the modifier goes onto
`SeatState`'s pending list the way a frame-scoped one does.

**Reading on record: the discount is spent whether or not it is used.**
The card says "burn this retainer to reduce the cost", so burning is the
price and the modifier is `once`; a Methuselah who burns it and then
recruits nothing has spent it. This is the ordinary reading of a cost
paid up front, and it is what `once` already does.

## 5. Szlachta Bodyguard — lock to prevent, burn to refuse

"The employer can lock this retainer to prevent 1 damage in combat. You
can burn this retainer to have an action directed at a minion you control
fail."

Both halves exist: `preventDamageAbility` (War Ghoul's, with the entry as
the latch) and **`failAction()`** (built for Expulsion, and exactly "the
action is not successful").

**Reading on record: the second clause is not a block.** It says the
action FAILS, not that it is blocked — so no combat follows, the actor
stays locked, and `failAction`'s `step = "blocked"` path is the right one
because that is the path that already means "this action resolves as a
failure without a combat". It is offered in the reaction window of an
action **directed at a minion this Methuselah controls**, which is
narrower than "directed at you": a bleed is directed at a *seat* and does
not qualify.

## 6. What this wave does not do

Nothing is cut; Retainer finishes at 0 unsupported. The one thing worth
recording is that **Raptor's hand-size penalty does NOT retire the Dreams
of the Sphinx ledger row.** That row is "+2 hand size **until end of
turn**" — a *timed* bonus, which still has nowhere to live. Raptor's is
derived from a live combat, which is why it needs no timer at all. The
two look like the same gap and are not.
