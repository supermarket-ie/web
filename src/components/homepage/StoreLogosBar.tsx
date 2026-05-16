'use client';

import { motion } from 'framer-motion';

const stores = [
  { name: 'Tesco', color: 'var(--store-tesco)' },
  { name: 'Dunnes', color: 'var(--store-dunnes)' },
  { name: 'SuperValu', color: 'var(--store-supervalu)' },
];

export function StoreLogosBar() {
  return (
    <section className="py-8 px-6 bg-surface-low">
      <div className="max-w-6xl mx-auto">
        <p className="type-label text-center mb-4 text-on-surface">
          Prices from Ireland&apos;s biggest supermarkets
        </p>
        <motion.div
          className="flex flex-wrap justify-center items-center gap-8 md:gap-16"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {stores.map((store, index) => (
            <motion.span
              key={store.name}
              className="text-xl font-bold"
              style={{ color: store.color }}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
            >
              {store.name}
            </motion.span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
