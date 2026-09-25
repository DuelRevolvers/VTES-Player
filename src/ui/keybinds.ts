/**
 * Keyboard shortcuts for the table (owner request, 2026-09-25).
 *
 * A KEY PRESSES A BUTTON THAT IS ALREADY ON SCREEN — it never submits an
 * option id of its own. That is the whole safety argument: a shortcut can
 * do nothing a click could not, the `isThinking` guard and every other
 * check behind a button's click handler apply to it unchanged, and a key
 * whose button is absent (Undo on a peer, Moderation for a guest) does
 * nothing at all.
 *
 * A preference like the rest of `settings.ts`: it never reaches the
 * command log, and two players with different bindings play the same
 * game.
 */

export const KEY_ACTIONS = [
  "primary",
  "option1",
  "option2",
  "option3",
  "option4",
  "option5",
  "option6",
  "option7",
  "option8",
  "option9",
  "undo",
  "undoAction",
  "save",
  "load",
  "moderation",
  "settings",
  "help",
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

export const KEY_LABELS: Record<KeyAction, string> = {
  primary: "Pass / Hand strike / the only option",
  option1: "Option 1",
  option2: "Option 2",
  option3: "Option 3",
  option4: "Option 4",
  option5: "Option 5",
  option6: "Option 6",
  option7: "Option 7",
  option8: "Option 8",
  option9: "Option 9",
  undo: "Undo",
  undoAction: "Undo action",
  save: "Save",
  load: "Load",
  moderation: "Moderation",
  settings: "Settings",
  help: "How to Play",
};

export const DEFAULT_KEYBINDS: Record<KeyAction, string> = {
  primary: "Space",
  option1: "1",
  option2: "2",
  option3: "3",
  option4: "4",
  option5: "5",
  option6: "6",
  option7: "7",
  option8: "8",
  option9: "9",
  undo: "Z",
  undoAction: "X",
  save: "S",
  load: "L",
  moderation: "M",
  settings: "O",
  help: "H",
};

/** The button each non-option action presses. */
export const KEY_BUTTONS: Partial<Record<KeyAction, string>> = {
  undo: "#undo",
  undoAction: "#undo-action",
  save: "#save",
  load: "#load",
  moderation: "#mod-btn",
  settings: "#settings-btn",
  help: "#help-btn",
};

/**
 * A key press as it is stored and shown: "Space", "Z", "Ctrl+S", "F2".
 * Shift is NOT a prefix — it is already in `key` ("?" rather than
 * "Shift+/"), and naming it twice would make "?" impossible to bind.
 * Null for a bare modifier, which is the start of a chord, not a key.
 */
export function keyName(ev: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}): string | null {
  const k = ev.key;
  if (k === "Control" || k === "Alt" || k === "Shift" || k === "Meta") return null;
  const base = k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k;
  return `${ev.ctrlKey ? "Ctrl+" : ""}${ev.altKey ? "Alt+" : ""}${ev.metaKey ? "Meta+" : ""}${base}`;
}

/**
 * The stored bindings, made safe: every action present, every value a
 * string. A stored blob is untrusted input, and an action added after it
 * was saved gets its default. "" means deliberately unbound.
 */
export function cleanKeybinds(value: unknown): Record<KeyAction, string> {
  const out = { ...DEFAULT_KEYBINDS };
  if (!value || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;
  for (const a of KEY_ACTIONS) {
    if (typeof v[a] === "string") out[a] = (v[a] as string).slice(0, 32);
  }
  return out;
}

export function actionForKey(binds: Record<KeyAction, string>, name: string): KeyAction | null {
  return KEY_ACTIONS.find((a) => binds[a] !== "" && binds[a] === name) ?? null;
}

/**
 * Bind `action` to `name`. A key does one thing, so whatever else held it
 * is unbound rather than left to lose silently to list order.
 */
export function rebind(
  binds: Record<KeyAction, string>,
  action: KeyAction,
  name: string,
): Record<KeyAction, string> {
  const out = { ...binds };
  for (const a of KEY_ACTIONS) if (out[a] === name) out[a] = "";
  out[action] = name;
  return out;
}

/**
 * Which option Space answers, by id, or null for none.
 *
 * The only option; otherwise Pass; otherwise the bare hand strike. Where
 * there are several real choices and none of those, Space does nothing —
 * a default that picked one of several would be answering for the player.
 */
export function primaryOption(ids: readonly string[]): string | null {
  if (ids.length === 1) return ids[0]!;
  if (ids.includes("pass")) return "pass";
  return ids.find((id) => id === "strike:hand" || id.startsWith("strike:hand:")) ?? null;
}

/**
 * THE ONE CONTROLS PANEL — drawn by the main menu's Settings screen and by
 * the table's Settings dialog, so the two cannot list different keys.
 * `capturing` is the action waiting for its new key.
 */
export function controlsPanel(
  binds: Record<KeyAction, string>,
  capturing: KeyAction | null,
): string {
  const row = (a: KeyAction): string => `
    <label class="setrow keyrow">
      <span>${KEY_LABELS[a]}</span>
      <button class="keybind${capturing === a ? " capturing" : ""}" data-key="${a}">${
        capturing === a ? "Press a key…" : binds[a] === "" ? "—" : escKey(binds[a])
      }</button>
    </label>`;
  return `
    <div class="keybinds">
      <p class="setnote">
        Click a key to change it, then press the new one. <b>Esc</b> cancels;
        <b>Backspace</b> leaves the action unbound. Shortcuts are ignored
        while you are typing in a box.
      </p>
      <p class="setnote">
        <b>${escKey(binds.primary || "—")}</b> answers the only option on the
        action bar, or Pass, or a hand strike. When there are several
        choices — a vote, say — each option shows its number.
      </p>
      ${KEY_ACTIONS.map(row).join("")}
      <div class="row">
        <button id="keybinds-reset">Reset to defaults</button>
      </div>
    </div>`;
}

const escKey = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Wire the panel `controlsPanel` drew. `setCapturing` holds the
 * waiting action in the caller's view state and repaints; `store` reads
 * and writes the bindings (passed in rather than imported, because
 * settings.ts reads its defaults from HERE).
 */
export function wireControls(
  root: HTMLElement,
  setCapturing: (a: KeyAction | null) => void,
  store: {
    get(): Record<KeyAction, string>;
    set(binds: Record<KeyAction, string>): void;
  },
): void {
  for (const btn of Array.from(root.querySelectorAll<HTMLButtonElement>("button.keybind"))) {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const action = btn.dataset["key"] as KeyAction;
      setCapturing(action);
      // Capture phase on the WINDOW, so the table's own shortcut listener
      // never sees the key being bound.
      const grab = (k: KeyboardEvent): void => {
        const name = keyName(k);
        if (name === null) return;
        k.preventDefault();
        k.stopImmediatePropagation();
        window.removeEventListener("keydown", grab, true);
        if (name === "Backspace" || name === "Delete") {
          store.set({ ...store.get(), [action]: "" });
        } else if (name !== "Escape") {
          store.set(rebind(store.get(), action, name));
        }
        setCapturing(null);
      };
      window.addEventListener("keydown", grab, true);
    });
  }
  root.querySelector<HTMLButtonElement>("#keybinds-reset")?.addEventListener("click", () => {
    store.set({ ...DEFAULT_KEYBINDS });
    setCapturing(null);
  });
}

/** Is the keyboard busy with something else — a text box, a dropdown? */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
