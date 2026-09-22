# The Deck Builder (0.11.07, owner request 2026-09-22)

> **0.11.08 — TABS AND PAGING** (owner request, same day). The screen is
> three tabs in the order asked for: **My decks**, **Build a deck**,
> **Card search**. The search shows **30 results a page** by default,
> changeable to 50 / 75 / 100, with a windowed pager. See §8.

A fourth item on the main menu, and one home for everything to do with
decks. It ships with three of its four parts built: your saved decks, the
importer, and a search over **every card in the game**. The fourth — the
deck builder proper — has a reserved section and nothing in it, which is
what the owner asked for.

> *"Add Deck Builder button to the main menu. Move the profile's deck list
> and deck importer to this menu. For now, don't build the actual deck
> builder part of the menu but make sure to build a section for it to go
> in the future. What I do want is a card searcher. It needs to have all
> of the cards in the game and label which ones are supported in the
> player."*

---

## §1 — What is and is not possible

Everything asked for is built, with one qualification and one judgement
call, both below.

| Asked for | State |
|---|---|
| Deck Builder button on the main menu | **Built** |
| Deck list moved off Profile | **Built** — moved, not copied |
| Deck importer moved off Profile | **Built** — moved, not copied |
| A reserved section for the builder | **Built** — a real panel, empty on purpose |
| A search over every card in the game | **Built** — all 4,149 |
| Labelled by whether the player supports it | **Built** — three states, not two |
| Basic search (a bar) | **Built** |
| Advanced search (filters) | **Built** — 15 controls |
| Name, set, type, abilities, pool, cost, clan, title | **Built**, plus group, sect, path, discipline levels, burn option, artist, flavour text and whether the card is banned |
| Grid view with card images | **Built** |
| List view, text only | **Built** |
| Three tabs: decks, builder, search | **Built** (0.11.08) |
| 30 a page, with pages, sizeable to 50/75/100 | **Built** (0.11.08) |

**The qualification: "supported" is a three-state question, not a
boolean.** See §4 — reading `config/supported.json` directly would have
badged 118 whole cards as broken.

**The judgement call: the results are PAGED** (30 a page by default; §8).
The grid draws a card scan per result, and showing every match at once
would fire 4,149 image requests at static.krcg.org in one go. The count
line says where you are — "Showing 31–60 of 1,730 matches, out of 4,149
cards" — so a page is never mistaken for the whole answer.

**What was NOT attempted**, and would need a decision first:

- **Rulings.** KRCG carries 2,054 cards' worth of them and they are the
  most useful thing after the card text, but they are also the single
  largest field in the snapshot. Left out of the catalogue to keep it
  lazily-loadable; adding them is a second, separately-fetched file
  rather than a bigger first one.
- **Card images at full resolution in the grid.** The grid uses the same
  scan URL the table does, scaled by CSS, with `loading="lazy"`.
- **Searching by rules concept** ("cards that prevent damage"). That is a
  text search over prose, and the text search does it as well as a text
  search can.

---

## §2 — The catalogue is not the registry

This is the decision the rest of the feature hangs off, and it is a
deliberate second copy of the card data.

`src/cards/registry.json` is **the pool**: ~1,034 cards, carrying the
parsed traits the rules kernel reads. It is what the engine deals from.
It cannot answer "what am I missing?", because the cards you are missing
are exactly the ones it does not contain.

`src/cards/catalog.json` is **all 4,149 KRCG cards**, carrying only what a
person reads. Two rules stop it becoming a second source of truth:

1. **It is GENERATED** by `scripts/build-catalog.mts`, from the same
   `data/vtes-raw.json` snapshot the registry is built from — and from the
   registry itself, for the status badge. `npm run cards:registry` now
   runs **both**, in that order, so a card wave cannot update one and
   leave the other stale. `npm run cards:catalog` runs it alone.
2. **It is LOADED LAZILY.** It is 3.2MB (495KB gzipped, 291KB brotli) and
   has no business in the first paint of a menu screen, which
   `docs/pages-design.md` counts to the kilobyte. `loadCatalog()` is a
   dynamic `import()`, so Vite emits it as its own chunk and only the
   Deck Builder ever asks for it. `Shell.go()` starts the load on the way
   IN to the screen — not from the render, which runs on every keystroke
   and must stay a pure function of state.

