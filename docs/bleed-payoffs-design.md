# Bleed payoffs

Wave 86 (2026-09-21). Legal Manipulations (101089), Media Influence (101193),
Flurry of Action (100752).

Three directed **bleed actions** whose superior changes what the bleed buys:
pool, cards, or an unlock. First wave in the **Action** bucket, which is the
second largest left.

---

## §1 — What each card is

| Card | Basic | Superior |
| --- | --- | --- |
| Legal Manipulations (1 blood) | Ⓓ bleed **+2** | …and **gain 1 pool** on success |
| Media Influence (1 blood) | Ⓓ bleed **+2** | each of your **unlocked** vampires gains 1 blood |
| Flurry of Action | Ⓓ bleed, **draw 2** on success | Ⓓ bleed, **unlock** on success |

Legal Manipulations and Media Influence print the **identical basic** — Ⓓ bleed
+2, [pre], 1 blood. Either alone would look right with the wrong bonus; the pair
is what pins it. Flurry of Action's bleed carries **no** bonus both ways, so its
two modes differ only in the payoff.

## §2 — Three riders, one family

`poolGainOnBleedSuccess` already existed. This wave adds the other two —
`drawOnBleedSuccess` and `unlockOnBleedSuccess` — beside it, in the same switch,
reading the same `bleedOk`. That is the whole point of picking the family: the
three riders are now a set a reader can see at once.

## §3 — Two traps in one primitive

**`unlockAfterResolution` looked like the right primitive and silently did
nothing.** It is applied in the card-**PLAY** resolve switch and reads a
`CardPlayFrame` — which an action card's own effects do not have. Flurry of
Action is an action card, so the case was never reached: the card resolved, the
bleed landed, and the vampire stayed locked with nothing to show why.

That is the "machinery documented as general quietly does not apply to one case"
lesson, and the tell was the same as always — the effect lived in a switch whose
other cases all read a variable this caller has no access to. The fix is a rider
in the switch that *does* run for an action card. It is also **not optional**:
the card says "unlocks", not "may unlock", so no choice frame.

**`drawUpToHandSize` is not "discard afterward".** The first draft drew 2 and
then called `drawUpToHandSize`, which **refills** a short hand — so a fixture
with a small hand ended up with seven cards. "(Discard afterward)" is p. 7's
discard-**down**: a hand under size is left alone. The two ops are only
interchangeable when the hand is already full, which is exactly the case a test
is least likely to set up.

The parenthetical itself asks for nothing new — it describes the existing rule,
the sixth instance of that shape in this project.

## §4 — "Each of your unlocked vampires"

Media Influence's superior is not a bleed at all, which makes it the wave's
oddity and its most interesting assertion: Bob loses **no** pool. Three readings
in one clause:

- **Vampires only** — an unlocked ally is not one.
- **Unlocked only** — and the actor locked itself by announcing (p. 19), so the
  card never pays the vampire that played it. That is asserted on its own,
  because a lock is the only thing separating the two vampires in the fixture.
- **From the blood bank**, so it is a gain and not a transfer.

## §5 — What the tests needed

- **A library.** `threeSeatGame` leaves it empty, and a draw rider against an
  empty library is indistinguishable from no rider at all.
- **A control for the draw.** Three cards leave the library, not two: one is the
  played card's own replacement (p. 7). Legal Manipulations' basic — same shape,
  no rider — takes exactly one, which is what separates the rider from the
  replacement. Counting 3 alone would have proved nothing.
- **A control for the unlock**, since "unlocked" would also hold for a card that
  never locked the actor: Flurry's own basic leaves it locked.

Mutation-checked per wave 79 — the draw dropped, the unlock dropped, and the
`locked` filter removed from Media Influence: **three failures**, clean on
restore with both sites verified by grep.
