import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addCustomer,
  getCustomerSummaries,
  saveOrder,
  validateCampaign,
  type CampaignValidation,
  type Customer,
  type CustomerSummary,
  type OrderLineInput,
  type Product,
  type SavedOrder,
} from "./data-access";
import { Button, Icon, Input, Surface } from "./ui";

type CustomerMode = "walk-in" | "registered";

const MONEY = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

interface CheckoutLine extends OrderLineInput {
  product_name: string;
}

export function CheckoutModal({
  products,
  selection,
  onClose,
  onSaved,
  onDone,
}: {
  products: Product[];
  selection: Record<number, number>;
  onClose: () => void;
  onSaved: (saved: SavedOrder) => void;
  onDone: (saved: SavedOrder) => void;
}) {
  const [lines] = useState<CheckoutLine[]>(() =>
    products
      .filter((product) => selection[product.product_id])
      .map((product) => ({
        product_id: product.product_id,
        product_name: product.product_name,
        quantity: selection[product.product_id],
        price: product.price,
      })),
  );
  const [mode, setMode] = useState<CustomerMode>("walk-in");
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerError, setCustomerError] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [registering, setRegistering] = useState(false);
  const [campaignCode, setCampaignCode] = useState("");
  const [campaign, setCampaign] = useState<CampaignValidation | null>(null);
  const [campaignError, setCampaignError] = useState("");
  const [validatingCampaign, setValidatingCampaign] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [saved, setSaved] = useState<SavedOrder | null>(null);

  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discount = campaign?.valid ? campaign.discount : 0;
  const finalTotal = subtotal - discount;

  useEffect(() => {
    getCustomerSummaries()
      .then((customerRecords) => {
        setCustomers(customerRecords);
      })
      .catch((caught) => {
        setCustomerError(
          caught instanceof Error ? caught.message : "Customer records could not be loaded.",
        );
      })
      .finally(() => setCustomerLoading(false));
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting && !saved) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saved, submitting]);

  const customerStats = useMemo<Map<string, { orders: number; spending: number }>>(
    () => new Map(customers.map((customer) => [
      customer.customer_phone,
      { orders: Number(customer.total_orders ?? 0), spending: Number(customer.total_spent ?? 0) },
    ] as const)),
    [customers],
  );

  const matchingCustomers = useMemo(() => {
    const query = customerSearch.trim().toLowerCase();
    if (!query) return customers.slice(0, 5);
    return customers
      .filter(
        (customer) =>
          customer.customer_name.toLowerCase().includes(query) ||
          customer.customer_phone.includes(query),
      )
      .slice(0, 6);
  }, [customerSearch, customers]);

  async function applyCampaign(): Promise<void> {
    setValidatingCampaign(true);
    setCampaignError("");
    setCampaign(null);
    try {
      const result = await validateCampaign(campaignCode, subtotal);
      if (result.valid) {
        setCampaign(result);
        setCampaignCode(result.code);
      } else {
        setCampaignError(result.message);
      }
    } catch (caught) {
      setCampaignError(caught instanceof Error ? caught.message : "The code could not be checked.");
    } finally {
      setValidatingCampaign(false);
    }
  }

  async function confirmTransaction(): Promise<void> {
    if (submitting || saved) return;
    if (mode === "registered" && !selectedCustomer) {
      setSubmitError("Select or register a customer before using registered checkout.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await saveOrder(
        lines.map(({ product_name: _productName, ...line }) => line),
        {
          customer_phone: mode === "registered" ? selectedCustomer?.customer_phone : null,
          promocode: campaign?.valid ? campaign.code : null,
        },
      );
      setSaved(result);
      onSaved(result);
    } catch (caught) {
      setSubmitError(
        caught instanceof Error ? caught.message : "The transaction could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (saved) {
    return (
      <ModalFrame closeDisabled onClose={onClose}>
        <div className="flex min-h-[560px] items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent text-white shadow-lg">
              <Icon name="check" className="size-8" />
            </div>
            <div className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-accent">
              Transaction complete
            </div>
            <h2 id="checkout-title" className="mt-2 font-display text-3xl font-bold">
              Sale confirmed
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              The transaction has been saved and is now available in Orders and Analysis.
            </p>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-canvas p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Order ID
                </div>
                <div className="mt-1 font-display text-lg font-bold">
                  ORD-{String(saved.order.order_id).padStart(4, "0")}
                </div>
              </div>
              <div className="rounded-2xl bg-accent-soft p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                  Final amount
                </div>
                <div className="mt-1 font-display text-lg font-bold text-accent-strong">
                  {MONEY.format(saved.order.total)}
                </div>
              </div>
            </div>
            <Button variant="primary" className="mt-7 w-full" onClick={() => onDone(saved)}>
              Done
            </Button>
          </div>
        </div>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame closeDisabled={submitting} onClose={onClose}>
      <header className="flex items-start justify-between border-b border-line px-6 py-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-accent">
            Complete transaction
          </div>
          <h2 id="checkout-title" className="mt-1 font-display text-2xl font-bold">
            Checkout
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Confirm the customer, apply an optional campaign, and complete the sale.
          </p>
        </div>
        <button
          className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong disabled:opacity-45"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close checkout"
        >
          ×
        </button>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_390px]">
        <div className="overflow-y-auto p-6">
          <div className="grid grid-cols-2 rounded-xl bg-surface-strong p-1">
            <button
              className={`rounded-lg px-4 py-3 text-sm font-bold transition ${
                mode === "walk-in" ? "bg-ink text-white shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => {
                setMode("walk-in");
                setSubmitError("");
              }}
            >
              Walk-in Customer
            </button>
            <button
              className={`rounded-lg px-4 py-3 text-sm font-bold transition ${
                mode === "registered"
                  ? "bg-ink text-white shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => {
                setMode("registered");
                setSubmitError("");
              }}
            >
              Registered Customer
            </button>
          </div>

          {mode === "walk-in" ? (
            <WalkInPanel />
          ) : (
            <RegisteredCustomerPanel
              customers={matchingCustomers}
              stats={customerStats}
              loading={customerLoading}
              error={customerError}
              search={customerSearch}
              selected={selectedCustomer}
              registering={registering}
              onSearch={setCustomerSearch}
              onSelect={(customer) => {
                setSelectedCustomer(customer);
                setRegistering(false);
                setSubmitError("");
              }}
              onRegister={() => setRegistering(true)}
              onCancelRegister={() => setRegistering(false)}
              onRegistered={(customer) => {
                setCustomers((current) => [
                  ...current,
                  { ...customer, total_orders: 0, total_spent: 0, last_order_date: null },
                ]);
                setSelectedCustomer(customer);
                setRegistering(false);
                setCustomerSearch("");
                setSubmitError("");
              }}
            />
          )}

          <Surface className="mt-5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display font-bold">Campaign code</h3>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  Optional. Eligibility is based on campaign rules and is available to walk-in
                  customers when allowed.
                </p>
              </div>
              {campaign?.valid && (
                <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong">
                  Applied
                </span>
              )}
            </div>
            {campaign?.valid ? (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-accent/20 bg-accent-soft p-4">
                <div>
                  <div className="font-display font-bold text-accent-strong">{campaign.code}</div>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{campaign.message}</p>
                </div>
                <Button
                  className="shrink-0 min-h-9 px-3"
                  onClick={() => {
                    setCampaign(null);
                    setCampaignCode("");
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-4 flex gap-2">
                  <Input
                    className="min-w-0 flex-1 uppercase"
                    value={campaignCode}
                    onChange={(event) => {
                      setCampaignCode(event.target.value.toUpperCase());
                      setCampaignError("");
                    }}
                    placeholder="e.g. WELCOME10"
                    disabled={validatingCampaign}
                  />
                  <Button
                    variant="secondary"
                    disabled={!campaignCode.trim() || validatingCampaign}
                    onClick={() => void applyCampaign()}
                  >
                    {validatingCampaign ? "Checking…" : "Apply"}
                  </Button>
                </div>
                {campaignError && (
                  <p className="mt-2 text-xs font-medium leading-5 text-danger">{campaignError}</p>
                )}
              </>
            )}
          </Surface>
        </div>

        <aside className="flex flex-col border-t border-line bg-canvas lg:border-l lg:border-t-0">
          <div className="flex-1 overflow-y-auto p-6">
            <h3 className="font-display text-lg font-bold">Order summary</h3>
            <p className="mt-1 text-xs text-ink-muted">
              {lines.reduce((sum, line) => sum + line.quantity, 0)} items in this transaction
            </p>
            <div className="mt-5 space-y-3">
              {lines.map((line) => (
                <div
                  key={line.product_id}
                  className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{line.product_name}</div>
                    <div className="mt-0.5 text-xs text-ink-faint">
                      {line.quantity} × {MONEY.format(line.price)}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-bold">
                    {MONEY.format(line.price * line.quantity)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
              <SummaryRow label="Subtotal" value={MONEY.format(subtotal)} />
              <SummaryRow
                label="Campaign"
                value={campaign?.valid ? campaign.code : "None"}
                accent={Boolean(campaign?.valid)}
              />
              <SummaryRow
                label="Discount"
                value={discount ? `−${MONEY.format(discount)}` : MONEY.format(0)}
                accent={discount > 0}
              />
              <div className="border-t border-line pt-4">
                <SummaryRow label="Final total" value={MONEY.format(finalTotal)} strong />
              </div>
            </div>
          </div>
          <div className="border-t border-line bg-white p-6">
            {submitError && (
              <div className="mb-3 rounded-xl bg-danger-soft px-4 py-3 text-xs font-medium text-danger">
                {submitError}
              </div>
            )}
            <Button
              variant="primary"
              className="w-full"
              disabled={submitting || (mode === "registered" && !selectedCustomer)}
              onClick={() => void confirmTransaction()}
            >
              {submitting
                ? "Processing transaction…"
                : `Confirm Transaction · ${MONEY.format(finalTotal)}`}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-4 text-ink-faint">
              {mode === "walk-in"
                ? "No customer information is required."
                : selectedCustomer
                  ? `This sale will be linked to ${selectedCustomer.customer_name}.`
                  : "Select a customer to continue."}
            </p>
          </div>
        </aside>
      </div>
    </ModalFrame>
  );
}

function ModalFrame({
  children,
  onClose,
  closeDisabled = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-ink/50 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <section
        className="flex max-h-[calc(100vh-2rem)] min-h-[640px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

function WalkInPanel() {
  return (
    <Surface className="mt-5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
          <Icon name="users" />
        </div>
        <div>
          <h3 className="font-display font-bold">Walk-in Customer</h3>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Complete this sale immediately without collecting customer information. Registration is
            always optional.
          </p>
        </div>
      </div>
    </Surface>
  );
}

function RegisteredCustomerPanel({
  customers,
  stats,
  loading,
  error,
  search,
  selected,
  registering,
  onSearch,
  onSelect,
  onRegister,
  onCancelRegister,
  onRegistered,
}: {
  customers: Customer[];
  stats: Map<string, { orders: number; spending: number }>;
  loading: boolean;
  error: string;
  search: string;
  selected: Customer | null;
  registering: boolean;
  onSearch: (value: string) => void;
  onSelect: (customer: Customer) => void;
  onRegister: () => void;
  onCancelRegister: () => void;
  onRegistered: (customer: Customer) => void;
}) {
  if (registering) {
    return <RegistrationForm onCancel={onCancelRegister} onRegistered={onRegistered} />;
  }

  return (
    <Surface className="mt-5 overflow-hidden">
      <div className="p-5">
        <h3 className="font-display font-bold">Find a registered customer</h3>
        <p className="mt-1 text-xs text-ink-muted">Search by Korean name or mobile phone number.</p>
        <div className="relative mt-4">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-faint"
          />
          <Input
            className="w-full pl-10"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="김지윤 or 010-4821-1934"
            autoFocus
          />
        </div>
      </div>

      {selected && (
        <div className="mx-5 mb-4 flex items-center justify-between gap-4 rounded-xl border border-accent/20 bg-accent-soft p-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-accent-strong">
              Selected customer
            </div>
            <div className="mt-1 font-display font-bold">{selected.customer_name}</div>
            <div className="mt-0.5 text-xs text-ink-muted">{selected.customer_phone}</div>
          </div>
          <Icon name="check" className="size-6 shrink-0 text-accent-strong" />
        </div>
      )}

      <div className="max-h-64 overflow-y-auto border-t border-line">
        {loading ? (
          <div className="p-5 text-sm text-ink-muted">Loading customers…</div>
        ) : error ? (
          <div className="p-5 text-sm text-danger">{error}</div>
        ) : customers.length ? (
          <div className="divide-y divide-line">
            {customers.map((customer) => {
              const customerSummary = stats.get(customer.customer_phone) ?? {
                orders: 0,
                spending: 0,
              };
              const isSelected = selected?.customer_phone === customer.customer_phone;
              return (
                <button
                  key={customer.customer_phone}
                  className={`flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition hover:bg-canvas ${
                    isSelected ? "bg-accent-soft/60" : ""
                  }`}
                  onClick={() => onSelect(customer)}
                >
                  <div className="min-w-0">
                    <div className="font-semibold">{customer.customer_name}</div>
                    <div className="mt-0.5 text-xs text-ink-faint">{customer.customer_phone}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-semibold">{customerSummary.orders} orders</div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {MONEY.format(customerSummary.spending)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-5 text-center">
            <div className="font-semibold">No matching customer found</div>
            <p className="mt-1 text-xs text-ink-muted">
              Register a customer or return to walk-in checkout.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-canvas/60 p-4">
        <Button className="w-full" onClick={onRegister}>
          <span className="flex items-center justify-center gap-2">
            <Icon name="plus" className="size-4" /> Register New Customer
          </span>
        </Button>
      </div>
    </Surface>
  );
}

function RegistrationForm({
  onCancel,
  onRegistered,
}: {
  onCancel: () => void;
  onRegistered: (customer: Customer) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function formatPhone(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim() || !/^010-\d{4}-\d{4}$/.test(phone)) {
      setError("Enter a customer name and a valid Korean mobile number.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const customer = await addCustomer({
        customer_name: name.trim(),
        customer_phone: phone,
        customer_age: null,
        customer_gender: null,
      });
      onRegistered(customer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The customer could not be registered.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Surface className="mt-5 p-5">
      <div>
        <div className="text-xs font-bold uppercase tracking-wide text-accent">New customer</div>
        <h3 className="mt-1 font-display text-lg font-bold">Quick registration</h3>
        <p className="mt-1 text-xs text-ink-muted">Only a name and phone number are required.</p>
      </div>
      <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
        {error && (
          <div className="rounded-xl bg-danger-soft px-4 py-3 text-xs font-medium text-danger">
            {error}
          </div>
        )}
        <label className="block text-sm font-semibold">
          Customer name
          <Input
            className="mt-1.5 w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. 김민준"
            autoFocus
            required
          />
        </label>
        <label className="block text-sm font-semibold">
          Phone number
          <Input
            className="mt-1.5 w-full"
            value={phone}
            onChange={(event) => setPhone(formatPhone(event.target.value))}
            placeholder="010-1234-5678"
            inputMode="tel"
            required
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onCancel} disabled={saving}>
            Back to search
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Registering…" : "Register & Select"}
          </Button>
        </div>
      </form>
    </Surface>
  );
}

function SummaryRow({
  label,
  value,
  accent = false,
  strong = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "font-bold" : "text-ink-muted"}>{label}</span>
      <span
        className={`${strong ? "font-display text-xl font-bold" : "font-semibold"} ${
          accent ? "text-accent-strong" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
