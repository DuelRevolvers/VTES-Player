# Saved games and default bot names

*Owner request, 2026-09-09: "Add settings to the profile menu at the main
menu for loading a saved game and changing the default bot names."*
Landed in **v0.9.8**.

Two settings, one screen. Both live on the **Profile** screen, which is
reached from the main menu — the same place the deck library already
lives, for the same reason: this is where the things that are *yours*
are. A sixth button on a five-button menu, empty for most of a player's
first session, is a worse first screen than a section they find when they
have something in it.

---

## 0. What was already there

Worth writing down, because most of the work was joining up machinery
that existed rather than building it.

- `src/ui/history.ts` already turned a game into a `SavedGame` — a
  `GameSetup` plus the command log — and replayed it. **Save, load and
  undo are one operation**, which is architecture principle 2 paying out.
- The table already had **Save** and **Load** buttons. Save wrote a single
  unnamed `localStorage` slot (`vtes-debug-game`) *and* dropped a `.json`
  in Downloads; Load read a file.
- Nothing outside the table could reach any of it. The slot was never
  described, never listed, and never loaded from anywhere a player would
  look.
- **Bot seats were already renameable in the lobby**, per game. So this
  was never about being able to name a bot — it was about not retyping it
  every game.

## 1. The three decisions the owner made

Asked before any code, because each changed the work:

1. **Named slots, plus an automatic one.** Not one overwritten slot, and
   not manual-only. The table rewrites a **Last game** slot at the top of
   every turn, so *Continue* works whether or not anyone pressed Save.
2. **An editable list of bot names, used in order.** Not a pool drawn at
   random. Bot seat 1 always gets the first name, which is what makes a
   leaderboard row accumulate against one bot instead of scattering.
3. **The AI's seed still follows the bot's NAME.** `seatSeed` hashes it,
   so "Bea" makes the same choices in the same spots every game and
   renaming a bot genuinely gives it a different personality. This was
   already true; the decision was to keep it and say so on the screen.

## 2. The store

`src/ui/savedgames.ts`. Same shape and the same rules as
`decklibrary.ts` — local only, every read and write guarded, an empty
store is not an error.

Two kinds of slot, and the difference is **who writes them**:

| | Auto slot | Named slot |
|---|---|---|
| Written by | the table, every turn | a person, once |
| How many | exactly one | up to `MAX_SAVES` (5) |
| Overwritten | constantly | never |
| Id | `AUTO_ID` | generated |

`MAX_SAVES` is a guard, not a rule: a save carries its table's whole deck
lists plus every decision in it, and the origin's few megabytes of
`localStorage` are shared with the profile avatar, the deck library and
the leaderboard. **The cap counts only named slots** — the automatic one
is the app's own and must never be squeezed out by a full store.

### ONE store, not two

The old single-slot key is **read once and adopted** as the auto slot
(`adoptLegacy`), then removed. Leaving it would have meant the same game
sitting in two places with nothing keeping them in step, and *"one
question asked in two places will drift"* is a lesson this project has
already paid for several times. `startFromConfig`'s resume reads the same
auto slot; it deliberately does **not write** it (see §5).

Adoption happens only when this store has never been written, so it
cannot resurrect a save somebody has since deleted — which is asserted.

### Keep

The auto slot's row has **Keep**, which copies it to a named slot and
**leaves the auto slot in place**. Taking it away would mean the button
removed the row it was pressed on, and the next autosave is exactly what
the player was protecting the position from.

## 3. `botSeats` — the field that makes a save loadable

A `SavedGame` was `{version, setup, commands}`. **Which seats were bots
was nowhere in it.** Loading a private table therefore gave you three bot
seats with nobody driving them and one human being asked to answer for
all four.

`SavedGame.botSeats?: string[]` fixes that, written by
`LocalTransport.history.snapshot()` from `agentSeats` — the transport is
what agents are attached to, so a save built anywhere else would have to
be *told*, and would one day not be.

**This does not contradict `settings.ts`'s rule** that a save carries no
preferences. That rule is about *replay*, and it still holds exactly: the
answers are all in `commands`, so the game replays identically whoever
holds the seats afterwards. What `botSeats` fixes is a game coming back
**unplayable**, which is a different claim.

### The field is optional, and the guess is said out loud

Saves already existed without it. `botSeatsFor` returns
`{seats, assumed}`: when the field is there it is the answer; when it is
not, every seat but yours is assumed to be a bot — right for a private
table, wrong for a hotseat one.

**`assumed` is not decoration.** `loadSavedGame` puts a confirm behind
it naming the seats it is about to hand to the AI. Handing somebody's
seat to a bot without saying so is the kind of thing that gets reported
as *"it played my turn"*. The check lives in `loadSavedGame` rather than
on the row because there are two ways in — a slot and a file — and only
one of them has a row.

**An empty recorded list is a real answer, not a missing one.** A hotseat
game with no bots records `[]` and must not be re-guessed into three,
which is the distinction the optional field exists for and which the
tests pin.

## 4. Autosave

In `DebugApp`, on `onChanged`, **before** the paint — a paint can throw
(an engine error surfaces there on purpose), and the turn that just ended
is worth keeping precisely when something has gone wrong with the next
one.

**Once per turn, not once per decision.** A save is the setup plus every
command in the game, so writing it costs a full serialisation of both:
cheap next to a turn, wasteful next to a click, and there are hundreds of
clicks in a turn. A turn is also the unit a player thinks in.

The guard is `turnNumber` **rather than a counter of our own**. A game can
be undone or loaded underneath us, and a monotonic counter would then
refuse to write the turn it had already seen. Comparing the actual turn
means a rewind to turn 4 autosaves turn 4 again — which is right, because
the board really is different.

