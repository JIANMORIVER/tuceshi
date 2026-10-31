# Life Map 生图测试工作台

从当前日记岛主应用独立摘出的 **日记 → 选择重点 → 可选细节询问 → 双方案生图** 工作台。可在其他开发器、IDE或AI编码工具中单独打开、修改和运行。

默认离线，不需要 Key。没有地图、车站、“我的”、正式日记数据库和主应用的云端身份依赖。

## 启动

推荐 Node.js 24（最低22.18），npm。克隆本仓库后：

```sh
npm ci
npm run dev
```

打开 **http://127.0.0.1:5191/** 。开发时前端5191、独立API服务5192，均只绑定本机；不会占用原项目4174。

生产构建在本机预览：

```sh
npm run build
npm start
```

同样打开5191。停止服务会清除通过界面填写的内存密钥，下次需要重填。实验记录和已保存图片保留。

**这是含 Node API 的独立工程，不能仅用 GitHub Pages 或静态HTML预览器运行真实模型功能。** GitHub用于源码托管和导入其他开发器；本轮没有部署新的公网工作台，也没有替换日记岛的手机云端应用。不要将这个本机、单用户服务直接作为公网多用户API。

## 模型配置

首页“模型设置”复用主应用组件：

- **离线规则**：日记理解、追问建议和构图为本地规则；两张PNG是明确标记的模拟图，不代表真实地块质量。
- **启用双模型**：DeepSeek官方接口或千问文字模型，负责理解、可选细节问答和两个完整构图；千问负责完整2.5D图片。
- **直接透明**：Qwen-Image-2.1 Turbo / Pro，检查输出Alpha与整块地形保留情况。
- **普通生成＋851 Labs**：千问普通图片＋Replicate `851-labs/background-remover`，需要单独的Replicate Token，缺失时在生图前阻止。

密钥只在本独立Node进程内存中保存，不写入浏览器缓存、导出JSON或Git。可选将 `.env.example` 复制为 `.env.local` 自行填写；该文件被Git和打包脚本排除。没有复制日记岛已有的百炼、DeepSeek或Replicate密钥。

在线提交会产生供应商费用；一次完整批次生成两张图，云端抠图链路另有两次对应处理。启动、刷新、打开设置、选择结果、审核和导出都不会自动触发生图。选择在线模式后必须主动提交。

## 流程与恢复

1. 写一条或多条便签，当天便签按原文合成一个输入，最多12000字。
2. 复用真实理解契约和证据校验，选择1–3项事件、心情、地点、人物或物件。
3. 显示模型生成的选择题／文字控件。可以回答、补充或不回答直接生图；服务异常可手动重试询问，不会因此生图。
4. 生成两个完整场景方案，锁定本批输入、链路、模型和请求ID；结果页不能返回修改询问反复生成。
5. 比较原图／透明图，查看完整提示词、检查结果和任务ID，选择一张或导出实验JSON／PNG。不向正式地图提交。

本机浏览器使用独立键 `life-map.image-workbench.v1` 保存当前实验。服务端图片和处理清单位于 `.local/terrain-candidates/`，不会与日记岛正式目录共享。刷新不会自动提交、重新生图或调用抠图；不确定的提交保留原请求ID，只能手动查询原任务。未发出的方案可明确提交原ID。查看中的图片加载失败时暂不能审核或选择，可只重新加载图片。

自动透明检查未通过时保留原图与检测记录，由用户明确审核。审核绑定具体任务、图片URL和源哈希；同一结果查询会保留审核，结果发生变化则重新要求审核。新建实验会替换当前本机草稿，请先导出需保留的记录；它不会主动开始模型调用。

## 给其他开发器的入口

| 位置 | 用途 |
| --- | --- |
| `src/workbench/main.tsx` | 独立React页面、输入、动态控件、图片比较、导出 |
| `src/workbench/flow.ts` | 流程状态、持久化、提交锁、恢复与人工审核；可注入API和存储 |
| `src/workbench/snapshot.ts` | 从主流程摘出的Stage A快照构造 |
| `server/index.mjs` | 独立本机HTTP服务器，API与测试依赖注入 |
| `server/ai/diary-prompt.mjs` | 日记理解系统提示词 |
| `server/ai/diary-dialogue.mjs` | DeepSeek/千问追问、完整构图、Schema和错误分类 |
| `server/ai/complete-terrain.mjs` | 两条生图提示词、固定地表／薄底座／防翘边规则 |
| `server/image-card/dashscope.mjs` | 千问图像API适配与图片下载 |
| `server/background-removal/routed-pipeline.mjs` | 原生Alpha验证、851 Labs链路、原图保留和幂等保护 |
| `src/world/domain/terrainReview.ts` | 人工审核与可选用条件 |
| `docs/extraction-manifest.json` | 摘出文件的来源和SHA256 |
| `docs/API.md` | 当前接口、数据路径与实验扩展边界 |

新功能优先写在 `src/workbench/` 或新增适配器；保持真实模型验证、原始日记与用户补充答案分离，保留付费提交幂等，不要把生产密钥或个人日记写入样例。

继承的契约中含旧版wanx／3D兼容类型，后端依赖闭包中含旧场景／本地抠除兼容代码；它们不构成此工作台的新入口，当前UI只使用完整图片和两条新链路。没有拷贝R3F/Godot渲染器、模型权重、原Figma插画或主应用的用户数据。

## 验证与打包

```sh
npm run check
npm run build
npm test
# 可选浏览器验收，首次安装Chrome/Chromium：
npx playwright install chromium
npm start
# 另一个终端：
npm run test:browser
# 生成源码ZIP：
npm run package
```

浏览器脚本也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定已有Chrome；`WORKBENCH_URL`可指定独立服务地址。测试使用Mock和拦截的合成在线响应，**不会使用真实API Key或付费生图**。CI执行类型检查、构建和单元／本机HTTP测试。

源码ZIP输出在 `artifacts/life-map-image-workbench-source.zip`，只含源码、锁文件、测试与文档，排除密钥、node_modules、构建产物和实验数据。将它或GitHub源码直接导入其他开发器后执行启动命令即可。浏览器视觉证据与测试摘要位于本机 `.local/`，不发布测试图片到正式数据。

来源：日记岛当前v10源码快照（主应用云端源码标识 `8ed8f61cdf5a138a14b63c479ab99268766e4d94`）；独立工作台容器与控制器是本次抽取适配。原项目、原服务和用户历史数据保留。
