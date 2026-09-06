# Options that would do nothing — an owner playtest finding

2026-09-03. Two bugs reported from the playtest server, plus the rules
question underneath them.

---

## 1. The rules question, and the engine was already right

**Report:** *"Alice Chen was put at 8 out of 7 capacity. When she moved
into play she lost the excess blood, like she should, but the excess did
not go back into the Alice player's main pool."*

**The excess is not supposed to go to the pool.** The rulebook says so
twice, in the same words:

> p. 6: "A vampire cannot have more blood than their capacity; **if an
> effect puts more blood on them than their capacity allows, the excess
> is always moved to the blood bank immediately.**"

> p. 6, on the uncontrolled → ready transition: "They retain the pool
> counters used to influence them on their card to serve as their blood,
> **any blood counters in excess of the capacity drain back to the blood
> bank**."

The **blood bank** is the shared supply of counters, not a Methuselah's
pool (p. 3: "When you burn, pay, or spend 1 blood or pool counter, you
return it to the blood bank"). So the counters really are gone. A test
pins this, with the citation, so it is not "fixed" later.

**But the complaint underneath it was right**: the game let a player
spend pool for nothing and only told them afterwards.

---

## 2. The actual bug, and it was in six places

**Report:** *"Blood Doll allowed me to futilely put blood onto the
vampire it was attached to, even though it was at max… Maybe it
shouldn't have that option available if it's not possible."*

Exactly right, and the same fault is what wasted the pool in §1: the
influence phase offered a transfer onto a vampire whose counters already
equalled its capacity.

An option whose **whole content** is "gain N blood" does nothing for a
minion at capacity, and taking it spends something real — a transfer, a
pool counter, a card's once-per-phase use. This project already applies
that principle elsewhere ("a strike that provably does nothing is not
offered"; "an ally already at its starting life is not offered"); it had
simply never been applied to blood gains as a class.

**`canGainBlood(m)` and `uncontrolledCanTakeCounters(u)` in derived.ts**
are the one place the question is now asked. Six sites had to agree and
did not:

| site | before |
|---|---|
| influence transfer (`inf:add`) | **no check** — the owner's 8-of-7 |
| `bloodMoverAbility` (Blood Doll, Vessel) | **no check** — the owner's report |
| hunting grounds (13 cards, one mechanic) | **no check** |
| `addUncontrolledBlood` (Magnetic Authority) | **no check** |
| `bloodOnBleedSuccess` | **no check** |
| `actionAddBloodToVampire` | checked **only** when the card printed "not to exceed" |
| `afterActionBlood` (Cappadocian Crypt) | **no check** |
| `undeadAllyLife`, `lockToHealAlly` | already checked — now via the shared helper |

That last row is the interesting one: `actionAddBloodToVampire` gated the
check behind the card's own `capped` flag, which was written for an
ally's printed starting life. But **p. 6 caps every minion regardless of
what the card prints** — so an uncapped card still offered a full vampire
an option that did nothing. The flag was answering a narrower question
than the rule.

**Deliberately NOT gated: the hunt action.** A full vampire hunting gains
nothing, but hunting also triggers `onHuntSuccess` cards, so it is a
legal if unusual play — the helper is for effects whose *whole* content
is the blood gain.

**The helper reads DERIVED capacity**, so a Discipline master that raises
capacity reopens the option and one leaving play closes it again. Pinned
by a test.

---

## 3. Search in How to Play

`searchRules(query)` filters the sections; every whitespace-separated
term must appear, so "block stealth" narrows rather than widening.

Three details worth keeping:

- **It searches the TEXT, not the markup.** `ruleText` strips tags first,
  or typing "b" would match every bold run and "li" every list item.
- **Matching sections open automatically.** A player searching is looking
  for a phrase, not a heading; making them click each result would defeat
  the point. With the box empty, the remembered open/closed state
  applies as before.
- **Highlighting skips tags.** The bodies are authored HTML, so the
  highlighter splits on tags and only marks the text between them — a
  naive replace on "p" would rewrite every `<p>` into `<<mark>p</mark>>`.
  A test asserts exactly that does not happen.

The query is view state like the rest of the panel: it never reaches the
command log. Because the panel is a pure function of its query, every
keystroke repaints — so the caret position is restored afterwards, or
typing the second letter would jump to the start of the box.
