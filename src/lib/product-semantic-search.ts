import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';

export const PRODUCT_EMBEDDING_MODEL = 'gte-small';

export type SemanticProductMatch = {
  product_id: string;
  canonical_name: string;
  category: string | null;
  similarity: number;
};

export function productEmbeddingText(product: {
  canonical_name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
}): string {
  const parts = [
    product.canonical_name,
    product.brand ? `Brand: ${product.brand}` : null,
    product.category ? `Category: ${product.category}` : null,
    product.description ? product.description.slice(0, 500) : null,
  ];
  return parts.filter(Boolean).join('. ');
}

export async function findSemanticProducts(query: string, limit = 12): Promise<SemanticProductMatch[]> {
  const value = query.trim();
  if (value.length < 3) return [];

  const { data: generated, error: embeddingError } = await supabaseAdmin.functions.invoke('product-embeddings', {
    body: { texts: [value] },
  });
  if (embeddingError) throw new Error(`Query embedding failed: ${embeddingError.message}`);
  const embedding = generated?.embeddings?.[0];
  if (!Array.isArray(embedding)) throw new Error('Query embedding was not returned');
  const { data, error } = await supabaseAdmin.rpc('match_product_search_embeddings', {
    query_embedding: embedding,
    match_threshold: 0.55,
    match_count: Math.min(Math.max(limit, 1), 50),
  });
  if (error) throw new Error(`Semantic catalogue lookup failed: ${error.message}`);
  return (data ?? []) as SemanticProductMatch[];
}
