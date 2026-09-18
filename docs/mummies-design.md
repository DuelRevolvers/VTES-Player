# The mummies

Tranche 1 wave 48, 2026-09-14 (v0.10.38). Qetu the Evil Doer (101527),
Saatet-ta (101665), Nephren-Ka (101273). Library 662 → 665.

Six allies print "unique **mummy** with N life … if \<she\> is burned,
shuffle \<her\> into \<her\> owner's library". Amam the Devourer took that
clause in wave 47 (`ally.shuffleIntoLibraryOnBurn`), so the primitive that
makes this a family already existed and each card here costs exactly one
new knob. **Wave 49 (v0.10.39) closed the family** with Akhenaten, Kherebutu and
Tutu — §§4–5 below. All six are in.

## §1 Qetu — a press credit that can only END combat

*"Qetu gets 1 optional press each combat, only usable to end combat."*

p. 32 gives a press exactly two uses: continue combat, or cancel a press
to continue. So "only usable to end" is the second of them, and it is the
exact mirror of Righteous Blade's `continuePressPerCombat`
(docs/weapon-riders-design.md §4). New static `endPressPerCombat`, new
frame pool `pressesEndOnly`, offered only for `press:end` and **spent
first** there by the same "most restricted credit first" rule — a credit
that can buy one thing must not be stranded behind one that can buy two.

**The mirror needed a guard the original did not.** `press:continue` was
enumerated whenever *any* credit was available, which the continue-only
pool made true and correct. An END-only credit makes it true and wrong:
there is no press to continue for it to cancel yet. So `press:continue`
now tests the pools that can actually buy it, rather than the total.

## §2 Saatet-ta — one lock, three answers

*"During an action, Saatet-ta can lock to give a Follower of Set you
control +1 stealth, +1 intercept, or +1 bleed."* ("Follower of Set" is
the Ministry under its pre-V5 name.)

`permanent.lockGrant` carried a single `grant`. The choice here is not a
frame — it is the option list, because the three answers differ in who
they reach (stealth and bleed ride the ACTOR, intercept rides a BLOCKER)
and those three enumerations already exist and disagree usefully. New
`lockGrant.grants`, and the enumerator runs once per grant over a
synthetic `{...lg, grant}`; **`useAbility` needed no change at all**,
because it already dispatched on `params.grant`. `grant` stays the first
of them, so no existing card moved.

## §3 Nephren-Ka — a prevention a MODE of damage switches off

*"Nephren-Ka can prevent 1 non-aggravated damage each combat."*

`retainerAbilities.preventPerCombat` (Resplendent Protector) reads
`owner.minion`, which for an ally's self-attached entry is the ally
itself — so it worked on an ally with no change, and only the
aggravated filter was missing (`preventNonAggOnly`, gating the option so
an aggravated blow simply does not offer it).

His rush is the existing `rush` field. **The Necromancy clause is
implemented and matters to nothing today**: no card in the pool requires
`[nec]`, which V5 replaced with Oblivion. That is not §0 inertness — §0
is about a card that can never do anything, and this card rushes,
prevents and goes home to the library — and it costs nothing the day a
`[nec]` card is admitted.

## §4 Akhenaten and Kherebutu — the price is the actor

*"Akhenaten can burn himself to burn a Follower of Set controlled by your
prey as a Ⓓ action."* *"Kherebutu can burn himself and a Tremere with
capacity 4 or less controlled by your prey as a Ⓓ action."*

New `grantedAction` arm **`burnSelfAndBurnMinion`**, with `targetClan`,
`maxCapacity` and the existing `scope`. It is its own arm rather than a
priced `burnPermanent` because **the price is not a price**: "burn himself
AND a Tremere" is one sentence with two burns, so the actor goes whether
or not the target is still there at resolution. A cost would have been
refundable-shaped; this is not.

Akhenaten also prints *"In combat with a Follower of Set, any damage he
inflicts is aggravated."* **"Any damage", not "hand strikes"** — so the
existing `handStrikesAggravated` is the wrong half of it. New static
`allDamageAggravatedVsClan`, read at the single place a strike becomes
damage, above the hand/weapon split, so a weapon strike is covered too.

Both play `[nec]` as a vampire, which matters to nothing today (§3).

## §5 Tutu — three clauses, one new knob each

*"Once each combat, Tutu can strike: dodge"* is **`grantsStrikePerCombat:
{ kind: "dodge" }`** — Treasured Samadji's field, which already worked on
a self-attached ally entry with no clan filter. Checking before building
saved the card (the standing "it already exists is a claim to CHECK"
rule, pointing the other way for once).

*"During your minion phase, Tutu can unlock"* — `unlockAtMinionPhase`, on
the minion-phase OPENER that wave 43 had to build (`onMinionPhase`), gated
on its own controller's phase, which is what "your" names.

*"Tutu can steal an equipment from a vampire in torpor as a Ⓓ action"* —
`stealEquipment` existed and was unfiltered; `fromTorporOnly` gates the
option, so a ready bearer's gear is never announceable.
