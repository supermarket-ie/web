import type { ReactNode } from 'react';

/** Shared receipt surface for the proposed guest shop and saved household shop. */
export function ShopReceiptFrame({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return <aside id={id} aria-label="Your shop" className={`overflow-hidden rounded-[1.75rem] border border-[#d9dfda] bg-[#fffefa] shadow-[0_24px_70px_rgba(42,53,45,0.10)] ${className}`}>{children}</aside>;
}
