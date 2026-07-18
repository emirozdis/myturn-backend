CREATE TABLE "group_member_xp_events" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "groupMemberId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_member_xp_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "group_member_xp_events_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "group_member_xp_events_groupMemberId_fkey" FOREIGN KEY ("groupMemberId") REFERENCES "group_members"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "group_member_xp_events_groupId_groupMemberId_businessDate_reason_key"
  ON "group_member_xp_events"("groupId", "groupMemberId", "businessDate", "reason");
CREATE INDEX "group_member_xp_events_groupMemberId_businessDate_idx"
  ON "group_member_xp_events"("groupMemberId", "businessDate");

-- Convert legacy IANA names to the fixed UTC offset active at migration time.
-- Invalid historical values safely become UTC.
UPDATE "groups" AS g
SET "timezone" = CASE
  WHEN g."timezone" = 'UTC' THEN 'UTC'
  WHEN g."timezone" ~ '^UTC[+-][0-9]{2}:[0-9]{2}$'
    AND SUBSTRING(g."timezone" FROM 8 FOR 2)::INTEGER < 60
    AND (
      (SUBSTRING(g."timezone" FROM 4 FOR 1) = '+' AND (
        SUBSTRING(g."timezone" FROM 5 FOR 2)::INTEGER < 14 OR
        (SUBSTRING(g."timezone" FROM 5 FOR 2)::INTEGER = 14 AND SUBSTRING(g."timezone" FROM 8 FOR 2)::INTEGER = 0)
      )) OR
      (SUBSTRING(g."timezone" FROM 4 FOR 1) = '-' AND (
        SUBSTRING(g."timezone" FROM 5 FOR 2)::INTEGER < 12 OR
        (SUBSTRING(g."timezone" FROM 5 FOR 2)::INTEGER = 12 AND SUBSTRING(g."timezone" FROM 8 FOR 2)::INTEGER = 0)
      ))
    ) THEN g."timezone"
  ELSE COALESCE((
    SELECT CASE
      WHEN EXTRACT(EPOCH FROM z.utc_offset)::INTEGER = 0 THEN 'UTC'
      ELSE 'UTC'
        || CASE WHEN EXTRACT(EPOCH FROM z.utc_offset) < 0 THEN '-' ELSE '+' END
        || LPAD((ABS(EXTRACT(EPOCH FROM z.utc_offset)::INTEGER) / 3600)::TEXT, 2, '0')
        || ':'
        || LPAD(((ABS(EXTRACT(EPOCH FROM z.utc_offset)::INTEGER) % 3600) / 60)::TEXT, 2, '0')
    END
    FROM pg_timezone_names AS z
    WHERE z.name = g."timezone"
    LIMIT 1
  ), 'UTC')
END;

ALTER TABLE "groups"
  ADD CONSTRAINT "groups_timezone_utc_offset_check"
  CHECK (
    "timezone" = 'UTC' OR (
      "timezone" ~ '^UTC[+-][0-9]{2}:[0-9]{2}$'
      AND SUBSTRING("timezone" FROM 8 FOR 2)::INTEGER < 60
      AND (
        (SUBSTRING("timezone" FROM 4 FOR 1) = '+' AND (
          SUBSTRING("timezone" FROM 5 FOR 2)::INTEGER < 14 OR
          (SUBSTRING("timezone" FROM 5 FOR 2)::INTEGER = 14 AND SUBSTRING("timezone" FROM 8 FOR 2)::INTEGER = 0)
        )) OR
        (SUBSTRING("timezone" FROM 4 FOR 1) = '-' AND (
          SUBSTRING("timezone" FROM 5 FOR 2)::INTEGER < 12 OR
          (SUBSTRING("timezone" FROM 5 FOR 2)::INTEGER = 12 AND SUBSTRING("timezone" FROM 8 FOR 2)::INTEGER = 0)
        ))
      )
    )
  );

UPDATE "daily_assignments" SET "isPassed" = FALSE WHERE "isClaimed" = TRUE;

ALTER TABLE "daily_assignments"
  ADD CONSTRAINT "daily_assignments_pass_claim_check"
  CHECK (NOT ("isPassed" AND "isClaimed"));
