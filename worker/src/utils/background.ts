/**
 * Fire-and-forget a promise onto the request's lifetime.
 *
 * Used for work that must happen "as soon as the user is in" (provisioning
 * their confidential intent account) but must never delay the response the
 * browser is waiting on.
 */
export function background(ctx: unknown, task: Promise<unknown>, label: string): void {
  const executionCtx = ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(
      task.catch((err) => {
        console.warn(`[background] ${label} notice:`, err);
      })
    );
    return;
  }
  task.catch((err) => {
    console.warn(`[background] ${label} notice:`, err);
  });
}
