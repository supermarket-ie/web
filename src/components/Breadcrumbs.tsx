import Link from 'next/link';
import { breadcrumbJsonLd } from '@/lib/structured-data';

export interface BreadcrumbItem {
  label: string;
  href: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/**
 * Shared breadcrumb component — renders visual breadcrumbs and inline BreadcrumbList JSON-LD.
 * Pass items WITHOUT Home (Home is always prepended automatically).
 */
export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const all = [{ label: 'Home', href: '/' }, ...items];

  return (
    <>
      <nav aria-label="Breadcrumb" className="pt-6 pb-2 text-xs text-[#B2BEC3]">
        {all.map((item, i) => (
          <span key={item.href}>
            {i > 0 && <span className="mx-1">·</span>}
            {i < all.length - 1 ? (
              <Link href={item.href} className="hover:text-[#5c5b5b] transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className="text-[#5c5b5b] line-clamp-1">{item.label}</span>
            )}
          </span>
        ))}
      </nav>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(items)) }}
      />
    </>
  );
}
