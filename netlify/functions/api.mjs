import { getStore } from '@netlify/blobs'
import { readFile } from 'fs/promises'
import { join } from 'path'

const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || 'fazal1234'

function getGalleryItemsFromJS(content) {
  const pattern = /\{id:(\d+),src:"([^"]+)",thumb:"([^"]+)",alt:"([^"]+)",category:"([^"]+)",label:"([^"]+)"\}/g
  const items = []
  let match
  while ((match = pattern.exec(content)) !== null) {
    items.push({
      id: parseInt(match[1]),
      src: match[2],
      thumb: match[3],
      alt: match[4],
      category: match[5],
      label: match[6],
    })
  }
  return items
}

async function loadGalleryItems() {
  const store = getStore({ name: 'gallery', consistency: 'strong' })
  const items = await store.get('items', { type: 'json' })
  if (items && Array.isArray(items) && items.length > 0) return items

  try {
    const content = await readFile(join(process.cwd(), 'dist', 'assets', 'index.js'), 'utf8')
    const seeded = getGalleryItemsFromJS(content)
    if (seeded.length > 0) {
      await store.setJSON('items', seeded)
      return seeded
    }
  } catch (e) {
    console.error('Seed failed:', e.message)
  }
  return []
}

async function saveGalleryItems(items) {
  const store = getStore({ name: 'gallery', consistency: 'strong' })
  await store.setJSON('items', items)
}

