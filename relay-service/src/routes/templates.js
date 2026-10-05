import { Router } from 'express';
import { placeholdersIn, render } from '../engine/render.js';
import { getTemplate, listTemplates, updateTemplate } from '../store.js';
import { sendError } from './errors.js';

const MAX_LENGTH = 280;
const MAX_WINDOW = 24 * 60;

// Sample values so the content owner can see what a template will look like.
const SAMPLE = {
  actor: 'Rahul', recipient: 'Asha', comment: 'Great photo!', post: 'Sunset at the beach',
  context: 'comment', text: 'Hey @Asha, look at this',
};

export function templatesRouter(db) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ templates: listTemplates(db).map(withPreview) });
  });

  router.get('/:type', (req, res) => {
    const t = getTemplate(db, req.params.type);
    if (!t) return notFound(res, db, req.params.type);
    return res.json(withPreview(t));
  });

  // Content owner edits wording (and how long similar notifications keep combining).
  // Takes effect for the next notification; nothing in the app changes.
  // Body: { "template"?: "...", "groupWindowMinutes"?: 0-1440 (0 or null = never combine) }
  router.put('/:type', (req, res) => {
    const current = getTemplate(db, req.params.type);
    if (!current) return notFound(res, db, req.params.type);

    const body = req.body ?? {};
    const hasTemplate = 'template' in body;
    const hasWindow = 'groupWindowMinutes' in body;
    if (!hasTemplate && !hasWindow) {
      return sendError(res, 400, 'invalid_template',
        'Send {"template": "..."} with the new wording, and/or {"groupWindowMinutes": n}.');
    }
    const changes = {};

    if (hasWindow) {
      const w = body.groupWindowMinutes;
      if (w !== null && !(Number.isInteger(w) && w >= 0 && w <= MAX_WINDOW)) {
        return sendError(res, 400, 'invalid_group_window',
          `"groupWindowMinutes" must be a whole number of minutes from 0 to ${MAX_WINDOW} (0 = never combine).`);
      }
      changes.groupWindowMinutes = w || null;
    }
    if (!hasTemplate) return res.json(withPreview(updateTemplate(db, current.type, changes)));

    const template = typeof body.template === 'string' ? body.template.trim() : '';
    if (!template) {
      return sendError(res, 400, 'invalid_template', 'Send {"template": "..."} with the new wording; it cannot be empty.');
    }
    if (template.length > MAX_LENGTH) {
      return sendError(res, 400, 'invalid_template', `Wording must be ${MAX_LENGTH} characters or fewer.`);
    }
    const unknown = placeholdersIn(template).filter((p) => !current.variables.includes(p));
    if (unknown.length) {
      return sendError(res, 400, 'unknown_placeholder',
        `"${current.label}" wording can't use ${unknown.map((p) => `{${p}}`).join(', ')}. `
        + `Available blanks: ${current.variables.map((v) => `{${v}}`).join(', ')}.`,
        { unknown, allowed: current.variables });
    }

    changes.template = template;
    return res.json(withPreview(updateTemplate(db, current.type, changes)));
  });

  return router;
}

const withPreview = (t) => ({
  ...t,
  preview: render(t.template, SAMPLE),
  // What a combined notification reads like, so the content owner can check it still makes sense.
  groupedPreview: t.groupWindowMinutes ? render(t.template, { ...SAMPLE, actor: 'Rahul and 4 others' }) : null,
});

function notFound(res, db, type) {
  const known = listTemplates(db).map((t) => t.type).join(', ');
  return sendError(res, 404, 'template_not_found', `There is no notification type "${type}". Known types: ${known}.`);
}
