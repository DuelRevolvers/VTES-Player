# Granted Actions ("X can do Y as a [+N stealth] [Ⓓ] action") — Design

Status: **IN PROGRESS — §6 decided by the owner 2026-08-02.**

Owner decisions on record:

1. **§6.1 — reverse the Powerbase precedent: BUILD IT.** Directed actions
   targeting a card in play are now a real mechanism.
2. **§6.2 — control change: BOTH tiers now**, cards in play *and* minions
   (so Cave of Apples is in scope, not deferred to a later gate).
3. **§6.4 — next: cards 2–4 of the wave** (the burn-clause family), before
   control change.

Built and green so far: §4.1–4.5 in full (generalized announce with
target/stealth/cost, `ActionFrame.targetPermanent` + `grantedEffect` +
`grantedCost`, `resolveGrantedAction`, cross-seat enumeration, the p. 20
per-minion fix, and the `permanent.vulnerableTo` compiler), plus **Pit of
Contemplation** (102291), **Creeping Sabotage** (102213) and **Army of
Rats** (100093).

**Not built yet:** control change (decision 2) and the rest of the burn
family — see §5 for what each remaining card still needs.

The one-off sweep listed "granted Ⓓ actions" as the next build, naming
three cards (Pit of Contemplation, Open War, Cave of Apples). A pool
survey says the family is far larger, and that the sub-mechanic worth
building first is not the one the sweep doc guessed.

---

## 1. What the survey found

48 unsupported cards in the V5 pool contain a clause of the shape
*"\<who\> can \<do Y\> as a \[+N stealth\] \[Ⓓ\] action"*. They bucket
into four sub-families:

| Sub-family | Count | Example |
| --- | --- | --- |
| **Burn/destroy a card in play** ("Minions can burn this card as a Ⓓ action") | 25 | Brujah Debate, Gangrel Revel, The Khabar: Community, Pentex™ Subversion, Creeping Sabotage, Phantasmagoria, Toreador Grand Ball, Mob Connections, Army of Rats, Open War's "burn a location", Pit of Contemplation's last line |
| **Granted rush** (enter combat) | 10 | Frontal Assault, Regent, Priority Contract, Haven Uncovered, Saulot's Avenging Fist, Theo Bell (G6), Barachiel (G7), Open War |
| **Self-effect action** (no target outside your own stuff) | 7 | Pit of Contemplation (add a counter), The Gate of Acheron, Saulot's Healing Touch, Sakhar (G7), Seraphina (G7), Eulogio (G6), Lenelle (G6) |
| **Steal a card in play or a minion** | 6 | Powerbase: Los Angeles, Powerbase: Montreal, The Rack, Fragment of the Book of Nod, Saankaláxt (G6), Cave of Apples |

The headline: **the "burn this card as a Ⓓ action" clause is the single
largest unimplemented family in the remaining pool (25 cards)** — and it
is exactly the clause the *Powerbase precedent* currently writes off as a
noted deviation. That precedent was a reasonable call when it covered one
card. At 25 cards it is the biggest single fidelity gap left, and it is
also the thing several *supported* cards silently lack today.

## 2. What exists already

The rush gate (docs/rush-actions-design.md §2.5) built one narrow slice:

- `CardHandler.actionOptions(entry, owner, ctx)` / `useActionOption(...)`
- `EngineOps.announceEntryAction(entry, minion, { targetMinion, riders })`
- `PermanentInPlay.usedActionThisTurn: boolean` (p. 20 per-copy limit)
- `Engine.entryActionOptionsFor(seat)` — enumerates **only the acting
  seat's own** permanents and its minions' attached cards.

Four hard limits block everything above:

1. The granted action's only possible effect is *enter combat*
   (`resolveAction` branches on `actionKind === "cardEffect" && targetMinion`).
2. Targets can only be **minions** — not cards in play.
3. Only **your own** cards can grant you actions. "Minions can burn this
   card…" is a grant from an *opponent's* card to *your* minion.
4. No stealth modifier and no cost on a granted action.

## 3. Rules basis

- **Ⓓ is a reminder symbol, not a rule.** p. 19: "when a card describes an
  action that is typically directed at another Methuselah, the card's text
  will usually include a Ⓓ symbol as a reminder… If not it is considered
  undirected." Directedness itself comes from the target (p. 25).
