import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { withApiHandler } from "@/lib/observability/api-handler";

const handler = withApiHandler(NextAuth(authOptions));

export { handler as GET, handler as POST };

export const dynamic = "force-dynamic";
