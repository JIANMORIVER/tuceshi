# API与扩展说明

生产启动时HTTP和静态文件同源；开发时Vite将 `/api` 代理到5192。先GET `/api/model-settings` 建立HttpOnly SameSite=Strict会话，再POST。允许localhost/127.0.0.1同源请求；此服务是单用户本机工具，不依赖ChatGPT云端登录。

| 接口 | 方法 | 内容 |
| --- | --- | --- |
| `/api/model-settings` | GET / POST | 读取脱敏配置或设置内存中的模型／密钥 |
| `/api/diary/interpret` | POST | `{input: "当天合并原文"}` → 原有 `LifeInterpretationResponse` |
| `/api/diary/inquire` | POST | `{rawText, focuses, answers?}` → intro和经过校验的questions |
| `/api/diary/scene-plan` | POST | 同上 → 两个完整场景候选；未选择的建议不是事实 |
| `/api/terrain/generate` | POST | 当前批次、固定UUID、快照、完整候选、model_config与image_pipeline |
| `/api/terrain/query` | POST | 按provider_task_id读取原生成／抠除任务，不新建收费任务 |
| `/api/terrain-images/:id` | GET | 保留的原始PNG |
| `/api/terrain-cutouts/:id` | GET | 透明结果PNG |
| `/api/terrain-background/status` | GET | 处理链路可用状态 |

`image_pipeline` 为 `{route:'native-alpha',model:'qwen-image-2.1-turbo'}` 或 `{route:'qwen-851',model:'qwen-image-2.0'}`，UI还提供现有对应Pro模型。最终请求示例可在工作台“查看实验状态与接口数据”查看。没有地图发布、正式日记读写或场景聊天接口。

`Workbench`的构造参数为独立Storage（getItem/setItem）和Api（call），便于在其他开发器替换界面、记录管理或测试适配器。不要从控制器导入API Key。原生和851链路的真实HTTP适配／Schema保持与提取时主工程一致；原图、检查和审核是三个不同层级，不把人工通过改写成机器检测通过。

提示词编辑入口：日记理解在`diary-prompt.mjs`，追问／构图在`diary-dialogue.mjs`，地块生成在`complete-terrain.mjs`。服务器模块修改后重启独立服务；通过界面填的Key要重填。本轮没有增加Prompt编辑／任意供应商执行器，开发者可在这些明确入口继续实验。

没有进行新一轮真实付费验证；真实模型权限、价格、跨图风格、RGBA质量和防翘边效果仍取决于供应商实际输出。浏览器测试中的“在线模式”只代表合成响应的界面测试，不能当作真实调用验收。
