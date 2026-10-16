'use strict'

const express = require('express')
const rateLimit = require('express-rate-limit')
const { protect } = require('../middleware/auth')
const router = express.Router()

const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { suggestions: [] } })
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

router.post('/message-suggestions', protect, limiter, async (req, res) => {
  // Suggestions are deliberately best-effort: every failure returns an empty list.
  res.set('Cache-Control', 'no-store')
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  if (!process.env.GEMINI_API_KEY || text.length < 12 || text.length > 700 || !/[\\p{L}]/u.test(text)) {
    return res.json({ suggestions: [] })
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4500)
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Identify the language of this message and suggest up to 2 concise, natural rewrites in the SAME language. Preserve meaning and tone. Do not translate unless the message mixes languages. Return ONLY JSON: {"language":"language name","suggestions":["rewrite 1","rewrite 2"]}. If it is too short or already natural, return an empty suggestions array. Message: ${text}` }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 180 },
      }),
    })
    if (!response.ok) return res.json({ suggestions: [] })
    const data = await response.json()
    const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    const parsed = JSON.parse(raw)
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(s => typeof s === 'string' && s.trim() && s.length <= 700).slice(0, 2) : []
    return res.json({ language: typeof parsed.language === 'string' ? parsed.language.slice(0, 40) : '', suggestions })
  } catch (_) {
    return res.json({ suggestions: [] })
  } finally { clearTimeout(timeout) }
})

module.exports = router
