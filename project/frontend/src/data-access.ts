
export interface Category {
  category_id: number
  category_name: string
}

export interface Customer {
  customer_phone: string
  customer_name: string
  customer_age: number | null
  customer_gender: string | null
}

export interface Campaign {
  promocode: string
  campaign_name: string
  channel: string
  start_date: string
  end_date: string
  budget: number
  discount_value: number
}

export interface Product {
  product_id: number
  category_id: number
  product_name: string
  price: number
  image_url?: string
}

export interface Order {
  order_id: number
  order_date: string
  order_time: string
  day_of_week: string
  customer_phone: string | null
  promocode: string | null
  discount: number
  total: number
}

export interface OrderItem {
  order_item_id?: number
  order_id: number
  product_id: number
  quantity: number
  price: number
}

export interface OrderLineInput {
  product_id: number
  quantity: number
  price: number
}

export interface SavedOrder {
  order: Order
  orderItems: OrderItem[]
}

export interface NewProductInput {
  product_name: string
  category_id: number
  price: number
  image_url?: string
}

export interface ImportProductInput {
  product_name: string
  price: number
  category_id?: number
  category_name?: string
  source_product_id?: number
}

export interface ImportPayload {
  categories: Omit<Category, 'category_id'>[]
  products: ImportProductInput[]
  orders: (Omit<Order, 'order_id'> & { source_order_id?: number })[]
  orderItems: Omit<OrderItem, 'order_item_id'>[]
}

export interface ImportResult {
  categories: Category[]
  products: Product[]
  orders: Order[]
  orderItems: OrderItem[]
  skipped?: {
    categories: number
    products: number
  }
}

export interface AnalyticsExportRequest {
  scope: 'current' | 'full'
  filters?: {
    preset: string
    days: string[]
    startTime: string
    endTime: string
    categories: number[]
  }
}

interface SalesTotals {
  units: number
  gross: string
  discount: string
  net: string
  orders: number
}

export interface Statistics {
  summary: SalesTotals & { average_order_value: string }
  periods: (SalesTotals & { period: string })[]
  products: (SalesTotals & { product_id: number; product_name: string })[]
  by_hour: (SalesTotals & { hour: number })[]
  by_weekday: (SalesTotals & { weekday: number })[]
  by_category: (SalesTotals & { category_id: number })[]
  warnings: string[]
}

const API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

// --------------------------------------------------
// API HELPERS
// --------------------------------------------------

async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    let message = `API request failed (${response.status})`

    try {
      const body = await response.json()
      if (typeof body.detail === 'string') {
        message = body.detail
      } else if (Array.isArray(body.detail)) {
        message = body.detail
            .map((item: { msg?: string }) => item.msg ?? 'Invalid request')
            .join(', ')
      }
    } catch {
      // Use the fallback error message.
    }

    throw new Error(message)
  }

  return response.json() as Promise<T>
}

// Backend returns order_time as seconds from midnight,
// for example 45000 = 12:30:00.
function normalizeOrderTime(value: string | number): string {
  if (typeof value === 'string' && value.includes(':')) {
    return value
  }

  const totalSeconds = Math.floor(Number(value))

  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00:00'
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return [
    hours,
    minutes,
    seconds,
  ].map((part) => String(part).padStart(2, '0')).join(':')
}

interface BackendOrder {
  order_id: number
  order_date: string
  order_time: string | number
  day_of_week: string
  discount: number
  total: number
}

interface BackendOrderItem {
  product_id: number
  product_name: string
  quantity: number
  price: number
  subtotal: number
}

interface BackendOrderDetail extends BackendOrder {
  items: BackendOrderItem[]
}

function normalizeOrder(order: BackendOrder): Order {
  return {
    order_id: order.order_id,
    order_date: order.order_date,
    order_time: normalizeOrderTime(order.order_time),
    day_of_week: order.day_of_week,
    customer_phone: null,
    promocode: null,
    discount: Number(order.discount),
    total: Number(order.total),
  }
}

