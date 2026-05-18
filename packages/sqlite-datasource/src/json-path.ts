/** Escape a key for use in a SQLite json_extract path (e.g. $."key").
 *  SQLite JSON paths use backslash to escape double quotes inside quoted keys.
 *  The result should be passed via a bound parameter (not kyselySql.lit)
 *  to avoid double-escaping of single quotes. */
export function escapeJsonPath(key: string): string {
  return `$."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
