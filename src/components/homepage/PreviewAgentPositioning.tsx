'use client';

import { useEffect } from 'react';

export function PreviewAgentPositioning() {
  useEffect(() => {
    const root = document.getElementById('grocery-agent');
    if (!root) return;

    const heading = root.querySelector('h2');
    if (heading) heading.textContent = 'Meet your supermarket agent';

    const paragraph = heading?.nextElementSibling;
    if (paragraph) {
      paragraph.textContent = 'Ask about products, prices, meals, dietary needs or your household shop. Supermarket.ie uses thousands of tracked Irish supermarket prices and ingredient mappings to help.';
    }

    const textarea = root.querySelector('textarea');
    if (textarea) textarea.setAttribute('placeholder', 'Ask Supermarket.ie anything about your shop…');
  }, []);

  return null;
}
