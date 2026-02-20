const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 视频相关接口
      if (path === '/api/videos' && request.method === 'GET') {
        return await handleGetVideos(env);
      }
      
      if (path === '/api/videos' && request.method === 'POST') {
        return await handleAddVideo(request, env);
      }
      
      if (path === '/api/videos/progress' && request.method === 'POST') {
        return await handleUpdateProgress(request, env);
      }
      
      if (path.startsWith('/api/videos/') && request.method === 'DELETE') {
        const videoId = path.split('/').pop();
        return await handleDeleteVideo(env, videoId);
      }
      
      if (path === '/api/videos/clear' && request.method === 'POST') {
        return await handleClearVideos(env);
      }

      // 网址提交相关接口
      if (path === '/api/submissions' && request.method === 'GET') {
        return await handleGetSubmissions(env);
      }
      
      if (path === '/api/submissions' && request.method === 'POST') {
        return await handleAddSubmission(request, env);
      }

      // ========== 视频帧相关接口 ==========
if (path === '/api/videos/frames' && request.method === 'GET') {
  const videoId = url.searchParams.get('videoId');
  if (!videoId) {
    return new Response(JSON.stringify({ error: 'Missing videoId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
  return await handleGetVideoFrames(env, videoId);
}

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });

    } catch (error) {
      console.error('Error:', error);


      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }
  }
};

// ========== 视频相关函数 ==========
async function handleGetVideos(env) {
  const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  for (let video of videos) {
    const progress = await env.WEBTOOL_KV.get(`video:${video.id}:progress`, 'json');
    if (progress) {
      video.progress = progress;
    }
  }
  return new Response(JSON.stringify(videos), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleAddVideo(request, env) {
  const videoData = await request.json();
  videoData.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  videoData.addedAt = new Date().toISOString();
  
  const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  videos.unshift(videoData);
  
  if (videos.length > 50) {
    videos.pop();
  }
  
  await env.WEBTOOL_KV.put('videos', JSON.stringify(videos));
  
  return new Response(JSON.stringify(videoData), {
    status: 201,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleUpdateProgress(request, env) {
  const { videoId, currentTime, duration } = await request.json();
  
  const progress = {
    currentTime,
    duration,
    updatedAt: new Date().toISOString()
  };
  
  await env.WEBTOOL_KV.put(`video:${videoId}:progress`, JSON.stringify(progress));
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleDeleteVideo(env, videoId) {
  const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  const updated = videos.filter(v => v.id !== videoId);
  
  await env.WEBTOOL_KV.put('videos', JSON.stringify(updated));
  await env.WEBTOOL_KV.delete(`video:${videoId}:progress`);
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleClearVideos(env) {
  const videos = await env.WEBTOOL_KV.get('videos', 'json') || [];
  
  for (let video of videos) {
    await env.WEBTOOL_KV.delete(`video:${video.id}:progress`);
  }
  
  await env.WEBTOOL_KV.delete('videos');
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

// ========== 网址提交相关函数 ==========
async function handleGetSubmissions(env) {
  const submissions = await env.WEBTOOL_KV.get('submissions', 'json') || [];
  return new Response(JSON.stringify(submissions), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

async function handleAddSubmission(request, env) {
  const { url, title } = await request.json();
  
  if (!url || !url.match(/^https?:\/\/.+/)) {
    return new Response(JSON.stringify({ error: '无效的URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
  
  const submissions = await env.WEBTOOL_KV.get('submissions', 'json') || [];
  
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  
  const newSubmission = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    url,
    title: title || new URL(url).hostname,
    created_at: new Date().toISOString(),
    ip_address: clientIP,
    user_agent: userAgent
  };
  
  submissions.unshift(newSubmission);
  
  if (submissions.length > 100) {
    submissions.pop();
  }
  
  await env.WEBTOOL_KV.put('submissions', JSON.stringify(submissions));
  
  return new Response(JSON.stringify(newSubmission), {
    status: 201,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}