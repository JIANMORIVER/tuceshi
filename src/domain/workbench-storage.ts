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
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    e.number === -2147024882 ||
    (typeof e.message === 'string' && /quota|exceeded/i.test(e.message))
  );
}

/**
 * 对 Experiment 状态进行脱水：
 * 将大体积 Base64 图片移入 IndexedDB/内存，LocalStorage 中仅保存轻量引用
 */
export function dehydrateExperiment(exp: Experiment): { dehydrated: Experiment; largeBlobs: Array<{ id: string; dataUrl: string }> } {
  const largeBlobs: Array<{ id: string; dataUrl: string }> = [];

  const refImages = Array.isArray(exp.lab?.referenceImages)
    ? exp.lab.referenceImages.map(img => {
        // 如果 Base64 超过 20KB，转存为外部 blob 引用
        if (typeof img.dataUrl === 'string' && img.dataUrl.length > 20000 && !img.dataUrl.startsWith('idb://')) {
          largeBlobs.push({ id: img.id, dataUrl: img.dataUrl });
          return {
            ...img,
            dataUrl: `idb://${img.id}`
          };
        }
        return img;
      })
    : [];

  const dehydrated: Experiment = {
    ...exp,
    lab: {
      ...exp.lab,
      referenceImages: refImages
    }
  };

  return { dehydrated, largeBlobs };
}

/**
 * 异步重水化：从 IndexedDB 还原完整的图片 Base64
 */
export async function rehydrateExperiment(exp: Experiment): Promise<Experiment> {
  if (!exp.lab || !Array.isArray(exp.lab.referenceImages) || exp.lab.referenceImages.length === 0) {
    return exp;
  }

  let modified = false;
  const restoredImages: ReferenceImage[] = [];

  for (const img of exp.lab.referenceImages) {
    if (typeof img.dataUrl === 'string' && img.dataUrl.startsWith('idb://')) {
      const blobId = img.dataUrl.slice('idb://'.length);
      const fullData = await getWorkbenchBlob(blobId);
      if (fullData) {
        restoredImages.push({ ...img, dataUrl: fullData });
        modified = true;
      } else {
        restoredImages.push(img);
      }
    } else {
      restoredImages.push(img);
    }
  }

  if (!modified) return exp;

  return {
    ...exp,
    lab: {
      ...exp.lab,
      referenceImages: restoredImages
    }
  };
}

/**
 * 健壮的弹性存储适配器：
 * 具备自动脱水、大图转存 IndexedDB、配额溢出安全捕获与重试能力
 */
export class SafeWorkbenchStorage implements Storage {
  private memoryMap = new Map<string, string>();

  constructor(private readonly fallbackStorage?: Storage) {}

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
    if (!this.fallbackStorage) {
      this.memoryMap.set(key, value);
      return;
    }

    try {
      this.fallbackStorage.setItem(key, value);
      this.memoryMap.delete(key);
    } catch (err: unknown) {
      if (isQuotaExceededError(err)) {
        console.warn(`[SafeWorkbenchStorage] 存储 ${key} 触发配额超限，启动脱水优化与弹性写入`);

        // 尝试解析并对状态进行脱水
        try {
          const parsed = JSON.parse(value);
          if (parsed && parsed.version === 1 && parsed.lab) {
            const { dehydrated, largeBlobs } = dehydrateExperiment(parsed);
            // 异步后台转存大图到 IndexedDB
            for (const item of largeBlobs) {
              void saveWorkbenchBlob(item.id, item.dataUrl);
            }
            const compactJson = JSON.stringify(dehydrated);
            this.fallbackStorage.setItem(key, compactJson);
            this.memoryMap.delete(key);
            return;
          }
        } catch {
          // 若脱水重写依然失败，抛出错误
        }
      }
      // 无法脱水解决或底层确已故障，如实抛出以阻止可能导致数据不一致的生图
      throw err;
    }
  }

  removeItem(key: string): void {
    this.memoryMap.delete(key);
    try {
      if (this.fallbackStorage) {
        if (typeof this.fallbackStorage.removeItem === 'function') {
          this.fallbackStorage.removeItem(key);
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
