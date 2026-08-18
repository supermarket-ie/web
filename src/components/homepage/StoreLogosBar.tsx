import Image from 'next/image';

const stores = [
  { name: 'Tesco', logo: '/images/stores/tesco-grey.png', width: 394, height: 113 },
  { name: 'Dunnes Stores', logo: '/images/stores/dunnes-grey.png', width: 352, height: 89 },
  { name: 'SuperValu', logo: '/images/stores/supervalu-grey.png', width: 495, height: 141 },
  { name: 'Aldi', logo: '/images/stores/aldi-grey.png', width: 136, height: 160 },
];

export function StoreLogosBar() {
  return (
    <section className="bg-surface-low px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <p className="mb-6 text-center text-xs font-extrabold uppercase tracking-[0.09em] text-on-surface-variant">
          Your agent understands Ireland&apos;s supermarkets
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
          {stores.map((store) => (
            <div key={store.name} className="opacity-50 grayscale">
              <Image
                src={store.logo}
                alt={store.name}
                width={store.width}
                height={store.height}
                className="h-6 w-auto md:h-8"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
