# The investments — design (wave 96)

Pool paid in advance and drawn back one master action at a time.

| Card | KRCG | Cost | Starts with | Printed type |
| --- | --- | --- | --- | --- |
| Protracted Investment | 101502 | 2 pool | 5 blood | Master. Investment. |
| Short-Term Investment | 101769 | 1 pool | 3 blood | Master. Investment. |
| Slave Auction | 101802 | 1 pool | 1 blood per Methuselah in the game | Unique master. |

All three: "You may use a master phase action to move 1 blood from this card to
your pool. Burn this card when it is empty." Printed text read from
`data/vtes-raw.json`.

## 1. What the wave found: a clause that has never been able to fire

**Wall Street Night, Financial Newspaper** has been in the pool since long before
this wave, and its second clause — "a minion you control can lock this location
to move 1 counter from an **investment card** to your pool as a +1 stealth Ⓓ
action" — has never had a target. Its own comment said so: "the V5 pool contains
no investment cards at all … it starts working the day one exists." Its test could
only raid a hand-built stand-in entry tagged "investment".

This wave is that day, and the whole of it rests on one word in the spec: the
**`investment` tag**. A spec that left it off would compile, pass its own tests,
play perfectly — and leave Wall Street Night's clause dead, with nothing anywhere
failing. So the wave's test raids a *real* Protracted Investment, and asserts the
tag is present on the entry **after a real play from hand** — the path that
denormalizes it, which the old stand-in never exercised.

The negative space matters as much: **Slave Auction pays out exactly like an
investment and is not printed as one**, so Wall Street Night must not see it. It
carries no tag, and the test asserts the raid is refused.

This is the Path-masters situation from wave 8 in reverse: a card whose clause
"matches nothing today" was admitted whole, and a later wave made it match
something. Nothing in the tree would have said when that happened.

## 2. What was already there

Everything but one start value. `bloodStore` (the Powerbase locations) already
had `start`, a `cardToPool` offer with `usesMasterAction`, and `burnWhenEmpty` —
whose doc already notes that "burn when it has no blood" and "burn when the last
counter is removed" are one rule. The investments are data on it.

The one addition: `start: { perMethuselah: true }` for Slave Auction — the number
of Methuselahs **still in the game** at play (an ousted Methuselah has left the
game), fixed thereafter.

## 3. A test that passed for the wrong reason

The first draft asserted "a master-phase draw costs the action" by checking that
no second draw was offered. A mutation that made the draw **free** passed it: the
store has its own once-per-phase limit, which produces the same empty option list.
The case now reads `masterActionsLeft` directly. The *empty for the wrong reason*
lesson, caught by the mutation check that exists for exactly this.

## 4. Tests

`tests/cards/investments.test.ts` — 7 cases: the twins enter with 5 for 2 and 3
for 1, tagged; a draw moves 1 to the pool and spends the master action; the last
draw burns the card; Slave Auction starts at 3 with three Methuselahs and 2 with
one ousted; Wall Street Night raids the real investment and refuses Slave Auction.

Mutation-checked three ways — the ousted count, the investment tag, and the
master-action cost (which is what exposed §3) — each failing its own case.

Fuzz: all three added. Wall Street Night is already in the fuzz decks, so its
raid is reachable in a fuzz game for the first time.

## 5. Next in the family

Threestar Cab Company (a blood store that is also a hunting ground: lock-priced
offers, and a "card → a ready vampire" that respects the one-ground-per-turn
rule), Secret Horde (an X pool cost), and Arcanum Chapterhouse (a drain on other
seats' hunting grounds).

## 6. Counts

Library 857 / crypt 217 / total 1074; supported 956 / 1074.
