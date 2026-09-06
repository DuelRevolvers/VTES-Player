# Diablerie, Rescue, and the Blood Hunt — Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: build both
diablerise and rescue; model the 0/1/2 rescue cost split; defer
equipment-take, older-victim Discipline, and Red List with TODOs).
Implementation notes beyond the draft: the rescue split is fixed at
announcement as an option param (`rescue:<actor>:<victim>:<actorPortion>`)
rather than a mid-resolution decision — the cost is a detail defined at
announcement (p. 25), and only affordable splits are enumerated; the
leave-torpor diablerie opportunity uses a small `DiablerieOfferFrame`
(decline just fails the action, accept commits then conducts the blood
hunt on top of the still-pending failed action frame); the blood-hunt
referendum reuses `ReferendumFrame` with a `variant: "bloodHunt"`
discriminant (no terms, no calling-card vote, burns the diablerist on a
pass).

The gate the politics work unblocked. Unlike recent gates this is almost
entirely **kernel**: diablerise and rescue-from-torpor are *built-in
actions* (like bleed and hunt), not cards, and the V5 library has **no
dedicated diablerie/rescue action cards** — only master-card modifiers
(Depravity, Carver's, Chantry, Saulot's Healing Touch) that are a
follow-up sweep. So the supported-card count barely moves; the payoff is
the torpor/diablerie mechanic itself, the blood-hunt referendum (reusing
the politics machine), and closing the leave-torpor blocker-diablerise
TODO that has stood since the allies gate.

---

## 1. Rulebook facts (citations verified against the V5 PDF)

**Torpor** (p. 34): a vampire who cannot mend their wounds goes to
torpor, placed beside the uncontrolled region; attached cards stay with
them. A torpor vampire is controlled but **not ready**: it may perform
**only** the leave-torpor action, cannot block or play reaction cards
(may play action modifiers during its own actions), and **cannot cast
votes/ballots** (must abstain). It still unlocks at the unlock phase.

**Diablerise a vampire in torpor** (built-in action, p. 24):
- Any ready vampire; **cost none**; target a vampire in torpor.
- **Undirected + 1 stealth** if diablerist and victim share a controller;
  **directed + 0 stealth** if different controllers (only the victim's
  controller may block).
- On success → the victim is diablerised (resolution below). On block →
  the acting vampire and blocker enter combat as normal.

**Rescue a vampire from torpor** (built-in action, p. 23):
- Any ready vampire; target a vampire in torpor.
- **Cost 2 blood**, payable by the acting vampire, the rescued vampire,
  or **split** between them (the one exception to "costs paid with the
  vampire's own resources").
- Directedness/stealth same rule as diablerise (same controller →
  undirected +1; different → directed 0). On success the torpor vampire
  moves to the ready region, **does not lock or unlock as a result**, and
  is **no longer wounded**. On block → combat as normal.

**Diablerie resolution** (p. 34–35), an **indivisible unit** — no effect
may interrupt; effects play before or after only:
1. All blood on the victim moves to the diablerist (excess drains off).
2. The diablerist may take any equipment on the victim.
3. The victim is burned; cards and counters on them are burned.
4. *(advanced)* If the victim was older (higher capacity), the diablerist
   may gain a master Discipline card from library/ash heap/hand.
5. *(advanced)* If the victim was Red List, trophies.

**Leave-torpor blocked** (p. 24): if a vampire's leave-torpor action is
blocked **by a vampire**, that blocker gets the opportunity to diablerise
the acting (torpor) vampire. If they decline, or the blocker is an ally,
the action simply fails (no cost paid). *(No combat — torpor vampires
cannot enter combat.)*

**The blood hunt** (p. 35): when a vampire commits diablerie, a
referendum is **automatically and immediately** conducted. If it passes,
a blood hunt is called and **the diablerist is burned**. This referendum
**is not an action** → it cannot be blocked, and **action modifiers and
reaction cards cannot be played** during it. Otherwise it is handled like
any other referendum (votes cast and tallied, ties fail).

## 2. Kernel: actions

Two new built-in `ActionKind`s: `"diablerize"` and `"rescue"`, alongside
the existing bleed/hunt/leaveTorpor/cardEffect. Both carry a
`targetMinion` (the torpor vampire) on the `ActionFrame` — the field the
rush gate already added — with directedness derived from the target's
controller (same field derivation as rush, §2.1 there).

**Enumeration** (minion phase, `minionPhaseOptions`): for each ready
unlocked vampire the seat controls, offer `diablerize:<actor>:<victim>`
and `rescue:<actor>:<victim>` for every vampire in torpor
(`kind === "vampire" && inTorpor`, any seat, victim ≠ actor). New
option ids; both are `takeAction`-family with a target.

**Stealth**: emitted at announcement — +1 if same controller, 0 if
different (unlike hunt's flat +1).

**Resolution** (`resolveAction`, success):
- `diablerize` → run `commitDiablerie(diablerist, victim)` then push the
  **blood-hunt referendum** frame.
- `rescue` → pay the 2-blood cost (see §4), then emit `LeftTorpor` (the
  vampire is un-wounded and ready; it does **not** change lock state).

**Blocked** `diablerize`/`rescue` → combat acting-vs-blocker, exactly the
existing directed-action-blocked path (no special code — `target` and
`directed` are set, `targetMinion` is ignored once combat begins because
combat uses the blocker).

## 3. Diablerie resolution + blood hunt

```ts
// EngineOps
commitDiablerie(diablerist: MinionId, victim: MinionId): void;
```

An atomic sequence (p. 34 "single unit"):
1. `BloodGained` diablerist by the victim's blood (vampire cap applies,
   excess drains — existing BloodGained semantics).
2. **Equipment-take: DEFERRED** (§6) — auto-skipped, marked TODO. Needs
   an equipment-move primitive that does not exist yet.
3. `burnMinion(victim)` — reuses the allies-gate cascade (attached cards
   burned; if the victim were somehow in combat it would end, though a
   torpor vampire never is).
4/5. **DEFERRED** (older-victim Discipline gain needs the ash heap +
   master-Discipline cards; Red List trophies need Red List) — TODO.

Then the **blood-hunt referendum**. It reuses `ReferendumFrame` with a
discriminant so the polling machine is shared but the political-only
pieces are switched off:

```ts
interface ReferendumFrame {
  // ... existing
  variant: "political" | "bloodHunt";   // NEW
  bloodHuntTarget: MinionId | null;     // the diablerist, on a pass
}
```

Differences for `bloodHunt`:
- **No terms step** — straight to polling.
- **No calling-card vote source** (`"caller"` is political-only). Vote
  sources are titled ready vampires, the Edge, and burned political
  action cards from hand — exactly `pollingOptions` minus the caller.
  *(Reactions/modifiers are already absent from the polling window, so
  "cards cannot be played" needs no new guard.)*
- Polling order starts with the **diablerist's controller** (the acting
  seat), then clockwise — the natural sequencing order.
