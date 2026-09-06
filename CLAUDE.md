# VTES Platform — Project Memory

## What this is

A browser-based platform for the card game **Vampire: The Eternal Struggle**
(VTES, 5th Edition) with **AI players that fill empty seats**. Desktop/PC
browsers only. Non-commercial fan project under Paradox Interactive's
**Dark Pack** agreement — never add monetization, and keep Dark Pack
attribution when the UI ships. Card data and scans come from **KRCG**
(static.krcg.org, official VEKN data used with permission).

Rules source of truth: the official V5 rulebook PDF at
`..\Vampire The Eternal Struggle Fifth Edition rulebook ENG.pdf` (one folder
above the repo) — read it directly rather than guessing rules; its text layer
extracts cleanly with pdf-parse if page rendering is unavailable. Verified
sequencing citations are collected in `docs/impulse-design.md` §10. When card
text contradicts the rulebook, card text wins ("the Golden Rule").

## Scope (locked decision)

- Card pool = the **V5 product line only**, defined in `config/v5-sets.json`
  (7 KRCG sets: Fifth Edition, Anarch, Companion, Sabbat V5, New Blood I–III).
- Current pool: **661 unique cards** (217 crypt, 444 library).
- The full legacy pool (~4,000 cards) is explicitly out of scope. Never
  widen the pool without the owner's say-so.

## Architecture principles (settled — do not relitigate casually)

1. **Headless engine.** `src/engine/` is a pure TypeScript library: no DOM,
   no networking, no rendering. It must run in Node for tests and batch
   AI simulation.
2. **Deterministic + event-sourced.** All randomness through a seeded RNG.
   Game = initial state + command sequence. State fully serializable.
   This enables replays, reconnection, undo, and reproducible bugs.
3. **The impulse/window system is first-class.** VTES sequencing (impulse
   order, block-attempt states, "as played" windows, wakes) is an explicit
   state machine. The engine loop is: compute whose decision → compute
   legal options → ask that seat's Agent → apply → repeat. Cards register
   handlers into windows; cards are never special-cased into the loop.
4. **Legal-move generator.** The engine always knows every legal option at
   every decision point. UI renders only these; AI chooses only from these;
   multiplayer host validates client intents against these.
5. **Agent interface.** `Agent.decide(decisionPoint, legalOptions, playerView)`.
   Humans and AI implement the same interface. `playerView` is a masked
   view (pure function of full state) — the hidden-information boundary.
6. **Cards as data + primitives.** A vocabulary of parameterized effect
   primitives; most cards are data referencing primitives, a bespoke tail
   gets real code behind the same interface.
7. **Multiplayer later** (phase 6): PeerJS, host browser authoritative,
   same pattern as the owner's previous project DuelCrate. Not now.

## Card registry rules

- `src/cards/registry.json` is **generated** (cards AND the 32 precon decks) — never hand-edit. Rebuild via
  `npm run cards:registry`.
- `config/supported.json` (card id → true) is hand-maintained. A card may
  be flipped to supported **only** when it has (a) an effects implementation
  and (b) a passing scenario test. The pipeline reads it, never writes it.
- Deck import must validate against the registry and report unsupported
  cards to the user — never silently drop or break.

## Build plan and current status

Phases: 1 data pipeline ✅ → 2 rules kernel + headless harness ✅ →
3 effect primitives + card support **✅ COMPLETE as far as it can go
without owner decisions (2026-09-02)** → 4 debug hotseat UI ✅ **(pulled
forward 2026-08-29 by owner decision — `npm run dev` plays a game)** →
5 AI v1 + batch simulation ✅ **(2026-09-03 — `npm run simulate`)** → 6 PeerJS multiplayer → 7 deck
import (KRCG converters) → 8 remaining pool (Sabbat Paths last) → 9 ship
to GitHub Pages.

### Status in one paragraph (read this first)

**THE WHOLE V5 POOL IS IMPLEMENTED (2026-09-03). Library 444/444 (100%).
Crypt 99/217 implemented and ALL 217 playing correctly — the other 118
print a bare sect/title line and need no code. Total 543/661 (82.1%),
and the 118 are the entire difference.** Every card type is at zero
unsupported, the cut list is empty, and the blocked list is closed. Five
gates were unblocked by the owner and built in three days: **the ash heap
(2026-09-01), wraith/zombie — 14 cards (2026-09-02), token vampires — 2
cards, and the Path cards — 4 (2026-09-03)**; the crypt was then built in
seven waves (`docs/crypt-wave-1.md` … `-7.md`) the same day. Every
reusable-mechanic gate is closed. **Green baseline: 155 test files, 1583
tests, `npm run typecheck` and `vite build` clean.**

**Phase 5 (AI v1 + batch simulation) is DONE.** There is no card work
left in the pool at all: the next builds are **phase 6 (PeerJS
multiplayer)** and **AI v2 (a search agent)**. The queue is at the end of
the card-wave notes below.

**A note for whoever picks this up: the playtest decks still use only
ability-free vampires.** `validateDecks().inertAbilities` now passes for
99 crypt cards, so the decks in `config/playtest-decks.json` can be
rebuilt with real ability vampires whenever the owner wants — that is a
play-balance decision, not a card-support one.

**The last wave taught the most expensive lesson in the file, so read it
before trusting any blocker here.** The Path cards were written up on
2026-09-03 as *permanently unbuildable*: six cards filter on a Path, no
card grants one, and the masters that would are legacy — so the set of
Path-following vampires looked permanently empty, and three cards were
cut pending a decision to widen the pool. **All of that was wrong, and it
was wrong because the question was wrong.** "Which card puts a vampire on
a Path?" has the answer "none", which is true and misleading. **A Path is
a PRINTED CRYPT TRAIT**, like clan, sect and title — KRCG carries it in a
`path` field and **all 48 Sabbat V5 vampires already in the pool have
one** (12 per Path, four Paths). The real blocker was that
`scripts/build-registry.mts` silently dropped the field, so the data
existed in the snapshot and nowhere the engine could see it. **The scope
lock never needed breaking**, and widening to all 4,149 KRCG cards would
not have helped — the full legacy pool contains no Path-granting card
either. *A deferral is a claim about the code as it was; a blocker is a
claim about the data as you read it.* Both go stale, and this one went
stale in under 24 hours (docs/path-cards-design.md §0).

**Phase 4 was pulled forward deliberately, before finishing phase 3.**
Reason on record: 226 library cards is a long time to build with only unit
tests as validation, and the fuzz harness structurally finds *crashes*,
not *wrong outcomes*. It paid for itself immediately — see the `idSeq` bug
below.

**Debug hotseat UI — `src/ui/` (`docs/debug-ui-design.md`).** Vanilla TS +
DOM, no new dependencies; the screen is a pure function of
`(GameState, DecisionPoint)` and fully re-renders each step. It does
**not** implement `Agent`: `Agent.decide()` is synchronous and a human
cannot be, so the UI drives the engine as a **pull loop** (`decision()` →
click → `choose(id)` → re-render) — making `Agent` async would ripple
`await` through the whole engine for nothing. Agent-backed seats step
automatically in the same loop, which is how phase 5's AI seats plug in.
**Hidden information is MASKED by default** (changed 2026-08-29 after the
first play session — hotseat players share a screen). `redactFor(state,
seat)` in engine/agent.ts is THE masking rule and `viewFor` is defined in
terms of it, so there is exactly one set of rules to get right;
`LocalTransport.view()` masks to the deciding seat, and a card the viewer
may not see renders as a **card back**. A **Show all hidden cards** switch
(in ⚙ Settings) restores the omniscient debug view and reveals the
frame-stack panel. Per-seat mats carry every zone the physical table
has (ready / torpor / uncontrolled / cards in play / crypt / library /
hand / pool / VP / edge), plus a combat strip that appears only while a
`CombatFrame` is on the stack, a **frame-stack panel** (the sequencing
debugger — every hard bug in this engine has been a sequencing bug), and a
filterable event log. **The hand is the interface: card plays are NOT buttons.** A hand card
with a legal play is lit, lifts on hover and is clickable and draggable —
a click ALWAYS opens the chooser, one play or five (see the click-is-not-a-commitment rule below); dragging
lights only that card’s legal targets. Pure indexing over the option list
(`playsByCard`); the engine did not change, because option ids already
carry their card instance and target. Option buttons still carry the raw
option id in their tooltip, so a live game converts straight into a
`runTrace` regression test. **Layout (2026-08-30): the action bar is at the
BOTTOM, directly under the hand** — top to bottom it is a slim header (turn
readout + undo/save/load/restart + ⚙ Settings), the table, your hand, the
action bar. `.hand` must NOT be a scroll container: the play chooser grows
upward out of it and would be clipped; the cap lives on `.decision`.
**Dragging a hand card means two things, told apart by where it lands** —
onto a minion or mat it plays, onto another hand card it **sorts your
hand**, so every card is draggable whether playable or not. The order is
`DebugApp.handOrder` (per seat, card ids) and **never reaches the command
log** — a cosmetic preference must not become something undo rewinds;
`orderHand()` reconciles it against the real hand each render (gone cards
drop out, fresh draws land at the end). **The log is English** — `src/ui/narrate.ts`
turns each `GameEvent` into a sentence, resolving ids to names against the
same redacted state, so it cannot leak; unnarrated events fall through to
a readable last resort rather than vanishing. **Undo / save / load are all one operation — a replay of
`commandLog`** — not a snapshot stack; that is principle 2 paying out.
Decks live in `config/playtest-decks.json`, validated against the registry
*and* `supported.json`, refusing to start on a bad name rather than
dropping it. `tests/ui/playtest-decks.test.ts` is the headless proof.
**The decks are a MID-GAME snapshot, so they must PAY for it (fixed
2026-08-30, owner-spotted):** every seat started at a full 30 pool while
already holding two ready vampires — a position no sequence of legal
plays could reach, and one that quietly distorts every pool-economy card.
Influence moves counters one-for-one from pool onto an uncontrolled
vampire and they become its blood on taking control (p. 35, p. 36), so
the bill is **one pool per point of capacity for every ready vampire plus
one per counter on an uncontrolled one** (crypt vampires are free — never
influenced). Alice 15, Bob 18, Carol 18. `poolSpent()` +
`validateDecks().poolMismatches` report it (non-fatal: a scenario may want
an odd pool) and two tests pin it.

**A locked card makes room for itself (fixed 2026-08-30, owner-spotted).**
`transform: rotate(90deg)` does NOT change the layout box, so a locked card
kept reserving an upright card's space and its long side overhung its
neighbours. Every scan is now sized through `--cw`/`--ch` custom properties
and `.scanwrap.locked` transposes the reserved box with
`margin: calc((var(--cw) - var(--ch))/2) calc((var(--ch) - var(--cw))/2)` —
exact, derived, and correct for every size class including any added later.
(The old hand-tuned `margin: 21px -21px` had its two axes swapped, which is
precisely what caused the overlap.) `tests/ui/locked-layout.test.ts` pins
the structure: a literal margin, or a size class with a fixed
`width`/`height` instead of the variables, fails it.