function normalizeOrderItems(
    orderId: number,
    items: BackendOrderItem[],
): OrderItem[] {
  return items.map((item) => ({
    order_id: orderId,
    product_id: item.product_id,
    quantity: Number(item.quantity),
    price: Number(item.price),
  }))
}

// --------------------------------------------------
// API DATA SOURCE
// --------------------------------------------------

export async function getCategories(): Promise<Category[]> {
  return apiRequest<Category[]>('/categories')
}

export async function getProducts(): Promise<Product[]> {
  return apiRequest<Product[]>('/products')
}

export async function getCustomers(): Promise<Customer[]> {
  return apiRequest<Customer[]>('/customers')
}

export async function getCampaigns(): Promise<Campaign[]> {
  return apiRequest<Campaign[]>('/campaigns')
}

export function getStatistics(query: URLSearchParams, signal: AbortSignal): Promise<Statistics> {
  return apiRequest(`/statistics?${query}`, { signal })
}

export async function getOrders(): Promise<Order[]> {
  const orders = await apiRequest<BackendOrder[]>('/orders')

  return orders.map(normalizeOrder)
}

export async function getOrderItems(): Promise<OrderItem[]> {
  const orders = await apiRequest<BackendOrder[]>('/orders')

  const details = await Promise.all(
      orders.map((order) =>
          apiRequest<BackendOrderDetail>(`/orders/${order.order_id}`),
      ),
  )

  return details.flatMap((detail) =>
      normalizeOrderItems(detail.order_id, detail.items),
  )
}

// --------------------------------------------------
// PRODUCT CREATION
// --------------------------------------------------

export async function addProduct(
    input: NewProductInput,
): Promise<Product> {
  const product = await apiRequest<Product>('/products', {
    method: 'POST',
    body: JSON.stringify({
      product_name: input.product_name,
      category_id: input.category_id,
      price: input.price,
    }),
  })

  return product
}

// --------------------------------------------------
// ORDER CREATION
// --------------------------------------------------

export async function saveOrder(
    lines: OrderLineInput[],
): Promise<SavedOrder> {
  if (lines.length === 0) {
    throw new Error('An order must contain at least one item.')
  }

  const result = await apiRequest<{
    order_id: number
    subtotal: number
    discount: number
    total: number
    items: BackendOrderItem[]
  }>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      items: lines.map((line) => ({
        product_id: line.product_id,
        quantity: line.quantity,
      })),
      discount: 0,
    }),
  })

  // Retrieve the complete order after creation.
  const detail = await apiRequest<BackendOrderDetail>(
      `/orders/${result.order_id}`,
  )

  return {
    order: normalizeOrder(detail),
    orderItems: normalizeOrderItems(
        detail.order_id,
        detail.items,
    ),
  }
}

// --------------------------------------------------
// BULK IMPORT
// --------------------------------------------------

export async function importData(
    input: ImportPayload,
): Promise<ImportResult> {
  return apiRequest<ImportResult>('/import', {
    method: 'POST',
    body: JSON.stringify({
      categories: input.categories,
      products: input.products,
    }),
  })
}


// --------------------------------------------------
// ANALYTICS EXPORT
// Existing implementation preserved; not part of this
// backend integration task.
// --------------------------------------------------

export async function exportAnalytics(
    request: AnalyticsExportRequest,
): Promise<string> {
  const response = await fetch('/api/analytics/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    let message = 'The Excel report could not be generated.'

    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) message = body.detail
    } catch {
      // Keep the user-friendly fallback.
    }

    throw new Error(message)
  }

  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const date = new Date().toISOString().slice(0, 10)
  const filename = encodedName
      ? decodeURIComponent(encodedName)
      : plainName ?? `PointNull_Analytics_${date}.xlsx`

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)

  return filename
}
