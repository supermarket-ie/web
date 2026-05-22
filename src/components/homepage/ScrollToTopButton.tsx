'use client';

import { Sparkles } from 'lucide-react';

export function ScrollToTopButton() {
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="btn-primary w-full px-6 py-4 text-lg font-bold gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform"
    >
      <Sparkles className="size-5" />
      Start chatting with your agent
    </button>
  );
}
