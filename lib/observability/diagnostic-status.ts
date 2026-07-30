export type DiagnosticStatus = {
  /** Status retained for fingerprinting and transport-vs-HTTP classification. */
  clientStatus: number;
  /** Only real HTTP status codes are persisted in the constrained DB column. */
  persistedStatus: number | null;
};

/**
 * Mobile networking uses 0 when no HTTP response exists (offline, timeout,
 * DNS, TLS, or runtime failures). PostgreSQL stores that as NULL because the
 * status column is intentionally restricted to real HTTP status codes.
 */
export function parseDiagnosticStatus(value: unknown): DiagnosticStatus | null {
  if (value === 0) {
    return { clientStatus: 0, persistedStatus: null };
  }
  if (Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599) {
    const status = Number(value);
    return { clientStatus: status, persistedStatus: status };
  }
  return null;
}
