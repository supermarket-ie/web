import Image from 'next/image';
import { Activity } from 'lucide-react';

const stores = [
  { name: 'Tesco', logo: '/images/stores/tesco-grey.png', width: 394, height: 113 },
  { name: 'Dunnes Stores', logo: '/images/stores/dunnes-grey.png', width: 352, height: 89 },
  { name: 'SuperValu', logo: '/images/stores/supervalu-grey.png', width: 495, height: 141 },
  { name: 'Aldi', logo: '/images/stores/aldi-grey.png', width: 136, height: 160 },
];

export function StoreLogosBar() {
  return (
    <section className="border-y border-black/[0.04] bg-surface-low px-6 py-8">
      <div className="mx-auto grid max-w-7xl items-center gap-7 lg:grid-cols-[auto_1fr_auto]">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.09em] text-on-surface">
            One agent. Ireland&apos;s supermarkets.
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">Your agent understands what&apos;s available across the stores you know</p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-7 md:gap-10">
          {stores.map((store) => (
            <div key={store.name} className="opacity-55 grayscale transition-all duration-200 hover:opacity-90 hover:grayscale-0">
              <Image
                src={store.logo}
                alt={store.name}
                width={store.width}
                height={store.height}
                className="h-6 w-auto md:h-7"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-full bg-surface-lowest px-3 py-2 text-xs font-bold text-primary shadow-sm">
          <Activity className="size-3.5" />
          Your agent is watching
        </div>
      </div>
    </section>
  );
}
