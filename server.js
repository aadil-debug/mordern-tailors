import { createServer } from 'http';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync, statSync } from 'fs';
import { randomBytes } from 'crypto';

const PORT = 5000;
const DIST = './dist';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DB_URL = process.env.REPLIT_DB_URL;

const sessions = new Set();

const mimeTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.xml': 'application/xml',
  '.txt': 'text/plain',
};

// ── Replit DB helpers ────────────────────────────────────────────────────────
async function dbGet(key) {
  if (!DB_URL) return null;
  try {
    const res = await fetch(`${DB_URL}/${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    const text = await res.text();
    return JSON.parse(decodeURIComponent(text));
  } catch { return null; }
}

async function dbSet(key, value) {
  if (!DB_URL) return;
  try {
    await fetch(DB_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `${encodeURIComponent(key)}=${encodeURIComponent(JSON.stringify(value))}`,
    });
  } catch (e) { console.error('DB write error:', e.message); }
}

// ── Gallery helpers ──────────────────────────────────────────────────────────
function getGalleryItemsFromJS(content) {
  const pattern = /\{id:(\d+),src:"([^"]+)",thumb:"([^"]+)",alt:"([^"]+)",category:"([^"]+)",label:"([^"]+)"\}/g;
  const items = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    items.push({ id: parseInt(match[1]), src: match[2], thumb: match[3], alt: match[4], category: match[5], label: match[6] });
  }
  return items;
}

// Load from DB, seeding from file on first run
async function loadGalleryItems() {
  const dbItems = await dbGet('gallery_items');
  if (dbItems && Array.isArray(dbItems) && dbItems.length > 0) return dbItems;
  // Seed DB from file
  const content = await readFile(join(DIST, 'assets/index.js'), 'utf8');
  const items = getGalleryItemsFromJS(content);
  await dbSet('gallery_items', items);
  return items;
}

// Patch the JS bundle in memory with DB items (positional replacement)
function patchGalleryJS(content, items) {
  const pattern = /\{id:(\d+),src:"[^"]+",thumb:"[^"]+",alt:"[^"]+",category:"[^"]+",label:"[^"]+"\}/g;
  const allMatches = [...content.matchAll(pattern)];
  if (allMatches.length === 0 || items.length === 0) return content;
  let result = '';
  let lastIndex = 0;
  allMatches.forEach((m, i) => {
    result += content.slice(lastIndex, m.index);
    if (i < items.length) {
      const it = items[i];
      result += `{id:${it.id},src:"${it.src}",thumb:"${it.thumb}",alt:"${it.alt}",category:"${it.category}",label:"${it.label}"}`;
    } else {
      result += m[0];
    }
    lastIndex = m.index + m[0].length;
  });
  result += content.slice(lastIndex);
  return result;
}

// ── Request helpers ──────────────────────────────────────────────────────────
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    cookies[k.trim()] = v.join('=');
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
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Server ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method = req.method;

  // Login
  if (urlPath === '/admin/login' && method === 'POST') {
    const body = await parseBody(req);
    if (body.password === ADMIN_PASSWORD) {
      const token = randomBytes(32).toString('hex');
      sessions.add(token);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `adminToken=${token}; HttpOnly; Path=/; Max-Age=86400` });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Wrong password' }));
    }
    return;
  }

  // Logout
  if (urlPath === '/admin/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.adminToken) sessions.delete(cookies.adminToken);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'adminToken=; HttpOnly; Path=/; Max-Age=0' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Gallery data (admin)
  if (urlPath === '/admin/gallery-data' && method === 'GET') {
    if (!isAuthenticated(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const items = await loadGalleryItems();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(items));
    return;
  }

  // Update image
  if (urlPath === '/admin/update-image' && method === 'POST') {
    if (!isAuthenticated(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const body = await parseBody(req);
    const { itemId, fileData, fileName } = body;
    if (!itemId || !fileData || !fileName) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Missing fields' })); return;
    }
    const ext = fileName.split('.').pop().toLowerCase() || 'jpg';
    const safeFileName = `gallery-${itemId}-${Date.now()}.${ext}`;
    const uploadDir = join(DIST, 'images/uploads');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, safeFileName), Buffer.from(fileData, 'base64'));
    const newSrc = `/images/uploads/${safeFileName}`;

    // Update DB
    const items = await loadGalleryItems();
    const idx = items.findIndex(it => it.id === parseInt(itemId));
    if (idx >= 0) { items[idx].src = newSrc; items[idx].thumb = newSrc; }
    await dbSet('gallery_items', items);

    // Also patch the JS file so dev environment stays in sync
    let jsContent = await readFile(join(DIST, 'assets/index.js'), 'utf8');
    jsContent = jsContent.replace(
      new RegExp(`(\\{id:${itemId},src:)"([^"]+)"(,thumb:)"([^"]+)"`, 'g'),
      `$1"${newSrc}"$3"${newSrc}"`
    );
    await writeFile(join(DIST, 'assets/index.js'), jsContent);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, src: newSrc }));
    return;
  }

  // Reorder
  if (urlPath === '/admin/reorder' && method === 'POST') {
    if (!isAuthenticated(req)) { res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    const body = await parseBody(req);
    const { order } = body;
    if (!Array.isArray(order)) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Invalid order' })); return; }

    const items = await loadGalleryItems();
    const idToItem = {};
    items.forEach(it => idToItem[it.id] = it);
    const reordered = order.map(id => idToItem[id]).filter(Boolean);
    // Append any items not included in order
    const included = new Set(order);
    items.forEach(it => { if (!included.has(it.id)) reordered.push(it); });

    // Save to DB
    await dbSet('gallery_items', reordered);

    // Also patch the JS file so dev environment stays in sync
    let jsContent = await readFile(join(DIST, 'assets/index.js'), 'utf8');
    const itemRx = /\{id:(\d+),src:"[^"]+",thumb:"[^"]+",alt:"[^"]+",category:"[^"]+",label:"[^"]+"\}/g;
    const allMatches = [...jsContent.matchAll(itemRx)];
    const idToText = {};
    allMatches.forEach(m => { idToText[parseInt(m[1])] = m[0]; });
    let newJS = '';
    let lastIdx = 0;
    allMatches.forEach((m, i) => {
      newJS += jsContent.slice(lastIdx, m.index);
      newJS += idToText[reordered[i]?.id] || m[0];
      lastIdx = m.index + m[0].length;
    });
    newJS += jsContent.slice(lastIdx);
    await writeFile(join(DIST, 'assets/index.js'), newJS);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Admin page
  if (urlPath === '/admin' && method === 'GET') {
    try {
      const data = await readFile(join(DIST, 'admin.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Admin page not found'); }
    return;
  }

  // Gallery JS — serve dynamically patched with DB data
  if (urlPath.match(/^\/assets\/index.*\.js$/) && method === 'GET') {
    try {
      let content = await readFile(join(DIST, urlPath), 'utf8');
      const dbItems = await dbGet('gallery_items');
      if (dbItems && Array.isArray(dbItems) && dbItems.length > 0) {
        content = patchGalleryJS(content, dbItems);
      }
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
    return;
  }

  // Static files
  let filePath = join(DIST, urlPath);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log(`Replit DB: ${DB_URL ? 'connected' : 'not available'}`);
});
