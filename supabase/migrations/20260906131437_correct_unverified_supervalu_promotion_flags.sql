-- The former SuperValu parser treated generic promotion-related classes in
-- shared page chrome as product-level evidence. Remove those unsupported
-- flags. Observations with an explicit higher was_price remain promoted.
update public.price_observations po
set on_promotion = false
from public.store_products sp
where sp.id = po.store_product_id
  and sp.store = 'supervalu'
  and po.source = 'supervalu_direct'
  and po.on_promotion = true
  and po.was_price is null;
