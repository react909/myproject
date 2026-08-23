// src/pages/Receipts/types.ts

export type PaymentMethod = 'cash' | 'card' | 'mixed' | 'debt'

export type ReceiptStatus = 'completed' | 'refunded' | 'partial_refund' | 'debt' | 'canceled'

export type ReceiptItem = {
  id: string
  name: string
  quantity: number
  price: number
  purchasePrice?: number
  total: number
  isWeight: boolean
  refunded?: boolean
  refundedQuantity?: number
}

export type RefundLineSelection = {
  itemId: string
  quantity: number
}

export type Receipt = {
  id: string
  number: string
  date: string
  time: string
  cashier: string
  items: ReceiptItem[]
  subtotal: number
  discount: number
  total: number
  paymentMethod: PaymentMethod
  status: ReceiptStatus
  cashGiven?: number
  change?: number
  customerName?: string
}

export type ReceiptsFilters = {
  search: string
  customer: string
  product: string
  dateFrom: string
  dateTo: string
  timeFrom: string
  timeTo: string
  paymentMethod: PaymentMethod | 'all'
  status: ReceiptStatus | 'all'
  cashier: string | 'all'
  /** Быстрый пресет периода */
  period: 'today' | 'week' | 'all'
}