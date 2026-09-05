/**
 * Timezone search helpers.
 *
 * A raw substring match over IANA ids is a poor experience: typing "india"
 * returns `America/Indiana/*` and `Indian/Maldives` but not `Asia/Kolkata`,
 * which is the one the user actually wants. Aliases close that gap.
 */

/** Zones offered before the user types anything. */
export const COMMON_TIMEZONES = [
  "Asia/Kolkata",
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

/** Country, city and abbreviation terms mapped to their canonical zone id. */
const ALIASES: Record<string, readonly string[]> = {
  "Asia/Kolkata": ["india", "indian standard time", "ist", "bharat", "delhi", "mumbai", "bangalore", "bengaluru", "chennai", "hyderabad", "pune", "calcutta"],
  "Asia/Karachi": ["pakistan", "pkt", "lahore", "islamabad"],
  "Asia/Dhaka": ["bangladesh", "dacca"],
  "Asia/Kathmandu": ["nepal"],
  "Asia/Colombo": ["sri lanka"],
  "Asia/Dubai": ["uae", "emirates", "gulf", "abu dhabi"],
  "Asia/Riyadh": ["saudi", "saudi arabia"],
  "Asia/Singapore": ["singapore", "sgt"],
  "Asia/Tokyo": ["japan", "jst"],
  "Asia/Seoul": ["korea", "south korea", "kst"],
  "Asia/Shanghai": ["china", "beijing", "cst china"],
  "Asia/Hong_Kong": ["hong kong", "hkt"],
  "Asia/Jakarta": ["indonesia"],
  "Asia/Manila": ["philippines"],
  "Asia/Bangkok": ["thailand"],
  "Asia/Ho_Chi_Minh": ["vietnam", "saigon"],
  "Europe/London": ["uk", "united kingdom", "britain", "england", "gmt", "bst"],
  "Europe/Dublin": ["ireland"],
  "Europe/Berlin": ["germany", "cet"],
  "Europe/Paris": ["france"],
  "Europe/Madrid": ["spain"],
  "Europe/Rome": ["italy"],
  "Europe/Amsterdam": ["netherlands", "holland"],
  "Europe/Lisbon": ["portugal"],
  "Europe/Warsaw": ["poland"],
  "Europe/Moscow": ["russia", "msk"],
  "Europe/Istanbul": ["turkey", "turkiye"],
  "Europe/Kyiv": ["ukraine", "kiev"],
  "Europe/Zurich": ["switzerland"],
  "Europe/Stockholm": ["sweden"],
  "America/New_York": ["usa east", "us east", "eastern", "est", "edt", "nyc", "new york"],
  "America/Chicago": ["central", "cst", "cdt", "texas"],
  "America/Denver": ["mountain", "mst", "mdt", "colorado"],
  "America/Los_Angeles": ["usa west", "us west", "pacific", "pst", "pdt", "california", "sf", "seattle"],
  "America/Toronto": ["canada", "ontario"],
  "America/Vancouver": ["canada west", "british columbia"],
  "America/Mexico_City": ["mexico"],
  "America/Sao_Paulo": ["brazil", "brasil"],
  "America/Argentina/Buenos_Aires": ["argentina"],
  "America/Bogota": ["colombia"],
  "America/Santiago": ["chile"],
  "Africa/Lagos": ["nigeria", "wat"],
  "Africa/Cairo": ["egypt"],
  "Africa/Nairobi": ["kenya", "eat"],
  "Africa/Johannesburg": ["south africa", "sast"],
  "Australia/Sydney": ["australia", "nsw", "aest"],
  "Australia/Melbourne": ["victoria"],
  "Australia/Perth": ["western australia", "awst"],
  "Pacific/Auckland": ["new zealand", "nz", "nzst"],
  UTC: ["utc", "gmt", "universal", "zulu"],
};

/** Zone ids whose alias list contains `needle` as a substring. */
function aliasMatches(needle: string): Set<string> {
  const matches = new Set<string>();

  for (const [zone, terms] of Object.entries(ALIASES)) {
    if (terms.some((term) => term.includes(needle))) matches.add(zone);
  }

  return matches;
}

/** The zone's city portion, with underscores turned back into spaces. */
function cityOf(zone: string): string {
  const parts = zone.split("/");
  return (parts[parts.length - 1] ?? zone).replace(/_/g, " ").toLowerCase();
}

/**
 * Ranked search over the supported zone list.
 *
 * Ordering: alias hits first (so "india" surfaces Asia/Kolkata), then city-name
 * prefix matches, then any remaining substring match on the full id.
 */
export function searchTimezones(
  zones: readonly string[],
  query: string,
  limit = 80,
): string[] {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    const pinned = COMMON_TIMEZONES.filter((zone) => zones.includes(zone));
    const rest = zones.filter((zone) => !pinned.includes(zone as never));
    return [...pinned, ...rest].slice(0, limit);
  }

  const aliased = aliasMatches(needle);

  const scored = zones
    .map((zone) => {
      const id = zone.toLowerCase();
      const city = cityOf(zone);

      if (aliased.has(zone)) return { zone, score: 0 };
      if (city.startsWith(needle)) return { zone, score: 1 };
      if (city.includes(needle)) return { zone, score: 2 };
      if (id.includes(needle)) return { zone, score: 3 };
      return null;
    })
    .filter((entry): entry is { zone: string; score: number } => entry !== null);

  scored.sort((a, b) => a.score - b.score || a.zone.localeCompare(b.zone));

  return scored.slice(0, limit).map((entry) => entry.zone);
}

/** The viewer's own timezone, used as the default for new schedules. */
export function detectBrowserTimezone(fallback = "UTC"): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}
