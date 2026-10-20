// Runs each test file in its own vitest process and prints a total.
// Use this on low-memory machines, where a single `vitest run` of the whole suite can have a worker
// killed at startup (exit code 3221226505) and silently skip a file.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts')).sort();
let total = 0;
const failed = [];
for (const f of files) {
  const r = spawnSync('npx', ['vitest', 'run', `tests/${f}`], { encoding: 'utf8', shell: true });
  const out = `${r.stdout}${r.stderr}`;
  const passed = Number(/Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(out)?.[1] ?? 0);
  const ok = r.status === 0 && passed > 0;
  total += passed;
  if (!ok) failed.push(f);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}  (${passed} passed)`);
}
console.log(`\n${total} tests passed in ${files.length - failed.length}/${files.length} files`);
if (failed.length) {
  console.error(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
