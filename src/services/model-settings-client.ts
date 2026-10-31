export interface PublicModelSettings {
  textProvider: "qwen" | "deepseek" | "mock";
  deepseek: { model: string; apiConfigured: boolean };
  qwen: { model: string; apiConfigured: boolean };
  image: { model: string; apiConfigured: boolean; size: string };
  secretLifetime: string;
  vision?: { model: string; apiConfigured: boolean };
  generationRoute?: 'legacy-local' | 'native-alpha' | 'qwen-851';
  nativeImageModel?: string;
  backgroundRemoval?: {provider:string;model:string;apiConfigured:boolean};
  authRequired?: boolean;
  signInPath?: string;
}
export function imageSubmissionId(): string {
  const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const s=Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
let session: Promise<PublicModelSettings> | undefined;
export const MODEL_SETTINGS_CHANGED = "life-map:model-settings-changed";
export function modelStatusLabel(settings?: PublicModelSettings, unavailable = false): string {
  if (unavailable) return "模型状态暂不可用";
  if (!settings) return "正在读取模型配置…";
  if (settings.textProvider === "mock") return "离线规则 · 已选择";
  const ready = settings.textProvider === "deepseek" ? settings.deepseek.apiConfigured : settings.qwen.apiConfigured;
  return `${settings.textProvider === "deepseek" ? "DeepSeek" : "千问"} · ${ready ? "已配置" : "待配置"}`;
}
export function loadModelSettings(refresh = false): Promise<PublicModelSettings> {
  if (!session || refresh) session = fetch("/api/model-settings", { cache: "no-store" }).then(async response => {
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "模型设置暂时无法读取。");
    return value as PublicModelSettings;
  }).catch(error => { session = undefined; throw error; });
  return session;
}