**How to Play — `src/ui/rules.ts` + the `❔ How to Play` header button.**
A modal (the settings dialog's chrome, reused) of collapsible `<details>`
sections summarising the V5 rules, each with the rulebook page it came from
so a reader can check the source and an editor can tell a summary from an
invention. It reads no game state and touches no transport. The two rules
players most often mistake for client bugs are called out in flagged
`.rulenote` boxes: **stealth/intercept "only when needed"** (p. 26) and
**the Golden Rule** (p. 16). Which sections are expanded lives in
`DebugApp.helpOpenSections`, not the DOM — an agent or auto-passing seat can
step while the panel is open, and a repaint would otherwise collapse
whatever the player was reading. The panel also carries the **Dark Pack and
KRCG attribution**, which the UI had nowhere else.

**Real cards, real scans.** Every card renders as its official KRCG scan
from the `image` URL the phase-1 pipeline already recorded (same source
and permission as the card data). Blood pips, capacity and counters are
laid *over* the card and a **locked card is rotated 90°**, as on a real
table; hovering opens a full-size magnifier with the rules text. The card
name is rendered *behind* every scan, so an offline session or a 404
degrades to a readable text tile instead of empty boxes.

**`src/ui/cardinfo.ts` is a partial crypt importer — phase 7 should build
on it.** Deck vampires are **real V5 crypt cards by KRCG id**; name,
capacity, clan, disciplines, sect, title and scan come from the registry.
Two gotchas it found, both of which phase 7 inherits: the registry stores
crypt disciplines **capitalised** (`"Dom"`) where the engine and every
card spec use `"dom"`; and sect/title parse cleanly off the card-text
prefix (`"Camarilla Prince of Melbourne:"`, `"Sabbat bishop:"`), with
every V5 title mapping onto `VampireTitle`.

**Crypt ABILITIES remain unimplemented (0/217), and the decks are built to
keep that honest:** all three use only the **118 crypt cards whose ability
text is empty** (a bare sect/title line), so nothing on the table silently
does nothing. `validateDecks` returns `inertAbilities` for any vampire
with real card text, a test asserts it is empty, and the app logs a
warning rather than failing.

**THE TRANSPORT SEAM — `src/ui/transport.ts` (built 2026-08-29,
`docs/cockatrice-lessons.md` §2.1). The UI must never touch the engine
again.** `GameTransport` is `decision()` / `view()` / `choose(id): Promise`
/ `onChanged(cb)` / `history`. `LocalTransport` is the engine in this
browser and serves hotseat, agent testing **and the phase-6 host
unchanged**; a peer transport swaps in with no change to `DebugApp`, which
no longer imports the engine at all. Four rules baked in, all of which
exist to make the network case a non-event: **`choose()` is async** even
though a local answer is immediate (and the option buttons disable while a
submission is in flight — over a network a second click answers a stale
decision); **`view()` is a snapshot to render, not a handle to reach
into** (local returns raw `GameState`, the deliberately omniscient debug
view; a peer gets the masked view the host sent); **agents are stepped by
the authority, not the UI** (`runAgents()` is in the transport, so only
human seats ever surface); and **`history` is a nullable privilege** — a
peer cannot unilaterally rewind a shared game, so it reports `null` and
the UI omits the control group. `tests/ui/transport.test.ts` pins the
contract a peer transport must also satisfy.

**`PlayerView` completed 2026-08-29 — and it corrected a rules assumption.**
`viewFor` was missing cards in play entirely. Fixing it forced the question
of which zones are public, and the rulebook contradicted the obvious guess:
the **uncontrolled region is dealt FACE DOWN** and only its owner may look
at it (p. 14, "deal the top four crypt cards face down into your
uncontrolled region … you can look at the cards in your hand and in your
uncontrolled region"); a vampire turns **face up only when it moves to the
ready region** (p. 36). So `viewFor` now carries `permanents` (face up,
public), `uncontrolled` with `card: null` for other seats **but `counters`
always visible** (counters sit on top of a face-down card in the real
game), and `cryptCount`. Own library is a count too — you may not read your
own deck. `tests/engine/player-view.test.ts` pins each zone with its
citation. **Still unmodelled and required before phase 6 ships:** "who has
looked at this card" — an effect that reveals a hand or library top means
that player keeps knowing those cards, which structural masking cannot
express. **This became REAL on 2026-09-02 with Revelations** (101627), the
first card in the pool that reveals hidden information: its basic mode's
look is modelled correctly *at the moment it happens* (the prey's hand
appears only in a ChoiceFrame addressed to the actor; the log records only
the discard), but the actor's lasting MEMORY of the cards they did not
take is not in `PlayerView`. A hotseat human simply remembers; a phase-5
AI seat will not. See docs/last-buildable-design.md §2 and the
partial-support ledger.

**Bug found by the UI, fixed 2026-08-29 — `freshId` was module-global.**
`let nextId = 0` lived outside `GameState`, so a second engine in the same
process (exactly what undo does) kept numbering from the previous game:
a replay produced `action-17` where the original had `action-1`. That
contradicted the guarantee written on `commandLog` itself. The counter is
now `GameState.idSeq` (optional — existing fixtures untouched) and
`freshId` is a method. It matters beyond undo: phase 5 runs many games per
process, phase 6 compares host and client state. **Neither the fuzz
harness nor any card test could have caught it** — both play one game per
process. It took a feature that runs two engines at once.

**Engine — `src/engine/` (design AGREED in `docs/impulse-design.md`,
rulebook-verified, §10 holds citations).** Implemented and green: frame
stack + universal impulse cycle; action states A/B/C; as-played cancel
windows; wakes; full turn rotation (unlock/master/minion/influence/
discard); bleed, hunt, leave-torpor, action cards (cost at resolution,
burn, once-per-turn named limit); influence (transfers, crypt,
uncontrolled, influence-out); combat (7 steps, hand/card/weapon strikes
incl. ranged, combat-ends, dodge, additional strikes (extra sub-rounds,
one limited source/round — docs/dodge-additional-strikes-design.md),
aggravated damage (no-mend→torpor, burns wounded — docs/strike-effects-design.md),
fixed-damage & steal-blood strikes, maneuvers, presses with continue/cancel
credits, prevention, combat-scoped strength, .44 maneuver-commitment
ruling); masters (MPA, trifles, pool costs, out-of-turn, cancel-as-played);
permanents (seat + attached cards-in-play, statics for hand size/
transfers/intercept, lock-to-use abilities, "During X do Y" phase
latches, equip action); library draws incl. delayed replacement; Edge;
ousting/VPs; ScriptedAgent/PassAgent + masked PlayerView; allies +
retainers (docs/allies-retainers-design.md — recruit/employ actions,
life counters in the `blood` field with `kind` discriminant, ally card
text as self-attached entries, life-depletion burn sweep + MinionBurned
cascade, retainer combat output, per-combat presses, any-Methuselah
unlock-ability window, impulse rewind on in-play ability use); rush
actions (docs/rush-actions-design.md — minion-targeted actions with
derived directedness, combat on success without locking the target,
actions granted by cards in play with the p. 20 per-copy per-turn
limit, "during that combat" maneuver/press rider credits); political
actions + referendums (docs/politics-design.md — political action
(undirected +1 stealth, one per vampire per turn, terms chosen only on
success), referendum frame (terms → polling → tally, ties fail), vote
sources: titled ready vampires via `MinionState.title`, Edge burn, the
calling card, one burned political card per Methuselah; pool-burn/
allocation/uncontrolled-move effects); diablerie + blood hunt
(docs/diablerie-design.md — built-in diablerise and rescue-from-torpor
actions (directed/undirected by the torpor vampire's controller, rescue's
2-blood split fixed at announcement), the indivisible diablerie
resolution (blood→diablerist, victim burned; equipment-take + older-victim
Discipline + Red List deferred), the automatic blood-hunt referendum
(`ReferendumFrame` variant "bloodHunt": no terms/caller-vote, burns the
diablerist on a pass), and the leave-torpor blocked-by-vampire diablerie
opportunity); clan/sect tagging (docs/clan-sect-design.md —
`MinionState.clan`/`sect` set by fixtures now, crypt-import in phase 7;
`Requires an Anarch/…` gating via a shared `meetsRequirements`
(title/sect/clan/capacity); clan/sect-locked stealth/intercept locations
via a generic `permanent.lockGrant` overlay on the master compiler);
votes granted by cards during polling (docs/polling-votes-design.md —
`referendum.polling` accepts card plays, `modifyVotes` action
modifiers/reactions gated by caller-vs-reactor, dual-use
`modifierOrReaction` cardType, per-seat `voteGrants` cast as a source,
`lockGrant: "votes"` locations, and `{ all: [...] }` dual-discipline
requirements).

**Cards — `src/cards/effects/`:** `spec.ts` (CardSpec data vocabulary),
`compile.ts` (spec→handler compiler; per-card-type law lives here),
`cards.ts` (all specs + bespoke handlers: Sudden Reversal, The Barrens,
Blood Doll, Vessel, .44 Magnum, Double Deuce, 47th Street Royals,
Homunculus, Freakish Conglomeration, War Ghoul, Parity Shift,
Banishment, the `titleGrant` factory (Malkavian/Toreador Justicar,
Cardinal Benediction), Dummy Corporation). Design + primitive tables:
`docs/card-primitives.md`.

**Reusable-mechanic gates 1–8 all IMPLEMENTED** (see
`docs/remaining-mechanics-roadmap.md` and each gate's design doc): (1)
combat strike effects, (2) equipment/weapons, (3) block restrictions, (4)
on-vampire statics, (5) politics follow-ups, (6) ballots/vote restrictions,
(7) frenzy, (8) card-counters *infrastructure*. Every kernel-touching gate
is closed, and **so is the one-off sweep those gates opened onto** (it was
tracked in `docs/one-off-sweep.md`) — as of 2026-09-02 the only library
cards left are owner-blocked. **Everything from here to the end of this
section is the HISTORY of that sweep, wave by wave**, kept because each
entry records the readings taken and the traps found; a new session does
not need to read it linearly, but should read the specific entry for
whatever mechanic it is about to touch. Landed, in order: 13 generic
hunting grounds (one
`permanent.huntingGround` mechanic; `usedHuntingGroundThisTurn`); Aire of
Elation + Protection Racket (a `modifyBleed/Intercept` conditional `bonus`
primitive); the intercept-reaction cluster (The Warrens, Eyes of Argus,
Spirit's Touch — `actionDirectedAtYou` + `blockerCombatRider`); the
**unlock-and-attempt-to-block cluster — 14 cards, COMPLETE**
(docs/unlock-and-block-design.md: Sense the Savage Way, Sentry Signal,
Second Tradition: Domain, Eagle's Sight, Guard Dogs, Rat's Warning, One
With the Land, My Enemy's Enemy, Dogged Pursuit, Cats' Guidance, Forced
Vigilance, Eyes of the Wild, Organized Resistance, Melange —
`ActionFrame.pendingAutoBlock`/`startAutoBlock`, `interceptBurnGrants`,
`blockPenalties`, `CombatFrame.fromBlock`).

**Counter-card sweep — the first 11 (later COMPLETED, see "COUNTER-CARD
LEDGER COMPLETE" below).** Done: Dreams of the Sphinx, Powerbase: Madrid,
Under Siege, Alamut, Dead Pool, Constant Revolution, Smiling Jack,
Wasserschloss Anif, The Platinum Protocol, Enchanting Gaze, Revelation of
the Serpent. Reusable pieces this sweep built: `PermanentInPlay.counters`
(Gate 8); `putInPlayOnSuccess` action-entry + `putsInPlayOnSuccess` hook;
`ActionFrame.usedInPlayAbilities` (once-per-action ability limit);
`onBleedSuccess` / `onCombatLeave` / `onAnyUnlock` event hooks; the
**per-owner corruption-counter subsystem** (`MinionState.corruption`
keyed by seat + `CorruptionChanged` + `addCorruption`/`removeCorruption`,
with a placer (Platinum Protocol), a block-canceller
(`BlockAttemptFrame.forceFail` + `corruptFailBlock`, Enchanting Gaze), and
an unlocker (`ActionFrame.corruptionUnlocks`, Revelation)). Decision on
record (**Powerbase precedent**): an opponent's "burn this card as a Ⓓ
action" counter-play is a noted deviation, not a new
directed-action-at-a-card system.

**Granted actions — NEW GATE, design in `docs/granted-actions-design.md`
(owner decided §6 on 2026-08-02).** A pool survey found **48** unsupported
cards of the shape "\<who\> can \<do Y\> as a \[+N stealth\] \[Ⓓ\]
action" — the largest remaining family. **Built and green:** the whole
kernel — `announceEntryAction` generalized (arbitrary effect via
`ActionFrame.grantedEffect` → the `resolveGrantedAction` hook; action
stealth; `grantedCost` paid at resolution; no-target/undirected grants),
`ActionFrame.targetPermanent` so an action can target a card in play
(directed at its controller, who alone may block), cross-seat enumeration
of every seat's cards in play, and the p. 20 limit fixed to
`PermanentInPlay.grantedActionUses: { minion, key }[]` (per minion, per
action, per copy — the old boolean spent a card for everyone). The
"Minions can burn this card as a Ⓓ action" clause (~25 cards) now
compiles generically from `permanent.vulnerableTo` — **this reverses the
Powerbase deviation by owner decision**. Cards: **Pit of Contemplation**
(102291, two granted actions on one card), **Creeping Sabotage** (102213),
**Army of Rats** (100093).
**Control vs ownership + control change — IMPLEMENTED, both tiers**
(`docs/control-change-design.md`, rulebook p. 16 Control/Ownership and
p. 43 ousting quoted there). `MinionState.owner` and `.cost`,
`PermanentInPlay.controller`/`.owner`, the `ControlChanged` event and
`changeMinionControl`/`changePermanentControl` ops; control of a minion is
still "which seat's `minions` array holds it", and everything on it
travels. Three pre-existing bugs fixed with it: an ousted Methuselah's
**permanents** stayed in play (p. 43 says every card they control is
removed); "their owner's uncontrolled region" read `controller`; and
`controllerOfEntry` inferred an attached card's controller from its
bearer, which p. 16 says is wrong for a **master** on another
Methuselah's minion (a recorded `controller` now wins). Cards:
**Powerbase: Montreal** (101439, `vulnerableTo.outcome: "steal"`) and
**Cave of Apples** (100311, a granted Ⓓ action that targets a minion
*without* entering combat, then steals it at the corruption threshold).

**Auras (statics radiated onto other minions) — IMPLEMENTED.**
`PermanentAura` on a card in play + `auraBonus` in derived.ts: `scope:
"controller"` ("Gangrel **you control** get +1 strength") or `"global"`
("Assamites get +1 stealth when bleeding" — any controller), filtered by
clan/sect, currently carrying `strength` and `bleedStealth`. Any further
"\<clan\> get +N \<thing\>" card = one field on that type plus one line
where the value is derived. Also landed: `permanent.attachAnyMinion`
(a master put on **any** Methuselah's minion, controlled by the player who
played it, p. 16) and a persistent `cannotBlock` static. Cards: **Gangrel
Revel** (100807), **The Khabar: Community** (101042), **Pentex™
Subversion** (101384).

**Choice frames — IMPLEMENTED** (`docs/choice-frames-design.md`): "the
card stops and asks one Methuselah a question", the generalization of the
one-off `DiablerieOfferFrame`. `ChoiceFrame` (seat, card, key, params,
optional) + `choiceOptions`/`applyChoice` handler hooks + `raiseChoice`;
answered immediately by the one seat with **no impulse cycle** (nobody
responds to which vampire you picked); an empty option list pops
harmlessly. **Hazard to remember:** a choice raised inside `resolveAction`
would be popped by the action's own `pop()` and hang the settle loop, so
`raiseChoice` queues while an action resolves and flushes afterwards.
Supporting pieces: `onControlChanged` and `onDiscard` hooks,
`PermanentInPlay.chosen`, `drawCards`, discard-without-replacement, and
**`TurnFrame.discardActionsLeft`** — "in your discard phase you receive by
default one discard phase action" (p. 37) was unmodeled. Cards: **The
Rack** (101536), **Fragment of the Book of Nod** (100785), **Powerbase:
Los Angeles** (101435). Two deviations retired: Cave of Apples' and Dead
Pool's optional riders are real choices now, not auto-taken.

**Burn-family remainder — 3 of 5 landed:** **Brujah Debate** (100260 — a
global `aura` plus "during each Methuselah's master phase, that Methuselah
locks one of the oldest Brujah they control": new `onMasterPhase` hook,
automatic when the oldest is unique and a ChoiceFrame when several tie),
**Mob Connections** (101229 — `grantCombatPressTo`, a press credit from a
card in play), **Powerbase: Munich** (102301 — an Oblivion-filtered blood
mover; its "Ⓓ action that costs 1 blood" is the first granted-action cost
actually exercised). Also new: `aura.maneuverPerCombat`.

**Burn family COMPLETE** with **Toreador Grand Ball** (101989) and
**Aranthebes, The Immortal** (100079). Mechanisms built for them, all
reusable: **"does not unlock as normal" in both shapes** —
`PermanentInPlay.preventsUnlock` (persistent) and
`MinionState.skipNextUnlock` (one-shot, consumed by the next unlock
sweep, which **retired On the Qui Vive's ally-rider deviation** —
Stolen Police Cruiser wants the same field); `PermanentInPlay.unblockable`
("non-bleed actions cannot be blocked"); aura extensions
`requiresUnlocked` / `maxCapacity` / `bleedAgainstController` ("vampires
with capacity 4 or less get −1 bleed against you", resolved on the bleed
*target's* cards in play); and `vulnerableTo.outcome:
"shuffleIntoLibrary"` (leaves play into its owner's library, shuffled).

**Granted-rush sub-family — COMPLETE (5 cards,
`docs/granted-rush-design.md`).** "\<who\> can enter combat with
\<target\> as a \[+N stealth\] Ⓓ action" from a card in play, where the
actor may belong to a Methuselah who does **not** control the card:
**Haven Uncovered** (100897), **Regent** (101587), **Saulot's Avenging
Fist** (102257), **Frontal Assault** (100794), **Priority Contract**
(101487). One spec clause (`permanent.rushGrant`: actor scope
bearer/chosen/controller/any × target scope bearer/prey/any, plus
`stealthByTarget` for "+1 stealth if that vampire is Tremere") does the
whole family; no sequencing change. Also built, all reusable:
`permanent.attach` (the general "put this card on \<a minion\>"
targeting, superseding `attachClan`/`attachAnyMinion` for new cards),
`permanent.exclusiveKey` ("a vampire can have only one archetype"),
`permanent.grantsTitle` + the **`TitleLost` event** (nothing ever cleared
a title when its card left play — a pre-existing gap that also hit the
three referendum title-granters), `moveAttachment` + `PermanentMoved`
(the first equipment-move-shaped op, though diablerie's equipment-take
still needs its own rules pass), and a **merge of granted-action
providers** so one card can grant several (`vulnerableTo` + `rushGrant`
on Haven Uncovered), dispatched by the verb segment in the option id.
Three additive hooks: **`onLeaveReady`** (a minion burned or sent to
torpor, fired *before* the event so "is about to leave the ready region"
works), **`onInfluencePhase`** (the `onMasterPhase` mirror), and
**`onDiablerie`** (fired inside `commitDiablerie` before the blood hunt
is pushed — exactly Regent's "before the blood hunt is called").

**Cost sources — counters that pay a card's cost
(`docs/cost-sources-design.md`).** **Ravnos Carnival** (101553) and
**Ravnos Cache** (101552). `PermanentCostSource` is denormalized onto the
card in play like `statics`/`aura` (`pays: blood|pool`, `for:
action|equipment`, `clan`, `locks`, `burnWhenEmpty`), so neither the
option enumeration nor the kernel needs a registry lookup. **The split is
chosen at announcement** — `paymentSplits` widens the affordability gates
in `compileActionCard`/`compileEquipment` and emits one play option per
affordable way of paying (`payFrom: "<cardId>/<blood>/<pool>"` in the
params, so it lands in the option id) — and **paid at resolution**
(`ActionFrame.costFromCards` → `spendCostCounters`), so a blocked action
spends no counters and does not lock the Cache.

**FUZZ HARNESS BUG FIXED (2026-08-29) — read this before trusting a
"green" fuzz run.** Each seat's library was built as `for (k = 0; k < 15;
k++) deckNames[k % deckNames.length]`, so only the **first 15** of the 174
names in the fuzz deck list ever entered a game: every card appended to
that list since the early sweeps was never actually played. The decks now
use the whole list, and doing so immediately broke two invariants, both
fixed with regressions in `tests/engine/fuzz-regressions.test.ts`: (1) the
modifier compiler skipped `modifyVotes` modes outside
`referendum.polling` but not `restrictVotes`, so Closed Session/Private
Audience were offered as plain action modifiers and threw on resolve; (2)
a **mandatory** ChoiceFrame with no legal answer (The Rack asking a
Methuselah with no ready vampire) was never popped, so the engine offered
a decision with zero options — `settle` now pops it.

**Counter sinks — "instead of X as normal, burn a counter from this card"
(`docs/counter-sinks-design.md`).** **Visit from the Capuchin** (102126),
**Touch of Oblivion** (102283) and **Weighted Walking Stick** (102169).
`PermanentCounterSink` (`instead: "replacement" | "unlock"`,
`burnWhenEmpty`) is denormalized onto the card in play; the two
interception points are `drawToReplace` — which now takes a `kind:
"replace" | "extra"` so a hand-size draw-up is **not** a replacement —
and the unlock sweep, which spends a counter only when unlocking is what
would otherwise happen. Also built: `statics.handSizePerCounter` (a hand
size that moves with the counters), the strike effects
`strikeAttachToVictim` (a strike that puts the played card on the victim,
p. 16 controller) and `strikeIncapacitate` ("send the opposing vampire to
torpor or burn the opposing ally"), `attachSelfWeapon` (a combat card
that becomes equipment on its own player), and `Strike.depletesCard` —
counters spent at *infliction*, which is what "even if prevented" means.

**Three more latent crashes fixed (found by the fixed fuzz decks).** Touch
of Oblivion is the first effect that removes a combatant *during* strike
resolution, and three places assumed both combatants (or a blocker)
outlive the frame: `retainerDamage`, the combat-card option enumeration
(the End of Round step still runs after a combat "ends immediately",
p. 30/p. 32), and `currentIntercept` for a blocker that left play. All
three are now total. Two more followed (Week of Nightmares: a block
attempt whose blocker had left play tried to lock a minion that was
gone — the block now simply fails; and the lockGrant stealth/intercept
branches reading a burned actor or blocker). **The pattern to remember: a minion can leave play
at any point in combat, so read combatants with `findMinion`, not
`getMinion`.**

**COUNTER-CARD LEDGER COMPLETE** with the last three
(`docs/bespoke-economies-design.md`): **Wall Street Night** (102142),
**Carver's Meat Packing** (100303), **Week of Nightmares** (102166).
New pieces, all reusable:

- **`MinionState.counters: Record<string, number>`** — named counters on a
  minion belonging to *nobody* ("hostage", "nightmare"), unlike
  `corruption`, which is keyed by the seat that placed it. The hostage
  restriction ("cannot be moved to the ready region or be diablerized")
  is asked at the kernel's leave-torpor / rescue / diablerise option
  sites via `heldHostage`.
- **`CardHandler.abilityAnySeat`** — `abilityOptionsFor(seat)` only ever
  scanned that seat's **own** cards in play, so "during any unlock phase,
  ANY ready vampire can…" was inexpressible. It now scans every seat's
  cards, but **only for handlers that opt in**: the first attempt without
  the opt-in offered every Methuselah "discard a card from Alice's hand"
  (The Barrens enumerates from `owner.seat`), which crashed *and* leaked
  hidden information. An ability belongs to its controller unless the
  card says otherwise.
- **`onLeavePlay`** (fired from `burnPermanent` before the burn),
  `aura.bleed`, `aura.cannotHunt` (an aura that takes an action away),
  and `lockGrant.undirectedOnly`.
- **GAME-WIDE UNIQUENESS, and it needs no new state:** the event log is
  the record of everything ever played, so "only one X can be played in a
  game" is `eventLog.some(ev => ev.type === "CardPlayed" && ev.name ===
  …)`. Stricter than "in play" — a second copy stays unplayable after the
  first burns. **This retires the deferral that was blocking Open War.**

Wall Street Night's second clause targets **investment cards, of which
the V5 pool contains none** (it is the only card that mentions them), so
it is written against an `"investment"` tag and correctly enumerates
nothing today.

**Dual-purpose modifier/combat cards
(`docs/modifier-or-combat-design.md`).** `cardType: "modifierOrCombat"`:
the spec is **split by mode** (a mode is a combat mode iff
`combatWindowFor` gives it a window) and each half handed to the compiler
that already owns its law, so options come from both and a play resolves
through the half owning its mode. Five cards, **no new effect
primitives**: Swallowed by the Night (101913), Rapid Change (101542),
Swift Cover (102342), Resist Earth's Grasp (101610), Form of the Cobra
(102224 — plus the `evenIfNotNeeded` mode rule, which overrides p. 26's
"only when needed" stealth gate). Two were deferred from that family and
**both are now DONE**: **Hide the Mind** (the discipline-filtered wave —
it needed the handler to expose a pending card's disciplines, and that
query unlocked the rest of the family exactly as predicted) and
**Obedient Flesh** (the actor-riders wave, which is where `prevent:credit`
came from).

## Where the card build stands

Count the **library** separately from the crypt — the crypt is phase 7's
importer and nothing there can be supported yet:

- **Library: 444/444 (100%)**
- **Crypt: 99/217 (45.6%)** — plus 118 whose printed text is a bare sect/title line, so **ALL 217 play correctly** (docs/crypt-wave-7.md)
- Total: 543/661 (82.1%)

**THE LIBRARY IS COMPLETE.** Every library card type is at ZERO
unsupported: Master, Retainer, Combat, Equipment, Political Action,
Action, Ally, Reaction, Action Modifier, Action Modifier/Reaction
(dual-typed cards count under each type). Re-run the tally with `node -e`
over `src/cards/registry.json` (`kind === "crypt"` splits them).

**There is no next card wave.** Phase 5 (AI v1 + batch simulation) is the
next build; the remaining card work is the crypt, which is phase 7.

**OWNER RULE, 2026-09-01, binding: if a card cannot easily be got working
in full, it goes on the partial or the cut list — never quietly skipped.**
"I don't want to miss a card." So every card that is *touched* during a
wave ends in exactly one of three states: supported and whole; supported
with a `// PARTIAL:` marker and a ledger row naming the missing clause; or
unsupported with a cut-list row naming the blocker. The ledger test
enforces both list halves, so a card cannot fall between them.

**A card marked supported may still have a hole in it, and there is now
ONE place that records which: `docs/partial-support.md`.** Every card
shipped under the Wall Street Night standard (a card is honestly supported
when its clauses work, not when every word is modelled) with a printed
clause the engine does not implement. The file exists because the danger
is never the deferral, it is FORGETTING it — Terror Frenzy's superior sat
unbuilt behind a "deferred" note for a whole gate, invisible to
`supported.test.ts` and structurally invisible to the fuzz, and surfaced
only when somebody read the note. Its own spec comment still said
"deferred" a month after it was implemented, which is the same rot one
layer down. `tests/cards/partial-support.test.ts` pins the ledger in both
directions: every card it names must actually be supported (a stale row
fails), and every `// PARTIAL: <card> — <clause>` marker in `cards.ts`
must have a row (a deferral cannot be written into a comment and
forgotten). **Add the marker and the row in the same change as the
card.**

**"That block attempt fails" cluster (`docs/fail-block-design.md`).** The
acting minion breaking a block already underway — the mechanic Enchanting
Gaze bought with a corruption counter, now available plainly:
`failBlockAttempt` (with an optional extra `bloodCost`),
`modifyBlockerIntercept` ("the blocking minion gets −1 intercept", the
mirror of `modifyIntercept`, gated by the mirror of p. 26's
only-when-needed rule), and the `onlyAsAnnounced` usability rule (read as
"state A, no attempt underway" — modifiers are never offered during the
announce cycle). Cards: Elder Impersonation (100617), Relentlessness
(102337), Forced Confessional (102250), Stygian Shroud (102282),
Dominant Personality (102316). Still out of that cluster: Fever Pitch
(attaches, fails a block later), Faceless Night (failed blockers get
locked), Mirror Walk. (Hedonism was the fourth and is now DONE — it
turned out to belong to the other-vampire gate below, not here.)

**The block tax (`docs/block-tax-design.md`).** One step earlier than the
fail-block cluster: whether a block may be attempted at all, and what the
attempt costs. `ActionFrame.blockCosts` is a **list** of
`{ amount, payWith: "blood" | "bloodOrLife", exemptDiscipline }`, summed
per minion by `blockTollFor` in derived.ts, which returns `null` for a
minion that cannot pay — and a minion that cannot pay cannot attempt.
Allies hold life, not blood (p. 22), so a toll printed as "1 blood" locks
them out and "1 blood or life" does not; Where the Veil Thins' parenthetical
"(allies cannot burn blood)" is that general rule spelled out, and
`payWith` is the whole distinction. Three sites had to agree: enumeration
(`blockOptions` drops the minion and labels the rest), `declareBlock` (the
toll is paid to **attempt**, not to succeed), and `startAutoBlock` (a
forced block is still an attempt, so the unlock-and-block cluster pays it
too). Also new: `ActionInterceptModified`, one event covering **every**
minion of an action ("minions get −1 intercept" — so a minion that starts
attempting later is covered, unlike `modifyBlockerIntercept`, which aims
at the current blocker); `ActionFrame.noUnlock` ("during this action,
minions cannot unlock" — gates `unlockMinion` + `unlockAndAttemptBlock` in
`effectsLegal`, taking the whole 14-card unlock-and-block cluster off the
table); and `blockRestriction.chosenScope: "locked"`. Cards: Where the
Veil Thins (102285), Seeds of Terror (102338), Unthinkable Humiliation
(102346), The Sleeping Mind (101805), Daring the Dawn (100492).

**Damage outside combat — the resolution path is now shared.** Daring the
Dawn is the first card that damages a minion with no combat frame in
sight. The mend/torpor/aggravated logic (p. 31, p. 34) that lived inline
in combat's `damageResolution` step is now `applyResolvedDamage(pd)`,
called from there and from action resolution via
`ActionFrame.afterResolutionDamage`. "Unpreventable" needs no modelling —
prevention lives in combat's damage window and there is none here;
"environmental" is `source: null`, as retainer damage already was. Rutor's
Hand and Aemilius want the same path.

**Actor-side combat riders (`docs/actor-riders-design.md`) — the mirror of
`blockerCombatRiders`, now IMPLEMENTED.** "If this vampire is BLOCKED, the
*acting* minion gets X in the resulting combat":
`ActionFrame.actorCombatRider` (prevent/strength/maneuver/press/
handStrikesAggravated), applied to the `acting` side three lines from
where the blocker rider is applied to `opposing` — the same mechanic from
both ends of a block. Also new: **`CombatFrame.preventCredits` + the
`prevent:credit` built-in** ("can prevent 1 damage during the resulting
combat" is a CREDIT spent later, not `preventDamage`, which applies now);
**`CombatFrame.strengthBonusRound`** ("THIS ROUND, +1 strength" — reset
beside `handStrikesAggravated`, unlike combat-long `strengthBonus`); and
the **`combatCredits`** primitive. **Rule worth remembering: if a mode
seems to span several combat windows, it is granting credits, not
acting** — Obedient Flesh superior would otherwise have needed
beforeRange + range + damageResolution at once, and `prevent` would have
thrown. Cards: Beast Meld (100146), Invigorate (102251), Obedient Flesh
(102255).

**Bug fixed with it — "Requires a …" was UNENFORCED on modifiers and
reactions.** `meetsRequirements` was called in the action, master, ally and
polling-step branches but **not** in the main action-modifier/reaction
option loop, so ten cards ignored their requirement line: Invigorate,
Protection Racket, The Warrens, Sense the Savage Way, Second Tradition:
Domain, Eyes of the Wild, Ominous Chorus, Party Out Of Bounds, Protected
District. One line fixed it and **no existing test broke** — it was never
asserted. **The fuzz structurally cannot catch this class of bug:** it
plays whatever it is offered, so a too-permissive option list looks
exactly like a correct one. Negative-space assertions are the only guard.

**DERIVED TRAITS — capacity and Disciplines are no longer stored values
(`docs/derived-traits-design.md`).** `capacityOf(m)` and
`disciplinesOf(m)` in derived.ts; `MinionState.capacity`/`.disciplines`
stay the PRINTED values (the UI and deck importer want those), but every
rules read goes through the functions — the `BloodGained` clamp, the
influence-phase "counters ≥ capacity", entering-play blood, and every
`younger`/`minCapacity`/`maxCapacity` test in the compiler. Cards: the six
**Discipline masters** (Celerity/Dominate/Obfuscate/Potence/Protean/
Oblivion), one factory, one printed text. No `exclusiveKey` — a vampire
may hold two different Discipline cards and even two of the same one
(none → basic → superior); `attach.notSuperiorDiscipline` is what stops a
third.

**Capacity can now FALL, which nothing had ever done.**
`settle()` runs `drainOverCapacity()` beside `burnDepleted()`: a vampire
above its derived capacity burns the excess. p. 11 covers only the other
direction ("if an effect PUTS more blood on them than their capacity
allows"), so this is a recorded reading: the invariant holds whenever it
becomes false, whichever side moved. It immediately caught two test
fixtures building an impossible vampire (blood 4, capacity 3).

**The fuzz caught my own incomplete refactor, twice** — the per-step blood
invariant still read `m.capacity` after I had fixed only the end-of-game
one. Counterpart to the last wave lesson: the fuzz **cannot** see a
too-permissive option list, but it is excellent at a violated numeric
invariant. Use both kinds of guard.

**Lock-to-grant locations — COMPLETE, 5 cards
(`docs/lock-grant-locations-design.md`).** Channel 10 (100327), KRCG News
Radio (101067), Kumpania (101068), The Anarch Free Press (100052), The
Black Throne (100172). Four new knobs on the existing `lockGrant`, all
reusable: **`minCapacity`** (reads `capacityOf`, so a granted +1 capacity
counts); **`notFirstMinionAction`** ("not usable during the first action
in a minion phase") backed by **`TurnFrame.minionActionsThisPhase`**,
incremented in `applyToFrames` on `ActionAnnounced` rather than at the
three announce sites, so a fourth cannot forget it — a blocked or
cancelled action still counts, and an action outside the minion phase does
not; **`otherMethuselah: { poolCost }`** (a second option off the same
lock, helping a blocker you do NOT control); and **`requiresControlledSect`
/ `requiresControlledClan`** — "Requires a ready Anarch" on a Master is a
condition on the Methuselah, the sibling of `requiresControlledTitle`,
which turns Black Forest Base, Carfax Abbey, Papillon, Piper and Yawp
Court into data. Also new: the **`onHuntSuccess`** hook (the exact mirror
of `onBleedSuccess`, fired from the hunt branch a blocked hunt never
reaches). The Black Throne's contract clause needed no new pieces at all —
the `contract` tag, `PermanentInPlay.chosen` and `onLeaveReady` already
existed; note that a contracted minion's departure raises **two** choice
frames (Priority Contract's own cash-out and the Black Throne's payout).

**Bug found and fixed with it — "Assamite" is not a clan the engine
knows.** Ten V5 library cards and two crypt cards still PRINT the legacy
names *Assamite* and *Follower of Set*, but `MinionState.clan` only ever
holds a registry name (**Banu Haqim**, **Ministry**) because that is where
the phase-7 importer reads it. Every card translated it correctly except
**Priority Contract**, which filtered `clan === "Assamite"` and so would
have matched no imported vampire — marked supported, with a test that
passed only because the fixture hand-set the legacy name. Same shape as
the `meetsRequirements` bug: a too-narrow filter, asserted by nothing,
**structurally invisible to the fuzz** (an option list that is empty for
the wrong reason looks exactly like one empty for the right reason).
Guarded now by `tests/cards/clan-vocabulary.test.ts`, which scans the card
sources for clan literals and checks each against the registry.

**Fuzz invariant bug fixed at the same time (test harness, not engine).**
Blood conservation folded the event log against a SINGLE capacity ceiling,
`max(printed, current)` — but capacity *moves*: a Discipline master raises
its bearer's capacity while in play and lowers it when it leaves, so every
gain before or after that card was mis-clamped. The ceiling is now folded
alongside the blood, tracking `capacityBonus` through
`PermanentEnteredPlay`/`Moved`/`Burned`, with an added assertion that the
folded capacity equals `capacityOf` at the end. It surfaced only because
adding cards to the fuzz deck list reshuffles every seeded game — the same
way the deck-list fix surfaced three latent crashes.

**Archetypes — 4 of 6 landed (`docs/archetypes-design.md`).** Dabbler
(100485), Monster (101242), Perfectionist (101388), Rebel (101564). One
skeleton (`permanent.attach` + `exclusiveKey: "archetype"`, both already
built for Saulot's Avenging Fist) and four different once-per-turn
triggers. New: **`PermanentInPlay.usedThisTurn`** (optional; cleared on
`TurnBegan` beside `grantedActionUses`, and set when the benefit is TAKEN,
so declining an optional offer does not spend the turn) plus three
additive hooks — **`onActionResolved`**, **`onCombatEnded`**,
**`onBlockDeclared`**.

**Dabbler and Perfectionist needed NO new engine state**, which is the
reusable lesson: `ActionFrame.played` already records every card played by
a minion during an action (it exists for the p. 10 once-per-action limit)
and the specs live in the same module — so "which Disciplines did this
vampire use" and "was any reaction played" are lookups, not kernel
bookkeeping. Rulings on record: `{ all: [...] }` contributes ALL its
Disciplines, an "any one of" list contributes exactly one (preferring an
uncounted Discipline the vampire actually has); Perfectionist's "no
reaction cards" is unqualified, so it reads every seat's plays. **Rebel is
the one that is NOT a choice** — "gains", not "can gain", so it fires from
the hook with nothing asked.

**Two sequencing traps this wave hit, both worth remembering:** (1) a hook
fired BEFORE a frame's own `pop()` has its ChoiceFrame eaten by that pop —
`notifyCombatEnded` had to move *after* the pop or the combat never ended
(an infinite loop that ran the heap out, not a failure the fuzz would have
diagnosed); the captured frame object still reads fine once off the stack.
(2) **`BlockDeclared` is emitted from TWO sites** — `declareBlock` and
`startAutoBlock` — and a forced block is still a block, so both fire the
hook; wiring only one made Rebel silently never trigger.

**Deferred from the cluster:** Saulot's Guiding Wisdom (102258) is now
DONE (abstain gate + outside-the-combat gate). Saulot's Healing Touch
(102259) still wants an action-cost modifier from a card in play and a
minion-targeted heal; the 'ally starting-life cap' it was also waiting on
turned out to need no new state — an ally's capacity already holds it.

**Dawn Operation (100501) — DONE (`docs/dawn-operation-design.md`).** One
card, not a cluster: a pool survey found no other V5 card with either half.
Two mechanisms, both reusable. (1) **`CombatFrame.allDamageAggravated`** —
combat-scoped, BOTH sides, EVERY damage source, which is what makes it
unlike `handStrikesAggravated` (per side, per round, hand strikes only).
The important part is not the flag but that it forced **one damage
chokepoint**: `pushPendingDamage()` is now the only place damage enters
`cf.pendingDamage` (strikes, retainer output and `combatRoundDamage`
statics all route through it), where there were two push sites before —
two chances for the next damage source to miss the rule. Gated on
`kind === "vampire"`, because the card says "on vampires". (2) **Cancelling
a block attempt is NOT failing it.** `failBlockAttempt`/`forceFail` writes
`cannotBlock`; a withdrawal must not, because p. 25 makes only *declining
further attempts* final — so `BlockAttemptFrame.cancelled` is its own flag,
checked ahead of `forceFail`, and neither locks the blocker nor spends
their right to try again. Two design calls worth remembering: the offer is
a **built-in option in the blocking seat's existing impulse**
(`cancelblock:<blocker>`, beside `burn:intercept:`), **not a ChoiceFrame** —
that seat is already being asked, so a frame would interrupt a decision it
was about to get anyway; and `mayCancel` lives on the *attempt*, so a
re-attempt is a new frame with no offer and the loop cannot happen. New
event **`BlockAttemptCancelled`** rather than reusing `BlockFailed`: the
log is English, and withdrawing is not failing. Reading on record: **the
block toll is not refunded** (`blockCosts` is paid to attempt, not to
succeed). The acting minion is deliberately **not** spared — "all damage
inflicted on vampires" is symmetric, and Fortitude can afford it.

**"Played by a vampire other than the acting minion" — GATE CLOSED, 3 of 4
(`docs/other-vampire-modifiers-design.md`).** p. 12: "some action modifier
cards are played by minions **other than the acting minion**. Only minions
controlled by the **same Methuselah** can play those cards" — so this is
NOT a reaction; `ctx.seat !== af.actingSeat` still returns early. Two
usable rules, because the cards differ: **`byOtherVampire`** ("a ready
vampire", locked is fine) and **`byOtherUnlockedVampire`**. The shape that
made it work is the one `byLockedMinion` already used for mixed-mode
reactions: **widen the candidate list if ANY mode wants it, then gate per
mode** — Cloak the Gathering carries the rule on its superior mode alone,
so one card offers the acting minion the inferior and another vampire the
superior, in the same window. **No new plumbing for "who played it": the
option id already carries the minion.** Cards: **Cloak the Gathering**
(100362), **Veil the Legions** (102097), **Hedonism** (102328).

Built with them, all reusable: **`ActionFrame.queuedCombats`** — a combat
between two minions **neither of which is the acting minion**, entered
after the action pops (Hedonism; same shape as `afterResolutionDamage`, and
flushed where a political action pushes its referendum). Participants are
re-checked at flush, since either can leave play in between.
**`SeatState.stealthCharges`** — a bank of +1-stealth charges spent one per
action the seat announces, applied in `applyToFrames` on `ActionAnnounced`
(the same single chokepoint `minionActionsThisPhase` uses) by emitting a
real `StealthModified`, so `currentStealth` stays a pure fold with no
special case. **A variable cost**: "burn X blood" emits one option per
affordable X (`x=N` in the option id), the `paymentSplits` shape.
**`oncePerAction`** (one copy per action across EVERY minion — stricter
than the per-minion p. 10 limit) and **`oncePerTurnAtSuperior`**
(`SeatState.superiorPlaysThisTurn`).

**What did NOT need building, and is the lesson:** `modifyStealth` is
**action-scoped** — `currentStealth(state, actionId)` folds the events for
the action, never asking who played them. So "the acting minion gets +1
stealth", played by somebody else, is the *same primitive*. Only the
question of who may play it moved.

**Deferred: Gifts From Hereafter** (102325) — its whole text is conditioned
on the acting minion being a **wraith or zombie ally**, which is on the
BLOCKED list. The Wall Street Night precedent does not apply: that card had
a second clause that works, so supporting it was honest; this one would be
a card marked supported that can never do anything.

**Test-hygiene fix found by this wave:** `tests/ui/playtest-decks.test.ts`
hard-coded **Hedonism** as its example of an unimplemented card, so
implementing it broke an unrelated test. The example is now **derived** from
the registry (first unsupported library card), which cannot rot. Worth
copying anywhere else a test names a card for what it is *not*.

**THE ABSTAIN GATE — CLOSED, all 5 (`docs/abstain-gate-design.md`).**
Everything the politics kernel did was **additive** — enumerate a source,
cast, append to `ReferendumFrame.votes`, fold to tally — and each of these
cards breaks one of those assumptions. Four distinct mechanics:

- **Abstain** (`ReferendumFrame.abstaining`) is TWO things and both are
  needed: retroactive (votes already in the array with that `source` are
  removed — the tally is a fold, so removal IS the cancellation) and
  prospective (barred from casting again). It is **not** `usedSources`,
  which means "spent" — a vampire who never voted has nothing spent.
  **Votes and ballots need no separate handling**: both key on the casting
  vampire's id, so cancelling by source takes both.
- **Cancelling a referendum ≠ failing one.** Cancelled: never resolves, no
  `ReferendumResolved`, no `applyReferendum`, calling card returned.
  Failed (`forcedFail`): resolves normally with `passed: false`, which
  still burns a title-granting card (p. 27). Two flags, deliberately.
- **`ReferendumFrame.postTally`** — the first effect to outlive the tally,
  applied after `ReferendumResolved` and **whatever the outcome** ("once
  results are tallied", not "if it passes").
- **`MinionState.expelledThisTurn`** — read inside **`canReact`**, which
  already gates BOTH reaction enumeration and `blockOptions`, so two of
  Expulsion's three verbs come free; the third is in the vote enumeration.
  It does NOT stop them acting (`canAct` is separate; the card doesn't say
  so). New op `failAction()` reuses the `step = "blocked"` path the
  diablerie offer already had.

Cards: **Scalpel Tongue** (101686), **Telepathic Vote Counting** (101951),
**Scorn of Adonis** (101692), **Expulsion** (102276), **Yoruba Shrine**
(102201 — and it PRINTS "Assamite", so it filters **Banu Haqim**; the
Priority Contract trap, now with a test that asserts the legacy name
matches nothing).

**BUG FOUND BY THE FUZZ — and it was the THIRD instance of one class.**
Scalpel Tongue is `modifierOrReaction`, so the ordinary action-window loop
offered it with no target and it threw. The same bug had already happened
with `modifyVotes` and then `restrictVotes`: a polling-only effect must be
enumerated by the polling branch and **skipped** by the main loop, and each
time a new one was added, one of the two sites was missed. Both sites now
read a single **`POLLING_ONLY_EFFECTS`** set in compile.ts, so a fourth
cannot drift. Regression pinned in `tests/cards/abstain-gate.test.ts`.

**Bug found while writing it:** `cancelReferendum` first called
`this.pop()` — but a card resolves while its own **cardPlay** frame is on
top, so it popped that and left the referendum to resolve normally. It now
flags `cancelled` and lets settle drop the frame, the way `forcedFail` is
honoured at the tally. **The rule: an op that targets a frame lower in the
stack must find it, never pop.**

**`supported.test.ts` earned its keep:** Scalpel Tongue costs **1 blood**
and the spec said 0. Nothing else would have caught it.

**Deferred: Saulot's Guiding Wisdom** (102258) — the abstain half is now
available, but it also needs a title **worth 2 votes that is not one of the
eleven `VampireTitle` values** (`TITLE_VOTES` is a fixed map; this wants a
title-independent `MinionState.bonusVotes`) and **"lock before range to end
a combat involving another minion you control"** — a combat-ender fired
from outside the combat by a minion not in it. Touch of Valeren (102262)
and Huldu want that same outside-the-combat shape; they belong together in
their own pass.

**OUTSIDE-THE-COMBAT GATE — CLOSED
(`docs/outside-combat-design.md`).** p. 28: "some combat cards are played
by minions **not involved in the current combat**. Minions controlled by
**ANY** Methuselah can play those cards." `beforeRange`/`beforeStrikes`/
`endOfRound` already honoured that (they cycle `cf.cycle`, which spans
every seat) — **`damageResolution` was the exception, and it is where these
cards live**: it asked exactly one seat and resolved on the first pass, so
a bystander never got an impulse. Now `CombatFrame.damageCycle`, rebuilt
per pending-damage item, victim's controller first (p. 31).

**RECORDED DEVIATION, worth owner review:** that cycle carries the victim's
seat plus only the other seats that actually **have** something to play,
where the other combat windows ask everyone unconditionally. Reason: damage
resolution runs once per damage item, several times a round, so cycling
every seat through an empty window multiplies contentless decisions.
Cycling everyone was tried first and broke **54 existing tests** purely on
added passes; option-gating broke **none** and changes no outcome for a
seat that could act. Say the word and it becomes unconditional.

**Bug I introduced and the rule it taught:** prevention can REMOVE the head
of `pendingDamage`, silently promoting the next item — and the cached cycle
was then reused for it, skipping that victim's prevention window entirely
(War Ghoul's test caught it). `damageCycleLen` records the queue length the
cycle was built for, so a changed head rebuilds. **A cached cycle must be
keyed to the thing it is about, not merely "exists".**

Also built, all reusable: **`preventDamageFor(minion, amount)`** (the
existing `preventDamage` insists the preventer IS the victim, right for a
combatant and wrong for a bystander); **`endCombatFromOutside()`** (lands
where a "strike: combat ends" lands — End of Round still runs, p. 32);
**`PermanentStatics.votes`** — votes from a CARD rather than a title, so a
vampire with no `VampireTitle` is a vote source ("a unique Independent
title worth 2 votes"; `TITLE_VOTES` is a fixed map over eleven printed
titles and this is none of them); and the usable rules
**`byOutsideVampire`** / **`byOutsideUnlockedVampire`**.

Cards: **Martyr's Resilience** (101175 — the pure case; its test has a
THIRD seat, neither combatant, doing the preventing) and **Saulot's
Guiding Wisdom** (102258 — the abstain gate supplied the rest).

**Found on the way, and it retires a queued deferral:** an ally's
`capacity` field **already stores its printed starting life** ("a
reference, not a cap" — see the `AllyEnteredPlay` applier). So "not to
exceed their starting life" is `capacityOf` for vampires and allies alike,
and the "ally starting-life cap" noted against Saulot's Healing Touch needs
no new state.

**Touch of Valeren** (102262) is now DONE — see the entry below; the
"minion-targeted action cards from hand" it was deferred on turned out to
already exist. **Huldu, The Desecrator** (201757)
has exactly this shape and is a **crypt** card — phase 7; it will need no
new kernel work.

**Touch of Valeren + Saulot's Healing Touch — DONE
(`docs/minion-target-actions-design.md`), and THE QUEUE ENTRY WAS WRONG.**
It said these were blocked on "minion-targeted action cards from hand".
**That plumbing already existed**: `targetRider` + `enumerateActionTargets`
in `compileActionCard` emit one option per legal target with the choice in
the option id, fixed at announcement (p. 25) — `actionAddBloodToVampire`
(Fifth Tradition: Hospitality) had used it all along. **A deferral written
while finishing another card is a hypothesis, not a finding**; check it
before designing against it.

What was actually missing was small: three flags on that primitive
(`allies`, `self`, `capped` — "a minion" rather than "another vampire",
and "not to exceed their starting life"); **`cardType: "actionOrCombat"`**,
which is `compileModifierOrCombat` with the action compiler substituted;
and **`PermanentStatics.rescueDiscount`** — an action-cost modifier from a
card in play, read by `rescueDiscountFor` at **two** sites, and both
matter: at **enumeration** (or the discount is unreachable in exactly the
case it exists for) and at **payment**. The rescue's 2-blood split is fixed
at announcement (p. 23), so the discount reduces the actor's *share*, not a
flat cost.

**`capped` needed no new state** — an ally's `capacity` already holds its
printed starting life, so `capacityOf` is the ceiling for both kinds of
minion. A target already at starting life is not enumerated at all.

**Two engine facts the tests re-taught me:** an option id carries the mode
`variant` before its params (`play:Touch of Valeren:basic:V1:action:A1:tv1`),
and **a vampire with 0 blood MUST hunt** (p. 21), so it can never be
offered a rescue — a 0-blood actor is not a usable fixture for one.

**BLEED-RIDER SWEEP — 5 cards (`docs/bleed-riders-sweep.md`). The gate
queue is EMPTY; this is the one-off sweep proper**, and the cluster was
chosen by surveying what the remaining pool actually contains (bleed 30 /
strike 22 / press-maneuver 17 / intercept 14) rather than from a queue
entry. Cards: **Show of Force** (101772), **Propaganda** (101495), **Line
Brawl** (102229), **Entrancement** (100652), **Enthrall** (102320).

**THE BUG THIS SWEEP FOUND, and it is a general one:** an action card's
effects run in `resolveCardAction`, which fires **only on success** — so
`blockRestriction` ("titled vampires cannot block this action") and
`actorCombatRider` ("if this action is BLOCKED, …") never applied, because
both are written for the case where the action does not resolve. They are
now applied in `resolve()` at **announcement**, right after
`announceCardAction`. **Rule: an effect that shapes the block window or the
resulting combat must be registered at announcement, not at resolution.**
Every action card carrying one of those two primitives was affected; they
were simply never combined on a supported card before.

New primitives, all small: **`actionStealPool`** (with
`CardActionParams.targetSeat` — the first action card that targets a
**seat** rather than a minion, and directed because of it),
**`stealMinionOnSuccess`** (`changeMinionControl` + the existing
`targetRider` enumeration), **`cryptDrawOnBleedSuccess`** (a crypt card
drawn goes to the UNCONTROLLED region, p. 3 — `CryptCardDrawn` already
did that), and **`targetLocksOwnMinion`** (a ChoiceFrame raised to the
BLEED TARGET, not the actor). The last two are served by generic
`choiceOptions`/`applyChoice` on the action compiler, so any future spec
using them gets the choice for free.

**Recorded reading:** Show of Force says the vampire "**can** gain +N
strength" and the rider applies it unconditionally — a costless, purely
beneficial bonus is auto-taken. That runs against the direction taken
elsewhere (Cave of Apples' and Dead Pool's optional riders were made real
choices), but those had costs attached. Flagged for review.

**Left in that family, with reasons** (so the next pass need not
re-derive): **True Love's Face** (102041 — its superior lets the *blocking
minion's controller* burn 1 pool to **cancel the card as it is played**;
pay-to-cancel by an opponent is a real mechanic, not a rider); **Deep
Song** superior (inverts combat roles — "the target vampire is considered
the acting minion"); **Dominate Kine** / **Stolen Police Cruiser** ("steal
a location" / "burn a location" — the granted-action-on-a-permanent shape
that **Open War** also wants, and the natural next cluster).

**ACTIONS THAT TARGET A CARD IN PLAY — 4 cards
(`docs/permanent-target-actions-design.md`).** "Ⓓ Burn a location" / "Ⓓ
Burn an equipment" / "Ⓓ Steal a location" played **from hand**. Half the
kernel already existed: `ActionFrame.targetPermanent` and "directed at the
card's controller, who alone may block" (p. 25) were built for GRANTED
actions, and `announceCardAction` simply hard-coded
`targetPermanent: null`. So the work was one field threaded through, the
`actionOnPermanent` primitive (`what` picks the zone — locations at seat
level, equipment on minions; `outcome` burn or steal), and a target
enumerator. `controllerOfEntry` moved from private to `EngineOps`.
**Ordering that bites: Rewilding reads the controller BEFORE the burn** —
once the card is gone there is nobody to charge, and "burn 2 pool from its
controller" would silently do nothing. Cards: **Conceal** (100391),
**Rewilding** (101632), **Dominate Kine** (100573), **Open War** (101324).

**Open War closed the last long-standing deferral.** Four clauses, three of
them offered to EVERY Methuselah: game-wide uniqueness off the event log
(no new state — the Week of Nightmares precedent, and stricter than "one in
play"); an Anarch rush grant with `who.scope: "any"` so it reaches other
Methuselahs' Anarchs; a granted **location-burn** action costing 2 pool
(the first card to grant TWO different actions — the compiler's
granted-action merge dispatches on the verb segment, `:rush:` vs
`:raze:`); and a Methuselah-level master-phase counter action via
`abilityAnySeat`. **OWNER RULING (2026-08-30): the 4-counter payout goes
to the card's CONTROLLER**, not to whoever places the fourth counter — the
card names no beneficiary and the "pot" reading was put to the owner and
rejected. Implemented as `entry.controller`, so it follows the card if
control moves.

**Deferred: Stolen Police Cruiser** (101872). Its `vulnerableTo` clause is
already data and `MinionState.skipNextUnlock` is waiting for its third
clause; what blocks it is **"allies and younger vampires get −1 intercept
against this Anarch"** — a *persistent* intercept penalty keyed on the
blocker's kind and capacity, applying to every action the bearer takes.
`modifyAllIntercept` is action-scoped and the aura system has no intercept
field, so that wants a derived static of its own.

**DISCIPLINE-FILTERED EFFECTS — 5 cards
(`docs/discipline-filtered-design.md`).** The family that reasons about
what OTHER cards *require*, and the close of the Hide the Mind deferral.
`CardMode.discipline` always held that information; nothing could ask for
it. Now **`CardHandler.requiresDisciplines(mode, variant)`**, added
centrally in `compileSpec` so every spec-compiled card answers it for free
and no card author has to remember it, and **denormalized onto
`CardPlayFrame.requires`** when the frame is pushed — the same treatment
`isMaster` gets, so a cancel-as-played effect is a plain array read with
no registry lookup and no new `PlayContext` API. `CardPlayFrame.isCombat`
/ `.isReaction` landed beside it (`CardHandler.isReactionCard` from
`spec.cardType`), because a cancel effect names the *type* it may cancel.

Three consumers, all gates on **options** rather than on the op — a card
that cannot legally prevent this damage is never offered:
**`Strike.noPreventBy` → `PendingDamage.noPreventBy`** ("cannot be
prevented by cards requiring Fortitude"), checked at BOTH prevention
sites — the ordinary `combat.damageResolution` window and
`outsidePreventOptions` (Martyr's Resilience, the bystander path);
**`CombatFrame.weaponDamageNullified`** ("the opposing vampire's strikes
with weapons inflict no damage this round", reset beside
`handStrikesAggravated`, keyed on the STRIKING side and only for
`Strike.source === "weapon"` — a card-granted fixed-damage strike is not
a weapon); and the usable rule **`onlyAtCloseRange`**, the mirror of
`onlyAtLongRange`. Cards: **Blood Fury** (100201), **Blood Rage**
(100208), **Soul Burn** (101829), **Soulgrinder** (102340, whose basic
mode deliberately carries NO filter — the sharpest negative-space test in
the file), **Hide the Mind** (100921).

**Hide the Mind is bespoke, for the Sudden Reversal reason.** It is *not*
`modifierOrCombat`: that split asks which WINDOW a mode acts in, and both
its modes act in `card.asPlayed`, inside another card's as-played period.
What differs is the printed type of the card each may cancel. Bending the
split rule to fit it would have made the rule mean two things.

**RECORDED DEVIATION: prevention CREDITS are not Discipline-filtered.**
`CombatFrame.preventCredits` is a pair of counts, so a credit has
forgotten which card granted it. The only credit source in the V5 pool is
Obedient Flesh (`[dom][pro]`), and the only filters name `[for]`, so no
filter could bite today. Rather than refactor for nothing, a test
**asserts the assumption** — it fails if a future card grants a credit on
a Discipline some `noPreventBy` card names.

**Deferred: Libertas** (101100) — "cards requiring Dominate or Presence
cost other minions +1 blood". The query is available now; the *cost* half
is not. `spec.bloodCost` is read at ~15 affordability and payment sites,
so a Discipline-keyed cost modifier means one `costToPlay(spec, mode,
minion, state)` replacing every one of them. Its own gate, and the natural
companion to `PermanentStatics.rescueDiscount`.

**THE PLAY-COST GATE — CLOSED, 6 cards
(`docs/play-cost-design.md`).** A card's cost was a **constant**:
`spec.bloodCost` / `spec.poolCost`, read at ~12 affordability gates in the
compiler and 2 payment sites in the engine, with nothing able to change
it. It now goes through **`playCostFor`** in derived.ts (beside
`capacityOf` and `blockTollFor`): printed cost + every modifier in force,
**clamped at zero**.

**`PlayCostMod` is one shape with three homes** — `ActionFrame.playCostMods`
(Consign to Oblivion, Unleashing), `CombatFrame.playCostMods` (Ensnare a
Beast, Terror Frenzy), and `PermanentStatics.playCostMod` (Charisma,
Libertas), denormalized onto the entry like `statics`/`aura`/`costSource`.
Filters: `cardTypes`, `cardName`, `requiresDiscipline`, `minions`
(bearer/others), `minionId` (one named payer), `whileBearerEngaged`,
`once`. Every filter present must match; an absent one does not constrain.

**`requiresDiscipline` is last wave's query, reused verbatim** —
`CardHandler.requiresDisciplines` was built for "cannot be prevented by
cards requiring Fortitude"; Libertas asks the same question at a different
moment, so it is *data*, not machinery. `CardHandler.costTypes` was added
the same way (central in `compileSpec`, from `spec.cardType`).

**Both kinds of site had to change, and both matter** — the
`rescueDiscountFor` lesson: at **enumeration**, or a discount is
unreachable in exactly the case it exists for and a surcharge lets a
minion announce what it cannot pay; and at **payment**, or the number on
the table is a lie. Affordability moved **inside the per-mode loop** at
five sites, because a modifier can key on the Disciplines the chosen mode
requires — one mode of a card can be affordable while another is not.
**`CardPlayFrame.paid` records what was actually charged**, so a refund
returns that rather than the printed cost (a `once` modifier is already
spent by then). `once` is matched freely at enumeration and **removed only
at payment**, keeping enumeration a pure read.

Cards: **Charisma** (100332), **Libertas** (101100), **Consign to
Oblivion** (102288), **Unleashing the Bestial Soul** (102263), **Ensnare a
Beast** (102319), **Terror Frenzy superior** (101966 — below). Also built,
all reusable: **`PermanentStatics.alliesCannotBlock`** (the *persistent*
form of `ActionFrame.blockRestrictions.noAllies`, keyed on the acting
minion so it covers every action they take — the shape Stolen Police
Cruiser's deferred clause wants); **`ActionFrame.noReactionsFrom`** (read
where `canReact` gates reaction enumeration — it does NOT stop blocking,
because the card says reaction CARDS); **`ActionFrame.delayReplaceTypes`**
(the dynamic form of the handler's static `delayedReplace: "afterAction"`
— `drawAfter` already existed).

**It closed a deferral recorded in ANOTHER doc, and exposed a gap no test
could see.** `docs/frenzy-design.md` had deferred **Terror Frenzy
superior** ("combat cards cost the opposing vampire +1 blood") for want of
an opposing-cost modifier — and the card was marked **supported with only
its basic mode implemented**. Nothing asserts a mode that is not there, so
neither `supported.test.ts` nor the fuzz could have found it; only reading
the deferral did. It needed `PlayCostMod.minionId` and the usable rule
**`oncePerCombatAtSuperior`** — a per-MODE limit, since `spec.combatLimit`
is per card and would have wrongly restricted the basic mode too (it
records `<name>:<mode>` in `playedThisCombat`).

**Correction on record:** I first wrote that this gate retires the
`.44 Magnum` deviation. It does not — that one is about the bearer being
unable to USE equipment (`cf.restrict[side].equipment`), not about cost.
It stands.

**Deferred: Villein** (102121) — its third clause, "Villein costs +1 pool
to play **on this vampire**", makes the cost depend on a choice made in
the same option: it is a master with no playing minion, and "this vampire"
is its *attach target*. `playCostFor` prices a card for a **payer**;
this needs it priced for a **target**, which changes the signature
everywhere. Worth doing deliberately with the other cards that want it.
Also missing and smaller: a **seat scope** on `PlayCostMod` ("cost YOU +1
pool"), which nothing built this wave uses, so it is not built.

**ACTION-TIME LOCATIONS — 5 cards
(`docs/action-time-locations-design.md`).** Chosen by pool survey (Master
was the largest remaining family) and deliberately built as **five knobs
on the closed `lockGrant` gate rather than five bespoke handlers** —
locations that do something at a specific moment inside another minion's
action. Cards: **Creepshow Casino** (100444), **WMRH Talk Radio**
(102189), **The Rumor Mill, Tabloid Newspaper** (101662), **Club
Illusion** (100366), **Warsaw Station** (102149).

New `lockGrant` knobs, each earning its keep: **`atAnnouncement`** (the
existing stealth branch requires a live `blockAttempt`, because that is
when stealth is "needed" — these fire as the action is ANNOUNCED, read
like `onlyAsAnnounced` as state A with no attempt underway);
**`evenIfNotNeeded`** (the p. 26 override, the same named rule the *mode*
vocabulary already had for cards in hand); **`recipientCost: { blood }`**
(every previous cost on a lockGrant was paid by the location's controller
in pool — this one is paid by the RECIPIENT, in blood, which is why they
may decline); **`anyVampire`** (The Rumor Mill chooses "a vampire", any
Methuselah's, one option each); **`anyController`** (WMRH grants to "a
minion" with no "you control" and no pool cost, unlike
`otherMethuselah`); **`noLock` + `oncePerAction`** (Club Illusion never
locks — a standing permission, limited per action instead); and the new
grants **`bleed`** and **`unlockOnSuccess`**.

Two deferred riders, both on the `ActionFrame`: **`notBlockPenalties`
gained an optional `seat`** — it existed for Forced Awakening and already
ran at the right moment, but burned *blood from the minion* where WMRH
burns *pool from a Methuselah*, so one field and one branch covered it;
and **`ActionFrame.unlockOnSuccess`**, which unlike `notBlockPenalties` is
conditional on the action SUCCEEDING.

**Warsaw Station is a spec-plus-bespoke overlay** for its second clause:
"burn this card (**even if it is locked**) to move a Nosferatu in torpor
to the ready region". The parenthetical is the whole point — every other
burn-self ability in the pool is gated on the card being unlocked, and
this one exists to cash in a location you already spent. It needed no new
state: the existing `LeftTorpor` event does the move.

**Reading on record:** Club Illusion's "+1 bleed" is emitted with
`limited: false`. The card does not print "(limited)", and p. 20's rule is
about action MODIFIER cards; this is an ability of a card in play, so it
does not consume the one-limited-bonus allowance.

**CONDITIONAL STATICS — 4 cards
(`docs/conditional-statics-design.md`).** The queue said "the on-vampire
statics masters"; the survey found a **tighter and larger** cluster
crossing card types, and the mechanism won over the card type.
`PermanentStatics.stealth`/`.intercept` are unconditional — a card in play
grants them for every action, forever. Five cards want them only during
certain actions, and they are a Master, an Action and two Equipment.
Cards: **Depravity** (100526), **Guardian Angel** (100866), **Abbot**
(100006), **Unlicensed Taxicab** (102078).

**`PermanentStatics.conditional: ConditionalStatic[]`** — a LIST (one card
can carry two: Unlicensed Taxicab needs a kind-conditioned entry and a
card-type-conditioned one) of SIGNED bonuses (Codex is a −2 penalty, so a
"grant" shape would not have fitted). Conditions: `actionKinds`,
`actionCardTypes`, `directedAtController`; every one present must hold.

**`actionCardTypes` reuses the play-cost wave's `costTypes`.** "Recruit"
and "employ" are not `ActionKind`s — an ally or retainer played as an
action announces as `cardEffect` like every other action card. What tells
them apart is the printed type of the *announcing card*, which
`CardHandler.costTypes` already answers, so the engine stamps it onto
**`ActionAnnounced.cardTypes`** (optional, so existing fixtures and saved
logs are untouched) and derived.ts reads it with no registry lookup.
That is the third wave running where a query built for one family turned
the next one into data.

**`currentIntercept` had never looked up the action.** It folded the
blocker's own attachments and the event log and nothing else — which was
fine until "+1 intercept during actions **directed at their controller**"
made the action itself part of the question. `currentStealth` already read
the `ActionAnnounced` event, so only one of the two needed opening up.

Also built: **`PermanentStatics.cannotPlayCardTypes`** (Depravity's "cannot
recruit allies or employ retainers" — the mirror of a conditional bonus,
off the same `costTypes` answer); **`CombatFrame.usedThisCombat`** (War
Ghoul's prevention recharges every ROUND, Guardian Angel's once per
COMBAT, so `preventDamageAbility` took a `scope`); **`attachSelf.unlockActor`**
(Abbot's "put this card on this Sabbat vampire **and unlock them**" — a
real effect, since the actor locked at announcement, p. 25); and
**`permanent.extraEquipStealth`** (Unlicensed Taxicab's equip action is
"+1 **additional**" on top of the equip action's own +1, p. 20).

**Deferred: Codex of the Edenic Groundskeepers** (100374) — its −2 stealth
during bleeds is one line of data, but its other clause is a granted
**bleed** action, and `announceEntryAction` hard-codes
`actionKind: "cardEffect"`. A granted bleed needs that generalized plus
the p. 20 once-per-turn bleed bookkeeping (`bledThisTurn`) — the same
shape of change `announceCardAction` needed for `targetPermanent`. Worth
doing deliberately.

**GRANTED BLEEDS + TARGET-PRICED COSTS — 3 cards
(`docs/granted-bleed-and-target-costs-design.md`).** Queue items 1 and 2,
paired because **both were kernel HARD-CODES, not missing mechanisms**,
and neither is a wave alone. Cards: **Codex of the Edenic
Groundskeepers** (100374), **Villein** (102121), **Secure Haven**
(101711).

**`announceEntryAction` hard-coded `actionKind: "cardEffect"`** — right
for every granted action built so far (rushes, burn-this-card, counter
actions), wrong for "this vampire can BLEED as a Ⓓ action". It now takes
`args.actionKind`, defaulting to the old value; when it is `"bleed"`, the
p. 23 branch `announceCardAction` already had applies (one bleed per
minion per turn, prey as default target, directed). **Both announce paths
now share that reading instead of one of them owning it.**
`permanent.bleedGrant` is the spec clause, merged into the granted-action
providers and dispatched on the `:bleed:` verb segment.

**`playCostFor` priced a card only for its PAYER.** Two cards price it for
the card's **target**: Secure Haven ("master cards targeting this minion
cost 1 additional pool" — a toll on other people's cards) and Villein
("Villein costs +1 pool to play **on this vampire**"). So `PlayCostMod`
gained **`onTarget`**, a different question from `minions`
(bearer/others), which asks who pays — both can hold at once. Villein also
finally used **`controllerOnly`**, the seat scope noted as missing when
the play-cost gate was built and deliberately left unbuilt then because
nothing needed it.

**The `target` param is OVERLOADED, and that had to be handled, not
renamed.** The chosen attach target already rides in `params.target` — but
so does Deflection's target, which is a **seat**. Renaming would have
broken every existing option id and trace test, so the engine resolves it
through `findMinion`, which is total and answers null for a seat id: a
card that targets a seat prices exactly as it always did.

Also built: **`PermanentStatics.untargetableByOthers`** (Secure Haven's
"cannot be the target of other Methuselahs' actions", asked wherever an
action picks a *minion* target — rush targets, diablerie, rescue; a bleed
targets a **seat**, so a haven does not stop bleeds, which falls out of
the model rather than needing a rule) and **`permanent.bloodToPool`**
(Villein's "move 2 to 5 blood", the `x=N` shape, one option per
(vampire, amount) pair).

**Reading on record:** Codex's "+3 bleed if the target Methuselah controls
no ready unlocked minions" is evaluated **at announcement** — that is when
the target is fixed (p. 25) and where every other bleed modifier lands, so
it is an ordinary `BleedAmountModified` folding into `currentBleed` with
no special case. Re-checking at resolution would make it the only bleed
bonus that is not a fold over events. Emitted `limited: false`: not
printed "(limited)", and p. 20's rule is about action modifier CARDS.

**AFTER COMBAT ENDS — 4 cards
(`docs/after-combat-ends-design.md`).** "**Strike: combat ends**" *plus a
rider that happens once the combat is over* — the engine had nowhere to
put such a rider, since `strikeCombatEnds` set a flag and the frame
popped. **`CombatFrame.afterCombatEnds`** is a list applied where
`notifyCombatEnded` already runs, i.e. **after the pop** — the archetypes
lesson (a hook fired before a frame's own `pop()` has any ChoiceFrame it
raises eaten by that pop). The captured frame still reads fine, which is
also how "if the range is close" gets the range **as combat ended**.
Cards: **Catatonic Fear** (100307), **Pass Through Shadow** (102279),
**Form of Mist** (100771), **Rolling with the Punches** (101649).

**Form of Mist needed a ruling, and the card text settled it.** "After
combat ends, if this vampire was blocked, they can burn 1 blood to
continue the action with +1 stealth **as if unblocked, even if stealth is
not yet needed**." A blocked action sits at `step: "blocked"` and settle
resolves it as a failure; continuing it means choosing which state it
returns to. **Reading on record: state A, where blocks may still be
declared** — the +1 stealth clause is only worth anything while somebody
may still block, so returning to state C would make half the card text
dead letter. **Flagged for owner review** — a reading, not a citation.
`oncePerActionAtSuperior` came with it (the per-action sibling of
`oncePerCombatAtSuperior`), and `ActionFrame.played` now records the
`mode` so a per-action limit can be scoped to one mode.

**Round-scoped prevention:** `CombatFrame.preventAllFrom`, checked at the
`pushPendingDamage` chokepoint so it catches retainer output and
`combatRoundDamage` statics too — and, because the card is played in the
damage-resolution window *after* the strike is already queued, it also
clears what is already on the table. That second half was a real bug the
first test caught.

**BUG FOUND AND FIXED — `preventAll` modes were never enumerated.** The
damage-resolution branch looked only for a `prevent` effect, so
**Touch of Valeren's basic COMBAT mode was unreachable** on a card marked
supported. Same class as Terror Frenzy superior: nothing asserts a mode
that is not there, and the fuzz cannot see a *missing* option. Found only
by reading the branch while adding a third prevention shape to it.
Regression pinned in `tests/cards/after-combat-ends.test.ts`.

**PLAYING A CARD FROM HAND OUTSIDE ITS OWN ACTION — 5 cards
(`docs/play-from-hand-design.md`).** The queue's named "mid-combat
equip/employ from hand" cluster, plus two the survey added that are the
same mechanic elsewhere in the turn. Every one of them prints
"**(requirements and cost apply as normal)**", which is the whole design
brief. Cards: **Angel's Gift** (102349), **Contraband** (102352), **Pack
Alpha** (101342), **Piper** (101401), **Biothaumaturgic Experiment**
(100162).

Equipment, retainers and allies all reached play down ONE path, and its
last step — `enterPermanentFromAction(af)` — read everything off the
`ActionFrame`. It is now **`enterPermanent({card, handler, mode, seat,
bearer, cost})`**, keyed on the card rather than the frame, with the
action path as a one-line caller; `EngineOps.playCardFromHand` is the
other caller. **Reading on record: the cost is paid immediately and
unconditionally** — an equip action defers cost to resolution because a
blocked action never resolves (p. 27), and here there is no action to
block (Piper says so in as many words). `CardPlayed` IS emitted: the card
is played (p. 9), and the event log is what every game-wide uniqueness
check reads.

**`PlayContext.registry` is the one thing denormalization could not
answer.** Everything a card knows about *itself* is stamped onto its
frame or entry; "which cards in my hand are melee weapons, and what do
they cost" is a question about a **different** card, and the hand holds
only `{id, name}`. The price comes from a `PricedCard` built out of
**`costTypes`** and **`requiresDisciplines`** — the queries built for the
play-cost and discipline-filtered waves — which is the fourth wave running
where an existing query turned the next family into data. New alongside
them: **`CardHandler.modesPlayableBy(minion, ignoreRequirements)`** and
**`isUnique`**, both answered centrally in `compileSpec`.

Also built: **`CombatFrame.closeManeuvers`** (round-scoped, usable only at
long range — it carries both restrictions because the one card granting it
does; spent before an ordinary credit, being the use-it-or-lose-it one);
**`PermanentStatics.maneuverPerCombat`** (the aura had it, an attached
card did not — granted at `pushCombat` beside `pressPerCombat`);
`burnAttachedToAttach` (the first cost paid in a card already in play);
and `attachSelf.target: "ownMinion"` + `maneuverPerCombat`.

**Reading on record: `canAct` is NOT checked.** It gates taking an
ACTION, and none of this family is one — three of the five are played
mid-combat, where the bearer is necessarily locked. Everything else the
ordinary equip/employ/recruit enumerator checks is checked, by calling the
same helper.

**THREE PRE-EXISTING BUGS FOUND, all the same shape: a value nothing
asserts.**

1. **`compileActionCard` never copied `poolCost` onto the handler**, so an
   action card with a pool cost was *gated* on the pool at enumeration
   (which reads the spec) and *charged nothing* at resolution (which reads
   the handler). **Aranthebes, The Immortal has been free to play.** Fixed
   in all three compilers that omitted it; `supported.test.ts` now
   cross-checks **handler cost against spec cost**, which is the only
   guard — the fuzz cannot see a cost that is never taken, and the
   registry agreed with the spec. That new check immediately found
   **Under Siege**, whose spec said 0 pool where the card prints 1.
2. **A hand-rolled handler answers none of the central queries**, and
   silently: `costTypes` undefined means a play-cost modifier keyed on
   "master cards" (Secure Haven) **skipped Blood Doll and Vessel**, and
   this wave's equip-from-hand skipped .44 Magnum.
   `backfillCentralQueries` in `buildHandlerRegistry` now supplies
   flag-derived defaults, `Hide the Mind` and `Organized Resistance` state
   their printed types, and `tests/cards/central-queries.test.ts` pins
   that every registered handler names one.
3. **Codex of the Edenic Groundskeepers' granted bleed crashed on use** —
   `permanentBleedGrant` built its option with `kind: "useAbility"`, which
   routes to `handler.useAbility`, a method a granted-action card does not
   have. **Its test asserted only that the option was OFFERED.** Found by
   the fuzz once the new deck entries reshuffled every seeded game. The
   test now takes it. *This is my own last-wave lesson landing on me: read
   each assertion back and ask what would still pass if the feature were
   absent — an offered option that cannot be used looks exactly like a
   working one.*

Known non-invariant, pre-existing and untouched: `spec.combatLimit` is
per COMBAT FRAME where the printed limit is per VAMPIRE, so two
combatants cannot each play their own copy in a round.

**ANSWERING A BLEED — 4 cards (`docs/bleed-answers-design.md`).** The two
small clusters queued last wave, built together: reactions that **redirect
a bleed** or **shrink it**. Both halves already existed as primitives
(`redirectBleed` from Deflection, a negative `modifyBleed` from Party Out
Of Bounds), so this is mostly data. Cards: **Redirection** (101578),
**Bait and Switch** (102218), **Deep Ecology** (102219), **Visions of
Zapathasura** (102265). **Reaction is now down to 2 unsupported cards.**

Three small additions: **`redirectBleed.youngerOnly`** (Redirection's two
modes differ by exactly that clause; age is `capacityOf` on both sides so
a granted point counts); **`unlockMinion.bloodCost`** ("this vampire burns
1 blood to unlock", gating the option as well as charging it, p. 9); and
**`setBleedZero`** — the `currentBleed` twin of last wave's
`setStealthZero`, working for the same reason: the amount is a fold, so
subtracting the current total IS the reduction and later increases still
land. Predicted last wave, and it landed exactly as predicted.

**Reading on record: a bleed REDUCTION is not "(limited)".** p. 20's
one-limited-bonus rule is about a bleed *bonus*; these cards only reduce,
are played by the defender, and Party Out Of Bounds already set the
precedent. Two reductions stack, and a reduction does not spend the acting
minion's allowance. Pinned by a test that plays two on one bleed.

**Note on `unlockMinion`'s timing, worth remembering:** it is gated on
state A (`af.step === "A"`, no block attempt) because every prior user
unlocks *in order to block* (Guard Dogs, Rat's Warning). Deep Ecology's
`[pro]` mode inherits that, so it is a state-A card while the same card's
other two modes are state-C cards. That is existing behaviour, not a
choice made here, but it is the kind of thing a test trace has to know.

**INTERCEPT REACTIONS AND THEIR COMBAT RIDERS — 5 cards
(`docs/blocker-riders-design.md`).** The remaining intercept reactions are
one shape — **win the block, and carry something into the combat** — so
this extends the closed `blockerCombatRiders` gate with one field each.
Cards: **Instinctive Reaction** (100995), **Precognition** (101475),
**Truth in Darkness** (102284), **Form of the Bat** (102223), **Night
Terrors** (102254).

Rider fields added: `prevent` (first round only), `noEquipment`,
`unlockForBlood`, `combatEndsStrike`; plus `actorCombatRider.noEquipment`
as the mirror. Three needed a scope the frame lacked:
**`preventCreditsFirstRound`** (spent before the combat-long pool, the
`closeManeuvers` rule); **`unlockForBlood`**, which offers an OPTION
rather than applying an effect (a built-in `unlock:blood`, the
`maneuver:credit` shape); and **`StrikeKind` gained `"combatEnds"`** —
it had been `"hand"` and nothing else, with the built-in strike option
hard-coding `HAND_STRIKE`.

**"Reduce the acting minion's stealth to 0. (They can still increase it.)"
needed no new machinery at all.** `currentStealth` is a fold over the
event log, so an ordinary `StealthModified` of minus the current total IS
the reduction, and later modifiers still add on top — which is exactly
what the parenthetical asks for. Same lesson as "+1 stealth played by
somebody else": the fold makes the special case unnecessary. Visions of
Zapathasura will want the same trick on `currentBleed`.

**A REAL GAP: a dual-typed card's MODIFIER half was unreachable.**
`compileModifierOrReaction` picks its candidate minions ONCE, before the
per-mode loop, and treated `modifierOrReaction` as a reaction outright.
Both cards that used the type (Scalpel Tongue, Ominous Chorus) are
polling-step cards handled by an earlier branch, so nothing noticed —
**Form of the Bat is the first card with a genuine action-modifier mode on
that type**, and it would never have been offered to anybody. Fixed with
the pattern this compiler already uses twice (widen the candidates if any
mode wants it, gate per mode), with **`CardMode.role`** naming which half
a mode belongs to. Same failure family as the `modifyVotes` /
`restrictVotes` / Scalpel Tongue drift: a card type enumerated in two
places, where only one place learned about a new case.

**A second gate was keyed on the card instead of the mode:** the per-mode
lock check ran `canReact(m)` for anything that is not `cardType:
"actionModifier"` — and the acting minion is ALWAYS locked, so a
dual-typed card's modifier half was ruled out every time even after the
candidate fix. It now reads the mode's role. Playing an action modifier
does not require being unlocked (p. 26, the Cloak ruling p. 48).

**THE AFTER-REFERENDUM WINDOW AND THE MARGIN — 3 cards
(`docs/referendum-margin-design.md`).** The trio deferred from the wave
below, and the two reasons are exactly what this closes: their window is
after the **referendum**, not the action, and "each vote by which the
referendum passed" was recorded nowhere. Cards: **Voter Captivation**
(102131), **Amici Noctis** (102274), **Magnetic Authority** (102331).

Same shape as `action.afterResolution`, one frame along.
`resolveReferendum` **popped first** and then announced the result, so
nothing could react to it; the tally is now written onto the frame
(`votesFor` / `votesAgainst` / `passed` / **`margin`**) and, on a pass,
`rf.step` becomes `"afterResolution"` for an impulse before the pop. Both
properties carried over deliberately: it opens **only when someone can
use it** (the `combat.damageResolution` deviation), and the step is set
**before** probing — the trap from the wave below, which would otherwise
answer "nobody" every time. One property is new: **it opens only on a
PASS**, since all three cards say so, which keeps `forcedFail` (Yoruba
Shrine) honest.

**The action frame is long gone by then** — a political action pops
before its referendum is pushed — so these cards are enumerated and
resolved on their own path, before the `ctx.action` gate that every other
modifier passes through. The caller is `rf.callingMinion`.

**Amici Noctis is an allocation whose recipients are all capped at 1**, so
a distribution is just a SUBSET of your ready Lasombra plus a pool amount
(≤ 1, or 2 if the caller is titled), together no more than the margin —
not `enumerateAllocations`, whose shape assumes uncapped recipients.
**Reading on record: "distribute" need not be exhausted** — with three
Lasombra, a pool cap of 1 and a margin of 9 there is no legal way to place
it all, so every distribution *up to* the margin is offered and the player
chooses (the same reading p. 14 takes for a search that finds nothing).

Magnetic Authority needs no margin at all — only the window, plus target
enumeration for `addUncontrolledBlood`, which existed but had only ever
been used by an action card.

**THE AFTER-ACTION-RESOLUTION WINDOW — 4 cards
(`docs/after-resolution-design.md`).** A pool survey found **13** cards
saying "only usable after (action|block) resolution" — the largest
remaining family — and the engine had nowhere to put them: an
`ActionFrame` resolved and popped in one step, with no impulse between.
Cards: **Freak Drive** (100788), **Shadow Cast** (102280), **Shadow
Cloak** (102281), **Fever Pitch** (102321).

The window sits **immediately before the pop**, so a card can still read
what the action was, who acted, whether it succeeded and who blocked.
Everything that used to happen after the pop (queued combats, a political
action's referendum, a rush's combat) moved into **`finishAction()`** and
runs when the window closes. New: `ActionStep` gains `"afterResolution"`,
`ActionFrame.resolvedSuccess`, the `action.afterResolution` window, and the
usable rules `afterResolutionByActor` / `ifActionSucceeded` /
`ifActionBlocked` / `ifActionDirected` / `ifBleedSucceeded`.

**RECORDED DEVIATION (the damage-resolution one again): the window opens
only if some seat can actually use it.** An unconditional impulse after
every action would be a decision per seat per action all game and would
rewrite every existing trace. Same call, same reason as
`combat.damageResolution`; say the word and it becomes unconditional.

**Ordering trap worth remembering:** the probe has to set
`step = "afterResolution"` **before** asking whether anyone can play, and
put it back if not — a card's own usable rule asserts it is in the window,
so asking first always answers "nobody". Every one of the 16 tests failed
on this until it was fixed.

**Freak Drive's p. 48 ruling drove two things.** *"If the vampire has been
blocked, Freak Drive is played after combat"* is automatic — a blocked
action's combat resolves before settle returns to the action — but *"you
can even play it if the vampire is in torpor, provided they have blood"*
is not: the modifier compiler looks the actor up with `getMinion` and
nothing filters on readiness, so the lookup became **`findMinion`** (the
actor can also have been burned by then) and the window's rule
deliberately does not require ready/unlocked.

**Three of the four share "attach on success, cash in later"** — the
action-MODIFIER form of `attachSelf` (`afterResolutionAttach`). Two small
pieces of state came with them: **`PermanentInPlay.againstSeat`** (Shadow
Cast's "an action directed at the SAME Methuselah", fixed when the card
attaches — without it the card would be a free +1 stealth on anything) and
**`PermanentStatics.untargetableExceptDiscipline`** (Shadow Cloak's
"minions without Auspex cannot perform actions directed at this vampire" —
`untargetableBy` gained an optional ACTOR argument, since the escape hatch
is a property of the acting minion, not their Methuselah).

**Caught by typechecking's blind spot:** `putPermanentInPlay({...,
...(cond ? { againstSeat } : {})})` compiled clean, because a **spread
bypasses excess-property checking** — the field would have been silently
dropped. It had to be threaded through the op, the event and the applier
for real.

**Deferred, with reasons:** Voter Captivation / Amici Noctis / Magnetic
Authority (their window is after the *referendum*, and all three need the
**margin** it passed by, which `ReferendumFrame` does not record — its own
small gate); Go-getter superior ("continue the action as if unblocked"
*after* it resolved would re-open a resolved action and emit a second
`ActionResolved` — Form of Mist does the same thing from before
resolution, where it is clean); Spying Mission (a different window, before
the pool is lost, plus a memory of which Methuselah); Paths in Two
Worlds / Gifts From Hereafter (wraith/zombie allies, BLOCKED).

**ENDING AN ACTION EARLY — 5 cards (`docs/end-action-design.md`).** Four
cards stop an action already underway, three of them adding the same rider
(*that minion cannot do it again this turn*); Faceless Night joins them as
the last of the fail-block family, firing at the same moment. Cards:
**Change of Target** (100323), **Mirror Walk** (101223), **Obedience**
(101309), **Delaying Tactics** (100519), **Faceless Night** (100687).

**The rulebook rules three of them by name, and the rulings drove the
code.** p. 47 (Change of Target): *"Since the action ends before the block
resolution, the blocking minion is not locked for blocking. If the
blocking minion was locked and had used a wake effect to block, they
remain locked. If the acting vampire was performing a mandatory action
(such as hunting because they had no blood), they are 'stuck'. They remain
unlocked but cannot perform any action."* p. 49: *"Contrary to Change of
Target, Mirror Walk explicitly locks the blocking minion."* p. 48
(Faceless Night): *"They become locked only once the action resolves …
Faceless Night does not lock retroactively minions who previously
attempted to block."*

**That last ruling changed the implementation.** The obvious build — fold
the event log for `BlockFailed` and lock them all — is wrong. So
`ActionFrame.lockFailedBlockers` is set when the card resolves and only
failures **from then on** are recorded, in `applyToFrames` (the one point
every `BlockFailed` passes through — the `minionActionsThisPhase` pattern,
so a fourth emit site cannot forget).

New: **`endAction()`**, which cancels the pending block attempt rather
than failing it — `BlockAttemptFrame.cancelled` (built for Dawn
Operation) is exactly p. 47's "not locked for blocking", where
`failBlockAttempt` would lock them and spend their right to retry.
**`MinionState.cannotRepeat` / `SeatState.cannotRepeat`** hold *action
keys* (the card's name for a card-announced action, the `ActionKind`
otherwise) cleared on `TurnBegan`; Delaying Tactics is the seat-scoped
one. **`delayedReplace: "discard"`** is Mirror Walk's third replacement
timing, flushed as the discard phase opens.

**The "stuck vampire" ruling is EMERGENT, not implemented.** A 0-blood
vampire must hunt (p. 21) and mandatory actions come first (p. 19), so one
barred from hunting has an outstanding mandatory action it can never take
— unlocked, with no legal action at all. The check lives in **`canAct`**,
which is action-only ("never gates blocking or reacting"), so it covers
every enumerator at once instead of each one separately. A test asserts
the ruling.

**Bug the tests caught: a cancelled attempt resets `af.step` to "A".** The
block-attempt frame outlives `endAction`, so it was putting the ended
action back into state A and the bleed resolved after all. The cancelled
path now leaves an action that has already ended alone.

**Design correction mid-build:** Delaying Tactics was first written as an
`endAction` variant, which the polling branch would never enumerate —
`POLLING_ONLY_EFFECTS` is keyed by effect kind, and `endAction` is
dual-use. It uses the **existing `cancelReferendum` primitive** (already
in that set) extended with `unlockCaller` and `barRepeat`. Note
`barRepeatAction` reads the **referendum** frame when there is no action
frame: a political action's frame has already popped by the polling step.

**THE LIBRARY-SEARCH GATE — 5 cards
(`docs/library-search-design.md`).** Until now **no card had looked at the
library at all** — an ordered array that only ever lost its top card to
`drawToReplace`, modelled in `PlayerView` as a count ("you may not read
your own deck"). Two mechanisms, one gate, because Black Market Cache
needs both: **searching**, and **an out-of-play store on a card**. Cards:
**Magic of the Smith** (101143), **Vast Wealth** (102092), **Black Market
Cache** (102351), **Shilmulo Tarot** (101767), **Fleshforge Chamber**
(102354).

**The rulebook is unusually explicit here and overrides this engine's
defaults.** p. 14 ("Search"): *"You do not have to announce the card you
are searching, and searching can result in not finding the card. If you
search your library or crypt, you must shuffle it afterwards."* And the
card-specific ruling on p. 48: *"You do not search your library until the
action is successful … you are free not to find any … you may choose not
to find anything, even though there are other equipment cards in your
library (you still shuffle the library)."* So, against the usual habits:
**the search is NOT resolved at announcement** (a ChoiceFrame at
resolution, the documented exception to p. 25's targets-at-announcement),
**"find nothing" is always legal**, and **the shuffle happens either way**.

**Hidden information: the option list IS the search.** Candidates appear
only in a ChoiceFrame addressed to the searching seat, and the **event log
records only what was taken**, never what was seen. `redactFor` gained
face-down stores — which required extending redaction to **attached**
permanents, which it had never touched (Shilmulo Tarot is equipment, so
its store sits on a minion). The phase-6 "who has looked at this card" gap
is unchanged: a searcher learns their own deck, which leaks to nobody.

New: **`PermanentInPlay.stored` / `.storedFaceUp`** (the rulebook's own
precedent for such a zone is a contested unique, "turned face down and out
of play", p. 14); events `LibraryShuffled` / `CardStored` /
`StoredCardDrawn`; ops `shuffleLibrary` / `storeCard` / `drawFromLibrary`;
the **`onEnterPlay`** hook (fired from both entry paths); and
**`EngineOps.registry`** — the resolution-time counterpart of
`PlayContext.registry`, since a search reads the type and cost of cards it
finds. `playCardFromHand` gained a `from` zone, so "play cards from this
location as if from your hand" (Fleshforge) is the play-from-hand
machinery with the pile swapped.

**Draw substitution** ("if you would draw a card from your library, you
can draw one of those cards instead") raises a ChoiceFrame **instead of
drawing**, and the answer draws. Three things keep that from being
invasive: it only fires when a live store can actually supply the draw;
`raiseChoice` already queues while an action resolves; and `applyChoice`
calls `drawFromLibrary` directly, never back through `drawToReplace`,
which would re-raise forever. The counter-sink (`instead: "replacement"`)
keeps precedence — a draw that does not happen cannot be redirected.

**BUG THE FIRST TEST CAUGHT — an optional ChoiceFrame is only right when
declining does NOTHING.** Both searches were first raised as `optional`,
whose decline is a plain `pass` — and a pass pops the frame **without
calling `applyChoice`**, skipping the mandatory shuffle. They are
non-optional now, with "Find nothing" as an ordinary answer that shuffles.

**Pre-existing bug found: `compileAlly` never exposed `permanentTags`.**
Equipment and retainers always had; allies did not, so any filter on a
printed sub-type silently skipped every ally — **War Ghoul is a ghoul**
and would never have matched Fleshforge Chamber's "a ghoul (ally or
retainer)". The same class as the others: a filter that is empty for the
wrong reason looks exactly like one empty for the right reason.

**Precedent settled: a clan tag on a MASTER is thematic, not a
requirement.** Ravnos Carnival never gated on it, and a Master has no
acting minion to gate — so Black Market Cache and Fleshforge Chamber take
no `requiresClan`, while Shilmulo Tarot (Equipment, played by a vampire)
does. Consistent with Angel's Gift.

Also new, and the reason a third choice-carrying clause cannot break the
first two: **`choiceByKey`** in `compileSpec` — independent clauses
register their ChoiceFrame hooks by `frame.key` and one dispatcher reads
the map, instead of each assigning `handler.choiceOptions` and clobbering
the last. That is the `POLLING_ONLY_EFFECTS` lesson applied before it bit.

**Deferred: Heart of Nizchetus** (100903) — pure library manipulation
(draw up to 3 without discarding, then bury the same number), no search
and no store, so not part of this gate; it wants a count choice plus N
successive bury choices, which `choiceByKey` now makes safe to add.

**RECURRING POOL DRAINS — 6 cards (`docs/pool-drain-design.md`).** The
largest coherent family left, found by surveying pool-moving cards: **a
card that sits in play and charges Methuselahs pool on a repeating
trigger, plus a printed way for the table to get rid of it.** Cards:
**Anarch Revolt** (100055), **Judgment: Camarilla Segregation** (101028),
**Augury of Doom** (102310), **War of Ages** (102348), **Fame** (100698),
**Tension in the Ranks** (101958). Mostly a DATA wave — `onAnyUnlock`,
`onLeaveReady` (which already carries `how: "burned" | "torpor"`),
`abilityAnySeat`, `vulnerableTo` and `putInPlayOnSuccess` all existed.

Four new `permanent` clauses, each field traceable to a printed line:
**`unlockDrain`** (`whose: any|prey`, `amount`, a `when` union of
`noReadySect` / `controlsNonSect` / `bearerInTorpor`, and
`perTorporVampire`), **`leaveReadyDrain`** (`how`, `bearerOnly`),
**`selfBurn`** (`onPreyOusted: {gainPool}`, `whenPreyHasNoTorpor`) and
**`masterPhaseBurn`** (`usesMasterAction`, `discardMasters`,
`burnOwnMinion`). They are wired in **`compileSpec`, not in one compiler**,
because the six cards are a Master, two Actions and a Political Action —
the mechanism crosses card types.

**`onAnyUnlock` never reached an ATTACHED card.** The unlock sweep
iterated `seat.permanents` only, which was invisible while every user was
a location and wrong the moment one sat on a vampire (Fame). It now uses
the same `allEntries()` set `onLeaveReady` does.

**New gate: a REFERENDUM as a card's removal clause.** "Vampires can call
a referendum to burn this card as a +1 stealth political action" is
`vulnerableTo.via: "politicalAction"`. The politics kernel gated its
referendum push on `af.card` — and a granted action has **no `af.card` at
all** — so **`ActionFrame.referendumSource`** is now the single thing that
gate reads, set from both paths. `announceEntryAction` gained
`political` (one per vampire per turn, p. 24) and passes **no
`targetPermanent`**: a political action is undirected, so anyone may block
it even though it aims at a specific card. Also generalized:
**`CardHandler.holdsCardForReferendum`**, which is what `isTitleGrant` was
really being used for at two engine sites ("do not burn this card at
resolution; the referendum decides") — War of Ages wants it to put itself
in PLAY on a pass (`refPutInPlay`), and since its own `vulnerableTo` later
votes the same card instance back out, **`ReferendumFrame.fromCardInPlay`**
is what lets one handler tell its own two referendums apart.

**New hook `onSeatOusted`,** fired from `processOusts` **before** the
`Ousted` event — not incidental: "your prey" is an adjacency relation and
the oust rewrites it, so that is the only moment `preyOf(controller)` still
names the seat going out. Also new: `EngineOps.spendMasterAction()`, and a
`combinations()` helper so "discard two master cards" enumerates one
option per way of paying (the `paymentSplits` shape) instead of picking
for the player.

**Readings on record:** Fame charges **every** Methuselah including its own
controller ("that Methuselah", no exemption — and it is normally played on
an opponent's vampire, so the cost is the point); Augury of Doom's
self-burn is evaluated at the same moment, and off the same board state, as
its count, since the card says both in one sentence; Judgment's clause
does **not** say "master phase action", so it does not consume one, while
Tension's does.

**Camarilla is a SECT, not a clan** — caught while writing the spec, not
after. `controlsNonSect` and `burnOwnMinion.notSect` say so; the Priority
Contract trap (a filter that matches nothing because it names the wrong
axis) was one rename away.

**`supported.test.ts`'s new handler-cost cross-check earned its keep
immediately:** it caught Judgment: Camarilla Segregation specced at 0
blood where the card prints 1.

**STUN — OWNER RULING 2026-08-31, both cards DONE
(`docs/stun-design.md`).** The word appears nowhere in the V5 rulebook and
is defined by no card in the pool; **Kiss of Cathari** (102330) and
**Mind Numb** (101211) are the only two that use it. The owner's ruling,
verbatim and binding:

> Stun: lock a minion and put a stun counter on them. A minion with one or
> more stun counters does not unlock as normal at the beginning of their
> controller's unlock phase; during that unlock phase, burn all stun
> counters they had at the beginning of the turn.

It lives in **`MinionState.counters["stun"]`** (the named-counter
subsystem built for hostage/nightmare), **not** `skipNextUnlock` — the
ruling says *counters*, plural, and that field is a boolean. One op,
`EngineOps.stun(minion)`, does lock + counter, so the two cards cannot
drift apart; `stunned(m)` in derived.ts is the sibling of `heldHostage`.

**The snapshot in clause 2 is the part to keep.** The unlock sweep reads
the count at the TOP, suppresses on non-zero, and burns *that* number —
not "whatever is there when we get to it". Cards act inside an unlock
phase ("during any Methuselah's unlock phase", Homunculus), so a stun
landing after the sweep must survive to the next turn, which is exactly
what "at the beginning of the turn" buys. A pinned test drives that case.
Two counters still cost only one unlock phase (all are burned at once),
and a counter sink ("burn a counter *instead of unlocking as normal*",
Touch of Oblivion) correctly spends nothing on a minion that was not
going to unlock — the existing `!suppressed` guard already covered it.

**Kiss of Cathari** is Catatonic Fear's shape (strike: combat ends + an
after-combat rider gated on close range), so it is one new
`AfterCombatRider` variant applied after the frame pops. Its
`["obf", "pre"]` is the existing "any one of" mode shape.

**Mind Numb closed a kernel hole.** A successful `cardEffect` action
carrying a `targetMinion` enters combat with it, and the opt-out was
written for GRANTED actions only (`af.grantedEffect === null ||
key === "enterCombat"`) — `grantedEffect` is null for every card played
from hand, so a stun would have rushed its victim.
**`ActionFrame.noCombatOnSuccess`** (from `CardActionParams.noCombat`) is
the hand-played equivalent Cave of Apples already had on the other branch.
**Reading on record: a vampire cannot stun itself** — the card says "an
unlocked vampire" without saying "another", but the actor locks at
announcement (p. 25), so it can never satisfy the card's own condition at
resolution.

**COMBAT EFFECTS THAT RECUR EVERY ROUND — 5 cards
(`docs/round-recurring-combat-design.md`).** Combat had had no dedicated
sweep since the strike-effects gate; a survey of the 20 unsupported combat
cards found the largest coherent family, and it names a real gap.
`CombatFrame` distinguished exactly two lifetimes — **whole combat,
applied once** (`strengthBonus`, `restrict`, `preventCredits`) and **this
round, reset at the boundary** (`strengthBonusRound`,
`handStrikesAggravated`, `preventAllFrom`, `closeManeuvers`) — and nothing
that is **combat-long and recurring**. All five cards are "Only usable
before range is determined" and all five install something that fires
again every round. Cards: **Bear's Skin** (100145), **Carrion Crows**
(100301), **Flesh of Marble** (100749), **Weather Control** (102164),
**Tranquility Shield** (102362).

**A prevention RATE, not a pool.** `preventPerRound` (the grant, never
reset) + `preventPerRoundUsed` (the spend, cleared each round). Spend
order is now **shortest-lived first across three buckets** —
`preventCreditsFirstRound` (gone after round 1) → the rate (gone after
this round) → `preventCredits` (lasts the combat) — the `closeManeuvers`
rule extended. One `prevent:credit` button whichever bucket pays: the
player is preventing a point, not choosing an accounting bucket. Bear's
Skin's *inferior* is the control case that proves the gap was real — it is
the existing `combatCredits`, unchanged.

**`CombatFrame.roundDamage`** is the combat-card form of the retainer
static `combatRoundDamage`, which prints the same sentence.
`escalate` + **`startRound`** keeps "increased by 1 each subsequent round"
a **pure function of the frame** (`amount + round − startRound`) rather
than a counter something has to remember to tick. `PendingDamage`
gained **`unpreventable`**, and such an item **skips the
damage-resolution window entirely**: prevention is the only thing that
window contains, so an unpreventable item's whole option list would be
"Pass" — the same reasoning as the recorded damage-resolution deviation.
Retainers are burned through `burnRetainerLife`, honest only because
`PendingDamage.minion` is a MinionId and the damage is unpreventable.

**Flesh of Marble forced one damage chokepoint at the OTHER end of the
pipe.** Its trigger is damage *successfully inflicted*, not queued — both
strikes push before either resolves — so it cannot live in
`pushPendingDamage`. **`resolveCombatDamage`** is now the single wrapper
every combat damage application goes through (bumping
`damageTakenThisRound`), the mirror of what `pushPendingDamage` did for
Dawn Operation. The check itself runs in **`drainAutoPrevented(cf)`** at
the top of the `damageResolution` settle case, which pops items needing no
decision (auto-prevented or unpreventable) so the window never opens on
one nobody can answer.

**BUG CAUGHT BY THE FIRST TEST RUN, and it is a general timing rule.**
`addRoundDamage` fired its rider immediately on install, which is right
for Weather Control (played *inside* the before-range window, so that
round has already reached the rider's moment) and **wrong for Carrion
Crows** (whose moment, strike resolution, is still ahead) — the crows hit
twice in the round they were cast. The rule: **fire on install only if the
current round has already passed the rider's own moment.**

**Tranquility Shield closes the frenzy deferral** recorded in
`docs/frenzy-design.md`. Two halves: `CombatFrame.frenzyImmune` gates
**options** (a frenzy mode is not offered when the vampire it would be
used *on* is immune), and the retroactive cancel is **provenance, not
undo** — `CardPlayFrame.isFrenzy` is denormalized beside
`isMaster`/`isCombat`/`isReaction`, and the two ops that aim a frenzy card
at the other combatant tag what they set (`CombatFrame.frenzyRestrict`,
`PlayCostMod.fromFrenzy`). Which vampire a frenzy card is used **on** is
**derived from the mode's own effects** — `frenzyTargetSide` in compile.ts
— not from a list of card names, so a new frenzy card classifies itself; a
test walks every `frenzy: true` spec so one cannot land unclassified.
**Meditative Grove (102252) asks the same question** from `card.asPlayed`
and now has the piece it was missing.

**Readings on record:** a `beforeRange` rider fires in the round it is
played (the card is played inside that window, and "each round this
combat" excludes nothing); Weather Control hits **its own player** ("both
combatants" names no exemption); Flesh of Marble counts damage **per
victim, not per source**, so one point from any source arms it for the
round; and **Rage of Apedemak stays playable against a shielded vampire**
— it buffs its own player, so it is not "used on" them. That last is a
reading, not a citation: the rulebook defines no "used on".

**RUSH ACTIONS AND WHAT HAPPENS AFTER THE COMBAT — 5 cards
(`docs/rush-outcome-design.md`).** A survey of the 27 unsupported Action
cards found the largest coherent family: **"Ⓓ Enter combat with \<X\>"**
played from hand, where the card does not merely start a fight but
attaches something to it or collects a payoff once it is over. Cards:
**Abuse of Power** (102309), **Pillars Fall** (102333), **Hunting the
Beast** (102356), **Hunter's Mark** (102228), **Make the Misere**
(101147).

**Half the kernel already existed and the work was the JOIN.**
`docs/rush-actions-design.md` built the rush (target fixed at
announcement, combat pushed in `finishAction` after the action frame pops,
`af.rushRiders` for "during that combat" credits) and
`docs/after-combat-ends-design.md` built `CombatFrame.afterCombatEnds`,
applied **after the frame pops** so a rider may raise a ChoiceFrame. What
was missing: a rider an ACTION installs on the combat it starts, read when
that combat ends. `ActionFrame.combatOutcome` carries it from announcement
to `pushCombat`, which now takes it as a sixth argument.

**One `AfterCombatRider` variant, not three.** The three "after" cards
differ in condition and payoff but are one shape, so `kind: "outcome"`
carries both halves — `when` (`oneCombatantReady` / `opposingNotReady` /
`actorReadyOpposingNot`) and `effect`
(`burnOpposingControllerPool` / `attachToActor` / `bloodToUncontrolled`).
Every survivor question goes through **`findMinion`**: a combatant burned
during the combat is the case these cards exist for, not an edge case.

**A card that may put ITSELF in play after the combat has to be held back
from the ash heap.** Pillars Fall reuses the `entered` suppression that
`holdsCardForReferendum` introduced, and then three paths must each
account for the card: the rider attaches it, the rider burns it (condition
missed, actor gone, or a duplicate), or **`finishAction` burns it when the
combat never happened at all** — a combatant can leave play between
resolution and the push, and without that branch the card would vanish
from the game.

**The optional payoffs are ChoiceFrames, not auto-takes** — the direction
the owner endorsed for Cave of Apples and Dead Pool, deliberately NOT the
Show of Force reading (still flagged for review). The difference: Show of
Force's bonus dies with the combat, while these put a permanent in play or
move blood. And the decline is **an ordinary answer, not `pass`** — the
library-search lesson, sharper here: an optional frame's decline never
calls `applyChoice`, and the held-back card would never be burned.
Hunting the Beast follows the **Brujah Debate precedent**: automatic with
one legal recipient, a ChoiceFrame with several, nothing with none.

**`multiDiscipline` — the ADDITIVE mode shape.** Three cards print "More
than one Discipline can be used to play this card" (The Platinum Protocol,
Make the Misere, Break the Bonds). Modes are normally **exclusive**; these
are **additive**, which is why the first one was hand-rolled.
`CardSpec.multiDiscipline` collapses the printed clauses into **one
synthetic combined mode** built from the actor's Disciplines
(`combinedMode` in compile.ts), so enumeration and resolution keep the
paths they already have and the option carries no mode segment to choose —
offering one would offer a lie. **`resolveCardAction` had to learn the
same trick**: `modeOf` finds only the first printed clause, which is
exactly the trap Break the Bonds (whose riders fire on bleed success)
would have fallen into. Also new: a standalone **`rushRiders` primitive**,
because a combined mode must not hold two `actionEnterCombat` effects —
two rushes would mean two targets. Both spellings write into one
accumulator, so they cannot drift.

**Deliberately NOT done: retiring The Platinum Protocol's bespoke
handler.** It is supported and green; rewriting a working card onto the
new flag is a separate, checkable change. **Break the Bonds** (102247) is
the remaining card of that shape and is the next Action wave's cheapest
entry.

Also built: `RushRiders` widened with `strength` and
**`CombatFrame.noCombatEndsFirstRound`** — "the opposing minion cannot
strike: combat ends during the first round", the combat-scoped sibling of
`PermanentStatics.opposingCannotCombatEnds`, checked in the same
`combat.chooseStrike` branch **and** against the built-in granted
combat-ends strike, so both routes to that strike are barred.

**Readings on record:** Abuse of Power fires when **either** combatant is
the last one standing ("only one combatant is ready" names no exception),
and the pool always comes from the other combatant's controller; a rush's
outcome rider belongs to the rush's **own** combat, not to the combat a
blocker forces ("that combat" is the one the card announced) — the same
reading `rushRiders` already took.

**Note for the next Master wave:** a **"city title" is exactly prince,
baron or archbishop**, and that is *derived*, not guessed — the rulebook
says those three are "associated with a particular city" (p. 39–40) and
the V5 crypt confirms it: only those three print "of \<city\>", while
primogen, bishop, cardinal and priscus never do. Papillon ("requires a
ready vampire with a city title") needs it.

**HUNTING GROUNDS AND THE OTHER BLOOD LOCATIONS — 5 cards
(`docs/blood-locations-design.md`).** The tightest cluster in the Master
family, and it finishes one already built: **13 generic hunting grounds
were supported off a single `permanent.huntingGround` mechanic**, and the
three that were not each add exactly one twist. Two more locations join
them because they answer the same question — how blood reaches a vampire —
from different windows. Cards: **Carfax Abbey** (100297), **Papillon**
(101350), **Meditative Grove** (102252), **Cappadocian Crypt** (102298),
**The Hungry Coyote** (100945).

**A "CITY TITLE" IS DERIVED, NOT GUESSED — `CITY_TITLES` in state.ts is
prince, baron, archbishop.** The rulebook says those three are "associated
with a particular city" (p. 39–40) and that every other title it names is
not unique and cannot be contested; the V5 crypt agrees, printing
"⟨title⟩ of ⟨city⟩" for exactly those three and never for primogen,
bishop, cardinal or priscus. A test **re-derives the list from the
registry**, so the constant cannot rot the way the "Assamite" clan filter
did. Papillon needs it.

`huntingGround` gained `sect`, `title` (`"any"` | `"city"`) and
**`extraIfControlsTitle`**. That last broke the existing gate: one hunting
ground was one use per turn, enforced by the BOOLEAN
`PermanentInPlay.usedThisPhase`, and Carfax Abbey allows two. New
**`PermanentInPlay.phaseUses`** counts, reset beside `usedThisPhase`,
which is deliberately left a boolean — every other latch in the engine
means exactly one. **The per-vampire limit needed no work at all:**
`usedHuntingGroundThisTurn` already forces the second grant to a different
vampire, which is exactly what "another ready Anarch" says.

**The hunt amount was a literal `1`.** `huntAmountFor(state, minion)` in
derived.ts is that literal plus a new `aura.hunt`, the positive sibling of
the `aura.cannotHunt` Week of Nightmares added — so "+1 hunt" is a TRAIT
of the minion (it applies to every hunt they make), not a property of the
action.

**Cappadocian Crypt reuses two queries and needed a third.**
`action.afterResolution` + `ActionFrame.resolvedSuccess` (built two waves
ago) and `requiresDisciplines` (built for the discipline-filtered wave)
cover most of "after resolution of a successful action requiring Hecata or
[obl]"; the missing clan half is **`CardHandler.requiresClans`**, added
centrally in `compileSpec` for the same reason as `costTypes` — a
hand-rolled handler answering `undefined` fails a filter silently. It is
its own clause `permanent.afterActionBlood`, **not another `lockGrant`
knob**: `lockGrant`'s eleven knobs all grant a bonus to an action in
flight, and this fires once the action is over.

**BUG: `anyAfterResolutionPlay` only asked cards in HAND.** The
after-resolution window opens only when some seat can use it, and the
probe never consulted `abilityOptionsFor` — so a window whose only user is
a card in play would never have opened, and Cappadocian Crypt would have
been supported and unreachable. Same class as
`modifyVotes`/`restrictVotes`/Scalpel Tongue: one question asked in two
places, one of which never learned. Both probes now share `anyPlayIn()`.

**Meditative Grove CLOSES THE FRENZY GATE.** "Lock this card to cancel a
frenzy card as it is played on a Salubri you control (cost is still
paid)". `abilityOptionsFor` returned `[]` for `card.asPlayed` — "only
cancels and wakes there, p. 7" — which is right, and this card IS a
cancel, so the exception is opt-in per handler
(**`CardHandler.abilityInAsPlayed`**, the `abilityAnySeat` shape).
`abilityOptionsFor` also had to start filling `PlayContext.pendingCard`.
**"Used on" is denormalized, not looked up:** the first attempt read the
frenzy card's spec back by name and did not even compile (cards.ts imports
compile.ts), so it became a central query
(`CardHandler.frenzyTargetsOpponent`) stamped onto
**`CardPlayFrame.frenzyOnOpponent`** at push — the `isMaster`/`isFrenzy`
treatment. A card never reads another card's spec.

**PRE-EXISTING BUG FOUND: `requiresControlledTitle` was read in ONE
place.** It is the Methuselah-level "Requires a prince or primogen" line,
and only the polling branch checked it: the master compiler checked its
two siblings and not it, and the action compiler checked none of the
three. **Expulsion's requirement was unenforced.** All three now go
through one `controllerMeetsRequirements` helper called from all three
sites. This is the `meetsRequirements` bug verbatim, and the fuzz
structurally cannot see it — a too-permissive option list looks exactly
like a correct one.

**LOCATIONS THAT BUY VOTES — 5 cards
(`docs/politics-locations-design.md`).** The Master group with a shape:
four cards that reach into a referendum and one that skips the vote.
Cards: **Elysium: The Palace of Versailles** (100632), **Ferraille**
(100722), **New Carthage** (101277), **Día de los Muertos** (100541),
**Black Forest Base** (100165).

**NEW CARTHAGE RETIRED A DEFERRAL THAT HAD ALREADY EXPIRED.** Two docs
deferred it — "a global-tally hook not yet present"
(`politics-followups-design.md`) and "per-minion vote counting; follow-up"
(`polling-votes-design.md`) — and both were written when granted votes
were pooled PER SEAT. `pollingOptions` has counted per MINION since
Saulot's Guiding Wisdom, so the card is one `auraBonus(state, m, "votes")`
term added to that sum. **A deferral is a claim about the code as it was**
— the Touch of Valeren lesson, and the second time it has paid.

Two details the card forced: **`PermanentAura.titledOnly`** ("**Titled**
Brujah get +1 vote" must not make an untitled Brujah a vote source) and
**clamping at zero** ("Ventrue get −1 vote" takes a primogen to 0; a
negative must never become votes *against*). And
**`PermanentInPlay.auras`** — a LIST — because New Carthage prints two
aura clauses with different clan filters and `entry.aura` is one object;
`auraBonus` reads the singular field and the list, so nothing existing
moved.

`lockGrant` gained **`titled`** (Elysium's "each titled Camarilla you
control", on top of Power Structure's `perClanMinion` counting) and
**`poolCost` + `oncePerTurn`** (Ferraille's fixed price, which is not
Oxford University's `perPoolX`, plus the existing `noLock` — it burns pool
and never locks). Precedent applied without re-litigating: Ferraille's
Ministry clan tag takes **no** `requiresClan` (a clan tag on a Master is
thematic — Ravnos Carnival).

**`ReferendumFrame.autoPass`** is Día de los Muertos: armed by
`SeatState.autoPassReferendum` (cleared on `TurnBegan`), **consumed where
the frame is built** so only the FIRST referendum gets it, and gated on
the calling minion being Sabbat. Read in settle: **terms are still
chosen** — the card names only the polling step, and terms are what a
referendum *does* — then the tally is written directly with **margin 0**,
since no votes were cast. Game-wide uniqueness is the Open War shape: an
`options` overlay reading the event log, needing no new state and
correctly stricter than "in play" for a card that never enters play.

**Black Forest Base needed its own clause, not another `vulnerableTo`
knob.** `vulnerableTo.via: "politicalAction"` is specifically "call a
referendum to BURN this card"; `permanent.politicalGrant` is a granted
political action with an ordinary payout, reusing `announceEntryAction`'s
`political: true` and the `fromCardInPlay` referendum source. Its
changeling clause is written and **correctly enumerates nothing** — a
survey found Black Forest Base is the only card in all 661 that says the
word (the Wall Street Night precedent); the filter is a new
`vulnerableTo.who.tag`, matched against the minion's own card tags.

**ACTIONS THAT BECOME PERMANENTS — 5 cards
(`docs/action-attachments-design.md`).** The largest group in the Action
family: a successful action puts the card **itself** into play on a minion
instead of into the ash heap, and everything interesting happens after.
Cards: **Heroic Might** (100913), **Khabar: Glory** (101043), **Rutor's
Hand** (101664), **Tier of Souls** (101984), **Phantasmagoria** (102358).

`attachSelf` covered the static half (Heart of the City, Abbot); the new
work is the riders, and **three of them needed one line each** because the
hook already existed: `onLeaveReady` (Heroic Might burns if its bearer
goes to torpor), `onControllerUnlock` (Khabar: Glory burns at your unlock)
and `onSeatOusted` (its 4-pool prey bonus — the same "only moment
`preyOf` still names the seat going out" the pool-drain wave built it for).
`PermanentStatics.bleedAgainstPrey` is likewise one term in `currentBleed`,
which already had `af.target` and already resolved the harder direction
(`bleedAuraAgainst`).

**`attachSelf.target: "anyMinion"`** (Phantasmagoria's "put this card on a
minion; **you still control this card**") forced `attachOnSuccess` to
record a `controller` — it emitted none, which is fine while the bearer is
always your own minion and is p. 16's recorded bug the moment it is not.
Now recorded on every self-attach.

**`Strike.burnEquipment` — a strike that destroys rather than damages.**
The fourth kind after damage, dodge and combat-ends: it inflicts nothing
and burns one equipment card on the opposing minion, granted by a card in
play in the shape the weapon compiler already uses. **Voracious Vermin**
superior ("1 additional ranged strike: burn weapon") is next in line for
it. Reading on record: **with nothing to burn the strike is not offered.**

**`PermanentStatics.blockedToll`** is Phantasmagoria superior — the ACTOR
paying for having been blocked, which is neither `blockCosts` (paid by the
blocker to attempt) nor `notBlockPenalties` (paid for declining). Read
where the block succeeds, before p. 25's two consequences.

**BUG FOUND: `attachOnSuccess` read `params.target` as the bearer
unconditionally.** Right for "put this card on a minion you control", wrong
for everything else, because `target` is the generic name for *whatever* an
action card's one targeted clause chose — Tier of Souls' `target` is the
minion it steals blood FROM, so the card attached itself to its own victim
and handed an opponent's vampire the bleed bonus. No shipped card combined
`attachSelf` with a different targeted clause, so nothing was broken until
one did. `attachOnSuccess` now returns `bearerFromTarget`. **The general
lesson: an option-id param named for its SLOT rather than its clause is
shared state between clauses** — `target` has meant the rush target, the
attach bearer, the stun victim and now the steal victim.

**AND A PRE-EXISTING ONE THE FUZZ FOUND — an INVISIBLE infinite loop.**
Adding these names reshuffled every seeded game and seed 2 stopped
terminating: 4 GB of heap, no failure, no output. `reconcileHandSize` is
"while the hand is short and the library is not empty, draw" (p. 7), and a
draw can be **redirected to a store** (Black Market Cache, Shilmulo
Tarot), which *asks instead of drawing* — leaving the condition unchanged.
Inside action resolution `raiseChoice` only **queues**, so the loop pushed
no frame and emitted no event: it grew one private array and nothing else.
**Every guard the engine has stayed silent** (settle iterations, event-log
length, frame depth, decision count); the only way in was a wall-clock
check in a hot leaf function throwing to capture a JS stack.
`drawToReplace` now returns whether a card actually moved. **When a hang
produces no events and no frames, stop instrumenting the state machine and
time-box a leaf.**

**COMBAT CARDS THAT BECOME PERMANENTS — 5 cards
(`docs/combat-attachments-design.md`).** The combat-side twin of the wave
above: a combat card that puts ITSELF into play mid-fight instead of going
to the ash heap. Cards: **Wall of Filth** (102347), **Sculpt the Flesh**
(102260), **Disarm** (100549), **Morbidity** (102332), **Monstrous Form**
(102253). Combat drops from 15 unsupported to 10.

**`attachInCombat` is the first primitive whose WINDOW is data.**
`combatWindowFor(mode)` is one `case` per primitive kind, which works
while a primitive has exactly one window — and these two disagree: Wall of
Filth is "only usable before range is determined", Disarm "at the end of a
round". The field (`when: "beforeRange" | "endOfRound"`) beats splitting
one mechanic into two identically-resolving kinds, which is precisely how
`modifyVotes`/`restrictVotes` drifted apart. `to: "self" | "opposing"`
picks the bearer, and `"opposing"` records a `controller` (p. 16).

**A LIVE RULES BUG ON A SUPPORTED CARD, found by surveying:** the
`prevent` primitive had no aggravated filter, so **Soak** — which prints
"prevent 2 NON-AGGRAVATED damage" — had been preventing aggravated damage
it cannot touch. `PendingDamage.aggravated` has existed since the
strike-effects gate; nothing ever asked it. `prevent.nonAggravated` is a
gate on **options** (the `noPreventBy` precedent), and Wall of Filth is
the sharpest possible test of it: its two modes differ by *exactly* that
clause, so the negative-space assertion and its control case write
themselves. Only three cards in the pool print the word; the third is
crypt.

**And the bug the control case caught, which is a general one:**
`addCombatAttachBehaviour` first read the prevention clause off
`spec.modes.flatMap(...).find(...)` — **the FIRST mode's** — so the
superior silently inherited the basic's aggravated filter and was offered
against nothing. The fix is the project's own habit: **denormalize onto
the entry** (`PermanentStatics.burnToPrevent`, written when the card
attaches), the same treatment `isMaster` and `frenzyOnOpponent` get.
**A handler-level lookup cannot answer a question whose answer differs by
mode** — and the only reason it was caught is that the negative test was
paired with a positive one. A `false` that is false for the wrong reason
looks exactly like a correct one.

**A second seat-identity bug, same shape as the `controllerOfEntry` one:**
Disarm's "they can burn 3 blood to burn this card" is offered to the
**bearer's** controller, and `owner.seat` in `abilityOptions` is
`entry.controller ?? holder` — the card's OWN controller, i.e. the player
who played it. Comparing against it offered the buy-off to exactly the
wrong Methuselah. It reads `bearer.controller` now. Also on record: the
buy-off has **no timing restriction** (the card prints none), and gating
it to `turn.*` made it unreachable in the very case it exists for — a
vampire Disarm put in torpor waits for their controller's next turn.

Also built, all reusable: **`Strike.attachToVictim` widened** so an attach
can RIDE on a damaging strike (Sculpt the Flesh: "hand strike at +1 damage
AND put this card on the opposing minion"), where Touch of Oblivion's
attach *is* the whole strike — the early return is now conditional;
**`strikeHandBonus.aggravated`** ("Strike: hand strike, aggravated" as a
strike declaration, unlike the round-scoped `handStrikesAggravated`);
**`EngineOps.sendToTorpor`** (torpor outside the damage pipeline; an ally
is burned instead, the `strikeIncapacitate` reading); and the three
mid-combat grants a card in play can hand its bearer
(`addRoundStrengthTo` / `grantManeuverCreditTo` /
`grantCombatPressToMinion`) — the card-play ops beside them all take a
`CardPlayFrame`, which an in-play ability does not have.

**Morbidity needed NO new state for its blood store.**
`PermanentInPlay.counters` is it — the Wasserschloss Anif precedent, blood
in and blood out — and its superior's "combat cards cost the opposing
vampire +1 blood" is `combatCostModOnOpponent`, built for Terror Frenzy
superior in the play-cost wave and reused verbatim. That is the fifth wave
running where a piece built for one family turned the next into data.

**Readings on record:** a non-aggravated prevention card is not offered
against aggravated damage (options, not a no-op); **Disarm's player must
still be ready at End of Round** — p. 32 says that step runs even when a
combatant has just left the ready region, which is exactly the case the
card's own second sentence names; "up to 2 blood" is a choice, not a
maximum taken automatically (the Cave of Apples direction, not Show of
Force); and a bearer buy-off has no timing restriction.

**MASTERS THAT REACH ACROSS THE TABLE — 5 cards
(`docs/cross-table-masters-design.md`).** The queue said Master was "a
genuine one-off tail with no cluster left". That was true of the
*mechanics* and wrong about the *shape*: five of the twelve buildable
Masters (four are Path-blocked, one zombie-blocked) share the property
that **another Methuselah is a participant, not a bystander**. Cards:
**Giant's Blood** (100824), **Golconda: Inner Peace** (100842), **Archon
Investigation** (100085), **Anarch Troublemaker** (100058), **The Coven**
(100435). Master drops from 17 unsupported to 12. **The lesson: survey by
what the cards DO to each other, not only by which primitive they need.**

**PAY-TO-CANCEL — NEW GATE, and it retires a deferral from another doc.**
Every cancel the engine had was a **card** cancelling a card (Sudden
Reversal, Hide the Mind, Meditative Grove). Golconda's "their controller
can burn 2 pool to cancel this card as it is played" is a Methuselah
paying **pool**, no card involved. `CardPlayFrame.payToCancel: { seat,
pool }` is the general form, answered by the new central query
**`CardHandler.payToCancelFor(state, seat, params)`** at PUSH time —
because who may pay depends on what this particular play TARGETS, which
only the option's own params know. It is a **built-in option**
(`cancelpay:<cardId>`), not a ChoiceFrame: the as-played window already
cycles every seat, so the payer is already being asked — the Dawn
Operation ruling. **This retires the True Love's Face deferral**
(`docs/bleed-riders-sweep.md`), which is the same mechanic with a
different payer. Reading on record: **the cost is NOT refunded** — Sudden
Reversal prints "its cost is not paid" and Golconda prints nothing of the
kind.

**REMOVING A CARD FROM THE GAME (p. 16), quoted in the doc.** The ash heap
is unmodelled and BLOCKED, so a removed card and a burnt one end in the
same non-place today — **the difference that is real right now is the
hook**: `notifyLeaveReady`'s `how` gained `"removed"`, so a card keyed on
`how: "burned"` (Fame) does not fire. New event
`MinionRemovedFromGame`; what the rulebook's own sentence says they share
("any counters or other cards on it are burned") is shared in the code.

**New hook `onDiscardPhase`** — the third sibling of `onMasterPhase` and
`onInfluencePhase`, fired as a discard phase opens. Reading on record:
**The Coven's handover is mandatory** ("your predator takes control", no
"you can") — the Rebel precedent, fires from the hook with nothing asked.
Anarch Troublemaker's, by contrast, is the **price** of a parting shot
("give … **and either** lock two vampires **or** burn an equipment"), so
it is one option per legal payoff with the choice in the option id.

**Archon Investigation needed nothing new at all** — `isOutOfTurnMaster`
and the `outOfTurnMasterUsed` debt (Sudden Reversal), the
`afterBlocksDeclined` window, `currentBleed`, and **`failAction()`**,
built for Expulsion and exactly "(the action is not successful)". Worth
remembering: the bleed amount is read **when the card is played**, and
`currentBleed` is a fold over the event log, so it already includes every
modifier played since — which is what makes "after blocks are declined"
the right window for a card that cares about the final number.

**Giant's Blood's game-wide uniqueness needed no new state** — the event
log is the record of everything ever played (Week of Nightmares / Open
War), and is correctly stricter than "in play".

**Three fixture bugs, all mine, all the engine being right** — recorded
because each is a trap the next session will hit: (1) `threeSeatGame()`
opens at `turn.minion`, so a **master**-card test must walk to the next
master phase rather than assume the first decision; (2) seating is Alice →
Bob → Carol, so **the minion that can bleed Alice is CAROL's**, not Bob's
— Bob's prey is Carol; (3) `MinionState`'s field is **`bleedAmount`** —
`bleed` is a static on a card in play, and setting it on a minion silently
does nothing, which is exactly the "empty for the wrong reason" shape.
Also: at Alice's unlock phase her prey's vampires are **still locked from
their own turn** (they unlock at *their* unlock phase), so an
Anarch-Troublemaker test has to use the equipment branch.

**ACTIONS THAT TAKE WHAT BELONGS TO ANOTHER METHUSELAH — 5 cards
(`docs/taking-actions-design.md`).** Cards: **Far Mastery** (100703),
**Graverobbing** (100852), **Puppet Master** (101215), **Slaughtering the
Herd** (101801), **Break the Bonds** (102247). Action drops from 16
unsupported to 11.

**THE SURVEY FINDING THE OWNER SHOULD SEE: seven of the sixteen remaining
Actions need the ASH HEAP**, which is BLOCKED pending owner review
(Psychophagia, Putrescent Sustenance, Shroud of Decay `[OBL]`, The Gate of
Acheron, Split the Veil, Waters of Duat, Childe of the Revolution). **The
ash heap is now the single largest blocker in the pool** — it is no longer
just "a zone we have not needed". Flagged, not built; the table is in the
design doc §1. Shroud of Decay's *basic* mode is clean on its own and is a
partial-support candidate if the owner would rather ship half of it.

**TEMPORARY CONTROL is the one new mechanic.** Every control change before
this was permanent. **`MinionState.controlRevertsTo`** is set by
`borrowMinion` and honoured in **`endTurn`**, beside where "cannot act
this turn" already expires. Reading on record: **a borrowed minion goes
home with everything on it** — p. 16, and the revert is literally the same
op in the other direction, so a retainer employed while borrowed travels
too. One field rather than a queue of scheduled effects, because every
card in the pool that borrows a minion says "until the end of your turn".

**Stealing a retainer and stealing an ally are NOT one primitive** — a
retainer is a `PermanentInPlay` and moves with `moveAttachment`; an ally is
a `MinionState` and moves with `changeMinionControl`. Far Mastery's two
modes also differ in scope, and the difference is real: the inferior says
"controlled by another **vampire**" (so a retainer on your own other
vampire is legal) where the superior says "another **Methuselah**".

**THE SEAT-IDENTITY TRAP, HIT AGAIN — and it is now a rule.** Puppet
Master's cash-in was offered to nobody: the entry sits on the opponent's
vampire, so `abilityOptionsFor` scans it under THEIR seat and skips
foreign handlers that do not opt in — and the ability belongs to the
card's *controller*, who is exactly the foreign seat. It needs
`abilityAnySeat = true` with `ctx.seat === controller` doing the real
work. **The exact mirror of Disarm's buy-off**, which belongs to the seat
holding the minion and therefore needs no flag. **Which seat an ability
belongs to is a per-card question, and getting it backwards offers the
card to nobody, silently.** That is now three waves running with a bug of
this shape.

Also built: **`onActionAnnounced`**, hung on the single `ActionAnnounced`
chokepoint in `applyToFrames` that `minionActionsThisPhase` and
`stealthCharges` already use; **`PermanentInPlay.linkedMinion`** (a card
ABOUT a minion it is not attached to — Slaughtering the Herd sits on the
predator's vampire and feeds, and dies with, the vampire that played it);
and **`permanent.bearerCanBurn` got its second user**, one wave after
Disarm introduced it. Reading on record: **the siphoned blood MOVES** —
burnt from the bearer, gained by the actor, clamped at capacity (p. 11).

**Break the Bonds closes the `multiDiscipline` set** — the third and last
card of that shape, and it needed no change to the flag built for Make the
Misere.

**THE LEDGER GUARD PAID FOR ITSELF THE SAME DAY IT WAS WRITTEN.** Break
the Bonds was listed in `docs/partial-support.md`'s cut section, and
shipping it made that row a lie — the full-suite run failed on exactly
that, which is the assertion working as designed. **A stale blocker is
what sent me re-deriving twice before** (Touch of Valeren, New Carthage);
now it cannot survive a green run.

**THE ASH HEAP — BUILT, on owner decision 2026-09-01
(`docs/ash-heap-design.md`). No longer BLOCKED.** It had been on the
blocked list since the roadmap; a survey found nine unsupported cards
waiting on it, which made it the largest single blocker in the pool, and
the owner unblocked it rather than let it keep gating waves. Cards
shipped with it: **Shroud of Decay** (102295), **Psychophagia** (102302),
**Putrescent Sustenance** (102335 — PARTIAL, zombie half blocked).

**The rulebook settles four things that would otherwise have been
readings**, all quoted in the doc §1: the ash heap is **PUBLIC** ("can be
examined by any Methuselah at any time", p. 16) — the only fully open
zone in the game, so `redactFor` deliberately does NOT mask it and a
comment there says so; it is keyed on **OWNER, not controller** (p. 16,
twice), which matters for a stolen location or a master on somebody
else's minion; **"an action that targets an ash heap is always considered
to be UNDIRECTED"** (glossary) — which cuts against every targeting
instinct built up over the rush and steal waves, so Shroud of Decay's
superior carries no target and anyone may block it; and **removal from
the game is a different fate**, with no zone to hold the card, because
p. 16 says such a card "cannot be retrieved or affected in any way".

**`SeatState.ashHeap?: CardInstance[]`** — optional, the `idSeq`
precedent, which mattered more than usual for a zone half the engine
writes to: **every existing test and saved log kept passing untouched.**
Four ways in (`CardDiscarded`, `CardBurned` + a new `seat`,
`PermanentBurned` reading `entry.owner` before the entry is filtered out,
and `CardResolved`), funnelled through one `toAshHeap` so a fifth caller
cannot invent its own spelling. **`CardResolved` is the one that needs a
condition** — a master that ENTERS play also emits it, and filing it
would file the card twice, once now and once when it later burns.

**Deliberately not modelled: burnt VAMPIRES.** p. 34 puts them in the ash
heap too, but a `MinionState` is not a `CardInstance`, crypt is phase 7,
and no library card retrieves one. Recorded in the doc so the omission is
not mistaken for an oversight.

**What it unblocked, and what it did NOT.** Six unsupported cards still
mention the ash heap, and **their reasons have been corrected in
`docs/partial-support.md` rather than left stale** — which is the whole
point of that file: **Waters of Duat** and **Childe of the Revolution**
were never really ash-heap cards (they create a **token vampire** from a
library card, a gate of its own); **Split the Veil** and **Rotting
Behemoth** are wraith/zombie, still BLOCKED; **The Gate of Acheron** and
**Garibaldi-Meucci Museum** are now ordinary work, and Garibaldi in
particular is cheap — the new `requiresSects` central query and
`takeFromAshHeap` are both built, and its combat clause is
`endCombatFromOutside`.

**UNLOCK-PHASE TOLLS + THE Ⓓ-BURN RETROFITS — 5 cards
(`docs/unlock-tolls-design.md`). A wave that PAYS DOWN THE LEDGER rather
than opening a family:** one card newly supported (**The Gate of Acheron**,
102290) and four already-supported cards completed (**Smiling Jack**
101811, **Constant Revolution** 100416, **Powerbase: Madrid** 101437,
**Wasserschloss Anif** 102152), retiring **six** rows from
`docs/partial-support.md` — the four "minions can burn this card as a Ⓓ
action" deviations that were queue item 5, plus two alternative
currencies.

**The rulebook rules this mechanic by name, and that is the whole wave.**
p. 50, Smiling Jack: *"you have to move 1 pool to the card **even if it
ousts you**. Each other Methuselah must burn 1 pool **or a vampire
blood** for each counter on Jack, and **it is possible to do a mix
between multiple vampires and the pool**. **Failing to burn 1 blood from
an empty vampire will not lessen the obligation.**"* Three cards print
that sentence with a different second currency (Smiling Jack blood,
Constant Revolution random hand cards, Gate of Acheron a random ash-heap
card), and two of them had shipped with the alternative hand-waved
because there was nowhere to ask the victim a question.

**`permanent.unlockToll`** (`whose: "others" | "prey"`, `alternative:
blood | randomDiscard | removeAshHeapCard`) is a **repeated,
non-optional ChoiceFrame addressed to the payer** — one unit at a time,
re-raised, the Shroud of Decay `targetDiscard` shape. One frame at a time
because the units *mix*: pushing X frames up front would compute every
option list against a board the first answer has already changed. Pool is
always offered (a payer who cannot afford it is a payer being ousted,
which is the ordinary path); the alternative appears only when it can
actually be paid, and **an empty vampire is not offered at all** — the
ruling's last sentence, as an option gate.

**Two live bugs the ruling exposed, both on supported cards.** Smiling
Jack's accumulator was written `if (pool >= 1)`, so it quietly stopped on
its controller's last pool — "even if it ousts you" says otherwise, and
the guard is gone. And p. 51 rules **Wasserschloss Anif "can only receive
blood from ONE Tremere on any given turn"**; its master-phase offer was
unlatched, so every Tremere could feed it in one phase. Both pinned.

**A THIRD bug, and it is the more general one: a burnt hand card IS
replaced.** p. 7 is categorical — *"whenever an effect changes your hand
size or **adds or removes cards from your hand**, immediately discard
down to or draw up to match your hand size."* Two sites passed
`replace: false` on the reasoning that a forced discard or a cost "is not
a play": **Shroud of Decay**'s target discard and **`masterPhaseBurn`**'s
"discard two master cards" (Tension in the Ranks). p. 7 does not care why
the card left. Only a card that *prints* otherwise leaves the hand short —
Mirror Walk, whose own ruling spells out that not replacing "works the
same way as if it was counting against your hand size". The genuinely
correct `false` sites are the **discard-DOWN** ones (Telepathic Vote
Counting, Fragment of the Book of Nod), where the hand is *above* size
because a card came back. **The two look identical in code and are
opposite in rules.**

Also built, all reusable: **`EngineOps.randomIndex(n)`** — the first card
effects to need a die roll, reached through the ops surface so no card
touches `state.rngState` (principle 2); **`permanent.unlockCounter`**
(`{ amount, fromPool }` — the free accumulator and the bought one);
**`permanent.counterGrant`** ("\<who\> can add N counters to this card as
a +M stealth action", dispatching on the `:counter:` verb segment Pit of
Contemplation's bespoke option id already used); and
**`vulnerableTo.outcome: "burnCounters"`** — the fourth outcome after
burn/steal/shuffle, where **the card survives and its counters do not**
(Powerbase: Madrid). Smiling Jack and Constant Revolution are now
**pure `compileSpec`** with no bespoke body at all; Powerbase and
Wasserschloss keep theirs and take `vulnerableGrant(...)` from a **local
spec literal**, so the retrofit is a data change and not a rewrite of two
working cards.

**Composition, applied before it bit:** `unlockDrain` and `unlockToll`
both own `onAnyUnlock`, and three separate clauses own
`onControllerUnlock`. All of them now **compose with whatever is already
there** instead of assigning over it — the `choiceByKey` lesson one layer
up. No card in the pool combines them yet; the next one would have lost a
clause silently.

**Readings on record:** The Gate of Acheron is **NOT a location** (it
prints "Unique.", not "Unique location.", so a location-burner must not
reach it — a tag, and four other cards enumerate by it); "a **library**
card at random in their ash heap" is every card in the heap today, since
burnt vampires are deliberately unmodelled there; and an **empty**
Powerbase: Madrid is still a legal target of its own strip action, which
does nothing — the clause names no precondition, so the permissiveness is
printed rather than a bug.

**THE VOZHD, AND AN ALLY'S OWN WEAPONS — 5 cards
(`docs/vozhd-allies-design.md`). Ally's first wave**, though the
allies/retainers kernel has been built since that gate: **The Vozhd of
Sofia** (102267), **Gravesend** (102363), **Juiz de Fora** (102364),
**Szczecin** (102365), **City Star Taxi** (102234). Seven of the
fourteen unsupported allies are BLOCKED (wraith/zombie); **four of the
seven buildable ones are the Vozhd, which are one card printed four
times** — unique 5-life Tzimisce ghoul, "burn an ally or retainer you
control" on arrival, a Ⓓ rush, and one clause each. Ally drops 14 → 9.

**`ally.enterPlayBurn` generalises War Ghoul's hand-rolled clause, and
settles its owner-flagged ledger row on the way.** Reading on record:
**the entering ally IS a legal victim.** "Burn an ally or retainer you
control" names a set the newcomer belongs to, and nothing in the sentence
excludes it or prefers an alternative — so `self` is offered at every
board state, which is exactly what War Ghoul already did. The row is
retired; War Ghoul itself is *not* rewritten onto the flag (the Platinum
Protocol precedent) and is recorded as a retrofit instead.

**`ally.strike` — the first strike printed on a MINION rather than a
weapon** (Sofia 3R, City Star Taxi 1R). It reuses `spec.weapon`'s
`combat.chooseStrike` ability and `ops.chooseWeaponStrike` verbatim,
because an ally's card text is a **self-attached entry** and that is
precisely where the weapon ability looks. **One difference is the whole
reason it is a separate clause: it is NOT gated on
`cf.restrict[side].equipment`** — an ally's own body is not equipment, so
"the opposing minion cannot use equipment" must not disarm it, and
writing it as a weapon would also have let every equipment-burner destroy
its arms.

**"PLAYS CARDS AS A VAMPIRE" — THE DEFERRED GATE, CLOSED, and the
rulebook specifies it completely.** p. 11 (Advanced Rules — Allies) is
quoted in full in the design doc; every clause is something this engine
already does. Life *is* blood (`MinionState.blood` behind the `kind`
discriminant); excess life does not drain off (`drainOverCapacity` and
the `BloodGained` clamp both skip allies, both already citing p. 11);
aggravated burns life; torpor becomes a burn; not a vampire for in-play
effects. **What was actually missing was one field.** The combat and
modifier compilers pick their player with `disciplineOk`, which reads
`disciplinesOf(m)` — **they never ask `m.kind`** — so an ally whose
`MinionState.disciplines` holds `{ ani: "basic" }` is offered exactly the
cards the clause names, through the ordinary path, with no new gate
anywhere. `ally.playsAsVampire` puts it there at `AllyEnteredPlay`
(optional field, so every fixture and saved log is untouched).
**Recorded gap:** the rulebook's DEFAULT capacity of 1 for such a play is
not built — Juiz de Fora overrides it ("as a vampire with capacity 5"),
and 5 is what `capacityOf` already returns for a 5-life ally, so a
`playAsCapacity` field would have no reader today. Spectral Servitor, the
only other card in the family, stays BLOCKED for being a wraith.

**Cancelling a strike card, by an ally, with no card of its own**
(Gravesend). Three existing pieces plus one: `abilityInAsPlayed` (built
for Meditative Grove — p. 7 otherwise reserves that window for cancels
and wakes), `ops.cancelPendingCard(true)` ("its cost is not paid" is the
Sudden Reversal wording, which refunds), and the new central query
**`CardHandler.isStrikeCard(mode)`** → **`CardPlayFrame.isStrike`**,
answered in `compileSpec` from `combatWindowFor(mode) ===
"combat.chooseStrike"` — the same test `costTypes` already uses. **A card
never reads another card's spec**, so it is denormalized at push beside
`isMaster`/`isCombat`/`isReaction`/`isFrenzy`. **"The minion chooses a
strike again" needed NO code**: a cancelled strike card never fills
`cf.strikes[side]`, and `chooseStrike` is a step the settle loop returns
to while that slot is null. The parenthetical describes existing
behaviour; reading it as an instruction is how a re-entrancy bug gets
written.

**Two window facts this wave had to get right, both the same shape as the
2026-08-02 bug.** (1) **`turn.minion` is the TURN SEAT's own window** —
no other seat is asked in it — so "during any OTHER Methuselah's minion
phase, a Tzimisce you control can burn 1 blood to unlock this ally"
(Szczecin) is enumerated in `action.announce` / `action.effects` while the
turn frame's phase is `minion` and `turnSeat !== owner.seat`. That is
also the only moment it is worth anything: the ability exists to unlock
the ally in time to block. (2) **Stealth is offered only when NEEDED**
(p. 26) means the blocker's intercept must have *caught up*; a hunt's +1
inherent stealth puts a 0-intercept blocker out of reach, so a **plain
bleed** (0 vs 0) is the fixture a stealth-lending test needs — the mirror
of the note already in this file about using a hunt to make intercept
live.

**Recorded structural limit, not a deviation: `permanent.lockGrant` is
compiled INSIDE `compileMaster`.** Eleven knobs, ~300 lines, and it can
never reach a card of another type. City Star Taxi is an **ally** that
prints exactly that clause, so it carries its own
`allyAbilities.lockForStealth` — with the p. 26 "only when needed" test
**extracted into a shared `stealthIsNeeded()`**, so the two paths cannot
drift on the rule that matters. Lifting `lockGrant` into a grafted helper
is worth doing when a third card type needs it, not mid-wave; it is in
`partial-support.md` under retrofits.

**THE CHEAP TAIL — 6 cards (`docs/cheap-tail-design.md`). Chosen by the
LEDGER rather than by a mechanism**: every one had a cut-list row in
`docs/partial-support.md` saying it was one clause away, and several of
those rows named pieces built in the three waves since. Cards:
**Garibaldi-Meucci Museum** (100809), **Vagabond Mystic** (102087),
**Underbridge Stray** (102065), **Voracious Vermin** (102266), **Heart of
Nizchetus** (100903), **True Love's Face** (102041). Six rows retired;
**what is left on that list is now the genuinely expensive tail** —
nothing cheap remains on it.

That is the ledger paying for itself a third time: **a survey that reads
it takes minutes and one that re-derives it takes hours**, and Touch of
Valeren and New Carthage were both re-designed against blockers that had
already been built.

**The one real design decision was Voracious Vermin, and it is a rule
worth remembering: a GRANTED strike is not a free one.**
`grantAdditionalStrike` gives an extra sub-round in which the minion
chooses **freely** — right for Lightning Reflexes, and *wrong* for "1
additional ranged strike: **burn weapon**", because nothing else would
ever offer a burn-weapon strike in that sub-round, so the extra strike
would silently be a hand strike and the card's whole superior mode would
be inert. Wind Dance is a recorded deviation for exactly this shape (a
nominally forced dodge), and taking the shortcut twice would have made it
a habit. So `CombatFrame.grantedBurnEquipment` + `StrikeKind` gains
`"burnEquipment"`, in the shape `grantedCombatEnds` already uses: one
built-in option per equipment on the opposing minion, one use, cleared
when taken. **The Wind Dance row stands** — a forced dodge is a different
shape and that card is green.

Also built, all small: **`EngineOps.buryInLibrary`** + `CardBuried` —
"move a card from your hand to the BOTTOM of your library", which is not
a discard (no ash heap, no replacement draw); the library is drawn from
the FRONT (`shift`), so the bottom is `push`, and getting that backwards
would be invisible until a game ran long enough to draw the card again.
**`PermanentStatics.cannotBlockKind`** ("cannot block **vampires**" —
the existing `cannotBlock` is unconditional; one direction only, since
the Mystic may still block an ally and may still *be* blocked by
anything). **`spec.payToCancel: { pool, who: "blocker" }`** — the
Golconda gate reached from the other end: the payer is computed from the
**state** (the live `BlockAttemptFrame`) rather than from the option's
params, which is the point of doing it at push time. And three ally
clauses off the Vozhd wave's `allyAbilities` (`lockToHealAlly`,
`burnLifeForPress`, `burnToUnlock`).

**Readings on record:** "an action directed at you **(or a card you
control)**" needs nothing extra — an action aimed at a card in play is
already directed at that card's *controller* (p. 25), which is what
`af.target` records, so the parenthetical is the rulebook clarifying a
case one field already covers; Garibaldi's combat-ender needs **both**
combatants to be Anarchs ("an Anarch you control **and another Anarch**")
and its controller need not be in the combat at all; the ash-heap
exchange draws no replacement either way, because it is an exchange; and
Heart of Nizchetus's bury is **mandatory once the draw is taken** (one
sentence, one ability — choosing 0 is how you decline).

**A test-fixture trap this wave re-taught, and it is a rules fact:
"ready" means the ready REGION, and a LOCKED minion is still ready**
(p. 16). "If the bearer is ready during your unlock phase" therefore
works on a locked bearer; torpor is what takes them out. My negative test
asserted the opposite and the engine was right. Pinned both ways now.

**WHAT A WEAPON DOES BESIDES HIT — 5 cards
(`docs/weapon-riders-design.md`). Equipment's first per-card wave**, and
the finding that made it one: `docs/weapons-design.md` built the gate
years of waves ago — `spec.weapon` compiles to an ability in
`combat.chooseStrike` calling `ops.chooseWeaponStrike` — and that block
has five fields, **every one of which the five remaining weapons overrun
by exactly one clause.** Cards: **AK-47** (100032), **Sniper Rifle**
(101816), **Righteous Blade** (102359), **Sword of the Archangel**
(102261), **Treasured Samadji** (102015). Equipment drops 10 → 5.

**`grantedBurnEquipment` became `CombatFrame.grantedStrikes`, and the
rule is: two users turn a field into a list.** Treasured Samadji's "once
each combat, this Ravnos can strike: dodge" is the second card in two
waves wanting a **specified strike offered in the `chooseStrike` step**;
`StrikeKind` gains `"dodge"`, and a granted strike is **spent when
taken** (`splice`, not a boolean) — which is what "once each combat" and
"one additional strike" both mean. **`grantedCombatEnds` is deliberately
NOT folded in**: it is read at four sites with two conditions attached
(`round === 1`, `noCombatEndsFirstRound`), so merging it would move real
logic for no gain. Recorded so the inconsistency is not read as an
oversight.

**AK-47 needed no new restriction — the .44 ruling already had it.**
"1 additional strike, only usable to strike with this gun" is
`grantAdditionalStrike` plus `CombatFrame.committedStrike[side]`, which
has held exactly that meaning since the .44 Magnum maneuver ruling
(p. 47) and already bars both the built-in hand strike and every other
weapon. Two existing ops in sequence.

**A restricted credit is spent BEFORE a general one** — the
`closeManeuvers` rule, now applied a third time.
`CombatFrame.pressesContinueOnly` is Righteous Blade's "1 optional press,
**only usable to continue combat**": a third pool beside `presses` and
`pressesCombat`, offered only for `press:continue` and spent first, so a
player is never left holding the narrow credit having spent the wide one.

**Card KEYWORDS are a third axis, and the first filter on them correctly
matches nothing.** "Grapple." and "Aim." are printed lines above the card
text — neither card types nor Disciplines — so `CardSpec.keywords` →
`CardHandler.cardKeywords` → **`CardPlayFrame.keywords`**, the
`isMaster`/`isCombat`/`isStrike` treatment, because a card never reads
another card's spec. **The V5 pool has exactly two keyword cards and both
are unsupported** (Immortal Grapple 100959, Target Vitals 101942), so
Sword of the Archangel's "cancel a grapple or aim card" is written,
correct and enumerates nothing today — the Wall Street Night precedent,
with a test pinning the negative to the *right* reason. Both cards are in
`partial-support.md` with what they still need; the Sword needs no change
when they land.

**`CombatFrame.burnedByStrike` — an after-combat rider cannot see HOW the
victim died.** Sword of the Archangel's "if the opposing vampire is
burned **during this weapon's strike resolution**" needs a fact recorded
at the moment it is true, so `resolveCombatDamage` — the chokepoint the
round-recurring wave established for damage actually *inflicted*, as
opposed to queued — records the striking side's strike name whenever a
combatant leaves play, and `onCombatEnded`'s `info` carries it. "The
bearer remains ready" is read when the rider FIRES, not when the flag is
set: the bearer can die later in the same combat.

**Readings on record:** AK-47's extra strike is offered even when firing
again is pointless (the card names no condition, and `limited: true`
already stops a second source stacking); "burned" is burned, not sent to
torpor (`notifyLeaveReady` already distinguishes the three fates, and an
aggravated strike on a wounded vampire burns them outright, p. 34 — so
the clause is reachable rather than decorative); and Sniper Rifle's
"only usable at long range" is a gate on **options**, so a close round
simply does not list it.

**RETAINERS — 6 cards, and RETAINER IS THE FIRST CARD TYPE FINISHED
(`docs/retainer-wave-design.md`).** All six unsupported retainers ship
together: **Crypt's Sons** (100476), **Owl Companion** (101340),
**Raptor** (101545), **Feral Hound** (102249), **Szlachta Assistant**
(102360), **Szlachta Bodyguard** (102361). 6 → 0.

**THE LESSON, and it is a general one: a combat-scoped effect on the
OTHER player is DERIVED, never stored.** Owl Companion ("while the
employer is in combat, the opposing minion's controller plays with an
**open hand**") and Raptor superior ("…gets **−1 hand size**") both look
like flags to set at `pushCombat` and clear when the frame pops. **A
combat ends by a strike, by a card, by a combatant leaving play, or by
the frame being popped from three sites — a flag that must be cleaned up
at all of them is a flag that will one day survive one of them**, and
this engine has already been bitten by exactly that shape (the cached
damage cycle keyed to "exists" rather than to the thing it was about).
So `openHandsFor()` and a term in `handSizeOf()` read the live combat
frames on demand: nothing stored, nothing cleared, and the effect lifts
itself whichever way the combat ended. A test deletes the frame and
watches the hand close.

**The open hand is NOT the phase-6 "who has looked at this card" gap.**
That gap is about **memory** — an effect reveals a hand once and the
viewer keeps knowing those cards, which structural masking cannot
express. An open hand is **structural and continuous**, true exactly
while the combat lasts, which is what masking is *good* at. The two look
alike and only one is hard. It does have to defeat masking in **two**
places (`redactFor` hides NAMES, `viewFor` collapses to a COUNT), and
`viewFor` asks the same helper rather than re-deriving — the reason
`viewFor` is defined in terms of `redactFor` in the first place.

**Raptor does NOT retire the Dreams of the Sphinx ledger row**, and that
is worth keeping straight: that row is "+2 hand size **until end of
turn**", a *timed* bonus with nowhere to live. Raptor's is derived from a
live frame and needs no timer at all.

**Two "continue the action as if unblocked"s in three waves, and neither
needed code.** Crypt's Sons' block-break is `failBlockAttempt` plus a
`MinionLocked` — p. 49 rules that **Mirror Walk explicitly locks the
blocking minion** where Change of Target does not, and this card is on
Mirror Walk's side. The continuation is what a failed attempt already
does. Same trap as "the minion chooses a strike again" (Vozhd of
Gravesend): **a parenthetical describing existing behaviour reads like an
instruction, and building to it is how a re-entrancy bug gets written.**

Also built, all reusable: **`SeatState.playCostMods`** — a play-cost
modifier held by a METHUSELAH rather than by a frame or a card in play,
because Szlachta Assistant **burns itself** to grant one and there is no
action frame yet when it does; **`PlayCostMod.requiresClan` and `.tags`**
(off `requiresClans` and `permanentTags`, the fourth and fifth wave
running where an existing central query turned the next family into
data) so "a **ghoul** ally requiring a **Tzimisce**" is expressible; and
`PermanentStatics.unlockEmployerAt`, which is a **static rather than a
`retainerAbilities` field** because the timing is the only difference
between Feral Hound's two modes and mode statics already merge into the
entry.

**Readings on record:** "an action directed at **a minion you control**"
(Szlachta Bodyguard) is narrower than "directed at you" — a bleed is
directed at a **seat** and does not qualify, which falls out of
`af.targetMinion` being null rather than needing a rule; that card's
second clause makes the action **fail**, not be blocked, so no combat
follows; Szlachta Assistant's discount is spent whether or not it is used
(burning is the price, and `once` already does that); and Feral Hound's
basic delay to the discard phase is a **real drawback**, so modelling it
as "unlock now" would silently upgrade the card.

**A test-hygiene catch in my own file:** the Szlachta Bodyguard
fail-action test was first written with an early `return` when the
fixture could not produce a minion-directed action — a test that passes
by doing nothing, which is the "empty for the wrong reason" shape this
project keeps finding in *cards*. Rewritten with **Hunter's Mark** as the
rush so it actually exercises the clause.

**THE END OF THE ROUND, AND WHAT REOPENS IT — 5 cards
(`docs/round-end-design.md`).** Cards: **Hunting the Quarry** (102329),
**Telepathic Tracking** (101950), **Immortal Grapple** (100959),
**Target Vitals** (101942), **Dance with the Devil** (102315). Combat
drops 9 → 4.

**THE HEADLINE IS THAT THE QUEUE ENTRY WAS WRONG.** This file carried
Hunting the Quarry for three waves as "needs a new combat SUB-STEP … a
sequencing change that wants its own design doc and owner review". **It
needs no sub-step.** The combat step order is
`damageResolution → press → endOfRound`, and **the press step is where
`cf.willContinue` is decided** — so by the time the `combat.endOfRound`
window opens (a window that already exists, already cycles every seat and
already hosts Taste of Vitae), "would this combat end?" is a finished
fact on the frame. The clause is a **usable rule**; "instead, start a new
round" is `cf.willContinue = true`. **That is the fourth stale cut-list
claim in six waves** (Touch of Valeren, New Carthage, Break the Bonds,
this) — and checking it took ten minutes, then turned one card into a
wave, because two more cards want the same window.

New usable rules: **`onlyIfCombatWouldEnd`** (`!willContinue &&
!endedPrematurely` — the second half matters, since a combat that ended
because a combatant left the ready region reaches End of Round too and
cannot be restarted, which is why both cards also print "if both
combatants are still ready") and **`onlyIfBothCombatantsReady`**.
**Reading on record: "instead" is not a cancel** — the frame simply never
pops, so no rider and no `onCombatEnded` hook has run and nothing needs
undoing. That is what makes it cheap.

**`CombatFrame.handStrikesOnly` is a single boolean, not a per-side
pair**, because "cannot be used this round **by either combatant**" is
what makes Immortal Grapple what it is. It gates **options** at four
producers — the combat-card compiler (a mode survives only if it sets a
`strikeHandBonus`), the spec weapon ability, the ally strike, and the
granted strikes — so nothing has to enforce it again at resolution.
**It found a real gap on the way: the hand-rolled `.44 Magnum` needed the
gate written out**, exactly like its already-recorded failure to honour
`cf.restrict[side].equipment`. Its test therefore arms the two sides with
**different** weapons, one bespoke and one spec-compiled.

**Target Vitals is the first AIM, and the aim rider is conditional on the
strike LANDING.** "If any damage from this strike is **successfully
inflicted** … they take +2 damage **from this strike**" is neither a
strike bonus (which would apply even when prevented to nothing) nor
separate damage (which would get its own prevention window) — so
`CombatFrame.aimBonus` is added at `pushPendingDamage` **only to an item
whose amount is already above zero**. "A minion can play only one aim
each strike" is a **per-KEYWORD** limit where `spec.combatLimit` counts by
card NAME, so `aimsThisStrike` counts separately; with one aim card in
the pool it cannot bite today, and it is written the way the card prints
it so the next one is not free.

**Pay-to-cancel got a third currency: CARDS.** The gate was pool
(Golconda), then pool with a different payer (True Love's Face); Target
Vitals costs "two combat cards", enumerated one option per pair, and the
discards are **replaced** (p. 7 again — a cost is still a removal from
hand).

**THE KEYWORD FILTER FLIPPED FROM NEGATIVE TO POSITIVE, WHICH IS WHY IT
WAS WRITTEN THAT WAY.** Last wave's Sword of the Archangel test asserted
that no supported card carried a keyword — pinned to the *reason*, not to
a number. Shipping these two made it fail, and it now asserts exactly
`["Immortal Grapple", "Target Vitals"]` plus a live cancel. **The Sword
needed no change at all.**

Also on record: Hunting the Quarry's rush grant exposed that
`rushGrant.who.scope: "controller"` read the seat holding the BEARER, not
`entry.controller` — wrong the moment a card sits on somebody else's
minion, which is this card's whole first clause ("you still control this
card", p. 16). Same seat-identity shape as Disarm and Puppet Master, now
four times over.

**WHAT A REFERENDUM CHOOSES, AND WHO PAYS — 5 cards
(`docs/referendum-terms-design.md`). Political Action's first per-card
wave**, and it went the way the survey predicted: the politics kernel and
every gate on it are closed, so the tail is almost entirely **terms**.
Cards: **Anarch Salon** (100056), **Consanguineous Boon** (100410),
**Cold War** (102312), **Disputed Territory** (100557), **Camarilla's
Iron Fist** (102270). Political Action drops 8 → 3. **No frame changes,
no new windows** — one `EffectPrimitive` each, `referendumTerms`
enumerating and `applyReferendum` cashing in.

**`CLANS` in state.ts, derived not guessed — and the rulebook chose the
list.** p. 49 rules Consanguineous Boon by name: *"You must choose an
**existing clan**, even if **no vampires of the chosen clan are in
play**."* So the terms are the **fourteen clans the V5 crypt contains**,
not the ones on the table, and a referendum that passes on a clan nobody
plays pays nobody. That is the `CITY_TITLES` treatment exactly, with a
test re-deriving the list from `registry.json` so it cannot rot the way
the "Assamite" filter did.

**Terms learned to range over things other than seats.**
`refAllocateBurn` and `refChooseSeatsBurn` range over seats and
`refExpelMinions` over minions; three of these five needed **locations**,
**clans**, or **two kinds at once**: Cold War chooses a Methuselah *or* a
location — *or both* when the caller is a cardinal or regent, read **when
the terms are chosen**, which is the only moment the answer is stable;
Disputed Territory takes the cross product and hands the location over
with `changePermanentControl`. Every option still carries its whole
answer in the option id, so none of this needs a ChoiceFrame.

**Readings on record:** Anarch Salon's two halves **count different
things** — "each ready Anarch gains 1 blood" counts vampires, "each
Methuselah controlling an Anarch gains 1 pool" counts Methuselahs, so a
player with three Anarchs gains **one** pool (pinned by a test, because
it is exactly the kind of thing a comment loses); Camarilla's Iron Fist's
"two or more **other** Methuselahs" is measured from the **chosen** seat,
not the caller, since the sentence names the chosen one as the
beneficiary; and Consanguineous Boon counts **vampires**, which excludes
allies by construction rather than by a rule (an ally has `clan: null`).

**`spec.requiresTitled` — "a TITLED Camarilla vampire" is not
`requiresTitle`'s named list.** Enumerating the eleven printed titles
instead would be the Priority Contract trap in reverse: a filter that
silently narrows. One flag, one line in `meetsRequirements`.

**The keyword test needed rescoping, and that is the wave's small
lesson.** Consanguineous Boon prints "Boon." — a third printed keyword —
which broke last wave's assertion that the keyword-bearing cards were
*exactly* Immortal Grapple and Target Vitals. The assertion was at the
wrong level: what matters is which cards each keyword **the Sword filters
on** names. Rescoped to `named("grapple")` / `named("aim")`, so a card
acquiring an unrelated keyword no longer breaks it. **An assertion about
a total set is a hostage to every future card.**

**CARDS IN PLAY THAT CHANGE WHAT OTHERS MAY DO TO YOU — 5 cards
(`docs/opposing-statics-design.md`).** Cards: **Perfect Paragon**
(101387), **Stolen Police Cruiser** (101872), **Archon** (100084),
**Raising the Portcullis** (102303), **Haqim's Law: Retribution**
(102226). Political Action drops to **1**; the library passes **91%**.

**THE CLUSTER WAS FOUND BY READING TWO CARDS' TEXT SIDE BY SIDE.** Stolen
Police Cruiser had been cut for two waves, blocked on "a PERSISTENT
intercept penalty keyed on the blocker's kind and capacity" — accurate,
and **Perfect Paragon's superior prints the identical sentence,
action-scoped.** One filter, two lifetimes, which is the shape this engine
keeps arriving at (`ActionFrame.blockCosts` vs `alliesCannotBlock`;
`modifyBleed` vs `aura.bleed`). Building it once served both, and Archon
then wanted the same treatment for a block toll. **Survey by what the
cards SAY, not only by what they need.**

**Reading on record, and it is the one that matters: the English "and" is
a UNION.** "Allies **and** younger vampires get −1 intercept" names two
groups and applies to both; the intersection reading ("younger allies")
would make the clause nearly inert, since an ally has no capacity to be
younger *than*. `blockerMatchesFilter` in derived.ts is the shared test,
read by `ActionInterceptModified.filter` and by
`PermanentStatics.opposingInterceptPenalty`. `currentIntercept` had to
learn to look up the **acting** minion, which it never did — it already
read the action for conditional statics, so `actingMinionOf` joins that
lookup rather than adding a second.

**`PermanentStatics.blockToll` inherits the whole block-tax gate for
free.** `blockTollFor` now takes the acting minion and sums the
persistent tolls on it alongside the action's, so Archon's "vampires
attempting to block the attached vampire burn 1 blood" automatically gets
p. 22's consequence: **an ALLY cannot pay a toll printed in blood and
therefore cannot attempt at all**, and the toll is paid to *attempt*, not
to succeed. Pinned by a test.

**`noBloodHunt` returns without pushing the referendum at all** rather
than pushing one and discarding the result — a referendum nobody's vote
can change is a decision with no consequence, and the engine's standing
rule is not to open one.

**The first aura condition that reads ANOTHER seat's board.** "While your
prey controls a vampire in torpor" is `whilePreyHasTorporVampire`,
**derived on every read** (`auraBonus` asks `preyOf`) — the retainer
wave's rule, for the same reason: the condition can stop holding for
reasons no code is watching, including an oust that changes who your prey
*is*.

**A silent-default bug found by my own test fixture.**
`handler.permanentStatics` was set by exactly two type compilers, so
**every other card carrying a `permanent` block answered `undefined`** —
including Archon, a political action that attaches itself. The real card
path was fine (it reads the spec), but any consumer asking the handler
got nothing, which is the `permanentTags`/`costTypes` failure verbatim.
`compileSpec` now backfills both centrally.

**"Assamite" for the fourth time** (Haqim's Law prints it; the registry
says Banu Haqim), with a negative test asserting the legacy name matches
nothing.

**THE CRYPT AND THE UNCONTROLLED REGION — 5 cards
(`docs/crypt-and-uncontrolled-design.md`). The last five BUILDABLE
Masters**, so Master finishes at 5 unsupported and **all five of those
are BLOCKED, not deferred** (four Path-following, one zombie). Cards:
**Chantry** (100329), **Grooming the Protégé** (100860), **Wider View**
(102180), **Family Gathering** (102289), **Yawp Court** (102199).
Library passes **92%**.

**Four of the five reach into the two zones the engine had barely
used** — and needed **no new zone and one new event**. Everything the
influence phase already owns (`SeatState.crypt`, `UncontrolledEntry`,
`CryptCardDrawn`, `UncontrolledBloodAdded`) turned out to be the whole
vocabulary; what was missing was **`CryptCardBuried`** (top → bottom, the
crypt twin of `CardBuried` — the crypt is drawn from the FRONT, so the
bottom is `push`) and **`UncontrolledRemovedFromGame`**, because
`removeMinionFromGame` only knows about minions in PLAY.

**A DESIGN NOTE I GOT WRONG, corrected by the first test run: blood put
on an uncontrolled vampire IS its influence counter.** I had written that
the two were separate piles and that Grooming the Protégé would need a
second field. p. 35–36 says influence moves counters one-for-one from the
pool and "they become its blood on taking control" — and
`UncontrolledBloodAdded` has always added to `UncontrolledEntry.counters`
for exactly that reason. **The engine was right and the doc was wrong**;
the doc now records the correction rather than the mistake.

**Transfers became a currency.** Wider View is the first card to spend
them on something other than influence, so **`EngineOps.spendTransfers`**
joins `spendMasterAction()`. Both its clauses are therefore
influence-phase abilities.

**Yawp Court landed on machinery built two waves apart and needed no
sequencing change at all**: `action.afterResolution` is the window
immediately before the action pops, and `finishAction()` — which runs
when it closes — flushes `queuedCombats` and *then* pushes the
referendum. So "if a political action is successful, **before the
referendum**" is that window, and the combat happens first because the
queue flushes first. `queueCombat` gained an optional `AfterCombatRider`
so the 2 environmental damage rides along.

**AND THE BUG THAT COST THE MOST, which is a TypeScript trap worth
remembering: `af.referendumSource !== null` was TRUE FOR EVERY ACTION.**
The frame spread *omits* the field when there is no source, so it is
`undefined`, and `undefined !== null` is true — Yawp Court was offered
during a plain bleed. **Use truthiness, not `!== null`, on a field that
is optional rather than nullable.** Caught only by the negative test;
the positive one passed throughout.

**Readings on record:** Family Gathering is an **instruction, not a
choice** ("if it is a Hecata, draw it … otherwise" has no "you can", the
Rebel precedent) and its *reveal* needs no modelling, because the card
either becomes public in the uncontrolled region or goes face down into
a crypt its owner may read anyway (p. 14) — **nothing learns anything it
could not already know**, so the phase-6 "who has looked at this card"
gap is untouched. Chantry frees **any Methuselah's** Tremere and they go
home to **their own** controller. Wider View's draw-and-remove is **one
clause with one cost**, so it is offered only when both halves can
happen. And Yawp Court's "the referendum is conducted as normal"
**describes** what happens anyway — reading it as an instruction would be
the "the minion chooses a strike again" trap for the third time.

**THE LAST FOUR COMBAT CARDS, AND A VEST — 5 cards
(`docs/last-combat-design.md`). COMBAT FINISHES AT ZERO**, the third card
type after Retainer and (buildably) Master. Cards: **Dust Up** (100597),
**Taste of Vitae** (101945), **Hunger of Marduk** (102227),
**Anticipation** (102350), **Kevlar Vest** (101040) — the vest joins them
because it is a combat card in everything but its printed type. Library
passes **93%**.

**BLOOD LOST IS NOT DAMAGE TAKEN, and that distinction needed its own
tally.** `CombatFrame.damageTakenThisRound` existed (Flesh of Marble) and
is the wrong number for Taste of Vitae: damage is what was *inflicted*,
blood lost is what the victim actually *burned to mend* (p. 31), and they
come apart exactly where it matters — a vampire who cannot mend
everything goes to torpor having burned only what they had, and an ally
burns life, not blood. **`CombatFrame.bloodLostThisRound`** is measured
across the whole of `applyResolvedDamage` with one before/after read, so
every path is covered by one site. Same shape as *queued* vs *inflicted*
damage, which the round-recurring wave had to separate.

**`grantedStrikes` grew a payload and a lifetime.** It held bare
`StrikeKind`s; Hunger of Marduk grants "strike, ranged: steal **2** blood
**this round**", so it holds `GrantedStrike { kind, amount?, roundOnly? }`
— and the round-scoped ones are filtered out at the round boundary,
unlike Treasured Samadji's once-per-combat grant. That is the third
mechanism to land in that list, and the first to need it to be more than
an enum.

**`PendingDamage.fromGun` is set at the push chokepoint, not recomputed
in the prevention window** — by the time Kevlar Vest is offered the
strike may have been replaced by an additional sub-round, so **a fact
about an item belongs on the item** (the `damageCycleLen` lesson).
Reading on record: "any other source" includes environmental and retainer
damage, which have no strike at all, and `fromGun` is false for them by
construction.

**"Cannot be dodged" is one condition on two early returns.** A dodge is
implemented as `if (victimStrike?.dodge) return;` in the damage and
non-damage paths, so `Strike.undodgeable` gates both — and it lives on
the STRIKE, not the frame, because it is a property of the blow and Dust
Up prints it on one mode of three. **Reading on record: it does not
change anything else about the dodge**, only that the dodging minion does
not escape *this* strike.

**A pre-existing narrowness the wave exposed:** the `combat.endOfRound`
option branch demanded an `attachInCombat` effect and skipped the mode
otherwise — fine while attaching was the only thing done there (Disarm),
and wrong the moment a card did something else at end of round. Taste of
Vitae was simply never offered until the branch learned to fall through.
**A switch that returns early on "not the shape I know" is a filter that
is empty for the wrong reason.**

**Anticipation's cancel is the Vozhd of Gravesend's clause from a card in
HAND**, and needed no `abilityInAsPlayed` — that opt-in guards *abilities
of cards in play*, and p. 7 already permits a cancel card in another
card's as-played window. `CardPlayFrame.isStrike` answered "is it a
strike card" unchanged. **"The minion chooses a strike again" is the
FOURTH card in five waves whose parenthetical describes existing
behaviour** rather than asking for new behaviour.

**THE LAST EQUIPMENT AND THE LAST MODIFIERS — 6 cards
(`docs/last-equipment-modifiers-design.md`). EQUIPMENT FINISHES AT ZERO**,
the fourth card type after Retainer, Combat and (buildably) Master; Action
Modifier finishes at two, both wraith/zombie-BLOCKED. Cards: **Bowl of
Convergence** (100243), **Flaming Candle** (100743), **Living Manse**
(101114), **Monkey Wrench** (101239), **Spying Mission** (101857),
**Go-getter** (102355 — PARTIAL). Library passes **94.6%**.

**THE SURVEY IS THE MORE IMPORTANT HALF, AND THE OWNER SHOULD SEE IT.**
The queue asked for one that separates blocked from buildable, and the
answer is stark: of the 24 unsupported library cards, **20 are BLOCKED** —
**14 on wraith/zombie**, 4 on Path, 2 on token vampires. **All seven
remaining allies are wraiths or zombies, and so is the last Reaction.**
The wraith/zombie gate is now **the single largest blocker in the pool**,
larger than the ash heap ever was (9) when the owner unblocked it. It is on
the do-not-build list, so this wave did not touch it; §0 of the doc costs
it out — **nine of the fourteen need only a printed sub-type tag**
(`permanentTags` already carries "ghoul"), and five need real work
(Spectral Servitor acts the turn it is recruited; Rotting Behemoth rushes
for life; Bone Shambler and Gravebound Drone reason about *another copy of
themselves*; Split the Veil returns a MINION from the ash heap to play).
**The buildable remainder is four cards.**

**A LIVE BUG THE WAVE HAD TO FIX FIRST: only 2 of the 17 equipment cards
carried the "equipment" tag.** That tag is what every "burn an equipment"
enumerator reads — `actionOnPermanent` (Conceal, Rewilding),
`Strike.burnEquipment`, the granted burn-equipment strike, and Anarch
Troublemaker's parting shot — so all four had been looking at a nearly
empty table. Fixed centrally in `backfillCentralQueries`, so a hand-rolled
handler (.44 Magnum) cannot forget it either. **And Living Manse is the
sharpest possible test of the fix**, because its whole first clause is
*not being equipment*: the opt-out is a tag (`notEquipment`), keeping the
question inside the vocabulary that already answers "location / vehicle /
ghoul", and the test asserts both directions with Conceal end to end.

**A SECOND PRE-EXISTING BUG, AND IT IS THE `meetsRequirements` ONE FOR THE
THIRD TIME:** `compileEquipment.options` never called it, so the
"Requires" lines on **Shilmulo Tarot, Treasured Samadji and Stolen Police
Cruiser** were unenforced. It also never checked `exclusiveKey`, which no
equipment card had carried until Living Manse. Both fixed in that loop,
with a table-driven regression. Same shape as the first two instances: a
too-permissive option list is **structurally invisible to the fuzz**, and
nothing asserted it.

**`ConditionalStatic.bearerDiscipline` — the first condition that is about
the BEARER rather than the action.** Bowl of Convergence's "+1 intercept
to the bearer **with Auspex**" reads `disciplinesOf`, never the printed
field, so a Discipline master switches the card on and losing it switches
the card off — which is exactly why it cannot be settled when the card
attaches. A test grants the Auspex with a master and watches the intercept
appear. Its blood-for-intercept half is an **equipment ability**
(`permanent.equipmentAbilities`, the `allyAbilities`/`retainerAbilities`
shape) — **`permanent.lockGrant` is still compiled inside `compileMaster`
and still cannot reach another card type**, and this card did not change
that, because a self-grant with a blood cost and no lock is not what
lockGrant's eleven knobs express.

**Reading on record: Bowl's ability is repeatable, because the card prints
no limit — and that is harmless**, since p. 26's only-when-needed gate
makes the option vanish the moment intercept catches up. It can close a
gap, never build a lead.

**Spying Mission needed NO new window: "if a bleed would be successful" is
p. 27 A.4's state C.** Its cut-list row had said it wanted "a window of its
own"; state C — every Methuselah has passed, the action has not resolved —
is the one moment the bleed is known to be going through and no block can
still be declared, and **both** halves of the card live there. The play is
`afterResolutionAttach` (Shadow Cast's, with `recordTarget` writing
`againstSeat`) plus the new `failAction` primitive; a failed bleed
transfers no pool, so "burns no pool" needed no clause. The payout is
**mandatory** (no "you can" — the Rebel precedent), so it fires from the
new **`onBlocksDeclined`** hook, hung on the single A→C transition in
settle. **Reading on record: the +2 is NOT "(limited)"** — by then it is an
ability of a card in play (the Club Illusion precedent), which matters
because the whole point is that it lands after the defender has already
declined to block. A test plays a limited Monkey Wrench on the same bleed
and asserts they stack.

**Go-getter ships PARTIAL, and the deferral is now COSTED rather than
named.** p. 27 settles the window against the cheap reading: step 3 is
*Resolve the Action* and a blocked action goes through it ("any card played
to perform the action is burned and the block is resolved"), so the
combat happens **inside** resolution and "after resolution of a blocked
action" really is `action.afterResolution` — not Form of Mist's
`step === "blocked"` moment. Continuing from there means **re-entering
resolution**: a "tail already run" guard on four things that must not
repeat (`notBlockPenalties`, `blockPenalties`, the action card's burn,
`drawAfter`) plus a decision about a second `ActionResolved` for one
`actionId` and the archetype hooks firing twice. Moving the window earlier
is ruled out by **p. 52's Voter Captivation ruling** ("you cannot play it
to regain pool and survive if the referendum leaves you at 0 pool" is only
true because the effects have already happened). Kernel change on the
hottest path in the engine, for one mode of one card — owner review first.

Also built, small: **`modifyBleed.xRange`** ("+X bleed (limited). X must be
1, 2 or 3" — one option per X with `x=N` in the option id, the
`bankStealth` shape, and the limited gate widened so a variable bonus is
treated as the increase it always is).

**THE LAST BUILDABLE FOUR — 4 cards (`docs/last-buildable-design.md`).
EVERY BUILDABLE LIBRARY CARD IS NOW SUPPORTED**; Political Action finishes
at zero, Action at four (all blocked). Cards: **Fiendish Tongue** (100726),
**Revelations** (101627), **Deep Song** (100515), **Revolutionary
Council** (101631). Library passes **95.5%**.

**REVELATIONS IS THE FIRST CARD IN THE POOL THAT REVEALS HIDDEN
INFORMATION, and it makes the recorded phase-6 gap REAL.** This file has
carried "no implemented card reveals hidden information yet, so nothing is
wrong today" since `PlayerView` was completed. That clause is now false.
The two halves are not equally hard, and the difference is the retainer
wave's: the **superior** ("your prey plays with an open hand") is
*structural and continuous*, which is what masking is good at — one term
in `openHandsFor`, defeating both `redactFor` (names) and `viewFor`
(counts), with "prey" derived on every read so an oust moves it; the
**basic** ("look at your prey's hand and discard one") is a *momentary*
reveal, correctly modelled — the prey's hand appears only in a ChoiceFrame
addressed to the actor and the log records only the discard, so nothing
leaks and a replay reproduces the game — but the actor's lasting MEMORY of
the cards they did not take is not in `PlayerView`. A hotseat human simply
remembers; a phase-5 AI seat will not. **Ledgered under deliberate
simplifications**, so phase 6 has a card to point at.

**DEEP SONG'S FIVE-WAVE BLOCKER WAS THE TWO ARGUMENTS TO `pushCombat` IN
THE OTHER ORDER.** The ledger said "it INVERTS combat roles" — and every
question of the form "who is acting in this combat" reads `cf.acting`, so
a frame built the other way round IS the inverted combat.
`ActionFrame.invertCombatRoles` carries it from announcement to the single
rush push in `finishAction`. **That is the FIFTH cut-list row in eight
waves whose blocker had already been built or was cheaper than written
down** (Touch of Valeren, New Carthage, Break the Bonds, Hunting the
Quarry, Spying Mission). *A deferral is a claim about the code as it was.*
Its "and lock a vampire" sits well with the inversion: an acting minion is
normally locked at announcement (p. 25), so the vampire being *treated* as
one ends up locked like one.

**The frenzy classification test had to be rescoped, the keyword-test
lesson again.** `frenzyTargetSide` answers "which COMBATANT is this used
on" — a combat question, which Tranquility Shield's immunity and
Meditative Grove's cancel both ask. Deep Song is a frenzy **action** card,
played before any combat exists, so it has no side and no shield can reach
it. The assertion now pins the frenzy *combat* cards, and names the
non-combat ones separately. **An assertion about a total set is a hostage
to every future card.**

**Fiendish Tongue's third clause OUTLIVES ITS OWN CARD.** "This Tzimisce
can burn 1 blood during your next discard phase to unlock" — but an action
card is burnt at resolution (p. 27), so there is no card in play to hang an
ability on and no handler enumerates for a bare minion. The permission
lives on the minion (`MinionState.discardPhaseUnlock`, cleared on
`TurnBegan`) and the option is a **built-in**, the shape a granted press or
maneuver credit already uses. Two readings on record: it does **not**
consume the discard phase action (p. 37 grants one by default and the card
does not say "discard phase action" — the Judgment: Camarilla Segregation
precedent, where the phrase's absence was decisive the other way); and the
permission is one chance, expiring with the turn. Its "Anarchs get −1
intercept" is `modifyFilteredIntercept` with a new **sect** arm on the
union, registered **at announcement** with the block restrictions — the
bleed-riders-sweep rule.

**Revolutionary Council is the first HETEROGENEOUS allocation**, and the
new piece is a per-target **cap**: a location or equipment is *burned* by a
point, so a second on it is not a distinct choice. **Measured: with four
choosable Anarchs and four locations it produces 2168 legal terms — the
largest option list in the engine.** That is the card's real legal space,
not an enumeration bug, and the caps keep it to four figures. If it ever
needs cutting, the move is a sequence of ChoiceFrames at the terms step
(the `unlockToll` shape), not a cap on what is legal. Note the caller is
never one of the chosen: it locked at announcement and the card says
"ready **unlocked**".

**TEMPORARY HAND SIZE — 2 cards, and it is a LEDGER wave, not a gate
(`docs/temporary-hand-size-design.md`).** Both cards were already
supported with a row in `docs/partial-support.md` saying the same thing
("temporary hand-size bonuses are unmodelled"): **Dreams of the Sphinx**
(100588) "+2 hand size until the end of the turn" and **Rage of Apedemak**
(102336) "this combat, you get +1 hand size". Two rows retired, no card
count change.

**THE RULEBOOK RULES DREAMS OF THE SPHINX BY NAME (p. 50), and the ruling
settled the design rather than leaving it to a reading:** *"If you use it
during your turn to increase your hand size, **you first have the option
of using a discard phase action to discard a card (and replace it) before
decreasing your hand size back to normal by discarding 2 cards**."* So the
bonus is a **dig, not a gift** — the cards come back — and the expiry
lands **after the discard phase**, which is a real ordering constraint.
Putting the expiry at `endTurn` satisfies it with no rule of its own,
since the turn order puts end of turn after the discard phase.

**What was actually missing was the OTHER HALF OF p. 7.** *"Whenever an
effect changes your hand size … immediately discard down to or draw up to
match your hand size."* `handSizeOf` was the read and `reconcileHandSize`
was the draw-up; **nothing in the engine had ever discarded down because a
hand size FELL** — the one existing discard-down (Telepathic Vote
Counting) fires because a card came *back* to the hand.

**The bonus is DERIVED from a live frame, never stored** —
`HandSizeGrant` on `TurnFrame.handSizeBonus` ("until the end of the turn":
`endTurn` *replaces* the frame) and `CombatFrame.handSizeBonus` ("this
combat": the frame pops however the combat ended). **This is the Raptor
rule** (`docs/retainer-wave-design.md` §1) applied a second time, and
`handSizeOf` already walked `state.frames` for it, so the bonus is one
more term in a loop that existed. Both fields optional — the `idSeq`
precedent — so every fixture and saved log is untouched. The grant is
keyed by **seat**, not by the frame's owner: Dreams prints no timing
restriction, so locking it during a predator's turn to dig for a reaction
is a real play, and the turn frame holds that perfectly well.

**The discard-down is ENGINE-OWNED, the first `ChoiceFrame` key that is.**
Every other one is answered by a card handler, but p. 7 is a rule of the
game and the two cards that reach it are **a bespoke handler and a pure
`compileSpec` card** — so a card-owned version would be written twice, and
*one question answered in two places where only one learns about a new
case* is exactly how `modifyVotes`/`restrictVotes`, the two
after-resolution probes and the Scalpel Tongue enumeration each drifted.
`key === "handSizeDown"` is intercepted ahead of the handler lookup, at
one helper (`choiceOptionsFor`/`applyChoiceFor`) that all **three**
dispatch sites now call — including settle's empty-list pop, which is easy
to miss. It is a **repeated, non-optional** frame (one card at a time,
re-raised), the `unlockToll` shape; the re-raise is safe because
`choose()` already pops before applying, and the comment there already
anticipated "the discard-down loop".

**`replace: false`, and this is the sharp edge:** a discard-DOWN is not a
cost and not a play, so nothing is drawn back — while a discard paid as a
COST *is* replaced (p. 7 does not care why the card left). **The two look
identical in code**, which is the trap the unlock-tolls wave found.

Also on record: Rage of Apedemak stays classified **self-targeting** —
`frenzyTargetSide` reads an allowlist of opponent-targeting effects, so a
new primitive leaves the answer alone, and a Tranquility Shield still
cannot stop it. And the bonus is **not a debt**: an empty library draws
nothing (p. 7) and the expiry then finds nothing to shed (pinned).

**THE WRAITH/ZOMBIE GATE — 14 cards, UNBLOCKED BY THE OWNER 2026-09-02 and
BUILT (`docs/wraith-zombie-design.md`).** It had been the largest blocker
in the pool — bigger than the ash heap was when that was unblocked the day
before — and it gated **every remaining ally and the last reaction in the
game**. Cards: Screamer (102292), Bone Shambler (102293), Shadow Sentinel
(102294), Spectral Servitor (102296), Split the Veil (102297), Paths in
Two Worlds (102300), Rotting Behemoth (102304), Burial Site Hunting Ground
(102311 — PARTIAL), Cursed Abattoir (102313), Dance of the Dead (102314),
Fiorella Empty One (102322), Gifts From Hereafter (102325), Gravebound
Drone (102326), Heartrender (102327). **Library 424 → 438 of 444
(98.6%).** Ally, Reaction and Action Modifier all finish at zero.

**THE FINDING THAT SIZED THE GATE: "wraith" and "zombie" appear NOWHERE in
the rulebook.** Not in the Allies section (p. 11), not in Important Terms,
not in the glossary — and even **"ghoul" is only flavour** there ("a mortal
who drinks the blood of a vampire", p. 45), never a game term. So a wraith
and a zombie are **ordinary allies with a printed sub-type**, the word does
exactly one job (other cards filter on it), and the gate needed **no ruling
and no rules subsystem**. This is the *opposite* of Stun, which needed an
owner ruling because the word was defined by nobody. **The blocked list was
right that this was a gate and wrong about the kind: it was a VOCABULARY
gate, not a mechanics one.**

**The sub-type needed NO new state.** An ally's card text already rides
into play as a self-attached entry, and `permanent.tags` there is already
how "ghoul" is expressed — so `ally.subtype` is sugar that lands in the
same place, and `minionTags` / `minionHasTag` / `isUndeadAlly` in
derived.ts read it. **The two zombies already in the pool (Aggressive
Corpse, Freakish Conglomeration) were already tagged**, so the new filters
saw them from the first line of code. `minionTags` reads the SELF entry
only — a ghoul retainer on a wraith must not make the wraith a ghoul.

**"Another copy of this ally you control" is a QUERY, not state** (Bone
Shambler, Gravebound Drone): a minion knows its own name, so `otherCopies`
is a lookup — the Week of Nightmares lesson (the record already exists) in
a new place.

**Split the Veil is the first effect that puts a MINION back into play.**
Every other ash-heap card moves a library card. It needed no new zone: the
heap holds `CardInstance`s and `EngineOps.registry` answers `allyEntry`,
which is what `AllyEnteredPlay` wants. **Reading on record: it is a MOVE,
not a recruit** (`recruited: false`), so p. 22's "cannot act the turn it is
recruited" does not apply and the ally acts at once.

**THREE REAL BUGS, all the same shape — machinery that existed, was
documented as general, and quietly did not apply to one case:**
1. **An ally's entry never merged its MODE's statics.** A retainer's
   `permanentEntry` always did; `compileAlly.allyEntry` copied only the
   card-level ones, so a superior-only clause written as mode statics was
   **silently inert** — it would have hit three of this wave's superiors at
   once.
2. **The ally entry path never fired `onEnterPlay`**, a hook documented as
   firing "from both entry paths". It was dead for **every ally in the
   game**; Rotting Behemoth is the first card to need it.
3. **`compileSpec` installed its ChoiceFrame dispatcher MID-FUNCTION**, and
   only `if (Object.keys(choiceByKey).length > 0)` — so a clause
   registering a key below that point got no dispatcher and its question
   was never asked. Installed last now. That is `choiceByKey`'s own failure
   mode: the map made two clauses safe to coexist, and the ORDERING of its
   consumer was left unguarded.

**Two clauses correctly do nothing, and both are ledgered** (the Wall
Street Night standard): **Burial Site Hunting Ground** is PARTIAL — its
"vampire who follows the Path of Death and the Soul" branch is written and
enumerates nothing, because **Paths are out of scope per the scope lock**;
this is the one card that sat on *both* blocked lists, and unblocking
wraiths did not unblock Paths. **Rotting Behemoth**'s "an ally **or
vampire** in your ash heap" matches only allies, because **burnt vampires
are deliberately unmodelled there** — phase 7 gives it the other half free.
The pool also contains **no wraith or zombie RETAINERS**, so Cursed
Abattoir's "(ally or retainer)" retainer half is written where it can be
seen and built when a card needs it.

Also on record: **Heartrender's removal of itself is a COST, so it happens
at resolution** — a blocked action removes nothing, which is how every
other granted cost behaves (p. 27); **a stealth REDUCTION is offered only
when it can change whether a block succeeds** (the mirror of p. 26);
**Shadow Sentinel's superior drops the word "Only"** from "Only usable by a
locked vampire", which is the whole difference — it may be played by an
unlocked vampire, because the vampire is not the one waking; and **Cursed
Abattoir's counter is taken automatically**, being costless, purely
beneficial and unpunished by anything on the card (the Show of Force
reading).

**THE TOKEN-VAMPIRE GATE — 2 cards, UNBLOCKED BY THE OWNER 2026-09-03 and
BUILT (`docs/token-vampire-design.md`).** **Waters of Duat** (102159) and
**Childe of the Revolution** (102246) — the same card twice: "+1 stealth
action. Put this card in play. It becomes a **1-capacity (non-unique)
vampire** and **must hunt this turn**." **Library 438 → 440 of 444
(99.1%).**

**A TOKEN VAMPIRE IS AN ALLY WITH `kind: "vampire"`.** The engine has
turned a library card into a minion since the allies gate — that is what an
ally *is* — so this is the same machinery with `capacity: 1`, a clan and a
sect. No new zone, no new lifecycle, and every existing question (can it
act, block, be rushed, be diablerized) answers itself. Its own card rides
as a **self-attached entry**, and that is load-bearing rather than
decorative: `burnMinion` burns every attached card, so the self entry is
what files the CARD in its owner's ash heap when the vampire dies (p. 16).
Without it the card would vanish from the game.

**"…and must hunt this turn" needed NO CODE.** The token enters with **0
blood**, which is derived from the card rather than assumed — it says the
vampire must hunt, and one that arrived with blood would have no reason to.
p. 21's mandatory-hunt rule then produces the printed sentence exactly:
`minionPhaseOptions` already filters `kind === "vampire" && blood === 0`
and offers *nothing else at all* until it hunts. Recorded limit: the engine
says "while at 0 blood" where the card says "this turn", which comes apart
only if the token gains blood before acting — nothing in the pool can.

**THE RULEBOOK DEFINES "STERILE" (glossary, p. 42): "Sterile vampires
cannot perform actions to put new vampires in play."** Both cards require a
non-sterile actor, and **these two are the only "actions to put new
vampires in play" in the pool**, so the requirement line is the rulebook's
own cross-reference. **No V5 card grants the trait** — a survey of all 661
finds the word only on these two — so `MinionState.sterile` is set by
nobody and the filter correctly passes every vampire. It is modelled rather
than skipped because it is a rulebook trait and **phase 7's crypt importer
is where it would come from**, the same position `clan`/`sect`/`title` are
in now. A test pins that it is empty for the *right* reason.

**A LIVE BUG THIS GATE EXPOSED, and it was one wave old.**
`removeMinionFromGame` burned every attached card *including the minion's
own self-attached card*, and `PermanentBurned` files a card in the ash
heap — so a minion **removed from the game** was leaving its card in a
public, searchable zone, which p. 16 forbids ("cannot be retrieved or
affected in any way"). It only became reachable last wave: **Heartrender
removes itself from the game and Split the Veil retrieves an ally from the
ash heap.** The comment on that function had *predicted* the problem
("when it exists, this is the branch that must not put the card there") and
the ash heap arrived before the branch was updated. `PermanentBurned`
gained an optional `removed` flag, set only for the minion's own card; its
equipment is still burned to the ash heap, which is what p. 16's own
sentence says.

**The Discipline search reads THREE ZONES AT ONCE** ("your library (shuffle
afterward), hand, and/or ash heap"), where every earlier search read one.
The candidate list is the union with each option carrying its zone, and
`EngineOps.attachFromZone` moves the card straight onto the minion — **not
a play**: no cost, no `CardPlayed`, which is the same wording the rulebook
uses for diablerie's Discipline gain (p. 34). The library-search gate's
rules carry over unchanged: you need not announce what you seek, **finding
nothing is always legal** (p. 48), and **the library is shuffled either
way** (p. 14) — which is why "Find nothing" is an ordinary answer rather
than a decline, since an optional frame's decline never calls `applyChoice`
and would skip the shuffle. The Discipline masters carry
`tags: ["discipline"]`, so identifying them is a tag test rather than a
list of six names that could rot. **`CardLeftAshHeap` (added one wave ago)
was generalised to `CardLeftZone`** rather than gaining a near-identical
sibling — two events for one idea is how vocabulary drifts.

**Readings on record:** "Follower of Set" is the **Ministry** (the fifth
card to print a legacy clan name, after Priority Contract, Yoruba Shrine,
Haqim's Law and Opium Den); **"non-unique" needs no modelling** because
crypt uniqueness is already an unmodelled deviation; the token **enters
ready and unlocked**, since p. 22's "cannot act the turn it is recruited"
is an ALLY rule and it must be able to act or "must hunt this turn" would
be unsatisfiable; and Childe reads the actor's clan **once, at
resolution** — nothing links parent and child afterwards.

**THE PATH CARDS — ALL 4 SHIPPED 2026-09-03
(`docs/path-cards-design.md`), and the wave is in TWO halves because the
first survey got it wrong. Read §0 of that doc before trusting any
blocker in this file.** Cards: **Absolute Tyranny** (102308),
**Terrifying Visage** (102343), **Privileged Position** (102334),
**Forward Momentum** (102323) — plus the Path branch of **Burial Site
Hunting Ground** (102311), which retires its PARTIAL row. **Library
441 → 444 of 444 (100%).**

**THE CORRECTION, and it is the lesson: a Path is a PRINTED CRYPT TRAIT.**
The morning survey found that six cards filter on a Path and none grants
one, and concluded the set was permanently empty — cutting three cards
pending a decision to widen the pool. The finding was true and the
inference was wrong, because it assumed a Path must be *granted by a
library card*. It is not: KRCG carries `path` on the vampire's own
record, and **all 48 Sabbat V5 vampires already in the pool have one**
(Cathari 12, Death and the Soul 12, Power and the Inner Voice 12, Caine
12). **The real blocker was one line in the pipeline** —
`toCryptDef` in `scripts/build-registry.mts` copied clan, capacity,
group, disciplines and card text, and silently dropped `path`. So the
data was in `data/vtes-raw.json` the whole time and nowhere the engine
could see it. `MinionState.path` now sits exactly where `clan`, `sect`
and `title` sit: set by fixtures today, read off the crypt card by
phase 7's importer (`src/ui/cardinfo.ts` already carries it).

**The scope lock never needed breaking, and it stands.**
`config/v5-sets.json` is untouched — widening to all 4,149 KRCG cards
would not have helped, because **the full legacy pool contains no
Path-granting card either**. The 15 legacy cards named "The Path of …"
are thematically-named masters (The Path of Night is an Obtenebration
discount for Lasombra), and the one true Path card in KRCG — Path of the
Void, a 2008 promo — grants a Path nothing in our pool filters on.

**The distinction that ran the whole wave, and it survives as the tests'
control case: a POSITIVE filter over an empty set matches nothing; a
NEGATIVE filter over an empty set matches EVERYTHING.** That is why
Absolute Tyranny worked while `path` was empty (its superior reads
"vampires who do **not** follow…") and why the other three could not even
be played. With real Paths flowing, both directions simply work, and a
vampire with no Path is still the control for each.

New pieces, all small: **`PermanentStatics.blockedPoolToll`** — "if this
vampire is blocked, the **blocking minion's controller** burns 1 pool
before block resolution", a SIBLING of `blockedToll` rather than a
`payer` flag on it, since that static's `payWith: "blood" | "bloodOrLife"`
union is specifically about a *minion* paying and this is a *seat* paying
pool. Same timing, same site, opposite payer. Two readings on record:
it is paid on a **successful block only** ("if this vampire is blocked" —
a failed attempt does not block them, so this is not the block tax, which
`blockCosts` charges to *attempt*), and **an unaffordable toll does not
bar the block** — the card names a penalty, not a price, so a Methuselah
pays what they have. The identical sentence is printed on the crypt card
**Aelswith, The Irresistible**, so phase 7 already has a user.

**`requiresControlledPath: { path, count }` is the first requirement that
COUNTS.** Its three siblings (`requiresControlledSect`/`Clan`/`Title`)
ask whether *some* ready vampire matches — one `.some()` with every
filter ANDed onto one minion — which cannot express "2 or more". It goes
in the same `controllerMeetsRequirements` helper all three enumeration
sites call, so adding it in one place covers them by construction (that
helper is where the pre-existing `requiresControlledTitle` bug was
fixed).

**Privileged Position needed NO new window.**
`referendum.afterResolution` was built for Voter Captivation and friends
and already has both properties it wants: it opens **only on a pass** (so
"after a referendum … passes" needs no test of its own) and it already
calls `abilityOptionsFor`, so a card *in play* can act there — which the
three cards that built it never used, all being cards from hand.

**Forward Momentum's two directions are ONE hook, deliberately.** The
obvious build puts the +1 on `onBleedSuccess` and the −1 on
`onActionResolved`, and that is a trap: two separate definitions of
"successful (for 1 or more)" in two files, and the day one drifts the
card both adds and burns a counter on the same bleed. One hook, one test
(`success && currentBleed(state, af) >= 1`). `onActionResolved`'s info
gained **`actionKind`**, which was always on the frame and simply never
passed on. Readings on record: **a BLOCKED bleed burns a counter** (p. 27
— a blocked action still resolves, unsuccessfully, and the card's
"otherwise" is unqualified), which is also why testing `success` alone
would be wrong, since a bleed reduced to 0 resolves successfully and must
still burn one; the counter is **clamped at zero**; and clause 2 says
"performs an action", not "performs a *successful* action".

**A TEST-FIXTURE TRAP WORTH REMEMBERING, because the engine was right and
my walk was wrong.** The negative test for "requires 2 or more" walked
the game forward taking `options[0]` when no `pass` existed — and at step
20 it chose **`leave:V2`**, hauled the fixture's torpor vampire into the
ready region, and so satisfied the very requirement it was asserting
could not be met. A test walker must prefer `pass`, then `end`, and only
then anything else: **a walker that takes the first option plays the
board.** The same test also re-taught that *declaring* a block is not
*resolving* one — the impulse cycle has to run out before
`BlockSucceeded` and its toll.

**Two guards fired exactly as designed, and one of them is a landmark.**
The ledger test failed because the three cards were still on the cut list
(the third time it has caught a shipped card left listed), and
`tests/ui/playtest-decks.test.ts` failed with its own message —
*"the pool is fully implemented — retire this test"* — because there is
no longer an unsupported library card to use as its example. Both were
rewritten to assert **why** they are now empty rather than to require a
non-empty list, so neither becomes vacuous and both come back on their
own if the pool ever widens past what is implemented.

**The V5 rulebook does not mention Paths at all** — not "Path of", not
"Paths", not "Humanity", not "Enlightenment" (the same result the
wraith/zombie survey got). So there is no Path subsystem to build and no
ruling to ask for: a Path is a **trait you filter on**, and the four
cards are four different filters. That is also why it needed no owner
ruling, unlike Stun, where the word was defined by nobody.

Built for Absolute Tyranny: **`modifyAllVotes`** → `ReferendumFrame
.voteModifiers`, a per-vampire vote modifier scoped to ONE referendum,
where every other vote modifier is either a bonus to the player
(`modifyVotes`) or a permanent aura from a card in play (New Carthage). It
lands in the single place votes are counted, beside `auraBonus`, and is
**clamped at zero the same way** — a negative takes a vampire's votes away,
it never hands their opponents votes *against*.

**Readings on record:** the superior **replaces** the basic (it does not
print "As above, and…", unlike Rage of Apedemak's "As above, but…"); the
penalty reaches only votes **not yet cast**, because a source spends its
votes once at a count read when it casts and the tally is a fold over
those events; and **it hits the caster's own untitled-Path vampires too**
— the card exempts only those on the Path of Power, and exempting the
caster as well would be inventing text.

**THE LIBRARY AUDIT — 2026-09-03, owner-requested once the library hit
100% (`docs/library-audit.md`).** A sweep of all 444 supported cards for
anything skipped, half-built or quietly cut, run **against the code and
the card data rather than against the ledger** — the Path wave having
just proved that a written blocker goes stale. **The library is
complete**; the ledger was accurate; three things were found and fixed.

**The Terror Frenzy class is CLEAN across the whole library.** Comparing
every spec's modes against its printed clauses found exactly one card
with fewer modes than the card prints — **Go-getter**, already ledgered.
Every supported card resolves to a registered handler. That negative
result is worth as much as the positives.

**THE REAL FIND: Aggressive Corpse (102286) had three unimplemented
clauses recorded in a CODE COMMENT instead of the ledger** — "Remaining
clauses are moot for now: no dodge exists; no supported directed action
requiring [dom]/[pre] can target a minion; no supported effect can grant
life to an ally". **Every claim was true when written and false when
read**: `undodgeable` arrived with Dust Up, `cannotGainLife` with the
wraith/zombie gate, and **the `[dom]`/`[pre]` bar was LIVE — Entrancement
superior steals an ally**, which is exactly what the card says cannot
happen to it. This is the Terror Frenzy rot one layer down, and it
escaped because `partial-support.md`'s test can only see a comment that
says `PARTIAL:`. All three now built.

New pieces: **`PermanentStatics.untargetableByDisciplines`** (keyed on
what the CARD requires — the sibling of `untargetableExceptDiscipline`,
which asks about the actor; read inside `untargetableBy`, so **all eight
call sites honour it at once**, and a built-in action requiring no
Discipline is correctly unaffected) and
**`PermanentStatics.strikesUndodgeable`** — checked against the STRIKER
at resolution rather than stamped onto each `Strike`, because hand,
weapon and granted strikes are built at five sites and **a flag every
site must remember is one a sixth will forget**.

**A second hole found on the way: `stealMinionOnSuccess` was the ONE
minion-targeting branch that never called `untargetableBy`**, so Secure
Haven's "cannot be the target of other Methuselahs' actions" failed to
stop a steal too.

**COVERAGE: 21 supported cards were named by no test.** 18 are pure data
variants riding on a sibling's scenario test (11 hunting grounds, 6
`lockGrant` locations, Iron Glare, Malkavian Justicar) — defensible, but
**nothing exercised the actual data**, which is exactly how the
"Assamite" filter shipped matching no vampire. Two had no sibling at all
(**Protected District**, **Party Out Of Bounds**) and now have scenario
tests including the negative case. All 21 are in the fuzz decks, and
`tests/cards/library-audit.test.ts` holds the standing guard: **every
supported card must be named by some test or deck.**

**A test-fixture trap worth remembering:** Aggressive Corpse rushes "a
minion" — *any* minion, its own side included — so taking the first rush
option sent it at its own controller's vampire and tested nothing. Name
the target. (The Path wave's walker lesson in a new costume.)

**THE LEDGER CLOSEOUT — 2026-09-03, owner instruction: "every single
clause on every single library card fully functional; nothing skipped or
cut" (`docs/ledger-closeout.md`). DONE.** The ledger's "needs engine
work" table is **empty**, there are **no `// PARTIAL:` markers left** in
cards.ts, and the cut and blocked lists were already empty. Ten rows:
Preternatural Strength, Wind Dance, Putrescent Sustenance, Dead Pool,
.44 Magnum, Melange, Heroic Might, Rotting Behemoth, Rutor's Hand,
Go-getter.

**Six of the ten needed NO new mechanism** — the machinery existed and
the card was never wired to it, because the card shipped before the
machinery did and nobody went back. That is the Aggressive Corpse rot
again, and it is why the ledger is worth re-checking against the code
rather than read.

**`canPlayMode` — one gate, eleven callers.** Preternatural Strength bars
a card BY NAME, and the card it bars (Torn Signpost) is a **combat**
card, so the bar has to reach every window a minion plays in — not just
the two recruit/employ sites `cannotPlayCardTypes` guards. All eleven
per-minion play gates now funnel through one wrapper around
`disciplineOk`. Patching eleven sites is how `modifyVotes`/`restrictVotes`
drifted; this is the fourth time that shape has come up.

**A FORCED strike is not a granted one.** `CombatFrame
.forcedAdditionalStrike` offers Wind Dance's extra sub-round strike and
**nothing else**, where `grantedStrikes` ADDS an option to a free choice.
The card does not say the vampire *may* dodge; it says the additional
strike *is* a dodge — the old model let it deal hand-strike damage it
does not print. **The existing test asserted the deviation** and now
asserts the card text with the negative pinned.

**BURNT VAMPIRES NOW REACH THE ASH HEAP (p. 34)**, which
`docs/ash-heap-design.md` had deliberately omitted. Rotting Behemoth's
"an ally **or vampire** in your ash heap" needs it. **`CardInstance.crypt`
is the discriminator and was the whole risk**: a vampire card has no
handler, so every filter that asks the registry already skips it — the
filters that do NOT ask had to be found (The Gate of Acheron's "a LIBRARY
card at random", and plain-count removals, at both their enumeration and
their resolution sites). An ALLY is still filed by its own self-attached
card, not twice; a minion REMOVED from the game is still not filed at all
(p. 16).

**Rutor's Hand: the blocker was ORDERING, not machinery.** Its damage is
queued on the action frame and applied after resolution, while a
ChoiceFrame raised during resolution only queues — so the obvious build
asked after the damage had landed. The offer now rides **on the damage
item**, and the damage loop **raises the frame instead of inflicting**.
**Bug it caused, and the rule:** registering the choice handler for every
spec-compiled card made `choiceByKey` non-empty everywhere, and
`compileSpec` installs its dispatcher on exactly that condition — so
every card whose choice handling comes from elsewhere lost it (Enthrall
and Propaganda broke at once). Register a shared key only for the specs
that carry it.

**GO-GETTER: the costed "kernel change" was a REFACTOR.** It was written
up as needing a "tail already run" guard on four things. Instead,
`resolveActionInner`'s `if (success) {…}` block became
**`applySuccessEffects(af)` — one function, two callers**. Continuing a
blocked action runs only that; the tail is not in the function being
called twice, so no guard is needed. Three decisions on record: a
distinct **`ActionContinued`** event rather than a second
`ActionResolved` (one resolution really did happen and fail, and every
fold that counts resolutions would double-count); the flag is consumed
**in `settle`, where the window actually CLOSES** — the first build put it
in `resolveActionInner`, which only *opens* the window, so it never ran;
and the flag is cleared before it is acted on, so it cannot loop.

**What remains on the ledger is NOT skipped work**, and the doc says so
per card: **Revelations**' every clause works and what is missing is a
`PlayerView` property (an actor cannot *remember* a hand they looked at —
a phase-5 AI concern, which is why it stays listed); **War Ghoul**'s row
records a settled reading; **Wall Street Night** and **Black Forest
Base** each carry a correct filter that the pool contains no card to
match, so implementing them harder would mean inventing cards; and the
**retrofit list** is four supported, green, correct cards that are still
hand-rolled where a later flag would express them (the Platinum Protocol
precedent — rewriting a working card is a separate, checkable change).

**THE CRYPT HAS STARTED — wave C1, 2026-09-03
(`docs/crypt-plan.md` for the survey, `docs/crypt-wave-1.md` for the
wave). Crypt 33/217 supported, and counting the 118 that need no
implementation at all, 151 of 217 crypt cards now play correctly.**

**THE SURVEY THAT SIZED IT: 118 of the 217 crypt cards have only a
sect/title line and already worked.** The crypt is a **99-card** job.
Reading all 99 against the existing vocabulary, **roughly 85 are DATA** —
not a coincidence, but the library waves paying out.

**THE ARCHITECTURE, and it was already proven twice: a crypt card's
ability rides onto the vampire as a SELF-ATTACHED ENTRY**, exactly as an
ally's card text does and a token vampire's does. `cardType: "crypt"`
compiles to a handler with **no `options` and no `resolve`** — a vampire
is never played, it is influenced out — plus `cryptEntry()`, which
`makeVampire` attaches when a deck is built. **The consequence is the
whole plan: the entire `permanent` vocabulary reaches crypt abilities
with no second set of rules**, and `compileSpec` runs every clause
compiler over a crypt spec unchanged, so hooks and granted actions come
free in C2.

**Checked, not assumed:** **zero merged/advanced cards** in the V5 crypt
(that mechanic is out of scope by the data); **zero duplicate crypt
names and zero collisions with library names**, so the name-keyed handler
registry needed no namespacing; groups are 5/6/7 and group legality is a
**deck-construction** rule, not an engine one.

**The dangerous failure here is a NAME TYPO**, because the lookup is by
name and a miss produces a vampire with silently no ability — the
"empty for the wrong reason" shape. Two guards in `supported.test.ts`:
every crypt spec must name a real crypt card exactly, and every crypt
spec must compile to a non-empty entry.

**`ConditionalStatic` grew a condition vocabulary**: the traits `bleed`/
`strength`/`votes`/`handSize` beside stealth/intercept; `actionDirected`
("during directed/undirected actions", narrower than
`directedAtController`); **`actingMinion`** (a condition on who is coming
at you — "against titled vampires", "against younger Lasombra", with
younger/older on DERIVED capacity); and **`controller`** (the board — pool
at most N, holding the Edge, controlling a ready cardinal, controlling
locations, the prey's pool, the predator's ready minions). **Every board
condition is derived on each read**, never settled when the vampire
enters play — an oust rewrites who your prey is.

**`conditionalStaticNoAction` is not a convenience.** `handSizeOf`,
combat strength and vote counting all ask OUTSIDE any action, and a
static carrying an action condition must contribute **nothing** there
rather than defaulting to true — `conditionHolds` computes whether the
static `needsAction` and answers false when there is none. Backwards,
every action-conditional static would be permanently on. Strength and
votes deliberately use the no-action form: a combat can outlive the
action that started it.

**`cannotBeBlockedBy` — the union reading again.** Rexton's "allies AND
vampires with capacity 3 or less cannot block" names two groups, the
reading `docs/opposing-statics-design.md` recorded. It is a **bar**,
where `blockToll` beside it on Jürgen is a **price**. Jürgen's
`payWith: "bloodOrLife"` is load-bearing: p. 22 gives allies life, so a
toll printed in blood alone would lock them out.

**Aelswith, The Irresistible prints Terrifying Visage's clause word for
word** and cost nothing but a field name — that static was built the day
before, for a library card. That is the crypt being cheap, demonstrated.

**Four cards that LOOK like statics were left for later waves** rather
than approximated: Adrino (a *mandatory* press is not a credit), Kevin
Jackson (its second half is an aura on the opponent), Noluthando (a
property of the strike), Djeneba (a `PlayCostMod` with no "blood or life"
arm).

**PHASE 5 IS BUILT — AI v1 + batch simulation, 2026-09-03
(`docs/ai-v1-design.md`).** `npm run simulate` plays **200 games in 5.5
seconds with zero errors**, and ⚙ Settings → **AI players** hands any seat
to the computer. `src/ai/` is a sibling of the engine, not part of it.

**`HeuristicAgent` is a scoring POLICY, not a search** — one pass over
the legal options, a score each, highest wins, ties broken on a seeded
stream. Every weight lives in one `Weights` object so the policy can be
argued with without reading code. A searching agent needs cheap cloning
and a value function; neither is needed to prove the seam, and v1's job
was to show an `Agent` can play a whole game through the same interface a
human uses.

**Three rules govern `src/ai/heuristic.ts`, all test-enforced:** it
imports no `GameState` and no `redactFor` — **it sees only the
`PlayerView`** (a test reads the IMPORT LINES, not the prose, after a
first version matched its own comment); it uses a **seeded xorshift, never
`Math.random`**, so a game is still its seed plus its command log; and it
**only ever returns an offered id**, leaving the legal-move generator the
single source of legality.

**THE FINDING, and it is what phase 5 was for: `PlayerView` could not
support a blocking decision.** The first batch run was **10 games and 10
stalls** — the same block declared, failed, and declared again forever.
**The engine was right**: p. 25 says "if one attempt to block fails,
another can be made **as often as the blocking Methuselah wishes**", so
unlimited retry is a RULE and stopping is a **judgement**. A judgement
needs numbers, and the view carried none — it had no notion of the action
in progress at all. `PlayerView.action` now reports the acting minion,
kind, target, current **stealth**, and the **intercept each of the
viewer's own minions** has against it. All of it is open information (the
actor is face up; both totals are sums of face-up cards), so it is not a
leak, and phase 6's remote seat needs exactly the same. The policy's
whole fix is one line: `if (intercept < act.stealth) return -Infinity`.
**Phase 4 was pulled forward because a crash-finding harness cannot find
WRONG; this is the mirror — a view correct about what it HIDES can still
omit what a player NEEDS.**

**The batch harness never throws — a crash is a RESULT** (grouped by
message, reported with a reproducing seed), because a harness that fell
over on the first bad game would find one bug per run. **A missing agent
is a hard error, not a silent PassAgent**: a fallback would make the
batch measure something other than the agents under test.

**Measured, over 30 games / 20,937 decisions: 64 distinct cards played**,
930 actions, 627 influence transfers, 480 strikes, 315 blocks. Games end
by **ousting** — total VPs average 3.0 in a 3-seat game (2 ousts +
last-standing) and `draws: 0` — so the AI is playing, not passing its way
to the turn cap.

**The transport needed NO new machinery**: `stepAutomatic` has always
played agent seats, so `setAgent` only adds or removes one. Which seats
are AI is a **client preference** like auto-pass — never in the command
log, so a save replays identically whoever was at the controls. Each seat
is seeded from its own name.

**Honest limits (design §6):** the policy **does not read card text** —
it scores a play by cost and window, because teaching it what cards do
would be a second, drifting model of the pool; the right fix is for the
OPTION to carry more, which helps the UI too. ChoiceFrame answers and
referendum terms are taken in offered order. **The lopsided seat results
(Carol wins ~2/3) are NOT evidence about the AI** — the playtest decks
are an unbalanced mid-game snapshot with different pools per seat.

**RICHER OPTIONS — 2026-09-03, straight after phase 5
(`docs/richer-options-design.md`). The principle: THE ENGINE IS THE ONLY
THING THAT KNOWS WHAT AN OPTION DOES. When it does not say, every
consumer re-derives it** — the UI by leaving the number off the screen,
an agent by building a second, drifting model of the card pool. Both new
fields are values the enumerator **already computed to decide the option
was legal**, and then dropped.

**`declareBlock` now carries `intercept`, `stealth`, `wouldSucceed` and
`toll`.** `blockTollFor` had just run (to know the minion could pay) and
`blockWouldSucceed` sits in the same module. The UI **dims** a block that
would fail — **marked, never hidden**, since p. 25 makes the attempt legal
and either side may still play a card, so it stays the player's call; they
just should not have to hunt two numbers elsewhere on screen. The AI reads
`wouldSucceed` instead of cross-referencing `PlayerView`, and now subtracts
the toll. `block-tax.test.ts` asserts `toll` rather than parsing the label,
which is what it was always about.

**`playCard` now carries `cost: {blood, pool}` — the LIVE cost**, every
modifier already in the number (docs/play-cost-design.md). **Done in ONE
place, not at the forty `makeOption` call sites**: forty sites are forty
chances to forget, and **a cost that appears on some cards and not others
is worse than none** — the UI would price half its buttons and an agent
would read the unpriced half as free.

**THE HAND-ROLLED GAP, FOR THE THIRD TIME.** Wrapping `compileSpec` covers
spec-compiled cards; a hand-rolled handler builds its own options and
reported nothing — the exact failure that left `costTypes` undefined on
Blood Doll and .44 Magnum. The fallback now lives in
`backfillCentralQueries` beside the others, and
`tests/cards/central-queries.test.ts` walks a real game asserting **no
`playCard` option is ever missing a cost**.

**A TEST THAT WAS ASSERTING THE WRONG THING, and it is the "empty for the
wrong reason" shape one level up — a test can pass for the wrong reason
too.** The AI test "refuses a master that would spend it down to nothing"
used **Blood Doll**, and broke the moment the AI read real costs.
**Blood Doll costs NOTHING** (registry `poolCost: null`; it is a free
master) — the AI played it and was right to. The old policy refused every
master at low pool regardless of cost, so the test only looked correct.
Rewritten with **Channel 10** (2 pool).

**Next of the same shape, all a number the enumerator drops:** a bleed's
`takeAction` could carry `currentBleed` (so the button reads "bleed Bob
for 2" and the AI stops reading `bleedAmount` off the minion and missing
every modifier); `chooseStrike` could carry its damage. `castVote`
already carries `count`, which is why vote scoring is the least guessy
part of the policy — a worked example of the payoff.

**FUTILE OPTIONS — an owner playtest finding, 2026-09-03
(`docs/futile-options-design.md`).**

**Half the report was the engine being RIGHT, and the citation matters:**
excess blood over capacity goes to the **BLOOD BANK, not to the
Methuselah's pool**. p. 6 twice — "the excess is always moved to the
blood bank immediately", and on the uncontrolled→ready transition "any
blood counters in excess of the capacity drain back to the blood bank".
The blood bank is the shared counter supply (p. 3), not anyone's pool.
Pinned by a test with the citation so it is not "fixed" later.

**The other half was a real bug in SIX places.** An option whose WHOLE
content is "gain N blood" does nothing for a minion at capacity, and
taking it spends something real — a transfer, a pool counter, a card's
once-per-phase use. **`canGainBlood(m)` / `uncontrolledCanTakeCounters(u)`
in derived.ts** are now the one place that question is asked. Missing
before: the influence transfer (the owner's 8-counters-on-a-7-capacity
vampire), `bloodMoverAbility` (Blood Doll, Vessel — the owner's second
report), **all thirteen hunting grounds**, `addUncontrolledBlood`,
`bloodOnBleedSuccess`, and `afterActionBlood`.

**The subtlest one: `actionAddBloodToVampire` checked capacity ONLY when
the card printed "not to exceed".** That flag was written for an ally's
starting life — but **p. 6 caps every minion whatever the card prints**,
so an uncapped card still offered a full vampire an option that did
nothing. A flag answering a narrower question than the rule.

**Deliberately NOT gated: the hunt action.** A full vampire hunting gains
nothing but still triggers `onHuntSuccess` cards, so it is a legal if
unusual play. The helper is only for effects whose *whole* content is the
blood gain. It reads DERIVED capacity, so a Discipline master reopens the
option and its removal closes it.

**HOW TO PLAY NOW HAS SEARCH** (`searchRules`). Every term must match, so
"block stealth" narrows; it searches the TEXT not the markup (or "b"
would match every bold run); matching sections auto-open (a player is
looking for a phrase, not a heading); and the highlighter splits on tags
so it cannot rewrite `<p>` into `<<mark>p</mark>>`. The query is view
state — never in the command log — and the caret is restored after each
repaint.

**HOW TO PLAY NOW COVERS THE CARDS' VOCABULARY (2026-09-03), and the
split it makes is the point.** An audit against the finished pool found
the panel silent on ~46 terms a player reads on cards. Four new sections:
**Vampires** (clan/sect/group/capacity/Disciplines, basic vs superior —
p. 5, 39–40), **Titles, votes and ballots** (the per-title vote table,
city titles, and p. 28's rule that **a LOCKED vampire still votes**),
**More terms from the rulebook** (blood bank, hand size, "(limited)",
unique, search-and-shuffle, removed-from-the-game, wake, sterile), and —
kept deliberately separate — **"Words that come from cards, not the
rulebook"**: wraith, zombie, Path, frenzy, stun, corruption counters,
archetype, hunting ground and the printed keywords Grapple/Aim/Boon.
**None of those appear in the V5 rulebook at all**, so mixing them into a
cited section would break this file's own contract that "a future editor
can tell a summary from an invention". Weapons (melee vs gun) went into
the combat section and the "Requires a …" line into Vampires.

**The guard is standing, not a fixed list** (`tests/ui/render.test.ts`):
it walks the printed sub-type lines in the REAL registry and fails if the
panel does not name one. It immediately caught **"Nod fragment"**, a
sub-type I had missed. Phase 8's wider pool will add sub-types, and this
fails until they are written up rather than letting the panel drift
behind the cards. Deliberately NOT documented: KRCG's `burnOption` flag,
which the one card carrying it never mentions in its text and the engine
does not model — writing it up would be inventing a rule.

**CRYPT WAVE C2 — granted actions and unlock riders, 14 cards,
2026-09-03 (`docs/crypt-wave-2.md`). Crypt 47/217; counting the 118 bare
cards, 165 of 217 play correctly and 52 ability cards remain.**

**Almost none of it was new mechanics.** The rushes (Theo Bell,
Barachiel, Dafina, Nathaniel) are the ALLY rush clause word for word —
same `spec.rush`, same compiler — because a crypt card's text rides on a
self-attached entry exactly as an ally's does. **Nathaniel needed one
word**: "with a LOCKED vampire" is `enumerateRushTargets`' `lockedOnly`,
which it has understood since the rush gate and no card had asked for.

**`permanent.unlockAfterAction` is the largest shape in the crypt** —
one clause with a field per printed phrase (whose action, who unlocks,
blood cost, once-per-turn, own-turn-only, requirement filters).
**"An action REQUIRING a Gangrel" is a property of the CARD**, answered
by `requiresClans`/`requiresDisciplines`; a built-in bleed plays no card
and so requires nothing, which is why Keegan does not wake from one.
**Sakura is the exception** — a Path is printed on the CRYPT card, so
that requirement reads the acting vampire.

**TWO BUGS OF ONE SHAPE, both silent, and both worth remembering:**
(1) **A question nobody answers is SILENCE.**
`addAfterResolutionUnlock` RAISES the offer; the `unlockAfterResolution`
choice key was registered only by the card effect of that name, which
these crypt cards do not use — so the frame was raised, found no
options, and popped harmlessly. All five riders were inert and three
looked fine because the trigger half worked. (2) **An effect KEY is what
routes resolution**: `announceEntryAction` defaults to `"enterCombat"`,
so the search action announced, resolved and did nothing until it passed
`effect: { key }`. In both cases the option was offered, legal, taken —
and accomplished nothing, with no error anywhere.

**And an ordering trap in the code that warns about it:**
`addCryptAbilities` registers a choice key, so it must run BEFORE the
`choiceByKey` dispatcher, which installs only `if (keys.length > 0)`.
Calling it at the end of `compileSpec` — where it naturally went — left a
crypt-only card with no dispatcher at all. Exactly
`docs/wraith-zombie-design.md` §5, four lines above the call.

**`searchToHand`** (Dominica, Sakhar) keeps the library-search gate's
rules: the search happens AT RESOLUTION (p. 48), finding nothing is
always legal, and the library is shuffled either way (p. 14) — so "Find
nothing" is an ordinary answer, not a decline, or the shuffle would be
skipped. New event **`CardSearchedToHand`**, distinct from a draw because
the card is NAMED (revealed to the table). **Doc Martina was free**:
`rescueDiscount` was built for Saulot's Healing Touch.

**The playtest decks MAY NOW USE ability vampires.**
`validateDecks().inertAbilities` flagged every vampire with card text,
because when it was written no crypt card had an implementation; it now
reads the registry's `supported` flag, so 47 are eligible. **The decks
themselves are deliberately unchanged** — swapping a vampire changes its
clan and Disciplines, which is what makes the library half playable, so
it is a play-balance decision for the owner rather than a side effect of
a card wave. Two clean same-clan same-capacity swaps exist if wanted:
Berenguela → Lenny Burkhead (Nosferatu 6), Casey Snyder → Martina
Srnankova (Gangrel 6).

**CRYPT WAVE C3 — combat and blocking, 12 cards, 2026-09-03
(`docs/crypt-wave-3.md`). Crypt 59/217; 177 of 217 play correctly and 40
ability cards remain.**

**The new idea is a condition on WHO YOU ARE FIGHTING.**
`ConditionalStatic.inCombatWith` (Kevin Jackson, Ragnar, Roy), read by
**`opposingCombatantOf` off the live combat frame on every evaluation —
nothing stored.** The rule `docs/retainer-wave-design.md` §1 states, for
its stated reason: a combat ends four different ways, and a flag that
must be cleared at all of them will one day survive one. Kevin's second
sentence is the MIRROR — `opposingStrengthBonus`, a bonus the bearer
hands to whoever fights them. **Ragnar's "ally OR younger vampire" is two
entries, not an intersection** (the union reading again).

**A lot came free**: Marialena is `blockedToll` word for word
(Phantasmagoria); **Adrino is `continuePressPerCombat`** (Righteous
Blade — the first draft invented a new clause AND a new hook before
checking, and the static was already there); Egidia is `onCombatLeave`;
Flávio prints Treasured Samadji's clause; Roy's lock is `onDiscardPhase`,
automatic because the card says "lock him", not "you can".

**Noluthando's "(even at close range)" DESCRIBES EXISTING BEHAVIOUR** — a
ranged strike already works at close range — so only the bonus is new.
**That is the fifth card whose parenthetical is the card confirming a
rule rather than asking for one**; reading one as an instruction is how a
re-entrancy bug gets written.

**TWO TEST FIXTURES MEASURED THE WALK, NOT THE GATE, and it is now a
rule: a fixture that sets blood to 0 has also enabled a MANDATORY
ACTION.** Both "not offered when they cannot pay" tests failed by
offering the option — because a vampire at 0 blood must hunt (p. 21), the
walker answered that hunt, and the blood came back. Fixed by taking each
out of the mandatory-hunt path (Opikun locked, Agnieszka defending).
Third instance of the walker-plays-the-board trap.

**Deferred with reasons** (all in the doc): Faruq and Sergio need a
corruption filter on their statics; Parijat's block toll is paid in
LIBRARY CARDS and is about other minions; Tommaso ends a combat from
outside it; Djeneba and Algirdas want a play-cost modifier aimed at the
opposing combatant, where `whileBearerEngaged` asks a nearby but
different question; Abraham/Kasim/Phaibun/Roger are the
**discard-for-a-bonus family**, C4's one-primitive group.

**CRYPT WAVE C4 — trading a card for a bonus, 15 cards, 2026-09-03
(`docs/crypt-wave-4.md`). Crypt 74/217; 192 of 217 play correctly and 25
ability cards remain.**

**One clause does seven cards** — `permanent.discardFor` (Alexa Draper,
Yewon Ong, Larissa Moreira, Abraham DuSable, Kasim Bayar, Phaibun, Roger
de Camden), and **an eighth proves the split was right**: Marchesa
Liliana pays in **seven cards removed from the ash heap** rather than
from hand, and is one line of data because cost, payoff and window are
three independent fields. Every payoff was an op that already existed;
the only new one is **`addCombatStrengthTo`**, the combat-LONG sibling of
`addRoundStrengthTo` (Kasim's "+2 strength that combat"), with
`addCombatStrength` delegating to it so there is one implementation.

**THE BUG, and it is the `onAnyUnlock`/Fame bug one hook along:
`onBleedSuccess` iterated `seat.permanents` only**, so it had never
reached an ATTACHED card — invisible while its one user (Alamut) was a
location, and dead for Gostoso, whose ability sits on a vampire. Now
`allEntries()`. **Rule: a hook that iterates `seat.permanents` does not
exist for attached cards — and EVERY crypt ability is attached.** Wave 5
should audit the remaining hooks rather than wait to be bitten.

**Three readings that shaped code, not comments:**
- **`requiresDisciplines` needed a UNION across modes.** The central
  query answers for a *chosen* mode and falls back to the first when
  asked for none — right everywhere it had been used, and wrong here,
  because the card is **discarded, never played**, so no mode is chosen.
- **"And/or" is a UNION, in ONE modifier not two.** Roger's "cards
  requiring Hecata and/or Oblivion cost −1 blood" written as two
  `PlayCostMod`s would charge **−2** to a card matching both, so
  `PlayCostMod.clanOrDiscipline` flips those two filters to a union
  inside one modifier. The English-"and" reading, from the cost side.
- **The random discard is rolled at USE, never at enumeration** — an
  option list is a pure read, and rolling in it would consume the RNG
  every time the engine asked what was legal. Phaibun therefore offers
  ONE option naming no card; offering a choice would be a lie about the
  card.

**Uniqueness became a TAG**, centrally in `backfillCentralQueries` beside
the "equipment" tag and for the same reason (a hand-rolled handler would
be silently missing from the count): `currentBleed` reads entries, not
the registry, so Hesha's "+1 bleed for each unique equipment" needs the
fact denormalized. `bleedPerAttached` skips the counting entry itself —
**every crypt card rides in as a self-attached entry**, so a naive count
would include the vampire.

**Free, or nearly:** Kuyén and Máddji are pure `PlayCostMod` data
(`tags: ["animal"]`, `requiresClan` off the central query, and
`pays: "bloodOrPool"` — all built for the play-cost gate and the retainer
wave); Věnceslava's "during which your prey burned pool" is a read of the
event log from that action's `ActionAnnounced` forward (**the record
already exists** — the Week of Nightmares lesson); Abderrahim's stealth
grant is `modifyStealth`, which is ACTION-scoped, so a bonus granted by a
third party is the same primitive and only *who may grant it* moved.

**Deferred with reasons** (all in the doc §7): Ashur-uballit wants a hook
at the ally/retainer ENTRY path where `life` is computed; Jason Newberry
needs the **vote DIRECTION** as a condition axis (chosen at cast time);
Alexander Silverson is a toll on *casting a vote*, the block-tax shape
one frame over; Cedrick is the first card wanting **both**
`cancelled` and `forcedFail`, plus a hook after a cancelled referendum,
which by construction emits no `ReferendumResolved`; Evan Klein needs a
window as an action is *announced*. Lenelle, Mora, Hel-Blá, Eulogio,
Seraphina, Saankaláxt and Aniel are all **granted actions with a cost**
and `announceEntryAction` already takes every piece — left out for size,
not difficulty, so C5 is cheap.

**CRYPT WAVE C5 — granted actions, and conditions on the other minion, 13
cards, 2026-09-03 (`docs/crypt-wave-5.md`). Crypt 87/217; 205 of 217 play
correctly and 12 ability cards remain.**

**Six granted actions, one clause** (`permanent.grantedAction`: Seraphina,
Saankaláxt, Lenelle, Hel-Blá, Eulogio, Aniel). Every effect was an op that
already existed; what the clause supplies is the SHAPE — enumerate one
option per legal answer, fix it at announcement (p. 25), pay at
resolution (p. 27), route back by effect key. **Two things came free: the
combat-on-success gate opts out by construction** (`rushLike` requires the
granted key to be `"enterCombat"`, so a named key never rushes — no
`noCombat` flag, unlike Mind Numb's hand-played case), and the cost gates
the OPTION as well as being paid.

**A REORDER is not a SEARCH, and the difference is what the log says.** A
search takes a card out of the library, so p. 14 demands a shuffle and the
card is named; a reorder leaves every card where it was, so there is **no
shuffle** and `LibraryCardMoved` deliberately **carries no name** — naming
them would leak what only the owner may see. "Reorder the top 5" is a
REPEATED ChoiceFrame (the `unlockToll` shape), because one option per
permutation is 120 options.

**`opposingCannotCombatEnds` widened from `boolean` to
`boolean | { yourCorruption: true }` rather than gaining a sibling
field** — two fields for one idea is how `modifyVotes`/`restrictVotes`
drifted. And **"YOUR corruption counters" is the CARD's controller**, not
the bearer's (p. 16); both Faruq and Sergio pin the wrong-seat case, which
is the shape that has now bitten five times.

**`PlayCostMod.opposingBearer` retires the wave-3 deferral on Djeneba and
Algirdas.** `whileBearerEngaged` asks whether the BEARER is engaged and
then charges by `minions`; these charge *whoever is fighting the bearer*,
resolved off the live combat frame on every read (the derived rule, a
test deletes the frame and watches the surcharge lift).

**Phase hooks that ask a question:** Mora's is OPTIONAL (declining does
nothing — the converse of the library-search lesson, where an optional
decline would skip a mandatory shuffle); Aemilius's is MANDATORY and
addressed to the **prey** ("your prey CHOOSES"), so their option list
carries no pass. New op `ashHeapToLibraryBottom` — not `takeFromAshHeap`,
which puts the card in the HAND, and the library is drawn from the FRONT
so "the bottom" is `push`.

**THREE MORE FIXTURES MEASURED THE WALK, NOT THE GATE**, all the engine
being right: a walker that keeps going after an action resolves let
Eulogio take a SECOND action and re-lock himself; `threeSeatGame()` opens
at `turn.minion`, so an unlock-phase test must walk a full rotation; and
two negatives failed for the wrong reason (Carlton Van Wyk is not an ally
in this pool at all, and the Faruq control gave its blocker Celerity where
Majesty requires **Presence**). **A negative test needs a fixture that
fails for the RIGHT reason** — that is the fourth, fifth and sixth
instance of this trap.

**CRYPT WAVE C6 — the referendum tail, and two durations, 5 cards,
2026-09-03 (`docs/crypt-wave-6.md`). Crypt 92/217; 210 of 217 play
correctly and 7 ability cards remain.**

**A vote bonus keyed to the DIRECTION of the vote** (Jason Newberry) is
the first one that cannot fold into a vampire's single vote count — the
direction is chosen at cast time, so `PermanentStatics.voteBonus` is
applied per OPTION, in the `both()` helper that emits the for/against
pair. Its test pins **absolute numbers**, not the relation
`against === for + 2`, which would also hold if the FOR option were
missing.

**A toll on CASTING a vote** (Alexander Silverson) is the block-tax gate
one frame over, and borrows both its rules: the toll **gates the option**
as well as being charged (a voter who cannot pay is not offered the
against-vote, but may still vote FOR — the control), and it is paid in
BLOOD, so a vote from the Edge or a burned card is untolled **by
construction** rather than by a rule. `LegalOption.castVote` gained
`toll`, the richer-options principle: the enumerator had already computed
affordability.

**"Canceled OR fails" is TWO outcomes and needed ONE hook.**
`docs/abstain-gate-design.md` keeps them apart deliberately — a cancelled
referendum never resolves and emits no `ReferendumResolved` at all — and
Cedrick is the first card that cares about both, so `onReferendumLost`
fires from both paths with `how` saying which. A hook hung on
`ReferendumResolved` would have missed half the card silently; a test
drives exactly that case. Fired AFTER the pop (the `notifyCombatEnded`
rule).

**Ashur-uballit's +1 starting life is applied where the value is
COMPUTED**, read from the tags of the card ARRIVING — the minion does not
exist yet, since an ally's own self-attached entry is emitted after
`AllyEnteredPlay`. **It raises `capacity` too, and that is load-bearing:**
for an ally that field IS the printed starting life (p. 11), so bumping
the life alone would have `drainOverCapacity` burn the point straight
back off.

**A THIRD hand-size duration.** `docs/temporary-hand-size-design.md` built
two, both expiring because the frame holding them goes away. Fotini's
"until your next discard phase" lifts **as the phase opens, before the
hand is measured** — which is the point of the card, since a bonus
lasting through the discard phase would let its holder keep the extra
card. `HandSizeGrant.until: "discardPhase"`, checked where the phase is
entered.

**Two fixture traps:** the referendum cycle is `{ order, cursor, passes }`
(a wrong shape throws inside `cycleQuiescent`, not at the assertion), and
**the polling step cycles every Methuselah starting with the CALLER** — a
test about the defender's options must pass through the caller's impulse
first.

**CRYPT WAVE C7 — the last seven, and THE CRYPT IS FINISHED, 2026-09-03
(`docs/crypt-wave-7.md`). Crypt 99/217 implemented; ALL 217 play
correctly. THE WHOLE V5 POOL IS IMPLEMENTED: library 444/444, crypt
217/217, total 543/661 — the remaining 118 crypt cards print a bare
sect/title line and need no code.**

**THE BUG, and it is the third of its exact family in three waves:
`onActionAnnounced` fired ONE STEP TOO EARLY.** It lived in
`applyToFrames` on the `ActionAnnounced` event, placed there deliberately
because "this is the one point every announce site passes through" — but
**all three sites EMIT the event and only then PUSH the frame**, so a card
acting on the hook saw no `targetMinion` (it is on the frame) and no
action frame at all, meaning `ops.failAction()` **silently did nothing**.
Its one previous user, Slaughtering the Herd, only emits a bleed and
never noticed. Fixed as `notifyActionAnnounced(af)`, called from the three
frame-push sites — one helper, three callers, so the chokepoint property
survives: a fourth announce path cannot forget the hook without also
forgetting to push a frame. **Same shape as `onBleedSuccess` (C4) and
`onAnyUnlock` (Fame): machinery that existed, was documented as general,
and quietly did not apply to one case.**

**Elen Kamjian is the second MANDATORY ACTION in the game** (after the
0-blood hunt, p. 19), and she posed a real rules question: **she LOCKS
HERSELF at announcement (p. 25)**, so a naive "do you control a locked
minion?" is true of every bleed she ever makes and the condition is no
condition at all. The check never counts her; the compulsion and the +1
are one sentence, so both read the same condition.

**Parijat is a block toll in a THIRD CURRENCY** (library cards), and
unlike `blockToll` it is radiated at the whole table and keyed on **who
is acting**, so it is a scan of ready minions rather than a read of the
actor's attachments. The block-tax rule carries over unchanged: a toll
that cannot be paid is a block that cannot be attempted.

**Readings on record:** "directed at HIM" is a MINION target, so a bleed
(which targets a seat) never triggers Evan's coin — it falls out of
`targetMinion` being null rather than needing a rule; the coin is
**recorded either way**, since a log showing only the tails cannot
distinguish a heads from the card never firing; Gathii's option
deliberately does NOT name the card it would reveal (knowing would make a
gamble a choice, and p. 14 says you may not read your own library); and
Tommaso's blood is paid **instead of** locking, the card naming one
price.

**The mandatory-hunt fixture trap bit for the SEVENTH time** (Tommaso at
0 blood was fed by the walker before the gate could be measured). Two
more worth remembering: playing an action card pushes a **CARD-PLAY**
frame first, so a helper that waits on "an action frame" returns before
the action exists; and a **combat frame outlives the ability that ends
it**, since End of Round still runs (p. 30/p. 32).

**Next (the queue):**
1. ~~PHASE 5~~ — **DONE.** Next up: **crypt waves C2–C4**
   (`docs/crypt-plan.md` §6) and **phase 6 (PeerJS multiplayer)**, whose
   groundwork the `PlayerView.action` addition above just advanced.
2. **AI v2 is a SEARCH agent**, and its prerequisite is cheap cloning.
   `replay(setup, commands)` is a correct-but-slow version of exactly
   that — measure it before designing anything faster (design §7). The library
   is complete, and `Agent` / `playerView` / the transport seam were all
   designed for this. Carry one thing into it: **Revelations' memory gap**
   (above) lands on an AI seat, not on a hotseat human — a human simply
   remembers the cards they saw and declined to take; an AI has nothing
   in `PlayerView` to remember them with.
2. **Go-getter superior** — re-entrant action resolution, costed in
   `docs/last-equipment-modifiers-design.md` §7. A kernel change on the
   hottest path, for one mode of one card. Owner review first.
3. Phase 7 (crypt) when it comes: crypt abilities are 0/217, and three
   things are already waiting there — the crypt rushes (granted-rush
   gate, crypt-side), **Aelswith, The Irresistible**, whose printed text
   is exactly `blockedPoolToll`, and **Sakura, The Merciless**, whose
   Path clause now has a Path to read. `src/ui/cardinfo.ts` already
   imports clan, sect, title **and path**.

**THE PLAY CHOOSER READS AS ENGLISH — owner playtest finding, 2026-09-03.**
The menu that opens on a clicked hand card showed the engine's own label,
which is built for a log and an option id: `Aire of Elation (superior) —
Muhsin Samir → V3, Bob`. `describePlay(o, state)` in render.ts REBUILDS
the row from the option's structured fields (`mode`, `minion`, `params` —
the richer-options payload), resolving ids to names against the **same
redacted state** the table is drawn from, exactly as `narrate.ts` does for
the log, so it cannot leak. Two lines: "Superior" over "played by Alice's
Andi Liu, at Bob's Anarch Convert", with the live cost tag. **A
hand-written label is kept** (bespoke handlers say things the fields
cannot — "fill Muhsin Samir to capacity"); only the repeated card name is
trimmed, since the player just clicked the card. `PARAM_WORD` maps a param
key to the word in front of it and `PARAM_HIDDEN` drops the plumbing
(`variant` is shown as the mode instead).

**PER-PLAYTHROUGH LOG FILES — BUILT 2026-09-04
(`docs/game-log-design.md`).** The first piece of the owner's platform
shell spec: one plain-text file per game in `logs/` (gitignored) holding
every decision — human, AI **and** auto-pass — every narrated event, and
every error, so a session can be handed to Claude Code afterwards. **A
browser cannot write to disk**, so a Vite dev-server middleware
(`apply: "serve"`) accepts `POST /__vtes_log/<name>` and appends to
`logs/<name>`; the owner already plays through the dev server, so the file
lands in the repo with nobody exporting anything. The published static
site has no endpoint — the POST fails, `DevServerSink` warns **once** and
keeps the log in memory for download. The name arrives over HTTP, so it is
`basename`d and regex-checked; without that a `..%2F..%2Fevil.log` POST
would escape (verified: it lands in `logs/`).

**It is an OBSERVER over `(commandLog, eventLog)`, not a hook**, and that
is the whole design. It is handed the state after each change and writes
what is new since last time — so it **cannot miss** an AI turn, an
auto-pass or a rewind, and it cannot cause one either. Instrumenting the
decision sites would have meant finding every one of them, which is the
`onAnyUnlock`/`onBleedSuccess`/`onActionAnnounced` failure three times
over. It lives in the **transport** for the agents' and pacing's reason:
with two AI seats and auto-pass on, the UI is asked about ONE seat all
game, so a logger in `DebugApp` would write a file with holes exactly
where the bugs are (a test pins Bob and Carol appearing anyway).

**The file is a REPLAY, not a description:** the header carries the
`SETUP` JSON and every decision line carries its option id, which together
are exactly a `SavedGame`. Three decisions on record: an **undo** is
detected by the counters running ahead of a now-shorter log, and writes
`~~ rewound to decision N ~~` and re-syncs rather than trying to work out
what was taken back — without it the file would silently stop, which is
the worst failure a log can have because it looks like a game that ended;
`finish()` closes the file so a stray repaint cannot reopen it; and there
is **deliberately no redaction** — it is a local debugging artefact, never
sent to a peer, and one that masked the hands would be useless for the
bugs it exists to catch. An event `narrate` cannot phrase still gets a
line with its type and JSON.

**Owner decision 2026-09-04 — PROFILES ARE LOCAL-ONLY.** The platform
shell (login, main menu, host/join lobbies, deck importer, bots, private
play) is specced; accounts, avatars and the leaderboard would need a
backend, and the owner chose local-only instead: profile in browser
storage, avatar as a data URI, leaderboard per-device, username unique
only within a room. No hosted service, and it still ships to GitHub Pages.
**Still open and underestimated: there is no fresh-game setup path** —
`buildGame` takes a hand-authored MID-GAME snapshot, and nothing deals a
12-card crypt, four face-down uncontrolled and 30 pool. Both the lobby and
the importer need it before either can be tested.

**THE FRESH-GAME SETUP PATH — BUILT 2026-09-04
(`docs/fresh-game-design.md`). The client can now START A GAME.** Until
this it could only start from a hand-authored MID-GAME snapshot; nothing
shuffled a crypt, dealt four face down and sat a Methuselah at 30 pool
with an empty table — which both the lobby and the deck importer need
first. p. 14 gives every number: shuffle both decks, **seven** library
cards to hand, **top four crypt face down** into the uncontrolled region,
**30 pool** (p. 15), **≥12 crypt and 60–90 library**.

**Two things needed NO building, and finding that out was most of the
work.** "Face down" is already `redactFor` masking the uncontrolled region
to its owner — the rule lives there, not in the deal. And the transfer
ramp (p. 24: first Methuselah 1, second 2, third 3, 4 thereafter) is
exactly the engine's existing `min(turnNumber, 4)`, checked against a
5-seat table.

**`DeckDef` is now a union of two genuinely different things**, tagged by
a `kind` only the new one carries: **`DeckList`** (a real deck — `crypt`
and `library`, one entry per copy, and nothing else, which is what the
importer will produce) and **`SnapshotDeck`** (the existing position with
`ready`/`uncontrolled`/`pool`). The snapshot stays because every scenario
fixture is one and they exist to reach a position without playing twenty
turns to it. **Validation splits the same way, and which failures are
FATAL is the point:** p. 14's construction limits (`illegalDecks`) apply
to a real deck and are fatal; the pool ledger (`poolMismatches`) applies
to a snapshot, is not fatal, and is meaningless for a dealt game that
always starts at 30 having spent nothing. Both negatives are pinned.

**"Randomly determine a Methuselah to act as first Methuselah" is a
ROTATION of the seat array**, because the table is a cycle (your prey is
on your left) — rotating moves where it starts and changes nobody's
neighbours; a test walks 20 seeds asserting the order is always a rotation
of the seating. `GameSetup.firstSeat` overrides it, which is what a lobby
sets. **The RNG is touched only when the choice is actually made**, so a
snapshot keeps seat 0 and consumes nothing — adding this provably could
not change any existing fixture's deal, which is a different claim from
"it happens not to".

**What it proved about the engine: it had only ever been STARTED
MID-GAME**, so nothing had checked that a seat with no minions can take a
turn — the entire opening of a real game. It can, and a dealt game plays
from an empty table to a finish. **Walker lesson again:** the test
watching a vampire enter play preferred `inf:add` and never `inf:out`, so
it sat at capacity for ever and looked like broken influence. Moving a
fully-influenced vampire to the ready region is a separate last step.

**Still open:** nothing in the UI starts a fresh game (that is the shell's
Host flow — `startFromConfig` will deal one if the JSON holds `kind:
"deck"` entries); no decks ship with the client, since real lists are the
importer's job; and group legality (V5 is groups 5–7) is unchecked.

**THE DECK IMPORTER — BUILT 2026-09-04 (`docs/deck-import-design.md`),
phase 7's core.** `src/ui/deckimport.ts`: paste a deck list from any site,
get a `DeckList` or an exact reason why not.

**ONE PARSER, NOT ONE PER SITE.** VDB, Amaranth, ARDB, JOL, Lackey and the
TWD archive all export a count and a name per line and disagree only about
decoration, so there is no format detection: read the count, then take the
**longest prefix of the rest that names a card in the pool**. The registry
says whether a name is crypt or library, which makes section headers
optional rather than load-bearing. **Longest-first is load-bearing** —
"Archon"/"Archon Investigation" and "Dominate"/"Dominate Kine" are both
real pairs, and shortest-first reads the wrong card silently.

**THE BUG THE ROUND-TRIP FOUND: `.44 Magnum` did not import.** The count
separator was `[\s:.\-\t]*` so it could absorb `2. Name`, and it ate the
leading dot of a card whose NAME starts with one — imported as "44 Magnum"
and reported as not in the pool. A punctuation separator must be
**followed by whitespace**. A hand-written fixture would have used
plausible names and never contained that card; exporting a real precon and
reading it back did.

**Name matching normalises what a paste destroys** — case, accents
(`Kuyén`, `Día de los Muertos`), curly quotes, dashes, the `™` on Pentex —
and keeps the letters. KRCG suffixes crypt names with their group
(`Ariane (G5)`) while most sites use a separate column, so **both
spellings resolve**; that works only because no two V5 crypt cards share a
bare name, so a test asserts the absence of collisions rather than relying
on it.

**What is FATAL:** an unknown card (reported with its line number — never
dropped), an unimplemented **library** card, and deck construction (p. 14
≥12 crypt / 60–90 library; p. 4 "a single group or two consecutive
groups", with the glossary's exemption for group "any"). **NOT fatal:** a
vampire whose printed ability is unimplemented — a real card with real
stats, and 118 of the crypt need no code at all (the reading
`validateDecks` already took).

**PRECONS ARE DERIVED, and the data was there all along.** The spec wanted
"which sets and precon decks are supported"; each KRCG card's
`sets[<set>]` printings carry `precon` and `copies`, and the pipeline was
dropping them — **the `path` lesson again**. `build-registry.mts` now
assembles **32 precons** across the seven V5 sets into `registry.precons`,
so they cannot drift from the cards and grow by themselves when the pool
widens. **18 are playable as printed**; the other 14 are New Blood
starters, half decks by design (6 crypt, 48–49 library), listed with the
reason rather than hidden. `preconDeck(set, name, seat)` returns one as a
dealable deck — which also answers "no decks ship with the client".

**MULTIPLAYER — THE HOST/PEER CORE IS BUILT, 2026-09-04
(`docs/multiplayer-design.md`), phase 6.** `src/net/`: `protocol.ts`,
`HostSession`, `PeerTransport`. **The protocol sits ABOVE the carrier** —
`Channel<In,Out>` is four members and knows nothing about PeerJS — and
that is the whole design, because it is the only way any of this is
testable: a `loopback()` pair plays **a whole three-seat game to a finish
with two seats remote**, headlessly, in 200ms. Written against PeerJS,
none of masking / stale answers / reconnection / in-flight failure could
have been asserted. Deliveries are async even in the loopback, or a
re-entrancy bug a real network would find on day one slips through.

**The engine needed NO change** — it already enumerates every legal option
and rejects anything else, so a peer's intent is validated by exactly the
code that validates a click. Three things are new, all only because there
is a network: **masking per recipient** (`LocalTransport.stateFor(seat)`,
because `view()` masks to whoever is being ASKED — right for a shared
screen, wrong for a peer who must see their own hand whoever is deciding;
it deliberately ignores `omniscient`, since a host's debug switch must not
broadcast the table's hands); **withholding a decision that is not
theirs** (a `DecisionPoint` carries that seat's OPTIONS, and an option
list says what is in their hand); and **refusing stale answers**. The
sharpest test is negative: every card name in the other seats' decks is
absent from the JSON a peer was sent — not "the UI hides it", **it is not
on the wire**.

**A `choose` names the decision it answers (`seq`)**, because over a
network a click can arrive after that decision was answered. **WHICH
decision is checked before WHOSE**, deliberately: a stale answer is
usually stale *because* the game moved on to somebody else, so testing the
seat first reports the symptom ("it is Carol's decision") instead of the
cause. Both branches pinned.

**Reconnection needed no machinery**: a `sync` carries the entire masked
state every time, so a returning peer sends `hello` with its seat and gets
the next sync, which is the whole game. No catch-up log, no diff, no
replay — and no divergence bug to have.

**The transport seam paid out exactly as designed**: `PeerTransport`
implements `GameTransport`, so `DebugApp` renders a networked game with
**no change whatsoever**, and all four properties written into that
interface on 2026-08-29 (async `choose`, snapshot `view`, agents stepped
by the authority, nullable `history`) land here.

**Bug the tests found, in my harness:** loopback `close()` dropped
messages already sent — and every goodbye is "send `bye`, then `close`",
so a turned-away peer learned nothing and looked like it had vanished.
Three tests failed at once. A message is dropped only if the channel was
already closed **when it was sent**; once on the wire a later close does
not recall it, which is also how a real connection behaves.

**Still open:** no PeerJS adapter (a `Channel` implementation plus
signalling — room codes and join links — which belongs with the lobby
screen), no lobby (seat assignment is the caller's), no spectators (a peer
sent `redactFor(state, NO_SEAT)` and never a decision), no deck hash.

**THE APP SHELL — BUILT 2026-09-04 (`docs/shell-design.md`). THE CLIENT
NOW STARTS A REAL GAME FROM A MENU.** `main.ts` boots `Shell` (profile →
menu → new game → table) instead of one hand-authored snapshot.
`src/ui/profile.ts` + `src/ui/newgame.ts` hold the decisions and have **no
DOM**; `src/ui/shell.ts` is the screens.

**PROFILES ARE LOCAL ONLY (owner decision).** No backend, so: the profile
sits beside the settings in localStorage; the **name is unique within a
room**, enforced in `buildTable` because seat names ARE the engine's seat
ids; the **avatar is a data URI downscaled to 128×128** — not a nicety,
since the origin has a few MB shared with the saved game and an unscaled
photo would **evict it**; the **leaderboard is per device**, and the screen
says so rather than showing an empty table that looks broken.
`nameProblem` is permissive about content (accents and non-Latin scripts
are somebody's real name) and refuses only what breaks something
downstream — empty, over-long, or control characters that could corrupt a
lobby list or a log line.

**PRIVATE PLAY IS FINISHED.** Menu → Host → Start deals a real game from
real decks with bots in the other seats, logged to `logs/`, at the chosen
AI pace — **and it needed no new engine work**: the bots, the deal and the
log were all built and simply had no menu. **Join is present and
DISABLED** with the reason on it: the host/peer core exists but there is
no signalling yet, and an enabled button would be a lie.

**The default table is you plus three bots on FOUR DIFFERENT precons,
startable with no further choices** (p. 1: "four or five players"; 2–6
play). Different precons on purpose — a first game that is four copies of
one deck playing itself teaches nothing — and a test pins it. **Every
problem is collected, never the first thrown**: a player fixing a lobby
wants the whole list. **A null seed is resolved ONCE into the
`GameSetup`**, so "a different game each time" never means "a game that
cannot be replayed".

**Screens re-render whole, with the usual one exception**: a seat-name box
repaints on **blur**, not per keystroke, or the caret leaves the box being
typed in. (How to Play solves it the other way, by restoring the caret;
here there is nothing to restore to.) `startFromConfig` is no longer the
entry point but is KEPT — the playtest snapshot is still the fastest way
to a mid-game position for a hands-on look at a card, and a fresh deal
spends its opening influencing on purpose.

**THE LOBBY, ROOM CODES AND PEERJS — BUILT 2026-09-04
(`docs/lobby-design.md`).** `src/net/room.ts` (pure), `src/net/lobby.ts`,
`src/net/peerjs.ts`. **peerjs@1.5.5 is now the project's ONLY runtime
dependency.**

**THE PART OF THE SPEC THAT CANNOT BE BUILT, flagged not decided:** "a
list of all the rooms people have created" needs a **directory server** —
somewhere every host registers and every joiner queries. There is none, by
the owner's own local-only decision. A peer-to-peer client can be *told* an
address; it cannot enumerate addresses nobody published. So what exists is
**room codes and join links**, which cover "play with friends" completely
and "find a stranger's open game" not at all. A public room list is the
same backend decision as accounts and a shared leaderboard.

**A code IS the address** (the host's PeerJS id), so there is no lookup to
be out of date. Its alphabet has **no 0/O and no 1/I/L** — a code is read
aloud and typed back, and those are the pairs people get wrong; 30^6 is
still 729 million rooms — and `normaliseRoomCode` forgives case, spaces,
dashes and exactly those substitutions. **The code goes in a link's
FRAGMENT**, which is never sent to a server, so on Pages it stays out of
the access log — it is the whole of a room's access control.

**ONE CONNECTION, TWO PHASES.** A guest joins, takes a seat, names a deck;
the host starts; and **the same channel** carries the game, so there is no
window in which a player is attached to neither. Guests are told a
**summary** — seat names, whether each has a deck, why the game cannot
start — **never a deck list** (its owner's business before the deal,
hidden information after; a test asserts a pasted card name appears
nowhere in the lobby state). Problems go to **everyone**, so nobody has to
ask why the start button is greyed out. A guest who leaves frees the seat
**and their deck goes with them** — keeping it would deal a game holding a
deck nobody at the table brought.

**THE BUG THE SECOND GUEST FOUND:** `SeatKind` was `you|ai|open`, and a
guest taking a seat only RENAMED it — so it stayed open, the next arrival
took the same one and renamed it out from under the first player, who then
matched no seat at all. Adding **`"remote"`** fixed it and needed no other
change: a seat held by a distant human behaves exactly like the local
human's, and only `open` and `ai` are ever asked about. Three tests failed
at once, which is the argument for having written the same-name test.

**AND A RULE THAT WAS RIGHT WHEN WRITTEN AND WRONG LATER:** `buildTable`
refused an online table with no open seat — sensible when creating a room,
fatal when STARTING one, since by then everyone has arrived and no seat is
open. Now "open **or already taken by a peer**", correct at both moments.
The familiar shape: a condition written against one instant, applied at
another.

**PeerJS is the ONLY file in `src/net/` that knows a network exists** —
everything above it is written against `Channel` and tested over an
in-memory pair, which is why the adapter can afford to be the one untested
piece. **Owner decision to see: the free public broker (0.peerjs.com).**
WebRTC cannot introduce two browsers by itself; the broker passes the
introduction only, stores nothing, and game traffic never reaches it — but
it is a third party this client needs to START a game and it can be down.
Self-hosting is a few lines of `PeerOptions`. Also: a message that is not
ours is **ignored, not thrown** (a peer on another build must not be able
to crash this one), and `peer-unavailable` becomes "nobody is hosting room
X", which is something a player can act on.

**THE LOBBY SCREENS ARE WIRED — 2026-09-04. TWO PEOPLE CAN NOW PLAY.**
Menu → Host with a seat set to *Open (online)* registers a room and shows
the lobby (code, copy-link, live seat list, Start); Menu → Join takes a
code, and a **join link skips the menu** (`codeFromLink(location.href)` at
boot — someone who clicked a link has already said what they want, though
they still meet the profile screen first, since a seat is labelled with a
name). An end-to-end test plays the whole path over one channel: join,
pick a deck, start, real dealt game, moves both ways.

**Whether a table is online is DERIVED from its seats** (`isOnlineTable`),
not held in a switch beside them — a "play online" checkbox and a set of
seats are two facts that can contradict each other, and this is one that
cannot. **One lobby screen serves both sides**; the guest's deck picker is
the new-game panel with one branch, because a guest **sends** their choice
rather than writing it into a local table (the host validates it).
`LobbyPeer.detach()` releases the lobby's listener when `PeerTransport`
takes over the same connection, or two objects would read one stream.

**What the end-to-end test found, and it is a timing lesson not a bug:**
its first version asserted "every seat has 30 pool" right after the deal
and failed at 29 — **the bots are stepped the instant the game exists**,
so by the time anything can look, one has already played a master. The
assertion was measuring the wrong moment; the p. 14 opening is pinned in
`fresh-game.test.ts`, where nothing is playing yet.

**DECK FINGERPRINTS, SPECTATORS, AND HOST EDITING — 2026-09-04
(`docs/lobby-design.md` §8–§10). The lobby's open items are closed except
the room list, which the owner ruled out (it needs a server).**

**The deck hash** (`src/ui/deckhash.ts`) is taken over a CANONICAL form —
counts, sorted — because **a deck is a MULTISET** and hashing the arrays
as they arrive would fingerprint the typing rather than the deck. Keys are
KRCG id for crypt and name for library, the same keys `DeckList` uses, and
it is computed through `seatDeckHash`, which resolves the deck by the same
path the game will be dealt from — so the fingerprint cannot describe a
different deck than the one played. **Plainly not a security device**
(~40 bits, non-cryptographic): nothing relies on it, the host validates
every deck itself. **The hash IS shared where the deck list is not** —
that is the point: it says two decks match without saying what is in
either. A test asserts the pool's 18 precons all differ.

**Spectators** take no seat, so no seat rule applies — any number may
watch and a full table can still be watched. They are sent
`redactFor(state, NO_SEAT)`: **every hand face down, including the ones a
player can read** (measured: a player sees 7 card names, a spectator 0),
with pools, VPs, cards in play and hand SIZES still public as they are at
a real table. They are never sent a decision.

**AND THAT EXPOSED THE ONE PLACE `redactFor` WAS NOT TOTAL.**
`openHandsFor` called `getSeat(viewer)`, which throws for a viewer holding
no seat — invisible while every viewer was a player. Both its rules are
keyed on the viewer controlling something, so a non-player's answer is
`[]`. **"Mask to nobody" is the one call that has to be total**, and the
spectator path is what asked it to be.

**Host editing in the lobby**: `LobbyHost.update()` existed and nothing
called it. The lobby's seat rows are now the new-game controls for any
seat the host still owns; **a seat a guest holds is not editable** — they
brought that deck. Every change re-broadcasts, because the other side of
it is telling everyone why the game cannot start.

**THIRD PLAYTEST PASS — 13 items, 2026-09-05
(`docs/playtest-2026-09-05.md`).** Owner feedback from one session at the
client. Most was presentation; two were real bugs and one of them is the
most important thing in this section.

**THE BUG, and it is a rule the engine had already written down and then
broke in one place: an ally that pays its LAST LIFE mid-action.** Reported
as *"the action buttons disappear and I can't do anything"* — the worst
shape a bug can have, because the game is not over and there is nothing on
screen to answer. An ally's life is its blood (p. 11), so a 1-life ally
paying a card's blood cost pays with the last of itself and `burnDepleted`
removes it **in the middle of its own action**. `currentBleed` read the
actor with `getMinion`, which throws — out of `settle`, out of
`decision()`, out of `paint()` — leaving the previous markup on screen with
its buttons already disabled. **Every other reader of `af.acting` already
used `findMinion`** ("a minion can leave play at any point, so read it with
`findMinion`, not `getMinion`" — the combat sweeps' own lesson).
`derived.ts` now imports no `getMinion` at all, with a comment saying why:
**a derived read must be TOTAL**, or a throw surfaces as a game nobody can
answer instead of an error somebody can act on. A bleed with nobody doing
the bleeding is **0**, and the event-log fold is skipped with it (those are
bonuses TO a bleed). The **reaction** half was always fine — a bystander's
card outlives the frames; the **modifier** half is the one that broke,
because a modifier is played by the acting minion. `paint()` now catches,
prints the error and rethrows, so an engine error can never again be
indistinguishable from a frozen table.

**THE ASH HEAP COUNT WAS MEANINGLESS, and the measurement is the finding:
`CardBurned` fires ZERO times in a whole game.** The render computed
`CardBurned` events ÷ seats — burning is one of FOUR ways into the heap and
in practice the one that never happens (a discard, a card in play burning,
and an action card resolving are the others), while `SeatState.ashHeap` —
the real zone, built 2026-09-01 — sat unread. It is now that field, and the
pile is a **button that opens for ANY seat**, since p. 16 makes the ash
heap the one fully public zone in the game.

**`LegalOption.answerChoice.card` — the richer-options principle again.** A
search's candidates are card ids in a zone the viewer cannot read
(`redactFor` masks every library **including its owner's**, p. 14), so the
only place a candidate's name existed was inside the label as prose.
The name is now structural, **backfilled centrally in `choiceOptionsFor`**
rather than by each of the dozen handlers that build a card choice — the
`backfillCentralQueries` pattern, applied before a thirteenth could forget.
Nothing is revealed that the answer did not already reveal. The UI shows
those choices as **card scans**, which is what "looking through your
library" should look like.

**`LocalTransport.setLocalSeat(seat)` — the hand is always YOURS.**
Masking followed whoever was being ASKED, which is a **hotseat** rule (several
people, one screen) and took the player's own hand away every time a bot
was thinking — precisely when there is time to read it. With one human at
the client the view masks to them always; null keeps hotseat unchanged. It
is the same rule and the same subject `stateFor` already uses for a peer.
The hand is still only PLAYABLE on your own decision.

**Auto-pass already worked for a human seat** — the report was that it did
not, and `tests/ui/autopass-human.test.ts` pins that it does, **with a
control case** asserting the same table without the toggle IS shown those
passes (or it would pass for the wrong reason). What was wrong was
DISCOVERABILITY: per-seat, off by default (the owner's own standing rule),
and four bare names with nothing saying which was yours. Your seat is now
marked "(you)".

Also landed: the **seat grid** (`seatColumns(n) = clamp(ceil(n/2), 1, 3)` —
seating ORDER untouched, because your prey being on your left is a rule,
p. 15); **seat thumbnails** (a player's profile picture; a bot gets a glyph,
never a borrowed face — a remote player's avatar rides on `join` and is
**re-checked by `avatarProblem` on arrival**, since it came from somebody
else's client); the **play strip** across the top (every `cardPlay` frame on
the stack plus the acting minion's stealth and each possible blocker's
intercept — open information, the `PlayerView` §3 argument); the preview
hiding on **`mousedown`** (it is in the way from the press, not from
`dragstart`); a greyed-out card losing its selection; `settings.cardTextPx`
(default 15, was a hard-coded 11); a confirmed **Leave** button that closes
the room on the way out; and **`setName`** in the lobby (the name still
ARRIVES from the profile; the HOST decides the final one, because a seat
name IS the engine's seat id, and it is refused once the game has started).

**Two fixture traps, both familiar.** A walker taking `options[i % n]`
never got round to playing a card, so the ash-heap test found an empty heap
— **agents play a real game; index-walkers play the board**. And the avatar
test's second guest was turned away as "table full", so their avatar was
null for the wrong reason; the test now asserts they were seated at all
first.

**ACTIONS LIVE ON THE CARDS THEY ARE ABOUT — owner request, 2026-09-05
(`docs/playtest-2026-09-05.md` §15). THE TABLE IS AN INTERFACE, the way
the hand already was.** A minion or a card in play with something it could
do is **lit, badged with how many, and clicked** — the click opens a menu
on the card. The bar keeps only what no card could carry.

**A CLICK IS "SHOW ME", NEVER "DO IT" (owner request, §16).** A lone
legal play used to resolve on the click, saving a menu of one. That cost
the player the only chance to read what they were about to do — and a
card's ONE legal play is often not the one they had in mind: a mode they
cannot afford is not offered, so the offered mode may be the other one; a
targeted card with one legal target aims somewhere unchecked. The menu now
opens for one option as readily as for five, in the hand and on the table
both. One extra click on the commonest case is the right trade in a game
where a misplayed card cannot be taken back.

**Which card an option is about needs NO id parsing** — `LegalOption`
already says, structurally: `minion` on `takeAction`/`declareBlock`/
`burnForIntercept`/`burnForUnlock`/`cancelBlock`/the three influence
options, `source` on `useAbility`/`useEntryAction`, and `castVote.source`.
That is the richer-options principle paying out a second time; parsing
option ids would have been a second, drifting model of the vocabulary.

**THE SAFETY PROPERTY IS THE WHOLE OF THE RISK: an option indexed under a
key nothing renders would vanish from the table AND the bar, and a missing
option looks exactly like an illegal one** — this project's oldest failure
shape, one layer up in the UI. So `actionsByTableCard(dp, state)` takes
the STATE and indexes only under ids the table actually draws.
`castVote.source` proves it necessary: it is a minion id, or `card:<id>`,
**or "edge" or "caller"**, which are not cards — those are dropped from the
index and stay on the bar. Two tests pin it from both ends (every key is on
the table; every option is reachable from exactly one of table, hand, bar).

**Measured, per window:** `turn.minion` keeps only *End minion phase*
(**nine buttons became two badged minions plus one**); `action.effects`
keeps *Pass*; `turn.influence` keeps *Pass* and the *crypt draw* — which is
about no card on the table because the card is not there yet. An option
lights **every** table card it names, so a granted rush shows on the card
granting it and on the minion performing it, and a diablerie on both the
diablerist and the victim. Click-only (dragging a hand card onto a tile
already means something else), inner tile wins for nested attachments, menu
grows **down** (a table card has room below it, a hand card does not), and
nothing lights while an AI's move is paced.

**THE OLD GAPS, CLOSED — 2026-09-05 (`docs/old-gaps-closeout.md`).** The
owner asked for five long-standing items. **Go-getter superior was ALREADY
DONE** (the ledger-closeout built it; the "Next" queue line was stale —
another stale queue entry). The other four:

**1. "WHO HAS LOOKED AT THIS CARD" — BUILT.** The gap recorded the day
`PlayerView` was finished, and real since Revelations. `GameState.knowledge`
(seat → card instance ids), event **`CardsRevealed`**, emitted where the
card says "look at your prey's hand" — **not** in the choice's option list,
which is a pure read, and the actor has seen the hand whether or not they
discard from it. `redactFor` unmasks a known card in somebody else's hand;
`PlayerView.hand` for another seat is now `{ count, known }`, where `known`
is a SUBSET (they may have drawn since). Keyed by card INSTANCE and never
expired — you saw that physical card. Event-sourced, so a replay remembers
what the original player remembered.

**A LIVE RULES BUG FOUND WHILE BUILDING IT: Revelations' BASIC mode was
putting the card into play**, which is the superior's whole text ("[AUS]
Put this card in play. Your prey plays with an open hand"), so the basic
mode granted a permanent open hand on the prey for the rest of the game.
Cause: **`putsInPlayOnSuccess` is registered when ANY mode does it, and
returned a default entry for a mode with no such effect** — the Wall of
Filth shape again (*a handler lookup cannot answer a question whose answer
differs by mode*). It returns `null` now and the engine falls through.

**2. LEADERBOARD — BUILT.** `src/ui/results.ts`: `resultFrom` and
`standings` are pure; storage is guarded. Recorded from the **transport**,
for the game log's reason — only the authority sees a game that bots
finish. The sink is INJECTED (`onResult`), so the fuzz and the batch
harness record nothing. A name counts as a bot only if a person never
played it.

**3. DECK LIBRARY — BUILT, and it reaches the lobby.** `src/ui/decklibrary.ts`
stores the deck's **SOURCE**, not its cards: a precon stays a pointer (it
follows the registry as the pool widens) and a pasted list keeps the words,
so the import report can be shown again. `deckSummary` is re-derived on
every read through the same path a game is dealt from — a deck saved today
can stop being legal tomorrow. Saving happens in the deck panel, which
serves the new-game screen AND a lobby guest through one code path, so a
saved deck appears in both by construction.

**4. DIABLERIE STEPS 2 AND 4 — BUILT** (`docs/diablerie-design.md` §6 was
stale AGAIN: it said "needs an equipment-move primitive, which no gate has
built" — `moveAttachment` had existed since the granted-rush wave, and
`attachFromZone`'s own comment already named this use).
**Step 2 (equipment) is taken AUTOMATICALLY and synchronously**, before the
burn — a recorded reading: the resolution is an indivisible unit, and a
choice raised inside action resolution is *deferred until the action
settles*, by which time the victim and its equipment are burned. Equipment
that would duplicate a unique the taker already controls is left to burn.
**Step 4 (older victim's Discipline) is a real question**, engine-owned
like the discard-down, and lands **before the blood hunt** — the correct
p. 34–35 order (the resolution completes, then the referendum).

**5. WITHDRAWAL — BUILT** (p. 38, quoted in the test file). Announced in
your unlock phase once your library is **exhausted** and your hand is
short; succeeds at your next unlock phase if no minion entered combat, no
minion lost blood, and you lost no pool. **1 victory point, and the
predator gets NOTHING** — no VP and no pool, which is the whole point of
withdrawing rather than being ousted. The violation check hangs on `emit`,
the one point every event passes through. **It is a LATCH tripped by the
loss, not a comparison of totals** — "fails if you lose a single counter,
EVEN IF you also gain enough to make up for the loss".

**Three sites decide whether the unlock window stays open** (settle's
phase-advance, `turnDecision`, `applyTurnPass`) and all three had to name
the withdrawal — missing one silently skipped the OTHER seats' "during any
unlock phase" cards. **Every fixture has an empty library**, so the option
now appears across the suite; three traces gained a decision, and that is
the engine being right rather than an artifact to suppress.

**THE PDF READER**: the rulebook was read with a ~40-line Node script using
only `zlib` (kept in the scratchpad, not the repo) rather than adding
`pdf-parse` as a dependency. Worth repeating — the contested-cards and
withdrawal rules are quoted verbatim in `docs/old-gaps-closeout.md`.

**STILL OPEN: contested cards and contested titles** (p. 17–18). The rules
are now transcribed exactly, and the finding is that this is a real
subsystem rather than a patch: contested cards are turned **face down and
out of play**, cost **1 pool per unlock phase** to hold, and yielding
**burns** the card; contested titles cost **1 blood**, are yielded
automatically by a vampire in torpor or with no blood, and are keyed on the
**CITY** for prince/baron/archbishop and on the **CLAN** for justicar and
Inner Circle. **`MinionState` carries no title city** — the `path` lesson
again: the data is in the crypt card text and the importer drops it. Not
started.

**Green baseline as of 2026-09-05: 169 test files, 1792 tests, typecheck and
`vite build` clean.** If a fresh session sees fewer, something regressed.

**BLOCKED — THE LIST IS EMPTY (2026-09-03).** Every gate that was on it
has been unblocked and built: **the ash heap on 2026-09-01**
(docs/ash-heap-design.md), **wraith/zombie — 14 cards — on 2026-09-02**
(docs/wraith-zombie-design.md), **token vampires and all four Path cards
on 2026-09-03** (docs/token-vampire-design.md,
docs/path-cards-design.md). The cut list in docs/partial-support.md is
empty too; what remains there is the PARTIAL half (supported cards with a
named missing clause) and the retrofit list.

Per-gate deferrals still open (each noted in its doc, all of them
ledgered in `docs/partial-support.md`):
**Go-getter superior** (re-entrant action resolution — costed in
docs/last-equipment-modifiers-design.md §7, kernel change, owner review
first); the `.44 Magnum` bespoke weapon not honoring the equipment
restriction; Rutor's Hand's pay-to-opt-out. **The two temporary hand-size
cards are DONE** (2026-09-02, docs/temporary-hand-size-design.md — the
bonus is a grant on the turn/combat frame, and p. 7's discard-down is now
built). **THE FRENZY GATE IS
FULLY CLOSED** (Terror Frenzy superior via the play-cost gate, Tranquility
Shield's immunity + cancel in the round-recurring wave, Meditative Grove
in the blood-locations wave), and **Deep Song's superior is DONE**
(2026-09-02 — the inversion was the two arguments to `pushCombat` in the
other order).
Still-open pre-existing gates: withdrawal + contested titles/cards,
equipment-move (completes diablerie's equipment-take). **The ash-heap
region is BUILT** (2026-09-01) — and note that diablerie's older-victim
Discipline gain was deferred partly on it, so that deferral is now only
waiting on the master-Discipline search, which the library-search gate
already provides.

**Owner decisions on record:** never auto-skip a player — per-seat
auto-pass toggle (default off) applied outside the engine core; design
docs get owner review before kernel code.

**Owner decision 2026-09-03 — the scope lock may be widened beyond V5,
and the intent is to do so eventually** ("the plan in the future was to
widen the scope beyond V5 anyway"). It was authorised specifically to
unlock the last three Path cards, and **was not used, because the premise
turned out to be false** — those cards needed no wider pool
(docs/path-cards-design.md §0). So the V5-only pool still stands and
`config/v5-sets.json` is unchanged, but **widening is now a decision the
owner has already blessed in principle** rather than one to go back and
ask about. That is phase 8's job (`remaining pool`), and the pipeline is
ready for it: `data/vtes-raw.json` already holds all 4,149 KRCG cards, so
widening is an edit to `config/v5-sets.json` plus `npm run cards:registry`
— no network fetch. Expect the card count to jump from 661 and every
"X/444" tally in this file to need re-deriving.

**AI PACING — owner playtest finding, 2026-09-03
(`docs/debug-ui-design.md` §10). "The AI responds too quickly… so non-AI
players are able to follow what's going on."** An agent answers in
microseconds, so an AI seat's whole turn landed between two repaints and
the human saw only the aftermath. `LocalTransport.aiDelayMs` holds the
table for a beat after each AI move; ⚙ Settings → AI players → **Pace**
(Instant / Fast / **Normal 0.9s** / Slow / Very slow). It lives in the
**transport**, beside auto-pass and the agents, for the same reason those
do — *agents are stepped by the authority*, so phase 6's host owns their
pacing and a peer needs no code. **The transport's own default is 0**: the
batch harness, the fuzz and every test drive it, and a pacing default
would make all of them wait on wall-clock time. A test plays 120 human
answers against the same seeded agents at 0 ms and at 1800 ms and asserts
the **command logs are equal** — pacing changes no decision and no game.

**Only a VISIBLE move is paced, and that is the design.** An impulse cycle
is mostly Passes; pausing on each would spend the whole budget on nothing
happening and a player would learn to ignore the pause. So the chosen
option's `kind` is inspected and a pass is applied instantly. The beat is
taken **after** the move (the table shows what happened, then holds) and
**never before handing control back to a human**, who sets their own pace.

**Two consequences, both the same fact — during the pause the decision
belongs to the AI.** (1) `view()` masks to the seat being asked, so it
would have put the AI's hand on a shared hotseat screen; the pause is
drawn through the **last human's** eyes, or through `NO_SEAT` (matching
nobody, hiding everything) when no human has been asked yet. (2) Nothing
on screen may answer it: the decision bar says "⟨seat⟩ is deciding…"
instead of rendering buttons, the hand lights no card, `wireHand` does not
attach and `submit()` returns early — otherwise a human would have been
able to play the computer's seat for it, since the buttons are rendered
from whatever `decision()` returns. **`stepAutomatic()` cancels any
pending timer first**, which is what makes undo/load/restart safe: all
three replay into a *fresh engine*, and a stale timer would step a game
that no longer exists.

**A test-fixture finding worth keeping: `PassAgent` is not purely
passive.** A seat that MUST act (its own turn) is offered no pass and it
takes the first option instead — so the "passes are not paced" test asks
the agent what it answered rather than assuming, and asserts the agents
passed at least 20 times, because without that the check would hold
vacuously.

**Auto-pass — BUILT 2026-08-30, in the transport, not the engine.**
`LocalTransport.autoPass` (per seat, default off) answers a decision whose
whole option list is a single `pass`; `runAgents` became
`stepAutomatic()`, since an agent seat and an auto-passing seat are the
same idea — a decision the authority can answer without a human. The
engine still offers that lone Pass unchanged, and the pass lands in the
command log as an ordinary decision, so **a replay reproduces the game
whether or not the replaying client has auto-pass on** (pinned by a test).
The non-obvious consequence: **undo had to learn to rewind past decisions
the transport answers itself** (`rewindPastAutomatic()`), or undo lands on
an auto-answered decision, re-answers it instantly, and looks broken —
agent seats had that bug already. A **⚙ Settings** dialog holds auto-pass
(per seat + all) and the debug reveal; `src/ui/settings.ts` persists
preferences in localStorage and is explicitly NOT game state — nothing in
it enters the command log, changes legality, or rides in a save file.

**Bug fixed 2026-08-02 (worth remembering):** the `turn.unlock` window is
offered to *every* seat (for "during ANY Methuselah's unlock phase" cards
like Homunculus), so "during **your** unlock phase" cards that only
checked `ctx.seat === owner.seat` fired once per player per turn cycle —
all 13 hunting grounds, Powerbase: Madrid, Vessel and Dreams of the
Sphinx. `PlayContext.turnSeat` now carries whose turn it is; gate any
"during your X phase" ability on it. Regression:
`tests/cards/own-unlock-phase.test.ts`.

**Known deviations / non-invariants (intentional, revisit later):**
cross-player uniqueness contests unmodeled (own-duplicate prevention
only — so stealing a second copy of a unique location you already control
is legal) — includes contested titles (p. 19), out of scope; titles are a
`MinionState.title` field set by fixtures now, parsed from crypt text at
deck import (phase 7) — same for `clan`/`sect`; clan-change and
sect-change are out of scope; **Paths are a PRINTED CRYPT TRAIT and fully
live** (`MinionState.path`, 2026-09-03) — set by fixtures today and by
phase 7's importer from the crypt card, exactly like `clan`/`sect`/
`title`, and nothing in play grants or changes one because no card in
VTES does (docs/path-cards-design.md); a referendum whose
terms have no legal choice passes with no effect; diablerie's equipment-take (needs an
equipment-move primitive), older-victim Discipline gain (needs the ash
heap + master-Discipline cards), and Red List trophies are all deferred
(TODO in engine.ts commitDiablerie); **"plays cards as a vampire" allies
are BUILT** (2026-09-02, `ally.playsAsVampire` — Vozhd of Juiz de Fora;
Spectral Servitor stays BLOCKED for being a wraith), with the p. 11
default capacity of 1 deliberately unbuilt because nothing reads it;
**War Ghoul's enter-play "self" victim is NOT a deviation** — the reading
is recorded (docs/vozhd-allies-design.md §1) and `ally.enterPlayBurn`
takes the same one; fuzz games end in
a draw at `maxTurns` (engine safeguard, not a rule); the acting minion
may legally unlock mid-action (superior Majesty) — "locked at
announcement" is the real invariant.

## Reference material: Cockatrice (`docs/cockatrice-lessons.md`)

A Cockatrice source tree sits in the repo folder as **reference only**
(gitignored; GPL-2.0 C++/Qt). **Never port its code — including
hand-translating a file into TypeScript — as that would put this project
under the GPL.** Patterns only.

**The key finding: Cockatrice has no rules engine.** Its whole in-game
vocabulary is manual tabletop manipulation (`move_card`, `flip_card`,
`attach_card`, `create_counter`, `set_card_attr`, `next_turn`…); the server
enforces zone integrity and information hiding, not legality. That is why
it supports every MTG card ever printed with zero card implementations —
so **its card coverage is not a benchmark for ours** — and equally why it
**cannot have AI players**, which is this project's headline feature. Our
rules-authoritative engine is the right call *because* of that
requirement. Do not adopt their core model, and do not adopt their
event-stream replays either (we replay the *command log* into a fresh
engine, which is smaller and self-verifying — principle 2 paying out).

Worth taking, in priority order: (1) **one Server, two transports** —
their `LocalServer : public Server` means single-player is the real server
in-process behind a loopback — **BUILT, see the transport seam below**.
(2) Their zones serialise
per-recipient with an `omniscient` flag — confirms `viewFor()` is the
right boundary, and exposes two gaps: `PlayerView` omits `permanents`, and
we have no model of **"who has looked at this card"**, which VTES needs
the moment an effect reveals a hand or library top. (3) Their card-picture
loader has a loading-in-progress state, a per-card failure cooldown, a
two-level cache and bulk deck pre-warm — ours has none of those.
(4) `DeckList`'s **deck hash** for phase 7.

## Adding a card (established workflow)

1. Read the exact card text from `src/cards/registry.json` — never guess;
   check the rulebook/ruling sections for timing subtleties.
2. Express it as a CardSpec if the vocabulary covers it; extend the
   vocabulary if the pattern recurs; otherwise hand-roll a `CardHandler`
   in `cards.ts` (the bespoke tail). Never special-case the engine loop.
3. Write a deterministic scenario test in `tests/cards/` — fixtures'
   `runTrace(engine, [[seat, optionIdPrefix], …])` drives every decision
   explicitly; assert the negative space too (option NOT offered).
4. Flip the id in `config/supported.json`, run `npm run cards:registry`.
   **`implementedIds` is only for a bespoke handler with NO spec.**
   `implementedIds` already starts with `...cardSpecs.map(s => s.krcgId)`,
   so a bespoke handler built on `compileSpec(specByName(…))` — the usual
   pattern — is covered; adding it again makes a duplicate and
   `supported.test.ts` fails on it.
5. Add the card (and any discipline it needs) to the fuzz decks in
   `tests/engine/fuzz.test.ts`. **Every addition reshuffles every seeded
   game**, so a green fuzz before and a failure after usually means a
   pre-existing latent bug just got dealt into a game, not that the new
   card broke something.
6. `npm run typecheck` && `npm test` green before done.

**Edit source files with the file-editing tools, never with shell string
surgery.** `node -e`, heredocs and `sed` all mangle TypeScript: backticks,
`${...}` and apostrophes get eaten by the shell, and this has silently
corrupted `render.ts` and `cards.ts` more than once (a `node -e` patch has
also written the literal string `undefined` into a source file). Shell
scripting is fine for JSON (`config/supported.json`) and for read-only
queries over `registry.json`.

Option-id conventions (trace tests match by prefix):
`play:<Name>:<mode|->:<minion>:<params…>:<cardInstanceId>` for hand
plays; `ability:<Name>:<cardInstanceId>:<params>` for in-play abilities;
built-ins: `pass`, `bleed:<minion>`, `hunt:<minion>`, `leave:<minion>`,
`diablerize:<actor>:<victim>`, `rescue:<actor>:<victim>:<actorPortion>`,
`block:<minion>`, `strike:hand`, `press:continue|end`, `inf:add/take/out:
<id>`, `inf:crypt`, `edge:gain`, `discard:<cardId>`, `end`;
`act:<Name>:<cardInstanceId>:<targetMinion>` for actions granted by
cards in play (rush), `act:<Name>:<cardInstanceId>:<what>:<actingMinion>`
when a card grants a non-rush action (`burn` for the shared "Minions can
burn this card as a Ⓓ action" clause, `counter` for Pit of
Contemplation's — a card may grant several);
`maneuver:credit` spends a rush maneuver rider;
`terms:<...>` chooses referendum terms and `vote:<source>:for|against`
casts votes (`source` = minion id, `edge`, `caller`, or `card:<id>`);
`diablerize:offer:<blocker>:<victim>` takes the leave-torpor diablerie;
`choice:<Name>:<cardInstanceId>:<key>:<answer>` answers a ChoiceFrame
(declining an optional one is plain `pass`).

**Writing trace tests — the three gates that make an option vanish**, each
of which has cost an hour of "why is my card not offered":
1. **Stealth/intercept are only offered when NEEDED** (p. 26). A stealth
   modifier is not on the table during an unopposed action, and an
   intercept location is not on the table unless the blocker's intercept
   is below the action's stealth. Use a **hunt** (+1 inherent stealth) as
   the action when a test needs intercept to be live.
2. **Only one LIMITED bleed bonus per action** (p. 10) — stacking bleed
   modifiers to build a scenario does not work after the first.
3. **Reactions live in state A, not the announce cycle**, and a wake is
   only playable by a *locked* vampire, so a reacting seat's minions must
   be locked for a wake to appear at all.

## Testing (non-negotiable)

- Vitest; suites in `tests/engine/` (kernel + fuzz) and `tests/cards/`
  (per-card scenarios + `supported.test.ts` metadata cross-check).
- Every card implementation lands with a deterministic scenario test.
- Fuzz harness (`tests/engine/fuzz.test.ts`): seeded 4-seat random games
  to completion; invariants: options non-empty + unique ids, blood within
  [0, capacity], lock-at-announcement (event-adjacency), pool/blood
  conservation by replaying the event log; failures report their seed.
- Run `npm run typecheck` and `npm test` before declaring any task done.

## Launching the player

The owner does **not** want to run terminal commands to play.
**`Play VTES.bat`** at the repo root is the double-click launcher: it
checks for Node, runs `npm install` on first use only, then
`npm run play` (`vite --open`), which starts the server and opens the
browser. The console window it opens IS the server — it must stay open, and
closing it stops the game. Keep it working; if the dev command ever
changes, change the `play` script rather than the batch file.

## Design docs — the index

Every mechanic that took a decision has a doc; each one holds the rulebook
citations and the readings taken, so **read the doc before touching the
mechanic** rather than re-deriving it. All under `docs/`.

**Kernel / sequencing:** `impulse-design.md` (the frame stack and impulse
cycle — §10 is the citation list), `choice-frames-design.md`,
`control-change-design.md`, `derived-traits-design.md`.

**Combat:** `strike-effects-design.md`, `dodge-additional-strikes-design.md`,
`weapons-design.md`, `weapon-riders-design.md`, `frenzy-design.md`,
`actor-riders-design.md`,
`dawn-operation-design.md`, `outside-combat-design.md`,
`round-recurring-combat-design.md`, `combat-attachments-design.md`,
`round-end-design.md`, `last-combat-design.md`.

**Actions and blocking:** `rush-actions-design.md`, `rush-outcome-design.md`,
`other-vampire-modifiers-design.md`,
`granted-actions-design.md`, `granted-rush-design.md`,
`block-restrictions-design.md`, `block-tax-design.md`,
`fail-block-design.md`, `unlock-and-block-design.md`.

**Politics:** `politics-design.md`, `abstain-gate-design.md`, `politics-followups-design.md`,
`polling-votes-design.md`, `ballots-design.md`,
`politics-locations-design.md`, `referendum-terms-design.md`,
`opposing-statics-design.md`,
`cross-table-masters-design.md`,
`taking-actions-design.md`, `ash-heap-design.md`.

**Cards and economies:** `card-primitives.md` (the CardSpec vocabulary),
`clan-sect-design.md`, `on-vampire-statics-design.md`, `counters-design.md`,
`cost-sources-design.md`, `counter-sinks-design.md`,
`bespoke-economies-design.md`, `modifier-or-combat-design.md`,
`unlock-tolls-design.md`,
`discipline-filtered-design.md`, `play-cost-design.md`,
`minion-target-actions-design.md`, `action-attachments-design.md`,
`lock-grant-locations-design.md`, `action-time-locations-design.md`,
`blood-locations-design.md`,
`conditional-statics-design.md`, `granted-bleed-and-target-costs-design.md`,
`after-combat-ends-design.md`, `play-from-hand-design.md`,
`stun-design.md`, `pool-drain-design.md`, `library-search-design.md`,
`end-action-design.md`, `after-resolution-design.md`,
`referendum-margin-design.md`, `blocker-riders-design.md`, `bleed-answers-design.md`,
`archetypes-design.md`,
`allies-retainers-design.md`, `vozhd-allies-design.md`,
`crypt-and-uncontrolled-design.md`,
`retainer-wave-design.md`,
`last-equipment-modifiers-design.md`, `last-buildable-design.md`,
`cheap-tail-design.md`, `diablerie-design.md`,
`temporary-hand-size-design.md`, `wraith-zombie-design.md`,
`token-vampire-design.md`, `path-cards-design.md`.

**Planning:** `crypt-wave-7.md` (C7: the last seven — and the `onActionAnnounced` hook that had been firing one step too early since it was written), `crypt-wave-6.md` (C6: the referendum tail — a direction-keyed vote bonus, a toll on casting, and the cancelled-vs-failed hook), `crypt-wave-5.md` (C5: granted actions with a cost, filters on the opposing minion, and phase hooks that ask a question), `crypt-wave-4.md` (C4: trading a card for a bonus — one clause for eight cards, and the `onBleedSuccess` attached-card bug), `crypt-wave-3.md` (C3: combat and blocking — the in-combat-with condition, read off the live frame), `crypt-wave-2.md` (C2: rushes, unlock riders and searches — and two silent no-ops worth reading), `crypt-wave-1.md` (C1: the crypt spec kind, the self-attached entry, and 33 static cards), `crypt-plan.md` (the phase-7 survey: 118 of 217 crypt cards already work, the other 99 are mostly DATA against existing primitives because a crypt ability is a self-attached entry like an ally's), `partial-support.md` (the ledger of supported cards with a
known-missing clause), `ledger-closeout.md` (the 2026-09-03 pass that made every printed clause on every library card functional — the ledger is now empty of engine-work rows), `library-audit.md` (the 2026-09-03 sweep of all
444 supported cards — what was checked, what the detectors found, and the
one card whose deferral lived in a comment instead of the ledger), `remaining-mechanics-roadmap.md` (the eight reusable-mechanic
gates, all closed), `one-off-sweep.md` (the per-card tail), `bleed-riders-sweep.md`,
`permanent-target-actions-design.md`.

**AI:** `ai-v1-design.md` (the scoring policy, the batch harness, and the
`PlayerView` gap the first batch run found — a view correct about what it
hides can still omit what a player needs), `richer-options-design.md`
(options carrying what the engine already computed and dropped: block
arithmetic and live play costs).

**UI and reference:** `debug-ui-design.md`, `playtest-2026-09-05.md` (the third playtest pass: the seat grid, the play strip, an ash-heap count that had been meaningless, and the ally that pays its last life mid-action — why a derived read must be total), `lobby-design.md` (room codes, the lobby, the PeerJS adapter — and why a public room list needs a server), `shell-design.md` (profile, menu and new game — local-only profiles, and where the decisions live vs the screens), `multiplayer-design.md` (the host/peer core: the protocol above the carrier, masking per recipient, and why a choose names the decision it answers), `deck-import-design.md` (one parser for every site, precons derived from the KRCG snapshot, and what counts as fatal), `fresh-game-design.md` (dealing a real game from real decks — the p. 14 setup, and what it proved about starting the engine from an empty table), `game-log-design.md` (per-playthrough log files: the dev-server sink, and why the logger is an observer in the transport rather than a hook in the UI), `futile-options-design.md` (options that would do nothing, and where excess blood really goes), `cockatrice-lessons.md`.

## Commands

- `Play VTES.bat` — double-click launcher (owner-facing; see above)
- `npm run play` (server + browser) / `dev` (server only) / `build` /
  `typecheck` / `test`
- `npm run simulate` — batch AI games (`-- --games 200 --seed 7 --verbose`);
  exits non-zero if any game errors, so it doubles as a soak test
- `npm run cards:fetch` → `cards:sets` → `cards:registry` (KRCG pipeline;
  fetch needs network)

## Working with the owner

- Experienced game developer (JS/HTML games, Godot), but **new to
  TypeScript, npm tooling, and terminals** — explain toolchain steps
  plainly, no unexplained jargon, give exact commands.
- Strong preferences: plan before code; present design tradeoffs before
  building; systems-level depth over quick hacks; headless validation
  before delivery.
- Prefers being walked through decisions rather than having them made
  silently. When a rules question is ambiguous, cite the rulebook section
  and ask.
- **Report the card count with every card wave** — library X/444 with the
  percentage, crypt 0/217, total X/661. Re-derive it from the registry
  rather than trusting the number written here.
- "Onto the next" / "back to the card sweeps" means: pick the next
  coherent cluster from the **Next** queue above, write its design doc,
  build it, test it, keep everything green, update this file, and report
  what was learned — not just what was added.
- The owner plays the build and finds real bugs by looking at the table
  (the exposed uncontrolled region, the unpaid-for starting pool). Take
  that feedback literally and check the rules before assuming it is
  cosmetic.

## What a new session should read first

1. This file, top to bottom — the scope lock, the seven architecture
   principles, and the card registry rules are all binding.
2. **"Status in one paragraph"** near the top, then the **Next** queue and
   the **Green baseline** line further down.
3. `docs/impulse-design.md` before touching sequencing, and the specific
   design doc for whatever mechanic is in play (index above).
4. `docs/partial-support.md` **before designing against any deferral**. A
   deferral is a claim about the code *as it was*, and five cut-list rows
   in eight waves turned out to name a blocker that had since been built
   or was cheaper than written down. Reading the ledger takes minutes;
   re-deriving it takes hours.

### The library is DONE — 444/444

There is no card question left in the library and no blocked list. **Five
gates were unblocked and built in three days**: the ash heap on
2026-09-01 (`docs/ash-heap-design.md`), wraith/zombie — 14 cards — on
2026-09-02 (`docs/wraith-zombie-design.md`), and token vampires plus all
four Path cards on 2026-09-03 (`docs/token-vampire-design.md`,
`docs/path-cards-design.md`).

**The scope lock was NOT widened, and did not need to be.** The owner
authorised widening the pool beyond V5 to unlock the last three Path
cards; the survey then found the premise was wrong — a Path is a printed
crypt trait carried by all 48 Sabbat V5 vampires already in the pool, and
the full 4,149-card legacy pool contains no Path-granting card either. So
`config/v5-sets.json` is untouched and the V5-only pool still stands. **If
the pool is ever widened it should be for its own reasons**, not for
these cards.

**Phase 5 (AI v1 + batch simulation) is the next build**, and
`Agent`/`playerView`/the transport seam were all designed for it. One
thing to carry into it: Revelations' hidden-information memory gap
(above) lands on an AI seat, not on a hotseat human.

Do not relitigate the settled decisions (headless engine, event sourcing,
the impulse system, the legal-move generator, the V5-only pool, the
transport seam) without the owner raising it first.
