import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/observability/api-handler";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAuthSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/observability/errors";

type RevenueCatPurchase = {
  id?: string;
  purchase_date?: string;
  store?: string;
  is_sandbox?: boolean;
};

function allowedProducts() {
  return new Set(
    (process.env.REVENUECAT_BOOST_PRODUCT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function POSTHandler(req: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await rateLimit(`boost_purchase_${session.user.id}`, 10, 60_000);
    if (!rl.success) return NextResponse.json({ error: "Too many purchase checks." }, { status: 429 });

    const rawBody = await req.json().catch(() => ({}));
    const body = Array.isArray(rawBody) ? rawBody[0] : rawBody;
    const productId = typeof body?.productId === "string" ? body.productId.trim() : "";
    const products = allowedProducts();
    if (!productId || products.size === 0 || !products.has(productId)) {
      return NextResponse.json({ error: "Unknown boost product." }, { status: 400 });
    }

    const apiKey = process.env.REVENUECAT_SECRET_KEY;
    if (!apiKey) {
      throw new AppError({
        code: "PURCHASE_VERIFICATION_UNAVAILABLE",
        status: 503,
        safeMessage: "Purchase verification is unavailable.",
        cause: new Error("REVENUECAT_SECRET_KEY is not configured"),
      });
    }

    const profile = await db.profile.findUnique({
      where: { id: session.user.id },
      select: { firebaseUid: true },
    });
    if (!profile) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(profile.firebaseUid)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new AppError({
        code: "PURCHASE_PROVIDER_FAILED",
        status: 502,
        safeMessage: "Purchase could not be verified.",
        cause: new Error(`RevenueCat returned HTTP ${response.status}`),
        details: { providerStatus: response.status },
      });
    }

    const customer = await response.json();
    const purchases: RevenueCatPurchase[] = customer?.subscriber?.non_subscriptions?.[productId] || [];
    const allowSandbox = process.env.NODE_ENV !== "production" && process.env.REVENUECAT_ALLOW_SANDBOX_PURCHASES === "true";
    const validPurchases = purchases
      .filter((purchase) => typeof purchase.id === "string" && typeof purchase.purchase_date === "string" && (!purchase.is_sandbox || allowSandbox))
      .sort((a, b) => Date.parse(b.purchase_date!) - Date.parse(a.purchase_date!));

    const recorded = await db.boostPurchase.findMany({
      where: { transactionId: { in: validPurchases.map((purchase) => purchase.id!) } },
      select: { transactionId: true },
    });
    const recordedIds = new Set(recorded.map((purchase) => purchase.transactionId));
    const purchase = validPurchases.find((candidate) => !recordedIds.has(candidate.id!));
    if (!purchase) {
      const user = await db.profile.findUnique({ where: { id: session.user.id }, select: { boostCredits: true } });
      return NextResponse.json({ success: true, alreadyProcessed: true, boostCredits: user?.boostCredits || 0 });
    }

    const purchasedAt = new Date(purchase.purchase_date!);
    if (!Number.isFinite(purchasedAt.getTime())) {
      throw new AppError({
        code: "PURCHASE_PROVIDER_INVALID_RESPONSE",
        status: 502,
        safeMessage: "Purchase could not be verified.",
        cause: new Error("RevenueCat returned an invalid purchase date"),
      });
    }

    const credits = await db.$transaction(async (tx) => {
      await tx.boostPurchase.create({
        data: {
          userId: session.user.id,
          transactionId: purchase.id!,
          productId,
          store: purchase.store || null,
          isSandbox: Boolean(purchase.is_sandbox),
          purchasedAt,
        },
      });
      return tx.profile.update({
        where: { id: session.user.id },
        data: { boostCredits: { increment: 1 } },
        select: { boostCredits: true },
      });
    });

    return NextResponse.json({ success: true, transactionId: purchase.id, boostCredits: credits.boostCredits });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: true, alreadyProcessed: true });
    }
    throw error;
  }
}

export const POST = withApiHandler(POSTHandler);

export const dynamic = "force-dynamic";
