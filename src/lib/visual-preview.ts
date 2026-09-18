export function isSignedInVisualPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname.startsWith('web-')
    && hostname.endsWith('-supermarket-ie.vercel.app')
    && new URLSearchParams(window.location.search).get('ui_preview') === 'signed-in';
}
