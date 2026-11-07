import React, { useState, useEffect, useRef } from 'react';
import {
  PRESET_STYLE_PACKAGES,
  STYLE_SCOPE_LABELS,
  type StylePackage,
  type StyleReferenceImage,
  type StyleMode
} from '../domain/experiment-rules.js';
import {
  loadAllCustomStyles,
  saveCustomStyle,
  saveAllCustomStyles,
  deleteCustomStyle,
  loadPresetOverrides,
  savePresetOverride
} from '../domain/style-storage.js';
import { compressAndScaleImage } from '../domain/workbench-storage.js';
import type { LabConfig } from './flow.js';

interface StylePlaygroundProps {
  lab: LabConfig;
  busy: boolean;
  onUpdateLab: (patch: Partial<LabConfig>) => void;
}

export const StylePlayground: React.FC<StylePlaygroundProps> = ({
  lab,
  busy,
  onUpdateLab
}) => {
  const [customStyles, setCustomStyles] = useState<StylePackage[]>([]);
  const [presetOverrides, setPresetOverrides] = useState<Record<string, { images: StyleReferenceImage[]; mode?: StyleMode }>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newStyleName, setNewStyleName] = useState('');
  const [newStyleDesc, setNewStyleDesc] = useState('');
  const [previewImage, setPreviewImage] = useState<{ name: string; url: string } | null>(null);

  const styleFileInputRef = useRef<HTMLInputElement>(null);
  const zipFileInputRef = useRef<HTMLInputElement>(null);
  const replaceImgInputRef = useRef<HTMLInputElement>(null);
  const [replaceTargetImgId, setReplaceTargetImgId] = useState<string | null>(null);

  // 初始化从 IndexedDB 加载自定义风格包与预设覆盖
  useEffect(() => {
    let mounted = true;
    Promise.all([loadAllCustomStyles(), loadPresetOverrides()]).then(([styles, overrides]) => {
      if (mounted) {
        setCustomStyles(styles);
        setPresetOverrides(overrides);
      }
    });
    return () => { mounted = false; };
  }, []);

  // 合并预设与自定义风格包，并应用持久化的覆盖
  const allStyles: StylePackage[] = [
    ...PRESET_STYLE_PACKAGES.map(p => {
      const override = presetOverrides[p.style_id];
      return {
        ...p,
        style_mode: override?.mode || p.style_mode || 'text_and_image',
        style_reference_images: override?.images || p.style_reference_images || []
      };
    }),
    ...customStyles
  ];

  const currentStyle = allStyles.find(s => s.style_id === lab.selectedStyleId) || allStyles[0];
  const activeStyleText = lab.customStyleText !== undefined ? lab.customStyleText : currentStyle.style_text_rules;
  const activeNegativeText = lab.customNegativeText !== undefined ? lab.customNegativeText : currentStyle.style_negative_rules;
  const currentImages = currentStyle.style_reference_images || [];
  const currentMode = currentStyle.style_mode || 'text_and_image';

  // 切换选中风格（严格隔离：自动切换到新风格的文字和图片，清除上一套风格残留）
  const handleSelectPreset = (target: StylePackage) => {
    onUpdateLab({
      selectedStyleId: target.style_id,
      customStyleText: target.style_text_rules,
      customNegativeText: target.style_negative_rules
    });
  };

  // 更新当前风格的参考图列表或模式，并持久化到 IndexedDB
  const updateCurrentStyleImages = async (newImages: StyleReferenceImage[], newMode?: StyleMode) => {
    const isPreset = PRESET_STYLE_PACKAGES.some(p => p.style_id === currentStyle.style_id);
    const modeToSave = newMode !== undefined ? newMode : currentMode;

    if (isPreset) {
      const nextOverrides = {
        ...presetOverrides,
        [currentStyle.style_id]: { images: newImages, mode: modeToSave }
      };
      setPresetOverrides(nextOverrides);
      await savePresetOverride(currentStyle.style_id, { images: newImages, mode: modeToSave });
    } else {
      const updatedStyle: StylePackage = {
        ...currentStyle,
        style_mode: modeToSave,
        style_reference_images: newImages
      };
      const nextList = customStyles.map(s => s.style_id === updatedStyle.style_id ? updatedStyle : s);
      setCustomStyles(nextList);
      await saveCustomStyle(updatedStyle);
    }
  };

  // 模式切换：仅文字 vs 文字+风格参考图
  const handleModeChange = (mode: StyleMode) => {
    void updateCurrentStyleImages(currentImages, mode);
  };

  // 上传参考图（支持多张上传，角色固定为 style）
  const handleUploadImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const readPromises = Array.from(files).map(async (file) => {
      const { dataUrl, sizeBytes } = await compressAndScaleImage(file);
      return {
        id: `style-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        dataUrl,
        role: 'style' as const,
        enabled: true,
        order: currentImages.length,
        sizeBytes
      };
    });

    Promise.all(readPromises).then(newImgs => {
      const merged = [...currentImages, ...newImgs];
      void updateCurrentStyleImages(merged);
    }).catch(err => {
      alert(`图片读取失败：${err.message || '未知错误'}`);
    });

    e.target.value = '';
  };

  // 替换参考图
  const handleTriggerReplace = (imgId: string) => {
    setReplaceTargetImgId(imgId);
    replaceImgInputRef.current?.click();
  };

  const handleExecuteReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replaceTargetImgId) return;

    try {
      const { dataUrl, sizeBytes } = await compressAndScaleImage(file);
      const nextImgs = currentImages.map(img => {
        if (img.id === replaceTargetImgId) {
          return {
            ...img,
            name: file.name,
            dataUrl,
            sizeBytes
          };
        }
        return img;
      });
      void updateCurrentStyleImages(nextImgs);
    } catch (err: any) {
      alert(`替换图片失败：${err.message || '未知错误'}`);
    } finally {
      setReplaceTargetImgId(null);
      e.target.value = '';
    }
  };

  // 删除某张参考图
  const handleDeleteImage = (imgId: string) => {
    const nextImgs = currentImages.filter(img => img.id !== imgId);
    void updateCurrentStyleImages(nextImgs);
  };

  // 启用/禁用某张参考图
  const handleToggleImage = (imgId: string) => {
    const nextImgs = currentImages.map(img => {
      if (img.id === imgId) {
        return { ...img, enabled: !img.enabled };
      }
      return img;
    });
    void updateCurrentStyleImages(nextImgs);
  };

  // 排序上移/下移
  const handleMoveImage = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentImages.length) return;
    const nextImgs = [...currentImages];
    const [moved] = nextImgs.splice(index, 1);
    nextImgs.splice(targetIndex, 0, moved);
    void updateCurrentStyleImages(nextImgs);
  };

  // 新建风格
  const handleCreateStyle = async () => {
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
      style_scope: ['color', 'lighting', 'atmosphere', 'pixel_density'],
      style_mode: 'text_and_image'
    };
    const nextList = [...customStyles, newStyle];
    setCustomStyles(nextList);
    await saveCustomStyle(newStyle);
    handleSelectPreset(newStyle);
    setIsCreating(false);
    setNewStyleName('');
    setNewStyleDesc('');
  };

  // 导出单风格 JSON（包含文字与内嵌参考图）
  const handleExportSingleStyle = () => {
    const exportData = {
      schema_version: 'style-package-v1',
      exported_at: new Date().toISOString(),
      style: {
        style_id: currentStyle.style_id,
        style_name: currentStyle.style_name,
        style_description: currentStyle.style_description,
        style_text_rules: activeStyleText,
        style_negative_rules: activeNegativeText,
        style_scope: currentStyle.style_scope || ['color', 'lighting', 'atmosphere'],
        style_mode: currentMode,
        style_reference_images: currentImages
      }
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `style-${currentStyle.style_name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 导出全套风格 ZIP（包含当前所有风格的文字和图片）
  const handleExportAllStylesZip = async () => {
    try {
      const res = await fetch('/api/style/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styles: allStyles })
      });
      if (!res.ok) {
        let msg = `服务端返回状态码 ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson.error) msg = errJson.error;
        } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Life_Map_All_Styles_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      alert(`导出全套风格 ZIP 失败：${err.message || '未知错误'}`);
    }
  };

  // 导入单风格 JSON（支持解析包含图片的单风格文件）
  const handleImportSingleJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const s = data.style || data;
        if (!s.style_name || !s.style_text_rules) {
          throw new Error('风格包缺少必要的名称或规则词');
        }
        const refImgs: StyleReferenceImage[] = Array.isArray(s.style_reference_images)
          ? s.style_reference_images.map((img: any, i: number) => ({
              id: img.id || `style-img-${Date.now()}-${i}`,
              name: img.name || `image_${i + 1}.png`,
              dataUrl: img.dataUrl || '',
              role: 'style' as const,
              enabled: img.enabled !== false,
              order: i,
              sizeBytes: img.sizeBytes || 0
            }))
          : [];

        const stableId = s.style_id || `custom-imported-${Date.now()}`;
        const imported: StylePackage = {
          style_id: stableId,
          style_name: s.style_name,
          style_description: s.style_description || '导入的自定义风格',
          style_text_rules: s.style_text_rules,
          style_negative_rules: s.style_negative_rules || '',
          style_reference_images: refImgs,
          style_scope: Array.isArray(s.style_scope) ? s.style_scope : ['color', 'lighting', 'atmosphere'],
          style_mode: s.style_mode || (refImgs.length > 0 ? 'text_and_image' : 'text_only')
        };

        const nextList = [...customStyles.filter(item => item.style_id !== imported.style_id && item.style_name !== imported.style_name), imported];
        setCustomStyles(nextList);
        await saveCustomStyle(imported);
        handleSelectPreset(imported);
        alert(`已成功导入风格【${imported.style_name}】（包含 ${refImgs.length} 张参考图）！`);
      } catch (err: any) {
        alert(`导入失败：${err.message || '文件解析错误'}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 批量导入风格 ZIP（支持一键导入九套风格包与图片，具备重复稳定ID冲突检查）
  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const res = await fetch('/api/style/import-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file
      });
      if (!res.ok) throw new Error('ZIP 包上传解析失败');
      const data = await res.json();
      const importedStyles: StylePackage[] = data.styles || [];
      if (importedStyles.length === 0) {
        alert('ZIP 包中未找到合法的风格包定义 JSON。');
        return;
      }

      // 冲突检测：检查是否存在相同 style_id 的现有风格
      const existingIds = new Set(allStyles.map(s => s.style_id));
      const conflictStyles = importedStyles.filter(s => existingIds.has(s.style_id));

      let shouldOverwrite = true;
      if (conflictStyles.length > 0) {
        const confirmMsg = `在导入的 ${importedStyles.length} 套风格中，发现 ${conflictStyles.length} 套风格的 ID（如 ${conflictStyles.map(c => c.style_name).slice(0, 3).join(', ')}...）已存在。\n\n点击【确定】将覆盖已有风格；点击【取消】将跳过重复项只导入新风格。`;
        shouldOverwrite = confirm(confirmMsg);
      }

      // 根据用户选择合并
      const stylesToApply: StylePackage[] = [];
      const updatedCustomMap = new Map<string, StylePackage>(customStyles.map(s => [s.style_id, s]));
      const nextPresetOverrides = { ...presetOverrides };

      for (const imp of importedStyles) {
        const isConflict = existingIds.has(imp.style_id);
        if (isConflict && !shouldOverwrite) {
          continue; // 跳过重复项
        }

        const isPreset = PRESET_STYLE_PACKAGES.some(p => p.style_id === imp.style_id);
        if (isPreset) {
          nextPresetOverrides[imp.style_id] = {
            images: imp.style_reference_images || [],
            mode: imp.style_mode || 'text_and_image'
          };
          await savePresetOverride(imp.style_id, nextPresetOverrides[imp.style_id]);
        } else {
          updatedCustomMap.set(imp.style_id, imp);
        }
        stylesToApply.push(imp);
      }

      const finalCustomList = Array.from(updatedCustomMap.values());
      setCustomStyles(finalCustomList);
      setPresetOverrides(nextPresetOverrides);
      await saveAllCustomStyles(finalCustomList);

      if (stylesToApply.length > 0) {
        handleSelectPreset(stylesToApply[0]);
      }

      alert(`成功批量导入 ${stylesToApply.length} 套风格（共识别 ${importedStyles.length} 套）！已自动保存到本地数据库。`);
    } catch (err: any) {
      alert(`导入 ZIP 失败：${err.message || '未知错误'}`);
    } finally {
      e.target.value = '';
    }
  };

  // 删除自定义风格
  const handleDeleteCustomStyle = async (e: React.MouseEvent, styleId: string) => {
    e.stopPropagation();
    if (!confirm('确定删除此自定义风格包吗？')) return;
    const nextList = customStyles.filter(s => s.style_id !== styleId);
    setCustomStyles(nextList);
    await deleteCustomStyle(styleId);
    if (lab.selectedStyleId === styleId) {
      handleSelectPreset(PRESET_STYLE_PACKAGES[0]);
    }
  };

  return (
    <section className="paper lab-section" aria-label="风格化实验场">
      <div className="section-title">
        <div>
          <h2>🎨 风格化实验场</h2>
          <span className="badge">文字提示词 + 风格参考图</span>
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
            onClick={handleExportSingleStyle}
            title="将当前选中的风格导出为单 JSON（含参考图）"
          >
            📤 导出单风格 JSON
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={handleExportAllStylesZip}
            title="将当前所有风格及图片打包导出为 ZIP"
          >
            📦 导出全套风格 ZIP
          </button>
          <label className="button secondary file-upload-btn" title="导入单个风格 JSON">
            📥 导入单风格 JSON
            <input
              ref={styleFileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportSingleJson}
            />
          </label>
          <label className="button primary file-upload-btn" title="批量导入包含九套风格或图文参考包的 ZIP">
            📦 批量导入风格 ZIP
            <input
              ref={zipFileInputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={handleImportZip}
            />
          </label>
        </div>
      </div>

      <p className="hint">
        每套风格独立维护文字规则与风格参考图，角色固定为 Style。生图时当前风格图与 Structure、Scale 独立合并，严禁跨风格混杂；风格图仅传达画风与笔触，绝不复制原图建筑。
      </p>

      {/* 新建风格表单弹窗 */}
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

      {/* 隐藏的替换图片 input */}
      <input
        ref={replaceImgInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={handleExecuteReplace}
      />

      {/* 风格卡片网格 */}
      <div className="style-presets-grid">
        {allStyles.map(preset => {
          const isSelected = lab.selectedStyleId === preset.style_id;
          const isCustom = !PRESET_STYLE_PACKAGES.some(p => p.style_id === preset.style_id);
          const imgCount = (preset.style_reference_images || []).length;
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
                  {imgCount > 0 && <span className="style-img-pill">🖼️ {imgCount} 图</span>}
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

      {/* 当前选中风格的图文协同控制台 */}
      <div className="style-editor">
        <div className="style-editor-header">
          <div>
            <h3>🎨 当前编辑风格：【{currentStyle.style_name}】</h3>
            <span className="hint">ID: {currentStyle.style_id}</span>
          </div>
          {/* 模式切换单选 */}
          <div className="style-mode-switcher">
            <label className={`mode-option ${currentMode === 'text_only' ? 'active' : ''}`}>
              <input
                type="radio"
                name="styleMode"
                value="text_only"
                checked={currentMode === 'text_only'}
                onChange={() => handleModeChange('text_only')}
              />
              仅文字提示词
            </label>
            <label className={`mode-option ${currentMode === 'text_and_image' ? 'active' : ''}`}>
              <input
                type="radio"
                name="styleMode"
                value="text_and_image"
                checked={currentMode === 'text_and_image'}
                onChange={() => handleModeChange('text_and_image')}
              />
              文字 + 风格参考图 (图生图)
            </label>
          </div>
        </div>

        {/* 风格专属参考图管理区 */}
        {currentMode === 'text_and_image' && (
          <div className="style-images-manager paper elevation-1">
            <div className="style-images-header">
              <div>
                <strong>🖼️ 风格专属参考图 ({currentImages.length} 张，已启用 {currentImages.filter(i => i.enabled).length} 张)</strong>
                <p className="hint">
                  图片角色固定为 <code>style</code>。仅学习绘画笔触、色调、材质画法与光影氛围；严禁复制原图建筑，绝不覆盖 Structure 和 Scale 的约束。
                </p>
              </div>
              <label className="button primary file-upload-btn">
                ➕ 上传风格参考图
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleUploadImages}
                />
              </label>
            </div>

            {currentImages.length === 0 ? (
              <div className="empty-style-images">
                暂无风格参考图。您可以点击右上方【➕ 上传风格参考图】为此风格绑定图片，或直接使用文字规则生成。
              </div>
            ) : (
              <div className="style-image-cards-grid">
                {currentImages.map((img, idx) => (
                  <div key={img.id} className={`style-image-card ${img.enabled ? 'enabled' : 'disabled'}`}>
                    <div className="style-img-preview-box" onClick={() => setPreviewImage({ name: img.name, url: img.dataUrl })}>
                      <img src={img.dataUrl} alt={img.name} />
                      <span className="zoom-hint">🔍 查看大图</span>
                    </div>
                    <div className="style-img-info">
                      <div className="style-img-title" title={img.name}>
                        <span className="order-badge">#{idx + 1}</span> {img.name}
                      </div>
                      <div className="style-img-meta">
                        <span className="role-tag style">Style 画风图</span>
                        {img.sizeBytes ? <span>{(img.sizeBytes / 1024).toFixed(1)} KB</span> : null}
                      </div>
                    </div>
                    <div className="style-img-controls">
                      <label className="toggle-label" title={img.enabled ? '已启用（将参与生图）' : '已禁用（不参与生图）'}>
                        <input
                          type="checkbox"
                          checked={img.enabled}
                          onChange={() => handleToggleImage(img.id)}
                        />
                        {img.enabled ? '已启用' : '已禁用'}
                      </label>
                      <div className="style-img-btn-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          title="上移"
                          disabled={idx === 0}
                          onClick={() => handleMoveImage(idx, 'up')}
                        >
                          ⬆️
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="下移"
                          disabled={idx === currentImages.length - 1}
                          onClick={() => handleMoveImage(idx, 'down')}
                        >
                          ⬇️
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="替换图片"
                          onClick={() => handleTriggerReplace(img.id)}
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className="icon-btn delete"
                          title="删除"
                          onClick={() => handleDeleteImage(img.id)}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

      {/* 大图预览模态框 */}
      {previewImage && (
        <div className="image-preview-modal-overlay" onClick={() => setPreviewImage(null)}>
          <div className="image-preview-modal-content paper" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong>{previewImage.name}</strong>
              <button type="button" className="close-btn" onClick={() => setPreviewImage(null)}>×</button>
            </div>
            <div className="modal-img-container">
              <img src={previewImage.url} alt={previewImage.name} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
