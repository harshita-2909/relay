import { Router } from 'express';
import { placeholdersIn, render } from '../engine/render.js';
import { getTemplate, listTemplates, updateTemplate } from '../store.js';
import { sendError } from './errors.js';

const MAX_LENGTH = 280;

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

  // Content owner edits wording. Takes effect for the next notification; nothing in the app changes.
  router.put('/:type', (req, res) => {
    const current = getTemplate(db, req.params.type);
    if (!current) return notFound(res, db, req.params.type);

    const template = typeof req.body?.template === 'string' ? req.body.template.trim() : '';
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

    return res.json(withPreview(updateTemplate(db, current.type, template)));
  });

  return router;
}

const withPreview = (t) => ({ ...t, preview: render(t.template, SAMPLE) });

function notFound(res, db, type) {
  const known = listTemplates(db).map((t) => t.type).join(', ');
  return sendError(res, 404, 'template_not_found', `There is no notification type "${type}". Known types: ${known}.`);
}
