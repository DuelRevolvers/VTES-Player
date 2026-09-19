# Moving blood and gear between minions

Wave 68 (2026-09-18). Communal Haven: Cathedral (100385), The Spawning Pool
(101839), Blood Trade (100215).

Blood in this engine moves from the blood bank to a vampire, or out of one
as a cost. These three move it **sideways**: between two of your own
vampires, onto a card, and across the table — and the Cathedral moves
**equipment** the same way, which is the same question about a different
thing a minion carries.

| Card | From | To |
| --- | --- | --- |
| Communal Haven: Cathedral | a ready Sabbat you control | another, blood **or** its equipment |
| The Spawning Pool | a ready Nosferatu you control | the card itself, as counters |
| Blood Trade | a vampire you control | a vampire **another** Methuselah controls |

---

## §1 — One field, three filters

`permanent.carryTransfer { window, lock?, who?, blood?, toCard?, equipment?,
crossSeat?, anySeat? }`. The three cards differ only in the filters, which is
what makes them one wave: the option list is always "one per (giver,
receiver)", and the receiver is a minion, the card itself, or a minion at
another seat.

Two shared rules fall out of existing lessons:

- **A vampire at capacity is not offered blood.** Counters past capacity
  drain straight back to the bank (p. 6), so offering them is offering
  nothing (`docs/futile-options-design.md`). The test asserts the
  already-full vampire can still GIVE.
- **"During X, do Y" is once per phase** (p. 16), tracked on `entry.phaseUses`
  — and for the Cathedral the lock says so as well, so both are checked.

## §2 — The Cathedral's "and/or" is one lock

"Transfer equipment **and/or** move blood" with a single lock: the option list
offers both kinds and the lock is spent on whichever is taken. The test pins
that taking the equipment half leaves the card with nothing more to give this
phase, which is the honest reading of a one-lock card — the alternative (both
halves for one lock) would need the card to say "and".

## §3 — Equipment moves without leaving play

`EquipmentMoved` splices the entry from one minion's `attached` to another's.
The **same entry**, so counters, lock state and anything stacked on it travel
with it: the card never left play, which is what "transfer" means. An event
rather than a burn-and-re-enter, because re-entering would fire arrival hooks
and lose the equipment's own state.

What counts as equipment is the ENTRY's tags first (`weapon`, `equipment`)
and the registry's `isEquipment` second — a retainer, a title or an action
card sitting on the vampire is not gear and does not move.

## §4 — The Spawning Pool: a clause two rounds deep

"If a minion you control blocks a bleed against you, you may lock this card
during the **second round** of the resulting combat to inflict 1 damage to the
acting minion for each blood on the Spawning Pool. **This damage cannot be
prevented.**"

Four conditions, all read off the live frames: a combat, its round is the
second, the action below it is a **bleed against this card's controller**, and
the blocker is theirs. The damage goes through
`applyEnvironmentalDamage` — the one path that lands damage with no
prevention window (p. 31). **Recorded reading:** that op is documented as
damage *outside* combat, and this damage is inside one; what the card needs is
its two guarantees (no prevention, no strike source), and there is no other op
that gives them.

**What the test needed, and what that says about the card:** a combat **ends
after one round** unless somebody presses (p. 32), so a clause in the second
round is reachable only when someone paid for a press. The fixture grants one.
That is not a test artefact — it is the card's real cost of entry, and worth
knowing before judging it strong.

The counters **stay** on the card: the clause spends the lock, not the blood,
so a well-fed Pool punishes every turn it is unlocked.

## §5 — Blood Trade, and a bar on a KEYWORD

"Gehenna. Burn all boons. No more boons can be put in play. During each
Methuselah's unlock phase, that Methuselah can move 1 blood from a vampire
they control to a vampire controlled by another Methuselah."

- The blood clause is **every Methuselah's**, in their own phase, from one
  play area — `anySeat`, the shape waves 63 and 66 established.
- **"Burn all boons"** runs as the card arrives, over every seat's play area,
  reading the `boon` tag. No boon in the pool stays in play, so it burns
  nothing today; it is written as a read over a set rather than as a no-op,
  which is what makes the clause true rather than absent.
- **"No more boons can be put in play"** is a bar on a printed KEYWORD, so it
  lives at the ONE place every card type's play options come from — the
  engine's hand-play enumerator — rather than in each type's own enumerator.
  It bites today: Consanguineous Boon carries `keywords: ["boon"]`, and the
  test asserts it has no play option while Blood Trade is in play and has one
  when the event leaves.

## §6 — What the wave found

Three fixture truths, each of which cost a red test and each of which is a
lesson already in CLAUDE.md, aimed at a different target:

- **The unlock phase cannot be set by hand.** The engine runs the sweep as a
  turn BEGINS and only then opens the window, so a fixture that assigns
  `tf.phase = "unlock"` gets asked for a MASTER-phase decision instead. The
  way in is to walk from the previous seat's discard phase — which is what
  wave 66's tests do, and what the first draft of these forgot.
- **A bleed goes to the actor's PREY.** "A bleed against you" needs your
  PREDATOR to act, and the fixture's seat order decides who that is. The
  first draft had the wrong seat bleeding and saw no option at all — the
  card's gate was right and the test was wrong.
- **A combat does not reach round two by itself.** See §4.
