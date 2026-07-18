CREATE TABLE "agreement_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agreementSlug" TEXT NOT NULL,
    "agreementVersion" TEXT NOT NULL,
    "agreementEffectiveAt" TIMESTAMP(3) NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "contentSnapshot" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agreement_acceptances_userId_agreementSlug_agreementVersion_key"
ON "agreement_acceptances"("userId", "agreementSlug", "agreementVersion");

CREATE INDEX "agreement_acceptances_userId_acceptedAt_idx"
ON "agreement_acceptances"("userId", "acceptedAt");

ALTER TABLE "agreement_acceptances"
ADD CONSTRAINT "agreement_acceptances_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
