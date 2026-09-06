# On-Vampire Static Permanents — Gate 4 (IMPLEMENTED)

Status: APPROVED — implementing (doc-per-gate; owner makes the scope calls).

## What this covers

Action cards that, on success, "Put this card on this vampire" and grant a
persistent static to that vampire — extending the existing attached-static
machinery (equipment/retainers) to cards that attach to the **acting**
vampire via a normal (non-equip) action.

## Mechanic

- `PermanentStatics` gains `bleed?` and `strength?` — persistent bonuses to
  the bearer's bleed amount and printed combat strength.
- `derived.currentBleed` folds attached `bleed` statics into the acting
  vampire's bleed; the combat `strengthOf` helper folds attached `strength`
  into the printed base (a "strength of N this combat" override still
  replaces it).
- New action primitive `attachSelf { bleed?, strength? }`. In
  `compileActionCard`: options skip the play when the acting vampire
  already carries a permanent tagged with this card's name ("A vampire can
  have only one …" — own-duplicate prevention); a new `attachOnSuccess`
  handler hook returns the mode-aware statics/tags.
- `enterPermanentFromAction` gains a leading branch: a handler with
  `attachOnSuccess` emits `PermanentEnteredPlay` attached to `af.acting`
  instead of burning the card.

## Cards shipped

- **Heart of the City** (100904, `[pre]` action): +1 stealth action;
  attaches, +1 bleed (superior +2).
- **Preternatural Strength** (101483, `[pot]` action): +2 stealth action;
  attaches, +1 strength (superior +2).

## Deviations / notes

- Preternatural Strength's "cannot play cards named Torn Signpost" rider is
  unmodeled (a per-card play restriction with no other card that needs the
  mechanism yet).
- A "strength of N this combat" set-effect (Torn Signpost, Form of the
  Wolf) replaces the printed+attached base rather than stacking with the
  attached +strength — a set overrides, a bonus adds. Revisit if a card
  needs both to compose.
