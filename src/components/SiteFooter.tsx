'use client';

// Footer is now rendered by AppShell in the root layout.
// This component is kept to avoid breaking imports across many pages
// but renders nothing — AppShell owns the footer chrome.
export function SiteFooter() {
  return null;
}
