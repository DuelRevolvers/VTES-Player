# The Path cards

Status: **COMPLETE — all 4 shipped (2026-09-03).**
Cards: Absolute Tyranny (102308), Terrifying Visage (102343),
Privileged Position (102334), Forward Momentum (102323).
Burial Site Hunting Ground (102311) is completed at the same time; its
Path branch was the last row of its PARTIAL entry.

---

## 0. A CORRECTION, recorded rather than quietly overwritten

The first version of this document (2026-09-03, morning) concluded that
three of the four cards were **permanently unbuildable**, on this claim:

> Six cards FILTER on a Path and NOT ONE GRANTS one. No card is named
> "Path of …"; the masters that put a vampire on a Path are LEGACY cards,
> which "V5 product line only" excludes. So the set of Path-following
> vampires is permanently empty.

**The first sentence is true. Every inference drawn from it is wrong**,
because it assumed a Path must be *granted by a library card*. It is not.

**A Path is a printed attribute of a CRYPT card**, exactly like clan,
sect, title and capacity. KRCG records it in a top-level `path` field on
the vampire's record, and **all 48 Sabbat V5 vampires already in our pool
carry one**:

| Path | V5 crypt cards |
| --- | --- |
| Cathari | 12 |
| Death and the Soul | 12 |
| Power and the Inner Voice | 12 |
| Caine | 12 |

Checking this took one query over `data/vtes-raw.json`. The reason it was
missed is worth writing down, because it is a shape this project has hit
before: **the wrong question was asked.** "Which card puts a vampire on a
Path?" has the answer "none", and that answer is *correct and
misleading*. The right question was "where does a Path come from?", whose
answer is the same as for clan and sect — the vampire is simply printed
that way.

**So the scope lock never needed breaking.** Widening the pool to all
4,149 KRCG cards would not have helped: the full legacy pool contains no
Path-granting card either. The 15 legacy cards named "The Path of …" are
thematically-named masters (The Path of Night is an Obtenebration
discount for Lasombra), and the one true Path card in all of KRCG —
Path of the Void, a 2008 promo — grants a *different* Path that no card
in our pool filters on.

**This is the sixth cut-list row in nine waves whose blocker was already
built or cheaper than written down** (Touch of Valeren, New Carthage,
Break the Bonds, Hunting the Quarry, Spying Mission, and now this) — and
the first that was *mine, from the day before*. *A deferral is a claim
about the code as it was; a blocker is a claim about the data as you
read it.* Both need re-reading before they are designed against.

---

## 1. What the real blocker was

The same one `MinionState.clan`, `.sect` and `.title` have: **the
phase-7 crypt importer does not exist yet.** Those three fields are set
by test fixtures today and will be read off the crypt card at deck
import. `path` now sits in exactly that position, and every card that
reads it is supported on the same terms as every clan- and
sect-filtered card already shipped.

One real gap had to be closed for that to be true: **the registry
pipeline dropped the field.** `toCryptDef` in `scripts/build-registry.mts`
copies clan, capacity, group, disciplines and card text, and silently
discarded `path`, so the data existed in the raw KRCG snapshot and
nowhere the engine could see it. That is the whole of the "unblock".

---

## 2. The rule that decides each card

The rulebook mentions Paths **nowhere** — not "Path of", not "Paths",
not "Humanity", not "Enlightenment" (the same result the wraith/zombie
survey got, `docs/wraith-zombie-design.md` §1). So there is no Path
subsystem to build and no ruling to ask for: a Path is a **trait you
filter on**, and the four cards are four different filters.

The distinction that mattered while the set was empty, kept here because
it is what makes Absolute Tyranny's test worth reading:

> **A positive filter over an empty set matches nothing. A NEGATIVE
> filter over an empty set matches everything.**

With the crypt importer feeding real Paths, the set is no longer empty
and both directions simply work. The assertion survives as a *control*:
a vampire with no Path is still exempt from a positive filter and still
caught by a negative one.

---

## 3. Terrifying Visage (102343)

> Put this card on a ready vampire who follows the Path of Cathari. If
> this vampire is blocked, the blocking minion's controller burns 1 pool
> before block resolution. A vampire can have only one Terrifying Visage.

Three clauses, three pieces that already existed, plus one new static.

- **The attach filter** is `permanent.attach.path`, one line in
  `attachTargets` beside the existing `clan`/`sect`/`minCapacity` tests.
- **"Only one Terrifying Visage"** is `permanent.exclusiveKey`, built for
  the archetypes and already enforced inside `attachTargets`.
- **The toll** is new, and it is *not* `blockedToll`. That static exists
  (Phantasmagoria superior) and fires at exactly the right moment — ahead
  of p. 25's two consequences of a successful block — but **the payer and
  the currency are both different**: Phantasmagoria charges *the bearer*
  blood or life, this charges *the blocking minion's controller* pool.

So `PermanentStatics.blockedPoolToll` is a sibling field applied at the
same site, rather than a `payer` discriminant bolted onto a static whose
`payWith: "blood" | "bloodOrLife"` union is specifically about a minion
paying. Two fields with one timing reads better than one field with two
meanings — and the project has been bitten the other way (the
`modifyVotes`/`restrictVotes` split, which drifted precisely because one
mechanic was written twice).

**Reading on record: the toll is paid on a SUCCESSFUL block only.** The
card says "if this vampire is blocked", and a failed attempt does not
block them. It is therefore not the block tax (`blockCosts`, paid to
*attempt*, `docs/block-tax-design.md`) — a blocker who tries and fails
pays nothing here.

