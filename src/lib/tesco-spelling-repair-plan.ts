import { z } from 'zod';

// A SQL document generator only: no database client, execution path or migration.
// The five public identities reviewed in PR #254 are the entire allowlist.
export const spellingRepairs = [
  ['Batchelors Marrowfat Peas 420g', 'Batchelors Marrow Fat Peas 420g', '250817417'],
  ['Brennans Bakehouse Multiseed 500g', 'Brennans Bakehouse Multi Seed 500g', '310099748'],
  ['Airwick Pure Cherry Blossom Aerosol 250ml', 'Air Wick Pure Cherry Blossom Aerosol 250ml', '289879442'],
  ['Airwick Pure Spring Delight Aerosol 250ml', 'Air Wick Pure Spring Delight Aerosol 250ml', '289879669'],
  ['Airwick Pure Soft Cotton Aerosol 250ml', 'Air Wick Pure Soft Cotton Aerosol 250ml', '295496617'],
] as const;
const row = z.object({ id: z.string().uuid(), canonical_name: z.string() }).passthrough();
const mapping = z.object({ id: z.string().uuid(), product_id: z.string().uuid(), store: z.string(),
  store_sku: z.string().nullable(), store_url: z.string().nullable() }).passthrough();
const manifestSchema = z.array(z.object({ expectedProduct: row, expectedMappings: z.array(mapping) })).length(5);
export type SpellingRepairManifest = z.input<typeof manifestSchema>;

export function prepareSpellingRepair(raw: unknown): string {
  const manifest = manifestSchema.parse(raw);
  if (new Set(manifest.map(x => x.expectedProduct.id)).size !== 5
    || new Set(manifest.map(x => x.expectedProduct.canonical_name)).size !== 5) throw new Error('Duplicate repair target');
  const plan = manifest.map(item => {
    const identity = spellingRepairs.find(x => x[0] === item.expectedProduct.canonical_name);
    if (!identity) throw new Error('Title is not in the reviewed spelling allowlist');
    if (item.expectedMappings.some(x => x.product_id !== item.expectedProduct.id)) throw new Error('Wrong mapping product');
    for (const store of ['tesco', 'supervalu', 'dunnes']) {
      if (item.expectedMappings.filter(x => x.store === store).length !== 1) throw new Error('Missing or duplicate retailer dependency');
    }
    const tesco = item.expectedMappings.find(x => x.store === 'tesco')!;
    if (tesco.store_sku !== identity[2] || tesco.store_url !== `https://www.tesco.ie/shop/en-IE/products/${identity[2]}`) throw new Error('Unreviewed Tesco SKU or URL');
    return { ...item, expectedMappings: [...item.expectedMappings].sort((a, b) => a.id.localeCompare(b.id)), newName: identity[1] };
  });
  const literal = JSON.stringify(plan).replace(/'/g, "''");
  let tag = '$repair$';
  for (let n = 0; literal.includes(tag); n++) tag = `$repair${n}$`;
  return `-- REVIEW ONLY. No production execution without explicit approval.
-- Ends in ROLLBACK. A separately authorised operator must review any COMMIT.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';
-- Freeze dependency rows and prevent concurrent insertion/deletion while guarded.
lock table public.products, public.store_products in share row exclusive mode;
lock table public.tesco_egress_pool in share row exclusive mode;
do ${tag}
declare
  plan jsonb := '${literal}'::jsonb;
  item jsonb;
  actual jsonb;
  old_count integer := 0;
  new_count integer := 0;
begin
  if exists(select 1 from public.tesco_egress_pool where leased_until > now() or cooldown_until > now()) then
    raise exception 'Active Tesco lease or cooldown: no repair';
  end if;
  for item in select value from jsonb_array_elements(plan) loop
    select to_jsonb(p) into actual from public.products p where p.id=(item->'expectedProduct'->>'id')::uuid;
    if actual is null or (actual - 'canonical_name') is distinct from ((item->'expectedProduct') - 'canonical_name') then
      raise exception 'Canonical dependency changed';
    end if;
    if actual->>'canonical_name'=item->'expectedProduct'->>'canonical_name' then old_count:=old_count+1;
    elsif actual->>'canonical_name'=item->>'newName' then new_count:=new_count+1;
    else raise exception 'Canonical title changed'; end if;
    select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into actual
      from public.store_products s where s.product_id=(item->'expectedProduct'->>'id')::uuid;
    if actual is distinct from item->'expectedMappings' then raise exception 'Retailer dependency changed'; end if;
  end loop;
  if new_count=5 then return; end if; -- already applied, no duplicate effects
  if old_count<>5 then raise exception 'Mixed repair state'; end if;
  for item in select value from jsonb_array_elements(plan) loop
    update public.products set canonical_name=item->>'newName'
      where id=(item->'expectedProduct'->>'id')::uuid;
  end loop;
end
${tag};
rollback;
`;
}
