# Phase 9 — publishing to GitHub Pages (2026-09-07)

The V5 pool is complete, the client plays a whole game against bots or over
a room code, and none of that is reachable by anybody who has not cloned
the repo. This is the pass that makes the build publishable.

**Nothing here publishes anything.** The workflow that deploys is on
`push: [main]`, so pressing the button is the owner's act, not this pass's.

---

## 1. What was already right

More than the phase list implies. `vite.config.ts` already carried
`base: "./"` and `.github/workflows/pages.yml` already built `dist/` and
handed it to `actions/deploy-pages`. So the questions worth asking were
not "does a deploy exist" but "would the deployed thing WORK, and is it
fit to be seen".

Three things were verified rather than assumed:

- **No asset is referenced from the site root.** Pages serves from
  `/<repo>/`, so a `/assets/...` reference 404s. The built bundle uses
  `./assets/...` throughout, and a grep over the built CSS and JS finds no
  root-absolute reference.
- **The dev-only log sink is genuinely absent.** `apply: "serve"` keeps
  the middleware out of `vite build`; on the published site the client
  keeps its play log in memory and offers it for download
  (docs/game-log-design.md).
- **No SPA rewrite is needed.** This is the risk that usually bites a
  static deploy: a client-side route like `/join/ABC123` would 404,
  because there is no server to rewrite it. It does not arise here —
  **a join link is `#join=CODE`, a FRAGMENT**, which never reaches the
  server at all. That was chosen so a room code stays out of the access
  log (docs/lobby-design.md); it also happens to be exactly what static
  hosting wants.

## 2. What a visitor was going to get, and now does

**A favicon.** There was none, so every visitor's browser would request
`/favicon.ico`, take a 404, and show a blank page icon. It is an **inline
SVG data URI**, which fetches nothing, cannot 404, and — the reason it is
not a file — needs no path, so it works unchanged from a subdirectory.

**A title and description that say what the page is.** "VTES Player" alone
tells a search result nothing.

**The Dark Pack notice, on the first screen.** The full attribution has
always been correct and complete — but it lived only inside the How to
Play modal, which a visitor has to go looking for. On the owner's own
machine that was fine. Published, a short line now sits under the menu
buttons naming the Dark Pack, Paradox, worldofdarkness.com and KRCG, with
the full text still in the panel. This is a binding obligation for the
project, not a nicety.

`tests/ui/pages-ready.test.ts` pins all of it, at the SOURCE level on
purpose: a test that inspected `dist/` would only run after a build and
would pass vacuously when there was none.

## 3. THE ONE REAL PROBLEM: 68% of the payload is one image

Measured on a clean build:

| asset | size |
| --- | --- |
| `banner.png` | **2160 KB** |
| `index.js` | 1077 KB |
| `index.css` | 27 KB |
| **first paint** | **3.19 MB** |
| `index.js.map` | 3184 KB — *not counted; browsers fetch a source map only when devtools is open, so it costs a visitor nothing* |

The JavaScript is large because the card registry is in it — 661 cards
with their text and specs — and that is inherent to a client with no
server. **The banner is not inherent.** It is 2752x1184 and displays at
`min(1100px, 96vw)`, so even a 2x-DPI screen wants about 2200px.

### The recommendation, corrected

An earlier note in `CLAUDE.md` said to re-save it as a JPEG because the
image is "flat, dark, no transparency". **That was wrong, and it was
checked rather than repeated**: decoding the PNG (zlib only — there is no
image library on this machine, and `convert` on Windows is the FAT-to-NTFS
volume converter, not ImageMagick) gives

```
2752x1184, 3,258,368 pixels
  fully opaque      91.495%
  fully transparent  0.002%
  partial            8.502%
```

**The alpha channel IS used** — 8.5% of pixels are partially transparent,
which is the soft edge of the artwork. A plain JPEG would flatten those
against whatever it was composited on.

So the fix is **WebP at about 2200px wide**, which keeps the alpha and
should land near 150–300 KB: first paint would drop from 3.19 MB to
roughly 1.3 MB. Any browser that can run this client supports WebP. A
downscaled PNG at 2200px is the fallback if WebP is unwanted — that alone
removes about a third of the pixels.

**This needs an image editor and is left to the owner**, deliberately:
re-encoding artwork is not something to do blind, and there is no tooling
here to do it well.

## 4. Still open, and knowingly

- **The PeerJS broker is a third party.** Multiplayer needs
  `0.peerjs.com` to introduce two browsers; it stores nothing and no game
  traffic reaches it, but it can be down, and self-hosting is a few lines
  of `PeerOptions` (docs/lobby-design.md).
- **No public room list.** It needs a directory server, which the
  local-only decision rules out. Room codes and join links cover playing
  with friends completely.
- **The repo must have Pages enabled** with source "GitHub Actions", which
  is a setting in the repository rather than anything in the tree.
