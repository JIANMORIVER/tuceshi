import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Shared local processor adapter. The production wrapper keeps automatic publication disabled. */
export async function prepareBackgroundRemovalReview({ sourcePath, outputRoot = join(projectRoot, '.local/background-removal/jobs'), pythonExecutable = 'python', modelPath, jobId = randomUUID(), timeoutMs = 120_000 }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId)) throw new Error('Invalid background-removal jobId');
  const source = resolve(sourcePath);
  const before = createHash('sha256').update(await readFile(source)).digest('hex');
  const destination = join(resolve(outputRoot), jobId);
  await mkdir(destination, { recursive: true });
  const args = ['-B', '-m', 'tools.terrain_background_removal', '--input', source, '--output', destination];
  if (modelPath) args.push('--birefnet-model', resolve(modelPath));
  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(pythonExecutable, args, { cwd: projectRoot, shell: false, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const fail = error => { if (!settled) { settled = true; clearTimeout(timer); child.kill(); reject(error); } };
    const timer = setTimeout(() => fail(new Error('Offline background removal timed out; image was not published')), timeoutMs);
    child.on('error', fail);
    child.stdout.on('data', bytes => { stdout += bytes.toString('utf8'); if (stdout.length > 2_000_000) fail(new Error('Unexpected processor output size')); });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-4000); });
    child.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Offline processor failed (${code}): ${stderr}`));
      try { resolveOutput(JSON.parse(stdout)); } catch { reject(new Error('Offline processor returned invalid JSON')); }
    });
  });
  const after = createHash('sha256').update(await readFile(source)).digest('hex');
  if (before !== after || output.report.sourceSha256 !== before || output.report.publishAllowed !== false) throw new Error('Background-removal preservation/review contract violated');
  return { jobId, ...output, cutoutAvailable: output.report.method !== 'unprocessed', publishAllowed: false };
}
