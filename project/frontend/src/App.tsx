import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type PointerEvent } from "react";
import {
  addProduct,
  exportAnalytics,
  getCategories,
  getStatistics,
  getOrders,
  getProducts,
  setProductActive,
  updateProduct,
  uploadProductImage,
  resolveAssetUrl,
  type Category,
  type Order,
  type Statistics,
  type Product,
  type ImportResult,
  type StatisticsGroup,
} from "./data-access";
import { ImportWizard } from "./import-wizard";
import { Button, CardButton, Icon, IconButton, Input, Surface } from "./ui";
import { MarketingAnalysis, SalesBreakdowns } from "./analytics-details";
import { CustomersPage } from "./customers-page";
import { OrdersPage } from "./orders-page";
import { CheckoutModal } from "./checkout-modal";

type WorkingTab = "menu" | "analysis" | "customers" | "orders";
type DatePreset = "today" | "7d" | "30d" | "all";

interface AppData {
  categories: Category[];
  products: Product[];
  orders: Order[];
}

interface Filters {
  preset: DatePreset;
  group: StatisticsGroup;
  days: string[];
  startTime: string;
  endTime: string;
  categories: number[];
}

const EMPTY_DATA: AppData = { categories: [], products: [], orders: [] };
const DEFAULT_FILTERS: Filters = {
  preset: "30d",
  group: "day",
  days: [],
  startTime: "00:00",
  endTime: "23:59",
  categories: [],
};
const GROUP_LABELS: Record<StatisticsGroup, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CURRENCY = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

function formatMoney(value: number): string {
  return CURRENCY.format(value);
}

