import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContext = {
  userId?: string;
  userRole?: string;
  sessionId?: string;
  tenantId?: string | null;
  /** When true, tenant middleware must not auto-inject filters (platform admin later). */
  bypassTenantScope?: boolean;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  return requestContext.getStore() ?? {};
}

export function requireTenantId(): string {
  const tenantId = getRequestContext().tenantId;
  if (!tenantId) {
    throw new Error('Missing tenantId in request context');
  }
  return tenantId;
}
