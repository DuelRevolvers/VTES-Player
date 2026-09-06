# Card Counters — Gate 8 (IMPLEMENTED, infrastructure)

Status: APPROVED — implementing (doc-per-gate; owner makes the scope calls).

## Scope call

The roadmap flagged this as "not a single clean gate — most counter cards
land as one-offs," and a scan of the ~19 unsupported counter cards confirms
it: each accumulates and spends counters by its own idiosyncratic rules
(Dreams of the Sphinx's four lock-abilities, Powerbase's vote-per-counter
plus opponent-burn action, Dead Pool's combat-leave trigger, Week of
Nightmares' global Ravnos economy, and so on). There is no shared behavior
to compile — only a shared **data field**.

So Gate 8 ships that field and the primitives every counter card needs, and
leaves the cards themselves for the one-off phase. No card flips to
supported in this gate; the payoff is that each one-off can now be a thin
bespoke handler over a common substrate instead of reinventing counters.

## Mechanic

- `PermanentInPlay.counters?: number` — a plain tally on a card in play,
  distinct from `life`/blood.
- Event `CountersChanged { cardId, delta }`, applied by clamping the
  card's counters at 0 (event-sourced, so replays and undo are exact).
- `PermanentEnteredPlay.counters?` and `putPermanentInPlay({ …, counters })`
  — "put this card in play with N counters".
- Ops `addCounters(cardId, n)` / `removeCounters(cardId, n)`.

Handlers read `entry.counters` directly (like `entry.life`), so a counter
card's abilities (vote/bleed/pool riders scaled by counter count, burn-at-
threshold, etc.) compose with the existing vocabulary.

## Validation

`tests/engine/counters.test.ts` drives the real engine: enter-with-counters,
add, remove-with-clamp, event-sourcing, and the untouched-default case.

## The one-off phase (next)

Counter cards to sweep individually on this substrate: Dreams of the Sphinx,
Powerbase: Madrid, Dead Pool, Under Siege, Constant Revolution, Open War,
The Gate of Acheron, Pit of Contemplation, Split the Veil, Week of
Nightmares, Ravnos Cache/Carnival, Carver's Meat Packing, Cave of Apples,
Wall Street Night, Wasserschloss Anif, Visit from the Capuchin, Smiling
Jack, Cursed Abattoir, Dance of the Dead, and the counter crypt cards.
Several also need mechanics parked elsewhere (ash-heap ally region,
granted opponent actions, global clan economies).
