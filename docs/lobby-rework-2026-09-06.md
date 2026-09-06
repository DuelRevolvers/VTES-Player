# The lobby rework, and the 2026-09-06 playtest items

Fourteen items from the owner in one pass: a lobby rebuilt as a grid on
one screen, table chat, two live card bugs, and four smaller fixes.

## 1. One screen, not two

**The report:** *"fix the lobby so it doesn't go to a second page if you
want to play online."*

There were two screens — a **new game** screen where you built the table,
and a **lobby** you were thrown to the moment Start was pressed on an
online table. They showed the same thing: who is sitting where, with what
deck, and why the game cannot start. So they are one screen now
(`lobbyScreen`), and the difference collapses to a room bar that appears
when a seat goes online.

**The room opens when a seat is opened, not when Start is pressed.** That
inversion is what removes the second page: the code has to exist while
people are still arriving, and `openRoom` is idempotent so a second open
seat does not open a second room. `start()` on an online table now just
calls `lobbyHost.start()`.

`screen` still has both `"newgame"` and `"lobby"` values because a guest
arrives at the second one, and both render the same function. Three cases
share it — a private table, a host's online table, a guest's view — and
the only thing that varies is **which box you may touch**.

## 2. The grid

*"Make the lobby look like a 3x3 grid, just like the game table."*

