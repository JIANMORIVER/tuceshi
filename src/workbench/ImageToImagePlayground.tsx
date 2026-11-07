import React, { useRef } from 'react';
import {
  REFERENCE_ROLE_LABELS,
  type ReferenceImage,
  type ReferenceImageRole,
  type ImageToImageRules
} from '../domain/experiment-rules.js';
import { compressAndScaleImage } from '../domain/workbench-storage.js';
import type { LabConfig } from './flow.js';

interface ImageToImagePlaygroundProps {
  lab: LabConfig;
  busy: boolean;
  onUpdateLab: (patch: Partial<LabConfig>) => void;
  onAddReferenceImage: (img: ReferenceImage) => void;
  onRemoveReferenceImage: (id: string) => void;
  onUpdateReferenceImageRole: (id: string, role: ReferenceImageRole) => void;
}

export const ImageToImagePlayground: React.FC<ImageToImagePlaygroundProps> = ({
  lab,
  busy,
  onUpdateLab,
  onAddReferenceImage,
  onRemoveReferenceImage,
  onUpdateReferenceImageRole
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);
  const I2I_PRESET_STORAGE_KEY = 'life-map.i2i-saved-preset.v1';

  const saveAsDefaultPreset = () => {
    try {
      const data = {
        referenceImages: lab.referenceImages,
        i2iRules: lab.i2iRules
      };
      localStorage.setItem(I2I_PRESET_STORAGE_KEY, JSON.stringify(data));
      alert('已成功将当前参考图与图生图规则保存为本机常用预设！');
    } catch {
      alert('保存失败：图片体积可能超出浏览器缓存限制，建议使用“导出配置 JSON”。');
    }
  };

  const loadDefaultPreset = () => {
    try {
      const raw = localStorage.getItem(I2I_PRESET_STORAGE_KEY);
      if (!raw) {
        alert('本机暂无已保存的图生图常用预设。请先配置后点击“存为常用”。');
        return;
      }
      const data = JSON.parse(raw);
      onUpdateLab({
        mode: 'image_to_image',
        referenceImages: Array.isArray(data.referenceImages) ? data.referenceImages : [],
        i2iRules: data.i2iRules ? { ...lab.i2iRules, ...data.i2iRules } : lab.i2iRules
      });
      alert('已成功载入本机常用图生图预设！');
    } catch {
      alert('读取预设失败。');
    }
  };

  const exportI2IConfig = () => {
    const exportData = {
      schema_version: 'i2i-config-v1',
      exported_at: new Date().toISOString(),
      mode: 'image_to_image',
      reference_images: lab.referenceImages,
      i2i_rules: lab.i2iRules
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `i2i-config-preset-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportI2IConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.schema_version !== 'i2i-config-v1' && !data.reference_images && !data.referenceImages) {
          throw new Error('不是合法的图生图配置包格式');
        }
        onUpdateLab({
          mode: 'image_to_image',
          referenceImages: Array.isArray(data.reference_images) ? data.reference_images : (data.referenceImages || []),
          i2iRules: data.i2i_rules ? { ...lab.i2iRules, ...data.i2i_rules } : (data.i2iRules || lab.i2iRules)
        });
        alert('已成功导入图生图配置与参考底图！已自动切换为图生图模式。');
      } catch (err: any) {
        alert(`导入失败：${err.message || '文件解析错误'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) {
        alert('请上传 PNG、JPEG 或 WebP 格式的图片。');
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert('参考图大小不能超过 8MB。');
        continue;
      }
      if ((lab.referenceImages?.length || 0) >= 3) {
        alert('最多支持添加 3 张参考图。');
        break;
      }

      const existingRoles = (lab.referenceImages || []).map(r => r.role);
      // 默认角色推导：首张为 structure，已有 structure 则优先建议 scale，允许用户后续手动切换；绝不依据文件名篡改
      const initialRole: ReferenceImageRole = existingRoles.includes('structure')
        ? (existingRoles.includes('scale') ? 'style' : 'scale')
        : 'structure';

      void compressAndScaleImage(file).then(({ dataUrl, sizeBytes }) => {
        onAddReferenceImage({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          role: initialRole,
          dataUrl,
          sizeBytes
        });
      }).catch(() => {
        alert('读取图片失败，请检查文件格式。');
      });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateRule = (key: keyof ImageToImageRules, val: string) => {
    onUpdateLab({
      i2iRules: {
        ...lab.i2iRules,
        [key]: val
      }
    });
  };

  return (
    <section className="paper lab-section" aria-label="图生图实验场">
      <div className="section-title">
        <h2>🖼️ 图生图与多参考图实验场</h2>
        <div className="mode-toggle">
          <label className="toggle-label">
            <input
              type="radio"
              name="genMode"
              checked={lab.mode === 'text_to_image'}
              disabled={busy}
              onChange={() => onUpdateLab({ mode: 'text_to_image' })}
            />
            纯文生图
          </label>
          <label className="toggle-label">
            <input
              type="radio"
              name="genMode"
              checked={lab.mode === 'image_to_image'}
              disabled={busy}
              onChange={() => onUpdateLab({ mode: 'image_to_image' })}
            />
            图生图 / 参考图模式
          </label>
        </div>
      </div>

      <p className="hint">
        {lab.mode === 'image_to_image'
          ? '已开启图生图模式：分别管理【结构底图 Structure】（控制外形与道路出口）与【尺度参考图 Scale】（控制物体相对比例且不影响画风，可选），各自独立生效。'
          : '当前为纯文生图：仅依赖日记构图与文本提示词生成。勾选【图生图】可引入参考图协同生成。'}
      </p>

      {lab.mode === 'image_to_image' && (
        <div className="i2i-content">
          <div className="i2i-toolbar">
            <div className="btn-group">
              <button type="button" className="button secondary" onClick={saveAsDefaultPreset} title="将当前的参考图和规则保存到浏览器缓存，下次随时载入">
                💾 存为常用预设
              </button>
              <button type="button" className="button secondary" onClick={loadDefaultPreset} title="从浏览器缓存载入之前保存的常用参考图与规则">
                🔄 载入常用预设
              </button>
            </div>
            <div className="btn-group">
              <button type="button" className="button secondary" onClick={exportI2IConfig} title="将参考图和规则打包导出为独立的 JSON 文件">
                📤 导出配置包 (JSON)
              </button>
              <label className="button secondary file-upload-btn" title="上传之前导出的图生图配置 JSON">
                📥 导入配置包 (JSON)
                <input
                  ref={configInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={handleImportI2IConfig}
                />
              </label>
            </div>
          </div>

          <div className="image-uploader">
            <div className="upload-header">
              <strong>参考图片列表（{lab.referenceImages.length}/3）</strong>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                disabled={busy || lab.referenceImages.length >= 3}
                onChange={handleFileUpload}
              />
              <button
                type="button"
                disabled={busy || lab.referenceImages.length >= 3}
                onClick={() => fileInputRef.current?.click()}
              >
                + 上传参考图
              </button>
            </div>

            {lab.referenceImages.length === 0 ? (
              <div className="empty-upload-box" onClick={() => fileInputRef.current?.click()}>
                <p>点击或拖拽上传参考图（支持 PNG/JPG，最多 3 张）</p>
                <small>请为每张图指定其角色：底图骨架、画风色调或具体物件</small>
              </div>
            ) : (
              <div className="ref-images-grid">
                {lab.referenceImages.map((img, idx) => (
                  <div key={img.id} className="ref-image-card">
                    <div className="ref-thumb-wrapper">
                      <img src={img.dataUrl} alt={img.name} />
                      <button
                        className="delete-thumb-btn"
                        type="button"
                        title="移除此图"
                        disabled={busy}
                        onClick={() => onRemoveReferenceImage(img.id)}
                      >
                        ×
                      </button>
                    </div>
                    <div className="ref-image-meta">
                      <span className="ref-index">图 {idx + 1}</span>
                      <strong className="ref-filename" title={img.name}>
                        {img.name}
                      </strong>
                      <label className="role-selector-label">
                        <span>图片角色：</span>
                        <select
                          value={img.role}
                          disabled={busy}
                          onChange={e =>
                            onUpdateReferenceImageRole(img.id, e.target.value as ReferenceImageRole)
                          }
                        >
                          {(Object.keys(REFERENCE_ROLE_LABELS) as ReferenceImageRole[]).map(roleKey => (
                            <option key={roleKey} value={roleKey}>
                              {REFERENCE_ROLE_LABELS[roleKey].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <small className="role-tip">
                        {REFERENCE_ROLE_LABELS[img.role].desc}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details className="i2i-rules-details" open>
            <summary>
              <strong>图编规则词（第一版）· 协同指导与边界约束</strong>
            </summary>
            <div className="i2i-rules-grid">
              <label className="rule-field">
                <span>A. 图片角色说明</span>
                <textarea
                  rows={2}
                  value={lab.i2iRules.roleInstructions}
                  disabled={busy}
                  onChange={e => updateRule('roleInstructions', e.target.value)}
                />
              </label>

              <label className="rule-field">
                <span>B. 严格保留规则</span>
                <textarea
                  rows={2}
                  value={lab.i2iRules.preservationRules}
                  disabled={busy}
                  onChange={e => updateRule('preservationRules', e.target.value)}
                />
              </label>

              <label className="rule-field">
                <span>C. 允许重构与变化规则</span>
                <textarea
                  rows={2}
                  value={lab.i2iRules.variationRules}
                  disabled={busy}
                  onChange={e => updateRule('variationRules', e.target.value)}
                />
              </label>

              <label className="rule-field">
                <span>D. 禁止事项与边界</span>
                <textarea
                  rows={2}
                  value={lab.i2iRules.prohibitions}
                  disabled={busy}
                  onChange={e => updateRule('prohibitions', e.target.value)}
                />
              </label>
            </div>
          </details>
        </div>
      )}
    </section>
  );
};
