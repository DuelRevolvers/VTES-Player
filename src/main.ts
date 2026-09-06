/**
 * App entry point (docs/shell-design.md).
 *
 * Boots the SHELL — profile, menu, new game — which then hands a dealt
 * game to the table (docs/debug-ui-design.md). Until 2026-09-04 this
 * file started one hand-authored mid-game snapshot and nothing else.
 */

import { Shell } from "./ui/shell.ts";
import "./ui/style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (app) new Shell(app);
