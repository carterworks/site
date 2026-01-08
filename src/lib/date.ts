/**
 * Formats a date for display as a human-readable string.
 * Uses en-US locale with "Month Day, Year" format.
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a date for display in a long format.
 * Uses en-US locale with "Month Day, Year" format with full month name.
 */
export function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Returns an ISO date string suitable for the datetime attribute.
 */
export function toISODateString(date: Date): string {
  return date.toISOString();
}
