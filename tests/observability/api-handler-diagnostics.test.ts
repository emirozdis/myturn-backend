import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import type { Logger } from "pino";
import { withApiHandler } from "../../lib/observability/api-handler";
import type { IncidentInput } from "../../lib/observability/incident-store";

const silentLogger = {
  info: (() => undefined) as Logger["info"],
  warn: (() => undefined) as Logger["warn"],
  error: (() => undefined) as Logger["error"],
};

test("persists a normalized incident for an ordinary 4xx response", async () => {
  const incidents: IncidentInput[] = [];
  const handler = withApiHandler(
    async () => NextResponse.json({ error: "Bad input" }, { status: 400 }),
    {
      logger: silentLogger,
      idFactory: () => `id-${incidents.length}`,
      incidentWriter: async (incident) => {
        incidents.push(incident);
      },
    },
  );

  const response = await handler(
    new NextRequest("https://example.test/api/example", {
      method: "POST",
      headers: {
        "X-Client-Request-ID": "client-request",
        "X-Client-Operation-ID": "operation",
      },
    }),
    undefined,
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-request-id"), "id-0");
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.event, "api.non_2xx_response");
  assert.equal(incidents[0]?.status, 400);
  assert.equal(incidents[0]?.code, "INVALID_REQUEST");
});

test("does not persist a response incident for a successful request", async () => {
  const incidents: IncidentInput[] = [];
  const handler = withApiHandler(
    async () => NextResponse.json({ success: true }),
    {
      logger: silentLogger,
      idFactory: () => "request-id",
      incidentWriter: async (incident) => {
        incidents.push(incident);
      },
    },
  );

  const response = await handler(
    new NextRequest("https://example.test/api/example"),
    undefined,
  );

  assert.equal(response.status, 200);
  assert.equal(incidents.length, 0);
});
