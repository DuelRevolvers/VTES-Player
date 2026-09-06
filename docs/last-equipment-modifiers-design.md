# The last equipment and the last modifiers

**Cards:** Bowl of Convergence (100243), Flaming Candle (100743), Living
Manse (101114), Monkey Wrench (101239), Spying Mission (101857),
Go-getter (102355).

**Equipment finishes at zero** — the fourth card type after Retainer,
Combat and (buildably) Master. **Action Modifier finishes at two, both
BLOCKED** (Paths in Two Worlds and Gifts From Hereafter are wraith/zombie
cards).

This wave was chosen by a survey the queue asked for, and the survey is
the more important half of it. §0 records it.

---

## 0. The survey: 20 of the 30 remaining cards are blocked

The queue said "Ally (7) and Action (7) are the two largest — several of
each are BLOCKED, so the buildable remainder is smaller than the counts
suggest". It is much smaller. Classifying every unsupported library card
by what its own text asks for:

| Blocker | Cards | Types |
| --- | --- | --- |
| **wraith / zombie** | **14** | 7 Ally, 2 Action, 2 Action Modifier, 2 Master, 1 Reaction |
| Path (out of scope) | 4 | 3 Master, 1 Action Modifier/Reaction |
| token vampire | 2 | 2 Action |
| **buildable** | **10** | 3 Equipment, 3 Action, 3 Action Modifier, 1 Political Action |

**All seven remaining allies are wraiths or zombies.** So is every
remaining Reaction. The wraith/zombie gate is now **the single largest
blocker in the pool at 14 cards** — larger than the ash heap ever was (9)
when the owner unblocked it on 2026-09-01.

It is on the BLOCKED list ("do not build unilaterally"), so this wave does
not touch it. It is flagged for the owner instead, with the same shape of
finding the ash-heap survey produced: a gate that is no longer "a zone we
have not needed" but the thing gating a seventh of the remaining pool.

What the gate would actually need, from reading all fourteen:

- **A minion kind.** `MinionState.kind` is `"vampire" | "ally"`; wraiths
  and zombies are allies with a printed sub-type. `permanentTags` already
  carries printed sub-types ("ghoul", used by Fleshforge Chamber), so the
  tag half is free.
- **Nine of the fourteen only need the tag** — Fiorella, Screamer,
  Heartrender, Dance of the Dead, Cursed Abattoir and friends filter on
  "a wraith or zombie ally you control" and otherwise use built machinery
  (`lockGrant`-shaped stealth/intercept, counters, `vulnerableTo`).
- **Five need real work**: Spectral Servitor (acts the turn it is
  recruited), Rotting Behemoth (a Ⓓ rush costing life, and an ash-heap
  removal as an entry cost), Bone Shambler and Gravebound Drone (both
  reason about **another copy of themselves** in play), Split the Veil
  (returns an ally from the ash heap to the ready region — the first
  effect that puts a *minion* back into play).

That is a real gate with a real design, not a tag. It is the owner's call.

---

## 1. Equipment: a live bug the wave had to fix first

`PermanentInPlay.tags` is what every "burn an equipment" enumerator reads
— `actionOnPermanent` with `what: "equipment"` (Conceal, Rewilding),
`Strike.burnEquipment` (Voracious Vermin, Phantasmagoria), the granted
burn-equipment strike, and Anarch Troublemaker's parting shot. All four
test `p.tags.includes("equipment")`.

**Only 2 of the 17 equipment cards in the pool carried that tag.** The
other 15 tag themselves "weapon"/"gun"/"melee"/"vehicle" or by their own
name, so every one of those enumerators had been looking at a nearly
empty table. It is the failure this project keeps finding — a filter that
is empty for the wrong reason, and structurally invisible to the fuzz,
which cannot tell a correctly empty option list from an incorrectly empty
one.

Fixed centrally in `backfillCentralQueries`, so a hand-rolled equipment
handler (.44 Magnum) cannot forget it either:

