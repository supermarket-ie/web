import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAgentLandingHandoff, takeAgentLandingHandoff } from '../agent-landing-handoff';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('private landing handoff', () => {
  it('consumes a household request once without using query-string content', () => {
    saveAgentLandingHandoff('Shop for two adults under €120', '/cost-of-weekly-shop-ireland');
    expect(takeAgentLandingHandoff()).toMatchObject({ prompt: 'Shop for two adults under €120', landingPath: '/cost-of-weekly-shop-ireland' });
    expect(takeAgentLandingHandoff()).toBeNull();
  });
  it('discards expired and corrupt drafts', () => {
    saveAgentLandingHandoff('Old request', '/cost-of-weekly-shop-ireland');
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(takeAgentLandingHandoff()).toBeNull();
    sessionStorage.setItem('smi_agent_landing_handoff_v1', '{broken');
    expect(takeAgentLandingHandoff()).toBeNull();
  });
});
