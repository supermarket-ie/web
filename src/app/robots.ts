import { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://supermarket.ie';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Allow all crawlers (including AI/LLM crawlers) full access to public content
        userAgent: '*',
        allow: ['/', '/api/products', '/list/request'],
        disallow: ['/list', '/api/auth/', '/api/subscribe', '/api/unsubscribe', '/api/webhooks/'],
      },
      // Explicitly welcome AI crawlers to the products data endpoint
      {
        userAgent: 'GPTBot',
        allow: ['/', '/api/products'],
      },
      {
        userAgent: 'ChatGPT-User',
        allow: ['/', '/api/products'],
      },
      {
        userAgent: 'Claude-Web',
        allow: ['/', '/api/products'],
      },
      {
        userAgent: 'PerplexityBot',
        allow: ['/', '/api/products'],
      },
      {
        userAgent: 'anthropic-ai',
        allow: ['/', '/api/products'],
      },
      {
        userAgent: 'CCBot',
        allow: ['/', '/api/products'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
