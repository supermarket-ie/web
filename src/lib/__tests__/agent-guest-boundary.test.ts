import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const instructions = readFileSync(resolve(process.cwd(), 'agent/instructions.md'), 'utf8');

describe('Eve guest household-tool boundary', () => {
  it('treats the tools exposed on the current turn as authoritative', () => {
    expect(instructions).toContain('The tools exposed on the current turn are the complete capability set for that user');
    expect(instructions).toContain('Never use `load_skill`');
  });

  it('does not let a guest usual-shop request fall through to a protected tool lookup', () => {
    expect(instructions).toContain('For a homepage guest asking for their usual, normal or household shop');
    expect(instructions).toContain('do not try to call or discover `prepare_usual_shop`');
  });

  it('only directs the agent to prepare_usual_shop when that tool is actually exposed', () => {
    expect(instructions).toContain('If `prepare_usual_shop` is exposed on the current turn');
  });
});
