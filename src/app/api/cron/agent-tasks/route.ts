import { NextRequest, NextResponse } from 'next/server';
import { evaluateActiveAgentTasks } from '@/lib/agent-task-evaluator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[agent-tasks] CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Cron unavailable' }, { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await evaluateActiveAgentTasks();
    console.log('[agent-tasks] Evaluation complete', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[agent-tasks] Evaluation failed', error);
    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 });
  }
}
