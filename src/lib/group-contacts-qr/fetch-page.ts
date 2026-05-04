import { createServiceClient } from '@/lib/supabase/service-client';
import type { GenericContact, GroupContactPageRow } from './types';

export async function fetchGroupContactPage(
  slug: string
): Promise<GroupContactPageRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('group_contact_qr_pages')
    .select('id, slug, name, members, member_count, view_count, created_at')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`fetchGroupContactPage: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    members: (data.members ?? []) as GenericContact[],
    member_count: data.member_count as number,
    view_count: data.view_count as number,
    created_at: data.created_at as string,
  };
}

export async function bumpViewCount(currentRow: GroupContactPageRow): Promise<void> {
  // Best-effort, fire-and-forget. Failure must never break the page render.
  try {
    const supabase = createServiceClient();
    await supabase
      .from('group_contact_qr_pages')
      .update({ view_count: currentRow.view_count + 1 })
      .eq('id', currentRow.id);
  } catch {
    // Swallow — view counts aren't load-bearing.
  }
}
