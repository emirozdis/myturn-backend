import assert from "node:assert/strict";
import test from "node:test";
import { parseDiagnosticStatus } from "../../lib/observability/diagnostic-status";

test("transport failures retain status zero but persist no HTTP status", () => {
  assert.deepEqual(parseDiagnosticStatus(0), {
    clientStatus: 0,
    persistedStatus: null,
  });
});

test("real HTTP statuses remain unchanged", () => {
  assert.deepEqual(parseDiagnosticStatus(401), {
    clientStatus: 401,
    persistedStatus: 401,
  });
  assert.deepEqual(parseDiagnosticStatus(599), {
    clientStatus: 599,
    persistedStatus: 599,
  });
});

test("invalid and pseudo-status values are rejected", () => {
  assert.equal(parseDiagnosticStatus(-1), null);
  assert.equal(parseDiagnosticStatus(99), null);
  assert.equal(parseDiagnosticStatus(600), null);
  assert.equal(parseDiagnosticStatus("0"), null);
});
