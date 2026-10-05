/** Every error response has the same shape: { error: { code, message, details? } }. */
export function sendError(res, status, code, message, details) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
