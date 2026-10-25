import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { isNoIndexEnv } from "./src/lib/runtime-env";

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// Block indexing on staging AND on any preview/development deployment
// (e.g. the AWS-generated preview URL), via the platform-neutral helper.
const BLOCK_INDEXING = isNoIndexEnv();

const nextConfig: NextConfig = {
  async redirects() {
    // Keep the unexpected /contact landing traffic measurable while the
    // contact form moves to a distinct URL. This is reversible after review.
    return [{ source: '/contact', destination: '/?entry=contact', permanent: false }];
  },
  async headers() {
    const headers = [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];

    // Block indexing on staging/preview/development
    if (BLOCK_INDEXING) {
      headers.push({
        source: '/(.*)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      });
    }

    return headers;
  },
};

// Eve mounts the durable shopping agent at /eve/v1/* while preserving the
// existing Next.js application and Vercel project as a single deployment.
export default withEve(nextConfig);
