'use client';

// Header is now rendered by AppShell in the root layout.
// This component is kept to avoid breaking imports across many pages
// but renders nothing — AppShell owns the header chrome.
export function SiteHeader() {
  return null;
}
