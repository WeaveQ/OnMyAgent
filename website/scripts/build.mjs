import { cp, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const publicDir = resolve('public')
const distDir = resolve('dist')

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })
await cp(publicDir, distDir, { recursive: true })
console.log(`built ${distDir}`)
