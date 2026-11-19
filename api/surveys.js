const {
  StoreError,
  readStore,
  updateStore,
  normalizeName,
  requireAdmin,
  sendError
} = require("../lib/github-store");

function publicSurvey(survey, name) {
  const copy = { ...survey };
  const submissions = Array.isArray(copy.submissions) ? copy.submissions : [];
  copy.completed = Boolean(name) && submissions.some((person) => normalizeName(person.name) === normalizeName(name));
  delete copy.submissions;
  return copy;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    if (req.method === "GET") {
      const { data } = await readStore();
      const surveys = Array.isArray(data.surveys) ? data.surveys : [];
      if (req.query.view === "admin") {
        requireAdmin(req);
        return res.status(200).json({ surveys });
      }
      const name = typeof req.query.name === "string" ? req.query.name : "";
      const published = surveys.filter((survey) => survey.published !== false);
      return res.status(200).json({ surveys: published.map((survey) => publicSurvey(survey, name)) });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = body.action;

      if (action === "create") {
        requireAdmin(req);
        const survey = body.survey;
        if (!survey || typeof survey !== "object" || !survey.id || !String(survey.title || "").trim() || !Array.isArray(survey.questions) || survey.questions.length === 0) {
          throw new StoreError("اطلاعات پرسشنامه کامل نیست.", 400);
        }
        await updateStore((data) => {
          if (data.surveys.some((item) => item.id === survey.id)) throw new StoreError("شناسه‌ی این پرسشنامه قبلاً ثبت شده است.", 409);
          data.surveys.unshift({ ...survey, submissions: [], published: true });
          return { result: { ok: true, id: survey.id } };
        });
        return res.status(201).json({ ok: true, id: survey.id });
      }

      if (action === "import") {
        requireAdmin(req);
        if (!Array.isArray(body.surveys)) throw new StoreError("فهرست پرسشنامه‌ها برای انتقال معتبر نیست.", 400);
        const imported = await updateStore((data) => {
          const known = new Set(data.surveys.map((survey) => survey.id));
          let count = 0;
          for (const survey of body.surveys) {
            if (!survey || !survey.id || known.has(survey.id)) continue;
            data.surveys.push({
              ...survey,
              questions: Array.isArray(survey.questions) ? survey.questions : [],
              submissions: Array.isArray(survey.submissions) ? survey.submissions : [],
              published: survey.published !== false
            });
            known.add(survey.id);
            count++;
          }
          return { result: { ok: true, imported: count } };
        });
        return res.status(200).json(imported);
      }

      if (action === "respond") {
        const surveyId = String(body.surveyId || "");
        const submission = body.submission;
        if (!surveyId || !submission || !String(submission.name || "").trim() || !Array.isArray(submission.answers)) {
          throw new StoreError("اطلاعات پاسخ کامل نیست.", 400);
        }
        await updateStore((data) => {
          const survey = data.surveys.find((item) => item.id === surveyId && item.published !== false);
          if (!survey) throw new StoreError("این پرسشنامه دیگر در دسترس نیست.", 404);
          survey.submissions = Array.isArray(survey.submissions) ? survey.submissions : [];
          const duplicate = survey.submissions.some((person) => normalizeName(person.name) === normalizeName(submission.name));
          if (duplicate) throw new StoreError("با این نام قبلاً برای این پرسشنامه پاسخ ثبت شده است.", 409);
          survey.submissions.push({
            name: String(submission.name).trim(),
            submittedAt: submission.submittedAt || new Date().toISOString(),
            answers: submission.answers.map((answer) => ({
              question: String(answer.question || ""),
              answer: String(answer.answer || "")
            }))
          });
          return { result: { ok: true } };
        });
        return res.status(201).json({ ok: true });
      }

      throw new StoreError("نوع عملیات API مشخص نیست.", 400);
    }

    if (req.method === "DELETE") {
      requireAdmin(req);
      const id = String(req.query.id || "");
      if (!id) throw new StoreError("شناسه‌ی پرسشنامه وارد نشده است.", 400);
      await updateStore((data) => {
        const index = data.surveys.findIndex((survey) => survey.id === id);
        if (index < 0) throw new StoreError("پرسشنامه پیدا نشد.", 404);
        data.surveys.splice(index, 1);
        return { result: { ok: true } };
      });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "روش درخواست مجاز نیست." });
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: "4mb" } } };
