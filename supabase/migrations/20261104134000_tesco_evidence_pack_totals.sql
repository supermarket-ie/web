-- Compare explicit multipacks by total amount while preserving count conflicts.
-- CREATE OR REPLACE preserves the existing private invoker execution privileges.
create or replace function tesco_internal.material_title_conflict(
  p_canonical text, p_tesco text, p_source_quantity jsonb default null
)
returns boolean language plpgsql immutable set search_path = ''
as $check$
declare
  c text := lower(regexp_replace(coalesce(p_canonical,''), '(\d),(\d{3})(\D|$)', '\1\2\3', 'g'));
  t text := lower(regexp_replace(coalesce(p_tesco,''), '(\d),(\d{3})(\D|$)', '\1\2\3', 'g'));
  term text;
  terms text[] := array['juice drink','citrus','lemon','lime','vanilla','chocolate',
    'strawberry','zero','diet','sugar free','gluten free','organic','french onion','vegetable soup'];
  cm text[];
  tm text[];
  cc text[];
  tc text[];
  t_multi text[];
  c_multi text[];
  c_units numeric;
  t_units numeric;
  c_measures integer;
  t_measures integer;
  c_quantity numeric;
  t_quantity numeric;
  source_unit text;
  source_quantity numeric;
begin
  c := replace(replace(c, ',', '.'), '×', 'x');
  t := replace(replace(t, ',', '.'), '×', 'x');
  foreach term in array terms loop
    if (c ~ ('\m' || replace(term,' ','[[:space:]]+') || '\M'))
      is distinct from (t ~ ('\m' || replace(term,' ','[[:space:]]+') || '\M'))
    then return true; end if;
  end loop;

  if (c ~ '\m(light|lighter)\M') is distinct from (t ~ '\m(light|lighter)\M')
  then return true; end if;

  -- A compound title cannot be reduced to its first measure. Keep it held
  -- rather than silently dropping the extra quantity or dimension.
  select count(*) into c_measures from regexp_matches(c, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M', 'g');
  select count(*) into t_measures from regexp_matches(t, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M', 'g');
  if c_measures > 1 or t_measures > 1 then return true; end if;
  cm := regexp_match(c, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M');
  tm := regexp_match(t, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M');
  if cm is not null then
    c_quantity := cm[1]::numeric * case when cm[2] in ('kg','l','litre','litres') then 1000 else 1 end;
    if c_quantity <= 0 then return true; end if;
  end if;
  if tm is not null then
    t_quantity := tm[1]::numeric * case when tm[2] in ('kg','l','litre','litres') then 1000 else 1 end;
    if t_quantity <= 0 then return true; end if;
  end if;
  c_multi := regexp_match(c, '\m(\d+)\s*x\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|litres?)\M');
  t_multi := regexp_match(t, '\m(\d+)\s*x\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|litres?)\M');
  if cm is not null and tm is not null then
    if (cm[2] in ('kg','g')) <> (tm[2] in ('kg','g')) or c_quantity * coalesce(c_multi[1]::numeric,1) <> t_quantity * coalesce(t_multi[1]::numeric,1)
    then return true; end if;
  end if;

  cc := regexp_match(c, '\m(\d+)\s*(?:x\s*\d|(?:(?:standard|dental|jumbo|mini|large|small|sausage|reduced|salt|beef|chicken|vegetable|stock|be|good|wholemeal|seeded|ultimate|breaded|fillet)\s+){0,6}(?:packs?|pk|rolls?|sheets?|pieces?|pairs?|bars?|sticks?|pouches?|sachets?|chews?|pods?|cubes?|bagels?|burgers?|pots?|tablets?|bottles?|tubes?|cans?)\M)');
  tc := regexp_match(t, '\m(\d+)\s*(?:x\s*\d|(?:(?:standard|dental|jumbo|mini|large|small|sausage|reduced|salt|beef|chicken|vegetable|stock|be|good|wholemeal|seeded|ultimate|breaded|fillet)\s+){0,6}(?:packs?|pk|rolls?|sheets?|pieces?|pairs?|bars?|sticks?|pouches?|sachets?|chews?|pods?|cubes?|bagels?|burgers?|pots?|tablets?|bottles?|tubes?|cans?)\M)');
  -- Match the independent collector's conservative single-unit inference:
  -- "1L" is one unit, and must not approve "6x1L" in either direction.
  c_units := case when cc is not null then cc[1]::numeric when cm is not null then 1 end;
  t_units := case when tc is not null then tc[1]::numeric when tm is not null then 1 end;
  if c_units <= 0 or t_units <= 0
    or (c_units is not null and t_units is not null and c_units <> t_units)
  then return true; end if;

  -- Structured source quantity is retained retailer evidence, not an AI claim.
  -- Tesco's Nx-size product measure is the total pack amount; an ordinary
  -- counted title such as "7 sticks 110g" already states the total weight.
  if p_source_quantity is not null then
    select key, value::text::numeric into source_unit, source_quantity
      from jsonb_each(p_source_quantity);
    t_multi := regexp_match(t, '\m(\d+)\s*x\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|litres?)\M');
    if tm is not null and (
      source_unit is distinct from case when tm[2] in ('kg','g') then 'grams' else 'millilitres' end
      or source_quantity <> t_quantity * case when t_multi is not null then t_multi[1]::numeric else 1 end
    ) then return true; end if;
    if tm is null and source_unit = 'pieces' and t_units is not null
      and source_quantity <> t_units then return true; end if;
    if tm is null and cm is not null and coalesce(c_units,1) = 1 and (
      source_unit is distinct from case when cm[2] in ('kg','g') then 'grams' else 'millilitres' end
      or source_quantity <> c_quantity
    ) then return true; end if;
  end if;
  return false;
end $check$;
