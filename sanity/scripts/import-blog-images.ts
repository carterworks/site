import fs from 'node:fs'
import path from 'node:path'
import {getCliClient} from 'sanity/cli'

const client = getCliClient({apiVersion: '2026-04-27'})
const root = path.resolve(process.cwd(), '..')
const blogDir = path.join(root, 'src/content/blog')
const imagePattern = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

type ImageUse = {
  file: string
  rawUrl: string
}

const refsByPath = new Map<string, ImageUse[]>()

async function importBlogImages() {
  for (const file of fs.readdirSync(blogDir).sort()) {
    if (!file.endsWith('.md') || file.startsWith('_')) continue

    const source = fs.readFileSync(path.join(blogDir, file), 'utf8')

    for (const match of source.matchAll(imagePattern)) {
      const rawUrl = match[1]
      const decodedUrl = decodeURIComponent(rawUrl)

      if (/^(https?:)?\/\//.test(decodedUrl) || decodedUrl.startsWith('/')) continue

      const localPath = path.normalize(path.join(blogDir, decodedUrl))
      if (!fs.existsSync(localPath)) throw new Error(`Missing image file: ${localPath}`)

      const uses = refsByPath.get(localPath) ?? []
      uses.push({file, rawUrl})
      refsByPath.set(localPath, uses)
    }
  }

  const uploaded = new Map<string, string>()

  for (const localPath of refsByPath.keys()) {
    const filename = path.basename(localPath)
    const asset = await client.assets.upload('image', fs.createReadStream(localPath), {filename})
    uploaded.set(localPath, asset.url)
    console.log(`Uploaded ${path.relative(root, localPath)} -> ${asset.url}`)
  }

  const replacementsByPost = new Map<string, Array<{from: string; to: string}>>()

  for (const [localPath, uses] of refsByPath) {
    const url = uploaded.get(localPath)
    if (!url) continue

    for (const {file, rawUrl} of uses) {
      const slug = file.replace(/\.md$/, '')
      const id = `post-${slug}`
      const replacements = replacementsByPost.get(id) ?? []
      replacements.push({from: rawUrl, to: url})
      replacementsByPost.set(id, replacements)
    }
  }

  for (const [id, replacements] of replacementsByPost) {
    const doc = await client.getDocument<{body?: string}>(id)
    if (!doc) throw new Error(`Missing Sanity post document: ${id}`)

    let body = doc.body ?? ''

    for (const {from, to} of replacements) {
      body = body.split(`](${from}`).join(`](${to}`)
    }

    await client.patch(id).set({body}).commit()
    console.log(`Patched ${id} (${replacements.length} image refs)`)
  }

  console.log(`Uploaded ${uploaded.size} images and patched ${replacementsByPost.size} posts.`)
}

importBlogImages().catch((error) => {
  console.error(error)
  process.exit(1)
})
