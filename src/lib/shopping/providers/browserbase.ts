import 'server-only';

import { chromium, type Page } from 'playwright';
import type {
  CheckoutRuntimePlan,
  CheckoutRuntimeProvider,
  CheckoutRuntimeState,
} from '../checkout-runtime';

const API_BASE = 'https://api.browserbase.com/v1';
const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
const ALLOWED_RETAILERS = new Set(['supervalu']);

type BrowserbaseSession = {
  id: string;
  expiresAt: string;
  status: 'PENDING' | 'RUNNING' | 'ERROR' | 'TIMED_OUT' | 'COMPLETED';
  connectUrl: string;
};

type BrowserbaseDebugLinks = {
  debuggerFullscreenUrl: string;
  wsUrl: string;
};

export type BrowserbaseProviderConfig = {
  apiKey: string;
  timeoutSeconds?: number;
};

export type PageConnector = <T>(wsUrl: string, action: (page: Page) => Promise<T>) => Promise<T>;

const defaultPageConnector: PageConnector = async (wsUrl, action) => {
  const browser = await chromium.connectOverCDP(wsUrl);
  try {
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.newPage();
    return await action(page);
  } finally {
    await browser.close();
  }
};

export function getBrowserbaseProviderConfig(): BrowserbaseProviderConfig | null {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey };
}

export class BrowserbaseCheckoutRuntimeProvider implements CheckoutRuntimeProvider {
  constructor(
    private readonly config: BrowserbaseProviderConfig,
    private readonly request: typeof fetch = fetch,
    private readonly connectPage: PageConnector = defaultPageConnector,
  ) {}

  async createSession(plan: CheckoutRuntimePlan) {
    if (!plan.launchEnabled || !ALLOWED_RETAILERS.has(plan.retailer)) {
      throw new Error('Checkout runtime launch is not allowed for this retailer.');
    }

    const session = await this.api<BrowserbaseSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        region: 'eu-central-1',
        keepAlive: true,
        timeout: this.config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        browserSettings: {
          recordSession: false,
          logSession: false,
        },
        userMetadata: {
          application: 'supermarket.ie',
          purpose: 'retailer-checkout-runtime',
          retailer: plan.retailer,
        },
      }),
    });

    try {
      const links = await this.getDebugLinks(session.id);
      await this.connectPage(session.connectUrl, async page => {
        await page.goto(plan.items[0].retailerUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      });
      return {
        sessionId: session.id,
        shopperUrl: links.debuggerFullscreenUrl,
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      await this.destroySession(session.id).catch(() => undefined);
      throw error;
    }
  }

  async getState(sessionId: string): Promise<CheckoutRuntimeState> {
    const session = await this.api<BrowserbaseSession>(`/sessions/${encodeURIComponent(sessionId)}`);
    switch (session.status) {
      case 'ERROR': return 'failed';
      case 'TIMED_OUT': return 'expired';
      case 'COMPLETED': return 'expired';
      default: return 'awaiting_shopper_auth';
    }
  }

  async getShopperUrl(sessionId: string): Promise<string> {
    return (await this.getDebugLinks(sessionId)).debuggerFullscreenUrl;
  }

  async destroySession(sessionId: string): Promise<void> {
    await this.api(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
    });
  }

  async withPage<T>(sessionId: string, action: (page: Page) => Promise<T>): Promise<T> {
    const session = await this.api<BrowserbaseSession>(`/sessions/${encodeURIComponent(sessionId)}`);
    return this.connectPage(session.connectUrl, action);
  }

  private getDebugLinks(sessionId: string): Promise<BrowserbaseDebugLinks> {
    return this.api(`/sessions/${encodeURIComponent(sessionId)}/debug`);
  }

  private async api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'X-BB-API-Key': this.config.apiKey,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Browserbase request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }
}

export function createConfiguredBrowserbaseProvider(): BrowserbaseCheckoutRuntimeProvider | null {
  const config = getBrowserbaseProviderConfig();
  return config ? new BrowserbaseCheckoutRuntimeProvider(config) : null;
}
