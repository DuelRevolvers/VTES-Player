# The ash heap as a resource

Tranche 1 wave 54, 2026-09-15 (v0.10.45). Redeem the Lost Soul (101577),
Waste Management Operation (102153), Maabara (101136), The Erciyes
Fragments (100656). Library 683 → 687.

The ash heap has been in the engine since 2026-09-01, and until now every
card that touched it PUT things there. These four take things out — or
spend what is in it — which is a direction nothing had gone.

| Card | Reads | Takes it to |
|---|---|---|
| Redeem the Lost Soul | your ash heap's **vampires** | out of the game, for pool |
| Waste Management Operation | your ash heap's **library cards** | the bottom of your library |
| Maabara | the same | onto itself, then the top of your library |
| The Erciyes Fragments | your **PREY's** ash heap | onto itself, and you may play it |

## §2 A burnt vampire remembered its name and nothing else

*"Gain X pool, where X is half of the capacity of that vampire (round
down)."*

`CardInstance` in an ash heap carried `{id, name, crypt?}`. That is
everything a card needs while the only questions are *how many* and *is
it a library card* — which is all any existing card asked. Redeem the
Lost Soul is the first card to ask a **burnt vampire a question about
itself**, and the answer was not there.

The obvious fix — look the name up in the registry — is wrong twice over:

- a **token vampire** has no registry entry at all
  (`docs/token-vampire-design.md`), so its capacity would read as
  undefined and Redeem would pay zero for it;
- capacity is **derived**, not printed. A vampire carrying a
  capacity-raising master was that big when it burned, and the registry
  would give back the printed number.

So the ash entry records `capacity` at the moment of burning, off
`capacityOf(burnt)`. **A zone that stores only what today's readers need
is a zone that will be wrong for tomorrow's**, and the tell is a card
asking a question of something already filed away.

The removal goes through `CardRemovedFromGame`, which already knew how to
take a card out of an ash heap (p. 16: it "cannot be retrieved or
affected in any way"). The resolver **reads** the entry and emits;
splicing the array directly would have moved state outside an event, and
the fuzz proves conservation by replaying the log.

## §3 Three ways back out, one question in front of all of them

`store` (Black Market Cache, Shilmulo Tarot) already held cards on a card
in play, face up or down, and `storeCard` already moved them from a
library or a hand. Three additions:

- **`storeCard` from `"ashHeap"`**, with a `fromSeat` — because the
  Fragments reach into *your prey's* heap, which is the first time the
  pile a stored card comes from is not the holder's own.
- **`store.addFromAshHeap` (`whose`, `max`)** — the lock ability. Offered
  in the master phase: neither card prints a window, and that is where a
  player would use it.
- **`store.toLibraryInMasterPhase`** — Maabara's way back out, and the
  reason filling it is worth a lock.

Waste Management Operation has no store at all — ash straight to the
bottom of the library — so it is `permanent.ashToLibrary`, written beside
the store rather than inside it. Its window is printed (`discard`), which
is why the field carries one.

**Every one of these asks the same question first: is this a library card
or a burnt vampire?** `CardInstance.crypt` is the flag, and it exists
precisely because the filters that do not consult the registry would
otherwise start counting vampires (`docs/ledger-closeout.md` §9). A
vampire cannot be shuffled into a library and is not "a library card in
your ash heap", so all three library-side cards skip it — and Redeem,
alone, skips everything else.

## §4 The Fragments: three clauses that were already built

*"You may play the card from the Fragments as if playing it from your
hand (requirements and cost, if any, apply as normal). … Any vampire with
a capacity above 4 can steal the Fragments (and any card on it) for his
or her controller as a Ⓓ action."*

- **Playing from it** is `store.playableFrom`, built for Ravnos Cache,
  with no clan filter here.
- **"Capacity above 4"** is `vulnerableTo.who.minCapacity: 5` — the
  printed *above* is not *at least*, and writing 4 would have been a
  quiet off-by-one that no test would have caught without the negative
  case.
- **"…and any card on it"** needs nothing: `outcome: "steal"` moves the
  whole entry, and the entry is what holds the store. Keeping the object
  whole is the same reason a contested unique keeps everything stacked on
  it (p. 17).

`store.removeFromGameWhenBurned` is recorded for "when that card is
burned, remove it from the game instead" — a card taken from a prey's ash
heap never goes back into one.

## §5 What the wave found

**A zone that records only what its current readers need.** §2 — the ash
heap kept a name and a flag, which was exactly right for every card that
had ever read it, and silently insufficient for the first card that asked
a burnt vampire about itself. The registry fallback that *looks* like the
fix is wrong for token vampires and wrong for derived capacity, so the
value has to be written down as the card leaves play.

**And a fixture that opens with no master action.** The wave's first test
read an empty option list in the master phase and would have passed a
`.not.toContain` assertion for a reason that had nothing to do with the
card — `threeSeatGame` starts with `masterActionsLeft: 0`. The same shape
as wave 52's empty uncontrolled region, two waves later: **a fixture
grants what the test needs, or the test asserts it is there.**
