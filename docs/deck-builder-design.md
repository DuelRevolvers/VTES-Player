# The Deck Builder (0.11.07–0.11.13, owner request 2026-09-22)

> **0.11.08 — TABS AND PAGING** (owner request, same day). The screen is
> three tabs in the order asked for: **My decks**, **Build a deck**,
> **Card search**. The search shows **30 results a page** by default,
> changeable to 50 / 75 / 100, with a windowed pager. See §8.

> **0.11.09 — THE BUILDER ITSELF.** The reserved panel is now a real
> editor: start from a precon or from scratch, add cards from the search
> beside it, and be told what the rulebook forbids, what it merely
> cautions about, and what this platform cannot yet deal. See §9.

A fourth item on the main menu, and one home for everything to do with
decks: your saved decks, the importer, a search over **every card in the
game**, and the deck builder. §§1–8 are the first two rounds (the search,
then tabs and paging); **§9 is the builder.**

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
| A reserved section for the builder | **Built** — and filled in 0.11.09 (§9) |
| A search over every card in the game | **Built** — all 4,149 |
| Labelled by whether the player supports it | **Built** — three states, not two |
| Basic search (a bar) | **Built** |
| Advanced search (filters) | **Built** — 15 controls |
| Name, set, type, abilities, pool, cost, clan, title | **Built**, plus group, sect, path, discipline levels, burn option, artist, flavour text and whether the card is banned |
| Grid view with card images | **Built** |
| List view, text only | **Built** |
| Three tabs: decks, builder, search | **Built** (0.11.08) |
| 30 a page, with pages, sizeable to 50/75/100 | **Built** (0.11.08) |
| Build a deck: from a precon, or from scratch | **Built** (0.11.09) |
| Legality, cautions and playability while you build | **Built** (0.11.09) |

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

## §5 — The reserved section (superseded by §9)

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

---

## §9 — The builder proper (0.11.09)

The reserved panel of §5 is now the builder. Three owner decisions
settled its shape (2026-09-22):

1. **Deck on the left, card search on the right.**
2. **Cards this platform cannot deal are SHOWN, can be ADDED, and are
   warned about loudly** — so you can build your real paper deck and be
   told exactly what is missing here.
3. **No "play this deck" button.** It saves to My decks; you start a game
   the normal way.

### The rules it applies — and the three it refuses to invent

Read out of the rulebook rather than recalled, because **an invented rule
looks exactly like a rule** and no test you would think to write catches
one. Verbatim, p. 14:

> *"Each Methuselah must have at least 12 cards in their crypt and between
> 60 and 90 cards in their library. **There is no maximum limit on the
> number of cards Methuselahs can have in their crypt.** A Methuselah can
> include **any number of copies of a given card** in either their library
> or crypt within the limits indicated above."*

So:

| Rule | Where | Applied |
|---|---|---|
| Crypt ≥ 12 | p. 14 | yes |
| Crypt maximum | — | **there isn't one** |
| Library 60–90 | p. 14 | yes |
| Copies of one card | — | **no limit whatsoever** |
| One group, or two **consecutive** | p. 4 | yes |

The three a deck builder is most likely to get wrong are each pinned by a
test that would fail if this one drifted into the common mistake: no copy
cap, no crypt cap, and **duplicated unique cards are legal**. On that
last one the rulebook's own word is a caution, not a prohibition:

> *"**CAUTION**: Be careful about putting duplicates of the same unique
> cards in your deck. You cannot control more than one of the same unique
> card at a time…"*

Every vampire is unique (five cards in the whole game print
"Non-unique"), so a builder that called a duplicated unique illegal would
reject essentially every real deck ever built. It is a caution, drawn in
gold, worded "that is legal, but…".

**And one that is not a rule of the game at all: "banned".** The word
appears **nowhere in the V5 rulebook**. It is a VEKN *tournament*
restriction covering 20 cards, so a deck holding one is legal, plays
here, and gets a caution that says which kind of restriction it is.

### Three questions, kept apart

The legality panel answers them separately because they have different
answers and different consequences:

- **Is it legal?** p. 14 and p. 4. Red. Nobody can play this deck.
- **Anything to be careful about?** Duplicate uniques, tournament bans.
  Gold. The deck is fine.
- **Can *this platform* deal it?** The catalogue's badge. Red, but a
  different sentence — the deck is legal, the software is behind.

Merging any two would produce a lie: either "your legal deck is broken"
or "the rulebook forbids this", and both are worse than the gap they
would paper over.

### A draft is a bag of counts

`DeckDraft` is `{ name, counts: Record<id, copies>, savedAs }` and
nothing else. It is **not** a fourth model of a deck beside `DeckList`,
`SnapshotDeck` and the precons: it **serialises to the very text
`importDeck` already reads**, so a deck built here is written by the same
`saveDeck`, into the same store, and picked in the lobby exactly like one
that was pasted in. No new plumbing anywhere.

