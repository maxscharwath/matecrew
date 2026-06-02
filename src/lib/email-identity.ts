/**
 * Email identity helpers.
 *
 * The company uses several email domains for the same people (e.g.
 * `owt.swiss` and `openwt.com`). The same person therefore signs in with
 * `john@owt.swiss` on one device and `john@openwt.com` on another, ending up
 * with two distinct `User` rows. These helpers collapse aliased domains to a
 * single canonical identity so duplicates can be detected and merged.
 *
 * Configure alias groups with the `EMAIL_DOMAIN_ALIASES` env var. Groups are
 * separated by `;`, domains within a group by `,`. The first domain in each
 * group is used as the canonical domain. Example:
 *
 *   EMAIL_DOMAIN_ALIASES="owt.swiss,openwt.com; acme.io,acme.com"
 *
 * When unset, it defaults to treating `owt.swiss` and `openwt.com` as aliases.
 */

const DEFAULT_ALIAS_GROUPS = "owt.swiss,openwt.com";

function parseAliasGroups(raw: string): string[][] {
  return raw
    .split(";")
    .map((group) =>
      group
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
    )
    .filter((group) => group.length > 0);
}

/**
 * Map of every aliased domain → its canonical domain (the first domain listed
 * in its group). Domains not present in any group are not in the map and are
 * their own canonical domain.
 */
function buildCanonicalDomainMap(): Map<string, string> {
  const raw = process.env.EMAIL_DOMAIN_ALIASES ?? DEFAULT_ALIAS_GROUPS;
  const map = new Map<string, string>();
  for (const group of parseAliasGroups(raw)) {
    const canonical = group[0];
    for (const domain of group) {
      map.set(domain, canonical);
    }
  }
  return map;
}

// Built once per server process — env is fixed at runtime.
const canonicalDomainMap = buildCanonicalDomainMap();

/** The configured alias groups, for display in the admin UI. */
export function getDomainAliasGroups(): string[][] {
  return parseAliasGroups(process.env.EMAIL_DOMAIN_ALIASES ?? DEFAULT_ALIAS_GROUPS);
}

/** Resolve a domain to its canonical form (itself if not aliased). */
export function canonicalizeDomain(domain: string): string {
  // Strip a trailing dot (valid FQDN form) so "owt.swiss." === "owt.swiss".
  const d = domain.trim().toLowerCase().replace(/\.$/, "");
  return canonicalDomainMap.get(d) ?? d;
}

/**
 * Compute a stable identity key for an email: the lowercased local part joined
 * to the canonical domain. Two emails that belong to the same person across
 * aliased domains produce the same key. Returns `null` for malformed input.
 */
export function canonicalEmailKey(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local}@${canonicalizeDomain(domain)}`;
}

/**
 * True when two emails resolve to the same canonical identity (same person on
 * different aliased domains, or simply the same address).
 */
export function areEmailsLinked(a: string, b: string): boolean {
  const keyA = canonicalEmailKey(a);
  const keyB = canonicalEmailKey(b);
  return keyA !== null && keyA === keyB;
}
