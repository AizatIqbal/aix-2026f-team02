// Builds the Analysis "Export report" Excel file in the browser.
//
// The numbers come from the same /statistics response the Analysis screen
// shows, so the file always matches what is on screen. The workbook has an
// overview page (key figures, takeaways, charts) followed by detail sheets.

import type { Category, CustomerGroupTotals, Statistics } from "./data-access";
import {
  cellRef,
  excelDate,
  rangeRef,
  sheetRef,
  writeWorkbook,
  type Cell,
  type CellStyle,
  type Chart,
  type ConditionalFormat,
  type Sheet,
} from "./xlsx-writer";

export interface ReportContext {
  scope: "current" | "full";
  categories: Category[];
  /** Screen filters to describe on the Overview sheet (current view only). */
  filters?: {
    days: string[];
    startTime: string;
    endTime: string;
    categories: number[];
  };
  generatedAt?: Date;
}

// Colours follow the app theme.
const ACCENT = "5F7F4E";
const ACCENT_STRONG = "3F6537";
const ACCENT_SOFT = "EAF2E5";
const ACCENT_LIGHT = "A9C29B";
const SCALE_LOW = "F6F8F5";
const SCALE_HIGH = "7FA06C";
const MUTED = "637064";
const WEAK = "FBE9E7";

