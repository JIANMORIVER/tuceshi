import type { Experiment, Storage } from '../workbench/flow.js';
import type { ReferenceImage } from './experiment-rules.js';

const ASSETS_DB_NAME = 'life-map-workbench-assets-db';
const ASSETS_DB_VERSION = 1;
const STORE_BLOBS = 'workbench_blobs';

// 内存回退存储（Node.js 测试环境或无 IndexedDB 隐私模式）
const memoryBlobsStore = new Map<string, string>();

let assetsDbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openAssetsDB(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (assetsDbPromise) return assetsDbPromise;

  assetsDbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(ASSETS_DB_NAME, ASSETS_DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[WorkbenchStorage] 无法打开 IndexedDB 资产库，降级为内存存储');
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });

  return assetsDbPromise;
}

/**
 * 异步保存大型图片 Base64 到 IndexedDB
 */
export async function saveWorkbenchBlob(id: string, dataUrl: string): Promise<void> {
  if (!id || !dataUrl) return;
  memoryBlobsStore.set(id, dataUrl);

  const db = await openAssetsDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_BLOBS, 'readwrite');
      const store = tx.objectStore(STORE_BLOBS);
      store.put({ id, dataUrl, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * 从 IndexedDB 获取大型图片 Base64
 */
export async function getWorkbenchBlob(id: string): Promise<string | null> {
  if (!id) return null;
  if (memoryBlobsStore.has(id)) {
    return memoryBlobsStore.get(id)!;
  }

  const db = await openAssetsDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_BLOBS, 'readonly');
      const store = tx.objectStore(STORE_BLOBS);
      const req = store.get(id);
      req.onsuccess = () => {
        const result = req.result;
        if (result && typeof result.dataUrl === 'string') {
          memoryBlobsStore.set(id, result.dataUrl);
          resolve(result.dataUrl);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * 检测异常是否为 LocalStorage 配额超限
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  const e = err as any;
  if (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    e.number === -2147024882
  ) {
    return true;
  }
  if (typeof e.message === 'string' && /exceeded.*quota|quota.*exceeded/i.test(e.message)) {
    return true;
  }
  return false;
}

/**
 * 深度脱水：递归遍历任何 JSON 对象树，
 * 将任何大于 5000 字符的 data:image/ 抽离并替换为 idb://${id}，大图提取到 largeBlobs 列表
 */
export function deepDehydrateObject<T = any>(
  obj: T
): { dehydrated: T; largeBlobs: Array<{ id: string; dataUrl: string }> } {
  const largeBlobs: Array<{ id: string; dataUrl: string }> = [];

  function walk(value: any): any {
    if (typeof value === 'string') {
      if (value.startsWith('data:image/') && value.length > 5000) {
        const blobId = 'blob-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        largeBlobs.push({ id: blobId, dataUrl: value });
        return `idb://${blobId}`;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value !== null && typeof value === 'object') {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === 'dataUrl' && typeof v === 'string' && v.startsWith('data:image/') && v.length > 5000) {
          const imgId = typeof value.id === 'string' && value.id ? value.id : 'blob-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
          largeBlobs.push({ id: imgId, dataUrl: v });
          res[k] = `idb://${imgId}`;
        } else {
          res[k] = walk(v);
        }
      }
      return res;
    }
    return value;
  }

  const dehydrated = walk(obj) as T;
  return { dehydrated, largeBlobs };
}

/**
 * 深度重水化：递归遍历对象树，将所有 idb://${id} 替换为 IndexedDB 中的完整数据
 */
export async function deepRehydrateObject<T = any>(obj: T): Promise<T> {
  async function walk(value: any): Promise<any> {
    if (typeof value === 'string') {
      if (value.startsWith('idb://')) {
        const blobId = value.slice('idb://'.length);
        const fullData = await getWorkbenchBlob(blobId);
        return fullData || value;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map(walk));
    }
    if (value !== null && typeof value === 'object') {
      const res: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        res[k] = await walk(v);
      }
      return res;
    }
    return value;
  }

  return walk(obj);
}

/**
 * 对 Experiment 状态进行脱水：
 * 将大体积 Base64 图片移入 IndexedDB/内存，LocalStorage 中仅保存轻量引用
 */
export function dehydrateExperiment(exp: Experiment): { dehydrated: Experiment; largeBlobs: Array<{ id: string; dataUrl: string }> } {
  return deepDehydrateObject<Experiment>(exp);
}

/**
 * 异步重水化：从 IndexedDB 还原完整的图片 Base64
 */
export async function rehydrateExperiment(exp: Experiment): Promise<Experiment> {
  return deepRehydrateObject<Experiment>(exp);
}

/**
 * 启动时主动瘦身与清理 LocalStorage 中的历史大图脏数据，释放宝贵配额
 */
export function cleanupLegacyLocalStorageQuota(storage?: Storage): void {
  if (!storage) return;

  const targetKeys = [
    'life-map.image-workbench.v1',
    'life-map.i2i-saved-preset.v1'
  ];

  for (const key of targetKeys) {
    try {
      const raw = storage.getItem(key);
      if (raw && (raw.length > 30000 || raw.includes('data:image/'))) {
        const parsed = JSON.parse(raw);
        const { dehydrated, largeBlobs } = deepDehydrateObject(parsed);
        for (const item of largeBlobs) {
          void saveWorkbenchBlob(item.id, item.dataUrl);
        }
        // 先删除释放空间再存入轻量版本
        try {
          if (typeof (storage as any).removeItem === 'function') {
            (storage as any).removeItem(key);
          } else {
            storage.setItem(key, '');
          }
        } catch {}
        storage.setItem(key, JSON.stringify(dehydrated));
        console.info(`[SafeWorkbenchStorage] 成功清理并瘦身历史存储 ${key}，已释放配额空间`);
      }
    } catch {}
  }
}

/**
 * 健壮的弹性存储适配器：
 * 具备自动脱水、大图转存 IndexedDB、配额溢出安全捕获、释放重试与内存平滑降级能力
 */
export class SafeWorkbenchStorage implements Storage {
  private memoryMap = new Map<string, string>();

  constructor(private readonly fallbackStorage?: Storage) {
    if (this.fallbackStorage) {
      try {
        cleanupLegacyLocalStorageQuota(this.fallbackStorage);
      } catch {}
    }
  }

  getItem(key: string): string | null {
    if (this.memoryMap.has(key)) {
      return this.memoryMap.get(key)!;
    }
    if (this.fallbackStorage) {
      try {
        const val = this.fallbackStorage.getItem(key);
        if (val !== null) return val;
      } catch {}
    }
    return null;
  }

  setItem(key: string, value: string): void {
    // 始终维护内存镜像，保障极端情况下数据零丢失
    this.memoryMap.set(key, value);

    if (!this.fallbackStorage) {
      return;
    }

    try {
      this.fallbackStorage.setItem(key, value);
    } catch (err: unknown) {
      if (isQuotaExceededError(err)) {
        console.warn(`[SafeWorkbenchStorage] 存储 ${key} 触发配额超限，启动全量深度脱水与释放重试`);

        try {
          // 1. 先尝试删除原 key 释放旧占用的配额空间
          try {
            if (typeof (this.fallbackStorage as any).removeItem === 'function') {
              (this.fallbackStorage as any).removeItem(key);
            } else {
              this.fallbackStorage.setItem(key, '');
            }
          } catch {}

          // 2. 深度脱水
          const parsed = JSON.parse(value);
          const { dehydrated, largeBlobs } = deepDehydrateObject(parsed);
          for (const item of largeBlobs) {
            void saveWorkbenchBlob(item.id, item.dataUrl);
          }
          const compactJson = JSON.stringify(dehydrated);
          this.fallbackStorage.setItem(key, compactJson);
          return;
        } catch {
          // 3. 若再次超限，尝试深度清理其它历史大 key 后再试
          try {
            cleanupLegacyLocalStorageQuota(this.fallbackStorage);
            const parsed = JSON.parse(value);
            const { dehydrated } = deepDehydrateObject(parsed);
            this.fallbackStorage.setItem(key, JSON.stringify(dehydrated));
            return;
          } catch {}
        }

        // 4. 终极保护层：若仍不可写入（例如浏览器 Storage 全局已满或被外部占用），
        // 在浏览器运行时，绝对不抛出 QuotaExceededError 阻断生图！
        // 状态已安全保存在 this.memoryMap 中，生图网络请求与卡片状态 100% 顺畅执行
        if (typeof window !== 'undefined') {
          console.warn(`[SafeWorkbenchStorage] LocalStorage 配额已耗尽，已平滑无感降级至内存存储，生图流程畅通无阻`);
          return;
        }
      }

      // 非浏览器配额超限错误（如致命持久化损坏），如实抛出保持安全契约
      throw err;
    }
  }

  removeItem(key: string): void {
    this.memoryMap.delete(key);
    try {
      if (this.fallbackStorage) {
        if (typeof (this.fallbackStorage as any).removeItem === 'function') {
          (this.fallbackStorage as any).removeItem(key);
        } else {
          this.fallbackStorage.setItem(key, '');
        }
      }
    } catch {}
  }
}

/**
 * 客户端图片上传智能等比缩放与压缩：
 * 避免用户直接上传几千像素的高清大图把浏览器撑爆
 */
export async function compressAndScaleImage(
  file: File,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<{ dataUrl: string; sizeBytes: number }> {
  const { maxDimension = 1280, quality = 0.88 } = options;

  // 若文件本身很小（< 150KB），直接读取
  if (file.size <= 150 * 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        dataUrl: reader.result as string,
        sizeBytes: file.size
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 浏览器环境下使用 Image + Canvas 进行智能适度缩放
  if (typeof window !== 'undefined' && typeof Image !== 'undefined' && typeof document !== 'undefined') {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const rawUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const isPng = file.type === 'image/png';
            const outputType = isPng ? 'image/png' : 'image/jpeg';
            const compressedUrl = canvas.toDataURL(outputType, quality);
            const approxBytes = Math.round((compressedUrl.length - 22) * 0.75);
            resolve({
              dataUrl: compressedUrl,
              sizeBytes: approxBytes
            });
            return;
          }
          resolve({ dataUrl: rawUrl, sizeBytes: file.size });
        };
        img.onerror = () => resolve({ dataUrl: rawUrl, sizeBytes: file.size });
        img.src = rawUrl;
      };
      reader.onerror = () => resolve({ dataUrl: '', sizeBytes: 0 });
      reader.readAsDataURL(file);
    });
  }

  // 降级回退
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result as string, sizeBytes: file.size });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
