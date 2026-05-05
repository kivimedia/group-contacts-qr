import { NextResponse } from 'next/server';
import { fetchGroupContactPage } from '@/lib/group-contacts-qr/fetch-page';
import { buildMultiVcard } from '@/lib/group-contacts-qr/vcard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Props = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { slug } = await params;
  try {
    const row = await fetchGroupContactPage(slug);
    if (!row) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    const vcard = buildMultiVcard(row.members, row.name);
    return new NextResponse(vcard, {
      status: 200,
      headers: {
        'Content-Type': 'text/vcard; charset=utf-8',
        'Content-Disposition': `inline; filename="${row.slug}-contacts.vcf"`,
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'X-Group-Contact-Count': String(row.member_count),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to build group vCard',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