```
if (h.isEquipment && !tags.includes("equipment") && !tags.includes("notEquipment"))
    tags.push("equipment");
```

**And Living Manse is the sharpest possible test of the fix**, because
its whole first clause is *not being equipment*: "Location. While in
play, this card does not count as equipment." The escape hatch is a tag
(`notEquipment`), keeping the whole question inside the vocabulary that
already answers "is this a location, a vehicle, a ghoul". A card that
opts out and a card that does not are one line apart, and the test
asserts both directions.

---

## 2. Bowl of Convergence — a static conditioned on the bearer

> Unique. The bearer with Auspex [aus] gets +1 intercept. The bearer with
> superior Auspex [AUS] can burn 1 blood during an action to get an
> additional +1 intercept.

**The first half is a static whose condition is the bearer, not the
action.** `ConditionalStatic` already carries three conditions
(`actionKinds`, `actionCardTypes`, `directedAtController`) and they are
all about the action. `bearerDiscipline` is the fourth, and it is read
through **`disciplinesOf`**, not the printed field — a granted Auspex
(the Discipline masters) really does switch the card on, and losing the
master really does switch it off. That is the derived-traits rule paying
out again: the answer cannot be computed at attach time.

The second half is an **equipment ability**, not a static. It is offered
only during a block attempt by the bearer, only while the bearer's
intercept is **below** the acting minion's stealth (p. 26, "only when
needed"), and it costs 1 blood.

**Reading on record: it is repeatable.** The card prints no limit, and
the only-when-needed gate makes repetition harmless — the option vanishes
the moment intercept catches up, so it can only ever be used to close a
gap, never to build a lead. A printed limit would have been the reason to
add one.

---

## 3. Flaming Candle — game-wide uniqueness on an *equip*

> Only one Flaming Candle can be played or equipped in a game.
> This vampire can burn 1 blood and the Flaming Candle as they announce
> an action to make that action unblockable by vampires.

Uniqueness is the Week of Nightmares / Open War / Giant's Blood shape and
needs **no new state**: the event log is the record of everything ever
played, so the `options` overlay reads it. Correctly stricter than "in
play" — this card burns itself, and a second copy stays unplayable
afterwards, which is exactly what "in a game" says.

"Unblockable by vampires" needed nothing new either:
`ActionFrame.blockRestrictions.noVampires` and `ops.restrictBlocking`
have been there since Seduction. The window is `action.announce` — the
literal "as they announce an action" — and the ability is gated on the
bearer being the acting minion.

---

## 4. Living Manse — a location that is not equipment

Besides §1's tag, three ordinary pieces: `statics.bleed: 1`,
`exclusiveKey` ("a vampire can have only one Living Manse"), and an
ability in `combat.beforeRange` that burns the card to end the combat.

`requiresClan: ["Tzimisce"]` follows the **Shilmulo Tarot** precedent: a
clan tag on a Master is thematic (Ravnos Carnival, Black Market Cache)
because a Master has no acting minion to gate, but an Equipment card is
played by a vampire and the tag is a requirement.

---

## 5. Monkey Wrench — a variable bonus

> Requires an Anarch. Only usable during a bleed action.
> +X bleed (limited). X must be 1, 2 or 3.

`modifyBleed` gains `xRange`, and the option enumerator emits one option
per X with `x=N` in the option id — the `bankStealth` / `paymentSplits`
shape, so the choice is made at play time and rides in the option id
rather than needing a ChoiceFrame. **`limited: true`**, as printed, so
p. 20's one-limited-bonus rule bites: a second Monkey Wrench on the same
bleed is not offered, whatever X.

---

## 6. Spying Mission — the moment a bleed is known to be going through

> [OBF] Only usable if a bleed would be successful. Instead, the bleed
> burns no pool, is unsuccessful, and this card is put on this vampire.
> The next time this vampire is about to successfully bleed the same
> Methuselah, burn this card and this vampire gets +2 bleed.

