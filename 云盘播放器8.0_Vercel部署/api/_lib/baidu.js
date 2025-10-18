const OAUTH_TOKEN_URL = 'https://openapi.baidu.com/oauth/2.0/token';
const PCS_LIST_URL = 'https://pan.baidu.com/rest/2.0/xpan/file?method=list';
const PCS_META_URL = 'https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas';
const PCS_DOWNLOAD_URL = 'https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function exchangeCodeForTokens(code, redirectUri) {
  const clientId = requireEnv('BAIDU_CLIENT_ID');
  const clientSecret = requireEnv('BAIDU_CLIENT_SECRET');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${OAUTH_TOKEN_URL}?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error('token_exchange_failed');
  return await res.json();
}

async function refreshAccessToken(refreshToken) {
  const clientId = requireEnv('BAIDU_CLIENT_ID');
  const clientSecret = requireEnv('BAIDU_CLIENT_SECRET');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(`${OAUTH_TOKEN_URL}?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error('refresh_failed');
  return await res.json();
}

async function getAccessToken() {
  const refreshToken = requireEnv('BAIDU_REFRESH_TOKEN');
  const data = await refreshAccessToken(refreshToken);
  if (!data.access_token) throw new Error('no_access_token');
  return data.access_token;
}

async function pcsList({ path = '/', page = 1, num = 100, order = 'name', desc = 0 }) {
  const accessToken = await getAccessToken();
  const qs = new URLSearchParams({ access_token: accessToken, dir: path, page: String(page), num: String(num), order, desc: String(desc) });
  const res = await fetch(`${PCS_LIST_URL}&${qs.toString()}`);
  if (!res.ok) throw new Error('pcs_list_failed');
  return await res.json();
}

async function fileMetas({ fsids }) {
  const accessToken = await getAccessToken();
  const qs = new URLSearchParams({ access_token: accessToken });
  const body = new URLSearchParams({ dlink: '1', fsids: JSON.stringify(fsids) });
  const res = await fetch(`${PCS_META_URL}&${qs.toString()}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error('filemetas_failed');
  return await res.json();
}

function isVideo(name) {
  const m = name.toLowerCase();
  return /(\.mp4|\.mkv|\.webm|\.mov|\.avi|\.flv|\.m3u8)$/.test(m);
}

module.exports = { exchangeCodeForTokens, refreshAccessToken, getAccessToken, pcsList, fileMetas, isVideo };
