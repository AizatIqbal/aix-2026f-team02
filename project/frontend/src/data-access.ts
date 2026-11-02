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
  products: (NewProductInput & { source_product_id?: number })[]
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
  }): Promise<SavedOrder>
}

let dataSource: PosDataSource = createSeedDataSource()

/** Replace this adapter when the existing database client is connected. */
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

export function saveOrder(lines: OrderLineInput[]): Promise<SavedOrder> {
  const total = lines.reduce((sum, line) => sum + line.quantity * line.price, 0)

  return dataSource.saveOrder({ total, items: lines })
}

export function addProduct(input: NewProductInput): Promise<Product> {
  return dataSource.addProduct(input)
}

export function importData(input: ImportPayload): Promise<ImportResult> {
  return dataSource.importData(input)
}
import { createSeedDataSource } from './seed-data'
