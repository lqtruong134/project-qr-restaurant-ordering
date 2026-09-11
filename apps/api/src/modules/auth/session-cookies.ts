import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyReply } from 'fastify';
import type { AuthOptions } from './types.js';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const ACCESS_SECONDS = 15 * 60;
export function createSessionCookies(options: AuthOptions, key: Uint8Array, now: () => number) {
  const cookieOptions = {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict' as const,
    path: '/',
  };
  return {
    clear(reply: FastifyReply) {
      reply.clearCookie('access', cookieOptions);
      reply.clearCookie('refresh', cookieOptions);
    },
    async issue(
      reply: FastifyReply,
      userId: string,
      version: number,
      refresh: string,
      expires: Date,
    ) {
      const access = await new SignJWT({ v: version })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer('thesis-api')
        .setAudience('thesis-internal')
        .setIssuedAt(Math.floor(now() / 1000))
        .setExpirationTime(Math.floor(now() / 1000) + ACCESS_SECONDS)
        .sign(key);
      reply.setCookie('access', access, { ...cookieOptions, maxAge: ACCESS_SECONDS });
      reply.setCookie('refresh', refresh, {
        ...cookieOptions,
        maxAge: Math.max(0, Math.floor((expires.getTime() - now()) / 1000)),
      });
    },
  };
}
