# Political Actions & Referendums — Design

Status: **IMPLEMENTED** (2026-07-19; owner sign-off: all 8 cards;
titles as a MinionState field set by fixtures now, crypt-text parsing at
deck import in phase 7). Implementation notes beyond the draft:
referendums whose terms have no legal choice (e.g. Parity Shift when
nobody is richer, Banishment with no younger vampire, an allocation
with too few targets) pass with **no effect** rather than erroring — the
`applyReferendum` hooks treat absent terms as a no-op; a Methuselah's
one-political-card-vote allowance is spent whether the vote came from
the calling card (`"caller"`) or a burned card from hand
(`cardvote:<seat>` guards both).

The largest remaining family: 23 Political Action cards in the V5 pool,
plus the vote machinery that later feeds blood hunts (diablerie's
referendum) and title cards. This gate builds the referendum state
machine and a first wave of requirement-light referendums.

---

## 1. Rulebook facts (citations verified against the V5 PDF)

- **The political action** (p. 24): any ready vampire may take one; a
  vampire cannot perform **more than one political action each turn**;
  cost as listed on the card; **undirected, +1 stealth**. Political
  actions are *always* undirected (p. 26). Only vampires can play
  political action cards (p. 10).
- **Terms are chosen only on success** (p. 25 exception; p. 27): the
  referendum's choices are NOT announced with the action — the one
  exception to "all details fixed at announcement".
- **The referendum** (p. 27–28), three steps on success (after cost):
  1. **Choose the terms** (the caller's choices, if any).
  2. **Polling**: Methuselahs cast votes/ballots freely, in any order,
     no obligation; a cast vote cannot be changed; all votes from one
     source must be cast together, for or against.
  3. **Resolve**: more "for" than "against" passes; **ties fail**.
- **Vote sources** (p. 28):
  - Titled ready vampires: primogen 1, prince/baron 2, justicar 3,
    Inner Circle 4. Locked is fine; torpor is not.
  - The Edge: its holder may **burn it** (back to uncontrolled) for 1 vote.
  - Political action cards: each Methuselah may burn one from hand for
    1 vote (**max 1 vote this way per Methuselah**); the card that
    called the referendum provides 1 vote for the caller.
- Contested titles exist (p. 19) — **out of scope**, consistent with the
  project's cross-player-uniqueness non-invariant.

## 2. Kernel: state

```ts
// MinionState
title: "primogen" | "prince" | "baron" | "justicar" | "innerCircle" | null;
calledPoliticalThisTurn: boolean;   // reset at controller's unlock, like bledThisTurn
```

Titles live on `MinionState`, set by fixtures/tests now and by the
crypt-import pipeline in phase 7 (KRCG crypt data carries titles only
in card text — parsing them is an import concern, not a kernel one).
Sects (Camarilla/Sabbat/Anarch) and clans stay **unmodeled**; the wave
is chosen so no card needs them.

### The referendum frame

```ts
interface ReferendumFrame {
  kind: "referendum";
  actionId: ActionId;          // the successful political action
  caller: SeatId;
  cardName: string;            // the political action card
  step: "terms" | "polling";
  terms: Record<string, string>;      // chosen at step "terms"
  votes: Array<{ seat: SeatId; source: string; count: number; inFavor: boolean }>;
  usedSources: string[];       // vampire ids, "edge", "card:<id>", "caller"
  cycle: ImpulseCycle;         // polling order: caller first, then clockwise
}
```

Pushed by `resolveAction` when a political action succeeds (after cost,
before the action card burns — the card's vote must still be creditable
to the caller). Terms: the card's handler enumerates term options
(allocations, chosen Methuselahs/minions) as decisions for the caller —
this is where "terms only on success" lives. Polling: an impulse cycle
where each seat may cast from each unused source (one option per
source × for/against), burn the Edge, or burn a political action card
from hand (max one per seat); casting is an effect, so the cycle
rewinds (p. 8); quiescence closes polling. Resolution tallies, emits
`ReferendumResolved`, and applies the card's terms effects if passed.

New windows: `referendum.terms`, `referendum.polling` (future vote
modifiers like Awe hook in here; none in this wave).

New events: `ReferendumCalled`, `VoteCast { seat, source, count,
inFavor }`, `EdgeBurned { seat }`, `ReferendumResolved { passed, for,
against }`, plus `MovedToUncontrolled { minion }` (Banishment).

Option-id conventions: terms `terms:<...params>`; polling
`vote:<source>:for|against`, `vote:edge:for|against`,
`vote:card:<cardId>:for|against`, and `pass` closes a seat's polling
turn.

## 3. Spec vocabulary

```ts
cardType: ... | "politicalAction";

// CardSpec:
requiresTitle?: Array<"primogen" | "prince" | "baron" | "justicar" | "innerCircle">;

// Referendum-terms/effects primitives:
| { kind: "refBurnPerMinion"; lockedOnly: boolean }      // Anarchist Uprising, Ancilla Empowerment, Domain Challenge
| { kind: "refAllocateBurn"; points: number | "numSeats"; minTargets: number }  // KRC (4), Conservative Agitation (X = #standing seats)
| { kind: "refChooseSeatsBurn"; base: number; capBonus?: { atMost: number; extra: number } }  // Neonate Breach
```

Parity Shift (choose a richer Methuselah, allocate 3 of their pool) and
Banishment (choose a ready younger vampire → uncontrolled region, cards
and counters staying with it) are bespoke handlers behind the same
interface — allocation enumeration is shared helper code.

Compiled political-action law: options gate on vampires with
`!calledPoliticalThisTurn` (plus title requirement); resolve announces
an undirected +1 stealth action; on success the engine pushes the
referendum frame; the handler's `referendumTerms` /
`applyReferendum(terms)` hooks drive steps 1 and 3.

## 4. The wave (proposed — 8 cards, no sect/clan dependencies)

| Card | What it proves |
| --- | --- |
| **Kine Resources Contested** | the iconic allocation referendum (4 among 2+) |
| **Anarchist Uprising** | burn-per-minion terms-less referendum |
| **Ancilla Empowerment** | identical text — same primitive, second id |
| **Domain Challenge** | burn-per-**locked**-minion |
| **Conservative Agitation** | X = number of Methuselahs allocation |
| **Neonate Breach** | chosen-Methuselahs terms + capacity rider |
| **Parity Shift** | `requiresTitle` (prince/justicar) + take-from-richer allocation |
| **Banishment** | minion-choice terms; ready younger vampire moved to uncontrolled |

Every referendum exercises the full vote machinery: caller's card vote,
title votes (fixtures give seats titled vampires), Edge burn, and
opposing political-card burns.

## 5. Tests

Kernel: political action is undirected +1 stealth and blockable; terms
are NOT chosen when blocked (card burned, no referendum); one political
action per vampire per turn; tie fails; caller's card vote; Edge burned
for a vote leaves play; a Methuselah may burn at most one political
card per referendum; title votes only while ready (torpor excluded);
votes from one source cast together. Cards: one scenario per card
including a failed referendum asserting no effects. Fuzz: add the wave;
give fuzz minions a title or two; invariants — pool conservation
extends to referendum burns/gains automatically (all pool movement
already flows through PoolBurned/PoolGained events).

## 6. Open questions for the owner

1. **Wave size** — all 8, or trim (KRC + Anarchist Uprising + Domain
   Challenge + Parity Shift is the minimal set that still proves every
   mechanism)?
2. **Titles as a kernel field** set by fixtures now, parsed from crypt
   text at deck-import time (phase 7) — OK?
3. Anything you want changed about the polling model (impulse cycle
   with rewind-on-cast, quiescence closes polling)?
