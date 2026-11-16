import type { Context } from 'hono';
import type { AppContext, ErrorResponse } from '../types';
import { CustodyActionError } from '../services/custodyService';
import { publicErrorMessage } from './errors';

/**
 * Formats a CustodyActionError (preserving HTTP status, code, and extra
 * fields such as ONECLICK_AUTH_REQUIRED challenge options) or falls back
 * to a sanitized 500 JSON error response.
 */
export function handleCustodyActionError(
  c: Context<AppContext>,
  err: unknown,
  fallbackCode: string,
  logTag = '[self-custody]'
): Response {
  if (err instanceof CustodyActionError) {
    return c.json<ErrorResponse>(
      {
        error: err.message,
        code: err.code,
        ...(err.extra || {}),
      } as ErrorResponse,
      err.status as 400
    );
  }
  console.error(`${logTag} unexpected error:`, err);
  return c.json<ErrorResponse>(
    { error: publicErrorMessage(err, 'Self-custody action failed'), code: fallbackCode },
    500
  );
}