`.seatgrid` is three columns, the same shape `seatColumns` gives the game
table, so the seat you set up is laid out like the seat you sit at. Six
seats (the engine's maximum) land as 3×2; two columns under 780px.

Each box, top to bottom, is what the owner asked for: **avatar and name**,
then the **Bot / Open (online)** dropdown, then the **deck picker**. A red
× sits at the top right, and a dashed **+ box** at the end of the grid
adds a seat.

**The first box is always the host** and has no kind dropdown and no ×.
They cannot hand their own seat to a bot or open it to the network without
ceasing to be the host, so the control is not offered rather than being
offered and refused.

**A seat a guest has joined on is not the host's to change** (owner: *"the
Host should not be able to control any players other than their own
deck"*). It renders dashed, with its deck as a label rather than a button.
The host still owns the bots' decks — a bot has nobody else to bring one.

The × also refuses at the handler, not only in the markup: a stale click
must not be able to remove somebody who joined in between.

## 3. Prey and predator

*"Next to a player/bot's name, it should say in smaller unbolded text who
their prey and predator are."*

`seatRelations(names, i)` is in `newgame.ts`, not the screen, because it
is a **rule** (p. 15: your prey is on your left, your predator on your
right) rather than markup — the same split the rest of that file exists
for. The table is a cycle, so it is a rotation, not a lookup with an edge
case at each end. In a two-seat game both answers are the same person,
which is correct rather than degenerate, and there is a null for a
one-seat table so the arithmetic cannot name a seat as its own prey.

## 4. Table chat

*"Add a chat box … accessible in the lobby and in-game. It should be
persistent between them."*

`src/ui/chat.ts` is a **module-level store**, not state on a screen, and
that is the whole design: the lobby object and the table are two
different things with two different lifetimes, and the conversation
belongs to neither. It is explicitly **not game state** — nothing reaches
the command log, so a save replays the same game without it and an undo
does not rewind anything anybody said (the rule hand order and the
per-seat auto-pass toggle already follow).

**The host is the only relay.** A guest sends `chat` and does **not** add
the line locally; the host adds it, stamps the sender's seat name on it,
and sends `chatLine` to everyone including the sender. So every client
lists one conversation in one order. A client that also added its own
line would see its own messages in a different order from everybody
else's — and would show them twice.

That is also why the test **watches the wire rather than the store**: both
ends share one module in a test process, so counting `chatLines()` counts
the harness. The assertion is that both peers received exactly one
`chatLine`, attributed to `Bea`.

The panel is the same markup in the lobby (a card) and at the table (a
side-column panel), over the same store. Who relays it is the shell's
business: the table is handed one `say(text)` function and does not ask
whether it is a host session, a peer channel, or nobody at all.

## 5. Two bugs that were one bug

*"When an online player [joins], the host lobby doesn't update"* and
*"anyone joining a lobby cannot select their own decks."*

**`LobbyHost` had no `onChanged` at all.** Every guest learned through
`broadcast`; the host learned nothing. So a guest joining, renaming or
choosing a deck updated the host's `TableConfig` and left the screen
showing the state before it — and from the guest's side, a deck they had
successfully sent appeared to do nothing, because the only evidence would
have been on the host's screen.

The screen is a pure function of that object, so it only ever needed
telling. `broadcast()` now calls the watchers first, and the shell
subscribes in `openRoom`.

## 6. A player who leaves mid-game

*"if an online player leaves mid-game, a bot takes their place and note
this change in the Game Log."*

`PeerTransport.close()` now **sends `leave` before closing**, and
`HostSession` handles it: the seat gets a `HeuristicAgent`, the game log
gets a line through the new `LocalTransport.note()`, and the chat gets a
system line.

A bot rather than nothing, because **a game of VTES cannot skip a
Methuselah's turn** — one person closing a tab would otherwise stall the
table for everyone else. And a bot is the same `Agent` the seat could
have been played by from the start, so nothing about the game changes
shape; `stepAutomatic` picks it up on the next decision.

`note()` is on the transport rather than the log because only the
authority has a log at all, and it is a no-op without one (the fuzz, the
batch harness, most tests).

## 7. The deck importer on the profile page

The importer only existed inside the deck panel, which is only reachable
from a seat — so building a collection meant starting a game you did not
want. The profile screen now has a paste box and a Save button, writing
through the same `saveDeck` the panel uses. `data-i="-1"` is deliberately
not a seat: the save handler reads its boxes by that index and never
touches `this.table`.

## 8. Sorting your hand off-turn

*"Players should be able to rearrange the cards in their hands during
their off-turns."*

**They already could.** `wireHand` attaches its drag handlers whoever is
deciding, and hand order is a client preference that never reaches the
command log. What was missing was any sign of it: `.hand.watching
.handslot` had `cursor: default`, so nobody tried. It is `grab` now, and
a test pins that every slot is still `draggable` while watching — with
the control that none of them is lit as *playable*.

Same shape as the auto-pass report in `docs/playtest-2026-09-05.md`: the
feature worked and was undiscoverable, which is indistinguishable from
broken.

## 9. Larissa Moreira — a live card bug

*"their ability should not activate until they are the one performing the
bleed action."*

Correct, and the fix is one clause. "During a bleed action, Larissa can
discard a card requiring Animalism to get **+1 bleed**" — the bonus is
hers, so she has to be the one bleeding. The `bleedAction` window gate
asked only *"is this a bleed"*, so any bleed by her controller offered the
discard; `modifyBleed` is **action-scoped**, so taking it would have spent
a card to raise a stablemate's bleed.

The other user of that switch (`anyAction`, Abraham DuSable) was already
safe: its grant is stealth-or-intercept, and both arms already check the
bearer is the actor or the blocker.

## 10. Parity Shift — the engine was right, and silent

*"It didn't give me a choice to allocate the pool."*

Measured rather than guessed: with nobody richer than the caller, the
terms step is **skipped entirely** and the game goes straight to polling.
That is the card ("choose a Methuselah who has **more pool than you do**")
plus the recorded deviation that a referendum with no legal terms passes
with no effect. So the card was played, the referendum passed, and
nothing happened — having cost a card, an action and the caller's lock.

The fix is the **futile-options** reading (`docs/futile-options-design.md`
— an option whose whole content cannot happen is not offered, the
precedent `canGainBlood` set): Parity Shift is not offered when no
Methuselah is richer. It is card-specific on purpose. A general "no legal
terms" gate would change every terms card at once (Banishment with no
younger vampire, and others) and wants its own pass with the owner.

## 11. Not done, and why

