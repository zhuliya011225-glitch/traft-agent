// Vercel Serverless Function — 调用智谱 AI 生成发布策略
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function buildSystemPrompt(platform, lockedStyle) {
  const platformRules = {
    '抖音': `抖音发布规则：
- 标题：15-20字，口语化，可带emoji，避免过度标题党
- 文案：3-5行，引导评论/点赞/关注，带话题标签3-5个
- 标签：#相关领域标签 + #热点标签 + #挑战标签
- 封面：真人出镜最佳，表情夸张有冲击力，大字标题
- 最佳时间：工作日19:00-22:00，周末10:00-12:00、20:00-23:00
- BGM：热门音乐或节奏感强的音乐`,
    '小红书': `小红书发布规则：
- 标题：20-25字，情绪化表达，多用"绝了""宝藏""封神"等词
- 文案：分段清晰，每段2-3行，多emoji，引导收藏，带话题标签8-12个
- 标签：#细分领域标签 + #场景标签 + #人群标签
- 封面：3:4竖图，拼图或多图拼接，文字醒目，配色统一
- 最佳时间：工作日12:00-13:00、21:00-23:00，周末10:00-11:00、20:00-22:00
- 视觉：高饱和度、ins风、对比强烈`,
    '视频号': `视频号发布规则：
- 标题：15-25字，真诚分享感，避免过度营销
- 文案：5-8行，故事化表达，引导转发给家人朋友，带话题标签3-5个
- 标签：#通用标签 + #情感标签 + #生活标签
- 封面：16:9横图或1:1方图，温馨/正能量画面
- 最佳时间：早晚通勤时间7:00-9:00、18:00-20:00，午休12:00-13:00
- 风格：正能量、实用、适合家庭群分享`,
    'B站': `B站发布规则：
- 标题：25-35字，可带【】标签，信息量大，有梗
- 文案：详细分段，可带时间轴/章节导航，引导一键三连，带话题标签5-8个
- 标签：#分区标签 + #系列标签 + #梗标签
- 封面：16:9横图，信息密度高，标题醒目，风格统一
- 最佳时间：周五-周日18:00-22:00，工作日12:00-14:00、20:00-23:00
- 风格：知识感、真诚、有信息量、适合弹幕互动`,
  };

  const styleGuide = {
    'auto': '根据脚本内容自动判断最合适的标题风格',
    'shock': '震惊型：用极端对比、反常识、数据冲击吸引点击',
    'dry': '干货型：突出价值感、方法论、可操作性',
    'question': '提问型：用疑问句引发好奇，制造认知缺口',
  };

  return `你是一位顶级短视频分发策略专家。你的任务是根据用户提供的脚本内容，生成针对特定平台的完整发布策略。

【平台规则】
${platformRules[platform] || platformRules['抖音']}

【标题风格要求】
${styleGuide[lockedStyle] || styleGuide['auto']}

【输出格式】
请严格按照以下JSON格式输出（不要包含markdown代码块标记）：

{
  "titles": [
    "标题1（15-35字，基于脚本核心观点）",
    "标题2（不同角度）",
    "标题3（再换一个切入点）"
  ],
  "copy": "优化后的发布文案（3-8行，带emoji，引导互动）",
  "tags": ["#标签1", "#标签2", "#标签3", "#标签4", "#标签5", "#标签6"],
  "covers": [
    {"type": "封面类型1", "desc": "具体设计建议", "color": "bg-blue-50", "textColor": "text-text"},
    {"type": "封面类型2", "desc": "备选方案", "color": "bg-purple-50", "textColor": "text-text"}
  ],
  "time": "最佳发布时间段",
  "confidence": 92,
  "reasons": ["推荐理由1", "推荐理由2", "推荐理由3"]
}

【绝对禁令】
❌ 禁止生成与脚本内容无关的通用标题
❌ 禁止使用固定模板句式如"99%的人不知道"
❌ 标题必须从脚本核心观点出发
❌ 标签必须与脚本主题高度相关`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ZHIPUAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '服务器未配置 API Key' });
  }

  try {
    const { scriptContent, platform, lockedStyle } = req.body;

    if (!scriptContent || !platform) {
      return res.status(400).json({ error: '缺少脚本内容或平台参数' });
    }

    const systemContent = buildSystemPrompt(platform, lockedStyle);
    const userContent = `请根据以下脚本内容，生成${platform}平台的发布策略：

【脚本内容】
${scriptContent.slice(0, 3000)}

要求：
1. 标题必须从脚本核心观点出发，不能是通用标题
2. 文案要适配${platform}平台调性
3. 标签必须与脚本主题高度相关
4. 封面建议要具体可执行`;

    const response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        temperature: 0.8,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(500).json({ error: `智谱 API 错误: ${errorText}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: 'AI 返回内容为空' });
    }

    // 尝试解析JSON
    let strategy;
    try {
      // 清理可能的markdown代码块
      const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
      strategy = JSON.parse(cleanContent);
    } catch (e) {
      // 如果解析失败，返回原始文本
      return res.status(200).json({ 
        strategy: {
          titles: ['解析失败，请重试'],
          copy: content.slice(0, 500),
          tags: ['#重试'],
          covers: [{type: '默认', desc: '请重试'}],
          time: '19:00-21:00',
          reasons: ['解析异常']
        }
      });
    }

    res.status(200).json({ strategy });
  } catch (error) {
    console.error('Distribute error:', error);
    res.status(500).json({ error: error.message || '服务器内部错误' });
  }
}
