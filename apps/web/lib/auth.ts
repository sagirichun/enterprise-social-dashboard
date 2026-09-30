// NextAuth configuration: Credentials (email/password) + Google OAuth.
// Social platform connections (Facebook, TikTok, YouTube, X, Threads) are
// handled separately via the Account model and /api/oauth/* routes.

import type { NextAuthOptions, User as NextAuthUser } from 'next-auth';
import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { NextResponse } from 'next/server';
import { db } from './db';
import { verifyPassword } from './password';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.YOUTUBE_CLIENT_ID ?? '',
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      // Request offline access so we can keep a refresh token for YouTube.
      authorization: {
        params: {
          access_type: 'offline',
          prompt: 'consent',
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.force-ssl',
          ].join(' '),
        },
      },
    }),
    CredentialsProvider({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'you@company.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials): Promise<NextAuthUser | null> {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password ?? '';
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

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
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) {
        session.user.id = token.uid;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Auto-provision users who sign in with an OAuth provider.
      if (account?.provider !== 'credentials' && user.email) {
        const existing = await db.user.findUnique({
          where: { email: user.email.toLowerCase() },
        });
        if (!existing) {
          await db.user.create({
            data: {
              email: user.email.toLowerCase(),
              name: user.name ?? null,
              image: user.image ?? null,
            },
          });
        }
      }
      return true;
    },
  },
};

/** The currently signed-in user (DB row), or null. */
export async function getAuthUser() {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) return null;
  return db.user.findUnique({ where: { id } });
}

/** The currently signed-in user's id, or null. Cheaper than getAuthUser. */
export async function getAuthUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
