import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { existsSync, statSync } from 'fs';

const PORT = 5000;
const DIST = './dist';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.xml':  'application/xml',
  '.txt':  'text/plain',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

const CACHE = {
  '.html': 'no-cache',
  '.xml':  'public, max-age=86400',
  '.txt':  'public, max-age=86400',
  '.js':   'public, max-age=31536000, immutable',
  '.css':  'public, max-age=31536000, immutable',
  '.png':  'public, max-age=2592000',
  '.jpg':  'public, max-age=2592000',
  '.jpeg': 'public, max-age=2592000',
  '.woff': 'public, max-age=31536000, immutable',
  '.woff2':'public, max-age=31536000, immutable',
};

createServer(async (req, res) => {
  let url = req.url.split('?')[0];
  let filePath = join(DIST, url);

  if (!existsSync(filePath) || url === '/') {
    filePath = join(DIST, 'index.html');
  } else if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    filePath = join(DIST, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': CACHE[ext] || 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
