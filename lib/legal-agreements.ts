import { createHash } from "node:crypto";
import { CURRENT_AGREEMENT, CURRENT_AGREEMENT_CONTENT } from "@/lib/legal-copy";

export const CURRENT_AGREEMENT_HASH = createHash("sha256")
  .update(CURRENT_AGREEMENT_CONTENT, "utf8")
  .digest("hex");

export function getCurrentAgreement() {
  return {
    slug: CURRENT_AGREEMENT.slug,
    version: CURRENT_AGREEMENT.version,
    title: CURRENT_AGREEMENT.title,
    effectiveAt: CURRENT_AGREEMENT.effectiveAt,
    content: CURRENT_AGREEMENT_CONTENT,
    contentHash: CURRENT_AGREEMENT_HASH,
  };
}
