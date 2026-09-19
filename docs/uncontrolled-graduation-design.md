# The uncontrolled region as a place you pump and graduate from

Wave 64 (2026-09-18). Gather (100812), Heartblood of the Clan (100906),
Social Ladder (101820), Tomb of Rameses III (101987).

Wave 63 made the influence phase's *currency* a thing cards can touch.
This wave touches the *region* the currency feeds: four cards that fill an
uncontrolled vampire from somewhere other than your pool, or move one into
play by a door the phase does not own.

| Card | What it does |
| --- | --- |
| Gather | names a younger Gangrel there, then moves them out for a lock |
| Tomb of Rameses III | matches every transfer to one vampire, and graduates them early |
| Heartblood of the Clan | a bank any Banu Haqim fills, that pays an uncontrolled Banu Haqim |
| Social Ladder | spends a vampire IN PLAY to fill an older one in the region |

---

## §1 — What the region already was

`SeatState.uncontrolled` is a list of `{ card, counters }` — a crypt card
with pool counters on it (p. 3). The influence phase spends transfers to
move counters on and off it, and `inf:out` takes a full vampire into the
ready region for free (p. 36). Cards had reached in once before, to *add*
blood (`lockGrant: "uncontrolledBlood"`, the clan libraries).

Nothing had ever taken a vampire OUT of it.

## §2 — One helper for the move

`moveUncontrolledToReady(seat, minion)` is the whole move, extracted from
the `inf:out` case and now called by both:

- **the pool tax** — "when any Methuselah moves a vampire from uncontrolled
  to controlled, he or she burns 1 additional pool" (Masquerade
  Enforcement) — applies to a card's move too, because the tax is on the
  MOVE and not on the phase,
- **counters become blood, capped at capacity**, the excess draining
  straight back to the bank (p. 36),
- and the leave-notification (§5).

A card doing this by hand would have had one of the three wrong. The
chosen vampire itself is recorded on the card's entry as
`linkedUncontrolled` — its own field, not `linkedMinion`, because that one
names a minion **in play** and every reader of it assumes so.

## §3 — Gather: three clauses that each say "not yet"

> "+1 stealth action. Unique. Put this card in play, **locked**, and choose
> a **younger** Gangrel in your uncontrolled region. During the influence
> phase, you may **lock** this card to move that Gangrel … **unless that
> Gangrel would contest a vampire in play**."

- **Locked on arrival** (`putInPlayOnSuccess.locked`) — so the graduation
  is never the same turn: the card unlocks in its controller's next unlock
  phase and pays out then. That is the whole price of the card.
- **"Younger"** is younger than the vampire who played it. A seat-level
  card has no bearer to ask, so the acting minion is recorded as the card
  arrives (`linkedMinion` on the `putInPlayOnSuccess` event) rather than
  re-derived later, when the action frame is gone. With that vampire dead
  the comparison has no subject and nobody qualifies — which is the
  honest answer, not an exception.
- **The contest** gates the OPTION, not the use: a vampire in the region
  with the same name as one in play (p. 17, any seat's) is simply not
  offered, so the player is never shown a move that cannot happen.

## §4 — Tomb of Rameses III: two new hooks

> "For each blood counter you **transfer** to the chosen vampire during
> your influence phase, move one counter from the blood bank to the Tomb.
> **At the end of your influence phase**, if the total number of counters
> on the chosen vampire **and on the Tomb** equals or exceeds that
> vampire's capacity, you may move the vampire to the ready region."

- `onTransferToUncontrolled` fires from the `transferToVampire` case, after
  the counter has landed, so a card that reads the total sees it.
- `onInfluencePhaseEnd` is the fifth phase hook and the second that fires
  as a phase **closes** — before `tf.phase` moves, because the clause asks
  about the phase that is ending (the `onMinionPhaseEnd` treatment).
- The Tomb's counters **count** toward the threshold and never move onto
  the vampire: a 4-capacity vampire comes out on two transfers, holding
  2 blood. The test pins the blood as well as the move, because a version
  that handed over the Tomb's counters too would pass a test that only
  checked the vampire left the region.
- "You **may**" is an optional ChoiceFrame, so declining is a plain pass.

## §5 — Leaving the region is a thing worth a notification

"Burn this card when this vampire leaves the uncontrolled region" is true
however they leave: influenced out by the phase, graduated by a card, or
removed from the game. So `notifyUncontrolledLeft` is called from the two
places that can do it, and the clause is a handler flag
(`burnWhenLinkedUncontrolledLeaves`) rather than a check inside one of
them. A third way out would have to opt in rather than silently skip it.

## §6 — Heartblood of the Clan, and the verb list nobody greps

> "Any Assamite can **add 1 blood to this card** as an action. During your
> influence phase, you can move **any amount** of blood from this card to
> an Assamite in your uncontrolled region."

The payout is a new `BloodStoreOffer` — `cardToUncontrolled`, in a new
`influence` window — offered per (vampire, amount), and never past what
the vampire can still hold: counters above capacity drain back to the bank
the instant they arrive (p. 6), so offering them is offering nothing.

The fill is the interesting half. "Any Assamite can add 1 blood to this
card as an action" is the **`vulnerableTo` family with a friendly
outcome**: same question of who may act, same cost at resolution, same
p. 27 success — only the outcome differs, so it is `outcome: "addCounter"`
there rather than a parallel grant nobody would keep in step. It prints no
Ⓓ, hence `undirected: true`, which is what keeps the action from becoming
directed when it is another Methuselah's Assamite feeding your card.

**What it found: the granted-action recogniser was a regex spelling the
verbs.** An option id is `act:<Name>:<cardId>:<verb>:<actor>`, and the
merged provider decides who owns a chosen id with
`/:(burn|steal|shuffle|strip|raid|vote):/`. A new outcome writes a new
verb — `feed` — three thousand lines away from that line, so the action
**enumerated perfectly and threw the moment it was used**. Half-right,
which is the worst state for a bug, because the obvious test (is the
option offered?) passes. The verb is now produced by one function and the
recogniser's list is derived from it.

## §7 — Social Ladder, and an amount read after the emit

> "Put this card on a ready vampire you control. During your influence
> phase, **remove this vampire from the game** and move **all** the blood
> counters from that vampire to an **older** vampire in your uncontrolled
> region."

"Older" is greater capacity, as everywhere else in the pool; a region with
nobody older is not offered the option. The bearer is **removed**, not
burned (p. 16), so nothing reaches the ash heap and no card watching for a
burn fires.

**What it found (in this wave's own code): `ops.emit` applies
immediately.** The first draft moved the blood with two events and read
`bearer.blood` for both:

```ts
ops.emit({ type: "BloodBurned", minion: bearer.id, amount: bearer.blood });
ops.emit({ type: "UncontrolledBloodAdded", …, amount: bearer.blood }); // 0
```

The second read happens after the first event emptied him, so the vampire
in the region silently got **nothing** — and the test caught it only
because it asserted the destination's counters rather than just that the
bearer was gone. **An amount that appears twice is read once, into a
local.** The sibling of the "options are enumerated before the actor locks"
lesson, one layer down: a value read after a mutation is a different value.