`tests/ui/cardsearch.test.ts` pins the **relationship** between the two
files rather than a count in either: every registry id is in the
catalogue and not marked absent, and every non-absent catalogue card is in
the registry. Drift in either direction fails.

What the catalogue drops, and why: translations (`_i18n`), rulings,
per-set scan URLs and set metadata are 5.7MB of the 7.3MB snapshot and
none of it is on screen.

---

## §3 — The search

`src/ui/cardsearch.ts` is pure: a catalogue and a query in, a sorted list
and some markup out. Nothing in it touches the DOM or `localStorage`, for
the same reason `render.ts` does not — **the shell has no jsdom in its
tests**, so anything reaching for a document is a thing that cannot be
tested, and the interesting half of a search is the half a screenshot
would not show you: what it **excludes**.

**Basic** is the bar. Every word must appear somewhere, in any order, in
the chosen scope — so "bram stoker" finds the card whichever way round the
name is written, and "burn blood" finds a card whose text says "burn 1
blood" without anyone having to type the 1.

**Accents are folded.** A pool containing Alabástrom, Béatrice and
Muaziz is a pool where a plain substring match on an English keyboard
returns nothing and the card looks absent. NFD splits a letter from its
mark and the combining range is deleted.

**Advanced** is fifteen controls: pile, scope, status, sort, and
multi-selects for type, clan, discipline, sect, title, group and set,
plus a discipline any/all toggle and numeric bounds on capacity and cost.

Three rules the code states once rather than at each call site:

- **An empty filter list means "do not filter", never "match nothing".**
  A menu with nothing ticked shows everything. The opposite is the classic
  empty-for-the-wrong-reason: a blank screen that looks like a load
  failure.
- **A card without the number is excluded by a bound on it.** Most library
  cards have no capacity, so "capacity 4 to 6" that let a null through
  would return the whole library alongside the vampires and still look
  like a sensible list of cards.
- **Every sort falls back to the name**, so the order is total and the
  list does not reshuffle under the cursor between repaints.

The facet menus are **derived from the catalogue, never written down**. A
hand-kept list of clans is wrong the first time a set adds one, and
wrong silently: the clan simply cannot be picked and nothing looks broken.

### The repaint, and the one exception to it

The shell's model is a whole-screen repaint on every change. The search
box cannot use it — a repaint would destroy the input the person is still
typing into. So **typing replaces only the results block**, and
everything else repaints the screen.

Both paths render through `Shell.cardResultsMarkup()`. One question asked
in two places will drift; one function called twice cannot.

---

## §4 — The badge, and why it is not a boolean

**`config/supported.json` alone would have lied.** It is flipped when a
card has an *implementation*, and **118 V5 vampires need none**: their
whole text is a sect/title clause, so they already do everything they
print. Badging them "unsupported" would report the pool as broken exactly
where CLAUDE.md's "no partial cards" rule says it is whole.

So `status` is derived, with three values:

| Badge | Means | Count today |
|---|---|---|
| **Playable** | Does everything it prints, at a table, today | 1,034 |
| **Partly implemented** | Dealt, but something it prints is not implemented | **0** |
| **Not in the player** | A real card, not yet added | 3,115 |

The middle state is **representable but empty**, and that is the point. It
exists so that a regression is *visible on screen* rather than
unrepresentable; `tests/ui/cardsearch.test.ts` asserts it is empty, which
is the binding rule restated where a player would see it break.

---

## §5 — The reserved section

`Shell.buildPanel()` is a real panel in the real place, disabled. It is
**not a stub**: a panel that says "coming soon" and nothing else is worse
than no panel. This one says what a legal deck needs (p. 14: at least 12
crypt cards and at least 60 library cards, with the New Blood starters
exempt as half decks) and points at the importer, which is a working
answer to the question that brought you here.

When the builder proper is built, it fills this panel. The screen people
already know does not move.

---

## §6 — What this found

Every wave finds something; this one found two.

