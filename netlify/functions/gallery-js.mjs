import { getStore } from '@netlify/blobs'
import { readFile } from 'fs/promises'
import { join } from 'path'

function patchGalleryJS(content, items) {
  const pattern = /\{id:(\d+),src:"[^"]+",thumb:"[^"]+",alt:"[^"]+",category:"[^"]+",label:"[^"]+"\}/g
  const allMatches = [...content.matchAll(pattern)]
  if (allMatches.length === 0 || items.length === 0) return content
  let result = ''
  let lastIndex = 0
  allMatches.forEach((m, i) => {
    result += content.slice(lastIndex, m.index)
    if (i < items.length) {
      const it = items[i]
      result += `{id:${it.id},src:"${it.src}",thumb:"${it.thumb}",alt:"${it.alt}",category:"${it.category}",label:"${it.label}"}`
    } else {
      result += m[0]
    }
    lastIndex = m.index + m[0].length
  })
  result += content.slice(lastIndex)
  return result
}

export default async () => {
  try {
    const content = await readFile(join(process.cwd(), 'dist', 'assets', 'index.js'), 'utf8')
    const store = getStore('gallery')
    const items = await store.get('items', { type: 'json' })
    const patched =
      items && Array.isArray(items) && items.length > 0
        ? patchGalleryJS(content, items)
        : content
    return new Response(patched, {
      headers: { 'Content-Type': 'application/javascript' },
    })
  } catch (e) {
    console.error('gallery-js error:', e.message)
    return new Response('Not found', { status: 404 })
  }
}

export const config = {
  path: '/assets/index.js',
}
