const STORE_PATH = process.env.GITHUB_DATA_PATH || "data/psy-screening.json";

class StoreError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "StoreError";
    this.status = status;
  }
}

function getConfig() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;
  const missing = [];
  if (!owner) missing.push("GITHUB_OWNER");
  if (!repo) missing.push("GITHUB_REPO");
  if (!token) missing.push("GITHUB_TOKEN");
  if (missing.length) {
    throw new StoreError(`تنظیمات لازم در Vercel کامل نیست: ${missing.join(", ")}`, 503);
  }
  const path = STORE_PATH.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
  return { owner, repo, branch, token, url };
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "psy-screening-vercel-app"
  };
}

async function readStore() {
  const config = getConfig();
  const response = await fetch(`${config.url}?ref=${encodeURIComponent(config.branch)}`, {
    headers: githubHeaders(config.token)
  });

  if (response.status === 404) {
    return { data: { surveys: [] }, sha: null, config };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = response.status === 401 || response.status === 403
      ? "توکن GitHub یا مجوز Contents را بررسی کنید."
      : `خواندن داده از GitHub ناموفق بود (HTTP ${response.status}).`;
    throw new StoreError(`${message}${detail ? ` ${detail.slice(0, 240)}` : ""}`, response.status === 404 ? 404 : 502);
  }

  const file = await response.json();
  if (!file || !file.content || !file.sha) {
    throw new StoreError("فایل داده در GitHub خالی یا نامعتبر است.", 502);
  }

  try {
    const raw = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.surveys)) data.surveys = [];
    return { data, sha: file.sha, config };
  } catch (error) {
    throw new StoreError(`خواندن JSON ذخیره‌سازی ناموفق بود: ${error.message}`, 502);
  }
}

async function writeStore(data, sha, config) {
  const payload = {
    message: "Update psychological screening data",
    branch: config.branch,
    content: Buffer.from(JSON.stringify(data, null, 2), "utf8").toString("base64")
  };
  if (sha) payload.sha = sha;

  const response = await fetch(config.url, {
    method: "PUT",
    headers: githubHeaders(config.token),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 409 || response.status === 422) {
      throw new StoreError("نسخه‌ی داده هم‌زمان تغییر کرده است؛ دوباره تلاش می‌کنیم.", response.status);
    }
    const message = response.status === 401 || response.status === 403
      ? "توکن GitHub دسترسی نوشتن در مخزن داده را ندارد. مجوز Contents: Read and write را بررسی کنید."
      : `ذخیره‌سازی در GitHub ناموفق بود (HTTP ${response.status}).`;
    throw new StoreError(`${message}${detail ? ` ${detail.slice(0, 240)}` : ""}`, 502);
  }
}

async function updateStore(mutator) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await readStore();
    if (!Array.isArray(snapshot.data.surveys)) snapshot.data.surveys = [];
    const outcome = await mutator(snapshot.data);
    if (outcome && outcome.write === false) return outcome.result;

    try {
      await writeStore(snapshot.data, snapshot.sha, snapshot.config);
      return outcome ? outcome.result : undefined;
    } catch (error) {
      if ((error.status === 409 || error.status === 422) && attempt < 2) continue;
      throw error;
    }
  }
  throw new StoreError("ذخیره‌سازی پس از چند تلاش انجام نشد؛ دوباره امتحان کنید.", 409);
}

function normalizeName(name) {
  return String(name || "").trim().toLocaleLowerCase("fa").replace(/\s+/g, " ");
}

function isAdminRequest(req) {
  const expected = process.env.ADMIN_PASSWORD;
  const provided = req.headers["x-admin-password"];
  return Boolean(expected && provided && String(provided) === expected);
}

function requireAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) {
    throw new StoreError("متغیر ADMIN_PASSWORD در تنظیمات Vercel تعریف نشده است.", 503);
  }
  if (!isAdminRequest(req)) {
    throw new StoreError("دسترسی مدیریت تأیید نشد؛ دوباره وارد پنل شوید.", 401);
  }
}

function sendError(res, error) {
  const status = Number(error && error.status) || 500;
  if (status >= 500) console.error("API error:", error);
  res.status(status).json({ error: error && error.message ? error.message : "خطای ناشناخته‌ی سرور." });
}

module.exports = {
  StoreError,
  readStore,
  updateStore,
  normalizeName,
  isAdminRequest,
  requireAdmin,
  sendError
};