function App() {
  const [tab, setTab] = useState<WorkingTab>("menu");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [selection, setSelection] = useState<Record<number, number>>({});
  const [category, setCategory] = useState<number | "all">("all");
  const [clock, setClock] = useState(new Date());
  const [toast, setToast] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<Product | null>(null);
  const [managementMode, setManagementMode] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [splashVisible, setSplashVisible] = useState(
    () => sessionStorage.getItem("pointnull-intro-seen") !== "true",
  );
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashMinimumElapsed, setSplashMinimumElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([getCategories(), getProducts()])
      .then(([categories, products]) => {
        setData((current) => ({
          ...current,
          categories,
          products,
        }));
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "We could not load the database.");
      })
      .finally(() => setLoading(false));
  }, []);
  // Keep the splash screen visible for at least 2.2 seconds
  useEffect(() => {
    if (!splashVisible) return;

    const timer = window.setTimeout(() => {
      setSplashMinimumElapsed(true);
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [splashVisible]);

  // Hide the splash screen after the initial data has loaded
  useEffect(() => {
    if (!splashVisible || !splashMinimumElapsed || loading) return;

    setSplashLeaving(true);

    const timer = window.setTimeout(() => {
      sessionStorage.setItem("pointnull-intro-seen", "true");
      setSplashVisible(false);
    }, 520);

    return () => window.clearTimeout(timer);
  }, [loading, splashMinimumElapsed, splashVisible]);

  useEffect(() => {
    if (tab !== "analysis" || analyticsLoaded) return;

    let cancelled = false;

    setAnalysisLoading(true);
    setError("");

    getOrders()
      .then((orders) => {
        if (cancelled) return;

        setData((current) => ({
          ...current,
          orders,
        }));

        setAnalyticsLoaded(true);
      })
      .catch((caught) => {
        if (cancelled) return;

        setError(caught instanceof Error ? caught.message : "We could not load sales data.");
      })
      .finally(() => {
        if (!cancelled) {
          setAnalysisLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tab, analyticsLoaded]);

  const selectedCount = Object.values(selection).reduce((sum, quantity) => sum + quantity, 0);
  const selectedTotal = data.products.reduce(
    (sum, product) => sum + product.price * (selection[product.product_id] ?? 0),
    0,
  );

  function updateQuantity(productId: number, delta: number): void {
    setSelection((current) => {
      const next = Math.max(0, (current[productId] ?? 0) + delta);
      if (next === 0) {
        const { [productId]: removed, ...rest } = current;
        void removed;
        return rest;
      }
      return { ...current, [productId]: next };
    });
  }

  function mergeImported(result: ImportResult): void {
    setData((current) => ({
      categories: [...current.categories, ...result.categories],
      products: [...current.products, ...result.products],
      orders: [...current.orders, ...result.orders],
    }));
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
        {tab === "menu" ? (
          <Menu
            categories={data.categories}
            products={data.products}
            selectedCategory={category}
            selection={selection}
            loading={loading}
            onCategoryChange={setCategory}
            onQuantityChange={updateQuantity}
            managementMode={managementMode}
            onManagementModeChange={setManagementMode}
            onAddProduct={() => {
              setEditingProduct(null);
              setProductModalOpen(true);
            }}
            onEditProduct={(product) => {
              setEditingProduct(product);
              setProductModalOpen(true);
            }}
            onDeactivateProduct={setPendingDeactivation}
            onReactivateProduct={(product) => {
              void setProductActive(product.product_id, true)
                .then((updated) => {
                  setData((current) => ({
                    ...current,
                    products: current.products.map((record) =>
                      record.product_id === updated.product_id ? updated : record,
                    ),
                  }));
                  setToast(`${updated.product_name} is available for sale`);
                  window.setTimeout(() => setToast(""), 2800);
                })
                .catch((caught) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "The product could not be activated.",
                  ),
                );
            }}
          />
        ) : tab === "analysis" ? (
          <Analysis data={data} loading={loading || analysisLoading} />
        ) : tab === "customers" ? (
          <CustomersPage />
        ) : (
          <OrdersPage />
        )}
      </main>
      {tab === "menu" && !managementMode && (
        <SummaryBar
          itemCount={selectedCount}
          total={selectedTotal}
          onNext={() => setCheckoutOpen(true)}
        />
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl"
        >
          <Icon name="check" className="size-5 text-accent-light" />
          {toast}
        </div>
      )}
      {productModalOpen && (
        <ProductFormModal
          categories={data.categories}
          product={editingProduct}
          onClose={() => {
            setProductModalOpen(false);
            setEditingProduct(null);
          }}
          onSaved={(product) => {
            setData((current) => ({
              ...current,
              products: editingProduct
                ? current.products.map((record) =>
                    record.product_id === product.product_id ? product : record,
                  )
                : [...current.products, product],
            }));
            setProductModalOpen(false);
            setToast(
              editingProduct
                ? `${product.product_name} updated`
                : `${product.product_name} added to Sell`,
            );
            setEditingProduct(null);
            window.setTimeout(() => setToast(""), 2800);
          }}
        />
      )}
      {pendingDeactivation && (
        <DeactivateProductDialog
          product={pendingDeactivation}
          onClose={() => setPendingDeactivation(null)}
          onConfirm={() => {
            const product = pendingDeactivation;
            void setProductActive(product.product_id, false)
              .then((updated) => {
                setData((current) => ({
                  ...current,
                  products: current.products.map((record) =>
                    record.product_id === updated.product_id ? updated : record,
                  ),
                }));
                setSelection((current) => {
                  const { [updated.product_id]: removed, ...rest } = current;
                  void removed;
                  return rest;
                });
                setPendingDeactivation(null);
                setToast(`${updated.product_name} deactivated`);
                window.setTimeout(() => setToast(""), 2800);
              })
              .catch((caught) => {
                setPendingDeactivation(null);
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "The product could not be deactivated.",
                );
              });
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
      {checkoutOpen && (
        <CheckoutModal
          products={data.products}
          selection={selection}
          onClose={() => setCheckoutOpen(false)}
          onSaved={(saved) => {
            setData((current) => ({
              ...current,
              orders: [...current.orders, saved.order],
            }));
            setSelection({});
            setAnalyticsLoaded(false);
          }}
          onDone={(saved) => {
            setCheckoutOpen(false);
            setToast(`Order #${saved.order.order_id} completed`);
            window.setTimeout(() => setToast(""), 2800);
          }}
        />
      )}
      {splashVisible && <StartupSplash leaving={splashLeaving} />}
    </div>
  );
}

function StartupSplash({ leaving }: { leaving: boolean }) {
  return (
    <div
      className={`startup-splash ${leaving ? "startup-splash-leaving" : ""}`}
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
          <img src="/pointnull-mark.svg" alt="" className="splash-mark" />
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
  );
}

function Header({
  clock,
  tab,
  onTabChange,
  onImport,
}: {
  clock: Date;
  tab: WorkingTab;
  onTabChange: (tab: WorkingTab) => void;
  onImport: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-18 max-w-screen-2xl items-center gap-2 px-3 sm:px-5 lg:gap-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-3">
          <img src="/pointnull-mark.svg" alt="PointNull" className="size-10 rounded-xl" />
          <div className="hidden sm:block">
            <div className="font-display text-lg font-bold leading-tight">PointNull</div>
            <div className="text-xs font-medium text-ink-faint">Sales workspace</div>
          </div>
        </div>
        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        >
          <Button
            variant="ghost"
            onClick={() => onTabChange("menu")}
            className={tab === "menu" ? "bg-accent-soft text-accent-strong" : ""}
          >
            <span className="flex items-center gap-2">
              <Icon name="grid" /> Sell
            </span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onTabChange("analysis")}
            className={tab === "analysis" ? "bg-accent-soft text-accent-strong" : ""}
          >
            <span className="flex items-center gap-2">
              <Icon name="chart" /> Analysis
            </span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onTabChange("customers")}
            className={tab === "customers" ? "bg-accent-soft text-accent-strong" : ""}
          >
            <span className="flex items-center gap-2">
              <Icon name="users" /> Customers
            </span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onTabChange("orders")}
            className={`shrink-0 whitespace-nowrap ${
              tab === "orders" ? "bg-accent-soft text-accent-strong" : ""
            }`}
          >
            Orders
          </Button>
        </nav>
        <Button variant="secondary" onClick={onImport} className="shrink-0 px-3 sm:px-4">
          <span className="hidden md:inline">Import data</span>
          <span className="md:hidden">Import</span>
        </Button>
        <div className="hidden shrink-0 items-center gap-2 text-right md:flex">
          <Icon name="clock" className="size-5 text-accent" />
          <div>
            <div className="text-sm font-semibold">
              {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-xs text-ink-faint">
              {clock.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Menu({
  categories,
  products,
  selectedCategory,
  selection,
  loading,
  managementMode,
  onCategoryChange,
  onQuantityChange,
  onManagementModeChange,
  onAddProduct,
  onEditProduct,
  onDeactivateProduct,
  onReactivateProduct,
}: {
  categories: Category[];
  products: Product[];
  selectedCategory: number | "all";
  selection: Record<number, number>;
  loading: boolean;
  managementMode: boolean;
  onCategoryChange: (category: number | "all") => void;
  onQuantityChange: (productId: number, delta: number) => void;
  onManagementModeChange: (enabled: boolean) => void;
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
  onDeactivateProduct: (product: Product) => void;
  onReactivateProduct: (product: Product) => void;
}) {
  const [feedbackProductId, setFeedbackProductId] = useState<number | null>(null);
  const availableProducts = managementMode
    ? products
    : products.filter((product) => product.active !== false);
  const visibleProducts =
    selectedCategory === "all"
      ? availableProducts
      : availableProducts.filter((product) => product.category_id === selectedCategory);
  const categoryMap = new Map(categories.map((item) => [item.category_id, item.category_name]));

  function addProduct(productId: number): void {
    if (managementMode) return;
    onQuantityChange(productId, 1);
    setFeedbackProductId(productId);
    window.setTimeout(() => {
      setFeedbackProductId((current) => (current === productId ? null : current));
    }, 450);
  }

  return (
    <section>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-3xl font-bold tracking-tight">
            {managementMode ? "Manage products" : "New sale"}
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {managementMode
              ? "Edit menu information and control product availability."
              : "Choose products for the current order."}
          </div>
        </div>
        <div className="hidden rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink-muted shadow-sm sm:block">
          {availableProducts.length} {managementMode ? "total items" : "available items"}
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          <Button
            variant={selectedCategory === "all" ? "primary" : "chip"}
            onClick={() => onCategoryChange("all")}
          >
            All
          </Button>
          {categories.map((item) => (
            <Button
              key={item.category_id}
              variant={selectedCategory === item.category_id ? "primary" : "chip"}
              onClick={() => onCategoryChange(item.category_id)}
              className="whitespace-nowrap"
            >
              {item.category_name}
            </Button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant={managementMode ? "primary" : "secondary"}
            onClick={() => onManagementModeChange(!managementMode)}
            aria-pressed={managementMode}
          >
            {managementMode ? "Done managing" : "Manage Products"}
          </Button>
          {managementMode && (
            <Button variant="primary" onClick={onAddProduct}>
              <span className="flex items-center gap-2">
                <Icon name="plus" /> Add product
              </span>
            </Button>
          )}
        </div>
      </div>
      {loading ? (
        <LoadingGrid />
      ) : visibleProducts.length === 0 ? (
        <EmptyState
          title="No menu items to show"
          message="Products from the connected database will appear here."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {visibleProducts.map((product) => {
            const quantity = selection[product.product_id] ?? 0;
            const inactive = product.active === false;
            return (
              <Surface
                key={product.product_id}
                className={`group relative overflow-hidden transition ${
                  inactive ? "bg-surface-strong/40" : "hover:-translate-y-0.5 hover:shadow-lg"
                }`}
              >
                <CardButton
                  disabled={managementMode || inactive}
                  onClick={() => addProduct(product.product_id)}
                  className={inactive ? "opacity-65" : ""}
                >
                  <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-product text-4xl font-black text-accent/25">
                    {product.image_url ? (
                      <img
                        className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
                        src={resolveAssetUrl(product.image_url)}
                        alt=""
                      />
                    ) : (
                      <>
                        <span className="absolute size-24 rounded-full border-[18px] border-white/35 transition-transform group-hover:scale-110" />
                        <span className="relative">
                          {product.product_name.slice(0, 1).toUpperCase()}
                        </span>
                      </>
                    )}
                    <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-ink-muted shadow-sm">
                      {categoryMap.get(product.category_id) ?? "Uncategorized"}
                    </span>
                    {inactive && (
                      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-ink px-2 py-1 text-[10px] font-bold text-white shadow-sm">
                        Inactive
                      </span>
                    )}
                    <span
                      className={`pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-bold text-white transition ${feedbackProductId === product.product_id ? "bg-accent/70 opacity-100" : "bg-accent/0 opacity-0"}`}
                    >
                      +1
                    </span>
                  </div>
                  <div className="p-3.5">
                    <div className="min-h-10 font-display text-sm font-bold leading-snug">
                      {product.product_name}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-lg font-extrabold text-ink">
                        {formatMoney(product.price)}
                      </div>
                      <div
                        className={`flex items-center gap-1 text-[10px] font-semibold ${
                          inactive ? "text-ink-faint" : "text-accent-strong"
                        }`}
                      >
                        <span
                          className={`size-1.5 rounded-full ${
                            inactive ? "bg-ink-faint" : "bg-accent"
                          }`}
                        />{" "}
                        {inactive ? "Not for sale" : "Available"}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] font-medium text-ink-faint">
                      Item #{String(product.product_id).padStart(3, "0")} ·{" "}
                      {managementMode ? "Management mode" : "Tap to add"}
                    </div>
                  </div>
                </CardButton>
                {managementMode && (
                  <div className="flex gap-2 border-t border-line bg-white p-3">
                    <Button className="min-h-9 flex-1 px-3" onClick={() => onEditProduct(product)}>
                      Edit
                    </Button>
                    <Button
                      className={`min-h-9 flex-1 px-3 ${
                        inactive
                          ? "border-accent/30 text-accent-strong"
                          : "border-danger/25 text-danger hover:bg-danger-soft"
                      }`}
                      onClick={() =>
                        inactive ? onReactivateProduct(product) : onDeactivateProduct(product)
                      }
                    >
                      {inactive ? "Reactivate" : "Deactivate"}
                    </Button>
                  </div>
                )}
                {!managementMode && quantity > 0 && (
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
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProductFormModal({
  categories,
  product,
  onClose,
  onSaved,
}: {
  categories: Category[];
  product: Product | null;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  const [name, setName] = useState(product?.product_name ?? "");
  const [categoryId, setCategoryId] = useState(product?.category_id.toString() ?? "");
  const [price, setPrice] = useState(product?.price.toString() ?? "");
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [localImagePreview, setLocalImagePreview] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!imageFile) {
      setLocalImagePreview("");
      return;
    }
    const previewUrl = URL.createObjectURL(imageFile);
    setLocalImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile]);

  function selectProductImage(event: ChangeEvent<HTMLInputElement>): void {
    const selectedFile = event.currentTarget.files?.[0];
    if (!selectedFile) return;

    const extension = selectedFile.name.toLowerCase().split(".").pop();
    if (!["png", "jpg", "jpeg"].includes(extension ?? "")) {
      setImageFile(null);
      setError("Choose a PNG or JPEG image.");
      event.currentTarget.value = "";
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setImageFile(null);
      setError("Image must be 5 MB or smaller.");
      event.currentTarget.value = "";
      return;
    }

    setError("");
    setImageFile(selectedFile);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const numericPrice = Number(price);
    if (!name.trim() || !categoryId || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError("Enter a product name, category, and valid price.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let savedImageUrl = imageUrl.trim() || null;
      if (imageFile) {
        const uploadedImage = await uploadProductImage(imageFile);
        savedImageUrl = uploadedImage.image_url;
      }

      const input = {
        product_name: name.trim(),
        category_id: Number(categoryId),
        price: numericPrice,
        image_url: savedImageUrl,
      };
      const saved = product
        ? await updateProduct(product.product_id, input)
        : await addProduct(input);
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The product could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-5 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-accent">
              Sell setup
            </div>
            <h2 id="product-modal-title" className="mt-1 font-display text-2xl font-bold">
              {product ? "Edit product" : "Add product"}
            </h2>
          </div>
          <button
            className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong"
            onClick={onClose}
            aria-label="Close product form"
          >
            ×
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)} className="p-6">
          {error && (
            <div className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <label className="block text-sm font-semibold">
              Product name <span className="text-danger">*</span>
              <Input
                className="mt-2 w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Flat White"
                autoFocus
                required
              />
            </label>
            <label className="block text-sm font-semibold">
              Category <span className="text-danger">*</span>
              <select
                className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                required
              >
                <option value="">Choose a category</option>
                {categories.map((item) => (
                  <option key={item.category_id} value={item.category_id}>
                    {item.category_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Price <span className="text-danger">*</span>
              <div className="relative mt-2">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                  ₩
                </span>
                <Input
                  className="w-full pl-7"
                  type="number"
                  min="1"
                  step="1"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="0"
                  required
                />
              </div>
            </label>
            <div className="block text-sm font-semibold">
              <label htmlFor="product-image-file">
                Product image <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <Input
                id="product-image-file"
                className="mt-2 w-full cursor-pointer file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-accent"
                type="file"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                onChange={selectProductImage}
              />
              <span className="mt-1 block text-[11px] font-normal text-ink-faint">
                Upload a PNG or JPEG image (maximum 5 MB).
              </span>
              {(localImagePreview || imageUrl) && (
                <div className="mt-3 flex items-center gap-3">
                  <img
                    className="size-20 rounded-xl border border-line object-cover"
                    src={localImagePreview || resolveAssetUrl(imageUrl)}
                    alt="Product preview"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      setImageFile(null);
                      setImageUrl("");
                      const input = document.getElementById("product-image-file") as HTMLInputElement | null;
                      if (input) input.value = "";
                    }}
                  >
                    Remove image
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-7 flex justify-end gap-3">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : product ? "Save changes" : "Add product"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DeactivateProductDialog({
  product,
  onClose,
  onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/45 p-5 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="deactivate-product-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <Icon name="minus" className="size-6" />
        </div>
        <h2 id="deactivate-product-title" className="mt-5 font-display text-xl font-bold">
          Deactivate {product.product_name}?
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          This product will no longer appear in normal POS selection. Historical orders and sales
          analytics will keep their existing product references.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose}>Keep active</Button>
          <button
              type="button"
              onClick={onConfirm}
              className="min-h-11 rounded-xl border border-danger bg-danger px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            Deactivate Product
          </button>

        </div>
      </section>
    </div>
  );
}

function SummaryBar({
  itemCount,
  total,
  onNext,
}: {
  itemCount: number;
  total: number;
  onNext: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-5 py-3 shadow-bar backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-5">
          <div className="hidden size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong sm:flex">
            <Icon name="grid" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-xs font-bold uppercase tracking-wide text-ink">
                Current order
              </div>
              <span className="rounded-full bg-surface-strong px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                Draft
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-ink-faint">
              {itemCount === 0
                ? "No products added yet"
                : `${itemCount} ${itemCount === 1 ? "item" : "items"} ready for checkout`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Order total
            </div>
            <div className="font-display text-2xl font-extrabold">{formatMoney(total)}</div>
          </div>
          <Button
            variant="primary"
            disabled={itemCount === 0}
            onClick={onNext}
            className="min-w-44"
          >
            <span className="flex items-center justify-center gap-2">
              Complete Transaction <Icon name="arrow" />
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function localDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function statisticsQuery(filters: Filters, orders: Order[]): URLSearchParams {
  const now = new Date();
  const firstDay = new Date(now);
  if (filters.preset === "7d") firstDay.setDate(now.getDate() - 6);
  if (filters.preset === "30d") firstDay.setDate(now.getDate() - 29);
  const orderDates = filters.preset === "all" ? orders.map((order) => order.order_date).sort() : [];
  const query = new URLSearchParams({
    start: orderDates[0] ?? localDate(firstDay),
    end: orderDates.at(-1) ?? localDate(now),
    group: filters.group,
  });
  if (filters.startTime) query.set("start_time", `${filters.startTime}:00`);
  if (filters.endTime) query.set("end_time", `${filters.endTime}:59`);
  filters.days.forEach((day) => query.append("weekdays", String(DAYS.indexOf(day))));
  filters.categories.forEach((id) => query.append("category_ids", String(id)));
  return query;
}

function Analysis({ data, loading }: { data: AppData; loading: boolean }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<"sales" | "marketing">("sales");
  const [trendProductId, setTrendProductId] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    state: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ state: "idle" });
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState("");
  const query = useMemo(() => statisticsQuery(filters, data.orders), [filters, data.orders]);

  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();

    setReportLoading(true);
    setReportError("");
    setStatistics(null);
    getStatistics(query, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setStatistics(result);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setReportError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReportLoading(false);
      });
    return () => controller.abort();
  }, [query, loading]);

  const summary = statistics?.summary;
  const topProduct = statistics?.products.find((product) => product.units > 0);

  function toggleDay(day: string): void {
    setFilters((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((value) => value !== day)
        : [...current.days, day],
    }));
  }

  function toggleCategory(categoryId: number): void {
    setFilters((current) => ({
      ...current,
      categories: current.categories.includes(categoryId)
        ? current.categories.filter((value) => value !== categoryId)
        : [...current.categories, categoryId],
    }));
  }

  const resetFilters = (): void => setFilters(DEFAULT_FILTERS);

  async function downloadReport(scope: "current" | "full"): Promise<void> {
    setExportStatus({
      state: "loading",
      message: scope === "current" ? "Preparing current view…" : "Preparing full report…",
    });
    try {
      const filename = await exportAnalytics({
        scope,
        filters: scope === "current" ? filters : undefined,
      });
      setExportOpen(false);
      setExportStatus({ state: "success", message: `${filename} downloaded` });
      window.setTimeout(() => setExportStatus({ state: "idle" }), 3500);
    } catch (caught) {
      setExportStatus({
        state: "error",
        message: caught instanceof Error ? caught.message : "Export failed. Please try again.",
      });
    }
  }

  if (loading) return <LoadingAnalysis />;

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-display text-3xl font-bold tracking-tight">Analysis</div>
          <div className="mt-1 text-sm text-ink-muted">
            Explore sales, customers, and campaign performance.
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Analysis view">
          <Button
            aria-pressed={view === "sales"}
            variant={view === "sales" ? "primary" : "secondary"}
            onClick={() => setView("sales")}
          >
            Sales analysis
          </Button>
          <Button
            aria-pressed={view === "marketing"}
            variant={view === "marketing" ? "primary" : "secondary"}
            onClick={() => setView("marketing")}
          >
            Marketing analysis
          </Button>
        </div>
      </div>
      <Surface className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <FilterGroup label="Date range">
            <div className="flex gap-1 rounded-xl bg-surface-strong p-1">
              {(["today", "7d", "30d", "all"] as DatePreset[]).map((preset) => (
                <Button
                  key={preset}
                  variant="ghost"
                  onClick={() => setFilters((current) => ({ ...current, preset }))}
                  className={`min-h-9 px-3 ${filters.preset === preset ? "bg-white text-accent-strong shadow-sm" : ""}`}
                >
                  {preset === "today" ? "Today" : preset === "all" ? "All" : preset}
                </Button>
              ))}
            </div>
          </FilterGroup>
          {view === "sales" && (
            <FilterGroup label="Group by">
              <select
                aria-label="Group by"
                className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm"
                value={filters.group}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    group: event.target.value as StatisticsGroup,
                  }))
                }
              >
                {(Object.keys(GROUP_LABELS) as StatisticsGroup[]).map((group) => (
                  <option key={group} value={group}>
                    {GROUP_LABELS[group]}
                  </option>
                ))}
              </select>
            </FilterGroup>
          )}
          <FilterGroup label="Time of day">
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={filters.startTime}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, startTime: event.target.value }))
                }
              />
              <span className="text-ink-faint">to</span>
              <Input
                type="time"
                value={filters.endTime}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, endTime: event.target.value }))
                }
              />
            </div>
          </FilterGroup>
          <FilterGroup label="Day of week">
            <div className="flex flex-wrap gap-1">
              {DAYS.map((day) => (
                <Button
                  key={day}
                  variant="chip"
                  onClick={() => toggleDay(day)}
                  className={`min-h-9 px-3 ${filters.days.includes(day) ? "border-accent bg-accent-soft text-accent-strong" : ""}`}
                >
                  {day.slice(0, 3)}
                </Button>
              ))}
            </div>
          </FilterGroup>
          {data.categories.length > 0 && (
            <FilterGroup label="Category">
              <div className="flex flex-wrap gap-1">
                {data.categories.map((item) => (
                  <Button
                    key={item.category_id}
                    variant="chip"
                    onClick={() => toggleCategory(item.category_id)}
                    className={`min-h-9 px-3 ${filters.categories.includes(item.category_id) ? "border-accent bg-accent-soft text-accent-strong" : ""}`}
                  >
                    {item.category_name}
                  </Button>
                ))}
              </div>
            </FilterGroup>
          )}
          <Button variant="ghost" onClick={resetFilters}>
            <span className="flex items-center gap-2">
              <Icon name="reset" /> Reset
            </span>
          </Button>
          <div className="ml-auto rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong">
            {summary?.orders ?? 0} matching orders
          </div>
          {view === "sales" && (
            <div className="relative">
              <Button
                variant="secondary"
                onClick={() => setExportOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                disabled={exportStatus.state === "loading"}
              >
                <span className="flex items-center gap-2">
                  <Icon name="download" />
                  {exportStatus.state === "loading" ? "Exporting…" : "Export report"}
                  <Icon name="chevron" className="size-4" />
                </span>
              </Button>
              {exportOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-2xl border border-line bg-white p-2 shadow-xl"
                >
                  <button
                    role="menuitem"
                    className="w-full rounded-xl p-3 text-left hover:bg-surface-strong"
                    onClick={() => void downloadReport("current")}
                  >
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                        <Icon name="download" />
                      </span>
                      <span>
                        <strong className="block text-sm">Download current view</strong>
                        <small className="mt-1 block leading-5 text-ink-muted">
                          Uses the selected date range, days, times, and categories.
                        </small>
                      </span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    className="w-full rounded-xl p-3 text-left hover:bg-surface-strong"
                    onClick={() => void downloadReport("full")}
                  >
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-strong text-ink-muted">
                        <Icon name="chart" />
                      </span>
                      <span>
                        <strong className="block text-sm">Download full report</strong>
                        <small className="mt-1 block leading-5 text-ink-muted">
                          Downloads all available analytics without active filters.
                        </small>
                      </span>
                    </span>
                  </button>
                </div>
              )}
              {exportStatus.state !== "idle" && exportStatus.state !== "loading" && (
                <div
                  role="status"
                  className={`absolute right-0 top-[calc(100%+0.5rem)] z-20 w-72 rounded-xl border px-3 py-2 text-xs font-semibold shadow-lg ${exportStatus.state === "success" ? "border-accent/20 bg-accent-soft text-accent-strong" : "border-danger/20 bg-danger-soft text-danger"}`}
                >
                  {exportStatus.message}
                </div>
              )}
            </div>
          )}
        </div>
      </Surface>
      {view === "sales" && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi label="Net revenue" value={formatMoney(Number(summary?.net ?? 0))} />
          <Kpi label="Orders" value={String(summary?.orders ?? 0)} />
          <Kpi
            label="Average order value"
            value={formatMoney(Number(summary?.average_order_value ?? 0))}
          />
          <Kpi label="Items sold" value={String(summary?.units ?? 0)} />
          <Kpi label="Top product" value={topProduct?.product_name ?? "—"} />
        </div>
      )}
      {reportError ? (
        <EmptyState title="Could not load sales report" message={reportError} />
      ) : reportLoading ? (
        <LoadingAnalysis />
      ) : (
        statistics && (
          <>
            {statistics.warnings.map((warning) => (
              <p key={warning} role="status" className="mb-3 text-sm text-ink-muted">
                {warning}
              </p>
            ))}
            {view === "marketing" ? (
              <MarketingAnalysis statistics={statistics} query={query.toString()} />
            ) : statistics.summary.orders === 0 ? (
              <EmptyState
                title="No sales match these filters"
                message="Adjust the filters or complete a new sale to see analytics."
              />
            ) : (
              <>
                <ChartGrid
                  statistics={statistics}
                  categories={data.categories}
                  trendProductId={trendProductId}
                  onSelectTrendProduct={setTrendProductId}
                />
                <SalesBreakdowns statistics={statistics} />
              </>
            )}
          </>
        )
      )}
    </section>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Surface className="p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-2 truncate font-display text-2xl font-bold" title={value}>
        {value}
      </div>
    </Surface>
  );
}

function ChartGrid({
  statistics,
  categories,
  trendProductId,
  onSelectTrendProduct,
}: {
  statistics: Statistics;
  categories: Category[];
  trendProductId: number;
  onSelectTrendProduct: (id: number) => void;
}) {
  const [barPeriod, setBarPeriod] = useState("");
  const categoryNames = new Map(
    categories.map((category) => [category.category_id, category.category_name]),
  );
  const byDate = statistics.periods.map((row) => ({ label: row.period, value: Number(row.net) }));
  const byHour = statistics.by_hour.map((row) => ({
    label: `${String(row.hour).padStart(2, "0")}:00`,
    value: Number(row.net),
  }));
  const byDay = statistics.by_weekday.map((row) => ({
    label: DAYS[row.weekday],
    value: Number(row.net),
  }));
  const byCategory = statistics.by_category.map((row) => ({
    label: categoryNames.get(row.category_id) ?? `Category ${row.category_id}`,
    value: Number(row.net),
  }));
  const periodIndex = statistics.periods.findIndex((point) => point.period === barPeriod);
  const periodProducts =
    periodIndex < 0
      ? statistics.products
      : statistics.product_series
          .map((product) => ({
            ...product,
            units: product.points[periodIndex]?.units ?? 0,
          }))
          .sort((a, b) => b.units - a.units || a.product_id - b.product_id);
  const topProducts = periodProducts
    .filter((product) => product.units > 0)
    .slice(0, 10)
    .map((product) => ({ label: product.product_name, value: product.units }));
  const trendProduct = statistics.product_series.find(
    (product) => product.product_id === trendProductId,
  );
  const unitsByPeriod = (trendProduct?.points ?? statistics.periods).map((row) => ({
    label: row.period,
    value: row.units,
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <PeriodChart
        title="Revenue over time"
        data={byDate}
        group={statistics.group}
        metric="net revenue"
        valueFormatter={(value) => EXACT_REVENUE.format(value)}
      />
      <BarChart title="Revenue by hour" data={byHour} valueFormatter={formatMoney} labelStep={4} />
      <BarChart title="Revenue by day of week" data={byDay} valueFormatter={formatMoney} />
      <BarChart title="Sales by category" data={byCategory} valueFormatter={formatMoney} />
      <div className="lg:col-span-2">
        <label className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
          Period for product bars
          <select
            className="min-h-10 max-w-full rounded-xl border border-line bg-white px-3"
            value={barPeriod}
            onChange={(event) => setBarPeriod(event.target.value)}
          >
            <option value="">All selected dates</option>
            {statistics.periods.map((point) => (
              <option key={point.period} value={point.period}>
                {formatPeriod(point.period, statistics.group, true)}
              </option>
            ))}
          </select>
        </label>
        {topProducts.length > 0 ? (
          <BarChart
            title="Top 10 products by quantity"
            data={topProducts}
            valueFormatter={(value) => String(value)}
            horizontal
          />
        ) : (
          <Surface className="p-5 text-sm text-ink-muted">No product sales in this period.</Surface>
        )}
      </div>
      <div className="lg:col-span-2">
        <label className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
          Product for units over time
          <select
            className="min-h-10 max-w-full rounded-xl border border-line bg-white px-3"
            value={trendProduct?.product_id ?? 0}
            onChange={(event) => onSelectTrendProduct(Number(event.target.value))}
          >
            <option value={0}>All matching products</option>
            {statistics.products.map((product) => (
              <option key={product.product_id} value={product.product_id}>
                {product.product_name}
              </option>
            ))}
          </select>
        </label>
        <PeriodChart
          title="Units sold over time"
          data={unitsByPeriod}
          group={statistics.group}
          metric="units sold"
          valueFormatter={(value) => value.toLocaleString("en")}
        />
      </div>
    </div>
  );
}

interface ChartDatum {
  label: string;
  value: number;
}

const SHORT_CHART_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const CROSS_YEAR_CHART_DATE = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "2-digit",
  timeZone: "UTC",
});
const FULL_CHART_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_CHART_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const EXACT_REVENUE = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 2,
});

function formatPeriod(
  period: string,
  group: StatisticsGroup,
  full: boolean,
  spansYears = false,
): string {
  if (group === "year") return period;
  if (group === "month") return MONTH_CHART_DATE.format(new Date(period + "-01"));
  const formatter = full ? FULL_CHART_DATE : spansYears ? CROSS_YEAR_CHART_DATE : SHORT_CHART_DATE;
  const label = formatter.format(new Date(period));
  return group === "week" && full ? "Week of " + label : label;
}

interface PeriodChartProps {
  data: ChartDatum[];
  group: StatisticsGroup;
  title: string;
  metric: string;
  valueFormatter: (value: number) => string;
}

function PeriodChart(props: PeriodChartProps) {
  if (props.data.length > 1) return <PeriodTrend {...props} />;
  const data = props.data.map((point) => ({
    ...point,
    label: formatPeriod(point.label, props.group, true),
  }));
  return <BarChart title={props.title} data={data} valueFormatter={props.valueFormatter} />;
}

function PeriodTrend({ data, group, title, metric, valueFormatter }: PeriodChartProps) {
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  const lastIndex = data.length - 1;
  const activeIndex = Math.min(inspectedIndex ?? lastIndex, lastIndex);
  const active = data[activeIndex];
  const activeDate = formatPeriod(active.label, group, true);
  const activeValue = valueFormatter(active.value);
  const description = GROUP_LABELS[group] + " " + metric;
  const peak = data.reduce((highest, day) => Math.max(highest, day.value), 0);
  const targetStep = Math.max(peak / 4, 1);
  const magnitude = 10 ** Math.floor(Math.log10(targetStep));
  const step = Math.ceil(
    magnitude * ([1, 2, 2.5, 5].find((factor) => magnitude * factor >= targetStep) ?? 10),
  );
  const ticks = [4, 3, 2, 1, 0].map((multiplier) => multiplier * step);
  const x = (index: number) => (index / lastIndex) * 100;
  const y = (value: number) => 100 - (value / ticks[0]) * 100;
  const points = data.map((day, index) => `${x(index)},${y(day.value)}`).join(" ");
  const tickCount = Math.min(data.length, 5);
  const dateTicks = Array.from({ length: tickCount }, (_, index) =>
    Math.round((index * lastIndex) / (tickCount - 1)),
  );
  const spansYears = data[0].label.slice(0, 4) !== data[lastIndex].label.slice(0, 4);

  function inspectPeriod(event: PointerEvent<HTMLDivElement>) {
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const index = Math.round(((event.clientX - left) / width) * lastIndex);
    setInspectedIndex(Math.max(0, Math.min(index, lastIndex)));
  }

  return (
    <Surface className="min-w-0 p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="font-display text-lg font-bold">{title}</div>
          <div className="text-xs text-ink-muted">
            {description}
            {group === "week" ? " · weeks start Monday" : ""}
          </div>
        </div>
        <div className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm text-accent-strong">
          <time dateTime={active.label}>{activeDate}</time>
          <strong className="ml-2">{activeValue}</strong>
        </div>
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 pt-2">
        <div
          aria-hidden="true"
          className="flex h-44 flex-col items-end justify-between text-xs text-ink-muted"
        >
          {ticks.map((tick) => (
            <div key={tick} className="h-0">
              <span className="block -translate-y-1/2">{valueFormatter(tick)}</span>
            </div>
          ))}
        </div>
        <div
          className="relative h-44 touch-pan-y rounded-sm focus-within:ring-2 focus-within:ring-accent"
          onPointerMove={inspectPeriod}
          onPointerDown={inspectPeriod}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <path
              d="M0 0V100H100 M0 0H100 M0 25H100 M0 50H100 M0 75H100"
              className="stroke-line"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={points}
              fill="none"
              className="stroke-accent-strong"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-accent"
            style={{ left: `${x(activeIndex)}%` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full border-2 border-white bg-accent-strong"
            style={{ left: `${x(activeIndex)}%`, top: `${y(active.value)}%` }}
          />
          <input
            className="sr-only"
            type="range"
            min={0}
            max={lastIndex}
            value={activeIndex}
            aria-label={"Inspect " + description.toLowerCase()}
            aria-valuetext={`${activeDate}, ${activeValue}`}
            onChange={(event) => setInspectedIndex(event.currentTarget.valueAsNumber)}
          />
        </div>
        <div aria-hidden="true" className="relative col-start-2 mt-2 h-4 text-xs text-ink-muted">
          {dateTicks.map((index, tick) => {
            const alignment =
              index === 0 ? "" : index === lastIndex ? "-translate-x-full" : "-translate-x-1/2";
            const mobileVisibility = tick % 2 === 1 && index !== lastIndex ? "hidden sm:block" : "";
            return (
              <span
                key={data[index].label}
                className={`absolute whitespace-nowrap ${alignment} ${mobileVisibility}`}
                style={{ left: `${x(index)}%` }}
              >
                {formatPeriod(data[index].label, group, false, spansYears)}
              </span>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Hover or tap the chart to see the value for a period.
      </p>
    </Surface>
  );
}

function BarChart({
  title,
  data,
  valueFormatter,
  horizontal = false,
  labelStep = 1,
}: {
  title: string;
  data: ChartDatum[];
  valueFormatter: (value: number) => string;
  horizontal?: boolean;
  labelStep?: number;
}) {
  const max = Math.max(...data.map((item) => item.value), 1);
  const sparseLabels = labelStep > 1;
  return (
    <Surface className="min-w-0 p-5">
      <div className="mb-5 font-display text-lg font-bold">{title}</div>
      <div className={horizontal ? "space-y-3" : "flex gap-1"}>
        {data.map((item) =>
          horizontal ? (
            <div
              key={item.label}
              className="grid grid-cols-[minmax(0,1fr)_3fr_auto] items-center gap-3 text-sm"
            >
              <span className="truncate text-ink-muted">{item.label}</span>
              <div className="h-3 overflow-hidden rounded-full bg-surface-strong">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </div>
              <span className="font-semibold">{valueFormatter(item.value)}</span>
            </div>
          ) : (
            <div key={item.label} className="min-w-0 flex-1 text-center">
              {!sparseLabels && (
                <span className="mb-1 block truncate text-xs font-semibold">
                  {valueFormatter(item.value)}
                </span>
              )}
              <div
                className="relative h-44 border-b border-line"
                role="img"
                aria-label={`${item.label}: ${valueFormatter(item.value)}`}
                title={`${item.label}: ${valueFormatter(item.value)}`}
              >
                {item.value > 0 && (
                  <div
                    className="absolute bottom-0 left-1/2 w-4/5 max-w-24 -translate-x-1/2 rounded-t-lg bg-accent"
                    style={{ height: `${(item.value / max) * 100}%` }}
                  />
                )}
              </div>
              {!sparseLabels && (
                <span className="mt-2 block truncate text-xs text-ink-faint" title={item.label}>
                  {item.label}
                </span>
              )}
            </div>
          ),
        )}
      </div>
      {!horizontal && sparseLabels && (
        <div className="relative mt-2 h-4 text-[10px] text-ink-faint">
          {data.map((item, index) => {
            const last = index === data.length - 1;
            if (index % labelStep !== 0 && !last) return null;
            const left = index === 0 ? 0 : last ? 100 : ((index + 0.5) / data.length) * 100;
            const shift = index === 0 ? 0 : last ? -100 : -50;
            return (
              <span
                key={item.label}
                className="absolute whitespace-nowrap"
                style={{ left: `${left}%`, transform: `translateX(${shift}%)` }}
              >
                {item.label}
              </span>
            );
          })}
        </div>
      )}
    </Surface>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Surface className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <Icon name="chart" className="size-7" />
      </div>
      <div className="font-display text-xl font-bold">{title}</div>
      <div className="mt-2 max-w-md text-sm leading-6 text-ink-muted">{message}</div>
    </Surface>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="aspect-[4/3] animate-pulse rounded-2xl bg-surface-strong" />
      ))}
    </div>
  );
}

function LoadingAnalysis() {
  return (
    <div className="space-y-5">
      <div className="h-10 w-48 animate-pulse rounded-xl bg-surface-strong" />
      <div className="h-36 animate-pulse rounded-2xl bg-surface-strong" />
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl bg-surface-strong" />
        ))}
      </div>
    </div>
  );
}

export default App;
