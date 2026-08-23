import 'server-only';
import { createSign } from 'node:crypto';

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type AnalyticsReportRequest = {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  dimensions?: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  limit?: number;
  orderBys?: Array<{
    desc?: boolean;
    dimension?: { dimensionName: string };
    metric?: { metricName: string };
  }>;
};

type AnalyticsReport = {
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type?: string }>;
  rows?: Array<{
    dimensionValues?: Array<{ value: string }>;
    metricValues?: Array<{ value: string }>;
  }>;
  rowCount?: number;
};

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function credentials(): ServiceAccountCredentials {
  const raw = process.env.GOOGLE_ANALYTICS_CREDENTIALS_JSON;
  if (!raw) throw new Error('GOOGLE_ANALYTICS_CREDENTIALS_JSON is not configured');

  let parsed: Partial<ServiceAccountCredentials>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
  } catch {
    throw new Error('Google Analytics credentials are not valid JSON');
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Google Analytics credentials are incomplete');
  }
  return parsed as ServiceAccountCredentials;
}

async function accessToken(): Promise<string> {
  const account = credentials();
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
  const header = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = encode(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });
  const body = await response.json() as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`Google authentication failed: ${body.error_description ?? body.error ?? response.status}`);
  }
  return body.access_token;
}

export async function runGoogleAnalyticsReport(request: AnalyticsReportRequest): Promise<AnalyticsReport> {
  const propertyId = process.env.GOOGLE_ANALYTICS_PROPERTY_ID?.trim();
  if (!propertyId || !/^\d+$/.test(propertyId)) {
    throw new Error('GOOGLE_ANALYTICS_PROPERTY_ID is not configured correctly');
  }
  const token = await accessToken();
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
    },
  );
  const body = await response.json() as AnalyticsReport & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(`Google Analytics report failed: ${body.error?.message ?? response.status}`);
  }
  return body;
}
