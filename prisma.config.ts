import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a direct or session-mode connection. The Vercel runtime
    // uses DATABASE_URL through Supavisor transaction mode instead.
    url: process.env.DIRECT_URL!,
  },
});