const MONEY = '"₩"#,##0';
const INTEGER = "#,##0";
const PERCENT = "0.0%";
const ONE_DECIMAL = "0.0";
const DATE = "d mmm yyyy";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SHEETS = {
  overview: "Overview",
  time: "Sales over time",
  products: "Product rankings",
  categories: "Categories",
  when: "When customers buy",
  customers: "Customer demographics",
  campaigns: "Campaigns",
  notes: "Notes",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Input = string | number | { formula: string; value: string | number };

interface Column {
  heading: string;
  /** Number format; leave out for text columns. */
  format?: string;
}

/** A sheet under construction: cells are placed by row and column. */
class Grid {
  rows: (Cell | undefined)[][] = [];
  merges: string[] = [];
  rowHeights: Record<number, number> = {};
  conditionalFormats: ConditionalFormat[] = [];
  charts: Chart[] = [];

  set(row: number, col: number, value: Input, style: CellStyle = {}): void {
    while (this.rows.length <= row) this.rows.push([]);
    this.rows[row][col] =
      typeof value === "object" ? { formula: value.formula, value: value.value, style } : { value, style };
  }

  merge(row: number, firstCol: number, lastCol: number): void {
    this.merges.push(`${cellRef(firstCol, row)}:${cellRef(lastCol, row)}`);
  }

  dataBar(col: number, first: number, last: number, color = ACCENT): void {
    if (last < first) return;
    this.conditionalFormats.push({
      type: "dataBar",
      ref: `${cellRef(col, first)}:${cellRef(col, last)}`,
      color,
    });
  }

  colorScale(firstCol: number, lastCol: number, first: number, last: number, to = SCALE_HIGH, from = SCALE_LOW): void {
    if (last < first) return;
    this.conditionalFormats.push({
      type: "colorScale",
      ref: `${cellRef(firstCol, first)}:${cellRef(lastCol, last)}`,
      from,
      to,
    });
  }

  /**
   * Write a table: accent header, bordered rows and an optional bold total row.
   * Returns the zero-based rows of the first and last record and of the total.
   */
  table(
    top: number,
    left: number,
    columns: Column[],
    records: Input[][],
    options: { total?: (Input | undefined)[]; zebra?: boolean; rowStyle?: (index: number) => CellStyle } = {},
  ): { first: number; last: number; total: number } {
    columns.forEach((column, index) =>
      this.set(top, left + index, column.heading, {
        bold: true,
        color: "FFFFFF",
        fill: ACCENT,
        border: true,
        valign: "center",
        align: column.format ? "right" : "left",
      }),
    );
    this.rowHeights[top] = 22;

    records.forEach((record, index) => {
      const extra = options.rowStyle?.(index) ?? (options.zebra && index % 2 === 1 ? { fill: SCALE_LOW } : {});
      record.forEach((value, column) =>
        this.set(top + 1 + index, left + column, value, {
          border: true,
          format: columns[column].format,
          ...extra,
        }),
      );
    });

    const first = top + 1;
    const last = top + records.length;
    options.total?.forEach((value, column) =>
      this.set(last + 1, left + column, value ?? "", {
        bold: true,
        fill: ACCENT_SOFT,
        border: true,
        format: columns[column].format,
      }),
    );
    return { first, last, total: last + 1 };
  }

  toSheet(name: string, widths: number[], options: Partial<Sheet> = {}): Sheet {
    return {
      name,
      rows: this.rows,
      widths,
      merges: this.merges,
      rowHeights: this.rowHeights,
      conditionalFormats: this.conditionalFormats,
      charts: this.charts,
      ...options,
    };
  }
}

const sumOf = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** =SUM(col first..last) with its value already worked out. */
function sum(col: number, first: number, last: number, values: number[]): Input {
  return { formula: `SUM(${cellRef(col, first)}:${cellRef(col, last)})`, value: sumOf(values) };
}

const count = (value: number) => value.toLocaleString("en-US");
const won = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** "2026-10-01" -> "1 Oct 2026" */
function longDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function timestamp(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()} ` +
    `${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

/** How a period is written in sentences: a date, a week, a month or a year. */
function periodLabel(period: string, group: Statistics["group"]): string {
  if (group === "day") return longDate(period);
  if (group === "week") return `the week of ${longDate(period)}`;
  if (group === "month") return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
  return period;
}

// ---------------------------------------------------------------------------
// Detail sheets
// ---------------------------------------------------------------------------

const TOTAL_COLUMNS: Column[] = [
  { heading: "Orders", format: INTEGER },
  { heading: "Units sold", format: INTEGER },
  { heading: "Gross sales", format: MONEY },
  { heading: "Discounts", format: MONEY },
  { heading: "Net revenue", format: MONEY },
];

interface Layout {
  time: { first: number; last: number; total: number; dated: boolean };
  products: { first: number; last: number; top: number };
  categories: { first: number; last: number };
  hours: { first: number; last: number } | null;
  days: { first: number; last: number };
}

function salesOverTime(statistics: Statistics): { sheet: Sheet; rows: Layout["time"] } {
  const grid = new Grid();
  const group = statistics.group;
  const dated = group === "day" || group === "week";
  const heading = { day: "Date", week: "Week starting", month: "Month", year: "Year" }[group];
  const periods = statistics.periods;
  const numbers = periods.map((row) => [row.orders, row.units, Number(row.gross), Number(row.discount), Number(row.net)]);
  const first = 1;
  const last = periods.length;
  const rows = grid.table(
    0,
    0,
    [{ heading, format: dated ? DATE : undefined }, ...TOTAL_COLUMNS],
    periods.map((row, index) => [dated ? excelDate(row.period) : periodLabel(row.period, group), ...numbers[index]]),
    {
      zebra: true,
      total: ["Total", ...[0, 1, 2, 3, 4].map((n) => sum(n + 1, first, last, numbers.map((row) => row[n])))],
    },
  );
  grid.set(rows.total, 0, "Total", { bold: true, fill: ACCENT_SOFT, border: true });
  grid.dataBar(5, rows.first, rows.last);
  return {
    sheet: grid.toSheet(SHEETS.time, [16, 10, 12, 16, 14, 18], { frozenRows: 1, repeatHeaderRow: true }),
    rows: { ...rows, dated },
  };
}

function productRankings(
  statistics: Statistics,
  categoryName: (id: number | undefined) => string,
): { sheet: Sheet; rows: Layout["products"] } {
  const grid = new Grid();
  const products = statistics.products;
  const netTotal = sumOf(products.map((row) => Number(row.net)));
  const total = products.length + 1;
  const highlight = products.length >= 6;
  const rows = grid.table(
    0,
    0,
    [
      { heading: "Rank", format: INTEGER },
      { heading: "Product" },
      { heading: "Category" },
      { heading: "Units sold", format: INTEGER },
      { heading: "Net revenue", format: MONEY },
      { heading: "Share of revenue", format: PERCENT },
    ],
    products.map((row, index) => [
      index + 1,
      row.product_name,
      categoryName(row.category_id),
      row.units,
      Number(row.net),
      {
        formula: `${cellRef(4, index + 1)}/$E$${total + 1}`,
        value: netTotal > 0 ? Number(row.net) / netTotal : 0,
      },
    ]),
    {
      rowStyle: (index) =>
        highlight && index < 3
          ? { fill: ACCENT_SOFT, bold: true, color: ACCENT_STRONG }
          : highlight && index >= products.length - 3
            ? { fill: WEAK }
            : index % 2 === 1
              ? { fill: SCALE_LOW }
              : {},
      total: [
        "",
        "Total",
        "",
        sum(3, 1, products.length, products.map((row) => row.units)),
        sum(4, 1, products.length, products.map((row) => Number(row.net))),
        { formula: `SUM(F2:F${total})`, value: netTotal > 0 ? 1 : 0 },
      ],
    },
  );
  grid.dataBar(3, rows.first, rows.last);
  grid.dataBar(4, rows.first, rows.last, ACCENT_LIGHT);
  if (highlight) {
    grid.set(rows.total + 2, 0, "Green rows: three best sellers. Red rows: three weakest sellers.", {
      size: 9,
      color: MUTED,
    });
  }
  const sold = products.filter((row) => row.units > 0).length;
  return {
    sheet: grid.toSheet(SHEETS.products, [7, 28, 16, 14, 18, 16], { frozenRows: 1, repeatHeaderRow: true }),
    rows: { first: rows.first, last: rows.last, top: Math.min(10, sold) },
  };
}

function categoriesSheet(
  statistics: Statistics,
  categoryName: (id: number | undefined) => string,
): { sheet: Sheet; rows: Layout["categories"] } {
  const grid = new Grid();
  const categories = [...statistics.by_category].sort((a, b) => Number(b.net) - Number(a.net));
  const netTotal = sumOf(categories.map((row) => Number(row.net)));
  const total = categories.length + 1;
  const rows = grid.table(
    0,
    0,
    [
      { heading: "Category" },
      { heading: "Orders", format: INTEGER },
      { heading: "Units sold", format: INTEGER },
      { heading: "Net revenue", format: MONEY },
      { heading: "Share of revenue", format: PERCENT },
    ],
    categories.map((row, index) => [
      categoryName(row.category_id),
      row.orders,
      row.units,
      Number(row.net),
      { formula: `${cellRef(3, index + 1)}/$D$${total + 1}`, value: netTotal > 0 ? Number(row.net) / netTotal : 0 },
    ]),
    {
      zebra: true,
      // No order total: an order with items from two categories is counted in both.
      total: [
        "Total",
        "",
        sum(2, 1, categories.length, categories.map((row) => row.units)),
        sum(3, 1, categories.length, categories.map((row) => Number(row.net))),
        { formula: `SUM(E2:E${total})`, value: netTotal > 0 ? 1 : 0 },
      ],
    },
  );
  grid.dataBar(3, rows.first, rows.last);
  return {
    sheet: grid.toSheet(SHEETS.categories, [22, 10, 12, 18, 16], { frozenRows: 1, repeatHeaderRow: true }),
    rows,
  };
}

function whenCustomersBuy(statistics: Statistics): { sheet: Sheet; hours: Layout["hours"]; days: Layout["days"] } {
  const grid = new Grid();
  const columns = (first: string): Column[] => [
    { heading: first },
    { heading: "Orders", format: INTEGER },
    { heading: "Units sold", format: INTEGER },
    { heading: "Net revenue", format: MONEY },
  ];
  const block = (left: number, heading: string, records: { label: string; orders: number; units: number; net: string }[]) => {
    const rows = grid.table(
      0,
      left,
      columns(heading),
      records.map((row) => [row.label, row.orders, row.units, Number(row.net)]),
      {
        zebra: true,
        total: [
          "Total",
          sum(left + 1, 1, records.length, records.map((row) => row.orders)),
          sum(left + 2, 1, records.length, records.map((row) => row.units)),
          sum(left + 3, 1, records.length, records.map((row) => Number(row.net))),
        ],
      },
    );
    grid.dataBar(left + 3, rows.first, rows.last);
    return rows;
  };

  const busyHours = statistics.by_hour.filter((row) => row.orders > 0);
  const hours = busyHours.length
    ? block(0, "Hour", busyHours.map((row) => ({ ...row, label: `${String(row.hour).padStart(2, "0")}:00` })))
    : null;
  const days = block(5, "Day", statistics.by_weekday.map((row) => ({ ...row, label: WEEKDAYS[row.weekday] ?? String(row.weekday) })));
  if (hours) grid.set(hours.total + 2, 0, "Hours with no sales are left out.", { size: 9, color: MUTED });
  return {
    sheet: grid.toSheet(SHEETS.when, [10, 10, 12, 18, 3, 14, 10, 12, 18], { frozenRows: 1, repeatHeaderRow: true }),
    hours,
    days,
  };
}

function customerDemographics(statistics: Statistics): Sheet {
  const grid = new Grid();
  const widths = [16, 22, 22, 22, 18, 18, 21, 18, 24];
  const groups = statistics.customer_groups;
  grid.set(0, 0, "Customer demographics", { bold: true, size: 16 });

  if (!groups || groups.orders === 0 || (groups.age_groups.length === 0 && groups.genders.length === 0)) {
    grid.set(1, 0, "No orders in this selection are linked to a customer profile with an age or gender.", {
      size: 9,
      color: MUTED,
    });
    return grid.toSheet(SHEETS.customers, widths);
  }

  grid.set(
    1,
    0,
    `Based on the ${count(groups.orders)} orders linked to a customer profile ` +
      `(${percent(groups.orders / statistics.summary.orders)} of all orders, ${count(groups.customers)} customers). ` +
      "The other orders have no profile and are not included.",
    { size: 9, color: MUTED },
  );

  const groupColumns = (first: string): Column[] => [
    { heading: first },
    { heading: "Customers", format: INTEGER },
    { heading: "Orders", format: INTEGER },
    { heading: "Units sold", format: INTEGER },
    { heading: "Net revenue", format: MONEY },
    { heading: "Avg order value", format: MONEY },
    { heading: "Orders per customer", format: ONE_DECIMAL },
    { heading: "Share of revenue", format: PERCENT },
    { heading: "Favourite product" },
  ];
  const groupTable = (top: number, label: string, records: (CustomerGroupTotals & { name: string })[]) => {
    grid.set(top - 1, 0, `By ${label.toLowerCase()}`, { bold: true, size: 12 });
    const net = sumOf(records.map((row) => Number(row.net)));
    const orders = sumOf(records.map((row) => row.orders));
    const customers = sumOf(records.map((row) => row.customers));
    const first = top + 1;
    const last = top + records.length;
    const total = last + 1;
    const rows = grid.table(
      top,
      0,
      groupColumns(label),
      records.map((row, index) => {
        const r = first + index + 1; // spreadsheet row number
        return [
          row.name,
          row.customers,
          row.orders,
          row.units,
          Number(row.net),
          { formula: `E${r}/C${r}`, value: row.orders ? Number(row.net) / row.orders : 0 },
          { formula: `C${r}/B${r}`, value: row.customers ? row.orders / row.customers : 0 },
          { formula: `E${r}/$E$${total + 1}`, value: net > 0 ? Number(row.net) / net : 0 },
          row.top_products[0]?.product_name ?? "",
        ];
      }),
      {
        total: [
          "Total",
          sum(1, first, last, records.map((row) => row.customers)),
          sum(2, first, last, records.map((row) => row.orders)),
          sum(3, first, last, records.map((row) => row.units)),
          sum(4, first, last, records.map((row) => Number(row.net))),
          { formula: `E${total + 1}/C${total + 1}`, value: orders ? net / orders : 0 },
          { formula: `C${total + 1}/B${total + 1}`, value: customers ? orders / customers : 0 },
          { formula: `SUM(H${first + 1}:H${last + 1})`, value: net > 0 ? 1 : 0 },
          "",
        ],
      },
    );
    grid.dataBar(4, rows.first, rows.last);
    grid.colorScale(5, 5, rows.first, rows.last, ACCENT_LIGHT, "FFFFFF");
    return rows;
  };

  const ageRecords = groups.age_groups.map((row) => ({ ...row, name: row.age_group }));
  const genderRecords = groups.genders.map((row) => ({ ...row, name: row.gender }));
  const ageRows = groupTable(4, "Age group", ageRecords);
  const genderRows = groupTable(ageRows.total + 4, "Gender", genderRecords);
  let next = genderRows.total + 4;

  // Age group by gender: units and revenue side by side, shaded by size.
  const genders = [...new Set(groups.age_gender.map((row) => row.gender))].sort();
  const ages = groups.age_groups.map((row) => row.age_group).filter((age) => groups.age_gender.some((row) => row.age_group === age));
  if (ages.length > 0 && genders.length > 0) {
    const lookup = new Map(groups.age_gender.map((row) => [`${row.age_group}|${row.gender}`, row]));
    grid.set(next - 1, 0, "Age group by gender", { bold: true, size: 12 });
    grid.set(next - 1, 2, "Darker cells mean more. Left: units sold. Right: net revenue.", { size: 9, color: MUTED });
    const gridTable = (left: number, heading: string, format: string, pick: (row: CustomerGroupTotals) => number) => {
      const values = ages.map((age) => genders.map((gender) => {
        const row = lookup.get(`${age}|${gender}`);
        return row ? pick(row) : 0;
      }));
      const rows = grid.table(
        next,
        left,
        [{ heading }, ...genders.map((gender) => ({ heading: gender, format }))],
        ages.map((age, index) => [age, ...values[index]]),
        {
          total: ["Total", ...genders.map((_, column) => sum(left + 1 + column, next + 1, next + ages.length, values.map((row) => row[column])))],
        },
      );
      grid.colorScale(left + 1, left + genders.length, rows.first, rows.last);
      return rows;
    };
    gridTable(0, "Units sold", INTEGER, (row) => row.units);
    const revenue = gridTable(genders.length + 2, "Net revenue", MONEY, (row) => Number(row.net));
    next = revenue.total + 4;
  }

  grid.set(next - 1, 0, "What each group buys most", { bold: true, size: 12 });
  grid.table(
    next,
    0,
    [{ heading: "Group" }, { heading: "1st" }, { heading: "2nd" }, { heading: "3rd" }],
    [...ageRecords, ...genderRecords].map((row) => [
      row.name,
      ...[0, 1, 2].map((index) => row.top_products[index]?.product_name ?? ""),
    ]),
  );

  const chart = (title: string, col: number, rows: { first: number; last: number }, anchorRow: number, valueFormat: string): Chart => ({
    type: "column",
    title,
    anchor: { col: 10, row: anchorRow },
    width: 15,
    height: 7,
    categories: rangeRef(SHEETS.customers, 0, rows.first, rows.last),
    values: rangeRef(SHEETS.customers, col, rows.first, rows.last),
    valueFormat,
  });
  if (ageRecords.length > 0) {
    grid.charts.push(chart("Net revenue by age group", 4, ageRows, 3, MONEY));
    grid.charts.push(chart("Average order value by age group", 5, ageRows, 18, MONEY));
  }
  if (genderRecords.length > 0) grid.charts.push(chart("Net revenue by gender", 4, genderRows, 33, MONEY));
  if (ageRecords.length > 0) grid.charts.push(chart("Customers by age group", 1, ageRows, 48, "0"));

  return grid.toSheet(SHEETS.customers, widths);
}

function campaignsSheet(statistics: Statistics): Sheet {
  const grid = new Grid();
  const campaigns = statistics.by_campaign;
  const rows = grid.table(
    0,
    0,
    [{ heading: "Campaign" }, { heading: "Promocode" }, { heading: "Channel" }, { heading: "Budget", format: MONEY }, ...TOTAL_COLUMNS],
    campaigns.map((row) => [
      row.campaign_name,
      row.promocode,
      row.channel,
      Number(row.budget),
      row.orders,
      row.units,
      Number(row.gross),
      Number(row.discount),
      Number(row.net),
    ]),
    { zebra: true },
  );
  grid.dataBar(8, rows.first, rows.last);
  return grid.toSheet(SHEETS.campaigns, [26, 16, 14, 16, 10, 12, 16, 14, 18], { frozenRows: 1, repeatHeaderRow: true });
}

function notesSheet(statistics: Statistics): Sheet {
  const grid = new Grid();
  const notes: [string, string][] = [
    ...statistics.warnings.map((warning): [string, string] => ["Warning", warning]),
    ["Net revenue", "Gross sales minus discounts. It is revenue, not profit."],
    ["Average order value", "Net revenue divided by the number of orders."],
    [
      "Customer demographics",
      "Only orders linked to a customer profile. Uses each customer's current age and gender, not what they were at the time of the sale.",
    ],
    ["Weeks", "Weeks start on Monday. The first and last week of a period may be incomplete."],
    ["Zero sales", "No recorded sales in the period. It does not prove a product is unpopular or was out of stock."],
  ];
  const rows = grid.table(0, 0, [{ heading: "Term" }, { heading: "What it means" }], notes);
  for (let row = rows.first; row <= rows.last; row += 1) {
    const [term, meaning] = notes[row - rows.first];
    grid.set(row, 0, term, { bold: true, border: true, valign: "top" });
    grid.set(row, 1, meaning, { border: true, wrap: true, valign: "top" });
  }
  return grid.toSheet(SHEETS.notes, [24, 96]);
}

// ---------------------------------------------------------------------------
// Overview sheet
// ---------------------------------------------------------------------------

function takeaways(statistics: Statistics, categoryName: (id: number | undefined) => string): string[] {
  const lines: string[] = [];
  const net = Number(statistics.summary.net);
  const byNet = <T extends { net: string }>(rows: T[]) => [...rows].sort((a, b) => Number(b.net) - Number(a.net));

  const days = byNet(statistics.by_weekday.filter((row) => row.orders > 0));
  if (days.length >= 2) {
    const best = days[0];
    const worst = days[days.length - 1];
    lines.push(
      `${WEEKDAYS[best.weekday]} is the strongest day (${won(Number(best.net))}); ` +
        `${WEEKDAYS[worst.weekday]} is the quietest (${won(Number(worst.net))}).`,
    );
  }

  const peak = byNet(statistics.by_hour)[0];
  if (peak && Number(peak.net) > 0) {
    lines.push(`Sales peak at ${String(peak.hour).padStart(2, "0")}:00, with ${won(Number(peak.net))} over the period.`);
  }

  const categories = byNet(statistics.by_category);
  if (categories.length >= 2 && net > 0) {
    lines.push(
      `${categoryName(categories[0].category_id)} is the top category with ${percent(Number(categories[0].net) / net)} of revenue.`,
    );
  }

  const sold = statistics.products.filter((row) => row.units > 0);
  const unsold = statistics.products.length - sold.length;
  if (sold.length >= 2) {
    const top = sold[0];
    const weakest = sold[sold.length - 1];
    lines.push(
      `${top.product_name} is the best seller (${count(top.units)} units). ` +
        (unsold > 0
          ? `${count(unsold)} ${unsold === 1 ? "product" : "products"} had no sales.`
          : `${weakest.product_name} is the weakest (${count(weakest.units)} units).`),
    );
  }

  const periods = byNet(statistics.periods);
  if (periods.length >= 2 && Number(periods[0].net) > 0) {
    const unit = { day: "day", week: "week", month: "month", year: "year" }[statistics.group];
    lines.push(
      `The best single ${unit} was ${periodLabel(periods[0].period, statistics.group)} (${won(Number(periods[0].net))}).`,
    );
  }

  const groups = statistics.customer_groups;
  if (groups && groups.age_groups.length >= 2) {
    const linkedNet = sumOf(groups.age_groups.map((row) => Number(row.net)));
    const top = byNet(groups.age_groups)[0];
    const spender = [...groups.age_groups]
      .filter((row) => row.orders > 0)
      .sort((a, b) => Number(b.net) / b.orders - Number(a.net) / a.orders)[0];
    if (linkedNet > 0 && spender) {
      lines.push(
        `Among customers with a profile, the ${top.age_group} age group brings in the most revenue ` +
          `(${percent(Number(top.net) / linkedNet)}); ${spender.age_group} customers spend the most per order ` +
          `(${won(Number(spender.net) / spender.orders)}).`,
      );
    }
  }

  if (statistics.summary.orders > 0) {
    lines.push(
      `${percent(statistics.summary.identified_orders / statistics.summary.orders)} of orders are linked to a customer profile.`,
    );
  }
  return lines;
}

function describeFilters(context: ReportContext, categoryName: (id: number | undefined) => string): string {
  const filters = context.filters;
  if (context.scope === "full" || !filters) return "all sales, no filters";
  const parts: string[] = [];
  if (filters.days.length) parts.push(`days: ${filters.days.map((day) => day.slice(0, 3)).join(", ")}`);
  if (filters.startTime !== "00:00" || filters.endTime !== "23:59") parts.push(`${filters.startTime} to ${filters.endTime}`);
  if (filters.categories.length) parts.push(`categories: ${filters.categories.map(categoryName).join(", ")}`);
  return parts.length ? parts.join("; ") : "no filters";
}

function overviewSheet(
  statistics: Statistics,
  context: ReportContext,
  layout: Layout,
  categoryName: (id: number | undefined) => string,
): Sheet {
  const grid = new Grid();
  const summary = statistics.summary;
  const time = sheetRef(SHEETS.time);
  const totalRow = layout.time.total + 1; // spreadsheet row number
  const period =
    statistics.start && statistics.end
      ? statistics.start === statistics.end
        ? longDate(statistics.start)
        : `${longDate(statistics.start)} to ${longDate(statistics.end)}`
      : "";

  grid.set(1, 1, "Sales report", { bold: true, size: 20 });
  grid.set(
    2,
    1,
    [period, describeFilters(context, categoryName), `generated ${timestamp(context.generatedAt ?? new Date())}`]
      .filter(Boolean)
      .join("  ·  "),
    { color: MUTED },
  );

  // Key figures, each read from the detail sheets so they stay in step.
  const figures: [string, Input, string | undefined][] = [
    ["NET REVENUE", { formula: `${time}!F${totalRow}`, value: Number(summary.net) }, MONEY],
    ["ORDERS", { formula: `${time}!B${totalRow}`, value: summary.orders }, INTEGER],
    [
      "AVERAGE ORDER VALUE",
      { formula: `${time}!F${totalRow}/${time}!B${totalRow}`, value: summary.orders ? Number(summary.net) / summary.orders : 0 },
      MONEY,
    ],
    ["ITEMS SOLD", { formula: `${time}!C${totalRow}`, value: summary.units }, INTEGER],
    [
      "TOP PRODUCT",
      { formula: `${sheetRef(SHEETS.products)}!B2`, value: statistics.products[0]?.product_name ?? "" },
      undefined,
    ],
  ];
  figures.forEach(([label, value, format], index) => {
    const col = 1 + index * 2;
    grid.set(4, col, label, { bold: true, size: 8, color: MUTED, fill: ACCENT_SOFT, valign: "bottom", indent: 1 });
    grid.set(4, col + 1, "", { fill: ACCENT_SOFT });
    grid.set(5, col, value, {
      bold: true,
      size: 16,
      color: ACCENT_STRONG,
      fill: ACCENT_SOFT,
      align: "left",
      valign: "center",
      indent: 1,
      format,
    });
    grid.set(5, col + 1, "", { fill: ACCENT_SOFT });
    grid.merge(4, col, col + 1);
    grid.merge(5, col, col + 1);
  });
  grid.rowHeights[4] = 20;
  grid.rowHeights[5] = 32;

  const lines = takeaways(statistics, categoryName);
  grid.set(7, 1, "Key takeaways", { bold: true, size: 12 });
  lines.forEach((line, index) => {
    grid.set(8 + index, 1, `•  ${line}`, { valign: "center" });
    grid.merge(8 + index, 1, 10);
    grid.rowHeights[8 + index] = 18;
  });

  // Charts: one wide, then two rows of two.
  let row = 8 + lines.length + 1;
  const periodCount = layout.time.last - layout.time.first + 1;
  grid.charts.push({
    type: "line",
    title: "Revenue over time",
    anchor: { col: 1, row },
    width: 29.5,
    height: 7.5,
    categories: rangeRef(SHEETS.time, 0, layout.time.first, layout.time.last),
    values: rangeRef(SHEETS.time, 5, layout.time.first, layout.time.last),
    valueFormat: MONEY,
    categoryFormat: layout.time.dated ? "d mmm" : undefined,
    labelSkip: periodCount > 12 ? Math.ceil(periodCount / 8) : undefined,
  });
  row += 16;

  const half = (title: string, col: number, type: Chart["type"], height: number, categories: string, values: string, valueFormat: string): Chart => ({
    type,
    title,
    anchor: { col, row },
    width: 14.5,
    height,
    categories,
    values,
    valueFormat,
  });
  if (layout.hours) {
    grid.charts.push(
      half("Revenue by hour", 1, "column", 7.5, rangeRef(SHEETS.when, 0, layout.hours.first, layout.hours.last), rangeRef(SHEETS.when, 3, layout.hours.first, layout.hours.last), MONEY),
    );
  }
  grid.charts.push(
    half("Revenue by day of week", layout.hours ? 6 : 1, "column", 7.5, rangeRef(SHEETS.when, 5, layout.days.first, layout.days.last), rangeRef(SHEETS.when, 8, layout.days.first, layout.days.last), MONEY),
  );
  row += 16;
  grid.charts.push(
    half("Revenue by category", 1, "column", 9.5, rangeRef(SHEETS.categories, 0, layout.categories.first, layout.categories.last), rangeRef(SHEETS.categories, 3, layout.categories.first, layout.categories.last), MONEY),
  );
  if (layout.products.top > 0) {
    const last = layout.products.first + layout.products.top - 1;
    grid.charts.push(
      half(`Top ${layout.products.top} products by units`, 6, "bar", 9.5, rangeRef(SHEETS.products, 1, layout.products.first, last), rangeRef(SHEETS.products, 3, layout.products.first, last), INTEGER),
    );
  }

  return grid.toSheet(SHEETS.overview, [2, ...Array<number>(10).fill(15.5), 2], {
    orientation: "portrait",
    fitOnOnePage: true,
  });
}

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

/** Every sheet of the report. Pure data, so it can be tested without a browser. */
export function buildReportSheets(statistics: Statistics, context: ReportContext): Sheet[] {
  const names = new Map(context.categories.map((category) => [category.category_id, category.category_name]));
  const categoryName = (id: number | undefined) => (id === undefined ? "" : names.get(id) ?? `Category ${id}`);

  const time = salesOverTime(statistics);
  const products = productRankings(statistics, categoryName);
  const categories = categoriesSheet(statistics, categoryName);
  const when = whenCustomersBuy(statistics);
  const layout: Layout = {
    time: time.rows,
    products: products.rows,
    categories: categories.rows,
    hours: when.hours,
    days: when.days,
  };

  return [
    overviewSheet(statistics, context, layout, categoryName),
    time.sheet,
    products.sheet,
    categories.sheet,
    when.sheet,
    customerDemographics(statistics),
    ...(statistics.by_campaign.length > 0 ? [campaignsSheet(statistics)] : []),
    notesSheet(statistics),
  ];
}

export function reportFilename(statistics: Statistics, scope: "current" | "full"): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const range =
    statistics.start && statistics.end
      ? statistics.start === statistics.end
        ? statistics.start
        : `${statistics.start}_to_${statistics.end}`
      : today;
  return `PointNull_Analytics_${scope === "full" ? "Full_" : ""}${range}.xlsx`;
}

/** Create the .xlsx file and hand it to the browser as a download. */
export async function downloadAnalyticsReport(
  statistics: Statistics,
  context: ReportContext,
): Promise<string> {
  const bytes = writeWorkbook(buildReportSheets(statistics, context));
  const filename = reportFilename(statistics, context.scope);
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}
