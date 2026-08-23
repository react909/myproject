const { BrowserWindow } = require('electron')
const escpos = require('./escpos.cjs')
const logger = require('../services/logger.cjs')
const { resolvePaper, PAPER } = require('../receipt/receipt-render.cjs')

function nativeImageToRaster(image) {
  const { width, height } = image.getSize()
  const src = image.getBitmap()
  const alignedWidth = Math.ceil(width / 8) * 8
  const bytesPerRow = alignedWidth / 8
  const raster = Buffer.alloc(bytesPerRow * height, 0)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const b = src[i]
      const g = src[i + 1]
      const r = src[i + 2]
      const a = src[i + 3]
      if (a < 16) continue
      const luminance = (r * 299 + g * 587 + b * 114) / 1000
      if (luminance < 170) {
        raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
  }

  const header = Buffer.from([
    0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ])

  return Buffer.concat([header, raster])
}

async function measureReceiptHeight(webContents) {
  return webContents.executeJavaScript(`
    new Promise((resolve) => {
      const measure = () => {
        const el = document.getElementById('receipt');
        if (!el) {
          resolve(Math.ceil(document.documentElement.scrollHeight));
          return;
        }
        const rect = el.getBoundingClientRect();
        let bottom = rect.bottom;
        for (let i = 0; i < el.children.length; i++) {
          const childRect = el.children[i].getBoundingClientRect();
          bottom = Math.max(bottom, childRect.bottom);
        }
        const scrollH = Math.max(
          bottom - rect.top,
          el.scrollHeight || 0,
          el.offsetHeight || 0,
          document.documentElement.scrollHeight || 0,
          document.body ? document.body.scrollHeight : 0
        );
        resolve(Math.max(48, Math.ceil(scrollH + 16)));
      };
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(measure)));
        });
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(measure)));
      }
    })
  `)
}

async function buildBitmapReceiptBuffer(data, options = {}) {
  const paper = resolvePaper(options)
  const width = paper.width
  const html = options.html || data?.bitmapHtml
  if (!html) {
    throw new Error('bitmapHtml is required for receipt raster')
  }

  const win = new BrowserWindow({
    width,
    height: 64,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1,
    },
  })

  try {
    win.webContents.setZoomFactor(1)
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

    const lineCount = Array.isArray(data?.lines) ? data.lines.length : 0
    const settleMs = Math.min(500, 60 + lineCount * 12)

    let height = await measureReceiptHeight(win.webContents)
    height = Math.max(48, Math.min(12000, height))
    win.setContentSize(width, height)
    await new Promise((resolve) => setTimeout(resolve, settleMs))
    height = await measureReceiptHeight(win.webContents)
    height = Math.max(48, Math.min(12000, height))
    win.setContentSize(width, height)
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, settleMs / 2)))
    height = await measureReceiptHeight(win.webContents)
    height = Math.max(48, Math.min(12000, height))
    win.setContentSize(width, height)
    await new Promise((resolve) => setTimeout(resolve, 40))

    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width,
      height,
    })

    const raster = nativeImageToRaster(image)
    logger.append('printer', 'info', 'bitmap receipt rendered', {
      paper: paper === PAPER[80] ? '80mm' : '58mm',
      width: image.getSize().width,
      height: image.getSize().height,
      bytes: raster.length,
      lines: Array.isArray(data?.lines) ? data.lines.length : 0,
    })

    return Buffer.concat([
      escpos.init(),
      raster,
      escpos.feed(3),
      escpos.cut(),
    ])
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

module.exports = {
  buildBitmapReceiptBuffer,
  nativeImageToRaster,
  PAPER,
}
