# Events, the card type

Tranche 3, wave 31. Library **609 → 612**. The **Event** bucket was
untouched — *"no event card is in the pool at all; expect this to need
machinery, not just cards"* — so this wave is the card type plus the
three simplest events that use it.

| Card | KRCG | Printed |
|---|---:|---|
| The Bitter and Sweet Story | 100163 | Each Methuselah gets **+2 hand size for each victory point** he or she has. |
| Hunger Moon | 100944 | If a vampire **successfully hunts**, move 1 blood from that vampire to this card after resolution. **Burn this card if it has 5 blood.** |
| Narrow Minds | 101265 | Do not replace until your next unlock phase. **Minion cards that change the target of a bleed** cost +1 blood or life. |

## §1 — What an event is (p. 37)

> "Once each **discard phase**, a Methuselah may use a **discard phase
> action** to put an event card in play. **Each event can only be played
> once in a game.** An event card is controlled by the Methuselah who
> played it."
>
> "You may use a discard phase action to put an event card into play but
> **no more than one per phase**."

Three facts, and each landed somewhere different:

- **The window.** `cardType: "event"` compiles as a **master card with a
  different window** — it goes into play, it is controlled by whoever
  played it, its text is a static or a hook, and none of that differs. The
  event compiler asks the master compiler its own question with the window
  swapped, rather than duplicating the enumeration.
- **The action.** `tf.discardActionsLeft` already existed for discarding.
  An event spends the same one, so the two **compete** — that is what
  "a discard phase action" means, and the test asserts the discard option
  disappears once the event is played.
- **Once each game.** `GameState.eventsPlayed` holds NAMES, recorded when
  the card is played rather than when it enters play, so a cancelled
  event is still spent — and the bar outlives the card, which is why it
  cannot live on a seat or on the card itself.

**Hand cards had never been enumerated in the discard phase.** The master
window enumerates them; the discard window did not, because until now
nothing in hand could be played there. One line, and it is the whole
reason the bucket was called "machinery, not just cards".

## §2 — Two cards that read the table, not their owner

**The Bitter and Sweet Story** is one card in one Methuselah's play area
that changes **every** Methuselah's hand size, each against **their own**
victory points. `handSizeOf` loops over the asking seat's own permanents,
which is right for every other hand-size static and wrong for this one —
so the new read scans every seat's permanents and multiplies by the
asking seat's victory points. The test pins all three seats, including
the one with no victory points, because "for each victory point he or she
has" is as much about the seat with none.

**Hunger Moon** fires on **any** vampire's hunt, not its controller's.
`onHuntSuccess` already fired for every card in play; this handler simply
does not ask whose minion it was. *"If the vampire gains no blood from
their hunt, it is not successful"* [LSJ 20050720-2] is what the engine's
hunt-success signal already means, so the ruling needed no code. The
hunter is read with `findMinion` — "after resolution" is late enough for
them to be gone.

## §3 — A price on what a card DOES

Narrow Minds taxes *"minion cards that change the target of a bleed"* —
not a name, not a type. `PlayCostMod` could filter by name, type,
discipline, clan and printed tag, all of which are facts about the card's
face. This is a fact about its **effects**, so the handler now declares
`redirectsBleed` (set when any mode has `redirectBleed`) and the modifier
matches on it.

Its global reach came free: `playCostModsFor` already scans **every**
seat's seat-level permanents, because Libertas charges "other minions".

## What the wave found

**`central-queries` was right and my shortcut was wrong.** I first mapped
the event type to *no* cost types, reasoning that nothing in the pool
prices an event. The test that every library card names at least one
printed type caught it. The cost vocabulary is the **printed type line**,
not the set of types somebody has written a modifier for — so
`PlayCostCardType` gained `"event"`.

## What is left

37 more events, and they are not all this cheap. The **Gehenna** family
is gated on "N or more other Gehenna events in play" (a count over a
printed keyword, easy) but their effects reach into every phase of the
turn. `docs/card-status-by-set.md` has the list.

## Tests

`tests/cards/events.test.ts`, 4 tests. Two are about the type rather than
the cards: an event spends the discard action (and the discard option
goes with it), and the same event cannot be played twice in a game **even
after the first has left play** — which is the half a naive "unique in
play" check would get wrong.
