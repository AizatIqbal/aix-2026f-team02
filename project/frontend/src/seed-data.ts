import type {
  Campaign,
  Category,
  Customer,
  Order,
  OrderItem,
  PosDataSource,
  Product,
  SavedOrder,
} from './data-access'

const categories: Category[] = [
  { category_id: 1, category_name: 'Coffee' },
  { category_id: 2, category_name: 'Cold Drinks' },
  { category_id: 3, category_name: 'Breakfast' },
  { category_id: 4, category_name: 'Lunch' },
  { category_id: 5, category_name: 'Bakery' },
]

const customers: Customer[] = [
  {
    customer_phone: '000-000-0000',
    customer_name: 'Walk-in Customer',
    customer_age: null,
    customer_gender: null,
  },
  {
    customer_phone: '555-010-2048',
    customer_name: 'Jordan Lee',
    customer_age: 31,
    customer_gender: 'Non-binary',
  },
  {
    customer_phone: '555-010-7712',
    customer_name: 'Maya Patel',
    customer_age: 27,
    customer_gender: 'Female',
  },
]

const campaigns: Campaign[] = [
  {
    promocode: 'MORNING-COFFEE',
    campaign_name: 'Morning Coffee Club',
    channel: 'In-store',
    start_date: '2025-01-01',
    end_date: '2026-12-31',
    budget: 1200,
    discount_value: 1,
  },
  {
    promocode: 'LUNCH-LOCAL',
    campaign_name: 'Local Lunch',
    channel: 'Social',
    start_date: '2025-01-01',
    end_date: '2026-12-31',
    budget: 2500,
    discount_value: 2.5,
  },
]

const products: Product[] = [
  { product_id: 1, category_id: 1, product_name: 'Flat White', price: 4.5 },
  { product_id: 2, category_id: 1, product_name: 'Cappuccino', price: 4.75 },
  { product_id: 3, category_id: 1, product_name: 'Long Black', price: 3.75 },
  { product_id: 4, category_id: 1, product_name: 'Mocha', price: 5.25 },
  { product_id: 5, category_id: 2, product_name: 'House Lemonade', price: 4.5 },
  { product_id: 6, category_id: 2, product_name: 'Iced Matcha', price: 5.75 },
  { product_id: 7, category_id: 2, product_name: 'Sparkling Water', price: 3.25 },
  { product_id: 8, category_id: 3, product_name: 'Avocado Toast', price: 12.5 },
  { product_id: 9, category_id: 3, product_name: 'Breakfast Brioche', price: 11.75 },
  { product_id: 10, category_id: 3, product_name: 'Granola Bowl', price: 9.5 },
  { product_id: 11, category_id: 4, product_name: 'Roast Chicken Sandwich', price: 13.5 },
  { product_id: 12, category_id: 4, product_name: 'Harvest Salad', price: 12.75 },
  { product_id: 13, category_id: 4, product_name: 'Tomato Soup', price: 8.5 },
  { product_id: 14, category_id: 5, product_name: 'Almond Croissant', price: 5.25 },
  { product_id: 15, category_id: 5, product_name: 'Banana Bread', price: 4.75 },
]

interface SeedLine {
  product_id: number
  quantity: number
}

interface SeedSale {
  daysAgo: number
  time: string
  lines: SeedLine[]
}

