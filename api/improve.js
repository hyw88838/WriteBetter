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

    // ── 模式说明 ──
    var modeNames = {
        'grammar': 'fix all grammar and spelling errors',
        'polish': 'polish and improve the writing quality',
        'academic': 'rewrite in formal academic English',
        'business': 'rewrite for professional business context',
        'creative': 'enhance with more vivid and compelling language',
        'simplify': 'simplify for easy understanding'
    };

    var toneNames = {
        'neutral': '',
        'formal': 'Use a formal tone.',
        'casual': 'Use a casual and relaxed tone.',
        'confident': 'Use a confident and assertive tone.',
        'friendly': 'Use a warm and friendly tone.'
    };

    var modeAction = modeNames[mode] || modeNames['polish'];
    var toneNote = toneNames[tone] || '';

    // ═══════════════════════════════════════
    //  第一步：让 AI 润色文本（纯文本返回）
    // ═══════════════════════════════════════
    var prompt1 = 'You are an expert English editor. ' + modeAction.charAt(0).toUpperCase() + modeAction.slice(1) + '. ' + toneNote + '\n\n' +
        'IMPORTANT: Return ONLY the improved English text. Do NOT add any explanation, greeting, label, or markdown. Just the improved text itself.\n\n' +
        'Original text:\n' + text.trim();

    try {
        // ── 调用润色 ──
        var resp1 = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'user', content: prompt1 }
                ],
                temperature: 0.3,
                max_tokens: 3000
            })
        });

        if (!resp1.ok) {
            var err1 = await resp1.text();
            console.error('API Error 1:', resp1.status, err1);
            return res.status(502).json({ error: 'AI服务不可用' });
        }

        var data1 = await resp1.json();
        var improved = data1.choices?.[0]?.message?.content;
        if (!improved) return res.status(502).json({ error: 'AI未返回内容' });

        // 清理 AI 可能添加的前缀
        improved = improved.trim()
            .replace(/^(here is|here's|the improved|improved version|polished version|revised version).*?:\s*/i, '')
            .replace(/^["']|["']$/g, '')
            .trim();

        // ── 润色结果对比（简单diff）──
        var changes = buildChanges(text.trim(), improved);

        // ── 第二步：让 AI 打分 ──
        var prompt2 = 'You are an English writing evaluator. Rate the following English text on 4 dimensions, each 0-100.\n\n' +
            'Text to evaluate:\n---\n' + text.trim() + '\n---\n\n' +
            'Return ONLY a JSON object, nothing else. Start with { and end with }:\n' +
            '{"grammar":75,"clarity":80,"vocabulary":70,"flow":72,"overall":74,"summary":"Brief feedback in Chinese, 30-50 words"}';

        var resp2 = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_KEY
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'user', content: prompt2 }
                ],
                temperature: 0.2,
                max_tokens: 500
            })
        });

        var score = { grammar: 70, clarity: 70, vocabulary: 70, flow: 70, overall: 70, summary: '' };

        if (resp2.ok) {
            var data2 = await resp2.json();
            var scoreContent = data2.choices?.[0]?.message?.content;
            if (scoreContent) {
                var parsed = parseJSON(scoreContent);
                if (parsed) {
                    score.grammar = num(parsed.grammar, 70);
                    score.clarity = num(parsed.clarity, 70);
                    score.vocabulary = num(parsed.vocabulary, 70);
                    score.flow = num(parsed.flow, 70);
                    score.overall = num(parsed.overall, 70);
                    score.summary = parsed.summary || '';
                }
            }
        }

        // ── 拼装结果 ──
        var result = {
            improved: improved,
            changes: changes,
            score: score,
            summary: score.summary || '文本已优化，对比查看改动详情。'
        };

        return res.status(200).json({
            success: true,
            result: result,
            usage: data1.usage || {}
        });

    } catch (err) {
        console.error('Server Error:', err);
        return res.status(500).json({ error: '处理失败' });
    }
}

// ── JSON 解析（4种方法）──
function parseJSON(str) {
    // 方法1: 直接解析
    try { return JSON.parse(str.trim()); } catch(e) {}

    // 方法2: 去掉代码块
    try {
        var m = str.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (m) return JSON.parse(m[1].trim());
    } catch(e) {}

    // 方法3: 第一个 { 到最后一个 }
    try {
        var s = str.indexOf('{');
        var e = str.lastIndexOf('}');
        if (s !== -1 && e !== -1 && e > s) return JSON.parse(str.substring(s, e + 1));
    } catch(e) {}

    // 方法4: 所有JSON块取最长
    try {
        var all = str.match(/\{[\s\S]*\}/g);
        if (all && all.length > 0) {
            var longest = all.sort(function(a, b) { return b.length - a.length; })[0];
            return JSON.parse(longest);
        }
    } catch(e) {}

    return null;
}

// ── 安全取数字 ──
function num(val, fallback) {
    var n = parseInt(val);
    return (isNaN(n) || n < 0 || n > 100) ? fallback : n;
}

// ── 简单对比：找出原文和润色后的差异 ──
function buildChanges(original, improved) {
    var changes = [];
    var origSentences = splitSentences(original);
    var impSentences = splitSentences(improved);

    // 逐句对比
    var maxLen = Math.max(origSentences.length, impSentences.length);
    for (var i = 0; i < maxLen && changes.length < 8; i++) {
        var o = origSentences[i] || '';
        var p = impSentences[i] || '';
        if (o && p && normalize(o) !== normalize(p)) {
            changes.push({
                original: o.trim(),
                improved: p.trim(),
                reason: '优化了表达方式和语法'
            });
        }
    }

    // 如果句子数不匹配，做模糊匹配
    if (changes.length === 0 && original !== improved) {
        changes.push({
            original: original.substring(0, 100) + (original.length > 100 ? '...' : ''),
            improved: improved.substring(0, 100) + (improved.length > 100 ? '...' : ''),
            reason: '整体优化了语法、用词和流畅度'
        });
    }

    return changes;
}

function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+/).filter(function(s) { return s.trim().length > 0; });
}

function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}
