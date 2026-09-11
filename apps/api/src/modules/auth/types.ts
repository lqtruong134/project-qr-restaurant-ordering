import type {} from 'fastify';
export interface AuthOptions {
  secret: string;
  restaurantId: string;
  origins: string[];
  secure: boolean;
  loginLimit?: number;
  now?: () => number;
}
export interface Identity {
  id: string;
  displayName: string;
  role: string;
  permissions: string[];
  version: number;
}
declare module 'fastify' {
  interface FastifyContextConfig {
    public?: boolean;
    permission?: string;
    authenticated?: boolean;
  }
  interface FastifyRequest {
    identity?: Identity;
  }
}
