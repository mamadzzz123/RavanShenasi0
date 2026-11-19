module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "روش درخواست مجاز نیست." });
  }

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "متغیر ADMIN_PASSWORD را در تنظیمات Vercel تعریف کنید." });
  }

  const password = req.body && req.body.password;
  if (typeof password !== "string" || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "رمز عبور واردشده صحیح نیست." });
  }

  return res.status(200).json({ ok: true });
};
