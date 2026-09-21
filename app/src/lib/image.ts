/**
 * 用户发图前的本地处理：压到能发、缩到能存。
 *
 * 两件事分开做，因为**两个上限不是一回事**：
 *
 *   · **发给 agent** 的那份要能看清内容（图里可能是账单、卡号、二维码），
 *     所以压到 `SEND_MAX_EDGE`／`SEND_QUALITY`——既要满足服务端 6MB 上限，
 *     也要让模型辨认得出文字。
 *   · **存进本地会话存档**的那份只是"这条消息当时配了张图"的证据。
 *     localStorage 总盘 `MAX_STORE_BYTES` 只有 2MB，原图 base64 一张就能吃掉
 *     一大半，所以存档只留一张很小的缩略图（`THUMB_MAX_EDGE`）。
 *
 * 不变量：**存档里永远不会有原图**。这条由 {@link prepareImage} 的返回值结构
 * 保证——它同时给出 `send`（要发出去的）和 `thumb`（要存下来的），调用方
 * 没有机会把 `send` 写进存档。
 *
 * @module app/lib/image
 */

/** 发出去的那份：最长边压到多少像素。 */
export const SEND_MAX_EDGE = 1600
/** 发出去的那份：JPEG 质量。 */
export const SEND_QUALITY = 0.82
/** 存档缩略图：最长边多少像素。*/
export const THUMB_MAX_EDGE = 160
/** 存档缩略图：JPEG 质量。 */
export const THUMB_QUALITY = 0.6
/** 用户能选多大的原文件（比服务端上限宽松，因为本地会先压）。 */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024

/** 服务端认的图片类型，和 `bridge/demo-server.mjs` 的 `IMAGE_MIME_TYPES` 对齐。 */
export const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** 一次准备好的图片。 */
export interface PreparedImage {
  /** 发给 agent 的 base64（**不带** `data:` 前缀）。 */
  data: string
  /** 发给 agent 的 MIME。压缩之后统一是 `image/png` 或 `image/jpeg`。 */
  mimeType: string
  /** 存进本地会话存档的小缩略图（`data:` URL）。 */
  thumb: string
  /** 原文件名，只用于界面展示。 */
  name: string
}

/** 处理失败的原因，调用方直接把它显示给用户。 */
export class ImageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageError'
  }
}

/** Blob → base64（不带前缀）。 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new ImageError('读不出这张图片的数据'))
        return
      }
      // `data:image/png;base64,XXXX` → `XXXX`
      const comma = result.indexOf(',')
      resolve(comma < 0 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => { reject(new ImageError('读不出这张图片的数据')) }
    reader.readAsDataURL(blob)
  })
}

/** 按最长边等比缩放；本来就够小就原样返回尺寸。 */
function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 画到 canvas 上并编码成 JPEG/PNG blob。 */
async function encode(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new ImageError('浏览器不支持图片处理（拿不到 canvas）')
  // 缩略图会有透明像素；不铺白底的话 JPEG 会把它编成黑色。
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/jpeg', quality) })
  if (blob === null) throw new ImageError('图片压缩失败')
  return blob
}

/**
 * 把用户选的文件处理成"能发的一份 + 能存的一份"。
 *
 * GIF 是个例外：走 canvas 会把动图压成静帧，所以**原样发**（只校验大小），
 * 缩略图那步还是照压。用户选动图通常就是想让 agent 看动图。
 * @param file - 用户选的文件。
 * @returns 处理结果。
 * @throws {ImageError} 类型不认识、太大、或者解不出像素时。
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const declared = file.type === '' ? guessMimeFromName(file.name) : file.type
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(declared)) {
    throw new ImageError(`不支持的图片格式：${declared === '' ? '未知' : declared}`)
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageError(`这张图太大了（${Math.round(file.size / 1024 / 1024)}MB，上限 ${MAX_SOURCE_BYTES / 1024 / 1024}MB）`)
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageError('这个文件解不出图像，可能不是真的图片')
  }

  try {
    const thumbBlob = await encode(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY)
    const thumb = `data:image/jpeg;base64,${await blobToBase64(thumbBlob)}`

    // 动图原样发：canvas 只能给静帧。
    if (declared === 'image/gif') {
      return { data: await blobToBase64(file), mimeType: declared, thumb, name: file.name }
    }

    const sendBlob = await encode(bitmap, SEND_MAX_EDGE, SEND_QUALITY)
    return { data: await blobToBase64(sendBlob), mimeType: 'image/jpeg', thumb, name: file.name }
  } finally {
    bitmap.close()
  }
}

/** 从扩展名猜 MIME：有些系统（和拖拽进来的文件）不带 `type`。 */
export function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return ''
}
