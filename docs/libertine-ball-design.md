# Wave 115: Libertine Ball

Built in 0.11.64. The owner approved the plan on 2026-11-08: add a
per-clan crypt filter, then complete Libertine Ball (Sabbat
Preconstructed, 2019).

## §1 Why this deck

Libertine Ball was at 80%, the nearest full-size legacy precon. Everything
it was missing concerns one clan, Toreador antitribu:

- Eight Toreador antitribu vampires with no printed ability, 11 copies in
  all. They are whole by the §0 rule and only needed their groups open.
- **L'Épuisette (G4):** +1 bleed against a Methuselah who controls a ready
  Toreador.
- **Foundation Exhibit** ×3 and **Palla Grande** ×3: two masters that do
  nothing unless a Toreador antitribu is in play.

The V5 pool has no Toreador antitribu, so the two masters would have been
whole but inert (§0) without the crypt. The library and the crypt had to
land together.

## §2 The per-clan filter

`config/crypt-groups.json` used to be `"groups": [n, …]`, which opens those
groups for every clan. For groups 4–5 that means 126 vampires with no
ability, from every clan except the Laibon. The new shape opens one clan
at a time:

```json
"open": [{ "clan": "Toreador antitribu", "groups": [4, 5] }]
```

The clan is the KRCG clan name (`clans[0]`), which is also the registry's
`clan`. `widenedCrypt` in `scripts/build-registry.mts` throws on a clan
that no vampire has. `tests/cards/pool-widening.test.ts` asserts that each
admitted vampire's clan and group are open, and that each open clan-group
admits at least one vampire.

## §3 Readings

There are no rulings for any of the three cards (KRCG lists none). The
printed text decides:

1. **Palla Grande's bleed is global.** "Toreador antitribu get +1 bleed"
   says nothing about who controls them, so it is read the same way as The
   Khabar: Community's "Assamites get +1 stealth".
2. **Palla Grande's clock is the controller's.** "During YOUR discard
   phase" means only the controller's discard phase. It counts 3 → 2 → 1 →
   0, and the card burns in the third such phase. The burn is mandatory.
3. **Foundation Exhibit's vote** goes only to vampires the controller
   controls ("you control"), and only to non-titled ones. A titled
   Toreador antitribu keeps its title's votes and gets nothing extra.
4. **"Any vampire can burn this card"** includes the controller's own
   vampires and excludes allies. It costs 1 blood and is directed at the
   controller.
5. **The clan icon on a master is not a requirement** (p. 10, the 179
   masters precedent). Foundation Exhibit carries one and anyone can play
   it.
6. **L'Épuisette reads "ready".** A Toreador in torpor doesn't count.
   Osvaldo Kühnemann's text has no "ready", so his condition stays wider.
   Toreador antitribu is a different clan from Toreador and doesn't count.

## §4 What was built

- `PermanentAura.untitledOnly`, read in `auraReaches` (`derived.ts`). The
  same clan / sect / title filter used to be written twice, in
  `auraBonus` and `auraFlag`. Now both call the one helper.
- `ConditionalStatic.controller.targetControlsReadyClan`, read in the
  same loop as `targetControlsClan`.
- `permanent.discardPhaseCountdown`, grafted onto `onDiscardPhase` in
  `compileMasterCard`. Its starting counters use the existing
  `startsWithCounters` static.
- `CLANS` now includes Toreador antitribu.

Tests: `tests/cards/libertine-ball.test.ts` (16 tests). Both masters are
played from the hand, so the tests run the compiled specs.

## §5 Not done: dealing the deck

Libertine Ball is 100% implemented, but it isn't in the precon chooser.
`collectPrecons` takes only V5 sets on purpose
(`card-status-by-set.md`, "Precon decks outside V5"). Every card in it is now in the registry, so pasting its list into the
deck importer should work, but no test checks that yet. Adding finished legacy precons to
the chooser is a separate decision for the owner.
