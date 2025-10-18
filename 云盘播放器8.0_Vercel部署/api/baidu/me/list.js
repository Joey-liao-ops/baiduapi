const { withCORS } = require('../../_lib/cors');
const { pcsList, isVideo } = require('../../_lib/baidu');

module.exports = withCORS(async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'method_not_allowed' });
    return;
  }
  const path = (req.query.path || '/').toString();
  try {
    const data = await pcsList({ path });
    const host = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
    const items = (data.list || []).map((it) => {
      const item = {
        name: it.server_filename || it.filename || it.path,
        size: it.size,
        isdir: it.isdir === 1,
        fs_id: it.fs_id,
        path: it.path,
      };
      if (!item.isdir && isVideo(item.name)) {
        item.streamUrl = `${host}/api/baidu/stream?scene=me&fs_id=${encodeURIComponent(String(item.fs_id))}`;
      }
      return item;
    });
    res.statusCode = 200;
    res.json({ path, items });
  } catch (e) {
    console.error('me/list error:', e);
    res.statusCode = 500;
    res.json({ error: 'me_list_failed' });
  }
});
