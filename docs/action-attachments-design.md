# "Ⓓ Put this card on a minion" — actions that become permanents

*Heroic Might (100913), Khabar: Glory (101043), Rutor's Hand (101664),
Tier of Souls (101984), Phantasmagoria (102358).*

## 1. The cluster

Action is now the largest unsupported family, and the biggest coherent
group inside it is the one where the card **does not go to the ash heap**:
a successful action puts the card itself into play on a minion, and
everything interesting happens afterwards.

| Card | Where it lands, and what it then does |
|---|---|
| Heroic Might `[pot]` | on the actor: +1 strength, **can strike: burn equipment**, burns if they go to torpor |
| Khabar: Glory | on the actor, **and unlocks them**: +1 bleed, 4 extra pool if the prey is ousted, burns at your next unlock |
| Rutor's Hand `[tha]` | on the actor, **locked**, after 1 unpreventable aggravated damage; lock it to unlock the bearer |
| Tier of Souls `[ANI]` | on the actor: +1 bleed **against your prey**; minions can burn it |
| Phantasmagoria `[pre]` | on **any** minion, still controlled by you: −1 stealth, and at superior a toll for being blocked |

`attachSelf` already existed for the static half of this — Heart of the
City, Preternatural Strength, Abbot — and `attachOnSuccess` already
chooses a bearer from `params.target`. What is new is everything the card
does *after* it lands.

## 2. Landing somewhere other than your own minion (p. 16)

`attachSelf.target` was `"ownMinion"`. Phantasmagoria says "put this card
on **a minion**" with no restriction, and adds "**you still control this
card**" — which is p. 16 spelled out, and the reason the new
`"anyMinion"` scope must record a controller.

