import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent,
} from "react";
import {
  addProduct,
  createCategory,
  deleteCategory,
  deleteProduct,
  exportAnalytics,
  getCategories,
  getCampaigns,
  getStatistics,
  getProducts,
  setProductActive,
  updateProduct,
  uploadProductImage,
  resolveAssetUrl,
  type Campaign,
  type Category,
  type Order,
  type Statistics,
  type Product,
  type ImportResult,
  type StatisticsGroup,
} from "./data-access";
import { Button, CardButton, Icon, IconButton, Input, Surface, useModalScrollLock } from "./ui";
import { LazySection } from "./lazy-section";
import { usePreferences } from "./preferences";
import { SettingsDrawer } from "./settings-drawer";

// Code for these screens is downloaded the first time each one is opened,
// so the menu (the first screen) starts with a much smaller bundle.
const loadAnalyticsDetails = () => import("./analytics-details");
const MarketingAnalysis = lazy(() =>
  loadAnalyticsDetails().then((module) => ({ default: module.MarketingAnalysis })),
);
const SalesBreakdowns = lazy(() =>
  loadAnalyticsDetails().then((module) => ({ default: module.SalesBreakdowns })),
);
const MarketingCampaigns = lazy(() =>
  import("./marketing-campaigns").then((module) => ({ default: module.MarketingCampaigns })),
);
const CustomersPage = lazy(() =>
  import("./customers-page").then((module) => ({ default: module.CustomersPage })),
);
const OrdersPage = lazy(() =>
  import("./orders-page").then((module) => ({ default: module.OrdersPage })),
);
const ImportWizard = lazy(() =>
  import("./import-wizard").then((module) => ({ default: module.ImportWizard })),
);
const CheckoutModal = lazy(() =>
  import("./checkout-modal").then((module) => ({ default: module.CheckoutModal })),
);

type WorkingTab = "menu" | "analysis" | "marketing" | "customers" | "orders";
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
  promocode: string;
}

const EMPTY_DATA: AppData = { categories: [], products: [], orders: [] };
const DEFAULT_FILTERS: Filters = {
  preset: "30d",
  group: "day",
  days: [],
  startTime: "00:00",
  endTime: "23:59",
  categories: [],
  promocode: "",
};
const GROUP_LABELS: Record<StatisticsGroup, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function App() {
  const { appMode, ensureTranslations, categoryName, productName } = usePreferences();
  const [tab, setTab] = useState<WorkingTab>("menu");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Record<number, number>>({});
  const [category, setCategory] = useState<number | "all" | "uncategorized">("all");
  const [toast, setToast] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<Product | null>(null);
  const [managementMode, setManagementMode] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [splashVisible, setSplashVisible] = useState(
    () => sessionStorage.getItem("pointnull-intro-seen") !== "true",
  );
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashMinimumElapsed, setSplashMinimumElapsed] = useState(false);

  useEffect(() => {
    if (appMode === "simple") {
      // Simple Mode keeps customer lookup inside checkout, not the Customer Dashboard.
      // The simplified Analysis dashboard remains available alongside Sell and Orders.
      if (tab !== "menu" && tab !== "analysis" && tab !== "orders") setTab("menu");
    }
  }, [appMode, tab]);

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

  // Warm the translation memory without delaying the screen or language switch.
  // Cache hits are restored from PostgreSQL; misses are translated asynchronously.
  const translationSources = useMemo(() => [
    ...data.categories.map((item) => ({ source_text: item.category_name, context: "category" as const })),
    ...data.products.map((item) => ({ source_text: item.product_name, context: "product" as const })),
  ], [data.categories, data.products]);

  useEffect(() => {
    if (translationSources.length) void ensureTranslations(translationSources);
  }, [ensureTranslations, translationSources]);
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
      <Header
        tab={tab}
        appMode={appMode}
        onTabChange={setTab}
        onImport={() => setImportOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
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
            onCreateCategory={async (name, productIds) => {
              const result = await createCategory(name, productIds);
              setData((current) => ({
                ...current,
                categories: [...current.categories, result.category],
                products: current.products.map((product) =>
                  result.moved_product_ids.includes(product.product_id)
                    ? { ...product, category_id: result.category.category_id, category_name: result.category.category_name }
                    : product,
                ),
              }));
              setCategory(result.category.category_id);
              setToast(
                result.moved_product_ids.length
                  ? `${categoryName(result.category.category_id, result.category.category_name)} created · ${result.moved_product_ids.length} products moved`
                  : `${categoryName(result.category.category_id, result.category.category_name)} category created`,
              );
              window.setTimeout(() => setToast(""), 2800);
              return result;
            }}
            onDeleteCategory={async (categoryId, action, targetCategoryId) => {
              const result = await deleteCategory(categoryId, action, targetCategoryId);
              setData((current) => {
                let products = current.products;
                let categories = current.categories.filter((item) => item.category_id !== categoryId);
                if (result.action === "move" && result.target_category) {
                  products = products.map((product) =>
                    result.moved_product_ids.includes(product.product_id)
                      ? { ...product, category_id: result.target_category!.category_id, category_name: result.target_category!.category_name }
                      : product,
                  );
                } else if (result.action === "uncategorized") {
                  const uncategorizedIds = new Set(result.uncategorized_product_ids);
                  products = products.map((product) => uncategorizedIds.has(product.product_id)
                    ? { ...product, category_id: null, category_name: null }
                    : product);
                } else {
                  const deletedIds = new Set(result.deleted_product_ids);
                  products = products
                    .filter((product) => !deletedIds.has(product.product_id))
                    .map((product) => result.archived_product_ids.includes(product.product_id) && result.archive_category
                      ? { ...product, category_id: result.archive_category.category_id, category_name: result.archive_category.category_name, active: false }
                      : product);
                  if (result.archive_category && !categories.some((item) => item.category_id === result.archive_category!.category_id)) {
                    categories = [...categories, result.archive_category];
                  }
                }
                return { ...current, categories, products };
              });
              if (category === categoryId) {
                setCategory(result.action === "move" && result.target_category
                  ? result.target_category.category_id
                  : "all");
              }
              if (result.action === "delete") {
                const removedFromMenu = new Set([...result.deleted_product_ids, ...result.archived_product_ids]);
                setSelection((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedFromMenu.has(Number(id)))));
              }
              const message = result.action === "move"
                ? `Category deleted · ${result.moved_product_ids.length} products moved`
                : result.action === "uncategorized"
                  ? `Category deleted · ${result.uncategorized_product_ids.length} products left uncategorized`
                  : `Category deleted · ${result.deleted_product_ids.length} products removed · ${result.archived_product_ids.length} kept for sales history`;
              setToast(message);
              window.setTimeout(() => setToast(""), 3600);
              return result;
            }}
            onQuantityChange={updateQuantity}
            managementMode={managementMode}
            onManagementModeChange={(enabled) => {
              if (!enabled && typeof category === "number") {
                const selected = data.categories.find((item) => item.category_id === category);
                if (selected?.category_name.toLowerCase().startsWith("archived")) setCategory("all");
              }
              setManagementMode(enabled);
            }}
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
                  setToast(`${productName(updated.product_id, updated.product_name)} is available for sale`);
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
          <Analysis data={data} loading={loading} appMode={appMode} />
        ) : tab === "marketing" ? (
          <Suspense fallback={<LoadingGrid />}><MarketingCampaigns onOpenAnalysis={() => setTab("analysis")} /></Suspense>
        ) : tab === "customers" && appMode === "advanced" ? (
          <Suspense fallback={<LoadingGrid />}>
            <CustomersPage />
          </Suspense>
        ) : (
          <Suspense fallback={<LoadingGrid />}>
            <OrdersPage />
          </Suspense>
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
          onDeleted={(result) => {
            const archiveCategory = result.archive_category;
            setData((current) => {
              const categories = archiveCategory && !current.categories.some(
                (item) => item.category_id === archiveCategory.category_id,
              )
                ? [...current.categories, archiveCategory]
                : current.categories;
              return {
                ...current,
                categories,
                products: result.action === "deleted"
                  ? current.products.filter((item) => item.product_id !== result.product_id)
                  : current.products.map((item) => item.product_id === result.product_id && archiveCategory
                    ? {
                        ...item,
                        category_id: archiveCategory.category_id,
                        category_name: archiveCategory.category_name,
                        active: false,
                      }
                    : item),
              };
            });
            setSelection((current) => {
              const { [result.product_id]: removed, ...rest } = current;
              void removed;
              return rest;
            });
            setProductModalOpen(false);
            setEditingProduct(null);
            setToast(result.action === "deleted" ? "Product deleted" : "Product archived to Archived Products");
            window.setTimeout(() => setToast(""), 3200);
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
                ? `${productName(product.product_id, product.product_name)} updated`
                : `${productName(product.product_id, product.product_name)} added to Sell`,
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
                setToast(`${productName(updated.product_id, updated.product_name)} deactivated`);
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
        <Suspense fallback={null}>
          <ImportWizard
            categories={data.categories}
            products={data.products}
            onClose={() => setImportOpen(false)}
            onImported={mergeImported}
          />
        </Suspense>
      )}
      {checkoutOpen && (
        <Suspense fallback={null}>
          <CheckoutModal
            products={data.products}
            selection={selection}
            onClose={() => setCheckoutOpen(false)}
            onSaved={(saved) => {
              const soldProductIds = new Set(saved.orderItems.map((item) => item.product_id));
              setData((current) => ({
                ...current,
                orders: [...current.orders, saved.order],
                products: current.products.map((product) =>
                  soldProductIds.has(product.product_id) ? { ...product, has_sales: true } : product,
                ),
              }));
              setSelection({});
            }}
            onDone={(saved) => {
              setCheckoutOpen(false);
              setToast(`Order #${saved.order.order_id} completed`);
              window.setTimeout(() => setToast(""), 2800);
            }}
          />
        </Suspense>
      )}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}
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
          <img src="/favicon.svg" alt="" className="splash-mark" />
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

