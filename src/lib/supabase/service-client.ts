import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for cron routes, webhooks, and anything that
 * runs outside a user session and needs to READ FRESH state on every call.
 *
 * WHY THIS EXISTS: Next.js intercepts `fetch` calls and caches them by
 * default. `export const dynamic = 'force-dynamic'` disables route-level
 * caching, but NOT fetch-level caching inside the route. Since
 * @supabase/supabase-js uses fetch under the hood, every Supabase read from
 * a cron would return the same cached payload from the first call, forever,
 * until deploy-time cache invalidation. This manifests as: cron sees the
 * same stale data every 5 min, sends duplicate alerts, fails to observe any
 * writes (even the ones it just made itself).
 *
 * Concrete bug fixed here: health-monitor was reading worker_heartbeats that
 * were 33 hours old and system_alerts.notified_at that was 26 hours old
 * despite fresh writes seconds earlier. Result was a 65-email dedupe storm
 * over 8 hours for an already-resolved condition.
 *
 * DO NOT use this for user-facing queries. User routes should go through
 * `createServerSupabaseClient()` so RLS + session cookies apply. This is
 * service-role + no-cache + no-auth only.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'createServiceClient: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // cache: 'no-store' on every fetch disables the Next.js fetch cache
      // that would otherwise silently pin every Supabase read to the first
      // call's result.
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}
