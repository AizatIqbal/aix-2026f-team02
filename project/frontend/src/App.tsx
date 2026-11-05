import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addProduct,
  exportAnalytics,
  getCategories,
  getOrderItems,
  getOrders,
  getProducts,
  saveOrder,
  type Category,
  type Order,
  type OrderItem,
  type Product,
  type ImportResult,
} from './data-access'
import { ImportWizard } from './import-wizard'
import { Button, CardButton, Icon, IconButton, Input, Surface } from './ui'

type WorkingTab = 'menu' | 'analysis'
type DatePreset = 'today' | '7d' | '30d' | 'all'

interface AppData {
  categories: Category[]
  products: Product[]
  orders: Order[]
  orderItems: OrderItem[]
}

interface Filters {
  preset: DatePreset
  days: string[]
  startTime: string
  endTime: string
  categories: number[]
}

const EMPTY_DATA: AppData = { categories: [], products: [], orders: [], orderItems: [] }
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const CURRENCY = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

function formatMoney(value: number): string {
  return CURRENCY.format(value)
}

function App() {
  const [tab, setTab] = useState<WorkingTab>('menu')
  const [data, setData] = useState<AppData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false)
  const [selection, setSelection] = useState<Record<number, number>>({})
  const [category, setCategory] = useState<number | 'all'>('all')
  const [clock, setClock] = useState(new Date())
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(false)
  const [productModalOpen, setProductModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [splashVisible, setSplashVisible] = useState(() => sessionStorage.getItem('pointnull-intro-seen') !== 'true')
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [splashMinimumElapsed, setSplashMinimumElapsed] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    Promise.all([
      getCategories(),
      getProducts(),
    ])
        .then(([categories, products]) => {
          setData((current) => ({
            ...current,
            categories,
            products,
          }))
        })
        .catch((caught) => {
          setError(
              caught instanceof Error
                  ? caught.message
                  : 'We could not load the database.',
          )
        })
        .finally(() => setLoading(false))
  }, [])
  // Keep the splash screen visible for at least 2.2 seconds
  useEffect(() => {
    if (!splashVisible) return

    const timer = window.setTimeout(() => {
      setSplashMinimumElapsed(true)
    }, 2200)

    return () => window.clearTimeout(timer)
  }, [splashVisible])

