import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { repairSql, type RepairPlan } from './pair-repair-sql';

// Runs the REAL generated SQL (src/lib/pair-repair-sql.ts, used by scripts/pair-repair-prepare.ts) against stub tables in PGlite.
const LF = '1cca7ae6-2118-4871-be9a-d8eeb359f0ed', FL = 'ac3ad0c4-b393-451b-b9a2-9e4a6bb87b7c';
const D = '7d80821c-7231-4e2f-b09c-36a463d1cc78', PH = '55b87c18-db0c-4f1d-83d0-4531c7e004f0', SF = '79948eeb-fadc-447f-9e07-36d77423012e';
const op = (extra: Record<string, unknown> = {}) => ({ offerId: D, store: 'dunnes', sku: '100673561', title: "Flahavan's Hi8 Muesli Original 1kg",
  fromProductId: LF, toProductId: FL, toProductBrand: "Flahavan's", retirePlaceholderId: PH, identityVerifiedBy: 'pair-review:test', ...extra });
function generate(name: string, ops: unknown[]) {
  const plan = { id: name, generatedAt: '2026-11-16T00:00:00.000Z', ops } as RepairPlan;
  return { dry: repairSql(plan, false), apply: repairSql(plan, true) };
}
const PGLITE_TIMEOUT = 30_000;
async function db() {
  const pg = new PGlite();
  await pg.exec(`
    create table products(id uuid primary key, canonical_name text, brand text);
    create table store_products(id uuid primary key, product_id uuid references products(id), store text, store_sku text, store_url text, store_product_name text);
    create table price_observations(id serial primary key, store_product_id uuid references store_products(id));
    create table scrape_product_receipts(id serial primary key, store_product_id uuid references store_products(id));
    create table scrape_failures(id serial primary key, store_product_id uuid references store_products(id));
    insert into products values ('${LF}','Lifeforce Muesli 750g','Lifeforce'),('${FL}','Flahavan''s Hi 8 No Added Sugar Muesli 1kg','Flahavan''s');
    insert into store_products values
      ('${D}','${LF}','dunnes','100673561','https://www.dunnesstoresgrocery.com/x/100673561','Flahavan''s Hi8 Muesli Original 1kg'),
      ('${SF}','${FL}','supervalu','1023559000','https://shop.supervalu.ie/x','Flahavan''s Hi 8 No Added Sugar Muesli (1 kg)'),
      ('${PH}','${FL}','dunnes',null,null,'Flahavan''s Hi 8 No Added Sugar Muesli 1kg');
    insert into price_observations(store_product_id) select '${D}' from generate_series(1,84);
    insert into scrape_product_receipts(store_product_id) select '${D}' from generate_series(1,10);
  `);
  return pg;
}
const count = async (pg: PGlite, sql: string) => Number(((await pg.query<{ n: string }>(sql)).rows[0]).n);

describe('generated Dunnes/SuperValu re-point SQL', () => {
  it('a plan without identityVerifiedBy is HELD and changes nothing', async () => {
    const { apply } = generate('held', [op({ identityVerifiedBy: undefined })]);
    expect(apply).toMatch(/HELD: identity_not_established/);
    const pg = await db();
    await expect(pg.exec(apply)).rejects.toThrow(/HELD/);
    await pg.exec('rollback').catch(() => undefined);
    expect(await count(pg, `select count(*) n from store_products where id='${D}' and product_id='${LF}'`)).toBe(1);
  }, PGLITE_TIMEOUT);
  it('apply moves the offer, retires only the empty placeholder, and keeps 84 price rows + 10 receipts attached', async () => {
    const { apply } = generate('ok', [op()]);
    const pg = await db();
    await pg.exec(apply);
    expect(await count(pg, `select count(*) n from store_products where id='${D}' and product_id='${FL}'`)).toBe(1);
    expect(await count(pg, `select count(*) n from store_products where id='${PH}'`)).toBe(0);
    expect(await count(pg, `select count(*) n from price_observations where store_product_id='${D}'`)).toBe(84);
    expect(await count(pg, `select count(*) n from scrape_product_receipts where store_product_id='${D}'`)).toBe(10);
    // no 1kg/750g merge and no duplicate ownership in the final state
    expect(await count(pg, `select count(*) n from store_products where product_id='${FL}' and store='dunnes' and store_sku is not null`)).toBe(1);
    expect(await count(pg, `select count(*) n from store_products where store='dunnes' and store_sku='100673561'`)).toBe(1);
  }, PGLITE_TIMEOUT);
  it('dry run rolls everything back', async () => {
    const { dry } = generate('dry', [op()]);
    const pg = await db();
    await pg.exec(dry);
    expect(await count(pg, `select count(*) n from store_products where id='${D}' and product_id='${LF}'`)).toBe(1);
    expect(await count(pg, `select count(*) n from store_products where id='${PH}'`)).toBe(1);
  }, PGLITE_TIMEOUT);
  it('aborts if the reviewed row drifted, the placeholder has history, or the SKU is owned twice', async () => {
    const { apply } = generate('guards', [op()]);
    const cases: [string, string, RegExp][] = [
      [`update store_products set store_product_name='changed' where id='${D}'`, 'drift', /repair_snapshot_changed/],
      [`insert into price_observations(store_product_id) values ('${PH}')`, 'placeholder history', /placeholder_has_dependents/],
      [`insert into store_products values ('99999999-9999-9999-9999-999999999999','${LF}','dunnes','100673561',null,'dup')`, 'dup owner', /duplicate_sku_ownership/],
    ];
    for (const [mutation, , expected] of cases) {
      const pg = await db();
      await pg.exec(mutation);
      await expect(pg.exec(apply)).rejects.toThrow(expected);
      await pg.exec('rollback').catch(() => undefined);
      expect(await count(pg, `select count(*) n from price_observations where store_product_id='${D}'`)).toBe(84);
      await pg.close();
    }
  }, PGLITE_TIMEOUT);
});
