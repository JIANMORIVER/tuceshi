import React, { useState, useRef } from 'react';
import {
  PRESET_STYLE_PACKAGES,
  STYLE_SCOPE_LABELS,
  type StylePackage,
  type ReferenceImage
} from '../domain/experiment-rules.js';
import type { LabConfig } from './flow.js';

interface StylePlaygroundProps {
  lab: LabConfig;
  busy: boolean;
  onUpdateLab: (patch: Partial<LabConfig>) => void;
  onAddReferenceImage?: (img: ReferenceImage) => void;
}

const CUSTOM_STYLES_STORAGE_KEY = 'life-map.custom-styles.v1';

export const StylePlayground: React.FC<StylePlaygroundProps> = ({
  lab,
  busy,
  onUpdateLab
}) => {
  const [customStyles, setCustomStyles] = useState<StylePackage[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_STYLES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [isCreating, setIsCreating] = useState(false);
  const [newStyleName, setNewStyleName] = useState('');
  const [newStyleDesc, setNewStyleDesc] = useState('');
  const styleFileInputRef = useRef<HTMLInputElement>(null);

  const allStyles: StylePackage[] = [...PRESET_STYLE_PACKAGES, ...customStyles];
  const currentPreset = allStyles.find(s => s.style_id === lab.selectedStyleId) || allStyles[0];
  const activeStyleText = lab.customStyleText !== undefined ? lab.customStyleText : currentPreset.style_text_rules;
  const activeNegativeText = lab.customNegativeText !== undefined ? lab.customNegativeText : currentPreset.style_negative_rules;

  const saveCustomStyles = (list: StylePackage[]) => {
    setCustomStyles(list);
    try {
      localStorage.setItem(CUSTOM_STYLES_STORAGE_KEY, JSON.stringify(list));
    } catch {}
  };

  const handleSelectPreset = (preset: StylePackage) => {
    onUpdateLab({
      selectedStyleId: preset.style_id,
      customStyleText: preset.style_text_rules,
      customNegativeText: preset.style_negative_rules
    });
  };

  const handleCreateStyle = () => {
    if (!newStyleName.trim()) {
      alert('请填写风格名称');
      return;
    }
    const newStyle: StylePackage = {
      style_id: `custom-style-${Date.now()}`,
      style_name: newStyleName.trim(),
      style_description: newStyleDesc.trim() || '用户自定义风格包',
      style_text_rules: activeStyleText || '精致 2D 等距像素画',
      style_negative_rules: activeNegativeText || '',
      style_reference_images: [],
      style_scope: ['color', 'lighting', 'atmosphere', 'pixel_density']
    };
    const nextList = [...customStyles, newStyle];
    saveCustomStyles(nextList);
    handleSelectPreset(newStyle);
    setIsCreating(false);
    setNewStyleName('');
    setNewStyleDesc('');
  };

  const handleExportStyle = () => {
    const exportData = {
      schema_version: 'style-package-v1',
      exported_at: new Date().toISOString(),
      style: {
        style_id: currentPreset.style_id,
        style_name: currentPreset.style_name,
        style_description: currentPreset.style_description,
        style_text_rules: activeStyleText,
        style_negative_rules: activeNegativeText,
        style_scope: currentPreset.style_scope || ['color', 'lighting', 'atmosphere']
      }
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `style-${currentPreset.style_name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleImportStyle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const s = data.style || data;
        if (!s.style_name || !s.style_text_rules) {
          throw new Error('风格包缺少必要的名称或规则词');
        }
        const imported: StylePackage = {
          style_id: `custom-imported-${Date.now()}`,
          style_name: s.style_name,
          style_description: s.style_description || '导入的自定义风格',
          style_text_rules: s.style_text_rules,
          style_negative_rules: s.style_negative_rules || '',
          style_reference_images: [],
          style_scope: Array.isArray(s.style_scope) ? s.style_scope : ['color', 'lighting', 'atmosphere']
        };
        const nextList = [...customStyles.filter(item => item.style_name !== imported.style_name), imported];
        saveCustomStyles(nextList);
        handleSelectPreset(imported);
        alert(`已成功导入并切换至风格【${imported.style_name}】！`);
      } catch (err: any) {
        alert(`导入失败：${err.message || '文件解析错误'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDeleteCustomStyle = (e: React.MouseEvent, styleId: string) => {
    e.stopPropagation();
    if (!confirm('确定删除此自定义风格包吗？')) return;
    const nextList = customStyles.filter(s => s.style_id !== styleId);
    saveCustomStyles(nextList);
    if (lab.selectedStyleId === styleId) {
      handleSelectPreset(PRESET_STYLE_PACKAGES[0]);
    }
  };

  return (
    <section className="paper lab-section" aria-label="风格化实验场">
      <div className="section-title">
        <div>
          <h2>🎨 风格化实验场</h2>
          <span className="badge">预设风格与自定义风格包管理</span>
        </div>
        <div className="btn-group">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setIsCreating(true)}
          >
            ➕ 新建风格
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={handleExportStyle}
            title="将当前选中的风格导出为独立 JSON"
          >
            📤 导出此风格 JSON
          </button>
          <label className="button secondary file-upload-btn" title="导入自定义风格包 JSON 文件">
            📥 导入风格 JSON
            <input
              ref={styleFileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportStyle}
            />
          </label>
        </div>
      </div>

      <p className="hint">
        选择或自定义风格规则，风格将被作为【画风与氛围层】注入到最终生图 Prompt 中。支持文生图风格化与参考图风格化。
      </p>

      {/* 新建风格表单弹窗/展开区 */}
      {isCreating && (
        <div className="custom-style-modal paper elevation-2">
          <h3>新建自定义风格包</h3>
          <p className="hint">风格规则词将默认复制当前编辑区的正负向提示词，便于快速提炼和保存。</p>
          <div className="custom-style-fields">
            <label>
              <strong>风格名称 *</strong>
              <input
                type="text"
                value={newStyleName}
                maxLength={40}
                placeholder="例如：黄昏吉卜力像素、赛博雨夜霓虹"
                onChange={e => setNewStyleName(e.target.value)}
              />
            </label>
            <label>
              <strong>风格简述</strong>
              <input
                type="text"
                value={newStyleDesc}
                maxLength={100}
                placeholder="简述色彩氛围、光影走向与细节特征"
                onChange={e => setNewStyleDesc(e.target.value)}
              />
            </label>
          </div>
          <div className="actions">
            <button type="button" className="button secondary" onClick={() => setIsCreating(false)}>取消</button>
            <button type="button" className="button primary" onClick={handleCreateStyle}>确认保存并应用</button>
          </div>
        </div>
      )}

      {/* 风格卡片网格 */}
      <div className="style-presets-grid">
        {allStyles.map(preset => {
          const isSelected = lab.selectedStyleId === preset.style_id;
          const isCustom = !PRESET_STYLE_PACKAGES.some(p => p.style_id === preset.style_id);
          return (
            <div
              key={preset.style_id}
              className={`style-card ${isSelected ? 'active' : ''}`}
              onClick={() => !busy && handleSelectPreset(preset)}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
            >
              <div className="style-card-header">
                <strong>{preset.style_name}</strong>
                <div className="style-tags-right">
                  {isCustom && <span className="custom-pill">自定义</span>}
                  {isSelected && <span className="active-tag">当前应用</span>}
                  {isCustom && (
                    <button
                      type="button"
                      className="delete-style-btn"
                      title="删除此自定义风格"
                      onClick={e => handleDeleteCustomStyle(e, preset.style_id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <p className="style-desc">{preset.style_description}</p>
              <div className="scope-tags">
                {(preset.style_scope || []).map(scope => (
                  <span key={scope} className="scope-tag">
                    {STYLE_SCOPE_LABELS[scope] || scope}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="style-editor">
        <label className="field-block">
          <span className="field-label">
            <strong>风格正向规则词</strong>
            <small>影响色彩、光照、像素颗粒度与氛围</small>
          </span>
          <textarea
            value={activeStyleText}
            disabled={busy}
            maxLength={1000}
            rows={3}
            onChange={e => onUpdateLab({ customStyleText: e.target.value })}
            placeholder="填写风格与氛围规则词..."
          />
        </label>

        <label className="field-block">
          <span className="field-label">
            <strong>风格负向过滤词</strong>
            <small>排除破坏该画风的元素</small>
          </span>
          <input
            type="text"
            value={activeNegativeText}
            disabled={busy}
            maxLength={500}
            onChange={e => onUpdateLab({ customNegativeText: e.target.value })}
            placeholder="填写风格排除词..."
          />
        </label>
      </div>
    </section>
  );
};
