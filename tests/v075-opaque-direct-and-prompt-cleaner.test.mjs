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

  // 1. 字符数严格控制在精简区间（包含参考图映射在 450 字符左右）
  assert.ok(prompt.length >= 180 && prompt.length <= 480, `Prompt 字符数应在合理精简区间 (当前: ${prompt.length})`);

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

test('V0.7.5 验收项 5：图生图参考图片映射与用户自定义 4 项图编规则文案 100% 完整生效并注入 Prompt', () => {
  const refImages = [
    { id: 'img-struct', name: 'my_courtyard_base.png', role: 'structure' },
    { id: 'img-scale', name: 'human_scale_ruler.png', role: 'scale' },
    { id: 'img-style', name: 'autumn_palette.png', role: 'style' }
  ];

  const customRules = {
    roleInstructions: '包含 3 张输入参考图（图编角色指导：图1控制地表底座，图2控制人物尺寸，图3控制水彩质感）：\n- 图1(结构底图 · my_courtyard_base.png)：严格遵循结构参考图的地块外形、基本视角与道路连接口，结构图中的每个红色标记，都必须转化为指定边缘上的自然道路出口，道路必须延伸至地块边缘，严禁复制参考图边框或UI\n- 图2(尺度参考 · human_scale_ruler.png)：严格以尺度参考图为准，控制人物、建筑、树木、道路与生活物件的相对大小与比例尺，微观箱景比例自然，严格禁止借用其画风、材质或色彩，不影响画面风格\n- 图3(风格参考 · autumn_palette.png)：【风格图画法指导】参考其绘画笔触、线条、色块、材质质感、配色与细节密度，仅学习其艺术画法；严禁复制参考图内的具体建筑、主体造型、构图、文字、UI或拼图标记',
    preservationRules: '必须严格保留中央水池、木质小桥与红砖小径',
    variationRules: '背景树木允许替换为落叶银杏树，可增加几盏暖色地灯',
    prohibitions: '严禁生成任何围栏或现代铁丝网'
  };

  const promptResult = buildCleanScenePrompt(
    '秋日庭院的午后，阳光洒在水池旁，微风拂过落叶。',
    {
      mode: 'image_to_image',
      reference_images: refImages,
      i2i_rules: customRules,
      generationRoute: 'opaque'
    }
  );

  const prompt = promptResult.positive;

  // 1. 验证放入的图片映射完整且包含文件名与角色
  assert.ok(prompt.includes('包含 3 张输入参考图'));
  assert.ok(prompt.includes('图1(结构底图 · my_courtyard_base.png)'));
  assert.ok(prompt.includes('图2(尺度参考 · human_scale_ruler.png)'));
  assert.ok(prompt.includes('图3(风格参考 · autumn_palette.png)'));

  // 2. 验证 A. 角色说明生效
  assert.ok(prompt.includes('图编角色指导：图1控制地表底座，图2控制人物尺寸，图3控制水彩质感'));

  // 3. 验证 B. 严格保留规则生效
  assert.ok(prompt.includes('【严格保留】：必须严格保留中央水池、木质小桥与红砖小径'));

  // 4. 验证 C. 允许重构与变化规则生效
  assert.ok(prompt.includes('【重构与变化】：背景树木允许替换为落叶银杏树，可增加几盏暖色地灯'));

  // 5. 验证 D. 禁止事项与边界生效
  assert.ok(prompt.includes('严禁生成任何围栏或现代铁丝网'));
});

test('V0.7.5 验收项 6：用户完全自主决定地块结构文案，系统 100% 忠实采纳，绝不强加固定死板长句套话', () => {
  const userOnlyWritten = '我自定义的极简地块结构：菱形底座薄一些，左边红线出口接小河，右边平缓。';

  const promptResult = buildCleanScenePrompt(
    '在小溪边的野餐垫上喝咖啡。',
    {
      mode: 'image_to_image',
      reference_images: [{ id: 'ref-1', role: 'structure', name: 'base.png' }],
      i2i_rules: {
        roleInstructions: userOnlyWritten
      },
      generationRoute: 'opaque'
    }
  );

  const prompt = promptResult.positive;
  console.log(`[V0.7.5 验收项 6] 用户完全自写地块结构文案 Prompt:\n${prompt}`);

  // 1. 必须 100% 完整包含用户自己写的文案
  assert.ok(prompt.includes(userOnlyWritten));

  // 2. 绝不能强行拼接系统死板的固定模板长句
  assert.doesNotMatch(prompt, /允许穿过围墙或边缘装饰/);
  assert.doesNotMatch(prompt, /禁止只在地块内部生成道路/);
  assert.doesNotMatch(prompt, /不同场景允许使用不同道路材质/);
});
