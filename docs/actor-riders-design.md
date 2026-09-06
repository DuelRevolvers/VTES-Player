# Actor-side combat riders

Status: **design + implementation** (2026-08-29). Fourth wave of the
action-modifier sweep, after `modifier-or-combat`, `fail-block` and
`block-tax`.

## 1. The cluster

`ActionFrame.blockerCombatRiders` has existed since the intercept-reaction
cluster: "if this vampire **blocks**, they get N maneuvers/presses in the
resulting combat" (Spirit's Touch, Rat's Warning, One With the Land). The
mirror was missing — "if this vampire is **blocked**, the *acting* minion
gets X in the resulting combat":

| id | card | what the actor gets |
|---|---|---|
| 100146 | Beast Meld | inf: +1 stealth, and can prevent 1 damage if blocked |
| 102251 | Invigorate | [ani] +1 strength · [dom] no ally may block · [pro] hand strikes aggravated |
| 102255 | Obedient Flesh | modifier: +1 stealth, allies −1 intercept · combat: strength/maneuver/prevent credits |

## 2. `ActionFrame.actorCombatRider`

One accumulating record on the action frame —
`{ prevent, strength, maneuver, press, handStrikesAggravated }` — applied
to the `acting` side when a successful block pushes combat, three lines
below where `blockerCombatRiders` is applied to the `opposing` side. Both
now sit together, which is the right shape: they are the same mechanic
seen from the two ends of a block.

Cumulative, because two modifiers on one action should both land.

## 3. Prevention as a CREDIT (new)

"They can prevent 1 damage during the resulting combat" is not the same
shape as a prevention card. `ops.preventDamage` applies *now*, inside the
damage-resolution window, against the pending damage in front of it. Beast
Meld hands the vampire a **credit** to spend later, possibly several rounds
later.

So `CombatFrame.preventCredits: { acting, opposing }`, spent through a new
built-in option `prevent:credit` offered in `combat.damageResolution` to
whichever side is taking the damage, one point at a time and repeatable
while credit remains. It behaves like `maneuverCredits`, which had already
established the pattern for rush riders.

## 4. Round-scoped strength (new)

Obedient Flesh superior says "**this round**, this vampire gets +1
strength". `strengthBonus` deliberately lasts the whole combat (Form of the
Wolf), and `strengthOverride` likewise. Rather than fudge it, there is now
`CombatFrame.strengthBonusRound`, reset in the new-round block beside
`handStrikesAggravated`, which was already round-scoped. `strengthOf` adds
all three.

## 5. `combatCredits`: one mode, one window

Obedient Flesh superior grants three things at once — "+1 strength and 1
optional maneuver, and can prevent 1 damage" — whose primitives map to
three *different* combat windows (`beforeRange`, `range`,
`damageResolution`). `combatWindowFor` picks the first match, so writing
them as three effects would have put the card in one window and made the
other two resolve in the wrong context (`prevent` would have thrown —
there is no pending damage before range).

The fix is conceptual, not mechanical: the card grants **credits**, it does
not perform the actions. `{ kind: "combatCredits", strength, maneuver,
press, prevent }` lives in `beforeRange` — where such cards are played —
and hands out credits to spend when their windows come round. Worth
remembering as a rule: *if a mode seems to span windows, it is granting
credits, not acting.*

## 6. Bug found on the way: "Requires a …" was unenforced

Writing Invigorate's "Requires an Anarch" test showed the clause did
nothing. `meetsRequirements` was called in the action, master, ally and
**polling-step** branches of the compiler, but **not** in the main
action-modifier / reaction option loop. Ten cards were affected, all
silently playable by minions that did not qualify:

> Invigorate, Protection Racket, The Warrens, Sense the Savage Way,
> Second Tradition: Domain, Eyes of the Wild, Ominous Chorus,
> Party Out Of Bounds, Protected District, and the two
> `requiresControlledTitle` cards (already correct via the polling branch).

One line fixed it, and **no existing test broke** — nothing had been
relying on the gap, it was simply never asserted. The fuzz could not catch
it either: it plays whatever it is offered, so a too-permissive option list
looks exactly like a correct one.

## 7. Count

Library cards supported: **218 → 221 of 444 (49.8%)**. Crypt 0/217
(phase 7). Total 221/661 (33.4%). Action modifiers remaining: 24.

## 8. Still open in this seam

- **Dawn Operation** — "all damage inflicted on vampires during the
  resulting combat is aggravated" is combat-wide rather than one side, and
  its inferior mode additionally offers the *blocker* a chance to cancel
  their own block attempt, which is a new choice-frame shape.
- **Cloak the Gathering / Veil the Legions / Gifts From Hereafter /
  Hedonism** — modifiers played by a ready vampire *other than* the acting
  minion. The compiler hands the acting minion the only candidate slot, so
  this is the next structural gate in the seam.
