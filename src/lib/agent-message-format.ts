export type AgentMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function tableCells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

export function shopperFacingAgentText(text: string) {
  return text.replace(
    /Still unresolved this turn\s*\([^)]*(?:catalogue|lookup)[^)]*\)\s*:/gi,
    'Still to check:',
  );
}

export function agentMessageBlocks(text: string): AgentMessageBlock[] {
  const lines = shopperFacingAgentText(text).split('\n');
  const blocks: AgentMessageBlock[] = [];
  let textLines: string[] = [];

  const flushText = () => {
    if (textLines.length === 0) return;
    blocks.push({ type: 'text', text: textLines.join('\n') });
    textLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const separator = lines[index + 1];
    if (!header.includes('|') || !separator || !TABLE_SEPARATOR.test(separator)) {
      textLines.push(header);
      continue;
    }

    flushText();
    const headers = tableCells(header);
    const rows: string[][] = [];
    index += 1;
    while (lines[index + 1]?.includes('|')) {
      rows.push(tableCells(lines[index + 1]));
      index += 1;
    }
    blocks.push({ type: 'table', headers, rows });
  }

  flushText();
  return blocks;
}
