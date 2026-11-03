function parseValue(raw) {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, '');
}

export function parseFrontMatter(text) {
  const source = String(text ?? '');
  if (!source.startsWith('---')) {
    return { data: {}, body: source, error: 'missing' };
  }
  const lines = source.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { data: {}, body: source, error: 'missing' };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return { data: {}, body: source, error: 'unterminated' };
  }
  const data = {};
  for (const line of lines.slice(1, close)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf(':');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1);
    if (!key) continue;
    data[key] = parseValue(value);
  }
  return {
    data,
    body: lines.slice(close + 1).join('\n'),
    error: null
  };
}
