// api/pm-feedback.js
//
// Serverless endpoint for the PM Note tab's feedback box.
//
// Flow:
//   1. Browser POSTs { feedback: "<PM's text>" }
//   2. This function fetches today's already-published pm_summary.json
//      and latest.json (condensed) from the PUBLIC output repo -- no
//      GitHub auth needed for that, they're already public raw files,
//      same URLs the frontend itself uses.
//   3. Calls Gemini directly (REST, no SDK needed server-side) with a
//      prompt asking it to compare the PM's stated view against its
//      own independent read of today's data -- agreement points,
//      divergences, and which divergences are interpretation vs. a
//      factual gap.
//   4. Returns the structured comparison to the browser immediately.
//   5. Separately, appends a LIGHTWEIGHT entry (not the raw feedback
//      text) to data/pm_feedback_log.json in the PRIVATE repo, via the
//      same GitHub Contents API read-modify-write pattern used in
//      trigger-refresh.js's readLog()/writeLog(). This is what lets
//      tomorrow's PM Note prompt reference "yesterday's divergences"
//      without the log growing into an ever-larger wall of raw text.
//
// Required Vercel environment variables:
//   GITHUB_DISPATCH_TOKEN  - same token trigger-refresh.js already uses
//                            (Contents: read and write on the private repo)
//   GEMINI_API_KEY         - same key used by daily_screen.py

const OWNER = "zeeshan141188-hash";
const REPO = "india-equity-dashboard";              // private repo -- feedback log lives here
const OUTPUT_REPO = "india-equity-dashboard-output"; // public repo -- today's data lives here
const LOG_PATH = "data/pm_feedback_log.json";
const GEMINI_MODEL = "gemini-flash-latest";

const GITHUB_API = "https://api.github.com";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${OUTPUT_REPO}/main`;

function gstDateString(date = new Date()) {
  const gst = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  return gst.toISOString().slice(0, 10);
}

async function githubRequest(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  return res;
}

// Same read-modify-write shape as trigger-refresh.js's readLog(), applied
// to a different file. If the log doesn't exist yet (first-ever feedback
// submission), start with an empty array.
async function readFeedbackLog() {
  const res = await githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${LOG_PATH}`
  );

  if (res.status === 404) {
    return { sha: null, entries: [] };
  }
  if (!res.ok) {
    throw new Error(`Failed to read feedback log: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const decoded = Buffer.from(json.content, "base64").toString("utf-8");
  const parsed = JSON.parse(decoded);
  return { sha: json.sha, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
}

async function writeFeedbackLog(sha, entries) {
  const content = Buffer.from(JSON.stringify({ entries }, null, 2)).toString("base64");
  const body = {
    message: `PM feedback log update: ${gstDateString()}`,
    content,
    ...(sha ? { sha } : {}),
  };

  const res = await githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${LOG_PATH}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to write feedback log: ${res.status} ${await res.text()}`);
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

const COMPARISON_SYSTEM_INSTRUCTIONS = `You are helping a portfolio manager compare their own \
market read against an AI-generated summary of the same day's quantitative screening data. \
You will be given: (1) the PM's own written observation, and (2) today's already-generated \
PM Note (a structured summary of breadth, sector leadership, laggards, and notable setups, \
already derived from the PM's screening pipeline).

Your job is ONLY to compare these two views -- do not introduce new market opinions of your \
own beyond what's needed to identify agreement or divergence. Be concise and specific: name \
sectors, tickers, or themes where they overlap or clash.

Respond ONLY with a single JSON object (no markdown fences, no preamble) matching this exact \
schema:

{
  "agreement": "<1-2 sentences on where the PM's view and today's PM Note align>",
  "divergence": "<1-2 sentences on where they differ, if at all -- state clearly if there is no meaningful divergence>",
  "divergence_type": "<one of: 'interpretation' (both saw the same data, disagree on meaning), 'factual_gap' (PM knows something the data/model didn't capture), 'none'>",
  "note_for_tomorrow": "<a single short, durable takeaway (max ~20 words) worth remembering for future PM Notes, or empty string if nothing durable emerged today>"
}`;

async function callGeminiComparison(pmFeedback, pmNote, latestSummary) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const prompt = `PM's observation today:\n"${pmFeedback}"\n\n` +
    `Today's PM Note (already generated from the screening data):\n${JSON.stringify(pmNote, null, 2)}\n\n` +
    `Supporting context (today's run status):\n${JSON.stringify(latestSummary, null, 2)}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: COMPARISON_SYSTEM_INSTRUCTIONS }] },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // Google's free-tier Gemini models occasionally return 503 "high demand"
  // errors that are almost always transient (resolve within seconds). This
  // is a live user-facing action (unlike daily_screen.py's Step 6, which
  // can just skip a day silently), so rather than surface a raw 503 to the
  // PM and make them manually retry, retry automatically here first with a
  // short backoff. 3 attempts total, ~1.5s then ~3s between them.
  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini returned no text content");
      return JSON.parse(text);
    }

    const bodyText = await res.text();
    lastError = new Error(`Gemini API error: ${res.status} ${bodyText}`);

    // Only retry on 503 (overloaded) -- anything else (bad key, bad
    // request, quota exhausted) won't be fixed by waiting, so fail fast.
    if (res.status !== 503 || attempt === MAX_ATTEMPTS) {
      throw lastError;
    }

    await new Promise(r => setTimeout(r, attempt * 1500));
  }

  throw lastError;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GITHUB_DISPATCH_TOKEN) {
    return res.status(500).json({ error: "Server misconfigured: missing GitHub token" });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Server misconfigured: missing Gemini key" });
  }

  const feedback = (req.body?.feedback || "").trim();
  if (!feedback) {
    return res.status(400).json({ error: "Feedback text is required" });
  }
  if (feedback.length > 2000) {
    return res.status(400).json({ error: "Feedback too long (max 2000 characters)" });
  }

  try {
    // Step 1: pull today's already-published PM Note + latest.json status
    // (public output repo, no auth needed -- same files the dashboard itself reads).
    const [pmNote, latest] = await Promise.all([
      fetchJson(`${RAW_BASE}/pm_summary.json`),
      fetchJson(`${RAW_BASE}/latest.json`),
    ]);

    const latestSummary = {
      run_date: latest.run_date,
      universe_size: latest.universe_size,
      status: latest.status,
    };

    // Step 2: the actual comparison call.
    const comparison = await callGeminiComparison(feedback, pmNote, latestSummary);

    // Step 3: log a LIGHTWEIGHT structured entry (not the raw feedback
    // text) so tomorrow's PM Note prompt can reference it cheaply.
    const today = gstDateString();
    const { sha, entries } = await readFeedbackLog();
    entries.push({
      date: today,
      divergence_type: comparison.divergence_type || "none",
      note_for_tomorrow: comparison.note_for_tomorrow || "",
    });
    await writeFeedbackLog(sha, entries);

    return res.status(200).json({ status: "ok", comparison });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to process feedback", detail: String(err.message || err) });
  }
}
