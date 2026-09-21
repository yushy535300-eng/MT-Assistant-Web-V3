/**
 * SA official short table codes (D01/C01/…).
 * Keep in sync with server/sa-table-labels.json.
 */
import raw from "./sa-table-labels.json";

export const SA_TABLE_LABELS: Record<string, string> =
  (raw as { labels?: Record<string, string> })?.labels || {};

export function saTableLabel(hostId: string | number): string {
  const key = String(hostId);
  return SA_TABLE_LABELS[key] || key;
}
