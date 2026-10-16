import type { Database } from '@thesis/database';
import type { FastifyRequest } from 'fastify';
import {
  parseAssistantToolArguments,
  type AssistantMenuProduct,
  type AssistantMenuSearch,
  type AssistantToolExecutor,
  type AssistantToolName,
  type AssistantToolResult,
} from '@thesis/contracts';
import { readOnlyAssistantTransaction, verifyAssistantGuest } from './assistant-context.js';

// Reserve capacity for transactional core traffic in the shared eight-connection pool.
const globalToolReads = new WeakMap<Database, number>();
const maxGlobalToolReads = 2;

export class AssistantReadToolError extends Error {
  constructor(readonly code: string) {
    super('Công cụ đọc thực đơn không thể thực hiện yêu cầu.');
  }
}

type ToolLimits = {
  signal: AbortSignal;
  timeoutMs?: number;
  maxCalls?: number;
  maxConcurrency?: number;
  maxResultBytes?: number;
  maxTotalBytes?: number;
};

function bounded(value: number | undefined, fallback: number, max: number) {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

/**
 * This is an in-process capability boundary, not an arbitrary Node.js code sandbox or a
 * dedicated PostgreSQL login. Only this frozen, finite tool dispatcher reaches the provider.
 * Static queries and READ ONLY transactions remain private to the trusted API process.
 */
export function createAssistantReadTools(
  db: Database,
  request: FastifyRequest,
  restaurant: string,
  options: ToolLimits,
): { tools: AssistantToolExecutor; close(): void } {
  const deadline = Date.now() + bounded(options.timeoutMs, 8000, 30000);
  const maxCalls = bounded(options.maxCalls, 12, 12);
  const maxConcurrency = bounded(options.maxConcurrency, 2, 2);
  const maxResultBytes = bounded(options.maxResultBytes, 65536, 65536);
  const maxTotalBytes = bounded(options.maxTotalBytes, 262144, 262144);
  let closed = false;
  let calls = 0;
  let inFlight = 0;
  let totalBytes = 0;
  function active() {
    if (closed || options.signal.aborted || Date.now() >= deadline)
      throw new AssistantReadToolError('TOOLS_CLOSED');
  }
  const tools: AssistantToolExecutor = Object.freeze({
    async call(name: AssistantToolName, raw: unknown): Promise<AssistantToolResult> {
      active();
      if (calls >= maxCalls) throw new AssistantReadToolError('TOOL_CALL_LIMIT');
      calls++;
      if (!['listCategories', 'searchMenu', 'getProducts'].includes(name))
        throw new AssistantReadToolError('UNKNOWN_TOOL');
      if (inFlight >= maxConcurrency) throw new AssistantReadToolError('TOOL_CONCURRENCY_LIMIT');
      let args;
      try {
        args = parseAssistantToolArguments(name, structuredClone(raw));
      } catch {
        throw new AssistantReadToolError('INVALID_TOOL_ARGUMENTS');
      }
      active();
      const globalReads = globalToolReads.get(db) ?? 0;
      if (globalReads >= maxGlobalToolReads) throw new AssistantReadToolError('TOOL_READ_BUSY');
      globalToolReads.set(db, globalReads + 1);
      inFlight++;
      try {
        const result = await readOnlyAssistantTransaction(db, async (connection) => {
          active();
          await verifyAssistantGuest(connection, request, restaurant);
          active();
          const asOf = new Date().toISOString();
          if (name === 'listCategories') {
            const rows = (
              await connection.query(
                `SELECT code,name FROM menu_category
                WHERE restaurant_id=$1 AND is_active ORDER BY sort_order,name,id LIMIT 101`,
                [restaurant],
              )
            ).rows;
            return {
              categories: rows.slice(0, 100).map((row) => ({
                code: String(row.code).slice(0, 40),
                name: String(row.name).slice(0, 120),
              })),
              truncated:
                rows.length > 100 ||
                rows.some((row) => String(row.code).length > 40 || String(row.name).length > 120),
              asOf,
            };
          }
          const search = (name === 'searchMenu' ? args : {}) as AssistantMenuSearch;
          const ids = name === 'getProducts' ? (args as { productIds: string[] }).productIds : null;
          const limit = ids ? ids.length : (search.limit ?? 20);
          const rows = (
            await connection.query(
              `SELECT p.id AS product_id,p.code,p.name,p.description,p.base_price::text AS unit_price,
              p.product_kind,p.version,mc.code AS category_code,mc.name AS category_name,
              product_catalog_available(p.id,$1) AS available,
              ARRAY(SELECT DISTINCT ig.name FROM recipe_bom b
                JOIN recipe_bom_item bi ON bi.recipe_bom_id=b.id
                JOIN ingredient ig ON ig.id=bi.ingredient_id
                WHERE b.product_id=p.id AND b.status='ACTIVE' AND b.effective_from<=now()
                  AND (b.effective_to IS NULL OR b.effective_to>now())
                  AND ig.restaurant_id=$1 AND ig.is_active
                ORDER BY ig.name LIMIT 41) AS ingredients,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',child.id,'name',child.name,
                'quantity',ci.quantity) ORDER BY ci.sort_order,ci.id)
                FROM product_combo_item ci JOIN product child ON child.id=ci.component_product_id
                JOIN menu_category cc ON cc.id=child.category_id AND cc.restaurant_id=child.restaurant_id
                WHERE ci.combo_product_id=p.id AND child.restaurant_id=$1
                  AND child.is_active AND cc.is_active),'[]'::jsonb) AS components
              FROM product p JOIN menu_category mc ON mc.id=p.category_id AND mc.restaurant_id=p.restaurant_id
              WHERE p.restaurant_id=$1 AND p.is_active AND mc.is_active
                AND ($2::text IS NULL OR strpos(lower(p.name||' '||COALESCE(p.description,'')||' '||p.code),lower($2))>0)
                AND ($3::text IS NULL OR mc.code=$3)
                AND ($4::text IS NULL OR p.product_kind=$4)
                AND ($5::bigint IS NULL OR p.base_price>=$5::bigint)
                AND ($6::bigint IS NULL OR p.base_price<=$6::bigint)
                AND (NOT $7::boolean OR product_catalog_available(p.id,$1))
                AND ($8::uuid[] IS NULL OR p.id=ANY($8::uuid[]))
              ORDER BY mc.sort_order,p.name,p.id LIMIT $9 OFFSET $10`,
              [
                restaurant,
                search.query ?? null,
                search.categoryCode ?? null,
                search.productKind ?? null,
                search.minUnitPrice ?? null,
                search.maxUnitPrice ?? null,
                search.availableOnly ?? false,
                ids,
                limit + 1,
                search.offset ?? 0,
              ],
            )
          ).rows;
          let truncated = rows.length > limit;
          const products = rows.slice(0, limit).map((row): AssistantMenuProduct => {
            const ingredients = (row.ingredients as string[]).slice(0, 40);
            const components = (
              row.components as { productId: string; name: string; quantity: number }[]
            ).slice(0, 20);
            if (
              String(row.code).length > 40 ||
              String(row.name).length > 120 ||
              String(row.description ?? '').length > 400 ||
              String(row.category_code).length > 40 ||
              String(row.category_name).length > 120 ||
              row.ingredients.length > 40 ||
              row.components.length > 20 ||
              ingredients.some((ingredient) => ingredient.length > 80) ||
              components.some((component) => component.name.length > 120)
            )
              truncated = true;
            return {
              productId: String(row.product_id).toLowerCase(),
              code: String(row.code).slice(0, 40),
              name: String(row.name).slice(0, 120),
              description: String(row.description ?? '').slice(0, 400),
              categoryCode: String(row.category_code).slice(0, 40),
              categoryName: String(row.category_name).slice(0, 120),
              unitPrice: String(row.unit_price),
              productKind: row.product_kind,
              version: Number(row.version),
              available: row.available === true,
              ingredients: ingredients.map((ingredient) => ingredient.slice(0, 80)),
              components: components.map((component) => ({
                productId: component.productId.toLowerCase(),
                name: component.name.slice(0, 120),
                quantity: component.quantity,
              })),
            };
          });
          return { products, truncated, asOf };
        });
        active();
        const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
        if (bytes > maxResultBytes || totalBytes + bytes > maxTotalBytes)
          throw new AssistantReadToolError('TOOL_RESULT_LIMIT');
        totalBytes += bytes;
        return result;
      } catch (error) {
        if (error instanceof AssistantReadToolError) throw error;
        throw new AssistantReadToolError('TOOL_READ_UNAVAILABLE');
      } finally {
        inFlight--;
        const remaining = (globalToolReads.get(db) ?? 1) - 1;
        if (remaining > 0) globalToolReads.set(db, remaining);
        else globalToolReads.delete(db);
      }
    },
  });
  return {
    tools,
    close() {
      closed = true;
    },
  };
}
