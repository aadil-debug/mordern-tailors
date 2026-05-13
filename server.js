import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { existsSync } from 'fs';

const PORT = 5000;
const DIST = './dist';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  let url = req.url.split('?')[0];
  let filePath = join(DIST, url);

  if (!existsSync(filePath) || url === '/') {
    filePath = join(DIST, 'index.html');
  } else if (existsSync(filePath) && (await import('fs')).statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    filePath = join(DIST, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
