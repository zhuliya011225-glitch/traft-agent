import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import dotenv from 'dotenv';
// @ts-ignore
import mammoth from 'mammoth';
// @ts-ignore
import pdfParse from 'pdf-parse';

// 加载 .env 文件
dotenv.config();

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// 本地 API 处理插件
function localApiPlugin() {
  return {
    name: 'local-api',
    configureServer(server) {
      // 处理文件上传
      server.middlewares.use('/api/upload', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const apiKey = process.env.ZHIPUAI_API_KEY;

        try {
          // 简单解析 multipart form data
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          const boundary = req.headers['content-type']?.split('boundary=')[1];

          if (!boundary) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: '无效的表单数据' }));
            return;
          }

          // 解析文件内容
          const boundaryStr = `--${boundary}`;
          const parts = buffer.toString('binary').split(boundaryStr);
          let fileContent = null;
          let filename = 'file';
          let contentType = 'application/octet-stream';

          for (const part of parts) {
            if (part.includes('Content-Disposition') && part.includes('filename')) {
              const headerEnd = part.indexOf('\r\n\r\n');
              if (headerEnd === -1) continue;

              const header = part.substring(0, headerEnd);
              const body = part.substring(headerEnd + 4);

              // 提取文件名
              const filenameMatch = header.match(/filename="([^"]+)"/);
              if (filenameMatch) {
                filename = filenameMatch[1];
              }

              // 提取 Content-Type
              const ctMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
              if (ctMatch) {
                contentType = ctMatch[1];
              }

              // 提取文件内容
              const bodyEnd = body.lastIndexOf('\r\n');
              if (bodyEnd !== -1) {
                fileContent = Buffer.from(body.substring(0, bodyEnd), 'binary');
              }
              break;
            }
          }

          if (!fileContent) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: '未找到上传的文件' }));
            return;
          }

          const ext = filename.split('.').pop()?.toLowerCase();
          let text = '';

          if (ext === 'txt' || ext === 'md') {
            text = fileContent.toString('utf-8');
          } else if (ext === 'docx') {
            const result = await mammoth.extractRawText({ buffer: fileContent });
            text = result.value;
          } else if (ext === 'pdf') {
            const result = await pdfParse(fileContent);
            text = result.text;
          } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: '服务器未配置 API Key，无法识别图片' }));
              return;
            }
            // 图片 OCR
            const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            const base64 = fileContent.toString('base64');

            const imgResponse = await fetch(ZHIPU_API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: 'glm-4v-flash',
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: '请提取图片中的所有文字内容，保持原有排版格式。如果图片是手写笔记，也请尽量识别。' },
                      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
                    ],
                  },
                ],
                max_tokens: 2000,
              }),
            });

            const imgData = await imgResponse.json();
            text = imgData.choices?.[0]?.message?.content || '图片文字识别失败';
          } else {
            text = `不支持的文件类型: .${ext}。目前支持: txt, md, docx, pdf, jpg, png, webp`;
          }

          const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n\n[内容已截断，仅保留前8000字]' : text;

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ text: truncated, filename, charCount: text.length }));

        } catch (error) {
          console.error('Upload error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || '文件解析失败' }));
        }
      });

      // 处理脚本生成
      server.middlewares.use('/api/generate', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const apiKey = process.env.ZHIPUAI_API_KEY;
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: '服务器未配置 API Key' }));
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString());

          const { prompt, scriptType, intensity, tempo, opening, platform, optimizationPrompt, contextText } = body;

          const typeMap = {
            emotional: '情绪共鸣型',
            dry: '知识干货型',
            story: '个人经历型',
            list: '清单盘点型',
          };

          const tempoMap = {
            fast: '激进快节奏',
            medium: '沉稳中节奏',
            slow: '细腻慢节奏',
          };

          const openingMap = {
            suspense: '深度悬念式',
            shock: '重磅震惊式',
            resonance: '情感共鸣式',
            question: '反思提问式',
          };

          let systemContent, userContent;

          if (optimizationPrompt && contextText) {
            systemContent = '你是一位资深短视频内容优化专家，擅长根据用户反馈精准调整脚本。';
            userContent = `请基于以下原始脚本，按照用户的优化要求进行修改。

【原始脚本】
${contextText}

【优化要求】
${optimizationPrompt}

请直接输出优化后的完整脚本，保持原有格式结构。`;
          } else {
            systemContent = `你是一位资深短视频内容创作专家，专门帮创作者写出高完播率、高互动的爆款脚本。

【创作要求】
- 平台：${platform || '通用短视频平台'}
- 脚本类型：${typeMap[scriptType] || '通用型'}
- 情绪强度：${intensity || 3}/5（1=平静，5=火热）
- 内容节奏：${tempoMap[tempo] || '中节奏'}
- 开头钩子：${openingMap[opening] || '悬念式'}
- 时长：控制在 30-90 秒的口播量

【重要：禁用词汇】
脚本中严禁使用以下敏感/极限词汇，请用替代表达：
- "赚钱" → "获得收益/实现盈利/创造价值"
- "暴利" → "高回报/可观收益"
- "躺赚" → "被动收入/睡后收入"
- "最" → "非常/极其/相当"
- "第一" → "领先/前列/头部"
- "绝对" → "确实/真的"
- "保证" → "助力/帮助"
- "万能" → "高效/实用"

【输出格式】
请严格按照以下格式输出完整脚本（包含拍摄建议在内）：

# 【标题】
（15字以内的吸睛标题）

## 黄金开头（前3秒）
（强力钩子，必须抓住注意力）

## 正文
（分2-3段，每段有爆点）

## 结尾引导
（引导点赞/关注/评论）

## 拍摄建议
- 镜头：...
- 字幕：...
- BGM：...
- 画面节奏：...

注意：语言口语化、有画面感，适合直接对着镜头念。`;
            userContent = `请根据以下灵感/素材创作短视频脚本：\n\n${prompt || '请创作一个吸引人的短视频脚本'}`;
          }

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
              temperature: 0.75,
              max_tokens: 2500,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `API 错误: ${errorText}` }));
            return;
          }

          const data = await response.json();
          const script = data.choices?.[0]?.message?.content;

          if (!script) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'AI 返回内容为空，请重试' }));
            return;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ script }));

        } catch (error) {
          console.error('Generate error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || '服务器内部错误' }));
        }
      });
    }
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), localApiPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.ZHIPUAI_API_KEY': JSON.stringify(env.ZHIPUAI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: ['es2015', 'safari11'],
      cssTarget: 'safari11',
    },
    ssr: {
      noExternal: ['shiki'],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
