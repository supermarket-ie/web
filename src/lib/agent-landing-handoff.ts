const KEY = 'smi_agent_landing_handoff_v1';
const MAX_AGE_MS = 30 * 60 * 1000;

type LandingHandoff = { prompt: string; landingPath: string; createdAt: number };

// Keep household details out of URLs, referrer headers and page-view analytics.
export function saveAgentLandingHandoff(prompt: string, landingPath: string) {
  sessionStorage.setItem(KEY, JSON.stringify({ prompt, landingPath, createdAt: Date.now() }));
}

export function takeAgentLandingHandoff(): LandingHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LandingHandoff>;
    if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 12000 ||
        typeof value.landingPath !== 'string' || !value.landingPath.startsWith('/') || value.landingPath.startsWith('//') ||
        typeof value.createdAt !== 'number' || value.createdAt > Date.now() || Date.now() - value.createdAt > MAX_AGE_MS) return null;
    return value as LandingHandoff;
  } catch {
    return null;
  }
}
