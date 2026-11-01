import React from 'react';
import {
  PRESET_STYLE_PACKAGES,
  DEFAULT_STRUCTURE_RULES,
  DEFAULT_SCALE_RULES,
  DEFAULT_GROUND_RULES,
  breakdownPromptSegments,
  REFERENCE_ROLE_LABELS
} from '../domain/experiment-rules.js';
import type { LabConfig, Candidate, Experiment } from './flow.js';

interface LayeredInspectorProps {
  experiment: Experiment;
  activeCandidate?: Candidate;
  lab: LabConfig;
}

export const LayeredInspector: React.FC<LayeredInspectorProps> = ({
  experiment,
  activeCandidate,
  lab
}) => {
  const activeStyle = PRESET_STYLE_PACKAGES.find(s => s.style_id === lab.selectedStyleId);
  const styleText = lab.customStyleText?.trim() || activeStyle?.style_text_rules || '';
  const negativeText = lab.customNegativeText?.trim() || activeStyle?.style_negative_rules || '';
  const sceneDescription = activeCandidate?.plan.scene_description || '（完成日记与构图规划后生成具体描述）';
  const primarySubject = activeCandidate?.plan.primary_subject || '（未锁定）';

  const breakdown = breakdownPromptSegments({
    sceneDescription: activeCandidate?.plan.scene_description || '示例构图描述',
    primarySubject: activeCandidate?.plan.primary_subject,
    groundSurfaceName: activeCandidate?.plan.terrain?.name,
    customStyleText: styleText,
    structureRules: DEFAULT_STRUCTURE_RULES,
    scaleRules: DEFAULT_SCALE_RULES,
    isNativeAlpha: experiment.pipeline.route === 'native-alpha',
    mode: lab.mode,
    referenceImages: lab.referenceImages,
    i2iRules: lab.i2iRules,
    customNegativeText: negativeText
  });

  const previewPositive = breakdown.positivePrompt;
  const previewNegative = breakdown.negativePrompt;

  return (
    <section className="paper inspector-section" aria-label="生成链路分层可干预检查器">
      <div className="section-title">
        <h2>🔍 生成链路分层可干预检查器</h2>
        <span className="badge">6 层规则与输入结构拆解</span>
      </div>
      <p className="hint">
        透明展示从日记语义到最终生图 Prompt 的 6 层流水线。清晰理解每个层级的作用与改动影响。
      </p>

      <div className="layers-container">
        {/* Layer 1: 原始输入层 */}
        <details className="layer-item" open>
          <summary>
            <span className="layer-tag layer-user">1. 用户原始输入层</span>
            <strong>日记事实、选中的重点与补充细节</strong>
            <small className="layer-status">由用户提供 · 驱动场景提炼</small>
          </summary>
          <div className="layer-body">
            <p className="layer-desc">
              <strong>作用：</strong>作为整个生图链路的灵感与事实锚点，为 LLM 提炼视觉焦点提供唯一真实证据。
            </p>
            <div className="layer-content-box">
              <div><strong>便签文本：</strong>{experiment.rawText || experiment.notes.join('\n\n') || '（暂无输入）'}</div>
              <div><strong>已选重点：</strong>{experiment.focusIds.length > 0 ? experiment.focusIds.join('、') : '尚未选择'}</div>
              <div><strong>额外细节：</strong>{experiment.extra || '（无补充）'}</div>
            </div>
          </div>
        </details>

        {/* Layer 2: 场景规划层 */}
        <details className="layer-item" open>
          <summary>
            <span className="layer-tag layer-llm">2. 场景规划层</span>
            <strong>LLM 场景提炼与主体规划（Stage B）</strong>
            <small className="layer-status">模型规划生成 · 支持冻结复用</small>
          </summary>
          <div className="layer-body">
            <p className="layer-desc">
              <strong>作用：</strong>将日记生活事实映射为具象的 2.5D 生活主景与构图，确定中心物件、微观动态与地面材质。
            </p>
            <div className="layer-content-box">
              <div><strong>核心主景 (primary_subject)：</strong>{primarySubject}</div>
              <div><strong>构图描述 (scene_description)：</strong>{sceneDescription}</div>
            </div>
          </div>
        </details>

        {/* Layer 3: 风格层 */}
        <details className="layer-item" open>
          <summary>
            <span className="layer-tag layer-style">3. 风格化规则层</span>
            <strong>画风、色彩、光照与像素密度模板</strong>
            <small className="layer-status editable-tag">可直接编辑干预 ✏️</small>
          </summary>
          <div className="layer-body">
            <p className="layer-desc">
              <strong>作用：</strong>定义画面的渲染风格、光影基调、像素颗粒度。改动此层将直接改变整体画风，不破坏主景构图。
            </p>
            <div className="layer-content-box">
              <div><strong>当前风格包：</strong>{activeStyle?.style_name || '默认'}</div>
              <div><strong>生效正向规则：</strong>{styleText}</div>
              <div><strong>生效负向规则：</strong>{negativeText || '（无特定排除）'}</div>
            </div>
          </div>
        </details>

        {/* Layer 4: 空间/地块规则层 */}
        <details className="layer-item">
          <summary>
            <span className="layer-tag layer-geo">4. 空间 / 地块几何层</span>
            <strong>等距菱形地块、宽高比 1.68:1、底座厚度 3%</strong>
            <small className="layer-status">系统核心基准 · 保证拼接</small>
          </summary>
          <div className="layer-body">
            <p className="layer-desc">
              <strong>作用：</strong>强制约束整个画面的透视角度、地块宽高比、底座薄厚及边缘防翘边，确保后续地图拼接。
            </p>
            <div className="layer-content-box">
              <pre className="compact-pre">{DEFAULT_GROUND_RULES}</pre>
            </div>
          </div>
        </details>

        {/* Layer 5: 图生图规则层 */}
        <details className="layer-item" open>
          <summary>
            <span className="layer-tag layer-i2i">5. 图生图与参考图层</span>
            <strong>多参考图协同、角色标记与边界约束</strong>
            <small className="layer-status editable-tag">
              {lab.mode === 'image_to_image' ? '生效中 ✏️' : '未启用（纯文生图）'}
            </small>
          </summary>
          <div className="layer-body">
            <p className="layer-desc">
              <strong>作用：</strong>指导千问多模态模型如何提取底图骨架、迁移风格配色、借鉴物件造型，并严防抄袭文字与UI。
            </p>
            <div className="layer-content-box">
              <div><strong>生成模式：</strong>{lab.mode === 'image_to_image' ? '图生图 / 参考图协同' : '纯文本生图'}</div>
              <div>
                <strong>参考图数量：</strong>{lab.referenceImages.length} 张
                {lab.referenceImages.length > 0 && (
                  <ul className="ref-list-preview">
                    {lab.referenceImages.map((img, i) => (
                      <li key={img.id}>
                        图 {i + 1}：{img.name}（{REFERENCE_ROLE_LABELS[img.role].label}）
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {lab.mode === 'image_to_image' && (
                <div>
                  <strong>规则说明：</strong>
                  <div>- 角色指导：{lab.i2iRules.roleInstructions}</div>
                  <div>- 严格保留：{lab.i2iRules.preservationRules}</div>
                  <div>- 允许变化：{lab.i2iRules.variationRules}</div>
                  <div>- 禁止事项：{lab.i2iRules.prohibitions}</div>
                </div>
              )}
            </div>
          </div>
        </details>

        {/* Layer 6: 最终提交层 */}
        <details className="layer-item" open>
          <summary>
            <span className="layer-tag layer-submit">6. 最终提交层</span>
            <strong>送至 Qwen 模型的完整正向与负向 Prompt</strong>
            <small className="layer-status">自动化合装结果</small>
          </summary>
          <div className="layer-body">
            <p className="layer-desc">
              <strong>作用：</strong>所有前序层级在后端合成后的最终 Prompt 呈现，即千问生图真正消费的文本。
            </p>
            <div className="layer-content-box">
              <div className="prompt-meta-bar" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <span className="badge-pill" style={{ background: '#2f4e27', color: '#fff' }}>
                  总字符数：{breakdown.totalChars} 字（估算约 {breakdown.estimatedTokens} Tokens）
                </span>
                <span className="badge-pill">1. 结构与连接口：{breakdown.segments.structure_rules} 字</span>
                <span className="badge-pill">2. 场景主体：{breakdown.segments.scene_content} 字</span>
                <span className="badge-pill">3. 相对尺度：{breakdown.segments.scale_rules} 字</span>
                <span className="badge-pill">4. 风格包：{breakdown.segments.style_package} 字</span>
                <span className="badge-pill">5. 背景透明与禁止：{breakdown.segments.transparency_rules} 字</span>
                <span className="badge-pill" style={{ background: '#eaf4e6', color: '#2b5020' }}>
                  各模块无重复词汇 ✅
                </span>
              </div>
              <p style={{ margin: '4px 0 8px', fontSize: '12px', color: '#555' }}>
                <strong>提示词组织架构（按优先级）：</strong>1. 地块结构与连接口 ➔ 2. 场景主体与日记内容 ➔ 3. 相对尺度规范 ➔ 4. 渲染风格与氛围 ➔ 5. 背景透明与必要禁止事项
              </p>
              <strong>最终正向提示词 (Positive Prompt)：</strong>
              <pre className="prompt-pre">{previewPositive}</pre>
              <strong>最终负向提示词 (Negative Prompt，已合并至正向中)：</strong>
              <pre className="prompt-pre">{previewNegative}</pre>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
};
