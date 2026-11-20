import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addCustomer,
  getCampaigns,
  getCustomerSummaries,
  saveOrder,
  validateCampaign,
  type Campaign,
  type CampaignValidation,
  type Customer,
  type CustomerSummary,
  type OrderLineInput,
  type Product,
  type SavedOrder,
} from "./data-access";
import { Button, Icon, Input, Surface, useModalScrollLock } from "./ui";
import { usePreferences } from "./preferences";

type CustomerMode = "walk-in" | "registered";

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
  const { t, productName, formatMoney } = usePreferences();
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
  const [availableCampaigns, setAvailableCampaigns] = useState<Campaign[]>([]);
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
    getCampaigns()
      .then((records) => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        setAvailableCampaigns(records.filter((item) => item.start_date.slice(0, 10) <= today && item.end_date.slice(0, 10) >= today));
      })
      .catch(() => setAvailableCampaigns([]));
  }, []);

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
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto overscroll-contain p-5 text-center sm:p-8">
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
                  {formatMoney(saved.order.total)}
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
      <header className="flex shrink-0 items-start justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-accent">
            {t("Complete transaction")}
          </div>
          <h2 id="checkout-title" className="mt-1 font-display text-2xl font-bold">
            {t("Checkout")}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {t("Confirm the customer, apply an optional campaign, and complete the sale.")}
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

      <div className="pointnull-checkout-layout grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,0.8fr)] overflow-hidden">
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">
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
              {t("Walk-in Customer")}
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
              {t("Registered Customer")}
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
                <h3 className="font-display font-bold">{t("Campaign code")}</h3>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {t("Optional. Eligibility is based on campaign rules and is available to walk-in customers when allowed.")}
                </p>
              </div>
              {campaign?.valid && (
                <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong">
                  {t("Applied")}
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
                  {t("Remove")}
                </Button>
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-2">
                  <select
                    aria-label="Choose a currently running campaign"
                    className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm"
                    value={campaignCode}
                    disabled={validatingCampaign}
                    onChange={(event) => {
                      setCampaignCode(event.target.value);
                      setCampaignError("");
                    }}
                  >
                    <option value="">{t("Choose a running campaign code…")}</option>
                    {availableCampaigns.map((item) => (
                      <option key={item.promocode} value={item.promocode}>
                        {item.promocode} — {item.campaign_name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Input
                      className="min-w-0 flex-1 uppercase"
                      value={campaignCode}
                      onChange={(event) => {
                        setCampaignCode(event.target.value.toUpperCase());
                        setCampaignError("");
                      }}
                      placeholder={t("Or enter a code manually")}
                      disabled={validatingCampaign}
                    />
                    <Button
                      variant="secondary"
                      disabled={!campaignCode.trim() || validatingCampaign}
                      onClick={() => void applyCampaign()}
                    >
                      {validatingCampaign ? t("Checking…") : t("Apply")}
                    </Button>
                  </div>
                  {campaignError && (
                    <p className="mt-2 text-xs font-medium leading-5 text-danger">{campaignError}</p>
                  )}
                </div>
              </>
            )}
          </Surface>
        </div>

        <aside className="flex min-h-0 flex-col border-t border-line bg-canvas lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <h3 className="font-display text-lg font-bold">{t("Order summary")}</h3>
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
                    <div className="truncate text-sm font-semibold">{productName(line.product_id, line.product_name)}</div>
                    <div className="mt-0.5 text-xs text-ink-faint">
                      {line.quantity} × {formatMoney(line.price)}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-bold">
                    {formatMoney(line.price * line.quantity)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
              <SummaryRow label={t("Subtotal")} value={formatMoney(subtotal)} />
              <SummaryRow
                label={t("Campaign")}
                value={campaign?.valid ? campaign.code : t("None")}
                accent={Boolean(campaign?.valid)}
              />
              <SummaryRow
                label={t("Discount")}
                value={discount ? `−${formatMoney(discount)}` : formatMoney(0)}
                accent={discount > 0}
              />
              <div className="border-t border-line pt-4">
                <SummaryRow label={t("Final total")} value={formatMoney(finalTotal)} strong />
              </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-line bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
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
                ? t("Processing transaction…")
                : `${t("Confirm Transaction")} · ${formatMoney(finalTotal)}`}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-4 text-ink-faint">
              {mode === "walk-in"
                ? t("No customer information is required.")
                : selectedCustomer
                  ? `This sale will be linked to ${selectedCustomer.customer_name}.`
                  : t("Select a customer to continue.")}
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
  const { displaySize } = usePreferences();
  useModalScrollLock();

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto overscroll-contain bg-ink/50 p-2 backdrop-blur-sm sm:p-4"
      role="presentation"
      onMouseDown={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <section
        className="pointnull-checkout-dialog my-auto flex max-h-[calc(100dvh-1rem)] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
        data-display-size={displaySize}
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
  const { t } = usePreferences();
  return (
    <Surface className="mt-5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
          <Icon name="users" />
        </div>
        <div>
          <h3 className="font-display font-bold">{t("Walk-in Customer")}</h3>
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
  const { formatMoney } = usePreferences();

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
                      {formatMoney(customerSummary.spending)}
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
  const { t } = usePreferences();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
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

    const numericAge = age.trim() ? Number(age) : null;
    if (
      numericAge !== null &&
      (!Number.isInteger(numericAge) || numericAge < 1 || numericAge > 120)
    ) {
      setError("Age must be between 1 and 120.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const customer = await addCustomer({
        customer_name: name.trim(),
        customer_phone: phone,
        customer_age: numericAge,
        customer_gender: gender || null,
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
        <div className="text-xs font-bold uppercase tracking-wide text-accent">{t("New customer")}</div>
        <h3 className="mt-1 font-display text-lg font-bold">{t("Quick registration")}</h3>
        <p className="mt-1 text-xs text-ink-muted">{t("Only a name and phone number are required.")}</p>
      </div>
      <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
        {error && (
          <div className="rounded-xl bg-danger-soft px-4 py-3 text-xs font-medium text-danger">
            {error}
          </div>
        )}
        <label className="block text-sm font-semibold">
          {t("Customer name")}
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
          {t("Phone number")}
          <Input
            className="mt-1.5 w-full"
            value={phone}
            onChange={(event) => setPhone(formatPhone(event.target.value))}
            placeholder="010-1234-5678"
            inputMode="tel"
            required
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            {t("Age")} <span className="font-normal text-ink-faint">({t("optional")})</span>
            <Input
              className="mt-1.5 w-full"
              type="number"
              min="1"
              max="120"
              step="1"
              value={age}
              onChange={(event) => setAge(event.target.value)}
              placeholder="Age"
            />
          </label>
          <label className="block text-sm font-semibold">
            {t("Gender")} <span className="font-normal text-ink-faint">({t("optional")})</span>
            <select
              className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
              value={gender}
              onChange={(event) => setGender(event.target.value)}
            >
              <option value="">{t("Not recorded")}</option>
              <option value="Woman">{t("Woman")}</option>
              <option value="Man">{t("Man")}</option>
              <option value="Other">{t("Other")}</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onCancel} disabled={saving}>
            {t("Back to search")}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? t("Registering…") : t("Register & Select")}
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
