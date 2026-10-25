/** Human-friendly relative time, e.g. "2h ago". `unixSec` is seconds since epoch. */
export function relativeTime(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}
