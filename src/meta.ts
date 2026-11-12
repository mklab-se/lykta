/** Tool identity, read from package.json so there is a single source of truth. */
import pkg from "../package.json" with { type: "json" };

/** The command name users type (the key of `bin` in package.json). */
export const TOOL = "lykta";

/** The npm package name (scoped, e.g. `@mklab-se/lykta`). */
export const PACKAGE_NAME: string = pkg.name;

export const VERSION: string = pkg.version;

export const DESCRIPTION: string = pkg.description;

/** Set to any value to skip the background update check. */
export const NO_UPDATE_CHECK_ENV = "LYKTA_NO_UPDATE_CHECK";
