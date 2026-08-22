import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

const REPOSITORY = 'supermarket-ie/web';
const OWNER_LOGIN = 'supermarket-ie';

type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  updated_at: string;
  user?: { login?: string | null } | null;
};

type Operation = {
  name: string;
  target: string;
};

const OPERATIONS: Record<string, Operation> = {
  '[ops] Dunnes alternative canary': {
    name: 'dunnes-alternative-canary',
    target: '/api/ops/dunnes-alternative-canary?limit=30',
  },
  '[ops] Dunnes usage-ranked discovery': {
    name: 'dunnes-usage-ranked-discovery',
    target: '/api/workers/dunnes-discovery-trigger?limit=250&batch_size=1&stagger_seconds=2',
  },
  '[ops] Dunnes catch-up': {
    name: 'dunnes-catch-up',
    target: '/api/workers/dunnes-scrape-trigger?limit=275',
  },
  '[ops] SuperValu catch-up': {
    name: 'supervalu-catch-up',
    target: '/api/workers/supervalu-scrape-trigger?limit=1000',
  },
};

async function loadIssue(issueNumber: number): Promise<GitHubIssue> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/issues/${issueNumber}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'supermarket-ie-production-ops',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub issue lookup failed with HTTP ${response.status}`);
  return response.json() as Promise<GitHubIssue>;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Response.json({ error: 'Production operations secret is not configured' }, { status: 503 });

  const url = new URL(request.url);
  const issueNumber = Number(url.searchParams.get('issue'));
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return Response.json({ error: 'A valid GitHub issue number is required' }, { status: 400 });
  }

  let issue: GitHubIssue;
  try {
    issue = await loadIssue(issueNumber);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }

  const operation = OPERATIONS[issue.title];
  if (
    issue.number !== issueNumber ||
    issue.state !== 'open' ||
    issue.user?.login !== OWNER_LOGIN ||
    !operation
  ) {
    return Response.json({ error: 'GitHub issue is not an authorized production operation' }, { status: 403 });
  }

  const dispatchKey = createHash('sha256')
    .update(`${issue.id}:${issue.updated_at}:${operation.name}`)
    .digest('hex');

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('ops_manual_dispatches')
    .select('id, status, response, created_at, completed_at')
    .eq('dispatch_key', dispatchKey)
    .maybeSingle();
  if (existingError) return Response.json({ error: existingError.message }, { status: 500 });
  if (existing) {
    return Response.json({
      operation: operation.name,
      issue_number: issueNumber,
      already_dispatched: true,
      dispatch: existing,
    });
  }

  const { data: dispatch, error: insertError } = await supabaseAdmin
    .from('ops_manual_dispatches')
    .insert({
      dispatch_key: dispatchKey,
      issue_number: issueNumber,
      issue_updated_at: issue.updated_at,
      operation: operation.name,
      status: 'running',
    })
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return Response.json({ operation: operation.name, issue_number: issueNumber, already_dispatched: true });
    }
    return Response.json({ error: insertError.message }, { status: 500 });
  }

  const targetUrl = new URL(operation.target, request.url);
  let status = 'failed';
  let targetStatus = 500;
  let payload: unknown = null;

  try {
    const response = await fetch(targetUrl, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    targetStatus = response.status;
    const text = await response.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { body: text.slice(0, 4000) };
    }
    status = response.ok ? 'success' : 'failed';
  } catch (error) {
    payload = { error: error instanceof Error ? error.message : String(error) };
  }

  await supabaseAdmin
    .from('ops_manual_dispatches')
    .update({
      status,
      response: { target_status: targetStatus, payload },
      completed_at: new Date().toISOString(),
    })
    .eq('id', dispatch.id);

  return Response.json({
    operation: operation.name,
    issue_number: issueNumber,
    dispatch_id: dispatch.id,
    target_status: targetStatus,
    result: payload,
  }, { status: status === 'success' ? 200 : 502 });
}
