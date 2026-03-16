import { NextRequest, NextResponse } from 'next/server';
import { generateList, type FamilySize } from '@/lib/list-generator';

const VALID_FAMILY_SIZES = new Set<FamilySize>(['1', '2', '3-4', '5+']);

export async function GET(req: NextRequest) {
  const familySize = (req.nextUrl.searchParams.get('family_size') ?? '2') as FamilySize;

  if (!VALID_FAMILY_SIZES.has(familySize)) {
    return NextResponse.json(
      { error: 'Invalid family_size. Must be one of: 1, 2, 3-4, 5+' },
      { status: 400 }
    );
  }

  try {
    const list = await generateList(familySize);
    return NextResponse.json(list);
  } catch (err) {
    console.error('[list] generateList failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
