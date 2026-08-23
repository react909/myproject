import { useMemo } from 'react'
import type { PrinterSettings } from '../settings/appSettings'
import {
  PAPER,
  bitmapOptsFromPrinter,
  buildPreviewSamplePayload,
  buildReceiptHtml,
  resolvePaper,
  type ReceiptPrintPayload,
} from './receiptTemplate'
import './ReceiptLivePreview.css'

type ReceiptLivePreviewProps = {
  printer: PrinterSettings
  payload?: ReceiptPrintPayload
}

export function ReceiptLivePreview({ printer, payload }: ReceiptLivePreviewProps) {
  const html = useMemo(() => {
    const data = payload ?? buildPreviewSamplePayload({ cashier: 'Кассир POS' })
    const opts = bitmapOptsFromPrinter(printer)
    const paper = resolvePaper(opts)
    return buildReceiptHtml(data, paper, opts)
  }, [printer, payload])

  const paper = resolvePaper(bitmapOptsFromPrinter(printer))
  const paperLabel = PAPER[printer.paperWidth === '80' ? '80' : '58'].label

  return (
    <div className="receipt-preview">
      <div className="receipt-preview__meta">
        <span className="receipt-preview__label">Live Preview</span>
        <span className="receipt-preview__size">{paperLabel} · {paper.width}px</span>
      </div>
      <div className="receipt-preview__stage">
        <div
          className="receipt-preview__tape"
          style={{ width: paper.width + 24 }}
        >
          <iframe
            className="receipt-preview__frame"
            title="Предпросмотр чека"
            srcDoc={html}
            style={{ width: paper.width, height: 520 }}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}

export { buildPrinterPreviewPayload } from './receiptTemplate'
