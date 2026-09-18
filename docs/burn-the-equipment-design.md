# Burn the equipment

Tranche 3, wave 41. Library **639 → 642**. Three equipment cards whose
price is **the card itself** — the generalisation of the one-off
`burnForIntercept` wave 40 added for Changeling Skin Mask.

| Card | KRCG | Printed |
|---|---:|---|
| Blood Tears of Kephran | 100212 | Unique. May **burn this card** to prevent 2 points of damage in combat **or** to gain 2 blood (ignore excess blood). |
| Mummy's Tongue | 101252 | Unique. May **burn this card** during your master phase to lock any vampire; that vampire does not unlock as normal during their next unlock phase. |
| Vial of Elder Vitae | 102114 | May **burn this card** to gain 1 level of any one Discipline until your next unlock phase — not one already at superior. |

All four arms burn the card **first** and deliver the benefit second. A
price paid after the benefit is a price a later effect can dodge, and the
ordering is free in every one of these.

## §1 — One price, two windows

Blood Tears is the reason the price is a **field of its own** rather than
a clause inside either effect. Its two halves —
`burnToPrevent` and `burnForBlood` — share nothing but the card they
spend: one lives in `combat.damageResolution` against the damage actually
pending on the bearer, the other has **no printed window at all**.

Both rulings turned out to cost nothing. *"If fewer points of
(preventable) damage are being resolved, then the effect prevents all of
those points"* [RTR 20041202] and *"unused prevention points can't be
carried over"* [ANK 20200318] [LSJ 20001114] are both already what
`preventDamageFor` does.

"Gain 2 blood" is gated only by the futile-option rule: a vampire at
capacity is not offered it, because *"ignore excess blood"* describes what
happens rather than giving a reason to ask
(`docs/futile-options-design.md`).

## §2 — "Any vampire" is the whole table

Mummy's Tongue is the master-phase arm. "Any" includes your own vampires,
and an already-locked one is not a legal target — locking it does nothing
for the second sentence to hang on. That second sentence is
`MinionState.skipNextUnlock`, built for Toreador Grand Ball and now on its
third card.

*"The 'does not unlock as normal' effect is redundant with being
infernal"* [LSJ 20050114] is a note about the other wording, not a second
behaviour.

## §3 — A trait that outlives the card that bought it

Vial of Elder Vitae is the interesting one. *"+1 level of any one
Discipline **until your next unlock phase**"* — the card is burnt to pay
for it, so there is no permanent left to hang a static on. The boost lives
on the minion as `MinionState.disciplineBoostUntilUnlock`, read by
`disciplinesOf` exactly like `PermanentStatics.disciplineBoost`, and
cleared at **one** place: the controller's unlock sweep, beside
`skipNextUnlock`, which is the same shape and the same lifetime.

One place matters here. The standing lesson is that anything scoped to a
live frame must be derived rather than stored — but an unlock phase is not
a frame that can end four ways. It happens once per turn per seat, in one
function, and "until your next unlock phase" means *that* sweep whether or
not the minion actually unlocks.

**And "any one Discipline" needed a vocabulary that did not exist.** The
engine had `CLANS` — hand-listed, with `clan-vocabulary.test.ts`
cross-checking it against the registry so it cannot drift as the pool
widens — and nothing equivalent for Disciplines. `DISCIPLINES` is now
beside it: eleven codes, `ani aus cel dom for obf obl pot pre pro tha`.

The drift guard asks the registry **twice**, and that is the point. A
Discipline is a property a VAMPIRE has; a library card carries a
Discipline REQUIREMENT. They are different sets that happen to be equal
today — eleven either way — which is exactly the condition under which a
single assertion passes for the wrong reason. This is the
`clan-vocabulary` lesson in a new place: while the library was V5-only,
crypt clans and library clans were the same names too, and the legacy
library brought in twenty-two clans no vampire has.

## What the wave found

**Nothing broken in the engine** — but a vocabulary that was missing, and
missing quietly. "Any one Discipline" is a rulebook phrase the same way
"every clan in the pool" is (p. 49), and a card offering some of them
would have been wrong without anything failing. The wave that widens the
crypt is the wave that would have discovered it, by which point the card
would have been in the pool for months.

The other observation is about the shape of the *price*. Wave 40 added
`burnForIntercept` as a one-off field on one card. Three cards later the
same price appears with four different payloads, and the honest reading is
that `equipmentAbilities` is now a small vocabulary of
"burn-this-card-to-X" rather than a list of one-offs. It has not been
refactored into a single `{ price: "card", effect: … }` — four fields
still say what they do at the call site, and there is no third caller yet
— but the next one that arrives should make that the change rather than a
fifth field.

## What is left

105 equipment cards. The next clusters: the **vehicles** (Helicopter,
Learjet, Ambulance, Delivery Truck — all sharing "a minion may have only
one vehicle", which is `exclusiveKey`), and the counter-bearing equipment
(Cooler, Polaris Coach). **Writ of Acceptance stays out of scope** — a
sect change.

## Tests

`tests/cards/burn-the-equipment.test.ts`, 4 tests, three of them negative:
the blood gain is withheld at capacity, an already-locked vampire is not a
lock target, and a Discipline already at superior is not offered. The
fourth is the `DISCIPLINES` drift guard.
