import Image from 'next/image';

const stores = [
  { name: 'Tesco', logo: '/images/stores/tesco-grey.png', width: 394, height: 113 },
  { name: 'Dunnes Stores', logo: '/images/stores/dunnes-grey.png', width: 352, height: 89 },
  { name: 'SuperValu', logo: '/images/stores/supervalu-grey.png', width: 495, height: 141 },
  { name: 'Aldi', logo: '/images/stores/aldi-grey.png', width: 136, height: 160 },
];

export function StoreLogosBar() {
  return (
    <section className="py-10 px-6" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-6xl mx-auto">
        <p className="type-label text-center mb-6 text-on-surface-variant">
          Your agent understands pricing across
        </p>
        <div className="flex flex-wrap justify-center items-center gap-8 md:gap-12">
          {stores.map((store) => (
            <div key={store.name} className="opacity-50">
              <Image
                src={store.logo}
                alt={store.name}
                width={store.width}
                height={store.height}
                className="h-6 md:h-8 w-auto"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
