import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger, serializeUnknownError } from "@/lib/observability/logger";

type AuditInput = {
  actorEmail: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Prisma.InputJsonValue;
  ipAddress?: string;
};

export async function writeAdminAudit(input: AuditInput) {
  try {
    await db.adminAuditLog.create({
      data: {
        actorEmail: input.actorEmail.slice(0, 320),
        action: input.action.slice(0, 120),
        targetType: input.targetType?.slice(0, 80),
        targetId: input.targetId?.slice(0, 160),
        details: input.details,
        ipAddress: input.ipAddress?.slice(0, 100),
      },
    });
  } catch (error) {
    logger.error({ event: "admin.audit_write_failed", err: serializeUnknownError(error) }, "Admin audit write failed");
  }
}
