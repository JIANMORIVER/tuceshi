import React, { useRef } from 'react';
import {
  REFERENCE_ROLE_LABELS,
  type ReferenceImage,
  type ReferenceImageRole,
  type ImageToImageRules
} from '../domain/experiment-rules.js';
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

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        onAddReferenceImage({
          id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          role: 'structure',
          dataUrl,
          sizeBytes: file.size
        });
      };
      reader.readAsDataURL(file);
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
          ? '已开启图生图模式：上传 1~3 张参考图，并明确分配角色（底图结构、风格配色、局部物件）。'
          : '当前为纯文生图：仅依赖日记构图与文本提示词生成。勾选【图生图】可引入参考图协同生成。'}
      </p>

      {lab.mode === 'image_to_image' && (
        <div className="i2i-content">
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
