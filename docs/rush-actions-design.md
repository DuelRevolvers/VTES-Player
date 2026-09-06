# Rush Actions ("Enter combat as a Ⓓ action") — Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: 6-card core wave;
own-minion rushes stay legal; tranche 2 deferred to a later sweep).
Implementation notes beyond the draft: equipment/retainer/ally entry
was moved before `resolveCardAction` so "after this ally enters play"
riders see the ally in play (War Ghoul); War Ghoul's enter-play burn
victim is chosen at announcement and includes "self" — whether the
Ghoul may eat itself when alternatives exist is an unverified ruling,
flagged in CLAUDE.md known deviations; two latent allies-gate bugs were
fixed en route (Life in the City / Minion Tap / Feast superior
enumerated allies for vampire-only effects).

The follow-up mini-design deferred from the allies/retainers gate
(docs/allies-retainers-design.md §9). The kernel gains **actions that
target a minion**; a pool survey shows this is not just the ally tail —
15+ cards in the V5 pool grant or are "enter combat" actions, and the
same targeting shape is what diablerie and rescue-from-torpor will ride
later.

---

## 1. Rulebook facts (citations verified against the V5 PDF)

- **Directed** = the action "targets one or more other Methuselahs or
  things controlled by other Methuselahs"; only the targeted
  Methuselah(s) may block (p. 25). An action to enter combat with one of
  your minions is explicitly "a directed action against you" (Warrens
  ruling, p. 52).
- All details of the action — target, cost, effects — are fixed at
  announcement (p. 25).
- On success, cost is paid and effects take place; on block, the normal
  blocked-combat consequences occur with the **blocker**, and the
  action's effects never happen (p. 27). So a blocked rush fights the
  blocker, not the intended target.
