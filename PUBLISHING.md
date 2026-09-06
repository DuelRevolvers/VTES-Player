# Putting the game online (GitHub Pages)

This puts a playable copy of the client on the web, free, at:

**https://duelrevolvers.github.io/VTES-Player/**

Anyone with that address can open it in a browser and play — against bots
on their own, or with you over a room code.

**Already done for you:** the build is already set up correctly for Pages
(nothing in the project needs changing), and the automation file
`.github/workflows/pages.yml` is written and waiting. You do steps 1–4 once,
and after that the site updates itself every time you upload changes.

Commands go in the same black window as before — see "Opening the terminal"
at the bottom of `UPLOADING.md` if you need it.

---

## Step 1 — Make the repository Public

Free Pages hosting only works on a **public** repository. (Private repos can
do it, but only on a paid GitHub plan.)

1. Go to <https://github.com/DuelRevolvers/VTES-Player/settings>.
2. Scroll to the very bottom, to the red **Danger Zone** box.
3. If it says **"Change visibility"** with *This repository is currently
   private*, click it, choose **Make public**, and confirm.
4. If it already says *This repository is currently public* — nothing to do,
   go to step 2.

*Nothing private is in there.* Your saved games, your play logs, and the
Cockatrice reference folder are all excluded from the repository — that was
checked in step 4 of `UPLOADING.md`.

---

## Step 2 — Turn Pages on

1. Go to <https://github.com/DuelRevolvers/VTES-Player/settings/pages>.
2. Under **Build and deployment**, find the dropdown labelled **Source**.
3. Change it from *Deploy from a branch* to **GitHub Actions**.

That's it — there's no Save button, it takes effect immediately. Ignore
everything else on the page.

---

## Step 3 — Send up the automation file

In the project folder:

```
git add -A
git commit -m "Publish to GitHub Pages"
git push
```

The push is what starts the first build.

---

## Step 4 — Watch it build, then open it

1. Go to <https://github.com/DuelRevolvers/VTES-Player/actions>.
2. You'll see a run called **Deploy to GitHub Pages** with a spinning
   yellow dot. It takes about a minute.
3. When the dot turns into a **green tick**, the site is live.
4. Open **https://duelrevolvers.github.io/VTES-Player/**

If you get a 404 the very first time, wait a minute and refresh — GitHub is
sometimes slow to hook the address up on the first publish.

---

## From now on: updating the site

There is nothing extra to do. Saving your work also republishes the site:
double-click **`Update GitHub.bat`** in the project folder (or run
`git add -A`, `git commit -m "a note"`, `git push` by hand).

About a minute later the live site is running the new version. If you want
to check, the Actions tab shows the run.

To republish without changing anything (rarely needed): Actions tab → **Deploy
to GitHub Pages** on the left → **Run workflow** button on the right.

---

## Playing with other people

Once the site is up, playing with friends works like this:

1. You open the site and go **Host**, setting one or more seats to
   **Open (online)**.
2. You get a **room code** and a **Copy link** button.
3. Send the link (or just the six-character code) to your friends.
4. They open it, pick a deck, and you press **Start**.

Two things worth knowing:

- **The link has to reach them some other way** — a message, an email,
  Discord. The site has no list of open games, because that would need a
  server to keep the list on, and this project deliberately has none.
- **Game traffic goes browser-to-browser**, not through GitHub. The only
  outside help is a free public service (`0.peerjs.com`) that introduces
  the two browsers to each other and then steps out. It doesn't see or
  store any of the game. It is, however, someone else's free service — if
  it's ever down, hosting won't work until it's back.

Pages serves over `https://`, which browsers require for this to work at
all — so the published site is actually a *better* place to host from than
running it on your own machine.

---

## What's different on the published site

Compared to double-clicking `Play VTES.bat` at home:

| | `Play VTES.bat` | The published site |
|---|---|---|
| Play against bots | yes | yes |
| Host / join online games | yes | yes |
| Writes a log file into `logs/` | yes | **no** — there's no server to write it. The log is kept in the browser and can be downloaded instead |
| Needs your PC left on | yes | no |

Your profile, saved decks and leaderboard are stored **in the browser**, so
the copy on the website and the copy at home each keep their own. Playing on
the website from a different computer starts you with a fresh profile.

---

## If something goes wrong

**The Actions run has a red X** — click the run, then the failed step, and
send me the last few lines of red text. Nothing is broken on the live site;
it just carries on serving the previous version.

**"Get Pages site failed" or "Resource not accessible"** — step 2 didn't
take. Go back to the Pages settings and make sure **Source** says *GitHub
Actions*, then re-run the workflow from the Actions tab.

**The page loads but is blank/white** — press **F12**, click the *Console*
tab, and send me any red lines.

**There's no Pages option in Settings** — the repository is still private
and on a free plan. Do step 1.

**The card pictures don't load** — those come from `static.krcg.org`, the
official card image source, live over the internet each time. If they're
down, the game falls back to readable text tiles and still plays.

---

## The small print you already agreed to

This is a **Dark Pack** fan project. Publishing it publicly is fine under
that agreement, so long as it stays non-commercial — **no ads, no
donations, no payments of any kind on the site, ever**. The attribution to
Paradox Interactive and to KRCG is already in the client, under
**❔ How to Play**. Leave it there.