An autosave is a **courtesy** and stays silent when storage refuses. A
save somebody *asked* for says it could not be done. The tests pin both.

### What leaving costs, restated

The leave confirm said *"anything since your last save is lost"*. With the
auto slot that is no longer true for a private game, and it would have
frightened a player out of a door that is now safe. It now says the game
is kept and can be picked up from the start of this turn — but only when
`table.autosave` is set *and* this client has a `history`, because a guest
has neither.

## 5. `autosave` is opt-in, and the playtest path does not take it

`TableIdentity.autosave` is set by the shell and by nothing else. The
playtest snapshot (`startFromConfig`) runs through the same `DebugApp`,
and it is a hand-authored mid-game position somebody is poking at a card
in. **Autosaving it would quietly overwrite the real game a player left
half-finished**, which is the one thing an automatic save must never do.

It may still *read* the auto slot. Reading is harmless; writing is not.

## 6. Save and Download are two things

The table's Save did both: it wrote the slot *and* dropped a `.json` in
Downloads, so a player keeping a position collected a file they never
asked for. The file is for handing over with a bug report — a different
errand, and now its own **Download** button. Save prompts for a name.

The table's **Load** still takes a file, and now re-attaches agents from
the file's `botSeats`: `history.load` replaces the engine and leaves the
transport's agents alone, which is right when the seats are the same
game's and wrong when they are not.

## 7. Bot names

`UiSettings.botNames: string[]` — a preference rather than a profile
field, because it is about the tables made on *this machine*, not about
the person, and it does not travel to somebody else's room the way a name
and a chat colour do.

**`botNameFor(settings, index)` is the one place that answers "what is
bot N called?"** A table is built in two places — a fresh default table,
and the button that adds a seat — and those two drifting apart is how a
table ends up with "Bea, Cato, Bot 3" where the third name was configured
all along. `defaultTable` takes the namer as a function for exactly that
reason.

Details that took a decision:

- **A blank entry holds its place.** The list is positional, so dropping
  an empty third entry would silently promote the fourth name to the
  third bot. Blank means "call it Bot 3", which is the only way to unset
  one — so `botNameProblem` allows blank where `nameProblem` does not.
- **A stored name that would be refused if typed becomes blank.** A hand
  edit or an older version could have put a control character or a
  200-character string in there, and these become **seat ids**.
- **Duplicates are caught on the screen that can fix them.** `buildTable`
  does catch two seats sharing a name — it has to, it is the only
  uniqueness rule there is — but it catches it at *Start*, on a screen
  where the names are not editable. Blanks are exempt: they are not
  names, they are gaps.
- **`uniqueSeatName` for a name the APP chose.** Adding a seat picks a
  name on the player's behalf, so it must pick one that works rather than
  handing out a duplicate and blaming the player for it.
- **Saving names rebuilds `this.table`.** It was built when the shell
  booted, and the player is looking at a screen that says what the *next*
  table will be called — without this, Host would open a lobby still
  showing the old names and the setting would look like it had not taken.
  *A feature that cannot be discovered is indistinguishable from one that
  is absent.* Skipped when a lobby is live: renaming seats out from under
  people who have joined is not what the button says it does.
- **`MAX_BOT_NAMES` is pinned to `MAX_SEATS - 1` by a test.**
  `settings.ts` cannot import `newgame.ts` — that is a cycle, since
  newgame reads the settings — so the constants are pinned in the test
  instead. Widen the table and it fails, which is the point: the sixth
  seat would otherwise be "Bot 5" forever.

## 8. A repaint no longer eats what you typed

Found while building this, and fixed here because this change made it
much easier to hit.

The shell re-renders a screen whole on every change, which is what keeps
it free of stale-view bugs — **but a half-typed name is state too**, and
it lived only in the DOM node about to be thrown away. Every button on
the Profile screen repaints it, so typing a new profile name and then
touching anything else (renaming a deck, deleting a save, saving bot
names) silently put the old name back.

`paint` now reads the live form into `profileDraft` before replacing the
markup, and `profileScreen` prefers it. Cleared when the screen changes —
a draft is about the form you are looking at — and cleared explicitly on
*Delete profile*, which does not change screen and would otherwise put
the deleted name straight back in the box.

## 9. Tests

`tests/ui/savedgames.test.ts`, 38 tests. The project has **no jsdom** and
the shell's markup is not DOM-tested — the house rule is that the
decisions live outside the screen and that is where the tests go. So:

- the slot store's rules, including the auto slot being replaced rather
  than appended, the cap counting only named slots, and *Keep* leaving
  the auto slot in place;
- a **corrupted store keeping its good rows**, and blocked storage
  reading back empty rather than throwing;
- legacy adoption happening **once** and not resurrecting a deleted save;
- `botSeats` making the round trip out of a live transport and back, with
  `assumed` false — and a save without it guessing, with `assumed` true;
- an **empty** `botSeats` staying empty;
- a real mid-game save replaying into the same position, driven by a
  walker that prefers `pass` then `end` (a walker that takes `options[0]`
  plays the board);
- the bot-name fallback, the blank-holds-its-place rule, sanitising on
  read, and `loadSettings` never handing back `DEFAULT_SETTINGS`' own
  array.

## 10. Not done

- **No autosave for an online game.** A guest has no `history` and cannot
  snapshot a game it does not run; the host could, and the slot would then
  hold a game the other players are not in. Left alone deliberately.
- **The table's Load reads a file, not a slot.** The slot list is on the
  Profile screen. Loading a slot mid-game is reachable by leaving first.
- **No screenshot or board thumbnail on a row.** The seat list and turn
  number are what tell two saves apart at a glance.