**"If a bleed would be successful" is state C.** p. 27 A.4: once every
Methuselah has passed on blocking, the action moves to state C, which is
the impulse *before* resolution — the one moment where the bleed is known
to be going through and no block can still be declared. Nothing new was
needed to *play* the card there; both halves live in that step.

The first half is `afterResolutionAttach` (built for Shadow Cast) with
`recordTarget`, which writes `PermanentInPlay.againstSeat` — "the same
Methuselah", fixed now — followed by `failAction()`. Order matters: the
attach reads `af.target`, so it runs before the action is failed. A
failed bleed transfers no pool, which is the card's "burns no pool"
with no special case.

The second half is **mandatory** ("burn this card and this vampire gets
+2 bleed" — no "you can"; the Rebel precedent), so it fires from a hook
rather than being offered. **`onBlocksDeclined`** is new: one call site,
the A→C transition in `settle`, which is the single chokepoint every
action passes through — the `minionActionsThisPhase` pattern, so a
future second transition cannot forget it. The card burns itself when it
fires, so it cannot fire twice even if the target changes and the action
returns to state A.

**Reading on record: the +2 is NOT "(limited)".** p. 20's rule is about
action modifier *cards* granting a bleed bonus; by the time this fires
the card is a card **in play** and the bonus is its ability — the Club
Illusion precedent. It matters: the point of the card is that the bonus
lands *after* the defender has already declined to block, and a defender
who spent the action's one limited bonus should not also be shielded
from it.

---

## 7. Go-getter — PARTIAL, and the deferral is now costed

> Not usable during a bleed action. [obf] +1 stealth.
> [OBF] Only usable after resolution of a blocked action. This vampire
> burns 1 blood to continue the action as if unblocked.

The basic mode ships whole. **The superior does not**, and there is a
ledger row for it.

p. 27 settles what the window is and rules against the cheap reading.
Step 3 is *Resolve the Action*, and a blocked action goes through it:
"If the action is blocked, then any card played to perform the action is
burned and the block is resolved with these two simultaneous
consequences". So the block's combat happens **inside** action
resolution, and "after resolution of a blocked action" is genuinely the
`action.afterResolution` window — after `CardBurned`, after
`ActionResolved`, after the block penalties. It is not Form of Mist's
moment (`step === "blocked"`, before resolution), and implementing it
there would be a different card.

Continuing from that window means **re-entering resolution**, and the
cost is now written down rather than left as one line. `resolveActionInner`
would need a "tail already run" guard on four things that must not happen
twice — `notBlockPenalties` (double charge), `blockPenalties` (double
apply), the action card's `CardBurned` (a second ash-heap entry), and
`drawAfter` (a double draw) — and a decision about two more that are
semantic rather than arithmetic: a second `ActionResolved` for one
`actionId`, and `notifyActionResolved` firing the archetype hooks twice.

Two alternatives were considered and rejected:

- **Open the window before the resolution tail.** It cannot move for
  successful actions: p. 52 rules Voter Captivation by name — "you cannot
  play it to regain pool and survive if the referendum leaves you at 0
  pool" — which is only true because the effects have already happened.
  Moving it only for blocked actions is a special case in the kernel.
- **Read it as Form of Mist's moment.** Ruled out by p. 27 above.

So it is re-entrant action resolution, on the hottest path in the engine,
for one mode of one card — which is exactly the kind of change the
project's own rule sends to the owner before it is built.

---

## 8. What this wave did not need

`blockRestrictions.noVampires`, `ops.restrictBlocking`,
`afterResolutionAttach`, `PermanentInPlay.againstSeat`, `failAction`,
`exclusiveKey`, game-wide uniqueness off the event log, and the
`bankStealth` variable-option shape were all built by earlier waves and
used here unchanged. The only genuinely new pieces are
`ConditionalStatic.bearerDiscipline`, `modifyBleed.xRange`,
`permanent.equipmentAbilities`, the `notEquipment` tag, and the
`onBlocksDeclined` hook.
