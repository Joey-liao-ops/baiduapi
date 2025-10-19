// api/proxy.js
// 代理百度网盘视频流，解决 CORS 问题

export default async function handler(req, res) {
  const { url, access_token } = req.query;

  if (!url || !access_token) {
    return res.status(400).json({ 
      error: 'Missing url or access_token parameter' 
    });
  }

  try {
    // 构建带 access_token 的完整 URL
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}access_token=${access_token}`;

    // 获取 Range 请求头（支持视频拖动）
    const range = req.headers.range;
    const headers = {
      'User-Agent': 'pan.baidu.com',
      'Referer': 'https://pan.baidu.com'
    };
    
    if (range) {
      headers['Range'] = range;
    }

    const response = await fetch(fullUrl, { 
      method: 'GET',
      headers 
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Failed to fetch video: ${response.statusText}` 
      });
    }

    // 设置 CORS 和缓存头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    
    // 转发响应头
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    // 设置状态码
    res.status(range && contentRange ? 206 : 200);

    // 流式传输视频数据
    const reader = response.body.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    
    res.end();

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ 
      error: error.message 
    });
  }
}