**Reading on record: an unaffordable toll does not stop the block.** The
card charges pool and names no consequence for having none; a Methuselah
at 0 pool simply pays what they have. Contrast `blockTollFor`, which
*bars* a minion who cannot pay, because that toll is a printed price of
attempting. This one is a penalty, not a price.

Note the identical sentence is printed on **Aelswith, The Irresistible**
(201735), a Sabbat V5 crypt card — so this static is already spoken for
by phase 7.

---

## 4. Privileged Position (102334)

> Unique. Requires 2 or more ready vampires who follow the Path of Power
> and the Inner Voice. Put this card in play. After a referendum called
> by a vampire you control passes, you can lock this card to burn 1 pool
> from your prey.

**The requirement line is the new shape: it counts.** Every existing
Methuselah-level requirement (`requiresControlledSect`, `…Clan`,
`…Title`) asks whether *some* ready vampire matches — one `.some()` with
every filter ANDed onto one minion. "2 or more" cannot be expressed that
way, so `requiresControlledPath: { path, count }` is its own field with
its own `.filter().length >= count`, checked inside the same
`controllerMeetsRequirements` helper that all three master/action/polling
sites now call.

That helper is where the pre-existing `requiresControlledTitle` bug was
fixed (`docs/blood-locations-design.md`), so adding the check in one
place covers every enumeration site by construction.

**The window already existed and needed nothing.**
`referendum.afterResolution` was built for Voter Captivation, Amici
Noctis and Magnetic Authority (`docs/referendum-margin-design.md`), and
it has exactly the two properties this card wants: it opens **only on a
pass** (so "passes" needs no test of its own), and it already calls
`abilityOptionsFor`, so a card *in play* can offer an ability there —
which the three cards that built it never used, all being cards from
hand.

**"Called by a vampire you control"** is `rf.callingMinion`'s controller,
read at the moment the ability is offered.

**Reading on record: the prey is read when the ability is USED, not when
the card entered play.** "Your prey" is an adjacency relation that an
oust rewrites, and every other prey-reading effect in the engine derives
it on each read (`preyOf`) rather than storing it — the rule
`docs/retainer-wave-design.md` §1 states for combat-scoped effects and
`docs/opposing-statics-design.md` restates for auras.

---

## 5. Forward Momentum (102323)

> Unique. Put this card in play. After a vampire who follows the Path of
> Cathari you control bleeds, if the bleed is successful (for 1 or more),
> add 1 counter to this card; otherwise, burn 1 counter from this card.
> After a vampire who follows the Path of Cathari you control performs an
> action, you can burn 2 counters from this card to unlock them.

Two clauses, both on `onActionResolved`, which fires from the **single**
`ActionResolved` emit site — win or lose — with the action frame still on
the stack.

**Both halves of clause 1 are one hook, deliberately.** The obvious build
uses `onBleedSuccess` for the +1 and `onActionResolved` for the −1, and
that is a trap: the two would then carry **two separate definitions of
"successful (for 1 or more)"**, in different files, and the day one
changes the card starts both adding and burning a counter. One hook, one
test: `success && currentBleed(state, af) >= 1`.

`onActionResolved`'s info gained **`actionKind`**, which it already had
on the frame and simply never passed on. That is what lets the hook tell
a bleed from any other action without a second lookup.

**Reading on record: a BLOCKED bleed burns a counter.** The card's
"otherwise" is unqualified, and p. 27 is explicit that a blocked action
is still performed — it resolves, unsuccessfully. So the two ways to fail
(blocked, or reduced to 0 bleed) are one branch, which is also why
testing `success` alone would be wrong: a bleed reduced to zero *does*
resolve successfully and must still burn a counter.

**Reading on record: a counter is burnt only if there is one.** The card
says "burn 1 counter from this card" and names no penalty for an empty
card; nothing on it burns the card at zero, unlike Dance of the Dead.
Clamped at zero rather than allowed negative.

**Clause 2 is optional and costed, so it is offered rather than taken.**
The Cave of Apples / Dead Pool direction the owner endorsed, not the
Show of Force one — the difference being that this has a price (2
counters). It is a plain built-in option in the acting seat's existing
`action.afterResolution` window rather than a ChoiceFrame, for the Dawn
Operation reason: **that seat is already being asked**, so a frame would
interrupt a decision they were about to get anyway.

**"Performs an action" is not "performs a successful action".** No
success test on clause 2 — a vampire whose action was blocked has still
performed one, and unlocking them is exactly what the card is for.

---

## 6. Burial Site Hunting Ground (102311) — the PARTIAL closes

Its vampire branch (`huntingGround.path`) was a `continue` with a comment
explaining that no vampire could ever match. It is now the same one-line
filter as `clan`/`sect`/`title` beside it. The ally branch was always
whole. **The ledger row is retired.**

---

## 7. What this does NOT change

- **The scope lock stands.** `config/v5-sets.json` is untouched; the pool
  is still the 7 V5 sets and 661 cards. Nothing here needed a wider pool,
  and the owner's standing decision to widen it later is unaffected —
  this wave is simply not the occasion for it.
- **Crypt abilities are still 0/217.** Reading a printed *trait* off a
  crypt card is what the importer already does for clan, sect and title;
  implementing crypt card TEXT is phase 7 and untouched.
- **`MinionState.path` is still optional.** A vampire without one is
  normal, not an error — most of the pool has no Path at all.
