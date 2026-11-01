import React, { useState, useEffect } from 'react';
import type { Workbench } from './flow.js';
import { PRESET_STYLE_PACKAGES } from '../domain/experiment-rules.js';

interface ArchivePlaygroundProps {
  workbench: Workbench;
  onNavigateToMain: () => void;
}

export const ArchivePlayground: React.FC<ArchivePlaygroundProps> = ({
  workbench,
  onNavigateToMain
}) => {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterMode, setFilterMode] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStyle, setFilterStyle] = useState<string>('all');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  const loadRuns = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterMode !== 'all') params.set('mode', filterMode);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      if (filterStyle !== 'all') params.set('style_id', filterStyle);
      const res = await fetch(`/api/archive/runs?${params.toString()}`);
      if (!res.ok) throw new Error(`加载失败 (${res.status})`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载档案馆列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRuns();
  }, [filterMode, filterStatus, filterStyle]);

  const importZipFiles = async (files: File[]) => {
    if (!files.length) return;
    setLoading(true);
    setError('');
    setActionNotice(`正在导入 ${files.length} 个实验档案 ZIP...`);
    let successCount = 0;
    let failCount = 0;
    for (const file of files) {
      try {
        const res = await fetch('/api/archive/import-zip', {
          method: 'POST',
          headers: { 'content-type': 'application/zip' },
          body: file
        });
        if (res.ok) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }
    setActionNotice(`同步完成：已成功导入 ${successCount} 个实验档案${failCount > 0 ? `，失败 ${failCount} 个` : ''}！`);
    await loadRuns();
    setLoading(false);
  };

  const handleImportZipInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      files.push(fileList[i]);
    }
    await importZipFiles(files);
    e.target.value = '';
  };

  const handlePickDirectory = async () => {
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      alert('当前浏览器环境未开放直接选择文件夹 API，请使用右侧【📥 批量导入 ZIP】按钮，支持直接框选多个 ZIP 文件一次性导入！');
      return;
    }
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const zipFiles: File[] = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.zip')) {
          const file = await entry.getFile();
          zipFiles.push(file);
        }
      }
      if (zipFiles.length === 0) {
        setActionNotice(`文件夹【${dirHandle.name}】中未找到 .zip 归档文件。请将导出的实验 zip 放入该目录后重试。`);
        return;
      }
      setActionNotice(`在文件夹【${dirHandle.name}】中发现 ${zipFiles.length} 个实验归档包，开始同步...`);
      await importZipFiles(zipFiles);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || '读取文件夹失败');
      }
    }
  };

  const handleExportZip = (runId: string) => {
    window.open(`/api/archive/runs/${runId}/export-zip`, '_blank');
  };

  const toggleCompare = (runId: string) => {
    if (compareIds.includes(runId)) {
      setCompareIds(compareIds.filter(id => id !== runId));
    } else {
      if (compareIds.length >= 2) {
        setCompareIds([compareIds[1], runId]);
      } else {
        setCompareIds([...compareIds, runId]);
      }
    }
  };

  const handleReuseInput = (run: any) => {
    try {
      workbench.restoreFromRun(run, 'input_only');
      setActionNotice('已成功复用日记输入，已载入生图准备阶段。');
      onNavigateToMain();
    } catch (err) {
      setError(err instanceof Error ? err.message : '复用失败');
    }
  };

  const handleReuseFull = (run: any) => {
    try {
      workbench.restoreFromRun(run, 'full_rules');
      setActionNotice('已成功复用完整实验配置，已载入生图准备阶段。');
      onNavigateToMain();
    } catch (err) {
      setError(err instanceof Error ? err.message : '复用失败');
    }
  };

  const selectedRun = runs.find(r => r.experiment_id === selectedRunId);
  const compareRuns = compareIds.map(id => runs.find(r => r.experiment_id === id)).filter(Boolean);

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const zipFiles: File[] = [];
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const file = e.dataTransfer.files[i];
      if (file.name.toLowerCase().endsWith('.zip')) {
        zipFiles.push(file);
      }
    }
    if (zipFiles.length > 0) {
      await importZipFiles(zipFiles);
    }
  };

  return (
    <section
      className="paper archive-playground"
      aria-label="本地实验档案馆"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDropFiles}
    >
      <div className="section-title">
        <div>
          <h2>🏛️ 本地实验档案馆</h2>
          <span className="badge">历史实验持久化与跨版本对比</span>
        </div>
        <div className="archive-actions">
          <button
            type="button"
            className="button secondary"
            onClick={handlePickDirectory}
            disabled={loading}
            title="选择本地存放实验 ZIP 的文件夹，一键扫描并载入全部历史实验"
          >
            📁 关联本地 ZIP 文件夹
          </button>
          <label className="button secondary file-upload-btn" title="支持同时框选多个 ZIP 归档文件导入">
            📥 批量导入 ZIP
            <input
              type="file"
              accept=".zip"
              multiple
              onChange={handleImportZipInput}
              style={{ display: 'none' }}
            />
          </label>
          <button className="button secondary" onClick={() => loadRuns()} disabled={loading}>
            🔄 刷新列表
          </button>
        </div>
      </div>

      <div className="archive-db-banner">
        <span>💡 <strong>本地持久化机制</strong>：每次生图提交均已自动原子写入本地磁盘（<code>.local/experiment-archive/</code>）。你也可以将每次下载的 ZIP 统一归纳在任意本地文件夹中，点击【📁 关联本地 ZIP 文件夹】或直接将多个 ZIP 拖入本界面，即可随时全量同步并还原图片与规则！</span>
      </div>

      {actionNotice && <div className="toast success">{actionNotice}</div>}
      {error && <div className="toast error">{error}</div>}

      {/* 筛选工具栏 */}
      <div className="archive-filters">
        <div className="filter-group">
          <label>实验模式：</label>
          <select value={filterMode} onChange={e => setFilterMode(e.target.value)}>
            <option value="all">全部模式</option>
            <option value="text_to_image">文生图 (Text-to-Image)</option>
            <option value="image_to_image">图生图 (Image-to-Image)</option>
          </select>
        </div>

        <div className="filter-group">
          <label>状态：</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="completed">已完成 / 选定</option>
            <option value="pending">生成中 / 待确认</option>
          </select>
        </div>

        <div className="filter-group">
          <label>风格包：</label>
          <select value={filterStyle} onChange={e => setFilterStyle(e.target.value)}>
            <option value="all">全部风格</option>
            {PRESET_STYLE_PACKAGES.map(s => (
              <option key={s.style_id} value={s.style_id}>{s.style_name}</option>
            ))}
          </select>
        </div>

        <div className="filter-group compare-switch">
          <button
            className={`button ${isComparing ? 'primary' : 'secondary'}`}
            disabled={compareIds.length !== 2}
            onClick={() => setIsComparing(!isComparing)}
          >
            ⚖️ 跨实验 A/B 对比 ({compareIds.length}/2)
          </button>
          {compareIds.length > 0 && (
            <button className="button text" onClick={() => { setCompareIds([]); setIsComparing(false); }}>
              清空选择
            </button>
          )}
        </div>
      </div>

      {/* A/B 对比视图 */}
      {isComparing && compareRuns.length === 2 && (
        <div className="archive-compare-panel paper elevation-2">
          <div className="compare-header">
            <h3>⚖️ 跨实验 A/B 并排对比</h3>
            <button className="button secondary" onClick={() => setIsComparing(false)}>关闭对比</button>
          </div>
          <div className="compare-grid">
            {compareRuns.map((run, idx) => {
              const label = idx === 0 ? '实验 A' : '实验 B';
              const bestCandidate = run.candidates?.find((c: any) => c.is_selected) || run.candidates?.[0];
              return (
                <div key={run.experiment_id} className="compare-column paper">
                  <div className="compare-col-header">
                    <h4>{label}（{run.experiment_id.slice(0, 8)}）</h4>
                    <span className="badge">{run.experiment_mode === 'image_to_image' ? '图生图' : '文生图'}</span>
                  </div>

                  <div className="compare-image-box">
                    {bestCandidate?.image_url ? (
                      <img src={bestCandidate.image_url} alt="透明方案图" className="compare-preview-img checkerboard" />
                    ) : bestCandidate?.original_image_url ? (
                      <img src={bestCandidate.original_image_url} alt="原方案图" className="compare-preview-img" />
                    ) : (
                      <div className="empty-img">暂无图像</div>
                    )}
                    <span className="caption">
                      方案：{bestCandidate?.id || 'candidate_1'} {bestCandidate?.review_status === 'approved' ? '· 人工已审核' : ''}
                    </span>
                  </div>

                  <div className="compare-meta">
                    <p><strong>风格包：</strong> {run.style_package?.name || '默认'}</p>
                    <p><strong>重点事项：</strong> {run.diary_case?.focuses?.map((f: any) => f.title).join('； ') || '无'}</p>
                    <div className="rules-preview">
                      <strong>Prompt 核心词：</strong>
                      <div className="code-snippet">{bestCandidate?.prompt || '未记录'}</div>
                    </div>
                    {run.experiment_mode === 'image_to_image' && (
                      <div className="rules-preview">
                        <strong>图生图规则：</strong>
                        <div className="code-snippet">
                          保留：{run.i2i_rules?.preservationRules || '无'}<br />
                          变化：{run.i2i_rules?.variationRules || '无'}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="compare-actions">
                    <button className="button secondary" onClick={() => handleReuseInput(run)}>复用此日记</button>
                    <button className="button primary" onClick={() => handleReuseFull(run)}>复用此配置</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 历史卡片列表 */}
      {loading ? (
        <div className="loading-box">正在读取实验档案馆...</div>
      ) : runs.length === 0 ? (
        <div className="empty-box">暂无符合条件的实验记录。提交生图后将自动归档。</div>
      ) : (
        <div className="archive-cards-grid">
          {runs.map(run => {
            const bestCandidate = run.candidates?.find((c: any) => c.is_selected) || run.candidates?.[0];
            const isCompared = compareIds.includes(run.experiment_id);
            const isSelected = selectedRunId === run.experiment_id;
            return (
              <div
                key={run.experiment_id}
                className={`archive-card paper ${isCompared ? 'compare-selected' : ''} ${isSelected ? 'active' : ''}`}
              >
                <div className="card-top">
                  <div className="card-id-row">
                    <span className="card-id" title={run.experiment_id}>
                      #{run.experiment_id.slice(0, 8)}
                    </span>
                    <span className={`status-tag ${run.status}`}>
                      {run.status === 'completed' ? '已选定' : '已生成'}
                    </span>
                  </div>
                  <div className="card-date">{new Date(run.created_at).toLocaleString()}</div>
                </div>

                <div className="card-thumb-area" onClick={() => setSelectedRunId(run.experiment_id)}>
                  {bestCandidate?.image_url ? (
                    <img src={bestCandidate.image_url} alt="方案预览" className="card-thumb checkerboard" />
                  ) : bestCandidate?.original_image_url ? (
                    <img src={bestCandidate.original_image_url} alt="原图预览" className="card-thumb" />
                  ) : (
                    <div className="card-thumb-empty">无生成图像</div>
                  )}
                  <div className="thumb-badge">
                    {run.experiment_mode === 'image_to_image' ? '🖼️ 图生图' : '✍️ 文生图'}
                  </div>
                </div>

                <div className="card-info">
                  <div className="card-style-title">{run.style_package?.name || '默认风格'}</div>
                  <div className="card-focus-text">
                    {run.diary_case?.focuses?.map((f: any) => f.title).join('、') || '生活日常'}
                  </div>
                </div>

                <div className="card-bottom-actions">
                  <label className="compare-checkbox">
                    <input
                      type="checkbox"
                      checked={isCompared}
                      onChange={() => toggleCompare(run.experiment_id)}
                    />
                    A/B 对比
                  </label>
                  <div className="btn-group">
                    <button
                      className="button text"
                      onClick={() => setSelectedRunId(run.experiment_id)}
                    >
                      详情
                    </button>
                    <button
                      className="button text"
                      title="导出完整 ZIP 档案"
                      onClick={() => handleExportZip(run.experiment_id)}
                    >
                      ZIP
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 实验详情抽屉 / 弹窗 */}
      {selectedRun && (
        <div className="archive-modal-backdrop" onClick={() => setSelectedRunId(null)}>
          <div className="archive-detail-modal paper elevation-3" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>🔍 历史实验详情</h3>
                <span className="caption">ID: {selectedRun.experiment_id} · 创建于 {new Date(selectedRun.created_at).toLocaleString()}</span>
              </div>
              <button className="button text close-btn" onClick={() => setSelectedRunId(null)}>✕</button>
            </div>

            <div className="modal-content">
              {/* 日记与重点 */}
              <div className="detail-section">
                <h4>📝 日记输入与重点事实</h4>
                <div className="diary-notes-box">
                  {selectedRun.diary_case?.notes?.map((n: string, i: number) => (
                    <div key={i} className="note-item">{n}</div>
                  )) || <p>{selectedRun.diary_case?.raw_text || '无日记文本'}</p>}
                </div>
                <div className="focus-pills">
                  {selectedRun.diary_case?.focuses?.map((f: any) => (
                    <div key={f.event_id} className="focus-pill">
                      <strong>{f.title}</strong>
                      {f.evidence && <span className="evidence">“{f.evidence}”</span>}
                    </div>
                  ))}
                </div>
                {selectedRun.diary_case?.answers?.length > 0 && (
                  <div className="answers-box">
                    <strong>追问细节回答：</strong>
                    <ul>
                      {selectedRun.diary_case.answers.map((a: any, i: number) => (
                        <li key={i}>{a.question_text}: <strong>{a.final_answer}</strong></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 风格与图生图规则 */}
              <div className="detail-section">
                <h4>🎨 实验配置规则快照</h4>
                <div className="rules-grid">
                  <div>
                    <strong>风格包：</strong> {selectedRun.style_package?.name || '默认'}
                    <div className="code-snippet">{selectedRun.style_package?.style_text_rules || '无额外风格词'}</div>
                  </div>
                  <div>
                    <strong>负面规则：</strong>
                    <div className="code-snippet">{selectedRun.style_package?.negative_rules || '无负面规则'}</div>
                  </div>
                </div>

                {selectedRun.experiment_mode === 'image_to_image' && (
                  <div className="i2i-rules-detail">
                    <strong>图生图规则词：</strong>
                    <div className="code-snippet">
                      <p><strong>角色定义：</strong>{selectedRun.i2i_rules?.roleInstructions}</p>
                      <p><strong>保留要素：</strong>{selectedRun.i2i_rules?.preservationRules}</p>
                      <p><strong>变化要素：</strong>{selectedRun.i2i_rules?.variationRules}</p>
                      <p><strong>禁止事项：</strong>{selectedRun.i2i_rules?.prohibitions}</p>
                    </div>
                  </div>
                )}

                {selectedRun.reference_images?.length > 0 && (
                  <div className="reference-images-detail">
                    <strong>参考图列表：</strong>
                    <div className="ref-imgs-list">
                      {selectedRun.reference_images.map((img: any) => (
                        <div key={img.id} className="ref-img-card">
                          <img src={img.dataUrl} alt={img.name} />
                          <span>{img.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 候选方案结果 */}
              <div className="detail-section">
                <h4>🖼️ 生成方案与审核结果</h4>
                <div className="candidates-result-grid">
                  {selectedRun.candidates?.map((c: any) => (
                    <div key={c.id} className={`candidate-result-card ${c.is_selected ? 'selected' : ''}`}>
                      <div className="c-header">
                        <strong>方案 {c.id === 'candidate_1' ? 'A' : 'B'}</strong>
                        {c.is_selected && <span className="badge success">已选定方案</span>}
                      </div>
                      <div className="images-pair">
                        <div>
                          <div className="caption">生成原图</div>
                          {c.original_image_url ? (
                            <img src={c.original_image_url} alt="原图" />
                          ) : (
                            <div className="empty-box">无</div>
                          )}
                        </div>
                        <div>
                          <div className="caption">透明扣图</div>
                          {c.image_url ? (
                            <img src={c.image_url} alt="透明图" className="checkerboard" />
                          ) : (
                            <div className="empty-box">无</div>
                          )}
                        </div>
                      </div>
                      <div className="review-meta">
                        审核状态：{c.review_status === 'approved' ? '✅ 人工审核通过' : '待审核'}
                      </div>
                      {c.audit_report && (
                        <details style={{ marginTop: '8px', fontSize: '11px', textAlign: 'left' }}>
                          <summary style={{ cursor: 'pointer', color: '#385e2b', fontWeight: 600 }}>🔬 生成审计与 Prompt 拆解（{c.audit_report.total_prompt_chars} 字）</summary>
                          <div style={{ background: '#f5f8f3', padding: '6px 8px', borderRadius: '6px', marginTop: '4px' }}>
                            <div><strong>阶段：</strong>{c.audit_report.stage} · <strong>状态码：</strong>{c.audit_report.http_meta?.status_code || 200}</div>
                            {c.audit_report.request_id && <div><strong>百炼 Request ID：</strong><code>{c.audit_report.request_id}</code></div>}
                            <div><strong>Prompt 段长：</strong>场景 {c.audit_report.prompt_segments?.scene_content || 0} / 结构 {c.audit_report.prompt_segments?.structure_rules || 0} / 尺度 {c.audit_report.prompt_segments?.scale_rules || 0} / 风格 {c.audit_report.prompt_segments?.style_package || 0} / 透明 {c.audit_report.prompt_segments?.transparency_rules || 0}</div>
                            <div><strong>请求体度量：</strong>参考图 {c.audit_report.images_meta?.count || 0} 张 · 预估大小 {Math.round((c.audit_report.images_meta?.estimated_request_payload_bytes || 0) / 1024)} KB</div>
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 模态框底部复用与导出操作 */}
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => handleExportZip(selectedRun.experiment_id)}
              >
                📦 导出此实验 ZIP
              </button>
              <div className="btn-group">
                <button
                  className="button secondary"
                  onClick={() => handleReuseInput(selectedRun)}
                >
                  📝 仅复用日记输入
                </button>
                <button
                  className="button primary"
                  onClick={() => handleReuseFull(selectedRun)}
                >
                  🔁 复用完整实验配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
