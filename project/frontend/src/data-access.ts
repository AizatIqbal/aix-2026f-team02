export interface Category {
  category_id: number;
  category_name: string;
}

export interface Customer {
  customer_phone: string;
  customer_name: string;
  customer_age: number | null;
  customer_gender: string | null;
}

export interface CustomerSummary extends Customer {
  total_orders: number;
  total_spent: number;
  last_order_date: string | null;
}

export interface Campaign {
  promocode: string;
  campaign_name: string;
  channel: string;
  start_date: string;
  end_date: string;
  budget: number;
  discount_value: number;
}

export interface Product {
  product_id: number;
  category_id: number;
  category_name?: string;
  product_name: string;
  price: number;
  image_url?: string | null;
  active?: boolean;
}

export interface Order {
  order_id: number;
  order_date: string;
  order_time: string;
  day_of_week: string;
  customer_phone: string | null;
  customer_name?: string | null;
  promocode: string | null;
  discount: number;
  total: number;
  item_count?: number;
}

export interface OrdersPageResponse {
  items: Order[];
  total: number;
  summary: {
    orders: number;
    revenue: number;
    average: number;
    items: number;
  };
}

export interface OrderItem {
  order_item_id?: number;
  order_id: number;
  product_id: number;
  product_name?: string;
  category_name?: string | null;
  quantity: number;
  price: number;
  subtotal?: number;
}

export interface OrderLineInput {
  product_id: number;
  quantity: number;
  /** Display-only price snapshot. The backend re-reads the authoritative price. */
  price: number;
}

export interface CheckoutDetails {
  customer_phone?: string | null;
  promocode?: string | null;
}

export interface SavedOrder {
  order: Order;
  orderItems: OrderItem[];
}

export interface CampaignValidation {
  valid: boolean;
  code: string;
  discount: number;
  message: string;
}

export interface NewProductInput {
  product_name: string;
  category_id: number;
  price: number;
  image_url?: string | null;
}

export interface ImportProductInput {
  product_name: string;
  price: number;
  category_id?: number;
  category_name?: string;
  source_product_id?: number;
}

export interface ImportCustomerInput {
  customer_phone: string;
  customer_name: string;
  customer_age?: number | null;
  customer_gender?: string | null;
}

export interface ImportPayload {
  categories: Omit<Category, "category_id">[];
  products: ImportProductInput[];
  customers: ImportCustomerInput[];
  // Retained for type compatibility; historical imports are intentionally disabled.
  orders: (Omit<Order, "order_id"> & { source_order_id?: number })[];
  orderItems: Omit<OrderItem, "order_item_id">[];
}

export interface ImportResult {
  categories: Category[];
  products: Product[];
  customers: Customer[];
  orders: Order[];
  orderItems: OrderItem[];
  skipped?: {
    categories: number;
    products: number;
    customers?: number;
  };
}

export interface AnalyticsExportRequest {
  scope: "current" | "full";
  /** Statistics query to export: the on-screen one, or only a grouping for the full report. */
  query: URLSearchParams;
  /** Report already on screen for this query; saves fetching it again. */
  statistics?: Statistics;
  categories: Category[];
  /** Screen filters, listed on the Summary sheet of a current-view export. */
  filters?: {
    days: string[];
    startTime: string;
    endTime: string;
    categories: number[];
  };
}

export interface Recommendations {
  items: { product_id: number; product_name: string; supporting_customers: number }[];
}

export interface DiscountSuggestion {
  /** Margin every suggestion must keep, as a fraction ("0.30"). */
  minimum_margin: string;
  /** Largest discount the calculator will ever suggest, as a fraction ("0.20"). */
  maximum_discount_fraction?: string;
  method?: string;
  /** null when the product is not part of the current filters. */
  item: {
    status: string;
    /** The suggestion: performance-based, then lowered to protect the margin. */
    candidate_discount_percent: number | null;
    /** What sales performance alone asks for, before the margin check. */
    performance_discount_percent?: number;
    limited_by?: "performance" | "margin" | null;
    /** false when no unit cost was given, so the margin was not verified. */
    margin_checked?: boolean;
    maximum_discount_percent?: number;
    candidate_discount_amount?: string;
    discounted_unit_price?: string;
    maximum_discount_amount_under_assumptions?: string;
    required_unit_sales_multiplier?: number | null;
    performance?: {
      rank: number;
      of: number;
      units: number;
      typical_units: number;
      /** 100 = sells as much as the typical product in the selection. */
      percent_of_typical: number | null;
    };
  } | null;
}

interface SalesTotals {
  units: number;
  gross: string;
  discount: string;
  net: string;
  orders: number;
}

export type StatisticsGroup = "day" | "week" | "month" | "year";
type PeriodTotals = SalesTotals & { period: string };
type ProductTotals = SalesTotals & { product_id: number; product_name: string; category_id?: number };

/** Sales of one customer group (an age group, a gender, or both). */
export type CustomerGroupTotals = SalesTotals & {
  customers: number;
  top_products: { product_id: number; product_name: string; units: number }[];
};

