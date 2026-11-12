import { useEffect, useMemo, useState } from "react";
import { getOrderDetail, getOrdersPage, type Order, type OrderItem } from "./data-access";
import { Button, Icon, Input, Surface } from "./ui";

type DatePreset = "today" | "7d" | "30d" | "all" | "custom";
type SortDirection = "newest" | "oldest" | "highest" | "lowest";

const PAGE_SIZE = 8;
const MONEY = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function orderDateTime(order: Order): Date {
  return new Date(`${order.order_date}T${order.order_time}`);
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState({ orders: 0, revenue: 0, average: 0, items: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [preset, setPreset] = useState<DatePreset>("30d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sort, setSort] = useState<SortDirection>("newest");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedItems, setSelectedItems] = useState<OrderItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const dateBounds = useMemo(() => {
    if (preset === "all") return { start: "", end: "" };
    if (preset === "custom") return { start: startDate, end: endDate };
    const end = new Date();
    const start = new Date(end);
    if (preset === "7d") start.setDate(end.getDate() - 6);
    if (preset === "30d") start.setDate(end.getDate() - 29);
    return { start: localDate(start), end: localDate(end) };
  }, [endDate, preset, startDate]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        sort,
      });
      if (dateBounds.start) query.set("start_date", dateBounds.start);
      if (dateBounds.end) query.set("end_date", dateBounds.end);
      if (orderSearch.trim()) query.set("order_query", orderSearch.trim());
      if (customerSearch.trim()) query.set("customer_query", customerSearch.trim());

      setLoading(true);
      setError("");
      getOrdersPage(query, controller.signal)
        .then((result) => {
          setOrders(result.items);
          setTotal(result.total);
          setSummary(result.summary);
        })
        .catch((caught) => {
          if (!controller.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "Orders could not be loaded.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, orderSearch || customerSearch ? 250 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerSearch, dateBounds.end, dateBounds.start, orderSearch, page, sort]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function resetFilters(): void {
    setOrderSearch("");
    setCustomerSearch("");
    setPreset("30d");
    setStartDate("");
    setEndDate("");
    setSort("newest");
    setPage(1);
  }

  async function openOrderDetails(order: Order): Promise<void> {
    setSelectedOrder(order);
    setSelectedItems([]);
    setDetailLoading(true);
    try {
      const detail = await getOrderDetail(order.order_id);
      setSelectedItems(detail.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Order details could not be loaded.");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-6">
        <div className="font-display text-3xl font-bold tracking-tight">Orders</div>
        <div className="mt-1 text-sm text-ink-muted">
          View and manage your restaurant&apos;s sales transactions.
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Total Orders" value={summary.orders.toLocaleString()} detail="Matching transactions" />
        <SummaryCard label="Total Revenue" value={MONEY.format(summary.revenue)} detail="Final sales total" />
        <SummaryCard label="Average Order Value" value={MONEY.format(summary.average)} detail="Per transaction" />
        <SummaryCard label="Total Items Sold" value={summary.items.toLocaleString()} detail="Product units" />
      </div>

      <Surface className="mb-5 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold">Filter orders</h2>
              <p className="mt-0.5 text-xs text-ink-faint">
                Refine transactions by reference, customer, or date.
              </p>
            </div>
            <Button className="min-h-9 px-3" onClick={resetFilters}>
              <span className="flex items-center gap-2">
                <Icon name="reset" className="size-4" /> Reset
              </span>
            </Button>
          </div>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-2 xl:grid-cols-[0.75fr_1.2fr_1fr]">
          <label className="block text-xs font-semibold text-ink-muted">
            Order ID
            <div className="relative mt-1.5">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
              <Input
                className="w-full pl-9"
                value={orderSearch}
                onChange={(event) => { setOrderSearch(event.target.value); setPage(1); }}
                placeholder="e.g. ORD-0018"
              />
            </div>
          </label>
          <label className="block text-xs font-semibold text-ink-muted">
            Customer name or phone
            <div className="relative mt-1.5">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
              <Input
                className="w-full pl-9"
                value={customerSearch}
                onChange={(event) => { setCustomerSearch(event.target.value); setPage(1); }}
                placeholder="김지윤 or 010-4821-1934"
              />
            </div>
          </label>
          <label className="block text-xs font-semibold text-ink-muted">
            Sort by
            <select
              className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              value={sort}
              onChange={(event) => { setSort(event.target.value as SortDirection); setPage(1); }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="highest">Highest amount</option>
              <option value="lowest">Lowest amount</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-4 border-t border-line bg-canvas/45 px-5 py-4">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-ink-muted">Quick date</div>
            <div className="flex flex-wrap gap-2">
              {([
                ["today", "Today"], ["7d", "7 Days"], ["30d", "30 Days"], ["all", "All"],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant={preset === value ? "primary" : "chip"}
                  className="min-h-9 px-3"
                  onClick={() => { setPreset(value); setPage(1); }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
            <label className="block text-xs font-semibold text-ink-muted">
              From
              <Input
                className="mt-1.5 block"
                type="date"
                value={preset === "custom" ? startDate : dateBounds.start}
                onChange={(event) => { setStartDate(event.target.value); setPreset("custom"); setPage(1); }}
              />
            </label>
            <span className="mb-3 text-ink-faint">—</span>
            <label className="block text-xs font-semibold text-ink-muted">
              To
              <Input
                className="mt-1.5 block"
                type="date"
                value={preset === "custom" ? endDate : dateBounds.end}
                onChange={(event) => { setEndDate(event.target.value); setPreset("custom"); setPage(1); }}
              />
            </label>
          </div>
        </div>
      </Surface>

      <Surface className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold">Sales transactions</h2>
            <p className="mt-0.5 text-sm text-ink-muted">Select an order to view its item details.</p>
          </div>
          <div className="rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong">
            {total.toLocaleString()} matching {total === 1 ? "order" : "orders"}
          </div>
        </div>

        {loading ? (
          <OrderTableLoading />
        ) : orders.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="search" className="size-7" />
            </div>
            <h2 className="mt-4 font-display text-xl font-bold">No transactions found</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">
              No orders match the current search and date filters. Reset the filters to view all transactions.
            </p>
            <Button className="mt-5" onClick={resetFilters}>Clear filters</Button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-surface-strong/70 text-xs uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="px-5 py-3.5 font-semibold">Order ID</th>
                    <th className="px-5 py-3.5 font-semibold">Order Date &amp; Time</th>
                    <th className="px-5 py-3.5 font-semibold">Customer</th>
                    <th className="px-5 py-3.5 font-semibold">Items</th>
                    <th className="px-5 py-3.5 font-semibold">Total Amount</th>
                    <th className="px-5 py-3.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orders.map((order) => {
                    const dateTime = orderDateTime(order);
                    return (
                      <tr key={order.order_id} className="cursor-pointer transition-colors hover:bg-canvas" onClick={() => void openOrderDetails(order)}>
                        <td className="px-5 py-4">
                          <span className="font-display font-bold text-accent-strong">ORD-{String(order.order_id).padStart(4, "0")}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="font-semibold">{DATE.format(dateTime)}</div>
                          <div className="mt-0.5 text-xs text-ink-faint">{TIME.format(dateTime)}</div>
                        </td>
                        <td className="px-5 py-4">
                          {order.customer_phone ? (
                            <>
                              <div className="font-semibold">{order.customer_name ?? "Registered customer"}</div>
                              <div className="mt-0.5 text-xs text-ink-faint">{order.customer_phone}</div>
                            </>
                          ) : (
                            <>
                              <div className="font-medium text-ink-muted">Guest customer</div>
                              <div className="mt-0.5 text-xs text-ink-faint">No customer linked</div>
                            </>
                          )}
                        </td>
                        <td className="px-5 py-4 font-semibold tabular-nums">{Number(order.item_count ?? 0).toLocaleString()}</td>
                        <td className="px-5 py-4 font-display font-bold tabular-nums">{MONEY.format(order.total)}</td>
                        <td className="px-5 py-4 text-right">
                          <Button className="min-h-9 px-3" onClick={(event) => { event.stopPropagation(); void openOrderDetails(order); }}>
                            <span className="flex items-center gap-1.5">View details <Icon name="arrow" className="size-4" /></span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
              <p className="text-sm text-ink-muted">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <Button className="min-h-9 px-3" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                <span className="min-w-20 text-center text-sm font-semibold">{page} of {totalPages}</span>
                <Button className="min-h-9 px-3" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Surface>

      {selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          items={selectedItems}
          loading={detailLoading}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </section>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Surface className="relative overflow-hidden p-5">
      <div className="absolute -right-6 -top-6 size-20 rounded-full bg-accent-soft/70" />
      <div className="relative">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="mt-2 truncate font-display text-2xl font-bold" title={value}>{value}</div>
        <div className="mt-1 text-xs text-ink-muted">{detail}</div>
      </div>
    </Surface>
  );
}

function OrderTableLoading() {
  return (
    <div className="space-y-px bg-line">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid grid-cols-6 gap-5 bg-white px-5 py-5">
          {Array.from({ length: 6 }, (_, cell) => (
            <div key={cell} className={`h-4 animate-pulse rounded bg-surface-strong ${cell === 2 ? "col-span-2" : ""}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function OrderDetail({
  order,
  items,
  loading,
  onClose,
}: {
  order: Order;
  items: OrderItem[];
  loading: boolean;
  onClose: () => void;
}) {
  const totalItems = items.reduce((total, item) => total + item.quantity, 0);
  const subtotal = items.reduce((total, item) => total + item.quantity * item.price, 0);
  const dateTime = orderDateTime(order);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-ink/45 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
      <section className="flex h-full w-full max-w-2xl flex-col bg-canvas shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="order-detail-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-line bg-white px-6 py-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-accent">Transaction detail</div>
            <h2 id="order-detail-title" className="mt-1 font-display text-2xl font-bold">Order ORD-{String(order.order_id).padStart(4, "0")}</h2>
          </div>
          <button className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong" onClick={onClose} aria-label="Close order details">×</button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <Surface className="p-5">
            <h3 className="font-display text-lg font-bold">Order information</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailField label="Order ID" value={`ORD-${String(order.order_id).padStart(4, "0")}`} />
              <DetailField label="Date & time" value={`${DATE.format(dateTime)} at ${TIME.format(dateTime)}`} />
              <DetailField label="Customer" value={order.customer_name ?? "Guest customer"} secondary={order.customer_phone ?? "No customer linked"} />
              <DetailField label="Total amount" value={MONEY.format(order.total)} />
            </div>
          </Surface>

          <Surface className="mt-5 overflow-hidden">
            <div className="border-b border-line px-5 py-4">
              <h3 className="font-display text-lg font-bold">Order items</h3>
              <p className="mt-0.5 text-sm text-ink-muted">Products included in this transaction.</p>
            </div>
            {loading ? (
              <div className="p-8 text-center text-sm text-ink-muted">Loading order items…</div>
            ) : items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="bg-surface-strong/70 text-xs uppercase tracking-wide text-ink-faint">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Category</th>
                      <th className="px-5 py-3 text-right font-semibold">Unit Price</th>
                      <th className="px-5 py-3 text-right font-semibold">Qty</th>
                      <th className="px-5 py-3 text-right font-semibold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((item) => (
                      <tr key={item.order_item_id ?? `${item.order_id}-${item.product_id}`}>
                        <td className="px-5 py-4 font-semibold">{item.product_name ?? `Product #${item.product_id}`}</td>
                        <td className="px-5 py-4 text-ink-muted">{item.category_name ?? "Uncategorized"}</td>
                        <td className="px-5 py-4 text-right tabular-nums">{MONEY.format(item.price)}</td>
                        <td className="px-5 py-4 text-right font-semibold tabular-nums">{item.quantity}</td>
                        <td className="px-5 py-4 text-right font-semibold tabular-nums">{MONEY.format(item.price * item.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-ink-muted">No item details were found for this order.</div>
            )}
          </Surface>

          <Surface className="mt-5 ml-auto max-w-sm p-5">
            <h3 className="font-display text-lg font-bold">Order summary</h3>
            <div className="mt-4 space-y-3 text-sm">
              <SummaryLine label="Total items" value={totalItems.toLocaleString()} />
              <SummaryLine label="Subtotal" value={MONEY.format(subtotal)} />
              {order.discount > 0 && <SummaryLine label="Discount" value={`−${MONEY.format(order.discount)}`} accent />}
              <div className="border-t border-line pt-3"><SummaryLine label="Final total" value={MONEY.format(order.total)} strong /></div>
            </div>
          </Surface>
        </div>

        <footer className="border-t border-line bg-white px-6 py-4 text-right">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </footer>
      </section>
    </div>
  );
}

function DetailField({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {secondary && <div className="mt-0.5 text-xs text-ink-muted">{secondary}</div>}
    </div>
  );
}

function SummaryLine({ label, value, strong = false, accent = false }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 ${strong ? "text-base" : ""}`}>
      <span className={strong ? "font-bold" : "text-ink-muted"}>{label}</span>
      <span className={`${strong ? "font-display text-lg font-bold" : "font-semibold"} ${accent ? "text-accent-strong" : ""}`}>{value}</span>
    </div>
  );
}