// Hide the splash screen after the initial data has loaded
  useEffect(() => {
    if (!splashVisible || !splashMinimumElapsed || loading) return

    setSplashLeaving(true)

    const timer = window.setTimeout(() => {
      sessionStorage.setItem('pointnull-intro-seen', 'true')
      setSplashVisible(false)
    }, 520)

    return () => window.clearTimeout(timer)
  }, [loading, splashMinimumElapsed, splashVisible])

  useEffect(() => {
    if (tab !== 'analysis' || analyticsLoaded) return

    let cancelled = false

    setAnalysisLoading(true)
    setError('')

    Promise.all([
      getOrders(),
      getOrderItems(),
    ])
        .then(([orders, orderItems]) => {
          if (cancelled) return

          setData((current) => ({
            ...current,
            orders,
            orderItems,
          }))

          setAnalyticsLoaded(true)
        })
        .catch((caught) => {
          if (cancelled) return

          setError(
              caught instanceof Error
                  ? caught.message
                  : 'We could not load sales data.',
          )
        })
        .finally(() => {
          if (!cancelled) {
            setAnalysisLoading(false)
          }
        })

    return () => {
      cancelled = true
    }
  }, [tab, analyticsLoaded])

  const selectedCount = Object.values(selection).reduce((sum, quantity) => sum + quantity, 0)
  const selectedTotal = data.products.reduce(
    (sum, product) => sum + product.price * (selection[product.product_id] ?? 0),
    0,
  )

  function updateQuantity(productId: number, delta: number): void {
    setSelection((current) => {
      const next = Math.max(0, (current[productId] ?? 0) + delta)
      if (next === 0) {
        const { [productId]: removed, ...rest } = current
        void removed
        return rest
      }
      return { ...current, [productId]: next }
    })
  }

  async function submitOrder(): Promise<void> {
    const lines = data.products
      .filter((product) => selection[product.product_id])
      .map((product) => ({
        product_id: product.product_id,
        quantity: selection[product.product_id],
        price: product.price,
      }))
    if (lines.length === 0) return

    setSaving(true)
    setError('')
    try {
      const saved = await saveOrder(lines)
      setData((current) => ({
        ...current,
        orders: [...current.orders, saved.order],
        orderItems: [...current.orderItems, ...saved.orderItems],
      }))
      setSelection({})
      setToast(`Order #${saved.order.order_id} saved`)
      setTab('analysis')
      window.setTimeout(() => setToast(''), 2800)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The order could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  function mergeImported(result: ImportResult): void {
    setData((current) => ({
      categories: [...current.categories, ...result.categories],
      products: [...current.products, ...result.products],
      orders: [...current.orders, ...result.orders],
      orderItems: [...current.orderItems, ...result.orderItems],
    }))
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Header clock={clock} tab={tab} onTabChange={setTab} onImport={() => setImportOpen(true)} />
      <main className="mx-auto w-full max-w-screen-2xl px-5 pb-28 pt-7 lg:px-8">
        {error && (
          <div className="mb-5 flex min-h-12 items-center rounded-xl border border-danger/20 bg-danger-soft px-4 text-sm font-medium text-danger">
            {error}
          </div>
        )}
        {tab === 'menu' ? (
          <Menu
            categories={data.categories}
            products={data.products}
            selectedCategory={category}
            selection={selection}
            loading={loading}
            onCategoryChange={setCategory}
            onQuantityChange={updateQuantity}
            onAddProduct={() => setProductModalOpen(true)}
          />
        ) : (
            <Analysis
                data={data}
                loading={loading || analysisLoading}
            />
        )}
      </main>
      {tab === 'menu' && (
        <SummaryBar
          itemCount={selectedCount}
          total={selectedTotal}
          saving={saving}
          onNext={submitOrder}
        />
      )}
      {toast && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl">
          <Icon name="check" className="size-5 text-accent-light" />
          {toast}
        </div>
      )}
      {productModalOpen && (
        <AddProductModal
          categories={data.categories}
          onClose={() => setProductModalOpen(false)}
          onSaved={(product) => {
            setData((current) => ({ ...current, products: [...current.products, product] }))
            setProductModalOpen(false)
            setToast(`${product.product_name} added to Sell`)
            window.setTimeout(() => setToast(''), 2800)
          }}
        />
      )}
      {importOpen && (
        <ImportWizard
          categories={data.categories}
          products={data.products}
          onClose={() => setImportOpen(false)}
          onImported={mergeImported}
        />
      )}
      {splashVisible && <StartupSplash leaving={splashLeaving} />}

    </div>
  )
}

function StartupSplash({ leaving }: { leaving: boolean }) {
  return (
      <div
          className={`startup-splash ${leaving ? 'startup-splash-leaving' : ''}`}
          role="status"
          aria-live="polite"
          aria-label="PointNull is loading"
      >
        <div className="splash-grid" aria-hidden="true" />
        <div className="splash-orbit splash-orbit-outer" aria-hidden="true" />
        <div className="splash-orbit splash-orbit-inner" aria-hidden="true" />

        <div className="splash-center">
          <div className="splash-mark-wrap">
            <div className="splash-pulse" aria-hidden="true" />
            <img
                src="/favicon.svg"
                alt=""
                className="splash-mark"
            />
            <div className="splash-scan" aria-hidden="true" />
          </div>

          <div className="splash-wordmark">PointNull</div>
          <div className="splash-message">Preparing your workspace</div>

          <div className="splash-progress" aria-hidden="true">
            <span />
          </div>
        </div>

        <div className="splash-status">
          <span /> SECURE DATA CONNECTION
        </div>
      </div>
  )
}

