# Putting this project on GitHub

**Already done for you:** the project folder is a git repository, and the
exclusion list (`.gitignore`) is set up and verified. Start at step 1.

Follow these in order. Every command goes in the **same black window** you
already use — see "Opening the terminal" at the bottom if you're not sure
how to get one.

**Copy and paste the commands exactly.** They are safe: nothing here
deletes anything or changes the game.

---

## Before you start: the one thing that must not be uploaded

The folder `Cockatrice-2026-08-25-Development-3.1.0-beta.9/` is somebody
else's source code, under a licence (GPL-2.0) that would force this whole
project to become GPL if it were published alongside it. It is **reference
material only**.

It is already excluded, and so are your saved games, your play logs, and
the 7 MB raw card data. **Step 4 below checks this for you and refuses to
go on if anything is wrong** — do not skip it.

---

## Step 1 — Make a GitHub account (skip if you have one)

1. Go to <https://github.com/signup>.
2. Sign up. Remember your **username** — you need it in step 6.

---

## Step 2 — Tell git who you are

This is a one-off for this computer. It stamps your name on your changes.

Replace the name and email with yours (the email should be the one on your
GitHub account):

```
git config --global user.name "DuelRevolvers"
git config --global user.email "duelrevolvers@gmail.com"
```

---

## Step 3 — Get into the project folder

```
cd "b:/Users/Aaron/Documents/ChatGPT Ideas/VTES Player/vtes-platform"
```

*(The quotes matter — the path has spaces in it.)*

---

## Step 4 — Check what will be uploaded

**Do not skip this.** Paste it as one block:

```
git add -A
git status --short | grep -cE "^.. (Cockatrice-|node_modules/|logs/|saves/|\.claude/|data/vtes-raw)"
```

**You will see a few hundred lines of `warning: ... LF will be replaced by
CRLF`.** That is normal and harmless — it is git noting that Windows and
the rest of the world end lines differently. Ignore them entirely.

The last line prints a **number**.

- **`0`** — perfect, carry on to step 5.
- **anything else** — stop and tell me. Something that should be excluded
  isn't, and it should not be published.

To see the total you're about to upload (should be around **329 files**,
about 6 MB):

```
git status --short | wc -l
```

---

## Step 5 — Save your first version

```
git commit -m "VTES platform: engine, AI, multiplayer and client"
```

You'll see a summary like `328 files changed`. That's your first
**commit** — a saved snapshot. Nothing has left your computer yet.

---

## Step 6 — Create the empty repository on GitHub

1. Go to <https://github.com/new>.
2. **Repository name:** `vtes-platform`
3. **Description** (optional): `Vampire: The Eternal Struggle with AI players — a Dark Pack fan project`
4. Choose **Public** or **Private**.
   - *Private* = only you can see it. Fine for now; you can flip it later.
   - *Public* is required if you later want free GitHub Pages hosting.
5. **Leave every checkbox unticked.** Do **not** add a README, .gitignore
   or licence — you already have them, and adding them here causes a
   confusing clash on the first upload.
6. Click **Create repository**.

You'll land on a page of setup instructions. Ignore it; use step 7.

---

## Step 7 — Connect and upload

Replace `YOUR-USERNAME` with your GitHub username in the first line, then
paste all three:

```
git remote add origin https://github.com/YOUR-USERNAME/vtes-platform.git
git branch -M main
git push -u origin main
```

A browser window or a box will pop up asking you to **sign in to GitHub**.
Do that, and allow it. (It remembers you afterwards — you only sign in
once.)

When it finishes, refresh your repository page. Your code is there.

---

## From now on: saving your changes

Any time you've changed something and want it saved to GitHub, it's three
commands in the project folder:

```
git add -A
git commit -m "a short note about what changed"
git push
```

That's the whole routine. `git add -A` gathers the changes, `git commit`
saves them with a note, `git push` sends them to GitHub.

If you want to see what changed before committing:

```
git status
```

---

## If something goes wrong

**"remote origin already exists"** — you ran step 7 twice. Fix it with:

```
git remote set-url origin https://github.com/YOUR-USERNAME/vtes-platform.git
```

**"Updates were rejected"** — GitHub has something your computer doesn't
(usually because a checkbox got ticked in step 6). Easiest fix: delete the
repository on GitHub (Settings → scroll to the bottom → Delete this
repository) and redo step 6 with everything unticked.

**"failed to push some refs"** or a sign-in loop — tell me what the message
says and I'll sort it out. Don't force anything.

**You committed something you shouldn't have** — stop and tell me before
pushing. It is much easier to fix before it leaves your computer.

---

## Opening the terminal

- Press the **Windows key**, type `git bash`, press Enter — that's the one
  these commands are written for.
- Or: open the project folder in File Explorer, right-click on empty space
  → **Open Git Bash here** (then you can skip step 3).

To paste into that window, use **right-click → Paste** or
**Shift + Insert**. Ctrl+V often doesn't work in terminals.

---

## Putting the game online for people to play

That's **`PUBLISHING.md`** — GitHub Pages, free, about four steps and then
it keeps itself up to date. The build needs no changes; it was already set
up for it.