**Nothing.** All fourteen items are in. Two were already working and
needed to be made visible rather than built (off-turn sorting, and the
guest's deck actually reaching the host); one was the engine being right
and needing a different treatment (Parity Shift).

---

# The second pass, same day

Six more items.

## 12. Fields look like fields

Text entries, dropdowns and the chat box now sit one shade **above** the
panel they are on (`--field: #2f2d3d`), so an empty box still reads as
somewhere to type. Applied by **element** rather than by class — `.shell
input, select, textarea` — so a box added later is styled by existing
rather than by being remembered.

## 13. Precon play-style lines

`preconStyle(name)` in `deckimport.ts`, shown as a second line on each
precon button and as its tooltip. **Keyed on the deck NAME, not set+name**,
because a New Blood starter is the same clan and the same plan as its
Fifth Edition counterpart at half the size — one line serves both, and two
that drifted apart would be worse than one.

They are written against **what is in each deck**, not clan flavour. A
test enforces that: every line has to name something a Methuselah can
actually do (bleed / vote / fight / block / burn pool), and it **caught my
own first draft** — Path of Death read "Oblivion and the ash heap:
shadows, wraiths, and value from what has already died", which is
atmosphere. Reading the decklist gave the real answer (Govern the
Unaligned, shadow stealth, Telepathic Misdirection, wraith bodies), so it
now says shadowed bleed with wraith allies that block well in turn.

The other test is a standing guard rather than a fixed list: **every
precon in the pool must have a line**, so phase 8's wider pool fails until
the new decks are written up instead of letting the panel drift behind the
sets — the same shape as the How to Play sub-type guard.

## 14. The chat runs to the bottom

*"Extend the Table Chat down to the bottom, pushing aside the bar for
player hand and action bar. Keep the top of the table chat where it's
at."*

**Structural, not styling.** The bottom bar was a sibling of `.main`, so
it ran the full width underneath everything; no amount of CSS would keep
it out from under the side column. The table and the bottom bar are now
one column (`.leftcol`) and the log and chat the other, inside a `.lower`
row. A test asserts the boundary directly — the hand and action bar are
inside `.leftcol`, and "Table chat" is not.

**The chat gets the height, not the log.** The log keeps roughly what it
had (`flex: 0 1 auto; max-height: 42%`) and the chat takes what the taller
column added, which is what "keep the top where it's at" means.

## 15. Moderation

A shield button on the chat panel, **host only** — and not merely hidden
from everyone else: a guest's client has nothing to kick anybody *with*.
The host is already the authority for the game (it validates every intent
against the legal-move generator), so this is a second use of one
mechanism rather than a second mechanism.

Two actions, deliberately different:

- **Kick** removes a player and hands their seat **to a bot**, through the
  same `takeOver` a voluntary departure uses — so a kick and a leave
  cannot drift apart in what they leave behind. A game of VTES cannot skip
  a Methuselah's turn.
- **Chat ban** silences someone who is still playing, and touches the game
  not at all. It is enforced **at the relay**, not on the sender's client:
  a banned player's browser has no reason to cooperate. They are not told,
  and nothing of theirs reaches anybody. Its test pins the unban too, or
  it would pass on a relay that dropped everything.

## 16. Main menu

Centred in the window (`.shell.centred`), buttons in a 320px column, and
the title art at the top — **replacing** the `<h1>` rather than sitting
above it, since it says the same words and two titles would be one too
many. The name survives as the image's alt text.

**The art is not inside the card** (owner, with a screenshot: *"the banner
needs to be this big"* — a box spanning the window). It was capped at
460px because it was a child of the 520px menu card, so the card's width
was deciding the picture's, which is backwards: the buttons want a narrow
column and the art wants the window. The menu is a `.menuwrap` column now
— art across the top at `min(1100px, 96vw)`, card underneath.

1100px is the **source image's own width halved** (2752 × 1184), so the
art is never upscaled and stays sharp on a high-DPI screen; 96vw keeps it
inside a narrow window. The card is unchanged.

**On the file size:** it is 2.2 MB, which was worth flagging when it drew
at 460px — twenty times the pixels it needed. At 1100px it is about 2.5×,
which is roughly what a retina screen wants, so the waste is now ordinary
rather than gross. Re-saving `art/VTES Banner 6 edit.png` at ~2200px wide
as **JPEG** (it is a flat dark image with no transparency) would still cut
it to a few hundred KB with no visible difference, and matters most on
Pages where every visitor downloads it. There is no image tooling on this
machine to do it here.

## 17. The lobby fits the window

`.card.wide.fit` is sized from the **viewport** — `min(1240px, 96vw)` by
`calc(100vh - 48px)` — and scrolls inside itself, rather than being a
fixed column the page scrolls past. The seat grid became
`repeat(auto-fit, minmax(220px, 1fr))` with it, so six seats stay readable
on a wide window and two do not stretch to fill one.

---

# The third pass, same day

Nine items. Two of them were reported for the **second** time, and both
turned out to be the same failure: the feature was there and the screen
said otherwise.

## 18. The Moderation button was nowhere, and the reason was a scope error

It was given only to a host with a live `HostSession` — so on a **private
table it did not exist at all**, which is what the owner was looking at.
That was already too narrow, and moving the AI controls into it made it
plainly wrong: a private game is played entirely against bots, so it is
the table that needs those controls *most*.

The test is now whether this client **runs the engine**
(`transport instanceof LocalTransport`), which is the same thing
`canRewind` already means. Kicking and banning still need a session and
are simply absent without one — `people` is empty on a private table,
because there is nobody connected to remove.

**And the panel had no CSS.** `.modal` and `.modalcard` were never
written, so even where the button did appear the panel rendered as an
unstyled block at the foot of the page. It now reuses the settings
dialog's chrome, and the deck picker (below) reuses it in turn — which is
the argument for having written it as a shared class rather than a
one-off.

## 19. The AI controls moved to Moderation

Owner request, and it draws a line that holds: **Moderation is about who
answers for a seat** — a person, a bot, or a person who is no longer
welcome — while **Settings is about this screen and this player**. Handing
a seat to the computer and kicking somebody to a bot are the same kind of
act, and they now sit together.

It is host-only for the same reason as the rest of that panel: on an
online table a guest must not be able to hand somebody else's seat away.

## 20. What a guest may set

*"Remove the Debug and AI Players settings from the settings menu for the
online players. Also remove all but their own auto-pass option."*

Each cut is something a guest has **no business with**, not merely
something unhelpful:

- **Auto-pass for another seat** would answer for a person who is sitting
  right there. Their own row stays, which is the one the setting exists
  for.
- **The debug reveal** shows every hand at the table. It is the one
  setting that must never be reachable from a seat in a live game against
  other people.
- **The AI seats** are the host's, as above.

`canModerate` is the flag, because "is the authority" is exactly the
question all three ask. **Restart needed no work** — the whole
undo/save/load/restart group hangs on `canRewind`, which is
`history !== null`, and a `PeerTransport` reports `null` by design: a peer
cannot unilaterally rewind a shared game (`docs/multiplayer-design.md`).
That property was written into the transport seam on 2026-08-29 and paid
out here without a line of code.

## 21. The deck picker is a pop-up

It carries your saved decks, 18 precons across seven sets and a paste box
— several times a seat box tall. Unfolded inside one box it stretched that
column of the grid and left the others short beside it, which is the "long
and weird" in the report. As a modal it is the size it wants to be and the
grid never moves. Same chrome as the in-game settings dialog, and clicking
the scrim closes it.

The seat box keeps only the **button**, which is what a seat box is for:
who is here, what kind of player, which deck.

## 22. The lobby, the seat boxes and the chat column

The card is `min(1900px, 98vw)` now, and a seat box has a **300px**
minimum rather than 220 — enough for a face, a name, a kind and a deck
without reading as a narrow strip.

The chat moved **into its own column on the right** (`.lobbycols`). It had
been a full-width band between the seats and the Start button, which puts
a scrolling list in the middle of a form; beside them it can be as tall as
the card without pushing anything down. Under 900px it goes back to
stacking.

## 23. The log and chat split is fixed, not elastic

*"The chat box starts too tall now. Make the top of it fixed at about a
third of the screen height. And the Game Log should be fixed at the rest
of that space."*

The log was `flex: 0 1 auto; max-height: 42%`, so it was sized by **how
much had happened** — the boundary crept down as the game went on, and on
an empty log the chat opened almost full height, which is what the owner
saw. `flex: 0 0 33%` sizes it from the column instead: the log takes the
top third and the chat the rest, whatever either contains.

## 24. Prey and predator, and sorting off-turn — both already built, both
reported again

Both were in the second pass. Both were reported again, and in each case
the feature worked and **the screen said otherwise**.

- **Prey and predator** were on the lobby's seat boxes and nowhere at the
  table, which is where a player actually needs them — they are
  orientation during a game, not information when picking seats. They are
  on the **seat mats** now, read through `preyOf`/`predatorOf` rather than
  off the seat array, so an **oust moves them** (p. 15: "when your prey is
  ousted, the next Methuselah to your left becomes your new prey"). A test
  ousts the middle seat and watches the first Methuselah's prey become the
  third.
- **Off-turn sorting** worked and the label read **"— not your
  decision"**, which reads as *hands off*. It says "drag to sort" now,
  whether or not it is your decision, and the test asserts the label
  beside `draggable="true"` so the two cannot drift apart.

That is twice in two passes that a working feature was reported missing
because of one word on screen. **The auto-pass finding generalises: a
feature that cannot be discovered is indistinguishable from one that is
absent**, and the discoverability half is not a polish task to be done
after.

## 25. A trap worth recording: an HTML comment is part of the output

`render()` returns a string, so the explanatory comments inside those
template literals **ship in the markup**. A comment I added to the hand
strip contained the phrase "whoever is deciding", and
`expect(playing).not.toContain("is deciding")` — a real assertion about the
AI pause, testing that no seat is announced as thinking — failed on the
prose rather than on the screen.

Reworded rather than loosening the assertion: the test is right, and a
substring check over rendered HTML is the correct shape for "this must not
appear anywhere". Worth knowing before it happens again.

---

# The fourth pass, same day

Four items, all about the two menus.

## 26. The precon buttons are a grid

`.preconset` was a wrapped flex row, so button widths tracked deck-name
lengths and a set read as a ragged paragraph. It is
`repeat(auto-fill, minmax(200px, 1fr))` now: every deck is the same width,
and the play-style line underneath has a predictable column to wrap in.
The set name spans the row rather than taking a cell.

## 27. The seat grid stays a grid

`auto-fit` let six seats straighten into a single row once the lobby got
wide, which is exactly the shape the grid exists to avoid — it is meant to
look like the game table (3 across, six seats as 3×2), and a row of six
looks like nothing at the table. Fixed at three columns: the boxes get
wider on a wide window, the layout does not change.

## 28. Moderation is a top-bar button

It was a shield glyph on the chat panel's header, which is not somewhere
anybody looks for a menu — the same discoverability failure as the
auto-pass toggle and the off-turn hand label, now three times over. It is
`🛡 Moderation` beside **How to Play** and **Settings**, which is what it
is: a menu about the table, reached the way the other two are. Absent for
a guest rather than present and refusing.

It no longer depends on the chat panel existing, which was an accidental
coupling: a table with chat off would have had no way to reach it.

## 29. One row per seat, not one per connection

The panel listed `moderation.people` — the connected peers — so **the host
and every bot were missing from a panel whose whole subject is who answers
for each seat**. Rows now come from `state.seats` (every Methuselah in the
game) and the network view only *adds* what it knows: whether a person is
playing that seat, and whether they are banned.

Each row is name, kind, an **AI checkbox**, then Kick and Ban. The AI box
is **disabled** for your own seat and for a seat somebody is playing —
a bot cannot be handed to a bot, and a seat with a person in it is handed
over by kicking them, which does exactly that. Disabled rather than
absent, so the row keeps its shape and still says what is true of that
seat.

Its test has the control case that matters: a **bot's** box is asserted
*not* disabled. Without it, the two positive assertions would pass on a
panel that disabled everything.
