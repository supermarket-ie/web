// Shopper-facing cleanup for assistant text before it is rendered as Markdown.
// Rendering itself is handled by react-markdown + remark-gfm in the UI; this
// module only softens internal wording that should not surface to shoppers.

export function shopperFacingAgentText(text: string) {
  return text.replace(
    /Still unresolved this turn\s*\([^)]*(?:catalogue|lookup)[^)]*\)\s*:/gi,
    'Still to check:',
  );
}
