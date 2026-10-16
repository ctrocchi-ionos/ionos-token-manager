const SQLITE_UTC = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * SQLite's datetime('now') is UTC written without a zone ("2026-10-16 08:30:00"), which browsers read as local time.
 * Answer ISO 8601 with "Z" instead. Values that already carry a zone pass through unchanged.
 */
export function isoUtc(value: string): string;
export function isoUtc(value: string | null): string | null;
export function isoUtc(value: string | null): string | null {
  if (value === null) return null;
  const m = SQLITE_UTC.exec(value);
  return m ? `${m[1]}T${m[2]}Z` : value;
}
