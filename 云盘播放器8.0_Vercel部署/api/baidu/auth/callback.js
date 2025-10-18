const { withCORS } = require('../../_lib/cors');
const { exchangeCodeForTokens } = require('../../_lib/baidu');

module.exports = withCORS(async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'method_not_allowed' });
    return;
  }
  const { code, state } = req.query || {};
  if (!code) {
    res.statusCode = 400;
    res.json({ error: 'missing_code' });
    return;
  }
  const redirectUri = process.env.BAIDU_REDIRECT_URI || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/baidu/auth/callback`;
  try {
    const tokenSet = await exchangeCodeForTokens(code, redirectUri);
    // 返回 refresh_token 给管理员，以便配置到 Vercel 环境变量
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      message: '授权成功。请将 refresh_token 配置为环境变量 BAIDU_REFRESH_TOKEN。',
      tokens: tokenSet,
      state: state || null,
    }));
  } catch (e) {
    console.error('OAuth callback error:', e);
    res.statusCode = 500;
    res.json({ error: 'oauth_callback_failed' });
  }
});
