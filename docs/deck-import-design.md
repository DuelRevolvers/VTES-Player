# The deck importer

2026-09-04, phase 7. Takes a deck list pasted from a deck-building site
and turns it into a `DeckList` this client can deal — or says exactly why
it cannot. The standing rule from CLAUDE.md is the brief: *"Deck import
must validate against the registry and report unsupported cards to the
user — never silently drop or break."*

---

## 1. One parser, not one per site

VDB, Amaranth, ARDB, JOL, LackeyCCG and the TWD archive all export the
same thing underneath — **a count and a name per line** — and disagree
only about decoration: `2x Name`, `2 Name`, `2<tab>Name`, and ARDB's
padded stat columns (`2  Ariane   3  cel pot pre   Brujah:5`).

So there is no format detection and no per-site parser. Read the count,
then find the **longest prefix of the rest that names a card in the V5
pool**. The registry does the work a format-specific parser could not do
anyway: it says whether a name is crypt or library, which makes section
headers optional rather than load-bearing. A `Crypt:` header is a nice
hint; the importer does not need it.

**Longest-first is not a detail.** "Archon" and "Archon Investigation" are
both real cards, as are "Dominate" and "Dominate Kine". A shortest-first
parser reads the wrong card and never says so — the "empty for the wrong
reason" shape, one layer up.

### 1.1 The bug the round-trip found

The test exports a real precon and reads it back. That immediately caught
**`.44 Magnum`**: the count separator was written `[\s:.\-\t]*` so it
could absorb `2. Name` and `2 - Name`, and it happily ate the leading dot
of a card whose *name* starts with one. `.44 Magnum` imported as
"44 Magnum" and was reported as not being in the pool.

The fix is that a punctuation separator must be **followed by whitespace**.
The lesson is the older one: a fixture written by hand would have used
plausible card names and never contained this card. Round-tripping the
real product data did.

## 2. Names as a comparison sees them

Deck lists are typed by hand, translated, pasted through spreadsheets and
mangled by fonts, so matching cannot depend on any of that surviving:
case, accents (`Kuyén`, `Día de los Muertos`, `Flávio Gonçalves`), curly
quotes (`Jason "Son" Newberry`), dashes, or the `™` on Pentex. All of
those are normalised away. Letters are not, because two card names can
differ by nothing else.

KRCG suffixes crypt names with their group — `Ariane (G5)` — while most
sites print the group in its own column, so **both spellings resolve**.
That works only because no two V5 crypt cards share a bare name; the
importer's index would silently prefer one of a colliding pair, so a test
asserts the absence of collisions rather than relying on it.

## 3. What counts as fatal

- **Unknown card** — fatal, reported with its line number and text. A deck
  that quietly lost a card is not the deck the player built.
- **Unimplemented library card** — fatal. Playing it would silently do
  nothing. (The library is at 444/444, so this only bites once the pool is
  widened — which is exactly when it will matter.)
- **Deck construction** — fatal. p. 14: at least 12 crypt, 60–90 library.
  p. 4: *"A Methuselah's crypt must be built using vampires from a single
  group or from two consecutive groups"*, with the glossary's exemption
  for group "any".
- **A vampire whose printed ability is unimplemented** — **not** fatal, and
  reported anyway. It is a real card with real stats and the game plays
  correctly; 118 of the 217 crypt cards print a bare sect line and need no
  code at all. This is the same reading `validateDecks` already took.

A deck is handed back only when nothing fatal is wrong. The report is
complete either way.

## 4. Precons are DERIVED, not a hand-kept table

The spec asks the importer to say which sets and precon decks are
supported. Sets were already in the registry. Precons were in the KRCG
snapshot all along and the pipeline was dropping them: each card's
`sets[<set>]` lists its printings, and a printing that belongs to a precon
carries `precon` and `copies`.

So `scripts/build-registry.mts` now assembles them by walking every card
and collecting the ones that name each deck — **32 precons across the
seven V5 sets**, derived from the same snapshot as the cards, unable to
drift from them, and growing by itself when the pool is widened.

*(This is the `path` lesson again: the data was in the snapshot and simply
never reached the engine. Worth checking the raw record before concluding
something is not available.)*

**18 of the 32 are playable as printed.** The other 14 are the New Blood
starters, which are half decks by design (6 crypt, 48–49 library) — so
they are listed with the reason rather than hidden, which is the same rule
as everything else here.

`preconDeck(set, name, seat)` returns one as a dealable `DeckList`, which
also answers "no decks ship with the client": 18 do.

## 5. Not done yet

- **No UI.** This is the engine of the importer; the paste box, the report
  and the precon picker belong to the lobby screen.
- **Text only.** ARDB's XML and VDB's JSON exports are not read. Every
  site can produce text, so this is a convenience, not a gap.
- **Group legality is checked, clan and discipline legality is not** —
  because there is no such rule; V5 decks are unrestricted beyond size and
  group.
- **No deck hash.** Cockatrice's `DeckList` hash is worth copying for the
  lobby, so two players can confirm they loaded the same deck
  (docs/cockatrice-lessons.md).
