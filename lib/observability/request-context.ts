import { AsyncLocalStorage } from "node:async_hooks";

export type RequestLogContext = {
  requestId: string;
  method: string;
  route: string;
  userId?: string;
  groupId?: string;
  clipId?: string;
  jobRunId?: string;
  clientRequestId?: string;
  operationId?: string;
  appSessionId?: string;
  authState?: string;
};

const requestContext = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestContext<T>(context: RequestLogContext, callback: () => T): T {
  return requestContext.run(context, callback);
}

export function getRequestContext(): RequestLogContext | undefined {
  return requestContext.getStore();
}

export function setLogContext(fields: Partial<Omit<RequestLogContext, "requestId" | "method" | "route">>): void {
  const context = requestContext.getStore();
  if (context) Object.assign(context, fields);
}
