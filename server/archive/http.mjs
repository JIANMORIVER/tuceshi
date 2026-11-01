import { ArchiveService } from './service.mjs';

const json = (res, data, status = 200) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(data));
};

export function createArchiveHandler({ archive = new ArchiveService() } = {}) {
  return async function archiveHandler(req, res) {
    const urlObj = new URL(req.url, 'http://localhost');
    const path = urlObj.pathname;

    if (!path.startsWith('/api/archive/')) return false;

    try {
      // 1. 读取资产图片 GET /api/archive/assets/:id
      if (req.method === 'GET' && path.startsWith('/api/archive/assets/')) {
        const assetId = path.slice('/api/archive/assets/'.length);
        const bytes = await archive.getAsset(assetId);
        if (!bytes) {
          json(res, { error: '图片资产未找到' }, 404);
          return true;
        }
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff'
        });
        res.end(bytes);
        return true;
      }

      // 2. 导出 ZIP GET /api/archive/runs/:id/export-zip
      if (req.method === 'GET' && path.match(/^\/api\/archive\/runs\/([a-zA-Z0-9_-]+)\/export-zip$/)) {
        const id = path.split('/')[4];
        const zipBuffer = await archive.exportZip(id);
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="life-map-archive-${id}.zip"`,
          'cache-control': 'no-store'
        });
        res.end(zipBuffer);
        return true;
      }

      // 3. 导入 ZIP POST /api/archive/import-zip
      if (req.method === 'POST' && path === '/api/archive/import-zip') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const imported = await archive.importZip(buffer);
        json(res, { success: true, run: imported });
        return true;
      }

      // 4. 实验列表 GET /api/archive/runs
      if (req.method === 'GET' && path === '/api/archive/runs') {
        const mode = urlObj.searchParams.get('mode') || undefined;
        const style_id = urlObj.searchParams.get('style_id') || undefined;
        const status = urlObj.searchParams.get('status') || undefined;
        const list = await archive.listRuns({ mode, style_id, status });
        json(res, { runs: list });
        return true;
      }

      // 5. 实验详情 GET /api/archive/runs/:id
      if (req.method === 'GET' && path.startsWith('/api/archive/runs/')) {
        const id = path.slice('/api/archive/runs/'.length);
        const run = await archive.getRun(id);
        if (!run) {
          json(res, { error: '实验记录未找到' }, 404);
          return true;
        }
        json(res, run);
        return true;
      }

      // 6. 保存实验快照 POST /api/archive/runs
      if (req.method === 'POST' && path === '/api/archive/runs') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        const saved = await archive.saveRun(data);
        json(res, saved);
        return true;
      }

      // 7. 日记 Case GET / POST
      if (path === '/api/archive/cases' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        const saved = await archive.saveCase(data);
        json(res, saved);
        return true;
      }

      if (path.startsWith('/api/archive/cases/') && req.method === 'GET') {
        const id = path.slice('/api/archive/cases/'.length);
        const c = await archive.getCase(id);
        if (!c) {
          json(res, { error: '日记输入未找到' }, 404);
          return true;
        }
        json(res, c);
        return true;
      }

      json(res, { error: '未找到该归档接口' }, 404);
      return true;
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : '归档操作失败' }, 500);
      return true;
    }
  };
}
