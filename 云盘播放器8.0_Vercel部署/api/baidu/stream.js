const { withCORS } = require('../_lib/cors');
const { getAccessToken, fileMetas } = require('../_lib/baidu');
const { Readable } = require('stream');

module.exports = withCORS(async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'method_not_allowed' });
    return;
  }

  const scene = (req.query.scene || 'me').toString();
  if (scene !== 'me') {
    res.statusCode = 400;
    res.json({ error: 'unsupported_scene', scene });
    return;
  }

  const fs_id = req.query.fs_id ? req.query.fs_id.toString() : '';
  if (!fs_id) {
    res.statusCode = 400;
    res.json({ error: 'missing_fs_id' });
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const metas = await fileMetas({ fsids: [Number(fs_id)] });
    const info = (metas.list || [])[0];
    if (!info || !info.dlink) {
      res.statusCode = 404;
      res.json({ error: 'dlink_not_found' });
      return;
    }

    // 拼接 access_token 访问直链
    const dlinkUrl = info.dlink.includes('access_token=')
      ? info.dlink
      : `${info.dlink}${info.dlink.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;

    const headers = {};
    if (req.headers.range) headers['Range'] = req.headers.range;
    // 直链请求
    const upstream = await fetch(dlinkUrl, { headers });

    // 将关键响应头透传
    const copyHeaders = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'content-disposition',
      'cache-control',
      'etag',
      'last-modified'
    ];
    for (const h of copyHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    // 如果上游未提供缓存策略，设置一个保守的 no-store
    if (!upstream.headers.get('cache-control')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    res.statusCode = upstream.status; // 200 或 206

    // 将 body 流式转发
    const body = upstream.body;
    if (body) {
      if (typeof body.pipe === 'function') {
        // Node Readable
        body.pipe(res);
      } else if (Readable.fromWeb) {
        // Web stream -> Node stream
        Readable.fromWeb(body).pipe(res);
      } else {
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.end(buf);
      }
    } else {
      res.end();
    }
  } catch (e) {
    console.error('stream error:', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.json({ error: 'stream_failed' });
    } else {
      try { res.end(); } catch {}
    }
  }
});
