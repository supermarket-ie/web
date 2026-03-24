create table if not exists list_items (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  canonical_name text not null,
  category text,
  store text not null,
  price_paid numeric(10,2) not null,
  quantity int not null default 1,
  observed_at timestamptz not null default now()
);

create index list_items_subscriber_idx on list_items(subscriber_id, observed_at desc);
create index list_items_product_idx on list_items(canonical_name, subscriber_id);
