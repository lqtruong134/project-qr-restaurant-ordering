import type { FastifyInstance } from 'fastify';
import type { Database } from '@thesis/database';
import {
  assistantRequestSchema,
  parseAssistantRequest,
  AssistantContractError,
} from '@thesis/contracts';
import { reject } from '../shared/core-persistence.js';
import { createMenuAssistant } from './assistant.service.js';
import type { MenuAssistantOptions } from './assistant-provider.js';
export type {
  AssistantProvider,
  MenuAssistantConfig,
  MenuAssistantOptions,
} from './assistant-provider.js';
export { readMenuAssistantConfig } from './assistant-provider.js';
export function registerMenuAssistant(
  app: FastifyInstance,
  db: Database,
  restaurant: string,
  options: MenuAssistantOptions = {},
) {
  const assistant = createMenuAssistant(db, restaurant, options),
    config = { public: true };
  app.get('/guest/menu-assistant/capabilities', { config }, (r) => assistant.capabilities(r));
  app.post(
    '/guest/menu-assistant/recommendations',
    { config, bodyLimit: 32768, schema: { body: assistantRequestSchema } },
    async (request) => {
      try {
        return await assistant.recommend(request, parseAssistantRequest(request.body));
      } catch (error) {
        if (error instanceof AssistantContractError)
          reject('Vui lòng kiểm tra yêu cầu tư vấn món.', 400);
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        return assistant.unavailable();
      }
    },
  );
}
