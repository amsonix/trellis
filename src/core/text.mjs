const WIDE = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd]
];

function isWide(code) {
  return WIDE.some(([start, end]) => code >= start && code <= end);
}

function isZero(code) {
  return code === 0x200d || code === 0xfe0f || (code >= 0x0300 && code <= 0x036f);
}

export function displayWidth(value) {
  let width = 0;
  for (const character of String(value ?? '')) {
    const code = character.codePointAt(0);
    if (character === '\n' || character === '\r' || character === '\t') continue;
    if (isZero(code)) continue;
    if (code < 0x20) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

export function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function clipDisplay(value, width) {
  if (width <= 0) return '';
  if (displayWidth(value) <= width) return value;
  let out = '';
  let used = 0;
  for (const character of String(value)) {
    const size = displayWidth(character);
    if (used + size > width - 1) break;
    out += character;
    used += size;
  }
  return `${out}…`;
}

export function padDisplay(value, width) {
  const clipped = clipDisplay(String(value ?? ''), width);
  return `${clipped}${' '.repeat(Math.max(0, width - displayWidth(clipped)))}`;
}

export function renderStatusPanel(data) {
  const lines = [];
  lines.push(`${stripMarkdown(data.project.name)} (${data.project.profile})`);
  const gates = Object.values(data.gates ?? {});
  const passed = gates.filter((gate) => gate.status === 'passed' || gate.status === 'waived').length;
  lines.push(`stage: ${data.stage}   gates: ${passed}/${gates.length} passed`);
  const tasks = data.tasks ?? {};
  lines.push(
    `tasks: done ${tasks.done}  canceled ${tasks.canceled}  in_progress ${tasks.in_progress}  ` +
      `pending ${tasks.pending}  todo ${tasks.todo}  ready ${tasks.ready}  blocked ${tasks.blocked}  review ${tasks.review}`
  );
  const summary = data.checks?.summary ?? {};
  lines.push(`checks: ${summary.pass} pass  ${summary.warn} warn  ${summary.fail} fail  ${summary.unavailable} unavailable`);
  const leases = data.leases ?? [];
  const oldest = leases
    .map((lease) => Math.max(0, Math.floor((Date.now() - Date.parse(lease.createdAt)) / 60000)))
    .reduce((max, value) => Math.max(max, value), 0);
  lines.push(`leases: ${leases.length} held${leases.length > 0 ? `  (oldest ${oldest}m)` : ''}`);

  const attention = data.attention ?? [];
  for (const item of attention.slice(0, 3)) {
    lines.push(`attention: [${item.code}] ${stripMarkdown(item.message)}`);
  }
  if (attention.length > 3) lines.push(`attention: +${attention.length - 3} more`);

  const next = data.next ?? {};
  if (next.kind === 'gate') lines.push(`next: gate ${next.gate?.id ?? ''} ${next.gate?.title ?? ''}`.trim());
  else if (next.kind === 'tasks') {
    const first = next.tasks?.[0];
    lines.push(first ? `next: ${first.id} ${stripMarkdown(first.title)} (${first.role})` : 'next: tasks');
  } else lines.push(`next: waiting${next.reason ? ` (${stripMarkdown(next.reason)})` : ''}`);

  const width = Math.min(100, Math.max(48, ...lines.map((line) => displayWidth(line))));
  const top = `┌${'─'.repeat(width + 2)}┐`;
  const bottom = `└${'─'.repeat(width + 2)}┘`;
  const body = lines.map((line) => `│ ${padDisplay(line, width)} │`);
  return [top, ...body, bottom].join('\n');
}
