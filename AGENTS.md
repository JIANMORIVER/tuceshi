# Workbench development context

Independent extraction of the Life Map diary-to-image workflow. Source provenance in docs/extraction-manifest.json. Do not access or alter sibling Life Map data/services, particularly the existing4174 process or cloud application. Never copy parent .env, keys, diaries, image history, node_modules or deployment credentials.

Use Node22.18+ (24recommended), npm ci, npm run check, npm run build, npm test. Browser QA: npm start on5191 then npm run test:browser; all tests use mock/intercepted providers. No paid real-model calls unless user explicitly requests them. Default mode is mock even when optional keys are configured.

Production rendering is complete2.5D image generation, no R3F/Godot/asset assembly. Keep diary interpretation,1–3focuses, OPTIONAL typed inquiries, two fixed image candidates, native-alpha vs qwen-851, original PNG preservation, measured Alpha/base guard and explicit human review. No map/database publishing. Keys stay in server memory. Browser state namespace life-map.image-workbench.v1, artifacts .local/terrain-candidates. Persist each submission UUID BEFORE a paid request; uncertain outcomes only query the same task. Never auto-retry paid generation or silently switch to another paid route. Queries retain an approval only when job, image URL and source hash still match.

Repository target authorized by user: JIANMORIVER/tuceshi. Preserve repository history and visibility. Upload sanitized source only. UI here is a reusable test workbench, not a new Figma redesign of the main app.
