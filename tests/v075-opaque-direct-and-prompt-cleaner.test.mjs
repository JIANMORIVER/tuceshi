import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCleanScenePrompt,
  CompleteTerrainGeneration,
  sanitizeCoreArtStyle
} from '../server/ai/complete-terrain.mjs';
import { ModelSettings } from '../server/ai/models.mjs';
import { DashScopeAdapter } from '../server/image-card/dashscope.mjs';
import { RoutedTerrainPipeline } from '../server/background-removal/routed-pipeline.mjs';

function mockFixturePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
}

test('V0.7.5 验收项 1：不透明直出 (opaque) 模式下 Prompt 长度在 200~400 字符，绝无透明或纯白底色词汇', () => {
  const promptResult = buildCleanScenePrompt(
    '温馨的书店小角落，靠窗有一张老木书桌与台灯，窗外有几株绿植。地面为深色木地板。',
    {
      generationRoute: 'opaque',
      mode: 'image_to_image',
      reference_images: [
        { id: 'st1', role: 'structure', name: 'struct.png' },
        { id: 'sc1', role: 'scale', name: 'scale.png' }
      ],
      style: '精致的 2D 像素画，线条清晰，柔和漫射日光'
    }
  );

  const prompt = promptResult.positive;
  console.log(`[V0.7.5 验收项 1] 不透明直出 Prompt 长度: ${prompt.length} 字符\n${prompt}`);

  // 1. 字符数严格控制在 200~400 字符
  assert.ok(prompt.length >= 180 && prompt.length <= 420, `Prompt 字符数应在合理精简区间 (当前: ${prompt.length})`);

  // 2. 绝对不能出现任何与透明、alpha 或抠图底色相关的词汇
  assert.doesNotMatch(prompt, /alpha/i);
  assert.doesNotMatch(prompt, /rgba/i);
  assert.doesNotMatch(prompt, /透明/);
  assert.doesNotMatch(prompt, /纯白/);
  assert.doesNotMatch(prompt, /RGB\(255,255,255\)/);

  // 3. 必须包含生活场景内容与核心艺术画风
  assert.ok(prompt.includes('老木书桌与台灯'));
  assert.ok(prompt.includes('精致的 2D 像素画'));
  assert.equal(promptResult.boundaries, '单张完整场景；普通有底图不透明直出（未调用851LAB）');
});

test('V0.7.5 验收项 2：结构图连接口彻底更正为红色标记，彻底清理黑色标记', () => {
  const promptResult = buildCleanScenePrompt(
    '安静的庭院花园，有一张长凳。',
    {
      generationRoute: 'opaque',
      mode: 'image_to_image',
      reference_images: [{ id: 'st1', role: 'structure', name: 'base.png' }]
    }
  );

  const prompt = promptResult.positive;
  // 必须使用红色标记
  assert.ok(prompt.includes('红色标记'));
  // 绝不能出现黑色标记
  assert.doesNotMatch(prompt, /黑色标记/);
  // 强化道路出口约束
  assert.ok(prompt.includes('道路必须延伸至地块边缘'));
});

test('V0.7.5 验收项 3：纯画风说明与具体题材解耦（剥离白墙黛瓦、灯笼、积雪等特定建筑）', () => {
  const dirtyStyle = '传统水墨江南水乡风格，白墙黛瓦，马头墙，大红灯笼高挂，屋檐积雪，笔触细腻，淡彩墨韵，清冷自然光';
  const cleanStyle = sanitizeCoreArtStyle(dirtyStyle);

  console.log(`[V0.7.5 验收项 3] 解耦前画风: ${dirtyStyle}\n解耦后画风: ${cleanStyle}`);

  // 过滤具体题材词
  assert.doesNotMatch(cleanStyle, /白墙黛瓦/);
  assert.doesNotMatch(cleanStyle, /马头墙/);
  assert.doesNotMatch(cleanStyle, /灯笼/);
  assert.doesNotMatch(cleanStyle, /积雪/);

  // 保留纯艺术风格词
  assert.ok(cleanStyle.includes('笔触细腻'));
  assert.ok(cleanStyle.includes('淡彩墨韵'));
});

test('V0.7.5 验收项 4：不透明直出模式不校验 Replicate Token，生图成功且明确标明 851LAB 未调用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'v075-opaque-'));
  const settings = new ModelSettings();
  // 仅配置百炼密钥，故意不配置任何 Replicate Token
  settings.update({
    textProvider: 'qwen',
    qwenKey: 'dashscope-mock-key',
    generationRoute: 'opaque'
  });

  let capturedBody = null;
  const mockFetch = async (url, opts) => {
    if (opts?.method === 'POST') {
      capturedBody = JSON.parse(opts.body);
      return Response.json({
        output: {
          choices: [
            {
              message: {
                content: [{ image: 'https://fixture.oss-cn-beijing.aliyuncs.com/opaque-output.png' }]
              }
            }
          ]
        },
        usage: { image_count: 1 },
        request_id: 'opaque-req-001'
      });
    }
    return new Response(mockFixturePng());
  };

  const generator = new CompleteTerrainGeneration(settings, {
    storageRoot: dir,
    adapter: new DashScopeAdapter(mockFetch)
  });

  const payload = {
    candidate_id: 'candidate_1',
    planning_run_id: 'run-opaque-test',
    client_request_id: '99999999-0000-4000-8000-111111111111',
    snapshot: { input_text: '在小花园里修剪花枝，阳光温暖明亮。' },
    candidate_plan: {
      primary_subject: '花架与修剪工具',
      scene_description: '阳光下的庭院小花园，中央的多层原木花架上摆满了葱郁的绿萝与各色小巧的多肉盆栽，青砖小径旁整齐摆放着一把复古铁皮洒水壶与一副锋利的园艺修枝剪，泥土散发着湿润芬芳，温暖的午后日光透过枝叶斑驳洒在地面上。',
      terrain: { name: '红砖庭院' }
    },
    model_config: { provider: 'qwen' },
    image_pipeline: { route: 'opaque', model: 'qwen-image-2.0' },
    lab_config: {
      mode: 'image_to_image',
      reference_images: [
        {
          id: 's1',
          name: 'structure.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          role: 'structure'
        }
      ]
    }
  };

  // 生成过程不报错，无需 Replicate Key
  const rawResult = await generator.generate(payload);
  assert.ok(rawResult.job, '必须成功生成 job 实例');
  assert.equal(rawResult.job.generation_route, 'opaque', '任务路由应为 opaque');

  const pipeline = new RoutedTerrainPipeline({ settings, storageRoot: dir });
  const decoratedJob = await pipeline.decorate(rawResult.job);
  assert.ok(decoratedJob.background_removal, '必须包含 background_removal 状态元数据');
  assert.equal(decoratedJob.background_removal.route, 'opaque');
  assert.equal(decoratedJob.background_removal.method, 'none');
  assert.ok(decoratedJob.background_removal.message?.includes('未调用 851LAB 抠图'));

  // 验证实际发送至千问的 Prompt 没有透明要求
  assert.ok(capturedBody, '必须捕获到请求体');
  const sentPrompt = capturedBody.input.messages[0].content.find(item => item.text)?.text;
  assert.doesNotMatch(sentPrompt, /alpha/i);
  assert.doesNotMatch(sentPrompt, /transparent/i);
  assert.doesNotMatch(sentPrompt, /透明/);
});
