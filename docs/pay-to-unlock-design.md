# Paying blood to unlock

Wave 66 (2026-09-18). Detection (100533), Children of Osiris (100339),
Firebrand (100736), Eternal Vigilance (100666).

Unlocking is free (p. 17): "unlock all of your cards". Four cards put a
price on it, or sell it back — and they do it in four different windows,
which is what makes them one wave rather than four cards.

| Card | Window | Who unlocks | Who pays |
| --- | --- | --- | --- |
| Detection | the controller's unlock phase | the bearer | the bearer |
| Children of Osiris | each controller's unlock phase | every own Ministry vampire | itself |
| Firebrand | the controller's minion phase | a ready younger anarch | the bearer |
| Eternal Vigilance | any action, into a block | the bearer | the bearer |

---

## §1 — One primitive, four windows

`permanent.payToUnlock { blood, window, who, andBlock? }`. `who` is the only
branchy part, and it is branchy because the cards genuinely differ: the
bearer, every own vampire of a clan (Children of Osiris has no bearer at
all — it is a seat-level card), or a ready younger vampire of a sect that
the **bearer** pays for.

Every arm computes a pair — **who unlocks** and **who pays** — because on
Firebrand they are different vampires, and a single `minion` field would
have silently charged the wrong one.

## §2 — Suppression, and why it had to come first

Two of the four cards say "does not unlock as normal", which is what makes
buying the unlock back worth anything. The engine already had that clause
three ways — stun counters, the one-shot `skipNextUnlock`, and the
persistent `preventsUnlock` naming ONE minion — and all three funnel
through `unlockSuppressed`. So the two new forms went in there:

- `bearerDoesNotUnlock` — read only off the bearer's own attached cards,
- `clanDoesNotUnlock` — read off **every seat's** cards in play, against the
  minion's clan, because Children of Osiris is one Methuselah's card ruling
  a clan across the table.

**A test that only checked the offer existed would pass on a card that did
nothing**, so each of these two cards is pinned on the sweep first: the
bearer stays locked, the seat's other minion does not; the Ministry
vampires stay locked, the Brujah does not.

## §3 — Whose offer is it?

Three of these four cards are played **onto a vampire their own controller
does not control** — Detection is a hate card ("put this card on a
Lasombra", no "you control") and Children of Osiris taxes every Ministry
vampire at the table. The blood is the bearer's and the unlock phase is the
bearer's controller's, so **the offer belongs to them, not to whoever played
the card**.

That means the options are built for `ctx.seat` and **before** the
controller gate every other ability in `addLocationAbilities` sits behind,
with `abilityAnySeat` set so the engine asks the card on somebody else's
turn at all. **Which seat an ability belongs to is a per-card question**, and
getting it backwards offers the card to nobody, silently — the lesson that
has bitten this project five times. The test pins it from both ends: Bob is
offered the buy-back on Alice's card, and the seats that are not the
bearer's controller never see it.

## §4 — The small clauses each card brings

- **Detection** also says "this vampire cannot cast votes or ballots" — the
  persistent form of `expelledThisTurn`, which is one turn long, so it is a
  new static read in the same vote enumerator, one line below its
  turn-scoped sibling.
- **Children of Osiris** is burnable by any vampire, and "Followers of Set
  get −1 stealth when attempting that action" is `vulnerableTo.stealthFor`,
  which already existed: the clan it taxes is the clan that finds it
  hardest to remove.
- **Firebrand** arrives by a successful referendum (`refPutInPlay
  { onActor: true }`), grants a vote (`statics.votes`) and burns if the
  bearer goes to torpor (`burnWhenBearerLeavesReady`) — three existing
  fields, no new code.
- **Eternal Vigilance** requires a ready archbishop, priscus, cardinal or
  regent (`requiresControlledTitle`, which already existed) — and those
  titles are printed on 22 / 3 / 8 / 4 cards in the V5 pool, so the card is
  not inert. Checked before building, not after.

## §5 — `andBlock` goes through the op, not around it

Eternal Vigilance unlocks **and attempts to block**, so its apply calls
`ops.unlockAndAttemptBlock` rather than emitting the unlock itself. That is
not tidiness: the op registers the pending block attempt AND charges wave
65's `unlockEffectPoolTax` (Burden the Mind) on the way through. Two cards
from consecutive waves meet correctly because the second one used the
funnel the first one taxed.

The other three emit a plain `MinionUnlocked`: there is no block to attempt
in an unlock or minion phase, and Burden the Mind's own clause says "while
it is **not** this minion's turn", which those windows are not.

## §6 — What the wave found

**Nothing in the engine was wrong this time** — the first wave in a while
where the four cards fell out of existing machinery plus one new spec field.
What it did surface is a metadata slip of the kind `supported.test.ts`
exists for: Eternal Vigilance prints a **1 blood cost** on the action, which
the first draft of the spec had as 0 while correctly implementing the 1
blood its *ability* asks for later. Two prices on one card, and the obvious
one is the one a reader skips. The cross-check caught it on the first full
run.
