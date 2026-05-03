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
        'grammar': `You are a precise grammar and spelling checker. Fix all grammar errors, spelling mistakes, punctuation issues, and awkward phrasing. Keep the original meaning and style intact. Do NOT rewrite or improve — only fix errors.`,

        'polish': `You are a skilled English writing editor. Improve the text by:
1. Fixing grammar and spelling errors
2. Improving sentence flow and readability
3. Replacing repetitive words with better alternatives
4. Making the tone more natural and professional
Keep the original meaning and structure. Do NOT add new content.`,

        'academic': `You are an academic writing specialist. Transform the text into formal academic English:
1. Use formal vocabulary and academic register
2. Apply hedging language where appropriate (e.g., "suggests that", "appears to")
3. Use passive voice where conventional in academic writing
4. Ensure proper transitions between ideas
5. Fix all grammar issues
Maintain the original argument and evidence.`,

        'business': `You are a business communication expert. Rewrite the text for professional business context:
1. Be concise and direct — remove filler words
2. Use active voice and strong verbs
3. Structure ideas clearly with logical flow
4. Use appropriate business vocabulary
5. Ensure polite but confident tone
Keep the core message intact.`,

        'creative': `You are a creative writing coach. Enhance the text with:
1. More vivid and descriptive language
2. Better sentence variety (mix short and long sentences)
3. Stronger word choices and imagery
4. Improved rhythm and flow
5. More engaging opening and closing
Keep the original story/message but make it more compelling.`,

        'simplify': `You are a plain English specialist. Simplify the text:
1. Replace complex words with simpler alternatives
2. Shorten long sentences (aim for 15-20 words average)
3. Remove jargon and unnecessary technical terms
4. Use active voice instead of passive
5. Make it accessible to non-native English speakers
Keep all the original information.`
    };

    const modeDesc = {
        'grammar': '语法纠错',
        'polish': '润色优化',
        'academic': '学术写作',
        'business': '商务写作',
        'creative': '创意写作',
        'simplify': '简化表达'
    };

    const toneDesc = {
        'neutral': '保持中性',
        'formal': '正式',
        'casual': '轻松',
        'confident': '自信',
        'friendly': '友好'
    };

    const systemPrompt = `${modePrompts[mode] || modePrompts['polish']}

${tone && tone !== 'neutral' ? `Additional tone requirement: Write in a ${toneDesc[tone] || tone} tone.` : ''}

【输出格式】
Return a valid JSON object with this exact structure. Do NOT wrap in markdown code blocks. Return ONLY the JSON:
{
  "improved": "The full improved text here",
  "changes": [
    {
      "original": "the original phrase or sentence",
      "improved": "the improved version",
      "reason": "Brief explanation of why this change was made (in Chinese, 10-20 words)"
    }
  ],
  "score": {
    "grammar": 85,
    "clarity": 78,
    "vocabulary": 72,
    "flow": 80,
    "overall": 79
  },
  "summary": "Brief overall feedback in Chinese (30-50 words)"
}

Rules:
- "changes" should list the TOP 5-10 most important changes (not every minor fix)
- "score" values are 0-100 based on the ORIGINAL text quality
- "summary" is a brief overall assessment in Chinese
- If the original text is already good, scores should be high and changes list should be short`;

    const userPrompt = `Please ${modeDesc[mode] || 'improve'} the following English text:

---
${text.trim()}
---

Return only the JSON.`;

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

        // Parse JSON
        let result;
        try { result = JSON.parse(content); }
        catch {
            const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (m) result = JSON.parse(m[1].trim());
            else {
                const b = content.match(/\{[\s\S]*\}/);
                result = b ? JSON.parse(b[0]) : null;
            }
        }

        if (!result?.improved) {
            return res.status(502).json({ error: 'AI输出格式异常' });
        }

        // Normalize
        result.improved = result.improved || text;
        result.changes = Array.isArray(result.changes) ? result.changes : [];
        result.score = result.score || { grammar: 70, clarity: 70, vocabulary: 70, flow: 70, overall: 70 };
        result.summary = result.summary || '';

        return res.status(200).json({ success: true, result, usage: data.usage || {} });

    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '处理失败' });
    }
}
