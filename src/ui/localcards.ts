/**
 * THE CARD DATABASE SWITCH (owner request 2026-09-25): card scans from a
 * folder on this computer instead of static.krcg.org.
 *
 * Only the IMAGES move. A card's text and rules are compiled into the
 * engine with its implementation, so they cannot come from a folder at
 * runtime — the registry is the one model of the pool (CLAUDE.md).
 *
 * A scan is matched by FILE NAME, the way KRCG names them: the URL
 * `https://static.krcg.org/card/44magnum.jpg` is served by any image in
 * the folder (or a subfolder) whose name, less its extension, is
 * `44magnum` — so a mirrored KRCG folder works as it is, and a scan saved
 * as .png or .webp works too. A card the folder does not have falls back
 * to KRCG rather than to a blank.
 *
 * REMEMBERED where the browser can: Chrome and Edge hand out a folder
 * HANDLE that is kept in IndexedDB and reopened next visit (after the
 * browser asks for permission again, which needs a click — hence
 * "Reconnect"). Elsewhere the folder is read for this visit only.
 * Nothing here ever uploads anything: the files become `blob:` URLs that
 * exist only in this tab.
 */

/** Image stem (lowercase, no extension) → the URL to draw it from. */
let local: Map<string, string> | null = null;
let folderName = "";
/** A remembered folder the browser wants a click before reopening. */
let pending: DirHandle | null = null;

const IMAGE = /\.(jpe?g|png|webp|gif)$/i;

/** The stem a KRCG URL or a file name is matched on. */
function stemOf(pathOrUrl: string): string {
  const base = pathOrUrl.split(/[\\/]/).pop() ?? "";
  return base.replace(/\.[^.]+$/, "").toLowerCase();
}

/**
 * The URL to draw a card scan from: the local folder's copy when one is
 * chosen and has it, the original (KRCG) URL otherwise. Every place a scan
 * is drawn goes through here, so the switch cannot miss a screen.
 */
export function scanUrl(url: string): string {
  if (!local || !url) return url;
  return local.get(stemOf(url)) ?? url;
}

/** Use these files as the card database. Pure apart from the state it
 *  sets, so the matching is testable without a browser. */
export function setLocalScans(name: string, files: Array<{ name: string; url: string }>): number {
  clearLocal();
  const map = new Map<string, string>();
  for (const f of files) if (IMAGE.test(f.name)) map.set(stemOf(f.name), f.url);
  local = map;
  folderName = name;
  return map.size;
}

function clearLocal(): void {
  if (local && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const url of local.values()) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
  local = null;
  folderName = "";
}

/** What the settings panel shows. */
export function cardDatabase():
  | { kind: "krcg" }
  | { kind: "local"; folder: string; images: number }
  | { kind: "reconnect"; folder: string } {
  if (local) return { kind: "local", folder: folderName, images: local.size };
  if (pending) return { kind: "reconnect", folder: pending.name };
  return { kind: "krcg" };
}

// ---------------------------------------------------------------------------
// The browser side: picking, remembering and reopening a folder.

/** The slice of the File System Access API this uses — not in every
 *  browser, and not in every TypeScript DOM lib, so it is typed here. */
interface DirHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirHandle | { kind: "file"; name: string; getFile(): Promise<File> }>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
}

type Picker = () => Promise<DirHandle>;
const picker = (): Picker | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;

async function readHandle(dir: DirHandle): Promise<number> {
  const files: Array<{ name: string; url: string }> = [];
  const walk = async (d: DirHandle): Promise<void> => {
    for await (const entry of d.values()) {
      if (entry.kind === "directory") await walk(entry);
      else if (IMAGE.test(entry.name)) {
        files.push({ name: entry.name, url: URL.createObjectURL(await entry.getFile()) });
      }
    }
  };
  await walk(dir);
  return setLocalScans(dir.name, files);
}

/**
 * Ask for a folder and switch to it. Resolves to the number of images
 * found, or null when the person cancelled. Must run from a click.
 */
export async function pickCardFolder(): Promise<number | null> {
  const pick = picker();
  if (pick) {
    let dir: DirHandle;
    try {
      dir = await pick();
    } catch {
      return null; // cancelled
    }
    const n = await readHandle(dir);
    pending = null;
    await remember(dir);
    return n;
  }
  // No folder handles here (Firefox): a directory <input>, this visit only.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.addEventListener("change", () => {
      const list = Array.from(input.files ?? []);
      if (list.length === 0) return resolve(null);
      const root = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0];
      resolve(
        setLocalScans(
          root || "chosen folder",
          list.filter((f) => IMAGE.test(f.name)).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
        ),
      );
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Go back to static.krcg.org, and forget the folder. */
export async function useKrcg(): Promise<void> {
  clearLocal();
  pending = null;
  await remember(null);
}

/**
 * Reopen the remembered folder at start-up. Silent when the browser still
 * grants access; otherwise it is held as "reconnect" for the panel to
 * offer, since asking needs a click.
 */
export async function restoreCardFolder(): Promise<void> {
  const dir = await recall();
  if (!dir) return;
  const state = (await dir.queryPermission?.({ mode: "read" })) ?? "prompt";
  if (state === "granted") await readHandle(dir);
  else pending = dir;
}

/** The click that lets the browser reopen a remembered folder. */
export async function reconnectCardFolder(): Promise<number | null> {
  const dir = pending;
  if (!dir) return null;
  const state = (await dir.requestPermission?.({ mode: "read" })) ?? "denied";
  if (state !== "granted") return null;
  pending = null;
  return readHandle(dir);
}

// IndexedDB, because a folder handle cannot go in localStorage. Every
// failure is swallowed: remembering is a convenience, never a requirement.
const DB = "vtes-card-database";

function store(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("folder");
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const req = act(open.result.transaction("folder", mode).objectStore("folder"));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

async function remember(dir: DirHandle | null): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await store("readwrite", (s): IDBRequest => (dir ? s.put(dir, "dir") : s.delete("dir")));
}

async function recall(): Promise<DirHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  return ((await store("readonly", (s) => s.get("dir"))) as DirHandle | undefined) ?? null;
}
