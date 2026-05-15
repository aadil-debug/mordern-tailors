import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync, statSync } from 'fs';
import { randomBytes } from 'crypto';

const PORT = 5000;
const DIST = './dist';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

const sessions = new Set();

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [key, ...val] = cookie.trim().split('=');
    cookies[key.trim()] = val.join('=');
  });
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.adminToken && sessions.has(cookies.adminToken);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function getGalleryItems(content) {
  const pattern = /\{id:(\d+),src:"([^"]+)",thumb:"([^"]+)",alt:"([^"]+)",category:"([^"]+)",label:"([^"]+)"\}/g;
  const items = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    items.push({
      id: parseInt(match[1]),
      src: match[2],
      thumb: match[3],
      alt: match[4],
      category: match[5],
      label: match[6],
    });
  }
  return items;
}

const server = createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method = req.method;

  if (urlPath === '/admin/login' && method === 'POST') {
    const body = await parseBody(req);
    if (body.password === ADMIN_PASSWORD) {
      const token = randomBytes(32).toString('hex');
      sessions.add(token);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `adminToken=${token}; HttpOnly; Path=/; Max-Age=86400`
      });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Wrong password' }));
    }
    return;
  }

  if (urlPath === '/admin/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.adminToken) sessions.delete(cookies.adminToken);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'adminToken=; HttpOnly; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (urlPath === '/admin/gallery-data' && method === 'GET') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const content = await readFile(join(DIST, 'assets/index.js'), 'utf8');
    const items = getGalleryItems(content);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
    return;
  }

  if (urlPath === '/admin/update-image' && method === 'POST') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const body = await parseBody(req);
    const { itemId, fileData, fileName } = body;

    if (!itemId || !fileData || !fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Missing required fields' }));
      return;
    }

    const ext = fileName.split('.').pop().toLowerCase() || 'jpg';
    const safeFileName = `gallery-${itemId}-${Date.now()}.${ext}`;
    const uploadDir = join(DIST, 'images/uploads');
    await mkdir(uploadDir, { recursive: true });
    const uploadPath = join(uploadDir, safeFileName);
    const buffer = Buffer.from(fileData, 'base64');
    await writeFile(uploadPath, buffer);

    const newSrc = `/images/uploads/${safeFileName}`;
    let content = await readFile(join(DIST, 'assets/index.js'), 'utf8');
    const pattern = new RegExp(
      `(\\{id:${itemId},src:)"([^"]+)"(,thumb:)"([^"]+)"`,
      'g'
    );
    content = content.replace(pattern, `$1"${newSrc}"$3"${newSrc}"`);
    await writeFile(join(DIST, 'assets/index.js'), content);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, src: newSrc }));
    return;
  }

  if (urlPath === '/admin/reorder' && method === 'POST') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    const body = await parseBody(req);
    const { order } = body;
    if (!Array.isArray(order)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid order' }));
      return;
    }
    let content = await readFile(join(DIST, 'assets/index.js'), 'utf8');
    const itemRx = /\{id:(\d+),src:"[^"]+",thumb:"[^"]+",alt:"[^"]+",category:"[^"]+",label:"[^"]+"\}/g;
    const allMatches = [...content.matchAll(itemRx)];
    const idToText = {};
    allMatches.forEach(m => { idToText[parseInt(m[1])] = m[0]; });
    let newContent = '';
    let lastIndex = 0;
    allMatches.forEach((m, i) => {
      newContent += content.slice(lastIndex, m.index);
      const newId = order[i] !== undefined ? order[i] : parseInt(m[1]);
      newContent += idToText[newId] || m[0];
      lastIndex = m.index + m[0].length;
    });
    newContent += content.slice(lastIndex);
    await writeFile(join(DIST, 'assets/index.js'), newContent);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (urlPath === '/admin' && method === 'GET') {
    try {
      const data = await readFile(join(DIST, 'admin.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Admin page not found');
    }
    return;
  }

  let filePath = join(DIST, urlPath);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