- On **pass** → `burnMinion(diablerist)`. On fail → nothing.

New events: `DiablerieCommitted { diablerist, victim }`,
`BloodHuntCalled { diablerist }` (emitted when the referendum passes,
just before the burn). `LeftTorpor` already exists (rescue reuses it).

## 4. Rescue cost split — decision to confirm (§7 Q2)

The 2-blood cost may be paid by the acting vampire, the rescued vampire,
or split. Proposed: at resolution, enumerate the legal splits as a
decision — `rescuepay:<actorPortion>` for actorPortion ∈ {0,1,2} where
both payers can afford their share (the rescued vampire is in torpor but
still has blood). Simplest fallback if you'd rather not model the split
now: acting vampire pays all 4… all 2, with a TODO. **Recommend
modelling the split** — it is one small enumeration and rescue is
otherwise trivial.

## 5. Leave-torpor blocked → diablerise (closes the standing TODO)

Today `resolveBlockAttempt` has: *"a blocked leave-torpor causes no
combat … TODO(diablerie): a blocking vampire gets the opportunity to
diablerise."* Now: when a leave-torpor action is blocked and the blocker
is a **vampire**, push a small **diablerie-opportunity decision** for the
blocker's controller — diablerise the acting torpor vampire, or decline.
On diablerise → `commitDiablerie(blocker, actingVampire)` + blood-hunt
referendum, and the leave-torpor action fails (no cost). On decline / ally
blocker → the action simply fails (existing behavior). This is a tiny new
frame or a reuse of the action's "blocked" settle with a one-option
decision; detail settled in code review.

## 6. Deferred (explicitly out of this gate)

- **Equipment-take on diablerie** (step 2) — needs an equipment-move
  primitive (moving a `PermanentInPlay` between bearers), which no gate
  has built. Auto-skipped, TODO.
- **Older-victim Discipline gain** (step 4) — needs the ash-heap region
  and master-Discipline cards. TODO.
- **Red List / trophies** (step 5) — Red List unmodeled. TODO.
- **Master-card diablerie/rescue modifiers** (Depravity, Carver's Meat
  Packing, Chantry, Saulot's Healing Touch) — a follow-up sweep once the
  mechanic exists.
- The diablerist voting-in-its-own-blood-hunt is allowed (titled
  vampires vote normally, p. 28); no special case.

## 7. Open questions for the owner

1. **Scope** — build both diablerise and rescue as built-in actions in
   this gate (recommended; they are twins), or diablerie only?
2. **Rescue cost split** — model the 0/1/2 split decision (recommended),
   or simplify to "acting pays" with a TODO?
3. **Equipment-take deferral** — OK to auto-skip step 2 with a TODO
   (recommended, given no equipment-move primitive exists), or should
   equipment-move be built as part of this gate?

## 8. Tests (once approved)

Kernel: diablerise directed vs undirected by controller; blocked
diablerise → combat with the blocker (victim untouched); successful
diablerie moves all blood, burns the victim and its attached cards;
blood-hunt referendum with no terms and no caller vote; blood hunt passes
→ diablerist burned; ties fail → diablerist survives; a torpor vampire
cannot vote in the blood hunt; rescue moves the vampire to ready
un-wounded without changing lock state; rescue cost split; leave-torpor
blocked by a vampire → diablerise opportunity → blood hunt; blocked by an
ally → action just fails. Fuzz: give some fuzz vampires a path to torpor
(combat already does) and enable the diablerise/rescue actions; existing
invariants hold (all pool/blood via events; MinionBurned already swept).
