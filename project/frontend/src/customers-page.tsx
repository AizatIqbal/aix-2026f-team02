
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  addCustomer,
  deleteCustomer,
  getCustomerOrders,
  getCustomerSummaries,
  updateCustomer,
  type Customer,
  type CustomerSummary,
  type Order,
} from "./data-access";
import { Button, Icon, Input, Surface } from "./ui";

type SortKey = "name" | "orders" | "spent";
type FormMode = { type: "add" } | { type: "edit"; customer: Customer };

const PAGE_SIZE = 6;

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

interface CustomerRow {
  customer: CustomerSummary;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string | null;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [detailOrders, setDetailOrders] = useState<Order[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormMode | null>(null);
  const [detail, setDetail] = useState<CustomerSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Customer | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    getCustomerSummaries()
        .then((customerRecords) => {
          setCustomers(customerRecords);
        })
        .catch((caught) => {
          setError(
              caught instanceof Error
                  ? caught.message
                  : "Customer records could not be loaded."
          );
        })
        .finally(() => setLoading(false));
  }, []);

  const rows = useMemo<CustomerRow[]>(
      () =>
          customers.map((customer) => ({
            customer,
            totalOrders: Number(customer.total_orders ?? 0),
            totalSpent: Number(customer.total_spent ?? 0),
            lastOrderDate: customer.last_order_date,
          })),
      [customers]
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();

    return rows
        .filter(
            ({ customer }) =>
                !query ||
                customer.customer_name.toLocaleLowerCase().includes(query) ||
                customer.customer_phone.includes(query)
        )
        .sort((a, b) => {
          if (sort === "orders") return b.totalOrders - a.totalOrders;
          if (sort === "spent") return b.totalSpent - a.totalSpent;

          return a.customer.customer_name.localeCompare(
              b.customer.customer_name,
              "ko"
          );
        });
  }, [rows, search, sort]);

  const totalPages = Math.max(
      1,
      Math.ceil(filteredRows.length / PAGE_SIZE)
  );

  const visibleRows = filteredRows.slice(
      (page - 1) * PAGE_SIZE,
      page * PAGE_SIZE
  );

  const linkedOrders = rows.reduce(
      (sum, row) => sum + row.totalOrders,
      0
  );

  const totalSpent = rows.reduce(
      (sum, row) => sum + row.totalSpent,
      0
  );

  useEffect(() => {
    setPage(1);
  }, [search, sort]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }

  async function openCustomerDetail(customer: CustomerSummary) {
    setDetail(customer);
    setDetailOrders([]);
    setDetailLoading(true);

    try {
      const recentOrders = await getCustomerOrders(
          customer.customer_phone,
          8
      );

      setDetailOrders(recentOrders);
    } catch (caught) {
      setError(
          caught instanceof Error
              ? caught.message
              : "Customer order history could not be loaded."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;

    try {
      await deleteCustomer(pendingDelete.customer_phone);

      setCustomers((current) =>
          current.filter(
              (customer) =>
                  customer.customer_phone !== pendingDelete.customer_phone
          )
      );

      setPendingDelete(null);
      setDetail(null);
      showNotice("Customer deleted");
    } catch (caught) {
      setError(
          caught instanceof Error
              ? caught.message
              : "The customer could not be deleted."
      );
    }
  }

  return (
      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-display text-3xl font-bold tracking-tight">
              Customers
            </div>

            <div className="mt-1 text-sm text-ink-muted">
              Manage customer information and understand customer activity.
            </div>
          </div>

          <Button
              variant="primary"
              onClick={() => setForm({ type: "add" })}
          >
          <span className="flex items-center gap-2">
            <Icon name="plus" />
            Add Customer
          </span>
          </Button>
        </div>

        {error && (
            <div className="mb-5 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {error}
            </div>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
              label="Total Customers"
              value={String(customers.length)}
          />

          <SummaryCard
              label="Total Orders"
              value={String(linkedOrders)}
          />

          <SummaryCard
              label="Total Customer Spending"
              value={MONEY.format(totalSpent)}
          />

          <SummaryCard
              label="Average Spending per Customer"
              value={MONEY.format(
                  customers.length ? totalSpent / customers.length : 0
              )}
          />
        </div>

        <Surface className="overflow-visible">
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
            <div className="relative min-w-56 flex-1">
              <Icon
                  name="search"
                  className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-faint"
              />

              <Input
                  className="w-full pl-10"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name or phone number"
                  aria-label="Search customers"
              />
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
              Sort by

              <select
                  className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"
                  value={sort}
                  onChange={(event) =>
                      setSort(event.target.value as SortKey)
                  }
              >
                <option value="name">Customer name</option>
                <option value="orders">Total orders</option>
                <option value="spent">Total spending</option>
              </select>
            </label>

            <div className="rounded-full bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong">
              {filteredRows.length}{" "}
              {filteredRows.length === 1 ? "customer" : "customers"}
            </div>
          </div>

          {loading ? (
              <TableLoading />
          ) : visibleRows.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Icon name="users" className="size-7" />
                </div>

                <h2 className="mt-4 font-display text-xl font-bold">
                  No customers found
                </h2>

                <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">
                  Try a different name or phone number, or add a new customer
                  record.
                </p>
              </div>
          ) : (
              <>
                {/* Allow the dropdown to escape the table wrapper when open. */}
                <div
                    className={
                      openMenu ? "overflow-visible" : "overflow-x-auto"
                    }
                >
                  <table className="w-full min-w-[930px] text-left text-sm">
                    <thead className="bg-surface-strong/70 text-xs uppercase tracking-wide text-ink-faint">
                    <tr>
                      <th className="px-5 py-3.5 font-semibold">
                        Customer
                      </th>

                      <th className="px-5 py-3.5 font-semibold">
                        Phone Number
                      </th>

                      <th className="px-5 py-3.5 font-semibold">
                        Total Orders
                      </th>

                      <th className="px-5 py-3.5 font-semibold">
                        Total Spent
                      </th>

                      <th className="px-5 py-3.5 font-semibold">
                        Last Order Date
                      </th>

                      <th className="px-5 py-3.5 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                    </thead>

                    <tbody className="divide-y divide-line">
                    {visibleRows.map((row, rowIndex) => {
                      const menuIsOpen =
                          openMenu === row.customer.customer_phone;

                      return (
                          <tr
                              key={row.customer.customer_phone}
                              className="transition-colors hover:bg-canvas"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent-strong">
                              {row.customer.customer_name.slice(0, 1)}
                            </span>

                                <div>
                                  <button
                                      className="font-semibold hover:text-accent-strong"
                                      onClick={() =>
                                          void openCustomerDetail(row.customer)
                                      }
                                  >
                                    {row.customer.customer_name}
                                  </button>

                                  <div className="mt-0.5 text-xs text-ink-faint">
                                    {row.customer.customer_age
                                        ? `${row.customer.customer_age} years`
                                        : "Age not recorded"}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="px-5 py-4 font-medium tabular-nums">
                              {row.customer.customer_phone}
                            </td>

                            <td className="px-5 py-4 font-semibold tabular-nums">
                              {row.totalOrders.toLocaleString()}
                            </td>

                            {/* Explicitly prevent unwanted strikethrough. */}
                            <td className="px-5 py-4 font-semibold tabular-nums">
                          <span
                              style={{ textDecoration: "none" }}
                          >
                            {MONEY.format(row.totalSpent)}
                          </span>
                            </td>

                            <td className="px-5 py-4 text-ink-muted">
                              {row.lastOrderDate
                                  ? DATE.format(
                                      new Date(`${row.lastOrderDate}T12:00:00`)
                                  )
                                  : "—"}
                            </td>

                            {/* Raise the active dropdown above adjacent rows. */}
                            <td
                                className={`relative px-5 py-4 text-right ${
                                    menuIsOpen ? "z-50" : ""
                                }`}
                            >
                              <Button
                                  variant="secondary"
                                  className="min-h-9 px-3"
                                  aria-haspopup="menu"
                                  aria-expanded={menuIsOpen}
                                  onClick={() =>
                                      setOpenMenu((current) =>
                                          current === row.customer.customer_phone
                                              ? null
                                              : row.customer.customer_phone
                                      )
                                  }
                              >
                            <span className="flex items-center gap-1.5">
                              Actions
                              <Icon name="chevron" className="size-4" />
                            </span>
                              </Button>

                              {menuIsOpen && (
                                  <div
                                      role="menu"
                                      className={`absolute right-5 z-[100] w-44 rounded-xl border border-line bg-white p-1.5 text-left shadow-xl ${
                                          rowIndex >= visibleRows.length - 2
                                              ? "bottom-14"
                                              : "top-14"
                                      }`}
                                  >
                                    <ActionItem
                                        label="View Details"
                                        onClick={() => {
                                          void openCustomerDetail(row.customer);
                                          setOpenMenu(null);
                                        }}
                                    />

                                    <ActionItem
                                        label="Edit Customer"
                                        onClick={() => {
                                          setForm({
                                            type: "edit",
                                            customer: row.customer,
                                          });
                                          setOpenMenu(null);
                                        }}
                                    />

                                    <ActionItem
                                        label="Delete Customer"
                                        danger
                                        onClick={() => {
                                          setPendingDelete(row.customer);
                                          setOpenMenu(null);
                                        }}
                                    />
                                  </div>
                              )}
                            </td>
                          </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                  <p className="text-sm text-ink-muted">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, filteredRows.length)} of{" "}
                    {filteredRows.length}
                  </p>

                  <div className="flex items-center gap-2">
                    <Button
                        className="min-h-9 px-3"
                        disabled={page === 1}
                        onClick={() =>
                            setPage((current) => current - 1)
                        }
                    >
                      Previous
                    </Button>

                    <span className="min-w-20 text-center text-sm font-semibold">
                  {page} of {totalPages}
                </span>

                    <Button
                        className="min-h-9 px-3"
                        disabled={page === totalPages}
                        onClick={() =>
                            setPage((current) => current + 1)
                        }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
          )}
        </Surface>

        {form && (
            <CustomerForm
                mode={form}
                onClose={() => setForm(null)}
                onSaved={(customer, originalPhone) => {
                  setCustomers((current) =>
                      originalPhone
                          ? current.map((record) =>
                              record.customer_phone === originalPhone
                                  ? { ...record, ...customer }
                                  : record
                          )
                          : [
                            ...current,
                            {
                              ...customer,
                              total_orders: 0,
                              total_spent: 0,
                              last_order_date: null,
                            },
                          ]
                  );

                  setDetail((current) => {
                    if (!current || current.customer_phone !== originalPhone) {
                      return current;
                    }

                    return {
                      ...current,
                      customer_phone: customer.customer_phone,
                      customer_name: customer.customer_name,
                      customer_age: customer.customer_age,
                      customer_gender: customer.customer_gender,
                    };
                  });

                  setForm(null);
                  showNotice(
                      originalPhone ? "Customer updated" : "Customer added"
                  );
                }}
            />
        )}

        {detail && (
            <CustomerDetail
                customer={detail}
                orders={detailOrders}
                loading={detailLoading}
                onClose={() => setDetail(null)}
                onEdit={() =>
                    setForm({ type: "edit", customer: detail })
                }
            />
        )}

        {pendingDelete && (
            <ConfirmDelete
                customer={pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => void confirmDelete()}
            />
        )}

        {notice && (
            <div
                role="status"
                className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl"
            >
              <Icon name="check" className="size-5 text-accent-light" />
              {notice}
            </div>
        )}
      </section>
  );
}

function SummaryCard({
                       label,
                       value,
                     }: {
  label: string;
  value: string;
}) {
  return (
      <Surface className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {label}
        </div>

        <div
            className="mt-2 truncate font-display text-2xl font-bold"
            title={value}
        >
          {value}
        </div>
      </Surface>
  );
}

function ActionItem({
                      label,
                      onClick,
                      danger = false,
                    }: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
      <button
          role="menuitem"
          className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface-strong ${
              danger ? "text-danger" : "text-ink"
          }`}
          onClick={onClick}
      >
        {label}
      </button>
  );
}

function CustomerForm({
                        mode,
                        onClose,
                        onSaved,
                      }: {
  mode: FormMode;
  onClose: () => void;
  onSaved: (customer: Customer, originalPhone?: string) => void;
}) {
  const existing = mode.type === "edit" ? mode.customer : null;

  const [name, setName] = useState(existing?.customer_name ?? "");
  const [phone, setPhone] = useState(existing?.customer_phone ?? "");
  const [age, setAge] = useState(existing?.customer_age?.toString() ?? "");
  const [gender, setGender] = useState(existing?.customer_gender ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);

    if (digits.length <= 3) return digits;

    if (digits.length <= 7) {
      return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim() || !/^010-\d{4}-\d{4}$/.test(phone)) {
      setError(
          "Enter a customer name and a valid Korean mobile number."
      );
      return;
    }

    const numericAge = age ? Number(age) : null;

    if (
        numericAge !== null &&
        (!Number.isInteger(numericAge) ||
            numericAge < 1 ||
            numericAge > 120)
    ) {
      setError("Age must be between 1 and 120.");
      return;
    }

    const input: Customer = {
      customer_name: name.trim(),
      customer_phone: phone,
      customer_age: numericAge,
      customer_gender: gender || null,
    };

    setSaving(true);
    setError("");

    try {
      const saved =
          mode.type === "edit"
              ? await updateCustomer(
                  mode.customer.customer_phone,
                  input
              )
              : await addCustomer(input);

      onSaved(
          saved,
          mode.type === "edit"
              ? mode.customer.customer_phone
              : undefined
      );
    } catch (caught) {
      setError(
          caught instanceof Error
              ? caught.message
              : "The customer could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
      <div
          className="fixed inset-0 z-[60] grid place-items-center bg-ink/45 p-5 backdrop-blur-sm"
          role="presentation"
          onMouseDown={onClose}
      >
        <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-form-title"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="flex items-start justify-between border-b border-line px-6 py-5">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-accent">
                Customer record
              </div>

              <h2
                  id="customer-form-title"
                  className="mt-1 font-display text-2xl font-bold"
              >
                {mode.type === "edit"
                    ? "Edit customer"
                    : "Add customer"}
              </h2>
            </div>

            <button
                className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong"
                onClick={onClose}
                aria-label="Close customer form"
            >
              ×
            </button>
          </header>

          <form
              className="p-6"
              onSubmit={(event) => void submit(event)}
          >
            {error && (
                <div className="mb-5 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
                  {error}
                </div>
            )}

            <div className="space-y-4">
              <label className="block text-sm font-semibold">
                Customer name <span className="text-danger">*</span>

                <Input
                    className="mt-2 w-full"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. 김하늘"
                    autoFocus
                    required
                />
              </label>

              <label className="block text-sm font-semibold">
                Phone number <span className="text-danger">*</span>

                <Input
                    className="mt-2 w-full tabular-nums"
                    type="tel"
                    value={phone}
                    onChange={(event) =>
                        setPhone(formatPhone(event.target.value))
                    }
                    placeholder="010-1234-5678"
                    required
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Age{" "}
                  <span className="font-normal text-ink-faint">
                  (optional)
                </span>

                  <Input
                      className="mt-2 w-full"
                      type="number"
                      min="1"
                      max="120"
                      value={age}
                      onChange={(event) => setAge(event.target.value)}
                      placeholder="Age"
                  />
                </label>

                <label className="block text-sm font-semibold">
                  Gender{" "}
                  <span className="font-normal text-ink-faint">
                  (optional)
                </span>

                  <select
                      className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                      value={gender}
                      onChange={(event) => setGender(event.target.value)}
                  >
                    <option value="">Not recorded</option>
                    <option value="Woman">Woman</option>
                    <option value="Man">Man</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>

              <Button
                  variant="primary"
                  type="submit"
                  disabled={saving}
              >
                {saving
                    ? "Saving…"
                    : mode.type === "edit"
                        ? "Save changes"
                        : "Add customer"}
              </Button>
            </div>
          </form>
        </section>
      </div>
  );
}

function CustomerDetail({
                          customer,
                          orders,
                          loading,
                          onClose,
                          onEdit,
                        }: {
  customer: CustomerSummary;
  orders: Order[];
  loading: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const sortedOrders = [...orders].sort((a, b) =>
      `${b.order_date}${b.order_time}`.localeCompare(
          `${a.order_date}${a.order_time}`
      )
  );

  const totalSpent = Number(customer.total_spent ?? 0);

  return (
      <div
          className="fixed inset-0 z-50 flex justify-end bg-ink/35 backdrop-blur-sm"
          role="presentation"
          onMouseDown={onClose}
      >
        <aside
            className="flex h-full w-full max-w-xl flex-col bg-canvas shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="flex items-start justify-between border-b border-line bg-white px-6 py-5">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-accent">
                Customer details
              </div>

              <h2
                  id="customer-detail-title"
                  className="mt-1 font-display text-2xl font-bold"
              >
                {customer.customer_name}
              </h2>
            </div>

            <button
                className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong"
                onClick={onClose}
                aria-label="Close customer details"
            >
              ×
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-6">
            <Surface className="p-5">
              <div className="flex items-center gap-4">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft font-display text-xl font-bold text-accent-strong">
                {customer.customer_name.slice(0, 1)}
              </span>

                <div>
                  <div className="font-display text-xl font-bold">
                    {customer.customer_name}
                  </div>

                  <div className="mt-1 text-sm text-ink-muted">
                    {customer.customer_phone}
                  </div>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 text-sm">
                <div>
                  <dt className="text-ink-faint">Age</dt>
                  <dd className="mt-1 font-semibold">
                    {customer.customer_age ?? "Not recorded"}
                  </dd>
                </div>

                <div>
                  <dt className="text-ink-faint">Gender</dt>
                  <dd className="mt-1 font-semibold">
                    {customer.customer_gender ?? "Not recorded"}
                  </dd>
                </div>
              </dl>
            </Surface>

            <div className="my-5 grid grid-cols-2 gap-3">
              <Surface className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Total Orders
                </div>

                <div className="mt-2 font-display text-2xl font-bold">
                  {Number(customer.total_orders ?? 0).toLocaleString()}
                </div>
              </Surface>

              <Surface className="p-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Total Spent
                </div>

                <div className="mt-2 font-display text-2xl font-bold">
                  {MONEY.format(totalSpent)}
                </div>
              </Surface>
            </div>

            <h3 className="font-display text-lg font-bold">
              Recent order history
            </h3>

            <p className="mt-1 text-sm text-ink-muted">
              Orders linked to this phone number.
            </p>

            <Surface className="mt-4 overflow-hidden">
              {loading ? (
                  <div className="p-8 text-center text-sm text-ink-muted">
                    Loading recent orders…
                  </div>
              ) : sortedOrders.length ? (
                  <div className="divide-y divide-line">
                    {sortedOrders.slice(0, 8).map((order) => (
                        <div
                            key={order.order_id}
                            className="flex items-center justify-between gap-4 px-4 py-3.5"
                        >
                          <div>
                            <div className="text-sm font-semibold">
                              Order #
                              {String(order.order_id).padStart(4, "0")}
                            </div>

                            <div className="mt-1 text-xs text-ink-faint">
                              {DATE.format(
                                  new Date(`${order.order_date}T12:00:00`)
                              )}{" "}
                              · {order.order_time.slice(0, 5)}
                            </div>
                          </div>

                          <div className="font-semibold tabular-nums">
                            {MONEY.format(order.total)}
                          </div>
                        </div>
                    ))}
                  </div>
              ) : (
                  <div className="p-8 text-center text-sm text-ink-muted">
                    No orders are linked to this customer yet.
                  </div>
              )}
            </Surface>
          </div>

          <footer className="border-t border-line bg-white px-6 py-4">
            <Button
                variant="primary"
                className="w-full"
                onClick={onEdit}
            >
              Edit Customer
            </Button>
          </footer>
        </aside>
      </div>
  );
}

function ConfirmDelete({
                         customer,
                         onClose,
                         onConfirm,
                       }: {
  customer: Customer;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
      <div
          className="fixed inset-0 z-[70] grid place-items-center bg-ink/45 p-5 backdrop-blur-sm"
          role="presentation"
          onMouseDown={onClose}
      >
        <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
            <Icon name="trash" className="size-6" />
          </div>

          <h2
              id="delete-title"
              className="mt-5 font-display text-xl font-bold"
          >
            Delete {customer.customer_name}?
          </h2>

          <p className="mt-2 text-sm leading-6 text-ink-muted">
            This removes the customer record. Existing orders will remain
            in sales history but will no longer be linked to this customer.
          </p>

          <div className="mt-6 flex justify-end gap-3">
            <Button onClick={onClose}>Cancel</Button>

            <Button
                className="border-danger bg-danger text-white hover:bg-danger"
                onClick={onConfirm}
            >
              Delete Customer
            </Button>
          </div>
        </section>
      </div>
  );
}

function TableLoading() {
  return (
      <div className="space-y-px p-5">
        {Array.from({ length: 6 }, (_, index) => (
            <div
                key={index}
                className="h-16 animate-pulse rounded-xl bg-surface-strong"
            />
        ))}
      </div>
  );
}
