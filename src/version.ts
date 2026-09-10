/**
 * The platform version, shown at the foot of the main menu.
 *
 * ONE PLACE. `package.json` carries the same string and a test pins that
 * the two agree — two numbers that must be kept in step by hand are two
 * numbers that will one day disagree, and the one on screen is the one a
 * player would quote in a bug report.
 *
 * BUMP THE PATCH DIGIT (+0.0.1) WITH EVERY CHANGE. This is a standing
 * rule from the owner (2026-09-07) and it is recorded in CLAUDE.md; it is
 * not semver in the library sense, it is a build counter people can point
 * at. A wave of card work, a bug fix and a UI tweak each earn one.
 */
export const PLATFORM_VERSION = "0.9.8";

/** As it is written on screen: "platform v0.8.0". */
export const PLATFORM_VERSION_LABEL = `platform v${PLATFORM_VERSION}`;
