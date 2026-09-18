export const SIGNED_IN_VISUAL_PREVIEW = 'signed-in';

export function isSignedInVisualPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname.toLowerCase();
  const isSupermarketPreview = hostname.startsWith('web-')
    && hostname.endsWith('-supermarket-ie.vercel.app');
  return isSupermarketPreview
    && new URLSearchParams(window.location.search).get('ui_preview') === SIGNED_IN_VISUAL_PREVIEW;
}
