// api/trigger-refresh.js
//
// Serverless proxy for the "Update" button on the dashboard.
// - Holds the GitHub token(s) server-side (never exposed to the browser)
// - Enforces a hard limit of MAX_REFRESHES_PER_DAY, tracked in a JSON
//   file committed to the private repo (data/refresh_log.json)
// - Day boundary is anchored to GST (UTC+4), matching how the rest
//   of the pipeline reasons about "today"
// - Dispatches TWO workflows on each trigger: the main dashboard's
//   daily_screen.yml AND india-thematics's india_financials_update.yml.
//   The thematics dispatch is NON-FATAL -- if it fails, the main
//   dashboard refresh still succeeds and is reported as such. A
//   Financials-pipeline hiccup should never block the primary update.
//
// Required Vercel environment variables:
//   GITHUB_DISPATCH_TOKEN            - fine-grained PAT, scoped to ONLY
//                                       india-equity-dashboard, with
//                                       "Actions: read and write" and
//                                       "Contents: read and write"
//   GITHUB_DISPATCH_TOKEN_THEMATICS  - separate fine-grained PAT, scoped
//                                       to ONLY india-thematics, with
//                                       "Actions: read and write"
//                                       (least-privilege -- kept separate
//                                       from the main token rather than
//                                       widening its scope)
//
// Required constants below — adjust OWNER/REPO if they ever change.

const OWNER = "zeeshan141188-hash";
const REPO = "india-equity-dashboard";
const WORKFLOW_FILE = "daily_screen.yml";
const LOG_PATH = "data/refresh_log.json";
const MAX_REFRESHES_PER_DAY = 2;

const THEMATICS_REPO = "india-thematics";
const THEMATICS_WORKFLOW_FILE = "india_financials_update.yml";

const GITHUB_API = "https://api.github.com";

function gstDateString(date = new Date()) {
  // Shift to GST (UTC+4) before taking the calendar date, so the
  // "day" boundary matches Dubai midnight, not UTC midnight.
  const gst = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  return gst.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function githubRequest(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  return res;
}

async function readLog() {
  const res = await githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${LOG_PATH}`,
    process.env.GITHUB_DISPATCH_TOKEN
  );

  if (res.status === 404) {
    // No log yet — first ever use of the button.
    return { sha: null, data: { date: null, count: 0 } };
  }
  if (!res.ok) {
    throw new Error(`Failed to read refresh log: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const decoded = Buffer.from(json.content, "base64").toString("utf-8");
  return { sha: json.sha, data: JSON.parse(decoded) };
}

async function writeLog(sha, data) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
  const body = {
    message: `Update refresh log: ${data.date} count=${data.count}`,
    content,
    ...(sha ? { sha } : {}),
  };

  const res = await githubRequest(
    `/repos/${OWNER}/${REPO}/contents/${LOG_PATH}`,
    process.env.GITHUB_DISPATCH_TOKEN,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to write refresh log: ${res.status} ${await res.text()}`);
  }
}

async function dispatchWorkflow(owner, repo, workflowFile, token) {
  const res = await githubRequest(
    `/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (res.status !== 204) {
    throw new Error(`Failed to dispatch workflow: ${res.status} ${await res.text()}`);
  }
}

async function dispatchThematicsWorkflow() {
  // Best-effort — the caller (handler) treats failures here as non-fatal.
  if (!process.env.GITHUB_DISPATCH_TOKEN_THEMATICS) {
    console.error("GITHUB_DISPATCH_TOKEN_THEMATICS not set — skipping Financials refresh");
    return { ok: false, reason: "missing token" };
  }
  try {
    await dispatchWorkflow(
      OWNER,
      THEMATICS_REPO,
      THEMATICS_WORKFLOW_FILE,
      process.env.GITHUB_DISPATCH_TOKEN_THEMATICS
    );
    return { ok: true };
  } catch (err) {
    console.error("Thematics dispatch failed:", err);
    return { ok: false, reason: String(err.message || err) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GITHUB_DISPATCH_TOKEN) {
    return res.status(500).json({ error: "Server misconfigured: missing token" });
  }

  try {
    const today = gstDateString();
    const { sha, data } = await readLog();

    // Reset count if the stored date isn't today (GST).
    const currentCount = data.date === today ? data.count : 0;

    // GET = status check only. Never dispatches, never writes.
    if (req.method === "GET") {
      return res.status(200).json({
        used: currentCount,
        limit: MAX_REFRESHES_PER_DAY,
        remaining: Math.max(0, MAX_REFRESHES_PER_DAY - currentCount),
      });
    }

    if (currentCount >= MAX_REFRESHES_PER_DAY) {
      return res.status(429).json({
        error: "Daily refresh limit reached",
        limit: MAX_REFRESHES_PER_DAY,
        used: currentCount,
        resets_at: "00:00 GST",
      });
    }

    // Dispatch the main dashboard first. Only record the count increment
    // if THIS dispatch actually succeeds — we don't want a failed trigger
    // to silently consume one of the day's two allowed refreshes.
    await dispatchWorkflow(OWNER, REPO, WORKFLOW_FILE, process.env.GITHUB_DISPATCH_TOKEN);

    // Dispatch India Financials too. Non-fatal: a failure here is logged
    // and reported back in the response, but does NOT fail the request or
    // block the main dashboard's refresh from being counted/reported.
    const thematicsResult = await dispatchThematicsWorkflow();

    const newCount = currentCount + 1;
    await writeLog(sha, { date: today, count: newCount });

    return res.status(200).json({
      status: "triggered",
      used: newCount,
      limit: MAX_REFRESHES_PER_DAY,
      remaining: MAX_REFRESHES_PER_DAY - newCount,
      thematics: thematicsResult,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to trigger refresh", detail: String(err.message || err) });
  }
}
