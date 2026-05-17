import { getStore } from '@netlify/blobs'

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

export default async (req, context) => {
  const { filename } = context.params
  const store = getStore('uploads')
  const data = await store.get(filename, { type: 'arrayBuffer' })
  if (!data) return new Response('Not found', { status: 404 })
  const ext = filename.split('.').pop().toLowerCase()
  return new Response(data, {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000',
    },
  })
}

export const config = {
  path: '/images/uploads/:filename',
  preferStatic: true,
}
