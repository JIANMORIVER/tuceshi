import React from 'react';
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

export const StylePlayground: React.FC<StylePlaygroundProps> = ({
  lab,
  busy,
  onUpdateLab
}) => {
  const currentPreset = PRESET_STYLE_PACKAGES.find(s => s.style_id === lab.selectedStyleId) || PRESET_STYLE_PACKAGES[0];
  const activeStyleText = lab.customStyleText !== undefined ? lab.customStyleText : currentPreset.style_text_rules;
  const activeNegativeText = lab.customNegativeText !== undefined ? lab.customNegativeText : currentPreset.style_negative_rules;

  const handleSelectPreset = (preset: StylePackage) => {
    onUpdateLab({
      selectedStyleId: preset.style_id,
      customStyleText: preset.style_text_rules,
      customNegativeText: preset.style_negative_rules
    });
  };

  return (
    <section className="paper lab-section" aria-label="风格化实验场">
      <div className="section-title">
        <h2>🎨 风格化实验场</h2>
        <span className="badge">风格包定义与迁移</span>
      </div>
      <p className="hint">
        选择或自定义风格规则，风格将被作为【画风与氛围层】注入到最终生图 Prompt 中。支持文生图风格化与参考图风格化。
      </p>

      <div className="style-presets-grid">
        {PRESET_STYLE_PACKAGES.map(preset => {
          const isSelected = lab.selectedStyleId === preset.style_id;
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
                {isSelected && <span className="active-tag">当前应用</span>}
              </div>
              <p className="style-desc">{preset.style_description}</p>
              <div className="scope-tags">
                {preset.style_scope.map(scope => (
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