- **Directed → only the targeted Methuselah may block** (p. 25). For a
  granted action whose target is *a card in play*, the targeted Methuselah
  is that card's controller. This is derived from p. 19/p. 25 plus the card
  text (Golden Rule), not a verbatim rulebook sentence — flagged as such.
- **Cost paid at resolution, only on success** (p. 27) — matters for
  Open War's "burn a location as a Ⓓ action that costs 2 pool".
- **p. 20 per-copy limit:** "A minion cannot perform each action via the
  same copy of a card in play (including from the minion's own card text)
  more than once each turn, even if they unlock." Note the wording — the
  limit is *per minion*, *per action*, per copy. See §4.3.

## 4. Proposed kernel changes

### 4.1 Generalized announce

`announceEntryAction` → `announceGrantedAction(entry, minion, args)`:

```ts
args: {
  /** What the action does on success; dispatched back to the granting
   *  card's handler at resolution. Rush stays expressible as
   *  { key: "enterCombat" }. */
  effect: { key: string; params?: Record<string, string> };
  targetMinion?: MinionId | null;
  targetPermanent?: CardInstanceId | null;   // new
  stealth?: number;                          // emits StealthModified
  cost?: { pool?: number; blood?: number };  // paid at resolution (p. 27)
  riders?: { maneuver?: number; press?: number };
}
```

New `ActionFrame` fields: `targetPermanent: CardInstanceId | null` and
`grantedEffect: { cardName, cardId, key, params } | null`.

**Directedness** derives exactly as it does for rush, one rule wider: the
controller of the target *minion or permanent*; if that seat is not the
acting seat, `directed = true, target = thatSeat`. `defendersFor` and the
whole block machinery need zero changes.

### 4.2 Resolution

In `resolveAction`, on success, when `af.grantedEffect` is set: pay
`cost`, then dispatch to the granting card's handler:

```ts
resolveGrantedAction?(entry, af, ops): void;
```

The rush branch becomes one such effect (`key: "enterCombat"`), keeping
the existing "target still ready?" check. **If the target permanent left
play** during the action, the action still succeeds and the effect simply
does not happen — same rule the rush branch already applies to minions.

### 4.3 Fixing the p. 20 limit while we are here

`usedActionThisTurn: boolean` is wrong for seat-level permanents that grant
an action to *many* minions (and to other Methuselahs' minions): one use
currently spends the card for everyone. Per p. 20 the limit is per minion
per action per copy:

```ts
/** Replaces usedActionThisTurn. Reset for every entry at TurnBegan. */
grantedActionUses?: { minion: MinionId; key: string }[];
```

This is a real correctness fix for the existing rush path too, not just
new surface.

### 4.4 Cross-seat enumeration

`entryActionOptionsFor(seat)` scans **all seats'** permanents and attached
entries, passing the enumerating seat in the context; each handler decides
whether it grants to that seat ("Minions can…" = anyone; "Hecata you
control can…" = the controller only). Cost is O(seats × permanents) per
minion-phase decision — negligible.

Consequence worth stating plainly: **every opponent's "burn this card"
location becomes a visible option in your minion phase.** That is correct
play — those clauses exist precisely so opponents can act on them — but it
adds option noise, and the AI (phase 5) must learn not to spend actions on
low-value burns. The legal-move generator states rules, not tactics
(same call as own-minion rushes in the rush gate).

### 4.5 Spec vocabulary

Most of the 25-card family is one shape, so it compiles generically rather
than 25 bespoke handlers:

```ts
permanent: {
  /** "Minions can burn this card as a Ⓓ action" and variants. */
  vulnerableTo?: {
    who: "minions" | "vampires" | MinionFilter;  // reuse meetsRequirements
    stealth?: number;                            // the actor's bonus
    cost?: { pool?: number; blood?: number };
    /** Per-actor stealth riders: "Tremere get +1 stealth during that
     *  action" (The Khabar), "Nosferatu get −1" (Toreador Grand Ball). */
    stealthFor?: { filter: MinionFilter; delta: number }[];
    outcome: "burn" | "steal" | "shuffleIntoLibrary";
  };
  /** "<Your minions> can <effect> as a +N stealth action" (Pit, Gate). */
  grantsAction?: { who: MinionFilter; stealth?: number;
                   cost?: …; effect: GrantedEffectSpec }[];
}
```

`outcome: "steal"` needs control change — see the open question in §6.

## 5. Proposed wave

Ordered so each card adds exactly one new thing, cheapest first:

| # | Card | What it proves |
| --- | --- | --- |
| 1 ✅ | **Pit of Contemplation** (102291) | self-grant, no target: +1 stealth action adding a counter (§4.1 minus targeting); unlock-phase burn → move a predator/prey vampire under capacity X to its owner's uncontrolled region (reuses the politics `MovedToUncontrolled` op) |
| 2 ✅ | **Creeping Sabotage** (102213) + **Army of Rats** (100093) | the family's simplest members: cross-seat grant (§4.4) + `targetPermanent` (§4.1) + burn outcome, on top of an unlock-phase drip the kernel already had (`onControllerUnlock`). Army of Rats adds a cross-copy per-turn cap. Both compile the burn clause from `vulnerableTo` with zero bespoke code. |

**Re-scoped after reading the full card texts** (the original picks below
were chosen from one survey line each and are heavier than they looked).
What each remaining burn-family card still needs on top of `vulnerableTo`:

| Card | Extra sub-system | Status |
| --- | --- | --- |
| **Gangrel Revel** (100807) | a *seat-scoped clan static* ("Gangrel **you control** get +1 strength") | ✅ built the `aura` mechanism |
| **The Khabar: Community** (101042) | a *global* clan static ("Assamites get +1 stealth when bleeding" — any controller) + the `stealthFor` rider | ✅ same mechanism, `scope: "global"` |
| **Pentex™ Subversion** (101384) | a `cannotBlock` permanent static + `attachAnyMinion`; p. 16 settled who controls a master on another Methuselah's minion (the player who played it) | ✅ |
| **Brujah Debate** (100260) | the aura **plus** a forced lock in every Methuselah's master phase (new `onMasterPhase` hook; a ChoiceFrame when the oldest tie) and `aura.maneuverPerCombat` | ✅ |
| **Mob Connections** (101229) | a press credit granted from a card in play (`grantCombatPressTo`) | ✅ |
| **Powerbase: Munich** (102301) | a discipline-filtered blood mover; proved `cost` on a granted action end to end (1 blood, paid at resolution) | ✅ |
| **Toreador Grand Ball** (101989) | **"does not unlock as normal"** (`PermanentInPlay.preventsUnlock`) + "non-bleed actions cannot be blocked" (`unblockable`) | ✅ |
| **Aranthebes** (100079) | a *conditional* aura (`requiresUnlocked`), `maxCapacity` on auras, "−1 bleed **against you**" (`bleedAgainstController`, resolved on the target's cards in play), a lock-to-debuff-stealth ability, and the `shuffleIntoLibrary` outcome | ✅ |

**The family is complete — all 25 cards' burn/steal/shuffle clause now
runs through one compiled `vulnerableTo`.** "Does not unlock as normal"
was built in both shapes, as planned: persistent
(`PermanentInPlay.preventsUnlock`, Grand Ball) and one-shot
(`MinionState.skipNextUnlock`, consumed by the next unlock sweep). The
one-shot form immediately retired a standing deviation — **On the Qui
Vive**'s ally rider ("if this minion is an ally, they do not unlock as
normal during their next unlock phase") is implemented instead of a TODO.
Stolen Police Cruiser can now use the same field when its turn comes.

The `aura` mechanism (`PermanentAura` on a card in play, resolved by
`auraBonus` in derived.ts) is the reusable piece: `scope: "controller" |
"global"`, filtered by clan/sect, currently carrying `strength` and
`bleedStealth`. Any further "\<clan\> get +N \<thing\>" card is a field on
that type plus one line at the point the value is derived.

### 5.1 Granted rush — also COMPLETE

The second sub-family in the §1 table ("\<who\> can enter combat with
\<target\>") is done, in **docs/granted-rush-design.md**: Haven Uncovered
(100897), Regent (101587), Saulot's Avenging Fist (102257), Frontal
Assault (100794) and Priority Contract (101487). It needed no sequencing
change — `announceEntryAction`'s rush path and the cross-seat enumeration
built here already carried it — just a `permanent.rushGrant` spec clause,
a merge so one card can graft **both** `vulnerableTo` and `rushGrant`
(Haven Uncovered), and three additive hooks (`onLeaveReady`,
`onInfluencePhase`, `onDiablerie`). The crypt-side rushes (Theo Bell,
Barachiel) are the same mechanism waiting on phase 7's crypt import;
Open War stays deferred on §6.3.
| 5 | **Open War** (101324) | granted rush from a *seat-level* card to any Anarch (cross-seat rush), a granted action with a **pool cost**, "Requires a baron", game-wide uniqueness, and a master-phase counter economy — see §6.3 |
| 6 | **Cave of Apples** (100311) | corruption placement via a granted Ⓓ action + **steal a minion** at the capacity threshold — gated on §6.2 |

Cards 1–4 need no new sub-system beyond §4. Cards 5 and 6 each carry a
genuinely new one, hence the open questions.

## 6. Open questions for the owner

### 6.1 Reverse the Powerbase precedent?

The decision on record is that "an opponent's *burn this card as a Ⓓ
action* counter-play is a noted deviation, not a new directed-action-at-a-
card system." §4 makes it cheap: `targetPermanent` on the frame plus
cross-seat enumeration, roughly 60 lines of kernel. Reversing it retires
the deviation on ~25 cards (and on the already-supported ones that carry
the clause). Cost: option noise in every minion phase.

**Recommendation: reverse it.** It is the largest single fidelity gap left
and the mechanism is small.

### 6.2 Control change ("steal")

Six cards steal something. Two tiers:

- **Steal a card in play** (Powerbase: LA, Powerbase: Montreal, The Rack,
  Fragment of the Book of Nod, Saankaláxt's equipment) — a
  `PermanentControlChanged` event moving an entry between seats. Small.
  The Rack even has text for it ("as … its controller changes").
- **Steal a minion** (Cave of Apples) — much bigger: control vs ownership,
  what happens to attached cards and blood, whether the minion counts for
  ousting/VP, and "their owner's uncontrolled region" staying keyed to the
  *owner*. `MinionState` currently has `controller` only.

**Recommendation: card-level steal in this gate, minion-level steal as its
own mini-gate** (it is really the "control vs ownership" system, which
also touches withdrawal and contested cards on the still-open list).

### 6.3 Open War is three cards in a trenchcoat

Beyond the rush grant it needs: "Requires a baron" (have it), **game-wide
uniqueness** ("Only one Open War can be played in a game" — we model
per-seat uniqueness only; needs a game-level played-card record),
a **Methuselah-level master-phase granted action** (move 1 pool counter
onto the card — the first granted action taken by a *Methuselah* rather
than a minion), and an ambiguous payout ("If this card has 4 counters,
burn it and gain 4 pool" — the text does not say *whose* 4 pool; most
plausibly the card's controller, but it is genuinely unclear and I could
not find a verbatim ruling).

**Recommendation: defer Open War to the end of the wave** and decide the
payout question then; cards 1–4 deliver most of the value without it.

### 6.4 Wave size

Cards 1–4 (six cards, no new sub-system) as the gate, with 5–6 following
after their questions are settled — or all six in one gate?

## 6.5 Bug found and fixed while building card 1

Card 1 needed a "during **your** unlock phase" gate, which exposed a live
rules bug: the `turn.unlock` window is offered to *every* seat (so that
"during ANY Methuselah's unlock phase" cards like Homunculus work), but
the own-phase cards only checked `ctx.seat === owner.seat`. **Every
hunting ground, Powerbase: Madrid, Vessel and Dreams of the Sphinx's
Edge-pool ability therefore fired once per player per turn cycle instead
of once per turn.** Fixed by adding `PlayContext.turnSeat` and gating the
four sites on it; regression test in `tests/cards/own-unlock-phase.test.ts`
(including the negative case that Homunculus still fires on other turns).

## 7. Tests

Kernel (`tests/engine/`): a granted action directed at an opponent's card
in play is blockable **only** by that card's controller; a self-effect
granted action is undirected (prey + predator may block); a blocked
granted action pays no cost and its effect does not happen; the target
permanent leaving play mid-action → success, no effect; the p. 20 limit is
per minion per action per copy (two minions may each use the same card
once; one minion may not use it twice across an unlock).

Cards (`tests/cards/`): one deterministic scenario per card, negative space
asserted (Pit's counter action is offered only to Hecata you control;
Brujah Debate's burn is not offered to *your own* minions when the text
says "Non-Ventrue minions" and you control only Ventrue; the burn action's
stealth rider applies only to the named clan).

Fuzz: all wave cards added to the decks; existing invariants unchanged
(granted actions reuse the action frame end to end).
