import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  PRODUCT_EMBEDDING_MODEL,
  productEmbeddingText,
} from '@/lib/product-semantic-search';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type ProductRow = {
  id: string;
  canonical_name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function processJob(jobId: string) {
  const started = Date.now();
  const batchSize = 50;
  let processed = 0;

  const { data: job, error: jobError } = await supabaseAdmin
    .from('product_embedding_jobs')
    .select('id,status,processed_count,created_at')
    .eq('id', jobId)
    .single();
  if (jobError || !job) throw new Error('Embedding job was not found');
  if (job.status === 'completed') return { completed: true, processed_count: job.processed_count };
  if (Date.now() - new Date(job.created_at).getTime() > 24 * 60 * 60 * 1000) {
    throw new Error('Embedding job has expired');
  }

  let cursor = Number(job.processed_count ?? 0);
  await supabaseAdmin.from('product_embedding_jobs').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', jobId);

  while (Date.now() - started < 240_000) {
    const { data: products, error: productsError } = await supabaseAdmin
      .from('products')
      .select('id,canonical_name,category,brand,description')
      .order('id')
      .range(cursor, cursor + batchSize - 1);
    if (productsError) throw new Error(`Product batch failed: ${productsError.message}`);
    const batch = (products ?? []) as ProductRow[];
    if (batch.length === 0) {
      await supabaseAdmin.from('product_embedding_jobs').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', jobId);
      return { completed: true, processed_count: cursor };
    }

    const ids = batch.map(product => product.id);
    const { data: existing } = await supabaseAdmin
      .from('product_search_embeddings')
      .select('product_id,source_hash,embedding_model')
      .in('product_id', ids);
    const existingById = new Map((existing ?? []).map(row => [row.product_id, row]));
    const pending = batch.map(product => {
      const source_text = productEmbeddingText(product);
      return { product, source_text, source_hash: hash(source_text) };
    }).filter(item => {
      const current = existingById.get(item.product.id);
      return !current || current.source_hash !== item.source_hash || current.embedding_model !== PRODUCT_EMBEDDING_MODEL;
    });

    if (pending.length > 0) {
      const { data: generated, error: embeddingError } = await supabaseAdmin.functions.invoke('product-embeddings', {
        body: { texts: pending.map(item => item.source_text) },
      });
      if (embeddingError) throw new Error(`Embedding generation failed: ${embeddingError.message}`);
      const embeddings = generated?.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== pending.length) {
        throw new Error('Embedding generation returned an incomplete batch');
      }
      const rows = pending.map((item, index) => ({
        product_id: item.product.id,
        source_text: item.source_text,
        source_hash: item.source_hash,
        embedding: embeddings[index],
        embedding_model: PRODUCT_EMBEDDING_MODEL,
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertError } = await supabaseAdmin.from('product_search_embeddings').upsert(rows, { onConflict: 'product_id' });
      if (upsertError) throw new Error(`Embedding upsert failed: ${upsertError.message}`);
    }

    cursor += batch.length;
    processed += pending.length;
    await supabaseAdmin.from('product_embedding_jobs').update({ processed_count: cursor, updated_at: new Date().toISOString() }).eq('id', jobId);
    if (batch.length < batchSize) continue;
  }

  return { completed: false, processed_count: cursor, embedded_count: processed };
}

async function run(request: Request) {
  try {
    let jobId: string | null = null;
    if (authorized(request)) {
      const { data, error } = await supabaseAdmin.from('product_embedding_jobs').insert({}).select('id').single();
      if (error || !data) throw new Error(`Could not create embedding job: ${error?.message ?? 'unknown error'}`);
      jobId = data.id;
    } else if (request.method === 'POST') {
      const body = await request.json().catch(() => ({})) as { job_id?: string };
      if (body.job_id && /^[0-9a-f-]{36}$/i.test(body.job_id)) jobId = body.job_id;
    }
    if (!jobId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ job_id: jobId, ...(await processJob(jobId)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Embedding refresh failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