const seedSales: SeedSale[] = [
  { daysAgo: 0, time: '08:12:00', lines: [{ product_id: 1, quantity: 2 }, { product_id: 14, quantity: 1 }] },
  { daysAgo: 0, time: '09:34:00', lines: [{ product_id: 8, quantity: 1 }, { product_id: 2, quantity: 1 }] },
  { daysAgo: 0, time: '12:18:00', lines: [{ product_id: 11, quantity: 2 }, { product_id: 5, quantity: 2 }] },
  { daysAgo: 1, time: '07:48:00', lines: [{ product_id: 3, quantity: 1 }, { product_id: 15, quantity: 1 }] },
  { daysAgo: 1, time: '10:22:00', lines: [{ product_id: 10, quantity: 2 }, { product_id: 6, quantity: 1 }] },
  { daysAgo: 1, time: '13:06:00', lines: [{ product_id: 12, quantity: 1 }, { product_id: 7, quantity: 1 }] },
  { daysAgo: 2, time: '08:45:00', lines: [{ product_id: 2, quantity: 2 }, { product_id: 9, quantity: 1 }] },
  { daysAgo: 2, time: '11:51:00', lines: [{ product_id: 13, quantity: 1 }, { product_id: 14, quantity: 2 }] },
  { daysAgo: 3, time: '09:10:00', lines: [{ product_id: 1, quantity: 1 }, { product_id: 8, quantity: 1 }] },
  { daysAgo: 3, time: '14:27:00', lines: [{ product_id: 11, quantity: 1 }, { product_id: 5, quantity: 1 }, { product_id: 15, quantity: 1 }] },
  { daysAgo: 4, time: '08:03:00', lines: [{ product_id: 4, quantity: 2 }, { product_id: 14, quantity: 2 }] },
  { daysAgo: 4, time: '12:42:00', lines: [{ product_id: 12, quantity: 2 }, { product_id: 7, quantity: 2 }] },
  { daysAgo: 5, time: '10:15:00', lines: [{ product_id: 6, quantity: 2 }, { product_id: 10, quantity: 1 }] },
  { daysAgo: 5, time: '15:38:00', lines: [{ product_id: 3, quantity: 2 }, { product_id: 15, quantity: 2 }] },
  { daysAgo: 6, time: '09:26:00', lines: [{ product_id: 9, quantity: 2 }, { product_id: 1, quantity: 2 }] },
  { daysAgo: 6, time: '13:14:00', lines: [{ product_id: 11, quantity: 1 }, { product_id: 13, quantity: 1 }, { product_id: 5, quantity: 2 }] },
  { daysAgo: 9, time: '08:39:00', lines: [{ product_id: 8, quantity: 2 }, { product_id: 2, quantity: 2 }] },
  { daysAgo: 12, time: '11:08:00', lines: [{ product_id: 12, quantity: 1 }, { product_id: 6, quantity: 1 }, { product_id: 14, quantity: 1 }] },
  { daysAgo: 16, time: '09:52:00', lines: [{ product_id: 10, quantity: 2 }, { product_id: 4, quantity: 1 }] },
  { daysAgo: 21, time: '12:31:00', lines: [{ product_id: 11, quantity: 2 }, { product_id: 7, quantity: 2 }] },
  { daysAgo: 26, time: '08:18:00', lines: [{ product_id: 1, quantity: 3 }, { product_id: 14, quantity: 2 }] },
  { daysAgo: 34, time: '14:02:00', lines: [{ product_id: 13, quantity: 2 }, { product_id: 5, quantity: 2 }] },
]

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildSeedOrders(): { orders: Order[]; orderItems: OrderItem[] } {
  const productMap = new Map(products.map((product) => [product.product_id, product]))
  const orders: Order[] = []
  const orderItems: OrderItem[] = []
  let nextOrderItemId = 1

  seedSales.forEach((sale, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() - sale.daysAgo)
    const order_id = index + 1
    let total = 0

    sale.lines.forEach((line) => {
      const product = productMap.get(line.product_id)
      if (!product) return
      total += product.price * line.quantity
      orderItems.push({
        order_item_id: nextOrderItemId,
        order_id,
        product_id: line.product_id,
        quantity: line.quantity,
        price: product.price,
      })
      nextOrderItemId += 1
    })

    orders.push({
      order_id,
      order_date: localDateString(date),
      order_time: sale.time,
      day_of_week: date.toLocaleDateString('en-US', { weekday: 'long' }),
      customer_phone: null,
      promocode: null,
      discount: 0,
      total,
    })
  })

  return { orders, orderItems }
}

/**
 * Local prototype adapter. Replace its use in data-access.ts with the real
 * database adapter; no UI code needs to change.
 */
