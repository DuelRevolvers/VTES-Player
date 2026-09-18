# Gehenna: the unlock-phase trio

Tranche 1 wave 50, 2026-09-14 (v0.10.40). The New Inquisition (101279),
Becoming of Ennoia (100148), Recalled to the Founder (101566).
Library 668 → 671.

Three Gehenna events that each fire in EVERY Methuselah's **unlock**
phase. Wave 32 built that trigger (`eachMethuselah`, one card in one play
area firing for the seat whose phase it is), so what this wave adds is
what the three of them DO — and each one is a question put to the seat
whose phase it is, which is a shape the existing three did not have.

## §1 Why this is a family

The recurring Gehenna events built so far all resolve by themselves:
Dragonbound burns pool, Thirst burns blood, Conquest of Humanity asks one
question and hands the second to another seat. These three all **ask the
phase's own Methuselah to pick one of their own or their prey's minions**,
which means the same choice-frame plumbing pays for all three and the
interesting differences are in the filters:

| Card | Reads | Picks from | Optional? |
|---|---|---|---|
| The New Inquisition | the PREY's ready region | ready vampires | yes — "can choose" |
| Becoming of Ennoia | your OWN ready region | ready vampires | no — "chooses" |
| Recalled to the Founder | your whole controlled region | the clan that reached three | no |

One new effect kind covers the first two (`damageReadyVampire`, with
`whose` and `optional`), one covers the third (`burnSameClanVampire`).

## §2 The gate is a play-time question, and "other" can mean other SEATS

All three print "Requires N or more other Gehenna events in play", which
`requiresOtherGehennaEvents` already handled, and which is **checked only
when the card is played** — *"the 'other Gehenna cards in play'
requirement is only checked when playing the card"* [PIB 20121031]. The
card stays and keeps working once the others are gone.

Becoming of Ennoia narrows it: *"at least two other Gehenna cards
**controlled by other Methuselahs** in play."* New
`gehennaGateOthersOnly`, which counts the same tag over every seat play
area but your own. An event sits in a SEAT play area, so "controlled by"
is simply which seat holds it, with no bearer to chase.

**This gate has never been reachable by random play.** Conquest of
Humanity has carried `requiresOtherGehennaEvents: 2` since wave 32, and a
tally over 120 fuzz seeds found it offered **zero** times — only the
ungated Gehenna events (Thirst, Dragonbound, Torpid Blood, The Slow
Withering) ever come up, because playing an event costs the turn's one
discard-phase action and a random agent rarely spends it there, let alone
twice in the same game before a third seat's discard phase. The three
cards here are in the fuzz decks and are proven by scenario tests in both
spaces (§6) rather than by the fuzz, for the same reason Suppressing Fire
is.

## §3 "Can choose" and "chooses" are different questions

*"During each Methuselah's unlock phase, that Methuselah **can** choose a
ready vampire controlled by their prey"* (The New Inquisition) against
*"…he or she **chooses** a ready vampire he or she controls"* (Becoming of
Ennoia). That is the `optional` flag on the choice frame, and it is the
whole difference between a card the table can ignore and a card that
bites its own controller every turn. Both are pinned: one asserts `pass`
is offered, the other asserts it is not.

The damage is unpreventable environmental damage — `source: null`, which
is what makes it undodgeable and unpreventable (p. 31) — through
`applyEnvironmentalDamage`, the helper the engine's own loop uses, rather
than a fresh `DamageInflicted`.

## §4 Recalled to the Founder: burn first, then the exemption

*"…if that Methuselah controls 3 or more vampires of the same clan, they
burn one of those vampires. If that vampire's capacity is 6 or more, that
Methuselah ignores this effect until the end of the game."*

Two readings were possible: capacity 6 as an ESCAPE (they keep the
vampire and are exempt) or as a CONSEQUENCE (they burn it and are exempt
thereafter). The printed order is a sequence — "they burn one of those
vampires" is a completed sentence before the capacity clause begins — so
the card burns, then checks what it burned. Feeding a big vampire to it
once buys the rest of the game.

Two details the text pins down and a looser reading would miss:

- **"of those vampires"** — the legal targets are the members of a clan
  that actually reached three, not every vampire the Methuselah controls.
  With three Ventrue and one Brujah, the Brujah is not offered.
- **"controls"**, not "ready" — a torpid vampire counts toward the three
  and can be the one burned.

The exemption is kept **on the card** (`PermanentInPlay.exemptSeats`),
not on the seat: it is this copy's clause, and a second Recalled to the
Founder played later must ask everybody again.

## §5 "Titled vampires can call a referendum to burn this card"

`permanent.vulnerableTo` with `via: "politicalAction"` is the Anarch
Revolt / War of Ages shape and already carried the +1 stealth, the
one-political-action-per-vampire-per-turn bar and the referendum. The
only thing missing was the filter: new `who.titled`, reading the same
`m.title` every other titled-vampire filter in the tree reads, so a
card-granted title (a Praxis Seizure, a Crusade) qualifies exactly as a
printed one does.

## §6 What the wave found

Both defects came from **widening the fuzz to 120 seeds** to check whether
the new cards were reachable. They are unrelated to the cards, and the
lesson is that the ten standing seeds are a regression guard, not a
search: the same decks under more seeds had two throws waiting in them.

**A prevention resolving after its own minion has burned itself.** Seed
49: a **Rafastio Ghoul** — an ally with 1 life — played **Rego Motum**,
whose cost is 1 blood, and *an ally's life IS its blood* (p. 11), so
paying the cost burned the ally. Its pending damage left the queue with
it, and `preventDamage` threw "no damage to prevent" when the card
resolved. This is the recorded "a strike is CHOSEN in one window and
RESOLVED in another" lesson in a place nobody had looked: the prevention
path, where the minion leaving is caused by the very card being
resolved. Now a no-op — nothing left to prevent is the card doing
nothing, not an error.

**A cancel that addressed the top frame after the payment moved it.**
Seed 58: `cancelPendingCard` documented its own assumption — *"its own
frame is already popped, so the card being canceled is the top frame"* —
and paying for the cancel breaks it. Discarding the price replaces the
card (p. 7) and that draw can push a frame, so by the time the cancel
ran, the top frame was a choice frame and the throw was "no pending card
play to cancel". The frame is now captured BEFORE the payment and passed
in. **An assumption a function states in its own comment is still an
assumption**, and the caller that pays first is the one that breaks it.
