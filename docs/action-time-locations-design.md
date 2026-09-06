# Locations that intervene during an action

Status: **design + implementation** (2026-08-31). Chosen by pool survey —
Master is the largest remaining family (43), and this is its most coherent
cluster. It extends the closed **lock-grant locations** gate
(`docs/lock-grant-locations-design.md`) rather than opening a new one.

## 1. The shape

A location that does something at a specific moment *inside another
minion's action*: as it is announced, while a block attempt is live, or
after it resolves.

| id | card | |
|---|---|---|
| 100444 | Creepshow Casino | lock as your vampire **announces** an undirected action → +1 stealth, **even if not yet needed** |
| 102189 | WMRH Talk Radio | lock → a minion gets +1 intercept; if it **does not block**, you burn 1 pool after resolution |
| 101662 | The Rumor Mill | lock during an action → a **chosen** vampire may **burn 1 blood** for +1 intercept |
| 100366 | Club Illusion | an Anarch may **burn 1 blood once** as they announce a bleed → +1 bleed (**no lock**) |
| 102149 | Warsaw Station | lock as a Nosferatu announces an undirected action → **unlock them** if it succeeds; **burn it, even locked**, to bring a Nosferatu out of torpor |

Five cards, five new knobs on one existing structure. That is the case for
extending `lockGrant` rather than writing five bespoke handlers.

## 2. What each knob is, and why it is not a special case

- **`evenIfNotNeeded`** — the stealth branch gates on p. 26 ("only when
  needed"), which is right for every existing card and wrong for
  Creepshow Casino, whose text overrides it in so many words. The same
  named rule already exists as a *mode* rule for cards in hand (Form of
  the Cobra); this is it for a card in play.
- **`atAnnouncement`** — the existing stealth branch requires a live
  `blockAttempt`, because that is when stealth is "needed". Creepshow
  Casino and Warsaw Station fire *as the action is announced*, before any
  attempt exists. Read, as `onlyAsAnnounced` already is, as **state A
  with no attempt underway**.
- **`recipientCost: { blood }`** — "the chosen vampire **can burn 1
  blood** to get +1 intercept". Every existing cost on a `lockGrant` is
  paid by the location's controller in pool (`otherMethuselah.poolCost`);
  this one is paid by the **recipient**, in blood, and is the reason they
  may decline. It is what Club Illusion and The Rumor Mill share.
- **`anyVampire`** — The Rumor Mill chooses "a vampire", not "a minion
  you control" and not "the blocker". One option per legal recipient, the
  target riding in the option id.
- **`noLock`** — Club Illusion never locks; the location is a standing
  permission its controller's Anarchs pay for. Modelled here rather than
  as a bespoke handler because everything else about it is a `lockGrant`.

## 3. The two riders

Both are deferred effects registered on the `ActionFrame` when the
location is used, which is the established shape:

- **WMRH Talk Radio** — "if that minion does not block, burn 1 pool after
  action resolution". `ActionFrame.notBlockPenalties` already exists for
  Forced Awakening and already runs at exactly the right moment; it burned
  **blood from the minion**, and this burns **pool from a seat**, so the
  entry gains an optional `seat`. One field, one branch.
- **Warsaw Station** — "after action resolution, if that action was
  successful, unlock the acting Nosferatu". A new
  `ActionFrame.unlockOnSuccess`, applied beside the existing
  post-resolution riders. Note it is conditional on **success**, where
  `notBlockPenalties` deliberately is not.

## 4. Readings on record

- **Club Illusion's "once"** is read as **once per action** ("once as
  they announce a bleed action"), tracked on the `ActionFrame` like the
  other per-action limits, not once per turn or per game.
- **WMRH Talk Radio grants to "a minion"** — any Methuselah's, since the
  card does not say "you control", and the pool it costs is the
  location's controller's. That is the same asymmetry KRCG News Radio
  already has, so it is not a new reading, only a wider one.
- **Warsaw Station's second clause burns the card "even if it is
  locked"**, which is worth stating because every other burn-self ability
  in the pool is gated on the card being unlocked. The clause exists
  precisely to let you cash in a location you already spent this turn.
- Creepshow Casino and Warsaw Station both say **"undirected action"**;
  `lockGrant.undirectedOnly` already carries that and needed no change.

## 5. Not in this cluster

**Guardian Angel** (100866) and **Depravity** (100526) are on-vampire
statics masters, not action-time locations — they belong with the
`on-vampire-statics` family. **Warsaw Station's** torpor clause is the
only piece here that touches a region rather than an action; it reuses the
existing `LeftTorpor` event, so it needs no new state.
