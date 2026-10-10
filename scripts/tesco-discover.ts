import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { discover, digest, type DiscoveryState } from '../src/lib/tesco-discovery';

// Offline only. Caller supplies a read-only export and a durable output directory.
const args = process.argv.slice(2);
if (args.length !== 4 && args.length !== 6) throw new Error('Usage: --input SNAPSHOT.json --out DIRECTORY [--previous REPORT.json]');
if (args[0] !== '--input' || args[2] !== '--out' || (args.length === 6 && args[4] !== '--previous')) throw new Error('Unknown argument');
const input = JSON.parse(fs.readFileSync(args[1], 'utf8'));
const previous = args[5] ? JSON.parse(fs.readFileSync(args[5], 'utf8')) as DiscoveryState : undefined;
if (previous && (!Array.isArray(previous.decisions) || typeof previous.version !== 'string')) throw new Error('Invalid previous state');
const report = discover(input, previous);
fs.mkdirSync(args[3], { recursive: true });
const destination = path.join(args[3], `tesco-discovery-${digest(report)}.json`);
if (!fs.existsSync(destination)) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(report, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, destination);
  const directory = fs.openSync(args[3], 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
console.log(JSON.stringify({ report: destination, evaluated: report.evaluated, reused: report.reused,
  counts: report.counts, newlyReady: report.newlyReady.length }));
