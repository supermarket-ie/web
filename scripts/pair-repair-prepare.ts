// OFFLINE CLI around src/lib/pair-repair-sql.ts. No database access, no writes beyond the two SQL files.
// Usage: tsx scripts/pair-repair-prepare.ts <plan.json> <outPrefix>
import { readFileSync, writeFileSync } from 'node:fs';
import { repairSql, type RepairPlan } from '../src/lib/pair-repair-sql';

const [planPath, prefix] = process.argv.slice(2);
if (!planPath || !prefix) throw new Error('usage: <plan.json> <outPrefix>');
const plan = JSON.parse(readFileSync(planPath, 'utf8')) as RepairPlan;
writeFileSync(`${prefix}-dry-run.sql`, repairSql(plan, false));
writeFileSync(`${prefix}-apply.sql`, repairSql(plan, true));
console.log(JSON.stringify({ plan: plan.id, ops: plan.ops.length, held: plan.ops.filter(o => !o.identityVerifiedBy).length, files: [`${prefix}-dry-run.sql`, `${prefix}-apply.sql`] }));
