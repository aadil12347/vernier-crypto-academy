import crypto from 'node:crypto';

export function attachRequestId(req, res, next) {
  req.requestId = `req_${crypto.randomBytes(6).toString('hex')}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = Number(err.status || 500);
  if (status >= 500) {
    console.error(`[${req.requestId || 'err'}]`, err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    code: err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
    requestId: req.requestId,
  });
}

