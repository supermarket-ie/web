create extension if not exists vector with schema extensions;

create table if not exists public.product_search_embeddings (
  product_id uuid primary key references public.products(id) on delete cascade,
  source_text text not null,
  source_hash text not null,
  embedding extensions.vector(384) not null,
  embedding_model text not null,
  updated_at timestamptz not null default now()
);

alter table public.product_search_embeddings enable row level security;
revoke all on public.product_search_embeddings from anon, authenticated;
grant select, insert, update, delete on public.product_search_embeddings to service_role;

create index if not exists product_search_embeddings_hnsw
  on public.product_search_embeddings using hnsw (embedding vector_cosine_ops);

create table if not exists public.product_embedding_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  processed_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_embedding_jobs enable row level security;
revoke all on public.product_embedding_jobs from anon, authenticated;
grant select, insert, update, delete on public.product_embedding_jobs to service_role;

create or replace function public.match_product_search_embeddings(
  query_embedding extensions.vector(384),
  match_threshold double precision default 0.55,
  match_count integer default 12
)
returns table (
  product_id uuid,
  canonical_name text,
  category text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.canonical_name,
    p.category,
    1 - (e.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.product_search_embeddings e
  join public.products p on p.id = e.product_id
  where 1 - (e.embedding operator(extensions.<=>) query_embedding) >= match_threshold
  order by e.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50);
$$;

revoke all on function public.match_product_search_embeddings(extensions.vector, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.match_product_search_embeddings(extensions.vector, double precision, integer)
  to service_role;
