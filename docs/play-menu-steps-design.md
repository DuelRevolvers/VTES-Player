# A card with too many plays: sequential pickers

**Owner request, 2026-09-21:** a card like **Vessel** offers so many plays
that the menu runs off the screen. Could the options be laid out in a grid
so they all fit — or is there something better?

Built in **0.11.04**.

---

## 1. A grid would not have fixed it

Vessel's `options()` builds **every minion at the table × (nothing, or
each Blood Doll in play)**. On a four-seat table with a dozen minions and
three Blood Dolls that is 48 plays. A grid of 48 cells is exactly as
unreadable as 48 rows, only wider — the count is the problem, and the
count is a **cross product**, not a list.

Asking one question at a time collapses it: **12 + 4, not 48.**

`cheap-tail-design.md` §1 is both the precedent and the licence:

> A CROSS-PRODUCT MENU BECOMES SEQUENTIAL PICKERS FOR FREE, and the
> sequencing is unobservable — choice frames ask nobody else anything, so
> nothing moves between the steps. A pair list is rules-pure and
> unreadable at 28 rows.

That doc's caveat — it does not work where the params are fixed at
announcement (p. 25) — **does not bite here**, and for a reason worth
writing down: this is not assembling an option out of parts. Every option
already exists in `dp.options`; the menu is *filtering a list it was
handed* and the last click submits an id that was there from the start.

## 2. It reaches nothing

The whole feature is in `render.ts` and `loop.ts`:

- **`playAxes(plays)`** — which fields this set of plays could be split
  on, in order.
- **`narrowPlays(plays, narrow)`** — the plays still reachable under the
  answers given.
- **`playMenu(..., narrow)`** — draws a question when the list is long,
  the real options when it is short.
- **`DebugApp.playNarrow`** — the answers, as view state beside
  `selectedCard`.

Nothing enters the command log, nothing is sent to a peer, no engine code
changed, and **no option id is constructed** — a test pins that last one,
because the day this menu starts building ids of its own is the day it can
build an illegal one.

## 3. Three decisions

**The threshold is 8** (`PLAY_MENU_FLAT_MAX`). Below it the flat list is
better: stepping a three-play card would buy a click and no room. A test
pins the short case as the *control*, without which every other assertion
here would pass on a menu that stepped unconditionally.

**The axis order is the enumerator's**, not a heuristic: `mode` and
`minion` first, because they are the frame of the play ("at which level,
played by whom"), then the params in the order the card's `options()`
wrote them. On Vessel that is target, then Blood Doll — the order a player
says it out loud. Sorting by how many values an axis has would put `bd`
first on Vessel, read as arbitrary, and **change between turns** as the
board changed, which is the worst property a menu can have.

**An axis only qualifies if EVERY play has a value for it.** This is the
one that could have gone wrong invisibly: an option missing the param
cannot be reached by any of that axis's buttons, so splitting on it would
make a legal play unclickable while the menu still looked perfectly fine.
The `useAbility` and `useEntryAction` options in the table-card menu have
`params` but no `minion` or `mode`, so this is not hypothetical —
`axisValue` is total over the union for the same reason.

## 4. What it looks like

Breadcrumbs of what has been answered, a **⟲ Start over** button, the
question as a small caps heading, then the values as wrapping chips with
"*n* ways" underneath where more than one play sits behind them.

**Start over is drawn on the final flat list too**, not just mid-walk: a
player who has picked a target must be able to change their mind without
closing the card and opening it again.

The narrowing buttons carry `data-narrow` and **not** `data-opt`, so the
one handler that submits an option id cannot mistake one for a move — the
same separation `data-peek` already relies on.

## 5. When the answers are thrown away

The answers belong to **one card on one decision**. `pruneSelection`
clears them whenever the open card changes or the selection is dropped —
half-answering Vessel's target and then clicking a different card must not
leave that answer filtering the next menu, which would show a short list
and silently hide the rest.

`narrowPlays` also falls back to the unfiltered list if the narrowing
matches nothing, so even a stale answer can only ever show *too much*,
never an empty menu.

## 6. Not built

- **No grid.** See §1 — it addresses the symptom.
- **No "back one step"**, only Start over. With two axes they are the same
  thing; a third axis would earn it.
- **Nothing per card.** No card names an axis order or a threshold. The
  day one needs to, that is a sign the axis order rule is wrong rather
  than that Vessel is special.
