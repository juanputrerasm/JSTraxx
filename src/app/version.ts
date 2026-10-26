/* The vendored OpenPhotex version, from the first line of src/vendor/openphotex/VERSION. */
import stamp from "../vendor/openphotex/VERSION?raw";

export const OPENPHOTEX_VERSION = (stamp.split("\n")[0] ?? "").replace(/^openphotex\s+/i, "").trim() || "unknown";