function isAuthenticated(req) {
  const auth = req.headers.get('authorization') || ''
  return auth.startsWith('Bearer ') && auth.slice(7) === ADMIN_PASSWORD
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async (req) => {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method

  if (path === '/admin/login' && method === 'POST') {
    const body = await req.json().catch(() => ({}))
    if (body.password === ADMIN_PASSWORD) {
      return json({ ok: true, token: ADMIN_PASSWORD })
    }
    return json({ ok: false, error: 'Wrong password' }, 401)
  }

  if (path === '/admin/logout' && method === 'POST') {
    return json({ ok: true })
  }

  if (path === '/offers' && method === 'GET') {
    const store = getStore('offers')
    const offers = (await store.get('data', { type: 'json' })) || {
      enabled: true,
      bgColor: '#b8962e',
      textColor: '#ffffff',
      items: [
        'Special offer on bridal wear this season!',
        'Free consultation for all new customers',
        '10% off on alterations this month',
      ],
    }
    return json(offers)
  }

  if (path === '/admin/offers' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const store = getStore('offers')
    await store.setJSON('data', body)
    return json({ ok: true })
  }

  if (path === '/admin/gallery-data' && method === 'GET') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const items = await loadGalleryItems()
    return json(items)
  }

  if (path === '/admin/update-image' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { itemId, fileData, fileName } = body
    if (!itemId || !fileData || !fileName) {
      return json({ ok: false, error: 'Missing fields' }, 400)
    }
    const ext = fileName.split('.').pop().toLowerCase() || 'jpg'
    const safeFileName = `gallery-${itemId}-${Date.now()}.${ext}`
    const binary = Buffer.from(fileData, 'base64')
    const uploadStore = getStore('uploads')
    await uploadStore.set(safeFileName, binary.buffer)
    const newSrc = `/images/uploads/${safeFileName}`
    const items = await loadGalleryItems()
    const idx = items.findIndex((it) => it.id === parseInt(itemId))
    if (idx >= 0) {
      items[idx].src = newSrc
      items[idx].thumb = newSrc
    }
    await saveGalleryItems(items)
    return json({ ok: true, src: newSrc })
  }

  if (path === '/admin/reorder' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { order } = body
    if (!Array.isArray(order)) return json({ ok: false, error: 'Invalid order' }, 400)
    const items = await loadGalleryItems()
    const idToItem = {}
    items.forEach((it) => (idToItem[it.id] = it))
    const reordered = order.map((id) => idToItem[id]).filter(Boolean)
    const included = new Set(order)
    items.forEach((it) => { if (!included.has(it.id)) reordered.push(it) })
    await saveGalleryItems(reordered)
    return json({ ok: true })
  }

  if (path === '/admin/ai-reimagine' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { prompt } = body
    if (!prompt) return json({ ok: false, error: 'Missing prompt' }, 400)
    const seed = Math.floor(Math.random() * 1000000)
    const previewUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=800&seed=${seed}&nologo=true`
    return json({ ok: true, previewUrl })
  }

  if (path === '/admin/ai-apply-data' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { itemId, fileData } = body
    if (!itemId || !fileData) return json({ ok: false, error: 'Missing fields' }, 400)
    const base64 = fileData.replace(/^data:image\/\w+;base64,/, '')
    const binary = Buffer.from(base64, 'base64')
    const fileName = `ai-${Date.now()}.png`
    const uploadStore = getStore('uploads')
    await uploadStore.set(fileName, binary.buffer)
    const savedUrl = `/images/uploads/${fileName}`
    const items = await loadGalleryItems()
    const idx = items.findIndex((it) => it.id === parseInt(itemId))
    if (idx >= 0) {
      items[idx].src = savedUrl
      items[idx].thumb = savedUrl
    }
    await saveGalleryItems(items)
    return json({ ok: true, src: savedUrl })
  }

  if (path === '/admin/ai-apply' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { itemId, previewUrl } = body
    if (!itemId || !previewUrl) return json({ ok: false, error: 'Missing fields' }, 400)
    const items = await loadGalleryItems()
    const idx = items.findIndex((it) => it.id === parseInt(itemId))
    if (idx < 0) return json({ ok: false, error: 'Item not found' }, 404)
    items[idx].src = previewUrl
    items[idx].thumb = previewUrl
    await saveGalleryItems(items)
    return json({ ok: true, src: previewUrl })
  }

  if (path === '/admin/update-item' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { itemId, label, category, badge } = body
    if (!itemId || !label || !category) return json({ ok: false, error: 'Missing fields' }, 400)
    const id = parseInt(itemId)
    const items = await loadGalleryItems()
    const idx = items.findIndex((it) => it.id === id)
    if (idx < 0) return json({ ok: false, error: 'Item not found' }, 404)
    items[idx].label = label
    items[idx].category = category
    items[idx].alt = `${label} custom tailored ${category} Mumbai`
    items[idx].badge = badge || ''
    await saveGalleryItems(items)
    return json({ ok: true, item: items[idx] })
  }

  if (path === '/admin/delete-item' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { itemId } = body
    if (!itemId) return json({ ok: false, error: 'Missing itemId' }, 400)
    const id = parseInt(itemId)
    const items = await loadGalleryItems()
    await saveGalleryItems(items.filter((it) => it.id !== id))
    return json({ ok: true })
  }

  if (path === '/admin/add-item' && method === 'POST') {
    if (!isAuthenticated(req)) return json({ error: 'Unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    const { fileData, fileName, category, label } = body
    if (!fileData || !fileName || !category || !label) {
      return json({ ok: false, error: 'Missing fields' }, 400)
    }
    const ext = fileName.split('.').pop().toLowerCase() || 'jpg'
    const items = await loadGalleryItems()
    const newId = items.reduce((max, it) => Math.max(max, it.id), 0) + 1
    const safeFileName = `gallery-${newId}-${Date.now()}.${ext}`
    const binary = Buffer.from(fileData, 'base64')
    const uploadStore = getStore('uploads')
    await uploadStore.set(safeFileName, binary.buffer)
    const newSrc = `/images/uploads/${safeFileName}`
    const altText = `${label} custom tailored ${category} Mumbai`
    const newItem = { id: newId, src: newSrc, thumb: newSrc, alt: altText, category, label }
    items.push(newItem)
    await saveGalleryItems(items)
    return json({ ok: true, item: newItem })
  }

  if (path === '/gallery-badges' && method === 'GET') {
    const items = await loadGalleryItems()
    const badged = items
      .filter((it) => it.badge)
      .map((it) => ({ id: it.id, src: it.src, label: it.label, badge: it.badge }))
    return json(badged)
  }

  return json({ error: 'Not found' }, 404)
}

export const config = {
  path: [
    '/offers',
    '/gallery-badges',
    '/admin/login',
    '/admin/logout',
    '/admin/offers',
    '/admin/gallery-data',
    '/admin/update-image',
    '/admin/reorder',
    '/admin/ai-reimagine',
    '/admin/ai-apply-data',
    '/admin/ai-apply',
    '/admin/update-item',
    '/admin/delete-item',
    '/admin/add-item',
  ],
}
