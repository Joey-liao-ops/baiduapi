function withCORS(handler) {
  return async (req, res) => {
    const allowed = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];
    const origin = req.headers.origin || '';
    if (allowed.length > 0 && origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      await handler(req, res);
    } catch (e) {
      console.error('Handler error:', e);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.json({ error: 'internal_error' });
      } else {
        res.end();
      }
    }
  };
}

module.exports = { withCORS };
