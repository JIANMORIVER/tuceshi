import type { StylePackage, StyleReferenceImage, StyleMode } from './experiment-rules.js';

const DB_NAME = 'life-map-workbench-styles-db';
const DB_VERSION = 1;
const STORE_STYLES = 'custom_styles';
const STORE_PRESET_OVERRIDES = 'preset_overrides';

// 内存回退存储（用于 Node.js 测试环境或无 IndexedDB 隐私模式）
const memoryStylesStore = new Map<string, StylePackage>();
const memoryPresetOverrides = new Map<string, { images: StyleReferenceImage[]; mode?: StyleMode }>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDB(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase | null> {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_STYLES)) {
          db.createObjectStore(STORE_STYLES, { keyPath: 'style_id' });
        }
        if (!db.objectStoreNames.contains(STORE_PRESET_OVERRIDES)) {
          db.createObjectStore(STORE_PRESET_OVERRIDES, { keyPath: 'style_id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('[StyleStorage] 打开 IndexedDB 失败，自动降级至内存存储');
        resolve(null);
      };
    } catch (e) {
      console.warn('[StyleStorage] 初始化 IndexedDB 异常，降级至内存存储', e);
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * 获取所有本地持久化的自定义风格
 */
export async function loadAllCustomStyles(): Promise<StylePackage[]> {
  const db = await openDB();
  if (!db) {
    return Array.from(memoryStylesStore.values());
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_STYLES, 'readonly');
      const store = tx.objectStore(STORE_STYLES);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as StylePackage[]) || []);
      req.onerror = () => resolve(Array.from(memoryStylesStore.values()));
    } catch {
      resolve(Array.from(memoryStylesStore.values()));
    }
  });
}

/**
 * 保存单个自定义风格（包含文字规则与所有关联的参考图）
 */
export async function saveCustomStyle(style: StylePackage): Promise<void> {
  memoryStylesStore.set(style.style_id, style);
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_STYLES, 'readwrite');
      const store = tx.objectStore(STORE_STYLES);
      const req = store.put(style);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 批量保存自定义风格列表
 */
export async function saveAllCustomStyles(styles: StylePackage[]): Promise<void> {
  for (const s of styles) {
    memoryStylesStore.set(s.style_id, s);
  }
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_STYLES, 'readwrite');
      const store = tx.objectStore(STORE_STYLES);
      for (const s of styles) {
        store.put(s);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 删除单个自定义风格
 */
export async function deleteCustomStyle(styleId: string): Promise<void> {
  memoryStylesStore.delete(styleId);
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_STYLES, 'readwrite');
      const store = tx.objectStore(STORE_STYLES);
      const req = store.delete(styleId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 加载预设风格的用户自定义图片与模式覆盖配置
 */
export async function loadPresetOverrides(): Promise<Record<string, { images: StyleReferenceImage[]; mode?: StyleMode }>> {
  const db = await openDB();
  if (!db) {
    const res: Record<string, { images: StyleReferenceImage[]; mode?: StyleMode }> = {};
    for (const [k, v] of memoryPresetOverrides.entries()) res[k] = v;
    return res;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_PRESET_OVERRIDES, 'readonly');
      const store = tx.objectStore(STORE_PRESET_OVERRIDES);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = (req.result || []) as Array<{ style_id: string; images: StyleReferenceImage[]; mode?: StyleMode }>;
        const map: Record<string, { images: StyleReferenceImage[]; mode?: StyleMode }> = {};
        for (const item of list) {
          map[item.style_id] = { images: item.images || [], mode: item.mode };
        }
        resolve(map);
      };
      req.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  });
}

/**
 * 保存预设风格的图片与模式覆盖
 */
export async function savePresetOverride(styleId: string, override: { images: StyleReferenceImage[]; mode?: StyleMode }): Promise<void> {
  memoryPresetOverrides.set(styleId, override);
  const db = await openDB();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_PRESET_OVERRIDES, 'readwrite');
      const store = tx.objectStore(STORE_PRESET_OVERRIDES);
      const req = store.put({ style_id: styleId, images: override.images, mode: override.mode });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * 清除测试环境内存存储
 */
export function clearMemoryStorageForTesting(): void {
  memoryStylesStore.clear();
  memoryPresetOverrides.clear();
}
