'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

const stores = [
  { name: 'Tesco', logo: '/images/stores/tesco.svg', width: 100 },
  { name: 'Dunnes', logo: '/images/stores/dunnes.svg', width: 120 },
  { name: 'SuperValu', logo: '/images/stores/supervalu.svg', width: 130 },
  { name: 'Aldi', logo: '/images/stores/aldi.svg', width: 80 },
];

export function StoreLogosBar() {
  return (
    <section className="py-10 px-6" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-6xl mx-auto">
        <p className="type-label text-center mb-6 text-on-surface-variant">
          Prices from Ireland&apos;s biggest supermarkets
        </p>
        <motion.div
          className="flex flex-wrap justify-center items-center gap-8 md:gap-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {stores.map((store, index) => (
            <motion.div
              key={store.name}
              className="opacity-60 hover:opacity-100 transition-opacity duration-200"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 0.6, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.08 }}
              whileHover={{ opacity: 1 }}
            >
              <Image
                src={store.logo}
                alt={store.name}
                width={store.width}
                height={40}
                className="h-8 md:h-10 w-auto"
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
