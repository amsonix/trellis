import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(root, args) {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

export async function headCommit(root) {
  try {
    return await git(root, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

export async function gitInfo(root) {
  try {
    const [commit, status, top] = await Promise.all([
      git(root, ['rev-parse', 'HEAD']),
      git(root, ['status', '--porcelain']),
      git(root, ['rev-parse', '--show-toplevel'])
    ]);
    return { commit, dirty: status.length > 0, worktree: top };
  } catch {
    return { commit: null, dirty: null, worktree: null };
  }
}
