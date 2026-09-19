# `view.referendum` — the frame the projection forgot (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing. Everything in `ai-vote-scoring-design.md`,
`ai-referendum-terms-design.md` and `ai-vote-economy-design.md` depends on
this.

## 1. The gap, stated exactly

`PlayerView` projects two frames off the stack and no others
(`src/engine/agent.ts`, `viewFor`):

- **`action`**, added in phase 5 because "an agent could not make a
  blocking decision without it";
- **`combat`**, added for the same reason one frame along — "a seat asked
  to choose a strike, press, or spend a prevention credit was given
  nothing at all".

**`ReferendumFrame` was never projected.** So at a vote, an agent holding
a `PlayerView` knows `source`, `count` and `inFavor` from the option, and
nothing else. Not who called it. Not what card it is. Not what the terms
aimed at. Not the running tally.

This is the same shape of gap, in the same file, for the same reason, and
the argument that closed it twice closes it a third time.

## 2. The proof that it is a gap and not a policy choice

Two independent pieces of evidence, neither of which is an opinion.

**The weights are named for a condition that cannot be evaluated.**
`src/ai/heuristic.ts` carries `voteOwn` and `voteAgainstOthers`, commented
"Vote with your own referendum, against everybody else's". The code is:

```ts
case "castVote":
  return (o.inFavor ? w.voteOwn : w.voteAgainstOthers) + o.count * 0.5;
```

There is no branch on who called it, because **there is nothing in scope
that could answer**. `DecisionPoint` is `{seq, seat, window, options}`.
The weight names describe an intent the projection made unimplementable,
and nobody noticed for the life of the file.

**The UI is better informed than the AI at the same table.**
`src/ui/render.ts` renders the running tally by reading
`state.frames.find(f => f.kind === "referendum")` directly, and it gets
that frame because `redactFor` spreads `...state` — frames pass through
unmasked. So a human looking at the table sees the referendum; the bot
sitting beside them does not. An asymmetry in the wrong direction.

## 3. Why none of it is a leak

Everything proposed below is **face up at a real table**, which is the
same test `action` and `combat` were held to:

- the **calling card** is announced face up and its text is public (p. 25);
- the **caller** is the seat that announced it;
- the **terms** are declared aloud on success (p. 27) — that is what a
  referendum IS;
- the **votes cast so far** are public: `votesFor`/`votesAgainst` are the
  running tally the UI already draws, and every source that has spent is
  a face-up title, the Edge, or a card in play;
- `usedSources` is derivable by any player watching who has voted.

Nothing here reads a hand, a library, or an uncontrolled region. The
information-boundary test (`tests/ai/information-boundary.test.ts`) is
per card instance over whole games and should pass unchanged; if it does
not, the design is wrong and not the test.

## 4. The shape

```ts
referendum?: {
  /** Who called it — the question the weights are named for. */
  caller: SeatId;
  /** Handler key of the calling card; "" for a blood hunt (p. 35). */
  cardName: string;
  variant: "political" | "bloodHunt";
  /** The vampire that called it, for the p. 28 modifier/reaction split. */
  callingMinion: MinionId | null;
  step: "terms" | "polling" | "afterResolution";
  /** The caller's declared choices, once made. Structured, not prose —
   *  see ai-referendum-terms-design.md §2 for the key vocabulary. */
  terms: Record<string, string>;
  /** The running tally, as the table can count it. */
  votesFor: number;
  votesAgainst: number;
  /** Sources already spent, so an agent can price what is LEFT
   *  (ai-vote-economy-design.md). */
  usedSources: string[];
  /** Who this referendum would move pool onto or off, and which way.
   *  DERIVED — see §5, and it is the one contested field. */
  effect?: { kind: "burn" | "gain" | "other"; perSeat: Record<SeatId, number> };
};
```

Read off the REAL state in `viewFor`, exactly as `action` and `combat`
are, and for the stated reason: these are folds over face-up material and
re-deriving them from the redacted copy would be a second implementation
of the same rule.

## 5. THE ONE HARD PART: polarity

Everything above except `effect` is a field copy. `effect` is not, and it
is the field the vote and terms scorers actually need.

The frame knows the terms (`{alloc: "Bob=2,Carol=1"}`) but **not what the
allocation MEANS**. That lives in the compiled primitive:
`refAllocateBurn` burns, and a sibling primitive gains. The option built
in `src/cards/effects/compile.ts` says "allocate"; it does not say which
direction the pool moves.

Three ways to close it, and the choice is the owner's:

**(a) The primitive says so, and the frame records it.** When the
referendum frame is pushed, write `effect.kind` from the primitive kind.
One line per primitive, at the site that already knows. Cost: a new field
on `ReferendumFrame` that only the AI reads. This is the
`richer-options-design.md` §1 pattern exactly — "the engine computed this
to build the option in the first place, so asking it is both cheaper and
safer than re-deriving".

