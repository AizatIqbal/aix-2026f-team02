import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  getCustomers,
  importData,
  type Category,
  type Customer,
  type ImportPayload,
  type ImportResult,
  type Product,
} from "./data-access";
import { Button, Icon, useModalScrollLock } from "./ui";
import { usePreferences } from "./preferences";

type DataType = "categories" | "products" | "customers" | "orders" | "orderItems";
type Stage = "upload" | "mapping" | "preview" | "confirm" | "success";

const DATA_TYPES: { value: DataType; label: string; description: string; available: boolean }[] = [
  {
    value: "categories",
    label: "Categories",
    description: "Import menu groups and sections",
    available: true,
  },
  {
    value: "products",
    label: "Products",
    description: "Import items, prices, and categories",
    available: true,
  },
  {
    value: "customers",
    label: "Customers",
    description: "Import customer names and phone numbers",
    available: true,
  },
  {
    value: "orders",
    label: "Historical sales",
    description: "Past transactions and totals",
    available: false,
  },
  {
    value: "orderItems",
    label: "Order items",
    description: "Products and quantities per order",
    available: false,
  },
];

const FIELDS: Record<DataType, { value: string; label: string; required?: boolean }[]> = {
  categories: [{ value: "category_name", label: "Category name", required: true }],
  products: [
    { value: "source_product_id", label: "Source Product ID" },
    { value: "product_name", label: "Product name", required: true },
    { value: "category_name", label: "Category name (or ID)", required: true },
    { value: "price", label: "Price", required: true },
  ],
  customers: [
    { value: "customer_name", label: "Customer name", required: true },
    { value: "customer_phone", label: "Phone number", required: true },
    { value: "customer_age", label: "Age (optional)" },
    { value: "customer_gender", label: "Gender (optional)" },
  ],
  orders: [
    { value: "source_order_id", label: "Order / Transaction ID" },
    { value: "order_date", label: "Order date", required: true },
    { value: "order_time", label: "Order time" },
    { value: "day_of_week", label: "Day of week" },
    { value: "total", label: "Order total", required: true },
  ],
  orderItems: [
    { value: "order_id", label: "Order / Transaction ID", required: true },
    { value: "product_id", label: "Product ID", required: true },
    { value: "quantity", label: "Quantity", required: true },
    { value: "item_price", label: "Item price", required: true },
  ],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function suggestField(column: string, available: { value: string; label: string }[]): string {
  const source = normalize(column);
  const categoryField = available.find((field) => field.value === "category_name");
  if (
    categoryField &&
    ["category", "categoryid", "categoryname", "categorynameid"].includes(source)
  ) {
    return categoryField.value;
  }
  return (
    available.find((field) => {
      const value = normalize(field.value);
      const label = normalize(field.label);
      return (
        source === value || source === label || source.includes(value) || label.includes(source)
      );
    })?.value ?? ""
  );
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  return Number(String(value).replace(/(?:RM|[₩$€£,\s])/gi, ""));
}

function dateValue(value: unknown): string {
  if (typeof value === "number") {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    if (!Number.isNaN(excelDate.getTime())) return excelDate.toISOString().slice(0, 10);
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function ImportWizard({
  categories,
  products,
  onClose,
  onImported,
}: {
  categories: Category[];
  products: Product[];
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const { t, language } = usePreferences();
  useModalScrollLock();

  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [types, setTypes] = useState<DataType[]>(["products"]);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [existingCustomers, setExistingCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);

  useEffect(() => {
    if (!types.includes("customers")) return;
    const controller = new AbortController();
    setCustomersLoading(true);
    getCustomers(controller.signal)
      .then((records) => {
        if (!controller.signal.aborted) setExistingCustomers(records);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : t("Existing customers could not be checked."));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCustomersLoading(false);
      });
    return () => controller.abort();
  }, [types]);

  const availableFields = useMemo(
    () =>
      types.flatMap((type) =>
        FIELDS[type].map((field) => ({
          ...field,
          group: DATA_TYPES.find((item) => item.value === type)?.label ?? type,
        })),
      ),
    [types],
  );
  const mappedRows = useMemo(
    () =>
      rows.map((row) => {
        const mapped: Record<string, unknown> = {};
        columns.forEach((column) => {
          if (mapping[column]) mapped[mapping[column]] = row[column];
        });
        return mapped;
      }),
    [columns, mapping, rows],
  );
  const requiredFields = useMemo(
    () =>
      types.flatMap((type) =>
        FIELDS[type].filter((field) => field.required).map((field) => field.value),
      ),
    [types],
  );
  const validations = useMemo(() => {
    // Build lookup sets once, then validate each imported row in one pass.
    // This avoids rescanning every preceding row for each duplicate check.
    const existingCategoryNames = new Set(
      categories.map((item) => item.category_name.trim().toLowerCase()),
    );
    const seenCategoryNames = new Set<string>();
    const existingPhones = new Set(
      existingCustomers.map((customer) => customer.customer_phone.replace(/[^0-9]/g, "")),
    );
    const seenPhones = new Set<string>();
    const categoryIdsByName = new Map(
      categories.map((category) => [category.category_name.trim().toLowerCase(), category.category_id]),
    );
    const existingProductKeys = new Set(
      products.map((product) => `${product.product_name.trim().toLowerCase()}|${product.category_id ?? ""}`),
    );
    const seenProductKeys = new Set<string>();

    return mappedRows.map((row) => {
      const missing = requiredFields.filter((field) => {
        const value = row[field];
        return value === undefined || value === null || String(value).trim() === "";
      });
      const invalidNumbers = ["price", "customer_age"].filter(
        (field) =>
          row[field] !== undefined && String(row[field]).trim() !== "" &&
          (!Number.isFinite(numberValue(row[field])) || numberValue(row[field]) < 0 ||
            (field === "customer_age" && (!Number.isInteger(numberValue(row[field])) || numberValue(row[field]) > 120))),
      );
      const invalidText = [
        ...(row.product_name !== undefined && String(row.product_name).trim().length > 100
          ? ["product_name (max 100 characters)"]
          : []),
        ...(row.category_name !== undefined && String(row.category_name).trim().length > 50
          ? ["category_name (max 50 characters)"]
          : []),
        ...(row.customer_name !== undefined && String(row.customer_name).trim().length > 100
          ? ["customer_name (max 100 characters)"]
          : []),
        ...(row.customer_phone !== undefined && String(row.customer_phone).trim().length > 20
          ? ["customer_phone (max 20 characters)"]
          : []),
        ...(row.customer_gender !== undefined && String(row.customer_gender).trim().length > 20
          ? ["customer_gender (max 20 characters)"]
          : []),
      ];

      const name = String(row.product_name ?? "").trim().toLowerCase();
      const categoryName = String(row.category_name ?? "").trim().toLowerCase();
      const categoryId = /^\\d+$/.test(categoryName) ? Number(categoryName) : null;
      const phoneKey = String(row.customer_phone ?? "").replace(/[^0-9]/g, "");
      let duplicate = false;

      if (types.includes("categories")) {
        duplicate = existingCategoryNames.has(categoryName) || seenCategoryNames.has(categoryName);
        seenCategoryNames.add(categoryName);
      } else if (types.includes("customers")) {
        duplicate = Boolean(phoneKey) && (existingPhones.has(phoneKey) || seenPhones.has(phoneKey));
        if (phoneKey) seenPhones.add(phoneKey);
      } else if (name && categoryName) {
        const resolvedCategoryId = categoryId ?? categoryIdsByName.get(categoryName);
        const existingMatch =
          resolvedCategoryId !== undefined &&
          resolvedCategoryId !== null &&
          existingProductKeys.has(`${name}|${resolvedCategoryId}`);
        const categoryKey =
          resolvedCategoryId !== undefined && resolvedCategoryId !== null
            ? `id:${resolvedCategoryId}`
            : `name:${categoryName}`;
        const importedKey = `${name}|${categoryKey}`;
        duplicate = existingMatch || seenProductKeys.has(importedKey);
        seenProductKeys.add(importedKey);
      }

      return {
        row,
        missing,
        invalidNumbers,
        invalidText,
        duplicate,
        valid:
          missing.length === 0 &&
          invalidNumbers.length === 0 &&
          invalidText.length === 0 &&
          !duplicate,
      };
    });
  }, [categories, existingCustomers, mappedRows, products, requiredFields, types]);
  const validRows = validations.filter((item) => item.valid);
  const invalidRows = validations.filter((item) => !item.valid);

  function toggleType(type: DataType): void {
    if (!DATA_TYPES.find((item) => item.value === type)?.available) return;
    setTypes((current) => (current.includes(type) ? [] : [type]));
  }

  async function loadFile(selected: File): Promise<void> {
    setError("");
    if (!/\.(csv|xlsx)$/i.test(selected.name)) {
      setError(t("Choose a CSV or Excel (.xlsx) file."));
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await selected.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      if (!parsed.length) throw new Error(t("The selected file has no data rows."));
      const nextColumns = Object.keys(parsed[0]);
      const nextMapping: Record<string, string> = {};
      const fields = types.flatMap((type) => FIELDS[type]);
      nextColumns.forEach((column) => {
        nextMapping[column] = suggestField(column, fields);
      });
      setFile(selected);
      setRows(parsed);
      setColumns(nextColumns);
      setMapping(nextMapping);
      setStage("mapping");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("The file could not be read."));
    }
  }

  function dropFile(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const selected = event.dataTransfer.files[0];
    if (selected) void loadFile(selected);
  }

  function buildPayload(): ImportPayload {
    const usable = validRows.map((item) => item.row);
    const importedCategoryNames = [
      ...new Set(usable.map((row) => String(row.category_name ?? "").trim()).filter(Boolean)),
    ];

    return {
      categories: types.includes("categories")
        ? importedCategoryNames.map((category_name) => ({ category_name }))
        : [],
      products: types.includes("products")
        ? usable.map((row) => {
            const rawCategory = String(row.category_name ?? "").trim();
            const isCategoryId = /^\d+$/.test(rawCategory);
            return {
              source_product_id: numberValue(row.source_product_id) || undefined,
              product_name: String(row.product_name).trim(),
              ...(isCategoryId
                ? { category_id: Number(rawCategory) }
                : { category_name: rawCategory }),
              price: numberValue(row.price),
            };
          })
        : [],
      customers: types.includes("customers")
        ? usable.map((row) => ({
            customer_name: String(row.customer_name).trim(),
            customer_phone: String(row.customer_phone).trim(),
            customer_age: row.customer_age === undefined || String(row.customer_age).trim() === ""
              ? null
              : numberValue(row.customer_age),
            customer_gender: String(row.customer_gender ?? "").trim() || null,
          }))
        : [],
      orders: types.includes("orders")
        ? usable.map((row) => {
            const orderDate = dateValue(row.order_date);
            const date = new Date(`${orderDate}T12:00:00`);
            return {
              source_order_id: numberValue(row.source_order_id) || undefined,
              order_date: orderDate,
              order_time: String(row.order_time || "12:00:00"),
              day_of_week: String(
                row.day_of_week || date.toLocaleDateString("en-US", { weekday: "long" }),
              ),
              customer_phone: null,
              promocode: null,
              discount: 0,
              total: numberValue(row.total),
            };
          })
        : [],
      orderItems: types.includes("orderItems")
        ? usable.map((row) => ({
            order_id: numberValue(row.order_id),
            product_id: numberValue(row.product_id),
            quantity: numberValue(row.quantity),
            price: numberValue(row.item_price),
          }))
        : [],
    };
  }

  async function confirmImport(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const imported = await importData(buildPayload());
      setResult(imported);
      onImported(imported);
      setStage("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = stage === "upload" ? 1 : stage === "mapping" ? 2 : stage === "preview" ? 3 : 4;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end overflow-hidden bg-ink/45 backdrop-blur-sm"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="flex h-[100dvh] min-h-0 w-full max-w-3xl flex-col overflow-hidden bg-canvas shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-line bg-white px-5 py-4 sm:px-6 sm:py-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-accent">
              {t("Business setup")}
            </div>
            <h2 id="import-title" className="mt-1 font-display text-2xl font-bold">
              {t("Import existing data")}
            </h2>
          </div>
          <button
            className="flex size-10 items-center justify-center rounded-xl border border-line text-xl text-ink-muted hover:bg-surface-strong"
            onClick={onClose}
            aria-label={t("Close import")}
          >
            ×
          </button>
        </header>
        {stage !== "success" && (
          <div className="shrink-0 border-b border-line bg-white px-5 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-faint">
              {["Upload", "Map columns", "Review", "Confirm"].map((label, index) => (
                <div
                  key={label}
                  className={`flex flex-1 items-center gap-2 ${index + 1 <= stepNumber ? "text-accent-strong" : ""}`}
                >
                  <span
                    className={`flex size-6 items-center justify-center rounded-full ${index + 1 <= stepNumber ? "bg-accent text-white" : "bg-surface-strong"}`}
                  >
                    {index + 1}
                  </span>
                  <span className="hidden sm:inline">{t(label)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {error && (
            <div className="mb-5 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {error}
            </div>
          )}
          {stage === "upload" && (
            <div>
              <h3 className="font-display text-lg font-bold">{t("What would you like to import?")}</h3>
              <p className="mt-1 text-sm text-ink-muted">
                {t("Choose one record type. Product imports can create missing categories automatically. Customer imports check existing phone numbers for duplicates.")}
              </p>
              {types.includes("customers") && customersLoading && (
                <p className="mt-2 text-xs text-ink-muted">{t("Checking existing customer records…")}</p>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {DATA_TYPES.map((item) => (
                  <button
                    key={item.value}
                    disabled={!item.available}
                    onClick={() => toggleType(item.value)}
                    className={`rounded-2xl border p-4 text-left transition ${!item.available ? "cursor-not-allowed border-line bg-surface-strong opacity-60" : types.includes(item.value) ? "border-accent bg-accent-soft" : "border-line bg-white hover:border-accent/40"}`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex size-5 items-center justify-center rounded-md border ${types.includes(item.value) ? "border-accent bg-accent text-white" : "border-line"}`}
                      >
                        {types.includes(item.value) ? "✓" : ""}
                      </span>
                      <div>
                        <strong className="text-sm">
                          {t(item.label)}
                          {!item.available ? ` · ${t("Coming later")}` : ""}
                        </strong>
                        <p className="mt-0.5 text-xs text-ink-muted">{t(item.description)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div
                className={`mt-6 rounded-2xl border-2 border-dashed p-10 text-center transition ${dragging ? "border-accent bg-accent-soft" : "border-line bg-white"}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={dropFile}
              >
                <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Icon name="arrow" className="size-6 -rotate-90" />
                </div>
                <h3 className="mt-4 font-display font-bold">{t("Drop your spreadsheet here")}</h3>
                <p className="mt-1 text-sm text-ink-muted">{t("CSV or Excel (.xlsx)")}</p>
                <Button
                  className="mt-5"
                  onClick={() => inputRef.current?.click()}
                  disabled={types.length !== 1}
                >
                  {t("Browse files")}
                </Button>
                <input
                  ref={inputRef}
                  className="hidden"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    if (selected) void loadFile(selected);
                  }}
                />
              </div>
            </div>
          )}
          {stage === "mapping" && (
            <div>
              <FileSummary
                file={file}
                rows={rows.length}
                onRemove={() => {
                  setFile(null);
                  setRows([]);
                  setStage("upload");
                }}
              />
              <h3 className="mt-7 font-display text-lg font-bold">{t("Match your columns")}</h3>
              <p className="mt-1 text-sm text-ink-muted">
                {t("Tell PointNull what each spreadsheet column represents.")}
              </p>
              <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-white">
                {columns.map((column) => (
                  <div
                    key={column}
                    className="grid items-center gap-3 border-b border-line p-4 last:border-0 sm:grid-cols-[1fr_auto_1fr]"
                  >
                    <div>
                      <span className="text-xs text-ink-faint">{t("Spreadsheet column")}</span>
                      <strong className="mt-1 block text-sm">{column}</strong>
                    </div>
                    <span className="hidden text-ink-faint sm:block">→</span>
                    <label>
                      <span className="sr-only">{t("Map")} {column}</span>
                      <select
                        className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-accent"
                        value={mapping[column] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({ ...current, [column]: event.target.value }))
                        }
                      >
                        <option value="">{t("Do not import")}</option>
                        {types.map((type) => (
                          <optgroup
                            key={type}
                            label={t(DATA_TYPES.find((item) => item.value === type)?.label ?? type)}
                          >
                            {FIELDS[type].map((field) => (
                              <option key={field.value} value={field.value}>
                                {t(field.label)}
                                {field.required ? " *" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stage === "preview" && (
            <div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={t("Rows detected")} value={rows.length} />
                <Stat label={t("Valid")} value={validRows.length} tone="good" />
                <Stat
                  label={t("Invalid")}
                  value={invalidRows.length}
                  tone={invalidRows.length ? "bad" : undefined}
                />
                <Stat
                  label={t("Duplicates")}
                  value={validations.filter((item) => item.duplicate).length}
                />
              </div>
              <h3 className="mt-7 font-display text-lg font-bold">{t("Data preview")}</h3>
              <p className="mt-1 text-sm text-ink-muted">
                {t("Invalid and duplicate rows will be skipped.")}
              </p>
              <div className="mt-5 overflow-x-auto rounded-2xl border border-line bg-white">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="bg-surface-strong text-ink-muted">
                    <tr>
                      <th className="p-3">{t("Row")}</th>
                      {availableFields
                        .filter((field) => Object.values(mapping).includes(field.value))
                        .slice(0, 5)
                        .map((field) => (
                          <th key={field.value} className="p-3">
                            {t(field.label)}
                          </th>
                        ))}
                      <th className="p-3">{t("Status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validations.slice(0, 8).map((item, index) => (
                      <tr key={index} className="border-t border-line">
                        <td className="p-3">{index + 2}</td>
                        {availableFields
                          .filter((field) => Object.values(mapping).includes(field.value))
                          .slice(0, 5)
                          .map((field) => (
                            <td key={field.value} className="max-w-40 truncate p-3">
                              {String(item.row[field.value] ?? "—")}
                            </td>
                          ))}
                        <td className="p-3">
                          {item.valid ? (
                            <span className="rounded-full bg-accent-soft px-2 py-1 font-semibold text-accent-strong">
                              {t("Valid")}
                            </span>
                          ) : (
                            <span className="rounded-full bg-danger-soft px-2 py-1 font-semibold text-danger">
                              {item.duplicate
                                ? t("Duplicate")
                                : item.missing.length
                                  ? `${t("Missing")}: ${item.missing.map((field) => t(FIELDS[types[0]]?.find((item) => item.value === field)?.label ?? field)).join(", ")}`
                                  : item.invalidNumbers.length
                                    ? `${t("Invalid")}: ${item.invalidNumbers.map((field) => t(FIELDS[types[0]]?.find((item) => item.value === field)?.label ?? field)).join(", ")}`
                                    : `${t("Too long")}: ${item.invalidText.map((field) => {
                                        const base = field.split(" (max ")[0];
                                        const limit = field.match(/max (\d+) characters/)?.[1];
                                        const label = FIELDS[types[0]]?.find((item) => item.value === base)?.label ?? base;
                                        return limit ? `${t(label)} (${t(`max ${limit} characters`)})` : t(field);
                                      }).join(", ")}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {stage === "confirm" && (
            <div>
              <div className="rounded-2xl border border-line bg-white p-6">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Icon name="check" className="size-6" />
                </div>
                <h3 className="mt-5 font-display text-xl font-bold">{t("Ready to import")}</h3>
                <p className="mt-1 text-sm text-ink-muted">
                  {t("Review the records that will be added to your PointNull workspace.")}
                </p>
                <div className="mt-6 divide-y divide-line">
                  {DATA_TYPES.map((item) => (
                    <div key={item.value} className="flex items-center justify-between py-3">
                      <span className="text-sm text-ink-muted">{t(item.label)}</span>
                      <strong>{types.includes(item.value) ? validRows.length : 0}</strong>
                    </div>
                  ))}
                </div>
                <p className="mt-5 rounded-xl bg-surface-strong p-3 text-xs leading-5 text-ink-muted">
                  {t("Existing categories, products and customers are skipped. For product imports, any category name not already in PointNull will be created automatically. Historical sales and order-item imports are not available in this version.")}
                </p>
              </div>
            </div>
          )}
          {stage === "success" && (
            <div className="flex min-h-[480px] flex-col items-center justify-center text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-accent text-white">
                <Icon name="check" className="size-8" />
              </div>
              <h3 className="mt-6 font-display text-2xl font-bold">{t("Import complete")}</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">
                {t("Your records are now part of the same PointNull dataset used by Sell and Analysis.")}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm">
                <span><strong>{result?.categories.length ?? 0}</strong>{language === "ko" ? "개 카테고리 추가" : " categories added"}</span>
                <span><strong>{result?.products.length ?? 0}</strong>{language === "ko" ? "개 상품 추가" : " products added"}</span>
                <span><strong>{result?.customers.length ?? 0}</strong>{language === "ko" ? "명 고객 추가" : " customers added"}</span>
              </div>
              {(result?.skipped?.categories ?? 0) + (result?.skipped?.products ?? 0) + (result?.skipped?.customers ?? 0) > 0 && (
                <p className="mt-3 text-xs text-ink-muted">
                  {language === "ko"
                    ? `${(result?.skipped?.categories ?? 0) + (result?.skipped?.products ?? 0) + (result?.skipped?.customers ?? 0)}개의 중복 또는 잘못된 데이터를 건너뛰었습니다.`
                    : `${(result?.skipped?.categories ?? 0) + (result?.skipped?.products ?? 0) + (result?.skipped?.customers ?? 0)} duplicate or invalid records skipped.`}
                </p>
              )}
              <Button variant="primary" className="mt-8 min-w-36" onClick={onClose}>
                {t("Done")}
              </Button>
            </div>
          )}
        </div>
        {stage !== "upload" && stage !== "success" && (
          <footer className="flex shrink-0 items-center justify-between border-t border-line bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <Button
              onClick={() =>
                setStage(
                  stage === "mapping" ? "upload" : stage === "preview" ? "mapping" : "preview",
                )
              }
            >
              {t("Back")}
            </Button>
            {stage === "mapping" && (
              <Button
                variant="primary"
                onClick={() => setStage("preview")}
                disabled={
                  types.length !== 1 ||
                  requiredFields.some((field) => !Object.values(mapping).includes(field))
                }
              >
                {t("Preview data")}
              </Button>
            )}
            {stage === "preview" && (
              <Button
                variant="primary"
                onClick={() => setStage("confirm")}
                disabled={validRows.length === 0}
              >
                {t("Continue")}
              </Button>
            )}
            {stage === "confirm" && (
              <Button variant="primary" onClick={() => void confirmImport()} disabled={busy}>
                {busy ? t("Importing…") : t("Confirm import")}
              </Button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}

function FileSummary({
  file,
  rows,
  onRemove,
}: {
  file: File | null;
  rows: number;
  onRemove: () => void;
}) {
  const { t, language } = usePreferences();
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4">
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-xs font-black uppercase text-accent">
        {file?.name.split(".").pop()}
      </div>
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-sm">{file?.name}</strong>
        <span className="text-xs text-ink-muted">
          {language === "ko" ? `${rows}개 행 감지 · 열 연결 준비 완료` : `${rows} rows detected · Ready to map`}
        </span>
      </div>
      <Button variant="ghost" onClick={onRemove}>
        {t("Remove")}
      </Button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <span className="text-xs font-semibold text-ink-faint">{label}</span>
      <strong
        className={`mt-2 block font-display text-2xl ${tone === "good" ? "text-accent-strong" : tone === "bad" ? "text-danger" : ""}`}
      >
        {value}
      </strong>
    </div>
  );
}
