export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { text, mode, tone } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: '请输入英文文本' });
    if (text.trim().length < 10) return res.status(400).json({ error: '文本太短，至少输入10个字符' });
    if (text.trim().length > 5000) return res.status(400).json({ error: '文本过长，最多支持5000字符' });

    const API_KEY = process.env.AI_API_KEY;
    const API_URL = process.env.AI_API_URL;
    const MODEL   = process.env.AI_MODEL;

    if (!API_KEY || !API_URL) {
        return res.status(500).json({ error: '服务未配置' });
    }

    // ── 模式提示词 ──
    const modePrompts = {
        'grammar': 'You are a precise grammar and spelling checker. Fix all grammar errors, spelling mistakes, punctuation issues, and awkward phrasing. Keep the original meaning and style intact. Do NOT rewrite or improve — only fix errors.',

        'polish': 'You are a skilled English writing editor. Improve the text by: 1. Fixing grammar and spelling errors 2. Improving sentence flow and readability 3. Replacing repetitive words with better alternatives 4. Making the tone more natural and professional. Keep the original meaning and structure. Do NOT add new content.',

        'academic': 'You are an academic writing specialist. Transform the text into formal academic English: 1. Use formal vocabulary and academic register 2. Apply hedging language where appropriate 3. Use passive voice where conventional in academic writing 4. Ensure proper transitions between ideas 5. Fix all grammar issues. Maintain the original argument and evidence.',

        'business': 'You are a business communication expert. Rewrite the text for professional business context: 1. Be concise and direct 2. Use active voice and strong verbs 3. Structure ideas clearly with logical flow 4. Use appropriate business vocabulary 5. Ensure polite but confident tone. Keep the core message intact.',

        'creative': 'You are a creative writing coach. Enhance the text with: 1. More vivid and descriptive language 2. Better sentence variety 3. Stronger word choices and imagery 4. Improved rhythm and flow 5. More engaging opening and closing. Keep the original story/message but make it more compelling.',

        'simplify': 'You are a plain English specialist. Simplify the text: 1. Replace complex words with simpler alternatives 2. Shorten long sentences 3. Remove jargon and unnecessary technical terms 4. Use active voice instead of passive 5. Make it accessible to non-native English speakers. Keep all the original information.'
    };

    const modeDesc = {
        'grammar': 'fix grammar errors in',
        'polish': 'polish and improve',
        'academic': 'rewrite in academic style',
        'business': 'rewrite for business context',
        'creative': 'enhance creatively',
        'simplify': 'simplify'
    };

    const toneDesc = {
        'neutral': 'neutral',
        'formal': 'formal',
        'casual': 'casual and relaxed',
        'confident': 'confident and assertive',
        'friendly': 'warm and friendly'
    };

    const systemPrompt = modePrompts[mode] || modePrompts['polish'] + (tone && tone !== 'neutral' ? ' Write in a ' + (toneDesc[tone] || tone) + ' tone.' : '') +

`

CRITICAL OUTPUT RULES:
- Return ONLY a raw JSON object. Nothing else.
- Your response MUST start with { and end with }
- Do NOT include ANY text before the opening {
- Do NOT include ANY text after the closing }
- Do NOT use markdown code blocks
- Do NOT say "Here is" or any preamble or explanation
- Just pure JSON, nothing more

JSON structure:
{
  "improved": "The full improved English text",
  "changes": [
    {
      "original": "original phrase",
      "improved": "improved phrase",
      "reason": "Reason in Chinese, 10-20 words"
    }
  ],
  "score": {
    "grammar": 85,
    "clarity": 78,
    "vocabulary": 72,
    "flow": 80,
    "overall": 79
  },
  "summary": "Overall feedback in Chinese, 30-50 words"
}

Score values 0-100 based on ORIGINAL text quality.
Changes: list TOP 5-10 most important changes only.
Summary: brief assessment in Chinese.`;

    const userPrompt = modeDesc[mode] || 'improve' + ' this English text. Return ONLY JSON, nothing else:\n\n---\n' + text.trim() + '\n---';

    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 4000
            })
        });

        if (!resp.ok) {
            const t = await resp.text();
            console.error('API Error:', resp.status, t);
            return res.status(502).json({ error: 'AI服务不可用' });
        }

        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) return res.status(502).json({ error: 'AI未返回内容' });

        // ── 4种方法尝试解析JSON ──
        var result = null;

        // 方法1: 直接解析（清理前后空白和代码块标记）
        try {
            var c1 = content.trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            result = JSON.parse(c1);
        } catch(e1) {}

        // 方法2: 正则提取代码块
        if (!result) {
            try {
                var m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (m) result = JSON.parse(m[1].trim());
            } catch(e2) {}
        }

        // 方法3: 提取第一个 { 到最后一个 }
        if (!result) {
            try {
                var s = content.indexOf('{');
                var e = content.lastIndexOf('}');
                if (s !== -1 && e !== -1 && e > s) {
                    result = JSON.parse(content.substring(s, e + 1));
                }
            } catch(e3) {}
        }

        // 方法4: 找所有JSON块，取最长的
        if (!result) {
            try {
                var all = content.match(/\{[\s\S]*\}/g);
                if (all && all.length > 0) {
                    var longest = all.sort(function(a, b) { return b.length - a.length; })[0];
                    result = JSON.parse(longest);
                }
            } catch(e4) {}
        }

        if (!result || !result.improved) {
            console.error('Parse failed. Raw content:', content.substring(0, 500));
            return res.status(502).json({ error: 'AI输出格式异常，请重试' });
        }

        // 补全缺失字段
        result.improved = result.improved || text;
        result.changes = Array.isArray(result.changes) ? result.changes : [];
        result.score = result.score || { grammar: 70, clarity: 70, vocabulary: 70, flow: 70, overall: 70 };
        result.summary = result.summary || '';

        return res.status(200).json({ success: true, result: result, usage: data.usage || {} });

    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: '处理失败' });
    }
}
