module.exports = async function handler(req, res) {
  const required = ["GITHUB_OWNER", "GITHUB_REPO", "GITHUB_TOKEN", "ADMIN_PASSWORD"];
  const missing = required.filter((key) => !process.env[key]);
  const result = {
    ok: false,
    storage: "github-contents-api",
    missing,
    configuredRepository: process.env.GITHUB_OWNER && process.env.GITHUB_REPO
      ? `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`
      : null,
    dataPath: process.env.GITHUB_DATA_PATH || "data/psy-screening.json"
  };

  if (missing.length) {
    return res.status(200).json(result);
  }

  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(process.env.GITHUB_OWNER)}/${encodeURIComponent(process.env.GITHUB_REPO)}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "psy-screening-vercel-app"
      }
    });
    if (!response.ok) {
      result.githubStatus = response.status;
      result.error = response.status === 404
        ? "مخزن داده پیدا نشد یا توکن به آن دسترسی ندارد."
        : response.status === 401 || response.status === 403
          ? "توکن GitHub نامعتبر است یا دسترسی کافی ندارد."
          : `GitHub پاسخ HTTP ${response.status} برگرداند.`;
      return res.status(200).json(result);
    }
    const repository = await response.json();
    result.ok = true;
    result.repositoryAccessible = true;
    return res.status(200).json(result);
  } catch (error) {
    result.error = "ارتباط با GitHub برقرار نشد.";
    return res.status(200).json(result);
  }
};
