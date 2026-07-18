import { AuthOptions, getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { setLogContext } from "@/lib/observability/request-context";

export const authOptions: AuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/",
    error: "/",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
    AppleProvider({
      clientId: process.env.APPLE_ID as string,
      clientSecret: process.env.APPLE_SECRET as string,
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // --- Abuse Protection: Brute-Force & Credential Stuffing Prevention ---
        const reqHeaders = await headers();
        const ip = reqHeaders.get("cf-connecting-ip") || reqHeaders.get("x-forwarded-for") || "unknown_ip";

        // Limit to 10 login attempts per 15 minutes per IP address
        const rl = rateLimit(`login_${ip}`, 10, 15 * 60 * 1000);
        if (!rl.success) {
          throw new Error("Too many login attempts. Please try again later.");
        }

        // Normalize the email input during sign-in to match sign-up constraints
        const emailNormalized = credentials.email.toLowerCase().trim();

        // Prisma query to find the user
        const user = await prisma.user.findUnique({
          where: { email: emailNormalized },
        });

        if (!user || !user.password) {
          return null;
        }

        if (!user.emailVerified) {
          throw new Error("Please verify your email before signing in.");
        }

        const isPasswordValid = await compare(credentials.password, user.password);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      const allowRegistration = process.env.NEXT_PUBLIC_ALLOW_REGISTRATION !== "false";

      // Intercept and validate social providers (any provider that is not "credentials")
      if (account?.provider && account.provider !== "credentials") {
        const allowSocial = process.env.NEXT_PUBLIC_ALLOW_SOCIAL_LOGIN !== "false";
        if (!allowSocial) return false;

        // Individual social provider checks
        if (account.provider === "google") {
          const googleEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN !== "false";
          if (!googleEnabled) return false;
        }
        if (account.provider === "apple") {
          const appleEnabled = process.env.NEXT_PUBLIC_ENABLE_APPLE_LOGIN !== "false";
          if (!appleEnabled) return false;
        }
        if (account.provider === "facebook") {
          const facebookEnabled = process.env.NEXT_PUBLIC_ENABLE_FACEBOOK_LOGIN === "true";
          if (!facebookEnabled) return false;
        }

        // Check if this social login is a registration attempt (new user)
        const userEmail = user.email?.toLowerCase().trim();
        if (userEmail) {
          const existingUser = await prisma.user.findUnique({
            where: { email: userEmail },
          });

          // Block the auth flow if user does not exist and registration is disabled
          if (!existingUser && !allowRegistration) {
            return false;
          }

          // New OAuth accounts need an explicit, versioned consent step before
          // the adapter is allowed to create them. The current clients do not
          // yet expose that OAuth consent hand-off, so fail closed here.
          if (!existingUser) {
            return false;
          }
        }
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        const currentUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { sessionVersion: true },
        });
        token.sessionVersion = currentUser?.sessionVersion;
        token.sessionRevoked = !currentUser;
        return token;
      }

      if (typeof token.id === "string") {
        const currentUser = await prisma.user.findUnique({
          where: { id: token.id },
          select: { sessionVersion: true },
        });
        const tokenVersion = typeof token.sessionVersion === "number"
          ? token.sessionVersion
          : null;

        if (!currentUser || tokenVersion !== currentUser.sessionVersion) {
          token.sessionRevoked = true;
          delete token.id;
          delete token.sessionVersion;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sessionRevoked || typeof token.id !== "string") {
        // Omitting the user makes /api/auth/session behave as signed out for
        // clients while the expired JWT cookie is naturally replaced/removed.
        return { ...session, user: undefined } as unknown as typeof session;
      }
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export const getAuthSession = async () => {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) setLogContext({ userId: session.user.id });
  return session;
};
