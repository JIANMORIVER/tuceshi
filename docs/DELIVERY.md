# 独立工作台交付与验证

本次独立导出交付日期：2026-11-01（Asia/Hong_Kong）。目标仓库由用户指定为 `JIANMORIVER/tuceshi`，核对时为空仓库、public可见；保持原可见性，不向其中上传用户资料或密钥。

## 包含

日记／多便签聚合、原有理解与重点证据、1–3项重点选择、可选细节控件、完整双构图、固定UUID生图、原生透明与千问＋851 Labs、Alpha与底座保留检查、人工审核、原图／透明图比较下载、完整提示词查看、JSON导出、当前实验恢复。

复用40个原主工程文件的依赖闭包，来源SHA见extraction-manifest.json；独立React容器和流程控制器与主应用分开。没有正式地图、R3F/Godot渲染、用户日记数据库、云端站点身份或现有API Key依赖。

## 通过的验证

- TypeScript类型检查。
- Vite生产构建和独立TS领域模块构建。
- **34项测试**：原模型／背景链路26项，独立流程、存储失败、同批重复点击、未知提交恢复、原任务查询、审核绑定与本机HTTP安全／Mock链路8项。
- **21项浏览器检查**：独立默认离线、模型配置入口、两个路由选项、四步流程、可选问题、双图、选择／导出／刷新恢复、320px与桌面布局、合成在线控件及答案、图片失败与只重载图片、人工审核、查询与刷新不重复生图、无页面错误。
- ZIP逐项CRC与排除规则检查通过；源码打包不依赖原工程目录。
- 真实付费模型、真实云端抠除调用均为 **0**。浏览器在线场景均由合成响应拦截；原生／851适配的行为由注入模拟上游测试，不将其表述为新的真实API验收。

## 视觉证据（本机）

`.local/browser/01-diary-mobile.png`、`02-focus-mobile.png`、`03-inquiry-mobile.png`、`04-results-mobile.png`、`05-results-desktop.png`、`06-model-inquiry.png`、`07-reviewed-results.png`；检查明细 `checks.json`。这些是隔离测试图片，不加入Git发布的运行数据。

## 使用和边界

`npm ci && npm run dev`，访问localhost:5191；开发API为5192。生产预览 `npm run build && npm start`。独立服务器默认只监听127.0.0.1，不替换原主应用4174或云端v10。

GitHub是源码交付位置，不是新的公网生图服务；GitHub Pages不能运行Node API。导入其他开发器后按README启动，Key需在新工作台单独填写。真实地块效果、跨图风格及防翘边规则仍需日后主动付费生成验证。

当前实验保存在独立浏览器命名空间，图片保存在本独立目录`.local/terrain-candidates`。下载图片／JSON由用户主动触发。发布的源码不包含`.local`、`.env.local`、node_modules、旧日记或生成历史。

独立会话Cookie使用 `life_map_workbench_ai`，与主应用本机的 `life_map_ai` 分开；测试也验证原Cookie不能代替工作台会话。原HTTP工厂只增加可注入Cookie名称，默认行为保留，适配记录见来源清单。
