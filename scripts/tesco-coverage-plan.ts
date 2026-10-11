import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { planTescoCoverage } from '../src/lib/tesco-coverage-plan';
import { digest } from '../src/lib/tesco-discovery';
const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== '--input' || args[2] !== '--operations' || args[4] !== '--out')
  throw new Error('Usage: --input SNAPSHOT.json --operations OPERATIONS.json --out DIRECTORY');
const input = JSON.parse(fs.readFileSync(args[1], 'utf8')), operations = JSON.parse(fs.readFileSync(args[3], 'utf8'));
const result = planTescoCoverage(input, operations);
fs.mkdirSync(args[5], { recursive: true });
const destination = path.join(args[5], `tesco-coverage-plan-${digest(result)}.json`);
const temporary = `${destination}.${randomUUID()}.tmp`;
const fd = fs.openSync(temporary, 'wx', 0o600);
try { fs.writeFileSync(fd, JSON.stringify(result, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fs.renameSync(temporary, destination);
const directory = fs.openSync(args[5], 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
console.log(JSON.stringify({ path: destination, counts: result.counts, metrics: result.metrics }));
