import { useEffect, useRef, useState } from "react";
import { loadModelSettings, MODEL_SETTINGS_CHANGED, type PublicModelSettings } from "../../services/model-settings-client.js";

/** Local server configuration, separate from diary content and the old lab settings. */
export function AiModelSettings({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<PublicModelSettings>();
  const [deepseekKey,setDeepseekKey] = useState("");
  const [qwenKey,setQwenKey] = useState("");
  const [replicateKey,setReplicateKey] = useState("");
  const [error,setError] = useState("");
  const [saved,setSaved] = useState(false);
  const [busy,setBusy] = useState(false);
  useEffect(() => {
    const previous=document.activeElement as HTMLElement|null;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    void loadModelSettings(true).then(value=>setSettings({...value,generationRoute:value.generationRoute==='qwen-851'?'qwen-851':'native-alpha',nativeImageModel:value.nativeImageModel||'qwen-image-2.1-turbo'})).catch(cause=>setError(cause.message));
    return ()=>{ previous?.focus({preventScroll:true}); };
  },[]);
  const save = async () => {
    if(!settings||busy)return; setBusy(true);setError("");setSaved(false);
    try{
      const current=await loadModelSettings(true);
      if(settings.textProvider!=='mock'&&current.authRequired)throw new Error('请先登录 ChatGPT，再填写并保存双模型配置。');
      if(settings.textProvider==='deepseek'&&!deepseekKey&&!current.deepseek.apiConfigured)throw new Error('请填写 DeepSeek 官方 API Key，再保存模型设置。');
      const response=await fetch("/api/model-settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({textProvider:settings.textProvider,deepseekModel:settings.deepseek.model,qwenModel:settings.qwen.model,imageModel:settings.image.model,generationRoute:settings.generationRoute,nativeImageModel:settings.nativeImageModel,...(settings.textProvider!=='mock'?{...(deepseekKey?{deepseekKey}:{}),...(qwenKey?{qwenKey}:{}),...(replicateKey?{replicateKey}:{})}:{})})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"模型设置未保存。");
      setSettings(result);setDeepseekKey("");setQwenKey("");setReplicateKey("");await loadModelSettings(true);window.dispatchEvent(new Event(MODEL_SETTINGS_CHANGED));setSaved(true);
    }catch(cause){setError(cause instanceof Error?cause.message:"模型设置未保存。");}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className="lm-model-dialog" aria-labelledby="model-settings-title" onCancel={onClose}>
    <header><h2 id="model-settings-title">模型设置 · DeepSeek</h2><button type="button" aria-label="关闭模型设置" onClick={onClose}>关闭</button></header>
    <p>文字模型整理日记与细节；千问生成完整 2.5D 图片地块。</p>
    {error&&<p role="alert">{error}</p>}
    {!settings&&!error&&<p role="status">正在读取配置…</p>}
    {settings&&<>
      <label>生成模式<select aria-label="生成模式" value={settings.textProvider==='mock'?'offline':'dual-model'} onChange={event=>{setSaved(false);setSettings({...settings,textProvider:event.target.value==='offline'?'mock':settings.textProvider==='mock'?'deepseek':settings.textProvider});}}><option value="offline">离线规则 · 不调用模型</option><option value="dual-model">启用双模型生成</option></select></label>
      {settings.textProvider==='mock'?<p className="lm-model-status">离线规则只在当前浏览器整理和模拟，不调用文字、生图或云端抠图 API。已保存的模型配置会保留。</p>:<><p className="lm-model-status">文字模型理解日记与细节，千问生成完整地块；所选生图链路会用于下一批方案。</p><label>日记理解模型<select aria-label="日记理解模型" value={settings.textProvider} onChange={event=>{setSaved(false);setSettings({...settings,textProvider:event.target.value as PublicModelSettings["textProvider"]});}}><option value="deepseek">DeepSeek 官方</option><option value="qwen">千问文字模型</option></select></label></>}
      {settings.authRequired&&<p role="status">离线模式可直接体验。<a href={settings.signInPath||'/signin-with-chatgpt?return_to=%2Findex.html'} target="_top">登录 ChatGPT 后保存双模型配置</a>，再填写自己的 API Key。</p>}
      {settings.textProvider==="deepseek"&&!settings.authRequired?<>
        <label>DeepSeek 模型名称<input value={settings.deepseek.model} onChange={event=>setSettings({...settings,deepseek:{...settings.deepseek,model:event.target.value}})}/></label>
        <label>DeepSeek API Key<input type="password" autoComplete="off" value={deepseekKey} onChange={event=>setDeepseekKey(event.target.value.trim())} placeholder={settings.deepseek.apiConfigured?"已配置，留空保留":"请填写官方 API Key"}/></label>
        <p className="lm-model-status">DeepSeek 密钥：{settings.deepseek.apiConfigured?'已配置':'未配置，保存后才会生效'}</p>
      </>:settings.textProvider==="qwen"&&!settings.authRequired?<label>千问文字模型名称<input value={settings.qwen.model} onChange={event=>setSettings({...settings,qwen:{...settings.qwen,model:event.target.value}})}/></label>:null}
      <label>地块生成链路<select aria-label="地块生成链路" value={settings.generationRoute} onChange={event=>{setSaved(false);setSettings({...settings,generationRoute:event.target.value as 'native-alpha'|'qwen-851'});}}><option value="native-alpha">直接生成透明地块</option><option value="qwen-851">普通生成＋851 Labs 云端抠图</option></select></label>
      {settings.generationRoute==='native-alpha'?<>
        <label>透明生图模型<select aria-label="透明生图模型" value={settings.nativeImageModel} onChange={event=>setSettings({...settings,nativeImageModel:event.target.value})}><option value="qwen-image-2.1-turbo">qwen-image-2.1-turbo</option><option value="qwen-image-2.1-pro">qwen-image-2.1-pro</option></select></label>
        <p className="lm-model-status">完整地块直接输出透明 PNG。透明度未通过时保留原图、等待审核，不自动重生或调用云端抠图。</p>
      </>:<>
        <label>千问生图模型<select aria-label="千问生图模型" value={settings.image.model} onChange={event=>setSettings({...settings,image:{...settings.image,model:event.target.value}})}><option value="qwen-image-2.0">qwen-image-2.0</option><option value="qwen-image-2.0-pro">qwen-image-2.0-pro</option></select></label>
        {settings.textProvider!=='mock'&&!settings.authRequired&&<label>Replicate API Token<input type="password" autoComplete="off" aria-label="Replicate API Token" value={replicateKey} onChange={event=>setReplicateKey(event.target.value.trim())} placeholder={settings.backgroundRemoval?.apiConfigured?'已配置，留空保留':'用于 851-labs/background-remover'}/></label>}
        <p className="lm-model-status">851 Labs：{settings.backgroundRemoval?.apiConfigured?'已配置':'未配置'}。原始地块图片会发送到 Replicate 处理；原图与透明结果分别保留。缺少 Token 时会在生图前阻止提交。</p>
      </>}
      <p className="lm-model-status">百炼密钥：{settings.image.apiConfigured?"已配置":"未配置"} · {settings.image.size} · 每方案 1 张</p>
      {settings.textProvider!=='mock'&&!settings.authRequired&&<label>百炼 API Key（留空沿用服务端配置）<input type="password" autoComplete="off" value={qwenKey} onChange={event=>setQwenKey(event.target.value.trim())} placeholder="无需重复填写已有密钥"/></label>}
      <p className="lm-model-note">{settings.secretLifetime==='encrypted-server-store'?'密钥按当前 ChatGPT 账号加密保存在服务端，不回显、不写入浏览器存储。':'新输入的密钥仅保存在本机服务端内存，重启后需重填；不回显、不写入浏览器存储。'} 保存或切换模式不会调用模型，也不会重做已有方案。</p>
      <button type="button" className="lm-action lm-action--green" disabled={busy} onClick={()=>void save()}>{busy?"正在保存…":"保存模型设置"}</button>
      {saved&&<p role="status">设置已保存，下一次整理使用所选模型。已有分析和候选不会自动重做。</p>}
    </>}
  </dialog>;
}
