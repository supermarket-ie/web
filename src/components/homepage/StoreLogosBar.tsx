'use client';

import { motion } from 'framer-motion';

const stores = [
  { name: 'Tesco', color: '#003A8C' },
  { name: 'Dunnes', color: '#7B0017' },
  { name: 'SuperValu', color: '#D4400F' },
  { name: 'Aldi', color: '#00616A' },
];

export function StoreLogosBar() {
  return (
    <section className="py-10 px-6" style={{ background: 'var(--surface-container-low)' }}>
      <div className="max-w-6xl mx-auto">
        <p className="type-label text-center mb-6 text-on-surface-variant">
          Prices from Ireland&apos;s biggest supermarkets
        </p>
        <motion.div
          className="flex flex-wrap justify-center items-center gap-4"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          {stores.map((store, index) => (
            <motion.div
              key={store.name}
              className="px-6 py-2.5 rounded-full font-bold text-sm text-white"
              style={{
                background: store.color,
                boxShadow: `0 4px 12px ${store.color}40`,
              }}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.08 }}
              whileHover={{ scale: 1.05 }}
            >
              {store.name}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