function LiveClock() {
  const { language } = usePreferences();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const locale = language === "ko" ? "ko-KR" : "en-US";

  return (
    <div className="hidden shrink-0 items-center gap-2 text-right md:flex">
      <Icon name="clock" className="size-5 text-accent" />
      <div>
        <div className="text-sm font-semibold">
          {clock.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div className="text-xs text-ink-faint">
          {clock.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}
        </div>
      </div>
    </div>
  );
}

function Header({
  tab,
  appMode,
  onTabChange,
  onImport,
  onSettings,
}: {
  tab: WorkingTab;
  appMode: "simple" | "advanced";
  onTabChange: (tab: WorkingTab) => void;
  onImport: () => void;
  onSettings: () => void;
}) {
  const { t, language } = usePreferences();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-18 max-w-screen-2xl items-center gap-2 px-3 sm:px-5 lg:gap-6 lg:px-8">
        <div className="flex shrink-0 items-center gap-3">
          <img src="/favicon.svg" alt="PointNull" className="size-10 rounded-xl" />
          <div className="hidden sm:block">
            <div className="font-display text-lg font-bold leading-tight">PointNull</div>
            <div className="text-xs font-medium text-ink-faint">{t("Sales workspace")}</div>
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
              <Icon name="grid" /> {t("Sell")}
            </span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => onTabChange("analysis")}
            className={tab === "analysis" ? "bg-accent-soft text-accent-strong" : ""}
          >
            <span className="flex items-center gap-2">
              <Icon name="chart" /> {t("Analysis")}
            </span>
          </Button>
          {appMode === "advanced" && (
            <Button variant="ghost" onClick={() => onTabChange("marketing")} className={tab === "marketing" ? "bg-accent-soft text-accent-strong" : ""}>
              <span className="flex items-center gap-2"><Icon name="megaphone" /> {t("Marketing")}</span>
            </Button>
          )}
          {appMode === "advanced" && (
            <Button
              variant="ghost"
              onClick={() => onTabChange("customers")}
              className={tab === "customers" ? "bg-accent-soft text-accent-strong" : ""}
            >
              <span className="flex items-center gap-2">
                <Icon name="users" /> {t("Customers")}
              </span>
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onTabChange("orders")}
            className={`shrink-0 whitespace-nowrap ${
              tab === "orders" ? "bg-accent-soft text-accent-strong" : ""
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon name="receipt" /> {t("Orders")}
            </span>
          </Button>
        </nav>
        <Button variant="secondary" onClick={onImport} className="shrink-0 px-3 sm:px-4">
          <span className="hidden md:inline">{t("Import data")}</span>
          <span className="md:hidden">{t("Import")}</span>
        </Button>
        <IconButton
          label={t("Settings")}
          onClick={onSettings}
          className="size-10 shrink-0"
        >
          <img src="/pointnull-settings-gear.svg" alt="" aria-hidden="true" className="size-5 object-contain" />
        </IconButton>
        <LiveClock />
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
  onCreateCategory,
  onDeleteCategory,
  onQuantityChange,
  onManagementModeChange,
  onAddProduct,
  onEditProduct,
  onDeactivateProduct,
  onReactivateProduct,
}: {
  categories: Category[];
  products: Product[];
  selectedCategory: number | "all" | "uncategorized";
  selection: Record<number, number>;
  loading: boolean;
  managementMode: boolean;
  onCategoryChange: (category: number | "all" | "uncategorized") => void;
  onCreateCategory: (name: string, productIds: number[]) => Promise<unknown>;
  onDeleteCategory: (categoryId: number, action: "move" | "uncategorized" | "delete", targetCategoryId?: number) => Promise<unknown>;
  onQuantityChange: (productId: number, delta: number) => void;
  onManagementModeChange: (enabled: boolean) => void;
  onAddProduct: () => void;
  onEditProduct: (product: Product) => void;
  onDeactivateProduct: (product: Product) => void;
  onReactivateProduct: (product: Product) => void;
}) {
  const { t, productName, categoryName, formatMoney } = usePreferences();
  const [feedbackProductId, setFeedbackProductId] = useState<number | null>(null);
  const [categoryDialog, setCategoryDialog] = useState<"create" | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const availableProducts = managementMode
    ? products
    : products.filter((product) => product.active !== false);
  const uncategorizedProducts = availableProducts.filter((product) => product.category_id === null);
  const visibleProducts =
    selectedCategory === "all"
      ? availableProducts
      : selectedCategory === "uncategorized"
        ? uncategorizedProducts
        : availableProducts.filter((product) => product.category_id === selectedCategory);
  const categoryMap = new Map(categories.map((item) => [item.category_id, item.category_name]));
  const categoryChips = managementMode
    ? categories
    : categories.filter((item) => !item.category_name.toLowerCase().startsWith("archived"));

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
            {managementMode ? t("Manage products") : t("New sale")}
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {managementMode
              ? t("Edit menu information and control product availability.")
              : t("Choose products for the current order.")}
          </div>
        </div>
        <div className="hidden rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink-muted shadow-sm sm:block">
          {availableProducts.length} {t(managementMode ? "total items" : "available items")}
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-2 pt-2">
          <Button
            variant={selectedCategory === "all" ? "primary" : "chip"}
            onClick={() => onCategoryChange("all")}
          >
            {t("All")}
          </Button>
          {uncategorizedProducts.length > 0 && (
            <Button
              variant={selectedCategory === "uncategorized" ? "primary" : "chip"}
              onClick={() => onCategoryChange("uncategorized")}
              className="whitespace-nowrap"
            >
              {t("Uncategorized")} · {uncategorizedProducts.length}
            </Button>
          )}
          {categoryChips.map((item) => (
            <div key={item.category_id} className="relative shrink-0">
              <Button
                variant={selectedCategory === item.category_id ? "primary" : "chip"}
                onClick={() => onCategoryChange(item.category_id)}
                className={`whitespace-nowrap ${managementMode ? "pr-8" : ""}`}
              >
                {categoryName(item.category_id, item.category_name)}
              </Button>
              {managementMode && (
                <button
                  type="button"
                  aria-label={`${t("Delete category")}: ${categoryName(item.category_id, item.category_name)}`}
                  title={`${t("Delete category")}: ${categoryName(item.category_id, item.category_name)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCategoryToDelete(item);
                  }}
                  className="absolute -right-1.5 -top-1.5 z-10 flex size-6 items-center justify-center rounded-full border border-danger/20 bg-white text-sm font-bold text-danger shadow-sm transition hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {managementMode && (
            <IconButton
              label="Add category"
              title="Add category"
              className="size-11 shrink-0 rounded-full border-dashed border-accent/50 text-accent-strong hover:bg-accent-soft"
              onClick={() => setCategoryDialog("create")}
            >
              <Icon name="plus" />
            </IconButton>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant={managementMode ? "primary" : "secondary"}
            onClick={() => onManagementModeChange(!managementMode)}
            aria-pressed={managementMode}
          >
            {t(managementMode ? "Done managing" : "Manage Products")}
          </Button>
          {managementMode && (
            <Button variant="primary" onClick={onAddProduct}>
              <span className="flex items-center gap-2">
                <Icon name="plus" /> {t("Add product")}
              </span>
            </Button>
          )}
        </div>
      </div>
      {loading ? (
        <LoadingGrid />
      ) : visibleProducts.length === 0 ? (
        <EmptyState
          title={t("No menu items to show")}
          message={t("Products from the connected database will appear here.")}
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
                          {productName(product.product_id, product.product_name).slice(0, 1).toUpperCase()}
                        </span>
                      </>
                    )}
                    <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-ink-muted shadow-sm">
                      {product.category_id === null
                        ? t("Uncategorized")
                        : categoryName(product.category_id, categoryMap.get(product.category_id) ?? t("Uncategorized"))}
                    </span>
                    {inactive && (
                      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-ink px-2 py-1 text-[10px] font-bold text-white shadow-sm">
                        {t("Inactive")}
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
                      {productName(product.product_id, product.product_name)}
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
                        {t(inactive ? "Not for sale" : "Available")}
                      </div>
                    </div>
                    <div className="mt-2 text-[10px] font-medium text-ink-faint">
                      Item #{String(product.product_id).padStart(3, "0")} ·{" "}
                      {t(managementMode ? "Management mode" : "Tap to add")}
                    </div>
                  </div>
                </CardButton>
                {managementMode && (
                  <div className="flex gap-2 border-t border-line bg-white p-3">
                    <Button className="min-h-9 flex-1 px-3" onClick={() => onEditProduct(product)}>
                      {t("Edit")}
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
                      {t(inactive ? "Reactivate" : "Deactivate")}
                    </Button>
                  </div>
                )}
                {!managementMode && quantity > 0 && (
                  <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-xl bg-ink p-1 text-white shadow-lg">
                    <IconButton
                      label={`Remove one ${productName(product.product_id, product.product_name)}`}
                      className="size-9 min-h-0 rounded-lg border-0 !bg-transparent !text-white hover:!bg-white/15"
                      onClick={() => onQuantityChange(product.product_id, -1)}
                    >
                      <Icon name="minus" className="size-4 shrink-0" />
                    </IconButton>

                    <div className="min-w-7 text-center text-sm font-bold tabular-nums">
                      {quantity}
                    </div>

                    <IconButton
                      label={`Add one ${productName(product.product_id, product.product_name)}`}
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
      {categoryDialog === "create" && (
        <CreateCategoryDialog
          categories={categories}
          products={products}
          onClose={() => setCategoryDialog(null)}
          onCreate={async (name, productIds) => {
            await onCreateCategory(name, productIds);
            setCategoryDialog(null);
          }}
        />
      )}
      {categoryToDelete && (
        <DeleteCategoryDialog
          category={categoryToDelete}
          categories={categories}
          products={products}
          onClose={() => setCategoryToDelete(null)}
          onDelete={async (action, targetCategoryId) => {
            await onDeleteCategory(categoryToDelete.category_id, action, targetCategoryId);
            setCategoryToDelete(null);
          }}
        />
      )}
    </section>
  );
}

function CreateCategoryDialog({
  categories,
  products,
  onClose,
  onCreate,
}: {
  categories: Category[];
  products: Product[];
  onClose: () => void;
  onCreate: (name: string, productIds: number[]) => Promise<void>;
}) {
  const { t, productName, categoryName } = usePreferences();
  useModalScrollLock();
  const [name, setName] = useState("");
  const selectableProducts = products.filter((product) =>
    !categories.some((item) => item.category_id === product.category_id && item.category_name.toLowerCase().startsWith("archived")),
  );
  const uncategorizedProducts = selectableProducts.filter((product) => product.category_id === null);
  const categorizedProducts = selectableProducts.filter((product) => product.category_id !== null);
  const [moveExisting, setMoveExisting] = useState(uncategorizedProducts.length > 0);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => uncategorizedProducts.map((product) => product.product_id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleProduct(productId: number): void {
    setSelectedIds((current) => current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId]);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a category name.");
      return;
    }
    if (categories.some((category) => category.category_name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setError("A category with this name already exists.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onCreate(trimmed, moveExisting ? selectedIds : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The category could not be created.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto overscroll-contain bg-ink/45 p-3 backdrop-blur-sm sm:p-5" role="presentation" onMouseDown={onClose}>
      <section className="my-auto flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="create-category-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-accent">{t("Menu setup")}</div>
            <h2 id="create-category-title" className="mt-1 font-display text-xl font-bold">{t("Add category")}</h2>
            <p className="mt-1 text-sm text-ink-muted">{t("Create a category, then optionally move existing products into it.")}</p>
          </div>
          <button type="button" className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6">
            {error && <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>}
            <label className="block text-sm font-semibold">{t("Category name")}
              <Input className="mt-2 w-full" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} placeholder="e.g. Beverages" autoFocus required />
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3.5">
              <input type="checkbox" className="mt-1 size-4 accent-current" checked={moveExisting} onChange={(event) => setMoveExisting(event.target.checked)} />
              <span>
                <span className="block text-sm font-semibold">{t("Move existing products into this category")}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{uncategorizedProducts.length > 0
                  ? t("Uncategorized products are selected first. Review or change the selection below.")
                  : t("Optional. Leave unchecked to create the category without changing existing products.")}</span>
              </span>
            </label>
            {moveExisting && (
              <div className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{t("Select products")}</span>
                  <span className="text-xs text-ink-muted">{selectedIds.length} {t("selected")}</span>
                </div>
                <div className="max-h-64 space-y-3 overflow-y-auto overscroll-contain pr-1">
                  {selectableProducts.length === 0 && <p className="py-3 text-sm text-ink-muted">{t("There are no existing products to move.")}</p>}
                  {uncategorizedProducts.length > 0 && (
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2 px-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-accent-strong">{t("Uncategorized products")} · {uncategorizedProducts.length}</span>
                        <button type="button" className="text-xs font-semibold text-accent-strong hover:underline" onClick={() => setSelectedIds((current) => Array.from(new Set([...current, ...uncategorizedProducts.map((product) => product.product_id)])))}>{t("Select all")}</button>
                      </div>
                      {uncategorizedProducts.map((product) => (
                        <label key={product.product_id} className="flex cursor-pointer items-center gap-3 rounded-lg bg-accent-soft/40 px-2 py-2 text-sm hover:bg-accent-soft">
                          <input type="checkbox" className="size-4 accent-current" checked={selectedIds.includes(product.product_id)} onChange={() => toggleProduct(product.product_id)} />
                          <span className="min-w-0 flex-1 truncate">{productName(product.product_id, product.product_name)}</span>
                          <span className="shrink-0 text-xs text-accent-strong">{t("No category")}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {categorizedProducts.length > 0 && (
                    <div>
                      {uncategorizedProducts.length > 0 && <div className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-ink-faint">{t("Other products")}</div>}
                      {categorizedProducts.map((product) => (
                        <label key={product.product_id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-strong">
                          <input type="checkbox" className="size-4 accent-current" checked={selectedIds.includes(product.product_id)} onChange={() => toggleProduct(product.product_id)} />
                          <span className="min-w-0 flex-1 truncate">{productName(product.product_id, product.product_name)}</span>
                          <span className="shrink-0 text-xs text-ink-faint">{categories.find((item) => item.category_id === product.category_id) ? categoryName(product.category_id ?? 0, categories.find((item) => item.category_id === product.category_id)!.category_name) : t("Uncategorized")}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" onClick={onClose} className="w-full sm:w-auto">{t("Cancel")}</Button>
            <Button variant="primary" type="submit" disabled={saving || !name.trim()} className="w-full sm:w-auto">{saving ? t("Creating…") : t("Create category")}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DeleteCategoryDialog({
  category,
  categories,
  products,
  onClose,
  onDelete,
}: {
  category: Category;
  categories: Category[];
  products: Product[];
  onClose: () => void;
  onDelete: (action: "move" | "uncategorized" | "delete", targetCategoryId?: number) => Promise<void>;
}) {
  const { t, categoryName, productName } = usePreferences();
  useModalScrollLock();
  const affected = products.filter((product) => product.category_id === category.category_id);
  const soldProducts = affected.filter((product) => product.has_sales);
  const unsoldProducts = affected.filter((product) => !product.has_sales);
  const destinations = categories.filter((item) => item.category_id !== category.category_id);
  const [action, setAction] = useState<"move" | "uncategorized" | "delete">(affected.length > 0 && destinations.length > 0 ? "move" : affected.length > 0 ? "uncategorized" : "delete");
  const [targetId, setTargetId] = useState(destinations[0] ? String(destinations[0].category_id) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(): Promise<void> {
    if (action === "move" && !targetId) {
      setError("Choose a destination category, or choose to leave products uncategorized.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onDelete(action, action === "move" ? Number(targetId) : undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The category could not be deleted.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto overscroll-contain bg-ink/45 p-3 backdrop-blur-sm sm:p-5" role="presentation" onMouseDown={onClose}>
      <section className="my-auto flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-category-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-danger">{t("Category management")}</div>
            <h2 id="delete-category-title" className="mt-1 font-display text-xl font-bold">{t("Delete category?")} <span className="text-danger">{categoryName(category.category_id, category.category_name)}</span></h2>
            <p className="mt-1 text-sm text-ink-muted">{affected.length} {t("products assigned to this category")}</p>
          </div>
          <button type="button" className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 sm:p-6">
          {error && <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</div>}
          {affected.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">{t("Products affected")}</span><span className="text-xs text-ink-muted">{soldProducts.length} sold · {unsoldProducts.length} never sold</span></div>
              <div className="max-h-40 space-y-1 overflow-y-auto overscroll-contain pr-1">
                {affected.map((product) => (
                  <div key={product.product_id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
                    <span className="min-w-0 truncate">{productName(product.product_id, product.product_name)}</span>
                    <span className={`shrink-0 text-xs font-medium ${product.has_sales ? "text-ink-muted" : "text-accent-strong"}`}>{product.has_sales ? t("Has sales history") : t("Never sold")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">{t("What should happen to these products?")}</legend>
            {destinations.length > 0 && (
              <label className={`block cursor-pointer rounded-xl border p-3.5 ${action === "move" ? "border-accent bg-accent-soft/50" : "border-line"}`}>
                <span className="flex items-start gap-3"><input type="radio" name="category-delete-action" className="mt-1 size-4 accent-current" checked={action === "move"} onChange={() => setAction("move")} /><span><span className="block text-sm font-semibold">{t("Move products to another category")}</span><span className="mt-0.5 block text-xs text-ink-muted">{t("Keep every product and its sales history.")}</span></span></span>
                {action === "move" && <select className="mt-3 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={targetId} onChange={(event) => setTargetId(event.target.value)}>{destinations.map((item) => <option key={item.category_id} value={item.category_id}>{categoryName(item.category_id, item.category_name)}</option>)}</select>}
              </label>
            )}
            <label className={`block cursor-pointer rounded-xl border p-3.5 ${action === "uncategorized" ? "border-accent bg-accent-soft/50" : "border-line"}`}>
              <span className="flex items-start gap-3"><input type="radio" name="category-delete-action" className="mt-1 size-4 accent-current" checked={action === "uncategorized"} onChange={() => setAction("uncategorized")} /><span><span className="block text-sm font-semibold">{t("Leave products without a category")}</span><span className="mt-0.5 block text-xs text-ink-muted">{t("Keep every product and its sales history, but remove the category assignment.")}</span></span></span>
            </label>
            <label className={`block cursor-pointer rounded-xl border p-3.5 ${action === "delete" ? "border-danger/40 bg-danger-soft/40" : "border-line"}`}>
              <span className="flex items-start gap-3"><input type="radio" name="category-delete-action" className="mt-1 size-4 accent-current" checked={action === "delete"} onChange={() => setAction("delete")} /><span><span className="block text-sm font-semibold">{t("Delete category and its products")}</span><span className="mt-0.5 block text-xs text-ink-muted">{t("Permanently delete products that have never been sold. Products with sales history will be deactivated and retained under Archived Products so past orders remain intact.")}</span></span></span>
            </label>
          </fieldset>
          {action === "delete" && soldProducts.length > 0 && <p className="rounded-xl bg-surface-secondary px-3 py-2.5 text-xs leading-relaxed text-ink-muted">{soldProducts.length} product{soldProducts.length === 1 ? " has" : "s have"} sales history and cannot be permanently erased without damaging historical orders. {unsoldProducts.length} unsold product{unsoldProducts.length === 1 ? " will" : "s will"} be permanently deleted.</p>}
          {affected.length === 0 && <p className="text-sm text-ink-muted">{t("This category is empty and can be deleted immediately.")}</p>}
        </div>
        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button type="button" onClick={onClose} className="w-full sm:w-auto">{t("Cancel")}</Button>
          <Button variant={action === "delete" ? "danger" : "primary"} type="button" onClick={() => void submit()} disabled={saving || (action === "move" && !targetId)} className="w-full sm:w-auto">{saving ? t("Deleting…") : action === "move" ? t("Move & delete category") : action === "uncategorized" ? t("Remove category") : t("Delete category")}</Button>
        </footer>
      </section>
    </div>
  );
}

function ProductFormModal({
  categories,
  product,
  onClose,
  onSaved,
  onDeleted,
}: {
  categories: Category[];
  product: Product | null;
  onClose: () => void;
  onSaved: (product: Product) => void;
  onDeleted: (result: Awaited<ReturnType<typeof deleteProduct>>) => void;
}) {
  const { t, categoryName } = usePreferences();
  useModalScrollLock();

  const [name, setName] = useState(product?.product_name ?? "");
  const [categoryId, setCategoryId] = useState(
    product
      ? product.category_id == null ? "" : String(product.category_id)
      : String(categories.find((item) => !item.category_name.toLowerCase().startsWith("archived"))?.category_id ?? ""),
  );
  const [price, setPrice] = useState(product?.price.toString() ?? "");
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [localImagePreview, setLocalImagePreview] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    if (!name.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError("Enter a product name and valid price.");
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
        category_id: categoryId ? Number(categoryId) : null,
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

  async function handleDelete(): Promise<void> {
    if (!product || deleting || saving) return;
    const confirmed = window.confirm(
      `Delete ${product.product_name}? Products with sales history will be archived instead so existing orders remain intact. Products without sales history will be permanently deleted.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    setError("");
    try {
      const result = await deleteProduct(product.product_id);
      onDeleted(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The product could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-ink/45 p-2 backdrop-blur-sm sm:p-5"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="my-auto flex max-h-[calc(100dvh-1rem)] min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-accent">
              {t("Sell setup")}
            </div>
            <h2 id="product-modal-title" className="mt-1 font-display text-2xl font-bold">
              {product ? t("Edit product") : t("Add product")}
            </h2>
          </div>
          <button
            className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong"
            onClick={onClose}
            aria-label={t("Close product form")}
          >
            ×
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
          {error && (
            <div className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <label className="block text-sm font-semibold">
              {t("Product name")} <span className="text-danger">*</span>
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
              {t("Category (optional)")}
              <select
                className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">{t("No category")}</option>
                {categories.filter((item) =>
                  !item.category_name.toLowerCase().startsWith("archived") || item.category_id === product?.category_id
                ).map((item) => (
                  <option key={item.category_id} value={item.category_id}>
                    {categoryName(item.category_id, item.category_name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              {t("Price")} <span className="text-danger">*</span>
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
                {t("Product image")} <span className="font-normal text-ink-faint">({t("optional")})</span>
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
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-6">
            {product ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving || deleting}
                className="w-full rounded-xl border border-danger/30 px-4 py-2.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {deleting ? "Deleting…" : "Delete product"}
              </button>
            ) : <span />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
            <Button type="button" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving || deleting} className="w-full sm:w-auto">
              {saving ? "Saving…" : product ? "Save changes" : "Add product"}
            </Button>
            </div>
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
  const { t, productName } = usePreferences();
  useModalScrollLock();

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto overscroll-contain bg-ink/45 p-3 backdrop-blur-sm sm:p-5"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="deactivate-product-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <Icon name="minus" className="size-6" />
        </div>
        <h2 id="deactivate-product-title" className="mt-5 font-display text-xl font-bold">
          {t("Deactivate")} {productName(product.product_id, product.product_name)}?
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
  const { t, language, formatMoney } = usePreferences();
  const itemStatus = itemCount === 0
    ? t("No products added yet")
    : language === "ko"
      ? `${itemCount}개 상품 ${t("ready for checkout")}`
      : `${itemCount} ${itemCount === 1 ? t("item") : t("items")} ${t("ready for checkout")}`;

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
                {t("Current order")}
              </div>
            </div>
            <div className="mt-0.5 truncate text-xs text-ink-faint">
              {itemStatus}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {t("Order total")}
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
              {t("Complete Transaction")} <Icon name="arrow" />
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

function statisticsQuery(filters: Filters): URLSearchParams {
  const query = new URLSearchParams({ group: filters.group });
  // "All dates" sends no range: the API then reports on every recorded sale,
  // so the browser no longer downloads the whole order history to find it.
  if (filters.preset !== "all") {
    const now = new Date();
    const firstDay = new Date(now);
    if (filters.preset === "7d") firstDay.setDate(now.getDate() - 6);
    if (filters.preset === "30d") firstDay.setDate(now.getDate() - 29);
    query.set("start", localDate(firstDay));
    query.set("end", localDate(now));
  }
  if (filters.startTime) query.set("start_time", `${filters.startTime}:00`);
  if (filters.endTime) query.set("end_time", `${filters.endTime}:59`);
  filters.days.forEach((day) => query.append("weekdays", String(DAYS.indexOf(day))));
  filters.categories.forEach((id) => query.append("category_ids", String(id)));
  if (filters.promocode) query.set("promocode", filters.promocode);
  return query;
}

function Analysis({
  data,
  loading,
  appMode,
}: {
  data: AppData;
  loading: boolean;
  appMode: "simple" | "advanced";
}) {
  const { t, language, productName, categoryName, campaignName, ensureTranslations, formatMoney } = usePreferences();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [view, setView] = useState<"sales" | "marketing">("sales");
  const [trendProductId, setTrendProductId] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    state: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ state: "idle" });
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [campaignOptions, setCampaignOptions] = useState<Campaign[]>([]);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState("");
  const query = useMemo(
    () => statisticsQuery(appMode === "simple" ? { ...DEFAULT_FILTERS, preset: filters.preset } : filters),
    [appMode, filters],
  );

  useEffect(() => {
    if (loading) return;
    const controller = new AbortController();

    setReportLoading(true);
    setReportError("");
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

  useEffect(() => {
    getCampaigns().then(setCampaignOptions).catch(() => setCampaignOptions([]));
  }, []);

  useEffect(() => {
    if (campaignOptions.length) {
      void ensureTranslations(campaignOptions.map((campaign) => ({
        source_text: campaign.campaign_name,
        context: "campaign" as const,
      })));
    }
  }, [campaignOptions, ensureTranslations]);

  const summary = statistics?.summary;

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
      const current = scope === "current";
      const filename = await exportAnalytics({
        scope,
        // The full report covers every sale: no dates and no filters.
        query: current ? query : new URLSearchParams({ group: filters.group }),
        statistics: current && !reportLoading ? (statistics ?? undefined) : undefined,
        categories: data.categories,
        filters: current ? filters : undefined,
      });
      setExportOpen(false);
      setExportStatus({ state: "success", message: `${filename} · ${t("downloaded")}` });
      window.setTimeout(() => setExportStatus({ state: "idle" }), 3500);
    } catch (caught) {
      setExportStatus({
        state: "error",
        message: caught instanceof Error ? caught.message : t("Export failed. Please try again."),
      });
    }
  }

  if (loading) return <LoadingAnalysis />;

  if (appMode === "simple") {
    return (
      <SimpleAnalysisDashboard
        statistics={statistics}
        reportLoading={reportLoading}
        reportError={reportError}
        filters={filters}
        onPresetChange={(preset) => setFilters((current) => ({ ...current, preset }))}
      />
    );
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-display text-3xl font-bold tracking-tight">{t("Analysis")}</div>
          <div className="mt-1 text-sm text-ink-muted">
            {t("Explore sales, customers, and campaign performance.")}
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("Analysis view")}>
          <Button
            aria-pressed={view === "sales"}
            variant={view === "sales" ? "primary" : "secondary"}
            onClick={() => setView("sales")}
          >
            {t("Sales analysis")}
          </Button>
          <Button
            aria-pressed={view === "marketing"}
            variant={view === "marketing" ? "primary" : "secondary"}
            onClick={() => setView("marketing")}
          >
            {t("Marketing analysis")}
          </Button>
        </div>
      </div>
      <Surface className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <FilterGroup label={t("Date range")}>
            <div className="flex gap-1 rounded-xl bg-surface-strong p-1">
              {(["today", "7d", "30d", "all"] as DatePreset[]).map((preset) => (
                <Button
                  key={preset}
                  variant="ghost"
                  onClick={() => setFilters((current) => ({ ...current, preset }))}
                  className={`min-h-9 px-3 ${filters.preset === preset ? "bg-white text-accent-strong shadow-sm" : ""}`}
                >
                  {preset === "today" ? t("Today") : preset === "all" ? t("All") : t(preset)}
                </Button>
              ))}
            </div>
          </FilterGroup>
          {view === "sales" && (
            <FilterGroup label={t("Campaign used")}>
              <select
                aria-label={t("Filter sales by campaign used")}
                className="min-h-11 min-w-48 rounded-xl border border-line bg-white px-3 text-sm"
                value={filters.promocode}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, promocode: event.target.value }))
                }
              >
                <option value="">{t("All campaigns")}</option>
                <option value="__none__">{t("No campaign code")}</option>
                {campaignOptions.map((campaign) => (
                  <option key={campaign.promocode} value={campaign.promocode}>
                    {campaignName(campaign.campaign_name)} ({campaign.promocode})
                  </option>
                ))}
              </select>
            </FilterGroup>
          )}
          {view === "sales" && (
            <FilterGroup label={t("Group by")}>
              <select
                aria-label={t("Group by")}
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
                    {t(GROUP_LABELS[group])}
                  </option>
                ))}
              </select>
            </FilterGroup>
          )}
          <FilterGroup label={t("Time of day")}>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={filters.startTime}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, startTime: event.target.value }))
                }
              />
              <span className="text-ink-faint">{t("to")}</span>
              <Input
                type="time"
                value={filters.endTime}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, endTime: event.target.value }))
                }
              />
            </div>
          </FilterGroup>
          <FilterGroup label={t("Day of week")}>
            <div className="flex flex-wrap gap-1">
              {DAYS.map((day) => (
                <Button
                  key={day}
                  variant="chip"
                  onClick={() => toggleDay(day)}
                  className={`min-h-9 px-3 ${filters.days.includes(day) ? "border-accent bg-accent-soft text-accent-strong" : ""}`}
                >
                  {language === "ko" ? t(day).slice(0, 1) : day.slice(0, 3)}
                </Button>
              ))}
            </div>
          </FilterGroup>
          {data.categories.length > 0 && (
            <FilterGroup label={t("Category")}>
              <div className="flex flex-wrap gap-1">
                {data.categories.map((item) => (
                  <Button
                    key={item.category_id}
                    variant="chip"
                    onClick={() => toggleCategory(item.category_id)}
                    className={`min-h-9 px-3 ${filters.categories.includes(item.category_id) ? "border-accent bg-accent-soft text-accent-strong" : ""}`}
                  >
                    {categoryName(item.category_id, item.category_name)}
                  </Button>
                ))}
              </div>
            </FilterGroup>
          )}
          <Button variant="ghost" onClick={resetFilters}>
            <span className="flex items-center gap-2">
              <Icon name="reset" /> {t("Reset")}
            </span>
          </Button>
          <div className="ml-auto rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong">
            {summary?.orders ?? 0} {t("matching orders")}
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
                  {exportStatus.state === "loading" ? t("Exporting…") : t("Export report")}
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
                        <strong className="block text-sm">{t("Download current view")}</strong>
                        <small className="mt-1 block leading-5 text-ink-muted">
                          {t("Uses the selected date range, days, times, and categories.")}
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
                        <strong className="block text-sm">{t("Download full report")}</strong>
                        <small className="mt-1 block leading-5 text-ink-muted">
                          {t("Downloads all available analytics without active filters.")}
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
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t("Net revenue")} value={formatMoney(Number(summary?.net ?? 0))} />
          <Kpi label={t("Orders")} value={String(summary?.orders ?? 0)} />
          <Kpi
            label={t("Average order value")}
            value={formatMoney(Number(summary?.average_order_value ?? 0))}
          />
          <Kpi label={t("Items sold")} value={String(summary?.units ?? 0)} />
        </div>
      )}
      {reportError ? (
        <EmptyState title={t("Could not load sales report")} message={reportError} />
      ) : !statistics ? (
        <LoadingAnalysis />
      ) : (
        // While a new report loads, the previous one stays on screen, dimmed.
        <div
          aria-busy={reportLoading}
          className={`transition-opacity ${reportLoading ? "pointer-events-none opacity-60" : ""}`}
        >
          {statistics.warnings.map((warning) => {
            const mismatch = warning.match(/^([\d,]+) order totals disagree with item subtotals minus discounts; analytics uses item amounts minus allocated discounts\.?$/i);
            const message = mismatch
              ? t("{count} order totals disagree with item subtotals minus discounts; analytics uses item amounts minus allocated discounts.").replace("{count}", mismatch[1])
              : warning;
            return (
              <p key={warning} role="status" className="mb-3 text-sm text-ink-muted">
                {message}
              </p>
            );
          })}
          {view === "marketing" ? (
            <Suspense fallback={<LoadingAnalysis />}>
              <MarketingAnalysis statistics={statistics} query={query.toString()} />
            </Suspense>
          ) : statistics.summary.orders === 0 ? (
            <EmptyState
              title={t("No sales match these filters")}
              message={t("Adjust the filters or complete a new sale to see analytics.")}
            />
          ) : (
            <>
              <ChartGrid
                statistics={statistics}
                categories={data.categories}
                trendProductId={trendProductId}
                onSelectTrendProduct={setTrendProductId}
              />
              <LazySection minHeight={700} className="mt-5">
                <Suspense
                  fallback={<div className="h-[700px] animate-pulse rounded-2xl bg-surface-strong" />}
                >
                  <SalesBreakdowns statistics={statistics} />
                </Suspense>
              </LazySection>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function SimpleAnalysisDashboard({
  statistics,
  reportLoading,
  reportError,
  filters,
  onPresetChange,
}: {
  statistics: Statistics | null;
  reportLoading: boolean;
  reportError: string;
  filters: Filters;
  onPresetChange: (preset: DatePreset) => void;
}) {
  const { t, language, productName, formatMoney } = usePreferences();
  const topFiveProducts = (statistics?.products ?? [])
    .filter((product) => product.units > 0)
    .sort((a, b) => b.units - a.units || a.product_id - b.product_id)
    .slice(0, 5)
    .map((product) => ({
      label: productName(product.product_id, product.product_name),
      value: product.units,
    }));
  const revenueByPeriod = (statistics?.periods ?? []).map((row) => ({
    label: row.period,
    value: Number(row.net),
  }));

  return (
    <section>
      <div className="mb-6">
        <div className="font-display text-3xl font-bold tracking-tight">{t("Analysis")}</div>
        <div className="mt-1 text-sm text-ink-muted">
          {t("See how your sales are performing at a glance.")}
        </div>
      </div>

      <Surface className="mb-5 p-4">
        <FilterGroup label={t("Date range")}>
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-strong p-1">
            {(["today", "7d", "30d", "all"] as DatePreset[]).map((preset) => (
              <Button
                key={preset}
                variant="ghost"
                onClick={() => onPresetChange(preset)}
                className={`min-h-9 px-3 ${filters.preset === preset ? "bg-white text-accent-strong shadow-sm" : ""}`}
              >
                {preset === "today" ? t("Today") : preset === "all" ? t("All") : t(preset)}
              </Button>
            ))}
          </div>
        </FilterGroup>
      </Surface>

      {reportError ? (
        <EmptyState title={t("Could not load sales report")} message={reportError} />
      ) : !statistics ? (
        <LoadingAnalysis />
      ) : (
        <div
          aria-busy={reportLoading}
          className={`transition-opacity ${reportLoading ? "pointer-events-none opacity-60" : ""}`}
        >
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Kpi label={t("Net revenue")} value={formatMoney(Number(statistics.summary.net ?? 0))} />
            <Kpi label={t("Orders")} value={String(statistics.summary.orders ?? 0)} />
          </div>

          {statistics.summary.orders === 0 ? (
            <EmptyState
              title={t("No sales match these filters")}
              message={t("Adjust the date range or complete a new sale to see analytics.")}
            />
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <PeriodChart
                title={t("Revenue over time")}
                data={revenueByPeriod}
                group={statistics.group}
                metric="net revenue"
                locale={language === "ko" ? "ko-KR" : "en-US"}
                weekPrefix={t("Week of")}
                valueFormatter={formatMoney}
              />
              {topFiveProducts.length > 0 ? (
                <BarChart
                  title={t("Top 5 products by quantity")}
                  data={topFiveProducts}
                  valueFormatter={(value) => value.toLocaleString(language === "ko" ? "ko-KR" : "en-US")}
                  horizontal
                />
              ) : (
                <Surface className="min-w-0 p-5">
                  <div className="mb-5 font-display text-lg font-bold">{t("Top 5 products by quantity")}</div>
                  <div className="text-sm text-ink-muted">{t("No product sales in this period.")}</div>
                </Surface>
              )}
            </div>
          )}
        </div>
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
  const { t, language, productName, categoryName, formatMoney } = usePreferences();
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
    label: t(DAYS[row.weekday]),
    value: Number(row.net),
  }));
  const byCategory = statistics.by_category.map((row) => ({
    label: row.category_id === null
      ? t("Uncategorized")
      : categoryName(row.category_id, categoryNames.get(row.category_id) ?? `Category ${row.category_id}`),
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
    .map((product) => ({ label: productName(product.product_id, product.product_name), value: product.units }));
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
        title={t("Revenue over time")}
        data={byDate}
        group={statistics.group}
        metric="net revenue"
        locale={language === "ko" ? "ko-KR" : "en-US"}
        weekPrefix={t("Week of")}
        valueFormatter={formatMoney}
      />
      <BarChart title={t("Revenue by hour")} data={byHour} valueFormatter={formatMoney} labelStep={4} />
      <BarChart title={t("Revenue by day of week")} data={byDay} valueFormatter={formatMoney} />
      <BarChart title={t("Sales by category")} data={byCategory} valueFormatter={formatMoney} />
      <LazySection minHeight={446} className="lg:col-span-2">
        <label className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
          {t("Period for product bars")}
          <select
            className="min-h-10 max-w-full rounded-xl border border-line bg-white px-3"
            value={barPeriod}
            onChange={(event) => setBarPeriod(event.target.value)}
          >
            <option value="">{t("All selected dates")}</option>
            {statistics.periods.map((point) => (
              <option key={point.period} value={point.period}>
                {formatPeriod(point.period, statistics.group, true, false, language === "ko" ? "ko-KR" : "en-US", t("Week of"))}
              </option>
            ))}
          </select>
        </label>
        {topProducts.length > 0 ? (
          <BarChart
            title={t("Top 10 products by quantity")}
            data={topProducts}
            valueFormatter={(value) => String(value)}
            horizontal
          />
        ) : (
          <Surface className="p-5 text-sm text-ink-muted">{t("No product sales in this period.")}</Surface>
        )}
      </LazySection>
      <LazySection minHeight={386} className="lg:col-span-2">
        <label className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
          {t("Product for units over time")}
          <select
            className="min-h-10 max-w-full rounded-xl border border-line bg-white px-3"
            value={trendProduct?.product_id ?? 0}
            onChange={(event) => onSelectTrendProduct(Number(event.target.value))}
          >
            <option value={0}>{t("All matching products")}</option>
            {statistics.products.map((product) => (
              <option key={product.product_id} value={product.product_id}>
                {productName(product.product_id, product.product_name)}
              </option>
            ))}
          </select>
        </label>
        <PeriodChart
          title={t("Units sold over time")}
          data={unitsByPeriod}
          group={statistics.group}
          metric="units sold"
          locale={language === "ko" ? "ko-KR" : "en-US"}
          weekPrefix={t("Week of")}
          valueFormatter={(value) => value.toLocaleString(language === "ko" ? "ko-KR" : "en-US")}
        />
      </LazySection>
    </div>
  );
}

interface ChartDatum {
  label: string;
  value: number;
}

function formatPeriod(
  period: string,
  group: StatisticsGroup,
  full: boolean,
  spansYears = false,
  locale = "en-US",
  weekPrefix = "Week of",
): string {
  if (group === "year") return period;
  const date = new Date(`${period}${group === "month" ? "-01" : ""}T00:00:00Z`);
  if (group === "month") {
    return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  }
  const options: Intl.DateTimeFormatOptions = full
    ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
    : spansYears
      ? { month: "numeric", day: "numeric", year: "2-digit", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" };
  const label = new Intl.DateTimeFormat(locale, options).format(date);
  return group === "week" && full ? `${weekPrefix} ${label}` : label;
}

interface PeriodChartProps {
  data: ChartDatum[];
  group: StatisticsGroup;
  title: string;
  metric: string;
  valueFormatter: (value: number) => string;
  locale?: string;
  weekPrefix?: string;
}

function PeriodChart(props: PeriodChartProps) {
  if (props.data.length > 1) return <PeriodTrend {...props} />;
  const data = props.data.map((point) => ({
    ...point,
    label: formatPeriod(point.label, props.group, true, false, props.locale, props.weekPrefix),
  }));
  return <BarChart title={props.title} data={data} valueFormatter={props.valueFormatter} />;
}

function PeriodTrend({ data, group, title, metric, valueFormatter, locale, weekPrefix }: PeriodChartProps) {
  const { t } = usePreferences();
  const [inspectedIndex, setInspectedIndex] = useState<number | null>(null);
  const lastIndex = data.length - 1;
  const activeIndex = Math.min(inspectedIndex ?? lastIndex, lastIndex);
  const active = data[activeIndex];
  const activeDate = formatPeriod(active.label, group, true, false, locale, weekPrefix);
  const activeValue = valueFormatter(active.value);
  const description = t(`${GROUP_LABELS[group]} ${metric}`);
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
            {group === "week" ? ` · ${t("weeks start Monday")}` : ""}
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
            aria-label={`${t("Inspect")} ${description.toLowerCase()}`}
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
                {formatPeriod(data[index].label, group, false, spansYears, locale, weekPrefix)}
              </span>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {t("Hover or tap the chart to see the value for a period.")}
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
