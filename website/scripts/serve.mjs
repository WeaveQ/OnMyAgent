import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const useDist = process.argv.includes('--dist')
const root = resolve(useDist ? 'dist' : 'public')
const portFlag = process.argv.find((arg) => arg.startsWith('--port='))
const port = Number(portFlag?.split('=')[1] ?? process.env.PORT ?? 5198)

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const normalized = normalize(decoded).replace(/^\.\.\/+/g, '')
  const target = join(root, normalized === '/' ? 'index.html' : normalized)
  if (!target.startsWith(root)) return join(root, 'index.html')
  return target
}

async function resolveFile(target) {
  try {
    const info = await stat(target)
    if (info.isDirectory()) {
      const index = join(target, 'index.html')
      await stat(index)
      return index
    }
    return target
  } catch {
    // Clean VitePress URLs: /docs/guide/settings → settings.html
    if (!extname(target)) {
      const withHtml = `${target}.html`
      try {
        await stat(withHtml)
        return withHtml
      } catch {
        /* fall through */
      }
    }
    return null
  }
}

const server = createServer(async (req, res) => {
  const target = safePath(req.url ?? '/')
  const file = await resolveFile(target)
  if (!file) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found')
    return
  }
  res.setHeader('Content-Type', contentTypes.get(extname(file)) ?? 'application/octet-stream')
  createReadStream(file).pipe(res)
})

server.listen(port, () => {
  console.log(`OnMyAgent website serving ${root} at http://localhost:${port}`)
})