**A set's date is not its cards' date.** `facetsOf` first derived each
set's release from the earliest `firstPrinted` among its cards — obvious,
and wrong the moment a set contains a reprint. New Blood III (2025-05-31)
holds cards from 1994, so "newest set first" filed it **behind a 2023
promo**. The fix moved set dates into the generated file, read off each
set's own printing row, because *a set's date and a card's earliest
printing are not the same question*. The test asserts the **ordering**
rather than which set is first, because pinning a name would be a hostage
to the next set KRCG adds.

**Fifteen LIBRARY cards print a capacity.** Abomination, Create Gargoyle,
Childe of the Revolution, Trophy: Progeny and eleven others: the capacity
on them is the token vampire's (`docs/token-vampire-design.md`). "Only the
crypt has a capacity" is the obvious assumption, and a search acting on it
would hide exactly the cards somebody hunting for a capacity-4 vampire
wants to see. The test pins the one thing all fifteen share — the card
text is talking about a capacity — because the *type* is fourteen Actions
and one Master, and the creature is a vampire on fourteen of them and a
gargoyle on Create Gargoyle.

---

## §7 — Where things moved

| Was | Is |
|---|---|
| Profile → "Your decks" | Deck Builder → "Your decks" |
| Profile → "Add a deck" | Deck Builder → "Add a deck" |
| — | Deck Builder → "Build a deck" (reserved) |
| — | Deck Builder → "Card search" |

**Moved, not copied.** Two deck libraries would be two places to save a
deck and one of them would drift out of the other's sight; the test
asserts the profile screen no longer calls `deckLibrary()`.

The Profile screen keeps a **pointer** where the decks used to be, with a
button that opens the new screen. A feature that moved without a sign is
indistinguishable from one that was deleted — this project has had that
report twice, about features that worked.

Saved games and default bot names stay on Profile. They are not decks.

---

## §8 — Tabs and paging (0.11.08)

### The tabs

Three, in the owner's order: **My decks** → **Build a deck** → **Card
search**. The first is the tab that opens, because it is the one with
your own things in it.

**One tab's body is DRAWN, not three with two hidden.** The usual
`display: none` trick would build the search's grid — up to a hundred
card scans — every time somebody opened the screen to look at their deck
list, and pay for all hundred image requests to show nothing. The screen
renders the body of the selected tab and nothing else; the test asserts
both halves (no `display: none` on a tab in the CSS, and the screen
branching on `this.deckTab`).

Switching tabs clears `deckError`. It belongs to the decks tab, and
carrying it across would leave a message pointing at a panel no longer on
screen.

### The paging

**30 a page by default, and 30 / 50 / 75 / 100 on the dropdown.** The
default is the smallest of the four on purpose: in grid view the page
size *is* the number of scans requested at once.

Three rules, each stated once:

- **`paginate` clamps; nothing else does.** The page number outlives the
  list it indexes — it survives every repaint while the results beneath it
  change on every keystroke. Page 40 of a 3,000-card search is past the
  end of a two-card one a letter later, and an unclamped slice returns
  `[]`, **which on screen is indistinguishable from "nothing matched"**.
  Clamping lives in the one function that knows how many pages there are,
  rather than at the four places that set a page.
- **`Shell.setCardQuery` is the only way a query changes, and it resets
  to page 1.** There are five ways to change a search (typing, a
  multi-select, a single select, a numeric bound, the reset button) and
  five hand-written resets would be five chances to forget one.
- **Changing the page size resets to page 1 too.** Page 9 at 30-a-page is
  past the end at 100-a-page, and "show me more per page" landing on an
  empty screen is the opposite of the request.

**The pager is windowed.** 4,149 cards at 30 a page is 139 pages, and 139
buttons is a wall, not a pager: first, last, a window of three around the
current page, and an ellipsis for each gap. The first and last page are
always one click away, which the test asserts at five different positions
rather than at one.

**The per-page dropdown and the pager live INSIDE the results block**, so
typing replaces their nodes and takes their listeners with them. They are
bound in `wireCardResults` for that reason — a handler bound to a node
that has since been thrown away is a control that silently stops working,
and only after the person has typed, which is the hardest kind of bug to
report.

**The dropdown ticks the size in use, not `cards.length`.** A last page
of 30 results out of 50 would otherwise tick "30" and the control would
quietly disagree with the paging it describes. `paginate` returns the
normalised `size` so there is one answer to that question.
