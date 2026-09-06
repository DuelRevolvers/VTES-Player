# The library audit — 2026-09-03

A sweep of all **444 supported library cards**, run at the owner's request
once the library hit 100%, looking for cards that were skipped, only
partially finished, or quietly cut.

**Result: the library is complete. One live rules bug, one targeting
hole, and one coverage gap were found and fixed; the ledger was
otherwise accurate.**

---

## 0. What was checked, and why those checks

The ledger (`docs/partial-support.md`) is the record of known holes, but
the whole lesson of the Path wave is that **a written blocker goes
stale**. So the audit was run against the code and the card data, not
against the notes, and it targeted this project's own recorded bug
classes:

| Check | What it would catch | Result |
|---|---|---|
| Spec modes vs printed clauses | The **Terror Frenzy** class: a card marked supported with only its basic mode built | **1 hit — Go-getter**, already ledgered |
| Superior clause in text, no superior mode | Same class, different detector | 8 hits, **7 false positives** (the Discipline masters print `[CEL]` as what they *grant*), 1 = Go-getter |
| Modes with no effects and no `permanent`/`ally`/`weapon` body | A spec that compiles to nothing | 10 hits, **all false positives** (bespoke handlers) |
| Every supported card resolves to a handler | A card flipped supported with nothing behind it | **0 hits** |
| Deferral language in `cards.ts` not covered by a `PARTIAL:` marker | The stale-comment rot | **1 real hit — Aggressive Corpse** |
| Supported cards named by no test and in no fuzz deck | The project's own "ships with a test" rule | **21 hits** |

The two detectors that found nothing are worth as much as the two that
did: **the Terror Frenzy class is clean across the whole library** except
for the one card that is already written down.

---

## 1. Ledger state (accurate, no changes needed)

- **Cut list: empty.** No card in the library is unimplemented.
- **Blocked list: empty.**
- **6 rows "needs engine work"** — Heroic Might, Rutor's Hand, Putrescent
  Sustenance, Rotting Behemoth, Melange, Go-getter.
- **6 rows "deliberate simplification"** — Dead Pool, Preternatural
  Strength, Wind Dance, War Ghoul (resolved), .44 Magnum, Revelations.
- **2 rows "correctly does nothing"** — Wall Street Night's investment
  clause, Black Forest Base's changeling filter. The pool contains no
  card either could match.

One inconsistency, harmless but worth knowing: **only 4 of the 6
engine-work rows carry a `// PARTIAL:` marker** in `cards.ts` (Rotting
Behemoth and Melange do not). The ledger test only asserts
markers ⊆ ledger, not the reverse, so this is not a failure — the ledger
is the authoritative list and it is complete.

---

## 2. THE REAL FIND: Aggressive Corpse (102286)

> Zombie with 3 life. 2 strength, 0 bleed. This ally can enter combat
> with a minion as a Ⓓ action. **This ally cannot be the target of
> directed actions requiring Dominate [dom] or Presence [pre]. In combat,
> strikes made by this ally cannot be dodged. This ally cannot gain life**
> (instead, any life it would gain goes to the blood bank).

Three of its four clauses were unimplemented, and the card carried this
comment instead of a ledger row:

```
// Remaining clauses are moot for now: no dodge exists; no supported
// directed action requiring [dom]/[pre] can target a minion; no
// supported effect can grant life to an ally (cannot-gain-life).
```

**Every clause of that note was true when written and false by the time
it was read.** This is the exact rot `docs/partial-support.md` exists to
prevent, and it escaped because the note lived in a code comment rather
than in the ledger — the Terror Frenzy failure, one layer down. The
binding owner rule (a touched card ends supported-whole, PARTIAL with a
row, or cut with a blocker) was not followed here.

**The `[dom]`/`[pre]` clause was not merely stale, it was a live rules
bug.** **Entrancement** superior (`[PRE]`) steals an ally, and this is an
ally — so a card that says it cannot be targeted could be stolen by
exactly the Discipline it names.

All three are now built:

- **`PermanentStatics.untargetableByDisciplines`** — keyed on what the
  CARD requires, the sibling of `untargetableExceptDiscipline`, which
  asks about the actor. Read inside `untargetableBy`, so **all eight of
  its call sites honour it at once**. A built-in action (a rush, a
  diablerie) requires no Discipline and is correctly unaffected.
- **`PermanentStatics.strikesUndodgeable`** — checked against the STRIKER
  at resolution rather than stamped onto each `Strike` the way
  `Strike.undodgeable` is. The minion can strike by hand, by weapon or by
  a granted strike, and those are built at five sites: **a flag every
  site must remember is one a sixth will forget.** The derived-not-stored
  rule (`docs/retainer-wave-design.md` §1) applied again.
- **`cannotGainLife`** — the machinery has existed since the
  wraith/zombie gate and Rotting Behemoth already used it. One field.

### 2.1 A second hole found on the way

**`stealMinionOnSuccess` was the one minion-targeting branch that never
called `untargetableBy`.** Every sibling branch in
`enumerateActionTargets` asks; this one did not. So **Secure Haven**'s
"cannot be the target of other Methuselahs' actions" also failed to stop
a steal. Fixed in the same place.

---

## 3. Coverage: 21 supported cards no test named

The project rule is that a card ships with a deterministic scenario test.
Twenty-one did not have one, and grouping them by the mechanic their spec
uses shows two very different situations:

**18 are pure data variants of a mechanic with tested siblings** — 11
hunting grounds behind one `huntingGround` clause (Academic, Park, Carfax
Abbey, Papillon and Burial Site are tested), 6 locations behind
`lockGrant` (22 tested siblings), Iron Glare beside Old Friends, and
Malkavian Justicar beside the two tested title-granters. Coverage by
representative is defensible for these — but **nothing was exercising the
actual data**, so a wrong clan or sect filter on any of them would have
been invisible. That is precisely the "Assamite" trap
(`docs/blood-locations-design.md`), which shipped a filter matching no
vampire and passed every test.

**2 had no tested sibling at all** — **Protected District** and **Party
Out Of Bounds**, both reactions, and both are cards whose "Requires a …"
line went unenforced during the `meetsRequirements` bug. They now have
scenario tests including the negative case.

All 21 are in the fuzz decks, and
`tests/cards/library-audit.test.ts` carries the standing guard: **every
supported card must be named by some test or deck.** It cannot regress
silently.

---

## 4. What the audit did NOT change

- No card's supported flag moved. The library is still 444/444.
- No ledger row was added or removed — Aggressive Corpse's three clauses
  were *built*, not ledgered, because the machinery for all three already
  existed.
- The scope lock is untouched.
