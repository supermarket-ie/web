import { NextRequest } from 'next/server';
import { getRunWithItems } from '@/lib/scraper/db';

export async function GET(request: NextRequest) {
  const run_id = request.nextUrl.searchParams.get('run_id');
  if (!run_id) {
    return Response.json({ error: 'run_id query param is required' }, { status: 400 });
  }

  // Require either admin or worker secret so this isn't fully public
  const adminSecret = process.env.ADMIN_SECRET;
  const workerSecret = process.env.WORKER_SECRET;
  const provided =
    request.headers.get('x-admin-secret') ?? request.headers.get('x-worker-secret');

  if (!provided || (provided !== adminSecret && provided !== workerSecret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { run, errorBreakdown } = await getRunWithItems(run_id);

    if (!run) {
      return Response.json({ error: 'Run not found' }, { status: 404 });
    }

    return Response.json({ run, error_breakdown: errorBreakdown });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
