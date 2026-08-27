'use client';

import { useEffect } from 'react';

export function AgentCopyUpdate() {
  useEffect(() => {
    const apply = () => {
      const root = document.getElementById('grocery-agent');
      if (!root) return;
      const heading = Array.from(root.querySelectorAll('h2')).find(el => el.textContent?.trim() === 'What do you need for the household?');
      if (heading) heading.textContent = 'Meet your supermarket agent';
      const textarea = root.querySelector('textarea');
      if (textarea && !textarea.disabled) textarea.setAttribute('placeholder', 'Ask about products, prices, meals, dietary needs or your household shop.');
    };
    apply();
    const observer = new MutationObserver(apply);
    const root = document.getElementById('grocery-agent');
    if (root) observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