`tests/ui/deckbuild.test.ts` tests that claim rather than asserting it in
a comment: it runs the builder's output through the **real** `importDeck`
and checks the counts, the name and an empty problem list. Nothing else
in the suite would notice if the two formats drifted apart.

`counts` never holds a zero — removing the last copy deletes the key — so
"is this card in the deck" is one question rather than two.

### Reopening a saved deck does NOT use `importDeck`

`parseDraft` reads the text against the **catalogue**, not the registry.
`importDeck` resolves against the registry and reports anything
unimplemented as an unknown line — so reopening a saved deck through it
would **silently delete exactly the cards the builder exists to warn you
about**. Lines that name nothing at all are returned and shown, never
dropped.

### One search, not two

The editor's right-hand column is the same `searchPanelMarkup` and
`resultsMarkup` the Card search tab draws. The only difference is that
`counts` is passed, and that is the single thing that turns the add
controls on — which is why it is `null` rather than `{}` when no deck is
open. `{}` would mean "an empty deck is being edited" and would draw a
**+** on every card in the standalone tab.

The **+**/**−** on a result are bound in `wireCardResults`, with the rest
of the results block, because that block is replaced on every keystroke
(§8). A handler bound anywhere else would stop working the moment
somebody typed.

### An illegal deck still saves

A draft is work in progress, and a builder that refused to keep a 40-card
deck is a builder you cannot build with. The legality panel says what is
wrong the whole time, and `deckSummary` says it again wherever the deck
is picked, so nothing reaches a table by mistake.

### Opening a precon makes a copy

`savedAs` stays null, so Save writes a new entry. A precon is a *printed*
deck; editing it makes something new rather than changing what came in
the box. A precon's decklist is one entry per copy, so it is **tallied**
into counts — assigning would leave every card at one copy and silently
halve the deck.

---

## §10 — Half decks (0.11.10)

> *"Allow half-decks to be built in the builder, there just needs to be a
> label for it somewhere."* — owner, 2026-09-22

### What was already there, and what was missing

The platform could always **deal** a half deck: the New Blood starters
print six crypt cards and about fifty library cards, and
`validateDecks(decks, halfDeckSeats)` waives p. 14's two minimums for the
seats playing one. What it could not do was let you **build** one, and
the reason is worth recording because it would have shipped as a
half-finished feature in the most literal sense:

**`halfDeckSeats` matched on `kind === "precon"`.** A deck built in the
builder saves as `kind: "paste"`. So waiving the minimums inside
`reviewDraft` alone would have produced a builder that let you make a
half deck, saved it happily — and then could not seat it, because
`importDeck` returns `deck: null` whenever `illegal` is non-empty.
Buildable and unusable.

### The declaration travels in the deck's own text

`Half deck: yes`, written next to `Deck Name:`. That is the only place it
can live and survive everything a deck goes through: saved as text,
re-read as text, handed to the lobby as text, pasted into a forum post
and back again. A flag on the saved-deck record would be lost the first
time somebody copied the list out.

`findHalfDeck` in `deckimport.ts` is the ONE reader. `importDeck` uses
it, `halfDeckSeats` uses it, and `parseDraft` calls it on the single line
rather than carrying a second regex that agrees with it today.

### It is a DECLARATION, not a deduction

A deck that is short because it is a starter and a deck that is short
because it is unfinished **look identical from the counts**. Guessing
would silently excuse the second, which is exactly the failure the
minimums exist to prevent. So the builder asks — a checkbox, which is
also the label the owner asked for — and a New Blood precon opens with it
already ticked, because for a precon the answer is known
(`supportedPrecons().halfDeck` has always computed it).

### Exempt from the two minimums and from nothing else

The library **maximum**, the crypt **group rule** and **every playability
check** still apply. That is not a new rule: it is the exemption
`decks.ts` already states for a half-deck seat, restated in a second
dialect, and `tests/ui/deckbuild.test.ts` pins all three.

### Where the label appears

| Place | Says |
|---|---|
| The editor | a ticked **Half deck** box, with what it exempts |
| The verdict badge | "Half deck — playable here" |
| Both meters | gold with "half deck" instead of red with "need 12+" |
| My decks / the lobby's deck panel | "6 crypt, 30 library **· half deck**" |

The meters matter more than they look: drawing **6/12 in red** on a deck
that is *meant* to be six would be the screen arguing with the rule it
had just applied.

### The tests that would catch a regression

Two of them are negative controls, and they are the point:

- The **same deck declared and undeclared**. Without the undeclared half,
  a builder that had quietly stopped applying the minimums at all would
  pass just as happily.
- **A table of undeclared half decks is refused.** Without it, a
  `halfDeckSeats` that returned every seat would pass the seating test.

And the seating test itself runs a built half deck through **`buildTable`**
— the thing the lobby really calls — rather than asserting the plumbing
in a comment.

---

## §11 — Discipline scope, sort direction, and the jumping page (0.11.11)

Three owner requests, 2026-09-22.

### Keep the search to what the crypt can play

A checkbox above the builder's search: **"Only cards my crypt can play"**.
It hides library cards that need a discipline no vampire in the draft
has, and it names the ones you have so the filter is never a mystery.

**What "in scope" means.** A library card's disciplines are a
REQUIREMENT and **any one of them satisfies it** (p. 10), so a card
listing three is in scope if the crypt has any of the three. A card
requiring **none** is always in scope — that is the case that makes this
a filter rather than a way of hiding every master in the game.

**The scope is read off the VAMPIRES, never off their clans.** A
Malkavian with Dominate is a real card; a clan's "usual" disciplines are
a guideline, not a fact about this crypt.

**An empty crypt switches it off.** A deck started from scratch has no
disciplines, and applying that literally would hide every discipline card
in the game the moment you began — a blank screen that reads as a broken
search (CLAUDE.md, "empty for the wrong reason"). `searchCards` handles
the emptied-crypt case itself, because the caller cannot see it coming.

**It is a setting on the SCREEN, not on the draft.** It is about how you
are looking for cards right now, so it is not written into the deck's
text and does not follow the deck to another machine. Off by default: a
filter nobody asked for that hides most of the game is worse than one
they have to find.

### …and it tells you when the deck already has one

`reviewDraft` reports `offDiscipline` — library cards in the deck that no
vampire in the crypt can play — **by name, with the discipline each one
wants**, and offers a button that turns the scope filter on.

It is a **caution, not an error**. Nothing in the rules stops you putting
a Dominate card in a Gangrel deck; it just means dead cards, which is the
most common way a real deck is quietly broken and precisely why it is
worth saying out loud.

It stays **structured** on the review rather than being pushed onto
`cautions` as a sentence, because the screen offers a button that acts on
it — and because the alternative is the screen fishing one sentence back
out of a list of strings by matching on its words, which is a vocabulary
kept in a regex.

### Ascending and descending

`sortDir` applies to the two sorts with numbers in them, **capacity** and
**cost**. It is deliberately **not** offered for "Oldest set" / "Newest
set", which already ARE the two directions of one sort — a second control
beside them would offer the same choice twice and let the two disagree.

**A card with no such number sorts LAST in both directions.** The old
code used `?? 99`, which did the right thing ascending *by accident* and
would have put all several hundred costless cards **first** on "highest
cost first". The name tie-break stays ascending whichever way the numbers
run, so equal-capacity cards do not flip order when you change direction.

### The page no longer jumps to the top

Owner-reported: adding a card threw the page back to the top.

**The cause is one layer out from the card being added.** `paint()`
rebuilds the screen with `innerHTML`, and **the scrolling element IS
`.shell`** — so every repaint threw the scroller away and built a fresh
one at `scrollTop` 0. Nothing showed it until the deck builder, because
every earlier screen fits on a page; there, every **+** repaints.

`paint()` now saves the scroll of each panel in `SCROLL_KEEPERS` before
the write and restores it after. `.dblist` is in that list too — the deck
list is its own scroller, so removing the fourth copy of a card 200 rows
down would otherwise fling you back to the crypt.

The test pins the **order** (`savedScroll` → `innerHTML` →
`restoreScroll`), not the presence: reading `scrollTop` *after* the
assignment reads the new empty element and restores 0, which is exactly
the bug. A second test holds the list and the stylesheet together, so a
panel made scrollable later and left out of it cannot quietly start
jumping again.

---

## §12 — Saving over a deck (0.11.12)

> *"It should allow you to save over a deck with the same name, it just
> needs to ask if you want to overwrite."* — owner, 2026-09-22

### What was actually wrong

Worse than the request implied. `saveDeck` refuses any name already in
use — correct for **adding** a deck, and wrong for **saving the one you
are editing** — and `saveDraft` only deleted the old entry when you had
*renamed*. So pressing **Save** on a deck you had opened under its own
name failed outright with "you already have a deck called…". Re-saving
your own deck did not work at all.

### The four cases

| Opened from | Name lands on | What happens |
|---|---|---|
| nothing | nothing | added |
| nothing | an existing deck | **asks**, then overwrites it |
| a saved deck | nothing (renamed) | renamed **in place** |
| a saved deck | itself | saved, **no question** |
| a saved deck | a *different* existing deck | **asks**, overwrites it, removes the original |

**Saving the deck you opened, under the name you opened it with, is not a
collision and does not earn a question.** It is the commonest press of
that button, and a builder that asked every time would be nagging.

### `replaceDeck`, not delete-then-save

Delete-then-save would have worked and would have lost two things nobody
asked to lose:

- **the deck's place in the list** — it would leap to the top every time
  you pressed Save, a list reordering itself for no visible reason;
- **its `created` date** — which is when you first made the deck, not
  when you last touched it.

It also skips `MAX_DECKS`. An overwrite adds nothing, so at 60 decks
`saveDeck` would have refused for a reason that has nothing to do with
what was being asked.

It falls back to **adding** when the target has gone — a second tab may
have deleted it between opening and saving, and pressing Save must never
silently lose the deck.

### Matched without case

`deckNameProblem` collides case-insensitively, so the lookup that decides
whether to ask must too. Otherwise "MALKAVIAN" would ask "overwrite
Malkavian?", be told yes, and then fail the duplicate check anyway.

### The first test in `tests/ui/` with a `localStorage`

The deck store is the one part of the UI that is not a pure function, and
the shell has no jsdom — which is why every other test here tests markup
and maths. A dozen lines of in-memory shim buys a test of the thing that
was actually reported: save, edit, save again, and find **one** deck
rather than two or an error. The shim throws on a quota, so "reports a
storage failure rather than pretending it saved" is testable too.

`saveDeck` keeping its refusal is asserted as well: **adding** a deck
from the My decks box is a different act from **saving** in the builder,
and it should still stop you making two decks alike.

---

## §13 — Clan and sect scope, and the Profile back button (0.11.13)

### The scope covers three things now, not one

The §11 checkbox is still **"Only cards my crypt can play"** — it just
finally means it. It now hides library cards that need a **discipline**,
a **clan** or a **sect** the crypt has not got. One toggle rather than
three, because it is one question.

`scopeMiss` returns **which** gate failed, so the warning on the deck can
say *"needs Tremere"* or *"needs a Sabbat vampire"* rather than guessing
it is a discipline and sending somebody after the wrong fix.

**Every gate is "any one of", and they are independent.** A card listing
three disciplines is satisfied by any one; a card that *also* names a
clan must satisfy that too.

### A CLAN ICON ON A MASTER IS NOT A REQUIREMENT

The trap, and it is a big one: **179 masters carry a clan field**.
CLAUDE.md already records that a clan icon is a requirement on a MINION
card (p. 10) and that masters are the exception — Achilles' Heel is
played on a vampire *another Methuselah* controls, and Acquired Ventrue
Assets counts Giovanni.

A clan filter that read `clans` would have hidden all 179 from every deck
whose crypt did not happen to match, and the result would have looked
entirely plausible. So the catalogue carries **`requiresClans`**,
computed once at build time and empty on every master, alongside `clans`
which is still what the card is *labelled* with. The search never has to
know about the exception.

### Sect is PARSED, because KRCG has no field for it

A library card's sect requirement is a printed sentence — *"Requires a
Sabbat vampire."* — so `requiresSects` is parsed in
`scripts/build-catalog.mts`, once, at build time. Re-reading 4,149 card
texts on every keystroke was the alternative.

**Two false positives were found by checking the output rather than
reasoning about it**, and the parse is narrow because of them:

- It demands **"Requires"**, with the *s*, at the **start of a
  sentence**. An earlier `Requires?` anywhere in the text matched An
  Anarch Manifesto's *"+1 stealth on actions that require an anarch"* —
  a description of what *other* cards need, read as a rule about this
  one.
- It cannot match **"non-Camarilla"**, because the article and the sect
  are adjacent in the pattern. A negation read as a requirement would
  hide exactly the cards a deck of that sect most wants. Bear-Baiting
  has both clauses and takes only the first.

**199 cards** state a sect requirement; the **161** that merely mention a
sect in their effect (*"Only usable if a Camarilla or Sabbat vampire is
bleeding"*) are correctly not among them. Eight take **either** of two
sects, and the parse keeps both. Spellings are normalised — the cards
print "Anarch" 54 times and "anarch" 26 times, and two spellings in the
set would make the filter miss half of them.

### One fixture had to change, and that is the finding

`legalDeck()` picked the first six playable library cards, and some of
them are clan- or discipline-gated. The moment the check existed, the
"nothing is off-scope" **positive control** failed — correctly. The
fixture now picks cards that require nothing, so it is genuinely a deck
whose crypt can play all of it, and the positive control means something
again.

### The Profile back button

Moved to the upper right of the card, out of the row with Save and
Delete profile. It is **navigation, not an action on the form** — it was
the only button in that row that changed nothing, sitting next to a red
Delete profile, which is a poor neighbour for the button you press to
leave.

`.dbhead` became **`.cardhead`** and is now shared with the Deck
Builder's header, rather than a second class doing the same job. On a
profile that does not exist yet the header is just the title: there is
nowhere to go back to.
