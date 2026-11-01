import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createZip, parseZip } from './zip.mjs';
import { PROJECT_ROOT } from '../image-card/config.mjs';

export const ARCHIVE_SCHEMA_VERSION = 'experiment-run-v1';

export class ArchiveService {
  constructor({ storageRoot = join(PROJECT_ROOT, '.local/experiment-archive') } = {}) {
    this.storageRoot = resolve(storageRoot);
    this.runsDir = join(this.storageRoot, 'runs');
    this.casesDir = join(this.storageRoot, 'cases');
    this.assetsDir = join(this.storageRoot, 'assets');
    this.ready = this.init();
  }

  async init() {
    await mkdir(this.runsDir, { recursive: true, mode: 0o700 });
    await mkdir(this.casesDir, { recursive: true, mode: 0o700 });
    await mkdir(this.assetsDir, { recursive: true, mode: 0o700 });
  }

  async atomicWrite(filePath, data) {
    const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await writeFile(tmp, data);
    await rename(tmp, filePath);
  }

  async saveRun(runData) {
    await this.ready;
    if (!runData || typeof runData.experiment_id !== 'string') {
      throw new Error('无效的实验数据：缺少 experiment_id');
    }
    const id = runData.experiment_id;
    const path = join(this.runsDir, `${id}.json`);
    const record = {
      schema_version: ARCHIVE_SCHEMA_VERSION,
      updated_at: new Date().toISOString(),
      ...runData
    };
    await this.atomicWrite(path, JSON.stringify(record, null, 2));
    return record;
  }

  async getRun(id) {
    await this.ready;
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    const path = join(this.runsDir, `${safeId}.json`);
    try {
      const content = await readFile(path, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async listRuns(filters = {}) {
    await this.ready;
    let files = [];
    try {
      files = await readdir(this.runsDir);
    } catch {
      return [];
    }
    const list = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(join(this.runsDir, file), 'utf8');
        const item = JSON.parse(content);
        if (filters.mode && item.experiment_mode !== filters.mode) continue;
        if (filters.style_id && item.style_package?.style_id !== filters.style_id) continue;
        if (filters.status && item.status !== filters.status) continue;
        list.push(item);
      } catch {
        // 损坏的记录不阻断列表
      }
    }
    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return list;
  }

  async saveCase(caseData) {
    await this.ready;
    if (!caseData || typeof caseData.diary_case_id !== 'string') {
      throw new Error('无效的日记输入数据：缺少 diary_case_id');
    }
    const path = join(this.casesDir, `${caseData.diary_case_id}.json`);
    await this.atomicWrite(path, JSON.stringify(caseData, null, 2));
    return caseData;
  }

  async getCase(id) {
    await this.ready;
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    const path = join(this.casesDir, `${safeId}.json`);
    try {
      const content = await readFile(path, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async saveAsset(assetId, buffer) {
    await this.ready;
    const safeId = String(assetId).replace(/[^a-zA-Z0-9_.-]/g, '');
    const path = join(this.assetsDir, safeId);
    await this.atomicWrite(path, buffer);
    return `/api/archive/assets/${safeId}`;
  }

  async getAsset(assetId) {
    await this.ready;
    const safeId = String(assetId).replace(/[^a-zA-Z0-9_.-]/g, '');
    const path = join(this.assetsDir, safeId);
    try {
      return await readFile(path);
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async exportZip(runId, { terrainCandidatesRoot = join(PROJECT_ROOT, '.local/terrain-candidates') } = {}) {
    const run = await this.getRun(runId);
    if (!run) throw new Error('实验记录不存在');

    const zipFiles = [];
    zipFiles.push({
      name: 'experiment-run.json',
      data: Buffer.from(JSON.stringify(run, null, 2), 'utf8')
    });

    // 收集图片文件：来自 candidates 的 image_url、original_image_url
    for (const c of run.candidates || []) {
      const tryAdd = async (url, suffix) => {
        if (!url) return;
        if (url.startsWith('data:image/png;base64,')) {
          const b64 = url.slice('data:image/png;base64,'.length);
          zipFiles.push({ name: `images/${c.id}-${suffix}.png`, data: Buffer.from(b64, 'base64') });
          return;
        }
        const assetMatch = url.match(/\/api\/archive\/assets\/([a-zA-Z0-9_.-]+)/);
        if (assetMatch) {
          const localPath = join(this.assetsDir, assetMatch[1]);
          if (existsSync(localPath)) {
            try {
              const bytes = await readFile(localPath);
              zipFiles.push({ name: `images/${c.id}-${suffix}.png`, data: bytes });
              return;
            } catch {}
          }
        }
        const idMatch = url.match(/\/api\/terrain-images\/([a-f0-9-]+)/) || url.match(/\/api\/terrain-cutouts\/([a-f0-9-]+)/);
        if (idMatch) {
          const imgId = idMatch[1];
          const localPath = join(terrainCandidatesRoot, `${imgId}.png`);
          if (existsSync(localPath)) {
            try {
              const bytes = await readFile(localPath);
              zipFiles.push({ name: `images/${c.id}-${suffix}.png`, data: bytes });
            } catch {}
          }
        }
      };
      await tryAdd(c.original_image_url, 'original');
      await tryAdd(c.image_url, 'transparent');
    }

    return createZip(zipFiles);
  }

  async importZip(zipBuffer) {
    await this.ready;
    const files = parseZip(zipBuffer);
    const metaFile = files.find(f => f.name === 'experiment-run.json');
    if (!metaFile) throw new Error('ZIP 档案无效：缺少 experiment-run.json 元数据文件');

    let runData;
    try {
      runData = JSON.parse(metaFile.data.toString('utf8'));
    } catch {
      throw new Error('ZIP 档案损坏：experiment-run.json 不是合法 JSON');
    }

    // 校验核心字段
    if (!runData.experiment_id || !Array.isArray(runData.candidates)) {
      throw new Error('ZIP 档案数据结构不完整');
    }

    // 保存内部图片资产并回填到 candidates
    for (const file of files) {
      if (file.name.startsWith('images/')) {
        const basename = file.name.slice('images/'.length);
        const assetId = `imported-${runData.experiment_id}-${basename}`;
        await this.saveAsset(assetId, file.data);

        const nameWithoutExt = basename.replace(/\.png$/i, '');
        const lastDash = nameWithoutExt.lastIndexOf('-');
        if (lastDash > 0) {
          const candidateId = nameWithoutExt.slice(0, lastDash);
          const suffix = nameWithoutExt.slice(lastDash + 1);
          const c = runData.candidates.find(item => item.id === candidateId);
          if (c) {
            if (suffix === 'original') c.original_image_url = `/api/archive/assets/${assetId}`;
            if (suffix === 'transparent') c.image_url = `/api/archive/assets/${assetId}`;
          }
        }
      }
    }

    // 重新持久化 runData
    await this.saveRun(runData);
    return runData;
  }
}