`attachOnSuccess` emitted `PermanentEnteredPlay` **without** a
`controller`, which is right while the bearer is always your own minion
and wrong the moment it is not: `controllerOfEntry` then infers the
controller from the bearer, and CLAUDE.md records that inference as a bug
p. 16 already caught once (a master on another Methuselah's minion). The
acting seat is now recorded explicitly on every self-attach, which changes
nothing for the existing cards and is the whole point for this one.

**`attachSelf.locked`** is Rutor's Hand ("put this card on this vampire,
**locked**"), emitted as a `PermanentLocked` immediately after entry
rather than as a new field on the entry event — the event exists, and the
card's own ability then unlocks it.

## 3. Three riders that needed one line each

- **`PermanentStatics.bleedAgainstPrey`** — Tier of Souls' "+1 bleed
  **against your prey**". `currentBleed` already holds `af.target`, and
  already resolves an aura on the bleed *target's* cards in play
  (`bleedAuraAgainst`, Aranthebes); this is the simpler direction, read
  off the acting minion's own attachments against `preyOf(controller)`.
- **`attachSelf.burnWhenBearerLeavesReady`** — Heroic Might's "burn this
  card if this vampire is in torpor". The `onLeaveReady` hook exists and
  already carries `how: "burned" | "torpor"`.
- **`attachSelf.burnAtControllerUnlock`** — Khabar: Glory's "burn this
  card during your unlock phase", on the `onControllerUnlock` hook that
  Double Deuce's regeneration uses.

**`onSeatOusted` needed nothing new either.** Khabar: Glory's "if your
prey is ousted, you gain 4 additional pool" is the hook built for the
pool-drain wave, and for the same reason: "your prey" is an adjacency
relation, and the oust rewrites it, so the moment before the `Ousted`
event is the only one where `preyOf(controller)` still names the seat
going out.

## 4. A strike that destroys rather than damages

> Heroic Might: "This vampire can **strike: burn equipment**."

Every strike in the engine so far either deals damage, dodges, or ends the
combat. `Strike.burnEquipment` is a fourth thing: it resolves in the
strike step, inflicts nothing, and burns one equipment card on the
opposing minion — chosen at strike time, so it rides in the option id
rather than raising a ChoiceFrame, because the striking seat is already
being asked.

It is granted by a card **in play**, which is the shape the weapon
compiler already uses (`abilityOptions` in `combat.chooseStrike`, gated on
being the chooser and on the side's strike still being unset). This is
reusable and known to be wanted: **Voracious Vermin** superior ("1
additional ranged strike: burn weapon") is the next card in line for it.

**Reading on record: with no equipment on the opposing minion, the strike
is not offered.** A strike that provably does nothing is not a legal
choice worth spending the round's strike on, and the engine's habit
everywhere else is to gate on options rather than to offer and no-op.

## 5. "Minions can burn this card as a Ⓓ action" on an ACTION card

Tier of Souls and Phantasmagoria both print the counter-play clause the
granted-actions gate generalised (`permanent.vulnerableTo`, ~25 cards).
Those were all Masters and locations; here it sits on a card that reached
play as an *action*. Nothing had to change: `vulnerableGrant` is grafted
in `compileSpec` from `spec.permanent?.vulnerableTo` regardless of card
type, and it looks the entry up by card id. The spec carries a `permanent`
block whose `statics` are unused — the entry's real statics come from
`attachOnSuccess` — which is the one wart in this wave and is noted rather
than papered over.

## 6. Phantasmagoria superior: a toll for being blocked

> "…and if the attached minion is blocked, they burn 1 blood or life
> before block resolution."

Not `blockCosts` (that is paid by the BLOCKER to attempt) and not
`notBlockPenalties` (that fires when a minion declines to block). This is
the bearer paying for having been blocked, at the moment p. 25 puts block
resolution. **`PermanentStatics.blockedToll`** is read where the block
attempt succeeds, before the two consequences of p. 25 (the blocker locks
and combat begins) — the same instant Change of Target's ruling talks
about. `payWith: "bloodOrLife"` is the ally-payable form the block-tax
wave established, and it is what the card prints.

## 7. Deferred, with reasons

Two superior clauses are **not** implemented, and the cards ship on the
strength of the rest (the Wall Street Night standard — a card is honestly
supported when its clauses work, not when every word is modelled):

- **Heroic Might `[POT]`**'s "and this vampire can strike: 2R damage" is a
  *second* granted strike from the same card. `grantsBurnEquipmentStrike`
  is a boolean; a card granting two different strikes wants the
  granted-action merge treatment (dispatch by a verb segment in the option
  id), which is a small gate of its own and not this wave.
- **Rutor's Hand `[THA]`**'s "this vampire can burn 3 blood to be immune
  to this aggravated damage" is a pay-to-opt-out on a damage the card
  itself deals. That is a ChoiceFrame raised inside action resolution,
  which `raiseChoice` queues and flushes afterwards — by which time the
  damage has already landed. It needs the damage deferred behind the
  question, which is a real ordering change.

## 8. A latent bug this wave found

**`attachOnSuccess` read `params.target` as the bearer unconditionally.**
That is right for "put this card on a minion you control" (Biothaumaturgic
Experiment) and wrong for every other card, because `target` is the
generic name for *whatever* an action card's one targeted clause chose.
Tier of Souls' `target` is the minion it steals blood **from** — so the
card attached itself to its own victim, handing an opponent's vampire the
bleed bonus.

No shipped card combined `attachSelf` with a *different* targeted clause,
so nothing was broken in the field; the moment one did, it broke silently
and in a way that still looked like a card in play. `attachOnSuccess` now
returns **`bearerFromTarget`**, set only when the `attachSelf` clause
actually names a bearer scope.

The general shape is worth remembering: **an option-id param named for its
slot, not its clause, is shared state between clauses.** `target` has
meant "the rush target", "the attach bearer", "the stun victim" and now
"the steal victim"; anything reading it must know which clause put it
there.

## 9. And a pre-existing one the FUZZ found — an invisible infinite loop

Adding these five names to the fuzz decks reshuffled every seeded game and
seed 2 stopped terminating: **4 GB of heap, no failure, no output.** The
bug was not in this wave's cards at all.

`reconcileHandSize` is "while the hand is short and the library is not
empty, draw" (p. 7). A draw can be **redirected to a store** (Black Market
Cache, Shilmulo Tarot), which *asks a question instead of drawing* — and
asking leaves the loop's condition unchanged. Worse, inside action
resolution `raiseChoice` only **queues**, so the loop pushed no frame and
emitted no event: it grew one private array and nothing else. That is why
it was so hard to find — the four guards that would normally catch a
runaway (settle iterations, event-log length, frame depth, decision count)
all stayed silent, and the only way in was a wall-clock check in a hot
leaf function, throwing to capture a JS stack.

`drawToReplace` now returns whether a card actually moved, and the loop
stops when it did not; the queued question draws when answered, and the
next event brings the hand back. Regression in
`tests/cards/library-search.test.ts`.

**The lesson is about instrumentation, not about draws:** a loop that
mutates nothing the engine records is invisible to every invariant the
engine has. When a hang produces no events and no frames, stop adding
counters to the state machine and time-box a leaf.

## 10. Rulebook citations

- p. 16 — control vs ownership: a card put on another Methuselah's minion
  is still controlled by the player who played it.
- p. 20 — "+N stealth action"; the once-per-turn named-action limit.
- p. 25 — action details fixed at announcement; block resolution and its
  two consequences.
- p. 27 — an action card's effects happen only on success.
- p. 30–31 — strikes and damage resolution.
- p. 34 — aggravated damage cannot be mended.

## 11. Readings on record

1. **A "burn equipment" strike is not offered with nothing to burn** (§4).
2. **Rutor's Hand's damage lands on a SUCCESSFUL action only.** It is an
   action card, and p. 27 is unambiguous: a blocked action's card effects
   do not happen. The card reads as a price for the ability, and a blocked
   actor pays neither the price nor gets the card.
3. **Tier of Souls' inferior steals blood without entering combat.** It
   names a minion for directedness (p. 25) and says nothing about
   fighting — the Mind Numb shape, `noCombat`.