export interface Statistics {
  summary: SalesTotals & {
    average_order_value: string;
    identified_orders: number;
    known_age_orders: number;
    known_gender_orders: number;
  };
  group: StatisticsGroup;
  /** Inclusive date range the report covers (YYYY-MM-DD). */
  start?: string;
  end?: string;
  periods: PeriodTotals[];
  product_series: (Pick<ProductTotals, "product_id" | "product_name"> & { points: PeriodTotals[] })[];
  products: ProductTotals[];
  demographics: (ProductTotals & {
    age_group: string;
    gender: string;
    unique_identified_customers: number;
  })[];
  by_hour: (SalesTotals & { hour: number })[];
  by_weekday: (SalesTotals & { weekday: number })[];
  by_category: (SalesTotals & { category_id: number })[];
  by_campaign: (SalesTotals & {
    promocode: string;
    campaign_name: string;
    channel: string;
    budget: string;
  })[];
  /** Orders linked to a customer whose age or gender is on file. */
  customer_groups?: {
    customers: number;
    orders: number;
    age_groups: (CustomerGroupTotals & { age_group: string })[];
    genders: (CustomerGroupTotals & { gender: string })[];
    age_gender: (CustomerGroupTotals & { age_group: string; gender: string })[];
  };
  warnings: string[];
  definitions?: Record<string, string>;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");

/** Convert a backend-relative upload path into a browser-loadable URL. */
export function resolveAssetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^(https?:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  const apiOrigin = API_BASE_URL.replace(/\/api\/v1$/i, "");
  return `${apiOrigin}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the PointNull API. Check that the backend is running and the API URL is correct.");
  }

  if (!response.ok) {
    let message = `API request failed (${response.status})`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) {
        message = body.detail.map((item: { msg?: string }) => item.msg ?? "Invalid request").join(", ");
      }
    } catch {
      // Keep the HTTP fallback message when the response is not JSON.
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function normalizeOrderTime(value: string | number): string {
  if (typeof value === "string" && value.includes(":")) return value;
  const totalSeconds = Math.floor(Number(value));
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "00:00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

interface BackendOrder {
  order_id: number;
  order_date: string;
  order_time: string | number;
  day_of_week: string;
  customer_phone?: string | null;
  customer_name?: string | null;
  promocode?: string | null;
  discount: number;
  total: number;
  item_count?: number;
}

interface BackendOrderItem {
  order_item_id?: number;
  product_id: number;
  product_name: string;
  category_name?: string | null;
  quantity: number;
  price: number;
  subtotal?: number;
}

interface BackendOrderDetail extends BackendOrder {
  items: BackendOrderItem[];
}

function normalizeProduct(product: Product & { active?: boolean | number }): Product {
  return {
    ...product,
    price: Number(product.price),
    active: product.active === undefined ? true : Boolean(product.active),
    image_url: product.image_url ?? null,
  };
}

function normalizeOrder(order: BackendOrder): Order {
  return {
    order_id: order.order_id,
    order_date: String(order.order_date),
    order_time: normalizeOrderTime(order.order_time),
    day_of_week: order.day_of_week,
    customer_phone: order.customer_phone ?? null,
    customer_name: order.customer_name ?? null,
    promocode: order.promocode ?? null,
    discount: Number(order.discount),
    total: Number(order.total),
    item_count: order.item_count === undefined ? undefined : Number(order.item_count),
  };
}

function normalizeOrderItems(orderId: number, items: BackendOrderItem[]): OrderItem[] {
  return items.map((item) => ({
    order_item_id: item.order_item_id,
    order_id: orderId,
    product_id: item.product_id,
    product_name: item.product_name,
    category_name: item.category_name ?? null,
    quantity: Number(item.quantity),
    price: Number(item.price),
    subtotal: item.subtotal === undefined ? undefined : Number(item.subtotal),
  }));
}

export function getCategories(): Promise<Category[]> {
  return apiRequest<Category[]>("/categories");
}

export async function getProducts(): Promise<Product[]> {
  const records = await apiRequest<(Product & { active?: boolean | number })[]>("/products");
  return records.map(normalizeProduct);
}

export function getCustomers(signal?: AbortSignal): Promise<Customer[]> {
  return apiRequest<Customer[]>("/customers", { signal });
}

export function getCustomerSummaries(signal?: AbortSignal): Promise<CustomerSummary[]> {
  return apiRequest<CustomerSummary[]>("/customers/summary", { signal });
}

export async function getCustomerOrders(phone: string, limit = 8, signal?: AbortSignal): Promise<Order[]> {
  const records = await apiRequest<BackendOrder[]>(
    `/customers/${encodeURIComponent(phone)}/orders?limit=${limit}`,
    { signal },
  );
  return records.map(normalizeOrder);
}

export function getCampaigns(): Promise<Campaign[]> {
  return apiRequest<Campaign[]>("/campaigns");
}

export function getStatistics(query: URLSearchParams, signal?: AbortSignal): Promise<Statistics> {
  return apiRequest<Statistics>(`/statistics?${query.toString()}`, { signal });
}

export function getRecommendations(customerPhone: string, signal?: AbortSignal): Promise<Recommendations> {
  return apiRequest<Recommendations>(`/recommendations/${encodeURIComponent(customerPhone)}`, { signal });
}

/** unitCost is optional: leave it empty to get a suggestion from sales alone. */
export function evaluateDiscount(query: string, productId: number, unitCost = ""): Promise<DiscountSuggestion> {
  const cost = unitCost.trim();
  return apiRequest<DiscountSuggestion>(`/discount-suggestions?${query}`, {
    method: "POST",
    body: JSON.stringify(cost ? { product_id: productId, unit_cost: cost } : { product_id: productId }),
  });
}

export async function getOrders(): Promise<Order[]> {
  const records = await apiRequest<BackendOrder[]>("/orders");
  return records.map(normalizeOrder);
}

export async function getOrdersPage(query: URLSearchParams, signal?: AbortSignal): Promise<OrdersPageResponse> {
  const result = await apiRequest<{
    items: BackendOrder[];
    total: number;
    summary: OrdersPageResponse["summary"];
  }>(`/orders/page?${query.toString()}`, { signal });
  return { ...result, items: result.items.map(normalizeOrder) };
}

export async function getOrderDetail(orderId: number, signal?: AbortSignal): Promise<{ order: Order; items: OrderItem[] }> {
  const detail = await apiRequest<BackendOrderDetail>(`/orders/${orderId}`, { signal });
  return {
    order: normalizeOrder(detail),
    items: normalizeOrderItems(detail.order_id, detail.items ?? []),
  };
}

export async function getOrderItems(): Promise<OrderItem[]> {
  return apiRequest<OrderItem[]>("/order-items");
}

export async function uploadProductImage(file: File): Promise<{ image_url: string }> {
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    // Do not set Content-Type manually; the browser adds the multipart boundary.
    response = await fetch(`${API_BASE_URL}/products/images`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Cannot reach the PointNull API. Check that the backend is running.");
  }

  if (!response.ok) {
    let message = `Image upload failed (${response.status})`;
    try {
      const body = await response.json() as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the HTTP fallback message when the response is not JSON.
    }
    throw new Error(message);
  }

  const result = await response.json() as { image_url?: string };
  if (!result.image_url) throw new Error("The server did not return an image URL.");
  return { image_url: result.image_url };
}

export async function addProduct(input: NewProductInput): Promise<Product> {
  const product = await apiRequest<Product & { active?: boolean | number }>("/products", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalizeProduct(product);
}

export async function updateProduct(productId: number, input: NewProductInput): Promise<Product> {
  const product = await apiRequest<Product & { active?: boolean | number }>(`/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return normalizeProduct(product);
}

export async function setProductActive(productId: number, active: boolean): Promise<Product> {
  const product = await apiRequest<Product & { active?: boolean | number }>(`/products/${productId}/active`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
  return normalizeProduct(product);
}

export function addCustomer(input: Customer): Promise<Customer> {
  return apiRequest<Customer>("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCustomer(originalPhone: string, input: Customer): Promise<Customer> {
  return apiRequest<Customer>(`/customers/${encodeURIComponent(originalPhone)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteCustomer(phone: string): Promise<void> {
  await apiRequest<void>(`/customers/${encodeURIComponent(phone)}`, { method: "DELETE" });
}

export function validateCampaign(code: string, subtotal: number): Promise<CampaignValidation> {
  return apiRequest<CampaignValidation>("/campaigns/validate", {
    method: "POST",
    body: JSON.stringify({ promocode: code.trim().toUpperCase(), subtotal }),
  });
}

export async function saveOrder(lines: OrderLineInput[], details: CheckoutDetails = {}): Promise<SavedOrder> {
  if (!lines.length) throw new Error("An order must contain at least one item.");
  const created = await apiRequest<{ order_id: number }>("/orders", {
    method: "POST",
    body: JSON.stringify({
      items: lines.map(({ product_id, quantity }) => ({ product_id, quantity })),
      customer_phone: details.customer_phone ?? null,
      promocode: details.promocode ?? null,
    }),
  });
  const detail = await apiRequest<BackendOrderDetail>(`/orders/${created.order_id}`);
  return {
    order: normalizeOrder(detail),
    orderItems: normalizeOrderItems(detail.order_id, detail.items ?? []),
  };
}

export async function importData(input: ImportPayload): Promise<ImportResult> {
  return apiRequest<ImportResult>("/import", {
    method: "POST",
    body: JSON.stringify({
      categories: input.categories,
      products: input.products,
      customers: input.customers,
    }),
  });
}

/** Download the Analysis report as an Excel file and return its filename. */
export async function exportAnalytics(request: AnalyticsExportRequest): Promise<string> {
  const statistics = request.statistics ?? (await getStatistics(request.query));
  if (statistics.summary.orders === 0) {
    throw new Error("There are no sales to export for this selection.");
  }
  // The Excel code is only downloaded when someone actually exports.
  const { downloadAnalyticsReport } = await import("./analytics-export");
  return downloadAnalyticsReport(statistics, {
    scope: request.scope,
    categories: request.categories,
    filters: request.filters,
  });
}