export function createSeedDataSource(): PosDataSource {
  const initial = buildSeedOrders()
  const seedCategories = categories.map((category) => ({ ...category }))
  const seedCustomers = customers.map((customer) => ({ ...customer }))
  const seedCampaigns = campaigns.map((campaign) => ({ ...campaign }))
  const seedProducts = products.map((product) => ({ ...product }))
  const seedOrders = initial.orders.map((order) => ({ ...order }))
  const seedOrderItems = initial.orderItems.map((item) => ({ ...item }))

  return {
    getCategories: async () => seedCategories.map((category) => ({ ...category })),
    getCustomers: async () => seedCustomers.map((customer) => ({ ...customer })),
    getCampaigns: async () => seedCampaigns.map((campaign) => ({ ...campaign })),
    getProducts: async () => seedProducts.map((product) => ({ ...product })),
    getOrders: async () => seedOrders.map((order) => ({ ...order })),
    getOrderItems: async () => seedOrderItems.map((item) => ({ ...item })),
    addProduct: async (input) => {
      if (!seedCategories.some((category) => category.category_id === input.category_id)) {
        throw new Error('Choose a valid category.')
      }
      const product: Product = {
        product_id: Math.max(0, ...seedProducts.map((item) => item.product_id)) + 1,
        ...input,
      }
      seedProducts.push(product)
      return { ...product }
    },
    importData: async (input) => {
      const importedCategories: Category[] = []
      input.categories.forEach((item) => {
        const existing = seedCategories.find((category) => category.category_name.toLowerCase() === item.category_name.toLowerCase())
        if (existing) return
        const category = {
          category_id: Math.max(0, ...seedCategories.map((value) => value.category_id)) + 1,
          category_name: item.category_name,
        }
        seedCategories.push(category)
        importedCategories.push(category)
      })

      let nextProductId = Math.max(0, ...seedProducts.map((value) => value.product_id)) + 1
      const productIdMap = new Map<number, number>()
      const importedProducts: Product[] = input.products.map(({ source_product_id, ...item }) => {
        const product = { ...item, product_id: nextProductId++ }
        if (source_product_id) productIdMap.set(source_product_id, product.product_id)
        return product
      })
      seedProducts.push(...importedProducts)

      let nextOrderId = Math.max(0, ...seedOrders.map((value) => value.order_id)) + 1
      const orderIdMap = new Map<number, number>()
      const importedOrders: Order[] = input.orders.map(({ source_order_id, ...item }) => {
        const order = { ...item, order_id: nextOrderId++ }
        if (source_order_id) orderIdMap.set(source_order_id, order.order_id)
        return order
      })
      seedOrders.push(...importedOrders)

      const validOrderIds = new Set(seedOrders.map((item) => item.order_id))
      const validProductIds = new Set(seedProducts.map((item) => item.product_id))
      let nextOrderItemId = Math.max(0, ...seedOrderItems.map((value) => value.order_item_id)) + 1
      const importedOrderItems: OrderItem[] = input.orderItems
        .map((item) => ({
          ...item,
          order_id: orderIdMap.get(item.order_id) ?? item.order_id,
          product_id: productIdMap.get(item.product_id) ?? item.product_id,
        }))
        .filter((item) => validOrderIds.has(item.order_id) && validProductIds.has(item.product_id))
        .map((item) => ({ ...item, order_item_id: nextOrderItemId++ }))
      seedOrderItems.push(...importedOrderItems)

      return {
        categories: importedCategories.map((item) => ({ ...item })),
        products: importedProducts.map((item) => ({ ...item })),
        orders: importedOrders.map((item) => ({ ...item })),
        orderItems: importedOrderItems.map((item) => ({ ...item })),
      }
    },
    saveOrder: async (input): Promise<SavedOrder> => {
      const order_id = Math.max(0, ...seedOrders.map((order) => order.order_id)) + 1
      const firstOrderItemId = Math.max(0, ...seedOrderItems.map((item) => item.order_item_id)) + 1
      const now = new Date()
      const order: Order = {
        order_id,
        order_date: localDateString(now),
        order_time: now.toTimeString().slice(0, 8),
        day_of_week: now.toLocaleDateString('en-US', { weekday: 'long' }),
        customer_phone: null,
        promocode: null,
        discount: 0,
        total: input.total,
      }
      const orderItems: OrderItem[] = input.items.map((item, index) => ({
        order_item_id: firstOrderItemId + index,
        order_id,
        product_id: item.product_id,
        quantity: item.quantity,
        price: item.price,
      }))

      seedOrders.push(order)
      seedOrderItems.push(...orderItems)
      return { order: { ...order }, orderItems: orderItems.map((item) => ({ ...item })) }
    },
  }
}
