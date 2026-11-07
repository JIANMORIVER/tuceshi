import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench,WorkbenchApi,type Candidate} from './flow.js';
import {AiModelSettings} from '../world/components/AiModelSettings.js';
import {canReviewTerrain,hasTerrainApproval,terrainUsable} from '../world/domain/terrainReview.js';
import {FOCUS_KIND_LABELS} from '../services/diary-focus.js';
import {StylePlayground} from './StylePlayground.js';
import {ImageToImagePlayground} from './ImageToImagePlayground.js';
import {LayeredInspector} from './LayeredInspector.js';
import {ArchivePlayground} from './ArchivePlayground.js';
import {
  PRESET_STYLE_PACKAGES,
  REFERENCE_ROLE_LABELS,
  type StylePackage,
  type StyleReferenceImage,
  type StyleMode
} from '../domain/experiment-rules.js';
import {loadAllCustomStyles, loadPresetOverrides} from '../domain/style-storage.js';
import './workbench.css';

const api=new WorkbenchApi();

function App(){
 const [images,setImages]=useState<Record<string,{url:string;loaded:boolean;failed:boolean;reload:number}>>({});
 const flow=useMemo(()=>new Workbench(localStorage,api),[]),[,render]=useState(0),[settings,setSettings]=useState(false),[uiError,setUiError]=useState(''),[mode,setMode]=useState('正在读取模型状态');
 const [activeTab,setActiveTab]=useState<'process'|'style'|'i2i'|'inspector'|'archive'>('process');

 // 多风格平行对照实验状态
 const [availableStyles,setAvailableStyles]=useState<StylePackage[]>(PRESET_STYLE_PACKAGES);
 const [selectedOtherStyleIds,setSelectedOtherStyleIds]=useState<string[]>([]);
 const [targetScope,setTargetScope]=useState<'all'|'candidate_1'|'candidate_2'>('all');
 const [isApplyingStyles,setIsApplyingStyles]=useState(false);
 const [showOtherStylesPanel,setShowOtherStylesPanel]=useState(false);

 const refreshStyles = async () => {
  try {
   const customList = await loadAllCustomStyles().catch(() => []);
   const presetOverrides: Record<string, { images: StyleReferenceImage[]; mode?: StyleMode }> = await loadPresetOverrides().catch(() => ({}));
   const fullList: StylePackage[] = [
    ...PRESET_STYLE_PACKAGES.map(p => {
     const override = presetOverrides[p.style_id];
     return {
      ...p,
      style_mode: override?.mode || p.style_mode || 'text_and_image',
      style_reference_images: override?.images || p.style_reference_images || []
     };
    }),
    ...customList
   ];
   setAvailableStyles(fullList);
  } catch {}
 };

 useEffect(()=>flow.subscribe(()=>render(n=>n+1)),[flow]);
 useEffect(()=>{ void refreshStyles(); },[activeTab]);
 useEffect(()=>{
  if(settings)return;
  void api.call<any>('/api/model-settings').then(s=>{
   setMode(s.textProvider==='mock'?'离线规则 · 零模型调用':`${s.textProvider} + ${s.generationRoute==='qwen-851'?'千问 / 851 Labs':'千问直接透明'}`);
   flow.syncModelSettings(s);
  }).catch(()=>setMode('模型服务不可用，请运行 npm run dev 或 npm start'));
 },[settings]);

 const e=flow.state,run=(action:()=>void|Promise<void>)=>{setUiError('');try{const result=action();if(result)void result.catch(error=>setUiError(error.message));}catch(error){setUiError(error instanceof Error?error.message:'操作失败');}};
 const update=(patch:Parameters<Workbench['edit']>[0])=>run(()=>flow.edit(patch));
 const exportData=()=>{const blob=new Blob([flow.export()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`life-map-experiment-${e.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const exportZip=async()=>{try{await flow.syncToArchive();window.open(`/api/archive/runs/${e.id}/export-zip`,'_blank');}catch(err){setUiError('导出 ZIP 档案失败，请稍后重试。');}};

 const activeCandidate = e.candidates.find(c => c.id === (e.lab.frozenCandidateId || e.selectedId || 'candidate_1')) || e.candidates[0];
 const currentStyle = PRESET_STYLE_PACKAGES.find(s=>s.style_id===e.lab.selectedStyleId);

 const groupedCandidates = useMemo(() => {
  const map = new Map<string, { styleId: string; styleName: string; candidates: Candidate[] }>();
  for (const c of e.candidates) {
   const sId = c.styleId || e.lab.selectedStyleId || 'default';
   const sName = c.styleName || availableStyles.find(s => s.style_id === sId)?.style_name || '默认风格';
   if (!map.has(sId)) {
    map.set(sId, { styleId: sId, styleName: sName, candidates: [] });
   }
   map.get(sId)!.candidates.push(c);
  }
  return Array.from(map.values());
 }, [e.candidates, e.lab.selectedStyleId, availableStyles]);

 const result=(candidate:Candidate)=>{
  const isFrozen = e.lab.frozenCandidateId === candidate.id;
  const job = candidate.job;
  const isI2I = job?.generation_mode === 'image_to_image' || (!job && e.lab.mode === 'image_to_image');
  const refCount = job?.reference_images?.length || e.lab.referenceImages.length;
  const originPlan = candidate.originCandidateId || (candidate.id.startsWith('candidate_2') ? 'candidate_2' : 'candidate_1');
  const planLabel = originPlan === 'candidate_2' ? '方案二' : '方案一';
  const candStyle = availableStyles.find(s => s.style_id === (candidate.styleId || e.lab.selectedStyleId)) || currentStyle;
  const styleLabel = candidate.styleName || candStyle?.style_name || '默认风格';
  const isDerived = candidate.id !== 'candidate_1' && candidate.id !== 'candidate_2';

  return (
   <article className={`candidate ${isFrozen?'candidate-frozen':''} ${isDerived?'candidate-derived':''}`} key={candidate.id} data-status={candidate.status}>
    <header className="candidate-header">
     <div className="candidate-header-main">
      <div className="candidate-title-row">
       <h3>{candidate.plan.title}</h3>
       {isDerived && (
        <button
         type="button"
         className="button text-btn remove-cand-btn"
         onClick={()=>flow.removeCandidate(candidate.id)}
         title="移除此风格对照方案"
        >
         ✕ 移除方案
        </button>
       )}
      </div>
      <div className="candidate-badges">
       <span className="badge-pill">{planLabel}</span>
       {isI2I ? <span className="badge-pill badge-i2i">图生图 ({refCount}张参考)</span> : <span className="badge-pill badge-t2i">纯文生图</span>}
       <span className="badge-pill badge-style" title={styleLabel}>🎨 {styleLabel}</span>
       {isFrozen && <span className="badge-pill badge-frozen">❄️ 已锁定构图</span>}
      </div>
     </div>
    </header>

    <p className="label">{e.provider==='mock'?'离线模拟图片':e.pipeline.route==='native-alpha'?'直接透明链路':'千问普通生成 + 851 Labs'}</p>

    {candidate.job?.image_url?<div className="checker"><img key={`${candidate.job.image_url}:${images[candidate.id]?.reload||0}`} src={candidate.job.image_url} alt={candidate.plan.title} onLoad={()=>setImages(old=>({...old,[candidate.id]:{url:candidate.job!.image_url!,loaded:true,failed:false,reload:old[candidate.id]?.reload||0}}))} onError={()=>setImages(old=>({...old,[candidate.id]:{url:candidate.job!.image_url!,loaded:false,failed:true,reload:old[candidate.id]?.reload||0}}))}/></div>:<div className="image-wait" role="status">{candidate.status==='not_started'?'尚未提交':candidate.status==='submitting'?'正在生成并检查透明背景…':candidate.error?'提交或处理需要核查':'结果尚未准备好'}</div>}
    {(candidate.error||candidate.job?.error_message)&&<p role="alert">{candidate.error||candidate.job?.error_message}</p>}

    <p className="label">{hasTerrainApproval(candidate.job)?'你已审核通过':candidate.job?.background_removal?.status==='needs_review'?'透明度或整块地形检查未通过，待你审核':candidate.job?.background_removal?.status==='ready'?'透明度检查通过 · 地面锚点仍待校验':candidate.job?.request_status||candidate.status}</p>

    <details><summary>构图与完整提示词</summary>
     <p><strong>场景构图描述：</strong>{candidate.plan.scene_description}</p>
     <pre>{candidate.job?.submitted_prompt?.positive_prompt||'尚未收到生图提示词'}</pre>
     <p><strong>负向词（已并入正向）：</strong>{candidate.job?.submitted_prompt?.negative_prompt||'无'}</p>
     <small>请求ID：{candidate.submissionId}</small>
    </details>

    {candidate.job?.audit_report && (
      <details className="audit-report-details" open={Boolean(candidate.error || candidate.job?.error_message)}>
       <summary>🔬 实验生成审计与诊断报告 {candidate.job.audit_report.stage==='completed'?'✅':'⚠️'}</summary>
       <div className="audit-report-content">
        <div className="audit-grid">
         <div><strong>执行阶段：</strong><span className="badge-pill">{candidate.job.audit_report.stage}</span></div>
         <div><strong>HTTP 状态：</strong><span>{candidate.job.audit_report.http_meta?.status_code || 200}</span></div>
         <div><strong>Content-Type：</strong><span>{candidate.job.audit_report.http_meta?.content_type || 'application/json'}</span></div>
         {candidate.job.audit_report.request_id && <div><strong>百炼 Request ID：</strong><code>{candidate.job.audit_report.request_id}</code></div>}
         {candidate.job.audit_report.provider_raw_error_code && <div><strong>千问原始错误码：</strong><code className="error-code">{candidate.job.audit_report.provider_raw_error_code}</code></div>}
         {candidate.job.audit_report.backend_error_code && <div><strong>后端错误码：</strong><code>{candidate.job.audit_report.backend_error_code}</code></div>}
        </div>

        <div className="audit-section-block">
         <strong>Prompt 长度与各段拆解（总字符数：{candidate.job.audit_report.total_prompt_chars} 字 · 估算约 {candidate.job.audit_report.estimated_tokens || Math.round(candidate.job.audit_report.total_prompt_chars * 1.3)} Tokens）：</strong>
         <div className="audit-segments-tags">
          <span>1. 地块结构与连接口：{candidate.job.audit_report.prompt_segments?.structure_rules || 0} 字</span>
          <span>2. 场景主体与生活内容：{candidate.job.audit_report.prompt_segments?.scene_content || 0} 字</span>
          <span>3. 相对尺度规范：{candidate.job.audit_report.prompt_segments?.scale_rules || 0} 字</span>
          <span>4. 渲染风格与氛围：{candidate.job.audit_report.prompt_segments?.style_package || 0} 字</span>
          <span>5. 透明背景与禁止：{candidate.job.audit_report.prompt_segments?.transparency_rules || 0} 字</span>
          <span style={{ background: '#eaf4e6', color: '#2b5020' }}>各模块去重检查：无重复词汇 ✅</span>
         </div>
        </div>

        <div className="audit-section-block">
         <strong>请求体与输入参考图（脱敏度量，绝无 Base64）：</strong>
         <div>参考图数量：{candidate.job.audit_report.images_meta?.count || 0} 张 · 预估请求体大小：{Math.round((candidate.job.audit_report.images_meta?.estimated_request_payload_bytes || 0) / 1024)} KB</div>
         {candidate.job.audit_report.images_meta?.details?.length > 0 && (
          <ul className="audit-image-list">
           {candidate.job.audit_report.images_meta.details.map((img, idx) => (
            <li key={img.id || idx}>
             图 {idx + 1}：{img.name}（角色：{REFERENCE_ROLE_LABELS[img.role as keyof typeof REFERENCE_ROLE_LABELS]?.label || img.role}）· 大小：{Math.round((img.size_bytes || 0) / 1024)} KB
            </li>
           ))}
          </ul>
         )}
        </div>

        <details className="audit-prompt-full">
         <summary>查看发送至千问的最终 Prompt 全文（{candidate.job.audit_report.total_prompt_chars} 字符）</summary>
         <pre className="prompt-pre">{candidate.job.audit_report.final_prompt}</pre>
        </details>
       </div>
      </details>
    )}

    {candidate.job?.original_image_url&&<details><summary>原图与透明图对比</summary><div className="comparison"><figure><figcaption>原图保留</figcaption><img src={candidate.job.original_image_url} alt="原始生成图片"/><a href={candidate.job.original_image_url} download={`${candidate.id}-original.png`}>下载原图</a></figure><figure><figcaption>透明结果</figcaption>{candidate.job.image_url&&<div className="checker"><img src={candidate.job.image_url} alt="透明结果"/></div>}{candidate.job.image_url&&<a href={candidate.job.image_url} download={`${candidate.id}-transparent.png`}>下载透明图</a>}</figure></div></details>}
    {images[candidate.id]?.failed&&images[candidate.id]?.url===candidate.job?.image_url&&<p role="alert">图片未加载，暂不能选择。<button onClick={()=>setImages(old=>({...old,[candidate.id]:{...old[candidate.id],failed:false,reload:(old[candidate.id]?.reload||0)+1}}))}>重新加载图片</button></p>}

    <div className="actions">
     {candidate.status==='not_started'?(
      <button disabled={flow.busy} onClick={()=>run(()=>flow.submit(candidate.id))}>明确提交此方案{e.provider==='mock'?'模拟图':'生图'}</button>
     ):(
      <>
       <button disabled={flow.busy} onClick={()=>run(()=>flow.query(candidate.id))}>查询原任务（不重新生图）</button>
       {candidate.status==='unknown'&&!candidate.job&&(
        <button type="button" className="button secondary retry-btn" disabled={flow.busy} onClick={()=>run(()=>flow.retrySubmit(candidate.id))}>
         🔄 重新提交生图
        </button>
       )}
      </>
     )}
     <button
      type="button"
      className={isFrozen ? 'secondary active' : 'secondary'}
      title="锁定此构图描述，切换风格或参考图后进行单变量生成实验"
      disabled={flow.busy}
      onClick={()=>flow.freezeCandidate((candidate.originCandidateId || candidate.id) as any)}
     >
      {isFrozen ? '❄️ 构图已锁定' : '❄️ 锁定此构图做对照'}
     </button>
     {canReviewTerrain(candidate.job)&&!hasTerrainApproval(candidate.job)&&<button disabled={flow.busy||!images[candidate.id]?.loaded||images[candidate.id]?.url!==candidate.job?.image_url} onClick={()=>{if(confirm('请先对比原图与透明图，确认地块完整且外部背景符合预期。审核不修改自动检测记录，是否通过？'))run(()=>flow.approve(candidate.id));}}>我已检查，审核通过</button>}
     <button className="primary" disabled={flow.busy||!terrainUsable(candidate.job)||!images[candidate.id]?.loaded||images[candidate.id]?.url!==candidate.job?.image_url} aria-pressed={e.selectedId===candidate.id} onClick={()=>run(()=>flow.select(candidate.id))}>{e.selectedId===candidate.id?'已选择':'选择此结果'}</button>
    </div>
   </article>
  );
 };

 return (
  <main>
   <header className="top">
    <div>
     <p className="eyebrow">LIFE MAP · STANDALONE V0.7.3</p>
     <h1>生图控制与实验工作台</h1>
     <p>文生图 · 图生图 · 风格包迁移 · 分层干预 · 实验档案馆</p>
    </div>
    <button disabled={flow.busy||e.stage==='results'||e.stage==='selected'} onClick={()=>setSettings(true)}>模型设置</button>
   </header>

   <div className="status">
    <span>{mode}</span>
    <span className="mode-indicator">
      当前模式：{e.lab.mode==='image_to_image'?'🖼️ 图生图/参考图':'📝 纯文生图'} · 风格：{currentStyle?.style_name}
    </span>
   </div>

   {/* 顶部主工作区 Tab 导航 */}
   <nav className="workbench-tabs" aria-label="工作台功能导航">
    <button
      className={`tab-btn ${activeTab==='process'?'active':''}`}
      onClick={()=>setActiveTab('process')}
    >
      📋 日记主流程
    </button>
    <button
      className={`tab-btn ${activeTab==='style'?'active':''}`}
      onClick={()=>setActiveTab('style')}
    >
      🎨 风格化实验场
    </button>
    <button
      className={`tab-btn ${activeTab==='i2i'?'active':''}`}
      onClick={()=>setActiveTab('i2i')}
    >
      🖼️ 图生图实验场 {e.lab.referenceImages.length>0&&`(${e.lab.referenceImages.length})`}
    </button>
    <button
      className={`tab-btn ${activeTab==='inspector'?'active':''}`}
      onClick={()=>setActiveTab('inspector')}
    >
      🔍 6层干预检查器
    </button>
    <button
      className={`tab-btn ${activeTab==='archive'?'active':''}`}
      onClick={()=>setActiveTab('archive')}
    >
      🏛️ 实验档案馆
    </button>
   </nav>

   <ol className="steps" aria-label="处理步骤">
    {['日记','选择重点','细节询问','生图结果'].map((name,i)=>(
      <li key={name} aria-current={(['write','focus','inquiry','results'][i]===e.stage||i===3&&e.stage==='selected')?'step':undefined}>
        {i+1} · {name}
      </li>
    ))}
   </ol>

   {(flow.error||uiError)&&<div role="alert" className="error">{flow.error||uiError}</div>}
   {flow.busy&&<p role="status" className="busy">正在处理当前请求，请稍候…</p>}

   {/* Tab 2: 风格实验场 */}
   {activeTab==='style' && (
     <StylePlayground
       lab={e.lab}
       busy={flow.busy}
       onUpdateLab={patch=>flow.setLab(patch)}
     />
   )}

   {/* Tab 3: 图生图实验场 */}
   {activeTab==='i2i' && (
     <ImageToImagePlayground
       lab={e.lab}
       busy={flow.busy}
       onUpdateLab={patch=>flow.setLab(patch)}
       onAddReferenceImage={img=>flow.addReferenceImage(img)}
       onRemoveReferenceImage={id=>flow.removeReferenceImage(id)}
       onUpdateReferenceImageRole={(id,role)=>flow.updateReferenceImageRole(id,role)}
     />
   )}

   {/* Tab 4: 6层干预检查器 */}
   {activeTab==='inspector' && (
     <LayeredInspector
       experiment={e}
       activeCandidate={activeCandidate}
       lab={e.lab}
     />
   )}

   {/* Tab 5: 本地实验档案馆 */}
   {activeTab==='archive' && (
     <ArchivePlayground
       workbench={flow}
       onNavigateToMain={()=>setActiveTab('process')}
     />
   )}

   {/* Tab 1: 主流水线流程 */}
   {activeTab==='process' && (
    <>
     {e.stage==='write'&&<section className="paper">
      <div className="section-title">
       <h2>写下今天的日记</h2>
       <div className="title-actions">
        <label className="button secondary file-upload-btn">
         📥 导入日记输入 JSON
         <input
          type="file"
          accept=".json"
          style={{display:'none'}}
          onChange={event=>{
           const file=event.target.files?.[0];
           if(!file)return;
           const reader=new FileReader();
           reader.onload=ev=>{
            const content=ev.target?.result as string;
            run(()=>flow.importDiarySnapshot(content));
           };
           reader.readAsText(file);
           event.target.value='';
          }}
         />
        </label>
        <label>日期<input type="date" value={e.date} disabled={flow.busy} onChange={event=>update({date:event.target.value})}/></label>
       </div>
      </div>
      <p>可以写多条便签，本次会合并为一份生成输入。不会读取日记岛已有记录。</p>
      {e.notes.map((note,index)=><label className="note" key={index}>便签 {index+1}<textarea aria-label={`便签 ${index+1}`} value={note} maxLength={12000} disabled={flow.busy} onChange={event=>update({notes:e.notes.map((old,i)=>i===index?event.target.value:old)})} placeholder="写下发生的事、此刻的心情和想记住的细节…"/></label>)}
      <div className="actions"><button disabled={flow.busy} onClick={()=>update({notes:[...e.notes,'']})}>再加一条便签</button><span>{e.notes.join('\n\n').length}/12000字</span><button className="primary" disabled={flow.busy||!e.notes.some(note=>note.trim())} onClick={()=>run(()=>flow.analyze())}>整理日记并选择重点</button></div>
     </section>}

     {e.stage==='focus'&&<section className="paper">
      <h2>选择需要重点表达的项目</h2>
      <p>今天的日记关键词 · 事件、心情、地点与生活细节。选择1–3项（当前 {e.focusIds.length}/3）。</p>
      <div className="focus-grid">{e.focuses.map(focus=><label className="focus" key={focus.event_id} data-selected={e.focusIds.includes(focus.event_id)}><input type="checkbox" checked={e.focusIds.includes(focus.event_id)} disabled={flow.busy||!e.focusIds.includes(focus.event_id)&&e.focusIds.length>=3} onChange={()=>update({focusIds:e.focusIds.includes(focus.event_id)?e.focusIds.filter(id=>id!==focus.event_id):[...e.focusIds,focus.event_id]})}/><strong>{focus.keyword||focus.title}</strong><small>{FOCUS_KIND_LABELS[focus.focus_kind as keyof typeof FOCUS_KIND_LABELS]||'事件'}</small></label>)}</div>
      <div className="actions"><button disabled={flow.busy} onClick={()=>run(()=>flow.back())}>返回修改日记</button><button className="primary" disabled={flow.busy||!e.focusIds.length} onClick={()=>run(()=>flow.inquire())}>确认重点，了解细节</button></div>
     </section>}

     {e.stage==='inquiry'&&<section className="paper">
      <div className="section-title">
       <h2>为了景观更贴近你的今天，可以再了解一些细节吗？</h2>
       <div className="inquiry-model-badge">
        <span>生图模式：<strong>{e.provider==='mock'?'离线模拟':'在线千问生图'}</strong></span>
        <button type="button" className="button text" disabled={flow.busy} onClick={()=>setSettings(true)}>⚙️ 切换模型</button>
       </div>
      </div>
      <p>{e.intro||'细节可以跳过，不回答也可以生图。'}</p>
      {e.questions.map(q=><fieldset className="question" key={q.question_id}><legend>{q.question_text}</legend>{q.input_type==='single_choice'&&<div className="choices">{q.answer_options.map(option=><button key={option} type="button" disabled={flow.busy} aria-pressed={e.answers[q.question_id]?.option===option} onClick={()=>update({answers:{...e.answers,[q.question_id]:{...e.answers[q.question_id],option:e.answers[q.question_id]?.option===option?undefined:option}}})}>{option}</button>)}</div>}<label>补充回答<input aria-label={q.question_text} disabled={flow.busy} value={e.answers[q.question_id]?.text||''} maxLength={500} onChange={event=>update({answers:{...e.answers,[q.question_id]:{...e.answers[q.question_id],text:event.target.value}}})}/></label></fieldset>)}
      <label className="note">还有想留下的细节吗？<textarea aria-label="额外细节" disabled={flow.busy} value={e.extra} maxLength={700} onChange={event=>update({extra:event.target.value})}/></label>
      <div className="actions">
       <button disabled={flow.busy} onClick={()=>run(()=>flow.back())}>返回选重点</button>
       <button disabled={flow.busy} onClick={()=>run(()=>flow.inquire())}>重试询问</button>
       <button
        type="button"
        className="button secondary"
        disabled={flow.busy}
        onClick={()=>{
         const jsonStr=flow.exportDiarySnapshot();
         const blob=new Blob([jsonStr],{type:'application/json'});
         const url=URL.createObjectURL(blob);
         const a=document.createElement('a');
         a.href=url;
         a.download=`diary-input-${e.date||'snapshot'}.json`;
         a.click();
         setTimeout(()=>URL.revokeObjectURL(url),1000);
        }}
       >
        📤 导出日记输入 JSON
       </button>
       <button className="primary" disabled={flow.busy} onClick={()=>run(()=>flow.generate())}>
        {e.provider==='mock'?'生成两个离线模拟方案':'确认并生成两张地块'}
       </button>
      </div>
      <small>开始生图后，本批不再返回询问修改。在线模式会提交两张图片；不会自动重生。</small>
     </section>}

     {(e.stage==='results'||e.stage==='selected')&&<>
      <section className="result-heading">
       <div className="section-title">
        <div>
         <h2>{e.stage==='selected'?'本次结果已选择':'选择你喜欢的今日制图'}</h2>
         <p>{e.provider==='mock'?'当前是离线模拟，图片仅用于验证链路。':'当前批次已固定。查询原任务不会重新生图，待审核结果由你决定。'}</p>
        </div>
        <button
         type="button"
         className="button primary export-zip-btn"
         disabled={flow.busy||!e.candidates.some(c=>c.job)}
         onClick={exportZip}
         title="一键打包本轮实验的完整输入、Prompt、双方案原图与透明图"
        >
         📦 导出本轮实验 ZIP 档案
        </button>
       </div>
      </section>

      {/* 冻结对照实验操作横幅 */}
      {e.lab.frozenCandidateId && (
       <div className="frozen-banner" role="region" aria-label="冻结构图单变量实验区">
        <div className="frozen-banner-info">
         <strong>❄️ 单变量实验就绪：已锁定【{e.lab.frozenCandidateId==='candidate_1'?'方案一':'方案二'}】构图</strong>
         <p>
           保持当前构图与主景不变，可在上方【风格化实验场】或【图生图实验场】调整风格、添加参考图，然后点击下方按钮重新生成对照：
         </p>
        </div>
        <button
         className="primary"
         disabled={flow.busy}
         onClick={()=>run(()=>flow.regenerateWithLab(e.lab.frozenCandidateId))}
        >
         🧪 基于已锁定构图重新生图对照
        </button>
       </div>
      )}

      {/* 方案分组渲染：单风格平铺，多风格按风格分栏 */}
      {groupedCandidates.length > 1 ? (
        <div className="multi-style-results-container">
          {groupedCandidates.map(group => (
            <div className="style-candidate-group" key={group.styleId}>
              <div className="style-group-header">
                <div className="style-group-title">
                  <span className="style-group-icon">🎨</span>
                  <h4>{group.styleName}</h4>
                  <span className="style-group-count">（共 {group.candidates.length} 个方案）</span>
                </div>
                {group.candidates.some(c => c.status === 'not_started') && (
                  <button
                    type="button"
                    className="button small primary"
                    disabled={flow.busy}
                    onClick={() => run(async () => {
                      await Promise.allSettled(group.candidates.filter(c => c.status === 'not_started').map(c => flow.submit(c.id)));
                    })}
                  >
                    🚀 提交本风格全部方案
                  </button>
                )}
              </div>
              <div className="results">{group.candidates.map(result)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="results">{e.candidates.map(result)}</div>
      )}

      {/* 使用其他风格（多风格平行对照） */}
      <section className="other-styles-panel" aria-label="使用其他风格平行探索">
        <div className="other-styles-header" onClick={() => setShowOtherStylesPanel(prev => !prev)}>
          <div className="other-styles-title">
            <span className="other-styles-icon">✨</span>
            <div>
              <h3>使用其他风格（多风格平行对照）</h3>
              <p>将当前日记场景构图与提示词快速套入其他风格，生成独立的方案进行画风与透明度对比</p>
            </div>
          </div>
          <button type="button" className="button secondary toggle-btn">
            {showOtherStylesPanel ? '收起选项 ▲' : '展开多选风格 ▼'}
          </button>
        </div>

        {showOtherStylesPanel && (
          <div className="other-styles-body">
            <div className="scope-selection-bar">
              <span className="label">套用构图范围：</span>
              <label className="radio-label">
                <input
                  type="radio"
                  name="sourceScope"
                  checked={targetScope === 'all'}
                  onChange={() => setTargetScope('all')}
                />
                方案一 + 方案二（推荐，生成双方案）
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="sourceScope"
                  checked={targetScope === 'candidate_1'}
                  onChange={() => setTargetScope('candidate_1')}
                />
                仅方案一
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="sourceScope"
                  checked={targetScope === 'candidate_2'}
                  onChange={() => setTargetScope('candidate_2')}
                />
                仅方案二
              </label>
            </div>

            <div className="style-selection-toolbar">
              <span className="label">选择目标风格（可多选）：</span>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="button text-btn"
                  onClick={() => {
                    const otherIds = availableStyles
                      .filter(s => s.style_id !== e.lab.selectedStyleId)
                      .map(s => s.style_id);
                    setSelectedOtherStyleIds(otherIds);
                  }}
                >
                  勾选全部其他风格
                </button>
                <button
                  type="button"
                  className="button text-btn"
                  onClick={() => setSelectedOtherStyleIds([])}
                >
                  清空选择
                </button>
              </div>
            </div>

            <div className="style-selection-grid">
              {availableStyles.map(s => {
                const isCurrentBase = s.style_id === e.lab.selectedStyleId;
                const isChecked = selectedOtherStyleIds.includes(s.style_id);
                const alreadyGenerated = e.candidates.some(c => c.styleId === s.style_id || (isCurrentBase && !c.styleId));
                return (
                  <label
                    key={s.style_id}
                    className={`style-select-chip ${isChecked ? 'selected' : ''} ${isCurrentBase ? 'current-base' : ''}`}
                  >
                    <input
                      type="checkbox"
                      disabled={isCurrentBase}
                      checked={isChecked}
                      onChange={ev => {
                        if (ev.target.checked) {
                          setSelectedOtherStyleIds(prev => [...prev, s.style_id]);
                        } else {
                          setSelectedOtherStyleIds(prev => prev.filter(id => id !== s.style_id));
                        }
                      }}
                    />
                    <span className="style-chip-name">{s.style_name}</span>
                    {isCurrentBase && <span className="chip-tag base-tag">基准风格</span>}
                    {alreadyGenerated && !isCurrentBase && <span className="chip-tag generated-tag">已生成</span>}
                  </label>
                );
              })}
            </div>

            <div className="other-styles-actions">
              <div className="action-summary">
                {selectedOtherStyleIds.length > 0 ? (
                  <span>
                    已选择 <strong>{selectedOtherStyleIds.length}</strong> 种风格 × {targetScope === 'all' ? '2 个方案' : '1 个方案'} = 将生成 <strong>{selectedOtherStyleIds.length * (targetScope === 'all' ? 2 : 1)}</strong> 张独立对比图
                  </span>
                ) : (
                  <span className="hint-text">请在上方勾选至少 1 个目标风格开始平行探索</span>
                )}
              </div>
              <div className="action-buttons">
                <button
                  type="button"
                  className="button secondary"
                  disabled={selectedOtherStyleIds.length === 0 || isApplyingStyles || flow.busy}
                  onClick={async () => {
                    try {
                      setIsApplyingStyles(true);
                      const sources = targetScope === 'all'
                        ? undefined
                        : (targetScope === 'candidate_1' ? ['candidate_1'] : ['candidate_2']);
                      await flow.applyOtherStyles({
                        targetStyleIds: selectedOtherStyleIds,
                        sourceCandidateIds: sources,
                        autoSubmit: false
                      });
                    } catch (err: any) {
                      setUiError(err.message || '创建多风格方案失败');
                    } finally {
                      setIsApplyingStyles(false);
                    }
                  }}
                >
                  ➕ 仅创建方案卡片（稍后手动提交）
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={selectedOtherStyleIds.length === 0 || isApplyingStyles || flow.busy}
                  onClick={async () => {
                    try {
                      setIsApplyingStyles(true);
                      const sources = targetScope === 'all'
                        ? undefined
                        : (targetScope === 'candidate_1' ? ['candidate_1'] : ['candidate_2']);
                      await flow.applyOtherStyles({
                        targetStyleIds: selectedOtherStyleIds,
                        sourceCandidateIds: sources,
                        autoSubmit: true
                      });
                    } catch (err: any) {
                      setUiError(err.message || '多风格并行生成失败');
                    } finally {
                      setIsApplyingStyles(false);
                    }
                  }}
                >
                  {isApplyingStyles ? '正在提交生成…' : '🚀 立即套用并开始生图'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {e.stage==='selected'&&<p className="success" role="status">已保存选择，可导出实验JSON与图片；不会放入正式地图。</p>}
     </>}
    </>
   )}

   <footer>
    <button disabled={flow.busy||!e.candidates.some(c=>c.job)} onClick={exportZip}>📦 导出实验 ZIP</button>
    <button disabled={flow.busy} onClick={exportData}>导出实验 JSON</button>
    <button disabled={flow.busy} onClick={()=>{if(confirm('新建独立实验？本次记录将替换本机工作台草稿，请先导出需要保留的记录。新实验只有在你提交后才调用模型。'))run(()=>flow.reset());}}>新建实验</button>
    <small>模型密钥仅在独立服务进程中保存，不在实验JSON或浏览器缓存内。</small>
   </footer>

   <details className="debug"><summary>查看实验状态与接口数据</summary><pre>{flow.export()}</pre></details>
   {settings&&<AiModelSettings onClose={()=>setSettings(false)}/>}
  </main>
 );
}

createRoot(document.getElementById('root')!).render(<App/>);
