import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState } from '../src/state.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = resolve(root, '.state');
const branch = 'refs/heads/quota-state';
const git = (args, input, trim = true) => {
  const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'quota-weather[bot]', GIT_AUTHOR_EMAIL: 'quota-weather[bot]@users.noreply.github.com', GIT_COMMITTER_NAME: 'quota-weather[bot]', GIT_COMMITTER_EMAIL: 'quota-weather[bot]@users.noreply.github.com' } });
  return trim ? output.trim() : output;
};
await mkdir(stateDir, { recursive: true });
try {
  if (process.argv[2] === 'restore') {
    const remote = git(['ls-remote', '--heads', 'origin', branch]);
    if (!remote) { await writeFile(resolve(stateDir, 'state.json'), JSON.stringify(emptyState())); await writeFile(resolve(stateDir, 'parent'), ''); console.log('状态分支尚不存在，将在首次成功保存时建立。'); }
    else {
      const parent = remote.split(/\s/)[0]; if (!/^[0-9a-f]{40}$/.test(parent)) throw new Error('远程检查点格式异常');
      git(['fetch', '--depth=1', 'origin', branch]);
      const json = git(['show', 'FETCH_HEAD:state.json'], undefined, false); const state = JSON.parse(json);
      if (state.schemaVersion !== 1 || !Array.isArray(state.posts)) throw new Error('远程状态版本不匹配');
      // Use the fetched commit, not a potentially stale ls-remote result.
      await writeFile(resolve(stateDir, 'state.json'), json); await writeFile(resolve(stateDir, 'parent'), git(['rev-parse', 'FETCH_HEAD']));
      console.log('已恢复持久检查点。');
    }
  } else if (process.argv[2] === 'save') {
    const data = await readFile(resolve(stateDir, 'state.json'), 'utf8'); JSON.parse(data);
    const parent = (await readFile(resolve(stateDir, 'parent'), 'utf8')).trim();
    if (parent && !/^[0-9a-f]{40}$/.test(parent)) throw new Error('父提交格式异常');
    const blob = git(['hash-object', '-w', '--stdin'], data);
    const tree = git(['mktree'], `100644 blob ${blob}\tstate.json\n`);
    if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) console.log('状态无变化，不产生新提交。');
    else {
      const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : [])], 'Update quota-weather public state\n');
      git(['push', 'origin', `${commit}:${branch}`]); console.log('已保存状态分支；未修改源码分支。');
    }
  } else throw new Error('用法：node scripts/ci-state.mjs restore|save');
} catch (error) { console.error('状态分支操作失败：', error.message.split('\n')[0]); process.exitCode = 1; }