- "A minion cannot perform each action via the same copy of a card in
  play (including from the minion's own card text) more than once each
  turn, even if they unlock" (p. 20) — the limit for in-play-granted
  actions.
- A combat with a non-ready combatant ends immediately (p. 30) — which
  settles two design questions below.

## 2. Kernel: minion-targeted actions

### 2.1 `ActionFrame.targetMinion`

```ts
export interface ActionFrame {
  // ... existing fields
  /** Non-null for actions directed at a minion (rush; later diablerie,
   *  rescue). `target` (the SeatId) stays authoritative for blocking. */
  targetMinion: MinionId | null;
}
```

Directedness is **derived at announcement**: if the target minion's
controller is another Methuselah, the action is directed at that seat
(`target` = controller, `directed` = true, only they may block); if the
rusher targets its controller's own minion, the action is undirected
(prey + predator may block, p. 25). The existing block machinery needs
zero changes.

### 2.2 Target eligibility

Ready minions only (not in torpor), and never the acting minion itself.
Rationale: a combat with a non-ready combatant ends before it starts
(p. 30) — rushing torpor is a dead rule; the real torpor interaction is
diablerie (its own gate). Targeting your own minion is legal (the
generator states rules, not tactics). Card text narrows further:
"a vampire" / "a minion" / "a locked minion" (Fleetness superior).

### 2.3 Resolution

On success: pay costs, then — **if the target is still ready** — the
engine emits `CombatBegan` and pushes the combat frame with acting =
rusher, opposing = target. The target does **not** lock (only blockers
lock, p. 27). If the target left play or readiness during the action,
the action still succeeds but no combat occurs (effects that cannot
happen simply don't).

### 2.4 "During that combat" riders

Umbrous Clutch superior grants a maneuver, Hunter's Mark a press,
Make the Misere [pot] +1 strength — all scoped to the rush's combat.
The announcement records rider credits on the ActionFrame; combat-frame
creation folds them in (maneuver/press credits use the existing
`presses`/`pressesCombat`-style fields; the maneuver rider adds an
analogous one-shot credit usable in the range step).

### 2.5 Actions granted by cards in play

War Ghoul's own text and Twisted Bloodhound's employer grant are
**actions from a card in play**, not hand cards. New handler surface
(mirroring `abilityOptions`/`useAbility`):

```ts
actionOptions?(entry, owner, ctx): LegalOption[];   // turn.minion only
useActionOption?(entry, owner, choice, ops): void;  // announces via ops
```

plus a new `EngineOps.announceEntryAction(...)` that owns the mechanics
exactly like `announceCardAction` does: lock the minion, build the
frame, record the per-copy use. Tracking for the p. 20 limit:
`PermanentInPlay.usedActionThisTurn: boolean`, reset for all seats at
`TurnBegan`.

Side effect worth noting: the minion phase decision currently
enumerates hand-card options but not in-play `abilityOptions` — adding
the entry-action enumeration also surfaces The Barrens' ability in the
minion phase (correct per its "any time" ruling, p. 47).

### 2.6 New spec vocabulary

```ts
// Action-card primitive: what the announced action IS.
| { kind: "actionEnterCombat";
    targets: "minion" | "vampire";
    lockedOnly?: boolean;          // Fleetness superior
    riders?: { maneuver?: number; press?: number; strength?: number } }
```

Ally/retainer specs gain a matching `rush` block compiled onto the
entry's `actionOptions` (targets, cost in life, riders). Ally stats
become per-mode overridable (Freakish Conglomeration: [obl] 3 life /
[OBL] 4 life).

## 3. The wave (proposed)

Chosen so every new mechanism has a simplest-possible card, and every
card fits the vocabulary or a thin bespoke overlay:

| Card | What it proves |
| --- | --- |
| **Umbrous Clutch** (action, obl) | hand-card rush; superior adds the maneuver rider |
| **Fleetness** (action, cel) | modal bleed/rush card; locked-only targets; +1 stealth action |
| **Twisted Bloodhound** (retainer) | employer-granted rush (entry `actionOptions`), per-copy per-turn limit |
| **Aggressive Corpse** (ally) | ally self-granted rush; `cannotGainLife` static (gains go to the bank); other clauses moot (no dodge, no dom/pre minion-targeting yet) |
| **Freakish Conglomeration** (ally) | per-mode ally life; mandatory unlock-phase life burn (existing `onControllerUnlock`); rush |
| **War Ghoul** (ally) | rush (vampires only); each-round prevention ability (combat-frame `usedThisRound` list); lock+burn-self to burn a location; enter-play "burn an ally or retainer you control" chosen at announcement (p. 25) |

**Optional tranche 2** (one shared mechanism — an "at the end of that
combat, if a combatant is not ready" rider hook): Abuse of Power,
Pillars Fall, Hunting the Beast. Include if the core lands smoothly,
else next sweep.

## 4. Deferred (explicitly out of this gate)

- **Deep Song** — superior swaps who counts as the acting minion.
- **Anarch/sect-gated rushes** (Make the Misere, Line Brawl, Open War)
  — sects/titles are not modeled yet.
- **Hunter's Mark** — requires TWO disciplines at once ([cel][tha]);
  the mode vocabulary only knows "any one of". Small extension, its own
  sweep.
- **Rotting Behemoth** — needs an ash-heap region (burned cards are
  currently events only).
- **The Vozhds, City Star Taxi** — need card-text strikes and
  strike-card cancellation.
- **Masters that grant rush** (Frontal Assault, Haven Uncovered,
  Priority Contract, Regent, Archon, Saulot's Avenging Fist, Yawp
  Court) — attach-to-enemy-minion masters and titles, later families.
- **Obedience** — reactions that end actions; its own design.

## 5. Tests

Kernel (tests/engine/): directed-at-minion rush blockable only by the
target's controller; own-minion rush is undirected (prey and predator
may block); blocked rush fights the blocker and the intended target is
untouched; target burned mid-action → success but no combat; per-copy
per-turn limit holds across unlock (Twisted Bloodhound); rush combat
does not lock the target. Cards (tests/cards/): one scenario per card,
riders asserted (maneuver credit usable, War Ghoul's round prevention
capped at 1/round), negative space (Fleetness superior offers only
locked targets; Aggressive Corpse life gain goes to the bank). Fuzz:
all wave cards added; existing invariants unchanged (rush uses the
same action/combat frames).

## 6. Open questions for the owner

1. **Wave size** — the 6-card core, or core + the 3 end-of-combat-rider
   cards (tranche 2) in the same gate?
2. Any objection to **own-minion rushes being legal** (§2.2)? It is the
   rulebook-correct reading; the UI/AI can de-prioritize it later.
