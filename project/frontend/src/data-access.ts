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
  order_item_id: number
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

export interface ImportPayload {
  categories: Omit<Category, 'category_id'>[]
  products: (NewProductInput & { source_product_id?: number; category_name?: string })[]
  orders: (Omit<Order, 'order_id'> & { source_order_id?: number })[]
  orderItems: Omit<OrderItem, 'order_item_id'>[]
}

export interface ImportResult {
  categories: Category[]
  products: Product[]
  orders: Order[]
  orderItems: OrderItem[]
}

export interface PosDataSource {
  getCategories(): Promise<Category[]>
  getCustomers(): Promise<Customer[]>
  getCampaigns(): Promise<Campaign[]>
  getProducts(): Promise<Product[]>
  getOrders(): Promise<Order[]>
  getOrderItems(): Promise<OrderItem[]>
  addProduct(input: NewProductInput): Promise<Product>
  importData(input: ImportPayload): Promise<ImportResult>
  saveOrder(input: {
    total: number
    items: OrderLineInput[]
    customer_phone?: string
  }): Promise<SavedOrder>
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

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/api/v1${path}`, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    if (typeof body?.detail === 'string') throw new Error(body.detail)
    if (Array.isArray(body?.detail)) {
      throw new Error(body.detail.map((entry: { msg: string }) => entry.msg).join('. '))
    }
    throw new Error(`Request failed (${response.status}). Check the backend connection.`)
  }
  return response.json()
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let dataSource: PosDataSource = {
  getCategories: () => apiRequest('/categories'),
  getCustomers: () => apiRequest('/customers'),
  getCampaigns: () => apiRequest('/campaigns'),
  getProducts: () => apiRequest('/products'),
  getOrders: () => apiRequest('/orders'),
  getOrderItems: () => apiRequest('/order-items'),
  async addProduct({ image_url, ...product }) {
    const saved = await post<Product>('/products', product)
    return { ...saved, image_url }
  },
  importData: (input) => post('/imports', input),
  saveOrder: ({ items, customer_phone }) => post('/orders', {
    items: items.map(({ product_id, quantity }) => ({ product_id, quantity })),
    customer_phone,
  }),
}

/** Override the data source for local demos or tests. */
export function configureDataSource(source: PosDataSource): void {
  dataSource = source
}

export function getCategories(): Promise<Category[]> {
  return dataSource.getCategories()
}

export function getProducts(): Promise<Product[]> {
  return dataSource.getProducts()
}

export function getCustomers(): Promise<Customer[]> {
  return dataSource.getCustomers()
}

export function getCampaigns(): Promise<Campaign[]> {
  return dataSource.getCampaigns()
}

export function getOrders(): Promise<Order[]> {
  return dataSource.getOrders()
}

export function getOrderItems(): Promise<OrderItem[]> {
  return dataSource.getOrderItems()
}

export function saveOrder(lines: OrderLineInput[], customer_phone?: string): Promise<SavedOrder> {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)

  return dataSource.saveOrder({ total, items: lines, customer_phone })
}

export function addProduct(input: NewProductInput): Promise<Product> {
  return dataSource.addProduct(input)
}

export function importData(input: ImportPayload): Promise<ImportResult> {
  return dataSource.importData(input)
}

export function getStatistics(query: URLSearchParams, signal: AbortSignal): Promise<Statistics> {
  return apiRequest(`/statistics?${query}`, { signal })
}