function Header({
  clock,
  tab,
  onTabChange,
  onImport,
}: {
  clock: Date
  tab: WorkingTab
  onTabChange: (tab: WorkingTab) => void
  onImport: () => void
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-18 max-w-screen-2xl items-center gap-6 px-5 lg:px-8">
        <div className="flex shrink-0 items-center gap-3">
          <img
              src="/favicon.svg"
              alt="PointNull"
              className="size-10 rounded-xl"
          />
          <div>
            <div className="font-display text-lg font-bold leading-tight">PointNull</div>
            <div className="text-xs font-medium text-ink-faint">Sales workspace</div>
          </div>
        </div>
        <nav aria-label="Primary" className="flex flex-1 items-center gap-1">
          <Button variant="ghost" onClick={() => onTabChange('menu')} className={tab === 'menu' ? 'bg-accent-soft text-accent-strong' : ''}>
            <span className="flex items-center gap-2"><Icon name="grid" /> Sell</span>
          </Button>
          <Button variant="ghost" onClick={() => onTabChange('analysis')} className={tab === 'analysis' ? 'bg-accent-soft text-accent-strong' : ''}>
            <span className="flex items-center gap-2"><Icon name="chart" /> Analysis</span>
          </Button>
          <Button variant="ghost" disabled title="Coming soon" className="hidden whitespace-nowrap lg:block">Customers</Button>
          <Button variant="ghost" disabled title="Coming soon" className="hidden whitespace-nowrap lg:block">Orders</Button>
        </nav>
        <Button variant="secondary" onClick={onImport} className="shrink-0 px-3 sm:px-4">
          <span className="hidden md:inline">Import data</span><span className="md:hidden">Import</span>
        </Button>
        <div className="hidden shrink-0 items-center gap-2 text-right md:flex">
          <Icon name="clock" className="size-5 text-accent" />
          <div>
            <div className="text-sm font-semibold">
              {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-xs text-ink-faint">
              {clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

function Menu({
  categories,
  products,
  selectedCategory,
  selection,
  loading,
  onCategoryChange,
  onQuantityChange,
  onAddProduct,
}: {
  categories: Category[]
  products: Product[]
  selectedCategory: number | 'all'
  selection: Record<number, number>
  loading: boolean
  onCategoryChange: (category: number | 'all') => void
  onQuantityChange: (productId: number, delta: number) => void
  onAddProduct: () => void
}) {
  const [feedbackProductId, setFeedbackProductId] = useState<number | null>(null)
  const visibleProducts = selectedCategory === 'all'
    ? products
    : products.filter((product) => product.category_id === selectedCategory)
  const categoryMap = new Map(categories.map((item) => [item.category_id, item.category_name]))

  function addProduct(productId: number): void {
    onQuantityChange(productId, 1)
    setFeedbackProductId(productId)
    window.setTimeout(() => {
      setFeedbackProductId((current) => current === productId ? null : current)
    }, 450)
  }

  return (
    <section>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-3xl font-bold tracking-tight">New sale</div>
          <div className="mt-1 text-sm text-ink-muted">Choose products for the current order.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink-muted shadow-sm sm:block">
            {products.length} items
          </div>
          <Button variant="primary" onClick={onAddProduct}>
            <span className="flex items-center gap-2"><Icon name="plus" /> Add product</span>
          </Button>
        </div>
      </div>
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        <Button variant={selectedCategory === 'all' ? 'primary' : 'chip'} onClick={() => onCategoryChange('all')}>All</Button>
        {categories.map((item) => (
          <Button key={item.category_id} variant={selectedCategory === item.category_id ? 'primary' : 'chip'} onClick={() => onCategoryChange(item.category_id)} className="whitespace-nowrap">
            {item.category_name}
          </Button>
        ))}
      </div>
      {loading ? (
        <LoadingGrid />
      ) : visibleProducts.length === 0 ? (
        <EmptyState title="No menu items to show" message="Products from the connected database will appear here." />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {visibleProducts.map((product) => {
            const quantity = selection[product.product_id] ?? 0
            return (
              <Surface key={product.product_id} className="group relative overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
                <CardButton onClick={() => addProduct(product.product_id)}>
                  <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-product text-4xl font-black text-accent/25">
                    {product.image_url ? <img className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105" src={product.image_url} alt="" /> : <><span className="absolute size-24 rounded-full border-[18px] border-white/35 transition-transform group-hover:scale-110" /><span className="relative">{product.product_name.slice(0, 1).toUpperCase()}</span></>}
                    <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-ink-muted shadow-sm">
                      {categoryMap.get(product.category_id) ?? 'Uncategorized'}
                    </span>
                    <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-bold text-white transition ${feedbackProductId === product.product_id ? 'bg-accent/70 opacity-100' : 'bg-accent/0 opacity-0'}`}>+1</span>
                  </div>
                  <div className="p-3.5">
                    <div className="min-h-10 font-display text-sm font-bold leading-snug">{product.product_name}</div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-lg font-extrabold text-ink">{formatMoney(product.price)}</div>
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-accent-strong"><span className="size-1.5 rounded-full bg-accent" /> In stock</div>
                    </div>
                    <div className="mt-2 text-[10px] font-medium text-ink-faint">Item #{String(product.product_id).padStart(3, '0')} · Tap to add</div>
                  </div>
                </CardButton>
                {quantity > 0 && (
                    <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-xl bg-ink p-1 text-white shadow-lg">
                      <IconButton
                          label={`Remove one ${product.product_name}`}
                          className="size-9 min-h-0 rounded-lg border-0 !bg-transparent !text-white hover:!bg-white/15"
                          onClick={() => onQuantityChange(product.product_id, -1)}
                      >
                        <Icon name="minus" className="size-4 shrink-0" />
                      </IconButton>

                      <div className="min-w-7 text-center text-sm font-bold tabular-nums">
                        {quantity}
                      </div>

                      <IconButton
                          label={`Add one ${product.product_name}`}
                          className="size-9 min-h-0 rounded-lg border-0 !bg-transparent !text-white hover:!bg-white/15"
                          onClick={() => onQuantityChange(product.product_id, 1)}
                      >
                        <Icon name="plus" className="size-4 shrink-0" />
                      </IconButton>
                    </div>
                )}
              </Surface>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AddProductModal({
  categories,
  onClose,
  onSaved,
}: {
  categories: Category[]
  onClose: () => void
  onSaved: (product: Product) => void
}) {
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [splashVisible, setSplashVisible] = useState(
      () => sessionStorage.getItem('pointnull-intro-seen') !== 'true'
  )
  const [splashLeaving, setSplashLeaving] = useState(false)
  const [splashMinimumElapsed, setSplashMinimumElapsed] = useState(false)

  function readImage(file?: File): void {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose a valid image file.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImageUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const numericPrice = Number(price)
    if (!name.trim() || !categoryId || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Enter a product name, category, and valid price.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const product = await addProduct({
        product_name: name.trim(),
        category_id: Number(categoryId),
        price: numericPrice,
        image_url: imageUrl || undefined,
      })
      onSaved(product)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The product could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-5 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-line px-6 py-5">
          <div><div className="text-xs font-bold uppercase tracking-widest text-accent">Sell setup</div><h2 id="product-modal-title" className="mt-1 font-display text-2xl font-bold">Add product</h2></div>
          <button className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong" onClick={onClose} aria-label="Close product form">×</button>
        </header>
        <form onSubmit={(event) => void submit(event)} className="p-6">
          {error && <div className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>}
          <div className="space-y-4">
            <label className="block text-sm font-semibold">Product name <span className="text-danger">*</span><Input className="mt-2 w-full" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Flat White" autoFocus required /></label>
            <label className="block text-sm font-semibold">Category <span className="text-danger">*</span><select className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="">Choose a category</option>{categories.map((item) => <option key={item.category_id} value={item.category_id}>{item.category_name}</option>)}</select></label>
            <label className="block text-sm font-semibold">Price <span className="text-danger">*</span><div className="relative mt-2"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">₩</span><Input className="w-full pl-7" type="number" min="1" step="1" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0" required /></div></label>
            <label className="block text-sm font-semibold">Product image <span className="font-normal text-ink-faint">(optional)</span><div className="mt-2 flex items-center gap-4 rounded-xl border border-dashed border-line p-3">{imageUrl ? <img className="size-16 rounded-xl object-cover" src={imageUrl} alt="Product preview" /> : <div className="flex size-16 items-center justify-center rounded-xl bg-product text-xs font-bold text-accent">IMAGE</div>}<div><input className="block max-w-full text-xs text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:font-semibold file:text-accent-strong" type="file" accept="image/*" onChange={(event) => readImage(event.target.files?.[0])} /><p className="mt-2 text-[11px] text-ink-faint">PNG or JPG recommended</p></div></div></label>
          </div>
          <div className="mt-7 flex justify-end gap-3"><Button type="button" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</Button></div>
        </form>
      </section>
    </div>
  )
}

function SummaryBar({ itemCount, total, saving, onNext }: { itemCount: number; total: number; saving: boolean; onNext: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-5 py-3 shadow-bar backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-5">
          <div className="hidden size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong sm:flex"><Icon name="grid" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><div className="text-xs font-bold uppercase tracking-wide text-ink">Current order</div><span className="rounded-full bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-ink-muted">Draft</span></div>
            <div className="mt-0.5 truncate text-xs text-ink-faint">{itemCount === 0 ? 'No products added yet' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'} ready for checkout`}</div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right"><div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Order total</div><div className="font-display text-2xl font-extrabold">{formatMoney(total)}</div></div>
          <Button variant="primary" disabled={itemCount === 0 || saving} onClick={onNext} className="min-w-36">
            <span className="flex items-center justify-center gap-2">{saving ? 'Completing…' : 'Complete sale'} <Icon name="arrow" /></span>
          </Button>
        </div>
      </div>
    </div>
  )
}

function Analysis({ data, loading }: { data: AppData; loading: boolean }) {
  const [filters, setFilters] = useState<Filters>({ preset: '30d', days: [], startTime: '00:00', endTime: '23:59', categories: [] })
  const [exportOpen, setExportOpen] = useState(false)
  const [exportStatus, setExportStatus] = useState<{ state: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ state: 'idle' })
  const productMap = useMemo(() => new Map(data.products.map((product) => [product.product_id, product])), [data.products])

  const filteredOrders = useMemo(() => {
    const now = new Date()
    const start = new Date(now)
    if (filters.preset === 'today') start.setHours(0, 0, 0, 0)
    if (filters.preset === '7d') start.setDate(now.getDate() - 6)
    if (filters.preset === '30d') start.setDate(now.getDate() - 29)
    const allowedOrderIdsByCategory = new Set(
      data.orderItems.filter((item) => {
        const product = productMap.get(item.product_id)
        return filters.categories.length === 0 || (product && filters.categories.includes(product.category_id))
      }).map((item) => item.order_id),
    )
    return data.orders.filter((order) => {
      const orderDate = new Date(`${order.order_date}T${order.order_time}`)
      const dateMatches = filters.preset === 'all' || orderDate >= start
      const dayMatches = filters.days.length === 0 || filters.days.includes(order.day_of_week)
      const timeMatches = order.order_time.slice(0, 5) >= filters.startTime && order.order_time.slice(0, 5) <= filters.endTime
      const categoryMatches = filters.categories.length === 0 || allowedOrderIdsByCategory.has(order.order_id)
      return dateMatches && dayMatches && timeMatches && categoryMatches
    })
  }, [data.orderItems, data.orders, filters, productMap])

  const orderIds = useMemo(() => new Set(filteredOrders.map((order) => order.order_id)), [filteredOrders])
  const filteredItems = data.orderItems.filter((item) => {
    const product = productMap.get(item.product_id)
    return orderIds.has(item.order_id) && (filters.categories.length === 0 || Boolean(product && filters.categories.includes(product.category_id)))
  })

  const revenue = filteredOrders.reduce(
      (sum, order) => sum + order.total,
      0
  )
  const itemCount = filteredItems.reduce((sum, item) => sum + item.quantity, 0)
  const quantities = new Map<number, number>()
  filteredItems.forEach((item) => quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity))
  const topProductId = [...quantities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

  function toggleDay(day: string): void {
    setFilters((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((value) => value !== day) : [...current.days, day] }))
  }

  function toggleCategory(categoryId: number): void {
    setFilters((current) => ({ ...current, categories: current.categories.includes(categoryId) ? current.categories.filter((value) => value !== categoryId) : [...current.categories, categoryId] }))
  }

  const resetFilters = (): void => setFilters({ preset: '30d', days: [], startTime: '00:00', endTime: '23:59', categories: [] })

  async function downloadReport(scope: 'current' | 'full'): Promise<void> {
    setExportStatus({ state: 'loading', message: scope === 'current' ? 'Preparing current view…' : 'Preparing full report…' })
    try {
      const filename = await exportAnalytics({ scope, filters: scope === 'current' ? filters : undefined })
      setExportOpen(false)
      setExportStatus({ state: 'success', message: `${filename} downloaded` })
      window.setTimeout(() => setExportStatus({ state: 'idle' }), 3500)
    } catch (caught) {
      setExportStatus({ state: 'error', message: caught instanceof Error ? caught.message : 'Export failed. Please try again.' })
    }
  }

  if (loading) return <LoadingAnalysis />

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><div className="font-display text-3xl font-bold tracking-tight">Analysis</div><div className="mt-1 text-sm text-ink-muted">A live view of sales performance.</div></div>
      </div>
      <Surface className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <FilterGroup label="Date range">
            <div className="flex gap-1 rounded-xl bg-surface-strong p-1">
              {(['today', '7d', '30d', 'all'] as DatePreset[]).map((preset) => (
                <Button key={preset} variant="ghost" onClick={() => setFilters((current) => ({ ...current, preset }))} className={`min-h-9 px-3 ${filters.preset === preset ? 'bg-white text-accent-strong shadow-sm' : ''}`}>
                  {preset === 'today' ? 'Today' : preset === 'all' ? 'All' : preset}
                </Button>
              ))}
            </div>
          </FilterGroup>
          <FilterGroup label="Time of day">
            <div className="flex items-center gap-2"><Input type="time" value={filters.startTime} onChange={(event) => setFilters((current) => ({ ...current, startTime: event.target.value }))} /><span className="text-ink-faint">to</span><Input type="time" value={filters.endTime} onChange={(event) => setFilters((current) => ({ ...current, endTime: event.target.value }))} /></div>
          </FilterGroup>
          <FilterGroup label="Day of week">
            <div className="flex flex-wrap gap-1">{DAYS.map((day) => <Button key={day} variant="chip" onClick={() => toggleDay(day)} className={`min-h-9 px-3 ${filters.days.includes(day) ? 'border-accent bg-accent-soft text-accent-strong' : ''}`}>{day.slice(0, 3)}</Button>)}</div>
          </FilterGroup>
          {data.categories.length > 0 && <FilterGroup label="Category"><div className="flex flex-wrap gap-1">{data.categories.map((item) => <Button key={item.category_id} variant="chip" onClick={() => toggleCategory(item.category_id)} className={`min-h-9 px-3 ${filters.categories.includes(item.category_id) ? 'border-accent bg-accent-soft text-accent-strong' : ''}`}>{item.category_name}</Button>)}</div></FilterGroup>}
          <Button variant="ghost" onClick={resetFilters}><span className="flex items-center gap-2"><Icon name="reset" /> Reset</span></Button>
          <div className="ml-auto rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong">{filteredOrders.length} matching orders</div>
          <div className="relative">
            <Button
              variant="secondary"
              onClick={() => setExportOpen((current) => !current)}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              disabled={exportStatus.state === 'loading'}
            >
              <span className="flex items-center gap-2"><Icon name="download" />{exportStatus.state === 'loading' ? 'Exporting…' : 'Export Excel'}<Icon name="chevron" className="size-4" /></span>
            </Button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-2xl border border-line bg-white p-2 shadow-xl">
                <button role="menuitem" className="w-full rounded-xl p-3 text-left hover:bg-surface-strong" onClick={() => void downloadReport('current')}>
                  <span className="flex items-start gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name="download" /></span><span><strong className="block text-sm">Export Current View</strong><small className="mt-1 block leading-5 text-ink-muted">Uses the selected date range, days, times, and categories.</small></span></span>
                </button>
                <button role="menuitem" className="w-full rounded-xl p-3 text-left hover:bg-surface-strong" onClick={() => void downloadReport('full')}>
                  <span className="flex items-start gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-strong text-ink-muted"><Icon name="chart" /></span><span><strong className="block text-sm">Export Full Report</strong><small className="mt-1 block leading-5 text-ink-muted">Downloads all available analytics without active filters.</small></span></span>
                </button>
              </div>
            )}
            {exportStatus.state !== 'idle' && exportStatus.state !== 'loading' && (
              <div role="status" className={`absolute right-0 top-[calc(100%+0.5rem)] z-20 w-72 rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg ${exportStatus.state === 'success' ? 'border-accent/20 bg-accent-soft text-accent-strong' : 'border-danger/20 bg-danger-soft text-danger'}`}>
                {exportStatus.message}
              </div>
            )}
          </div>
        </div>
      </Surface>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Total revenue" value={formatMoney(revenue)} />
        <Kpi label="Orders" value={String(filteredOrders.length)} />
        <Kpi label="Average order value" value={formatMoney(filteredOrders.length ? revenue / filteredOrders.length : 0)} />
        <Kpi label="Items sold" value={String(itemCount)} />
        <Kpi label="Top product" value={topProductId ? productMap.get(topProductId)?.product_name ?? '—' : '—'} />
      </div>
      {filteredOrders.length === 0 ? (
        <EmptyState title="No sales match these filters" message="Adjust the filters or complete a new sale to see analytics." />
      ) : (
        <ChartGrid orders={filteredOrders} items={filteredItems} products={data.products} categories={data.categories} />
      )}
    </section>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div>{children}</div>
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <Surface className="p-5"><div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div><div className="mt-2 truncate font-display text-2xl font-bold" title={value}>{value}</div></Surface>
}

function ChartGrid({ orders, items, products, categories }: { orders: Order[]; items: OrderItem[]; products: Product[]; categories: Category[] }) {
  const productMap = new Map(products.map((product) => [product.product_id, product]))
  const byDate = groupValues(orders, (order) => order.order_date, (order) => order.total)
  const byHour = groupValues(orders, (order) => order.order_time.slice(0, 2), (order) => order.total)
  const byDay = DAYS.map((day) => ({ label: day.slice(0, 3), value: orders.filter((order) => order.day_of_week === day).reduce((sum, order) => sum + order.total, 0) }))
  const byCategory = categories.map((category) => ({
    label: category.category_name,
    value: items.filter((item) => productMap.get(item.product_id)?.category_id === category.category_id).reduce((sum, item) => sum + item.quantity * item.price, 0),
  })).filter((item) => item.value > 0)
  const topProducts = products.map((product) => ({
    label: product.product_name,
    value: items.filter((item) => item.product_id === product.product_id).reduce((sum, item) => sum + item.quantity, 0),
  })).filter((item) => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 10)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <LineChart title="Revenue over time" data={byDate} />
      <BarChart title="Revenue by hour" data={byHour} valueFormatter={formatMoney} />
      <BarChart title="Revenue by day of week" data={byDay} valueFormatter={formatMoney} />
      <BarChart title="Sales by category" data={byCategory} valueFormatter={formatMoney} />
      <div className="lg:col-span-2"><BarChart title="Top 10 products by quantity" data={topProducts} valueFormatter={(value) => String(value)} horizontal /></div>
    </div>
  )
}

interface ChartDatum { label: string; value: number }
function groupValues<T>(values: T[], label: (item: T) => string, value: (item: T) => number): ChartDatum[] {
  const grouped = new Map<string, number>()
  values.forEach((item) => grouped.set(label(item), (grouped.get(label(item)) ?? 0) + value(item)))
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([itemLabel, itemValue]) => ({ label: itemLabel, value: itemValue }))
}

function LineChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const max = Math.max(...data.map((item) => item.value), 1)
  const points = data.map((item, index) => `${data.length === 1 ? 50 : (index / (data.length - 1)) * 100},${90 - (item.value / max) * 72}`).join(' ')
  return (
    <Surface className="p-5">
      <div className="mb-5 font-display text-lg font-bold">{title}</div>
      <div className="h-56 text-accent">
        <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0 90H100" className="stroke-line" />
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          {data.map((item, index) => <circle key={item.label} cx={data.length === 1 ? 50 : (index / (data.length - 1)) * 100} cy={90 - (item.value / max) * 72} r="1.3" fill="currentColor" vectorEffect="non-scaling-stroke" />)}
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-faint"><span>{data[0]?.label}</span><span>{data.at(-1)?.label}</span></div>
    </Surface>
  )
}

function BarChart({ title, data, valueFormatter, horizontal = false }: { title: string; data: ChartDatum[]; valueFormatter: (value: number) => string; horizontal?: boolean }) {
  const max = Math.max(...data.map((item) => item.value), 1)
  return (
    <Surface className="p-5">
      <div className="mb-5 font-display text-lg font-bold">{title}</div>
      <div className={horizontal ? 'space-y-3' : 'flex h-56 items-end gap-2'}>
        {data.map((item) => horizontal ? (
          <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_3fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-ink-muted">{item.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-surface-strong"><div className="h-full rounded-full bg-accent" style={{ width: `${(item.value / max) * 100}%` }} /></div>
            <span className="font-semibold">{valueFormatter(item.value)}</span>
          </div>
        ) : (
          <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <span className="text-xs font-semibold">{valueFormatter(item.value)}</span>
            <div className="min-h-1 w-full rounded-t-lg bg-accent" style={{ height: `${Math.max(2.5, (item.value / max) * 100)}%` }} />
            <span className="max-w-full truncate text-xs text-ink-faint">{item.label}</span>
          </div>
        ))}
      </div>
    </Surface>
  )
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <Surface className="flex min-h-72 flex-col items-center justify-center p-8 text-center"><div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Icon name="chart" className="size-7" /></div><div className="font-display text-xl font-bold">{title}</div><div className="mt-2 max-w-md text-sm leading-6 text-ink-muted">{message}</div></Surface>
}

function LoadingGrid() {
  return <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }, (_, index) => <div key={index} className="aspect-[4/3] animate-pulse rounded-2xl bg-surface-strong" />)}</div>
}

function LoadingAnalysis() {
  return <div className="space-y-5"><div className="h-10 w-48 animate-pulse rounded-xl bg-surface-strong" /><div className="h-36 animate-pulse rounded-2xl bg-surface-strong" /><div className="grid grid-cols-5 gap-3">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-surface-strong" />)}</div></div>
}

export default App