**(b) A table in the AI, keyed by card name.** No engine change. But it
is a **second model of the card pool**, which is the thing
`heuristic.ts` explicitly refuses to build ("reading them means parsing
card text, which would be a second model of the pool"), and it goes stale
silently every time a card wave lands. **Not recommended.**

**(c) Leave `effect` out and score only what is structural** — the seats
named in the terms, without knowing the sign. This is strictly better
than today and cannot be wrong about direction, because it never claims
one. It is also much weaker: Parity Shift and a boon would score alike.

**DECIDED (owner, 2026-09-18): (a).** The primitive declares whether it
burns or gains, and the frame records it. It is the house pattern, it is
enforced by the type system when a new primitive is added, and
`no-partial-cards` culture means a primitive that forgets to declare its
polarity is the kind of thing a test can be made to catch.

Consequences of the ruling, so they are not rediscovered:

- **`effect` is no longer optional in the consumers' design.**
  `ai-referendum-terms-design.md` §3 and `ai-answer-choice-design.md` §6
  were both written with a degraded fallback for the case where polarity
  is unavailable. Those fallbacks stay in the code — a referendum whose
  primitive has no polarity to declare must still not crash a scorer —
  but they are now the exception rather than the expected path.
- **Every referendum primitive must declare.** A primitive added later
  that forgets is a silent wrong sign, which is worse than no sign at
  all: it would aim a burn at the bot itself. The declaration should be
  **required by the type**, not defaulted, so forgetting is a compile
  error rather than a behaviour.
- A test walking every referendum primitive and asserting it declares a
  polarity is the enforcement, in the shape
  `tests/cards/no-partial-cards.test.ts` already uses over the registry.

## 6. Tests

- A scenario test that puts a referendum on the stack and asserts
  `viewFor(state, seat).referendum` matches the frame for **every** seat —
  caller and voters alike, because this is public to all of them.
- A **negative-space** assertion: `view.referendum` is `undefined` when no
  referendum frame is on the stack, and the `action` projection is
  unaffected by a referendum being there.
- `tests/ai/information-boundary.test.ts` unchanged and still green.
- A test that a **blood-hunt** referendum (p. 35 — no card, no caller
  minion) projects with `cardName: ""` and `callingMinion: null` rather
  than throwing. The lesson about derived reads being TOTAL applies: a
  referendum with no calling card is not an edge case, it is a rule.

## 5.1 BUILT, 2026-09-18 (platform 0.10.67) — and `perSeat` was CUT

What shipped:

- **`PlayerView.referendum`** in `src/engine/agent.ts`, projected off the
  innermost referendum frame exactly as `action` and `combat` are.
- **`effectKind`** declared by the card and carried on `ReferendumFrame`,
  set once where the frame is pushed.
- **`referendumPolarity`** in `compile.ts`: a `Record` over the extracted
  `ref*` primitive kinds, so **a new referendum primitive is a compile
  error until it declares**. `refPerMinion` is read from its own `effect`
  field, being the one primitive whose polarity is a property of the
  instance rather than the kind.
- **`CardSpec.referendumEffect`** for the cards whose terms are bespoke
  and whose `effects` are therefore empty — Parity Shift, Banishment,
  Cardinal Benediction and the eight Justicars, the last declared on the
  FACTORY so all eight get it at once.
- `tests/ai/referendum-view.test.ts`, including the enforcement test:
  **every political action in the registry declares a polarity**, listed
  by name rather than counted.

### `perSeat` is not in the shipped shape, and this is why

§4 specified `effect: { kind, perSeat }`, with `perSeat` folded out of
the terms by a generic parse over the eight-key vocabulary. **That was
built, and then cut, because a real card proved it cannot work.**

The parse assumed `alloc` names the seats that LOSE pool and `chosen`
names the beneficiary — which is Reckless Agitation's shape. **Parity
Shift is the exact opposite:**

> "Choose a Methuselah who has more pool than you do and allocate 3 of
> **their** pool among 1 or more other Methuselahs (including you)."

The chosen seat loses; the allocated seats gain. So the same two keys
carry opposite signs on two cards that both compile through political
actions, and **a generic parse cannot sign the pool.**

This is `ai-answer-choice-design.md` §4's warning — "it must not assume a
key means the same thing in two cards" — arriving one doc early, and the
doc's own rule decided it: *a wrong sign is worse than no rule*, because
it aims a burn at the voter's own prey believing it a gift.

So the projection carries `effectKind` (which way the card moves pool,
declared) and the **raw `terms`** (which seats it named, unsigned).
Turning the two into per-seat deltas needs per-card knowledge and belongs
with the consumer that needs it — `ai-vote-scoring-design.md`, roadmap
item 3 — where it can be specified card by card with the cards in hand.

**This is a narrowing of item 1, not a deferral of the decision.** The
owner's ruling was that the AI must be able to tell a burn from a gift,
and it now can; what moved is who computes the arithmetic.

## 7. Owner decision, taken

**§5 — (a), decided 2026-09-18.** The primitive already knows whether it
burns or gains, and writing it onto the frame is the same move that put
`bleed` on the action projection. No open questions remain in this doc.

## 8. What this does not do

It does not change a single decision by itself. It is the enabling
change; every doc that consumes it is separate, and each is separately
measurable, deliberately — so if the vote scorer turns out to be worth
nothing, that is a finding about the scorer and not about this.
