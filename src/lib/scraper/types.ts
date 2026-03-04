export type Retailer = 'tesco' | 'dunnes' | 'supervalu' | 'lidl' | 'aldi';

export const RETAILERS: Retailer[] = ['tesco', 'dunnes', 'supervalu', 'lidl', 'aldi'];

export type ErrorCode = 'BLOCKED' | 'TIMEOUT' | 'PARSE_FAIL' | 'NOT_FOUND' | 'HTTP_ERROR' | 'UNKNOWN';

export interface ScrapeResult {
  product_name?: string;
  brand?: string;
  size?: string;
  image_url?: string;
  currency: 'EUR';
  price?: number;
  was_price?: number;
  promo_text?: string;
  price_per_unit?: number;
  unit?: string;
  is_available?: boolean;
  raw?: unknown;
  parse_version: string;
}

export interface ScrapeContext {
  fetch: typeof globalThis.fetch;
  timeoutMs: number;
}

export interface RetailerConfig {
  batchSize: number;
  concurrency: number;
  maxAttempts: number;
  delayMinMs: number;
  delayMaxMs: number;
}

export const RETAILER_CONFIGS: Record<Retailer, RetailerConfig> = {
  tesco:     { batchSize: 50, concurrency: 3, maxAttempts: 3, delayMinMs: 200, delayMaxMs: 800 },
  dunnes:    { batchSize: 30, concurrency: 2, maxAttempts: 3, delayMinMs: 300, delayMaxMs: 1000 },
  supervalu: { batchSize: 40, concurrency: 3, maxAttempts: 3, delayMinMs: 200, delayMaxMs: 700 },
  lidl:      { batchSize: 50, concurrency: 3, maxAttempts: 3, delayMinMs: 100, delayMaxMs: 600 },
  aldi:      { batchSize: 50, concurrency: 3, maxAttempts: 3, delayMinMs: 100, delayMaxMs: 600 },
};

export class ScrapeError extends Error {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode,
    public readonly httpStatus?: number,
    public readonly attempts: number = 1,
  ) {
    super(message);
    this.name = 'ScrapeError';
  }
}
