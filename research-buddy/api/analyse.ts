import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow the GitHub Pages origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { studyName, studyType, summary, priorStudies } = req.body as {
    studyName: string; studyType: string; summary: string; priorStudies: string;
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key not configured on server." });

  const prompt = `You are a senior UX researcher at ASOS. Analyse this ${studyType} study called "${studyName}". Be concise. Return ONLY valid JSON, no markdown, no code fences, no trailing text after the closing brace.

TRANSCRIPT:
${summary}
${priorStudies}

Return exactly this JSON (keep values concise, max 2 quotes per insight):
{"executiveSummary":"2 sentence summary for senior stakeholders","overallSentiment":"positive|mixed|negative","confidenceScore":80,"keyInsights":[{"title":"title","description":"1-2 sentences","type":"positive|negative|neutral","severity":"critical|major|minor","quotes":["quote"]}],"whatWorked":[{"finding":"finding","quote":"quote","impact":"impact"}],"whatDidntWork":[{"finding":"finding","quote":"quote","severity":"critical|major|minor"}],"designRecommendations":[{"recommendation":"recommendation","rationale":"rationale","priority":"high|medium|low","effort":"low|medium|high"}],"nextSteps":{"furtherTestingNeeded":true,"rationale":"1-2 sentences","recommendedTests":[{"testType":"type","objective":"objective","howToRun":"brief steps","participants":"number and profile","estimatedTime":"e.g. 1 week"}]},"crossStudyPatterns":"brief pattern or null"}`;

  try {
    const upstream = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(502).json({ error: "AI service error: " + err.slice(0, 200) });
    }

    const data = await upstream.json() as { content: { text: string }[] };
    const raw = data.content?.map((b) => b.text || "").join("") || "";

    let report;
    try {
      report = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      return res.status(502).json({ error: "Could not parse AI response. Raw: " + raw.slice(0, 120) });
    }

    return res.status(200).json({ report });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
