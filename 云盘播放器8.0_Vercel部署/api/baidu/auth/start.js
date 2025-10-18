const { withCORS } = require('../../_lib/cors');

module.exports = withCORS(async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'method_not_allowed' });
    return;
  }
  const clientId = process.env.BAIDU_CLIENT_ID;
  const redirectUri = process.env.BAIDU_REDIRECT_URI || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/baidu/auth/callback`;
  if (!clientId) {
    res.statusCode = 500;
    res.json({ error: 'missing_env', missing: ['BAIDU_CLIENT_ID'] });
    return;
  }
  const scope = 'basic,netdisk';
  const state = req.query.state || '';
  const authUrl = new URL('https://openapi.baidu.com/oauth/2.0/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);

  res.statusCode = 302;
  res.setHeader('Location', authUrl.toString());
  res.end();
});
