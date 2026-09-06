# The block tax — who may attempt to block, and what it costs

Status: **design + implementation** (2026-08-29). Third wave of the
action-modifier sweep, after `docs/modifier-or-combat-design.md` and
`docs/fail-block-design.md`.

## 1. The cluster

The two previous waves worked on a block attempt already underway. This
one works one step earlier: on whether the attempt may be made at all.
Five cards:

| id | card | inferior | superior |
|---|---|---|---|
| 102285 | Where the Veil Thins | +1 stealth | as above, + non-Oblivion minions burn 1 blood to attempt |
| 102338 | Seeds of Terror | minions burn 1 blood to attempt | as above, + a named vampire cannot block |
| 102346 | Unthinkable Humiliation | minions burn 1 blood or life to attempt | as above, + minions get −1 intercept |
| 101805 | The Sleeping Mind | a named locked vampire cannot block | as above, + minions cannot unlock this action |
| 100492 | Daring the Dawn | vampires cannot block; actor takes 2 agg. | as above, but 1 damage |

## 2. What was already there

`ActionFrame.blockRestrictions` (`noAllies` / `noVampires` / `noTitled` /
`cannotBlock[]`) was built for Seduction and Visions of Gehenna, and the
`blockRestriction` effect primitive already reached it. Daring the Dawn's
"vampires cannot block" and Seeds of Terror's / The Sleeping Mind's
"choose a vampire" needed nothing new there — only a `chosenScope:
"locked"` for The Sleeping Mind, which names a **locked** vampire.

## 3. The toll (new)

`ActionFrame.blockCosts` is a **list**, not a single number, because each
entry carries its own exemption and its own currency:

```ts
{ amount: number; payWith: "blood" | "bloodOrLife"; exemptDiscipline?: string; source: string }
```

`blockTollFor(af, minion)` in `derived.ts` sums the entries the minion is
not exempt from and returns:

- a number — what this minion must burn to attempt;
- **`null`** — it cannot pay, so it cannot attempt at all.

Two cards played on one action stack: an Oblivion vampire facing Where the
Veil Thins *and* Seeds of Terror owes 1, a plain vampire owes 2.

**Allies and the word "blood."** Where the Veil Thins spells out
"(allies cannot burn blood)". That is the general rule, not a special
case: allies hold life counters, not blood (p. 22), so a cost printed as
"1 blood" is one they can never pay — and a minion who cannot pay cannot
attempt. Seeds of Terror ("1 blood") therefore locks allies out entirely,
while Unthinkable Humiliation ("1 blood **or life**") lets them pay.
`payWith` is exactly that distinction, and the engine reads it before it
reads the counters.

Three interception points, all of which had to agree:

1. **Enumeration** — `blockOptions` drops a minion whose toll is `null`
   and labels the rest "attempt to block (burn N)".
2. **`declareBlock`** — the toll is burned when the attempt is declared,
   not when it succeeds. A failed block still paid.
3. **`startAutoBlock`** — a forced block ("this vampire unlocks and
   attempts to block", the whole unlock-and-block cluster) is still an
   *attempt*, so it pays the same toll, and simply does not happen if the
   vampire cannot.

## 4. Action-wide intercept (new)

`modifyBlockerIntercept` (previous wave) pushes down the minion currently
attempting. Unthinkable Humiliation's superior says "**minions** get −1
intercept" — every minion, including one that starts attempting later.
Rather than emit one `InterceptModified` per minion at play time (which
would miss anyone who joins the action afterwards), there is one new
event:

```ts
{ type: "ActionInterceptModified"; actionId; delta; source }
```

and `currentIntercept` adds it for every minion of that action. Still
pure derivation from the event log — no new stored state.

## 5. "Minions cannot unlock" (new)

`ActionFrame.noUnlock`, set by The Sleeping Mind superior. It gates the
`unlockMinion` and `unlockAndAttemptBlock` primitives in `effectsLegal`,
which between them are the whole unlock-and-block cluster (14 cards) plus
Guard Dogs / Rat's Warning. Read as a legality gate rather than an
emission gate so the player is never offered a card that would do
nothing.

Scope noted: it stops unlocks *offered during the action*. Post-resolution
unlocks that were registered earlier (Revelation of the Serpent's
corruption unlock) are left alone; the card's own clause reads "during
this action", and the argument either way is thin enough to be worth
recording rather than deciding silently.

## 6. Damage outside combat (new)

Daring the Dawn is the first card that damages a minion with **no combat
frame in sight**. Damage resolution — mend, torpor, aggravated burning a
wounded vampire (p. 31, p. 34) — was written inline inside combat's
`damageResolution` pass handler. It is now a method:

```ts
private applyResolvedDamage(pd: PendingDamage): void
```

called from that same step and from action resolution. It reads its
victim with `findMinion` and returns if the minion is gone, per the
standing leave-play rule.

`ActionFrame.afterResolutionDamage` queues the hit; it lands immediately
after the `ActionResolved` event. "Unpreventable" needs no modelling —
prevention lives in combat's damage-resolution window, and there is no
such window here. "Environmental" means `source: null`, which is what the
retainer-damage path already uses.

This gate is reusable: Rutor's Hand and Aemilius want the same
out-of-combat damage, and a general `ops.inflictDamage` is now one line
away when a card needs it outside an action.

## 7. Count

Library cards supported: **213 → 218 of 444 (49.1%)**. Crypt 0/217
(phase 7). Total 218/661 (33.0%). Action modifiers remaining: 27.

## 8. Left in this seam

- **Beast Meld**, **Invigorate**, **Obedient Flesh** — modifiers that hang
  a rider on the acting minion for the resulting combat (prevent 1, +1
  strength, aggravated hand strikes). `blockerCombatRiders` is the
  blocker-side mirror; an actor-side one is the next small gate.
- **Dawn Operation** — "all damage in the resulting combat is aggravated",
  plus the blocker being offered a cancel of its own attempt.
- **Change of Target**, **Go-getter**, **Freak Drive** — the action's own
  shape changes after a block (end it, continue it unblocked, unlock
  afterwards).
- **Cloak the Gathering**, **Veil the Legions**, **Gifts From Hereafter**
  — modifiers played by a ready vampire *other than* the acting minion,
  which the modifier compiler currently cannot express (it hands the
  acting minion the only candidate slot).
- **Spying Mission**, **Shadow Cast**, **Shadow Cloak**, **Fever Pitch** —
  modifiers that attach and pay out on a later action.
- Polling-step modifiers (Perfect Paragon, Scorn of Adonis, Absolute
  Tyranny, Voter Captivation, Amici Noctis, Magnetic Authority) belong
  with the politics deferrals, not here.
