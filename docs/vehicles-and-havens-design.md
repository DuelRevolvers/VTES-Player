# Vehicles and havens

Tranche 3, wave 42. Library **642 → 645**. Three equipment cards whose
last sentence is the same sentence — *"a minion may have only one
\<class\>"*.

| Card | KRCG | Printed |
|---|---:|---|
| Helicopter | 100909 | Vehicle. Equipping with it **locks it**. After resolving a successful action, this minion may lock it to **unlock**. |
| Delivery Truck | 100520 | Vehicle. Master phase: put a **non-location equipment** from hand face down on it, at most one. Any minion you control may equip that card as a +1 stealth action. |
| Body Bag | 100229 | Haven. Only usable by an anarch. A ready anarch with it can **burn 2 blood** to make an action directed at them **fail**. |

## §1 — The first exclusivity CLASS

`permanent.exclusiveKey` already existed, for *"a vampire can have only
one Living Manse"* — where the key **is the card's own name**. "Only one
vehicle" is the same field doing something it had never been asked to do:
a class shared by cards of **different names**. It needed no code at all,
because the key is pushed onto the entry as a tag and the equip
enumerator asks `m.attached.some(p => p.tags.includes(exKey))`.

That is worth recording as a non-finding. The mechanism generalised for
free, and the only reason to check was the standing rule that *"it already
exists" is a claim to CHECK, not to make*. Here it held.

## §2 — Equipped, not put into play

*"When a minion equips with the Helicopter, lock it."* "It" is the card —
the minion locked at announcement anyway (p. 25), so locking it again says
nothing, and the second sentence needs the Helicopter **unlocked** to be
spendable later.

The interesting half is **which path**. Two rulings draw the line
precisely: *"if directly put (and not equipped) on the vampire, it is not
locked"* [LSJ 20090415] [LSJ 20100119], but *"it comes locked if it is
equipped, even in a non-standard fashion"* [LSJ 20100119]. So the lock
goes in `enterPermanent` — the shared equip/employ/recruit pipeline, which
a card saying "equip this vampire with a weapon from your hand" also
reaches — and **not** in `notifyEnterPlay`, and not on the
`putsInPlayOnSuccess` / `attachOnSuccess` paths, which are a card putting
*itself* into play. The rulings and the existing code seam agree exactly,
which is the pleasant case.

The second sentence is `lockToUnlockAfterSuccess`, offered in
`action.afterResolution` — the only window that can say "successful" — and
withheld unless the bearer is the actor and is actually locked.

## §3 — "Only usable by" is not "Requires"

Body Bag is the card that would have gone in wrong.

*"Only usable by an anarch"* reads exactly like a play requirement, and
`requiresSect: ["anarch"]` is sitting right there. It is wrong: *"can be
equipped by a NON-ANARCH and would still count as a haven, although the
rest of his effect does not apply"* [LSJ 20030607]. The sect gates the
**ability**, not the card — and a Body Bag on a Camarilla vampire is still
a haven, which still blocks a second one.

So `requiresSect` sits inside `burnBloodToFailAction`, and the card itself
carries no requirement. A `requiresSect` on the card would have been
invisible: the card would work correctly every time an anarch wore it,
which is every time anyone would want to play it.

Its other ruling was free. *"Cannot be used while a block is being
attempted, or has already been successful"* [ANK 20260316]
[LSJ 20041022] is state A with no block attempt — the same gate the ally
form of `burnToFailAction` already reads.

## §4 — A store that was already built

Delivery Truck's store is `store.addFromHandInMasterPhase` +
`store.playableFrom`, both built for Black Market Cache and the Ravnos
cards. Two small additions: `max` (*"if it doesn't already have one"*, a
cap on the STORE, so checked once rather than per candidate) and
`notTags` (*"a NON-LOCATION equipment card"* — Living Manse is an
equipment card by type and a location by sub-type, so the type filter
alone would have taken it).

*"As a +1 stealth action"* is the equip action's own +1 (p. 20) restated,
not an addition to it — the standing parenthetical lesson, and the reason
nothing was added for it.

## What the wave found

**Nothing broken, and one card that would have been.** Body Bag's
"only usable by" is a wording VTES uses deliberately against "requires",
and the difference is a whole clause of behaviour that no test would have
caught: the wrong reading fails only on a board nobody sets up on purpose.

The other observation is the opposite of a finding, and worth the same
line: the exclusivity key, the store and the equip pipeline all did what
the cards needed with two small parameters between them. Three waves into
Equipment, the bucket is now mostly assembly.

## What is left

102 equipment cards. The vehicles that remain each add a clause rather
than a class: **Ambulance** (its second sentence targets an incapacitated
**imbued** — inert by §0), **Highway Haven: RV** (werewolves, likewise),
**Polaris Coach** (counter upkeep, a stealth price, and a block
restriction). **Writ of Acceptance stays out of scope** — a sect change.

## Tests

`tests/cards/vehicles-and-havens.test.ts`, 6 tests, four of them negative:
a second vehicle of a different name is not offered, a Helicopter already
locked offers no unlock, Body Bag's ability is withheld from a Camarilla
bearer while the card itself stays playable by one, and a bleed — directed
at a seat, not a minion — is not an action it can fail.
