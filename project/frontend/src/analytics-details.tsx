import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  evaluateDiscount,
  getCustomers,
  getRecommendations,
  type Customer,
  type DiscountSuggestion,
  type Recommendations,
  type Statistics,
} from "./data-access";
import { Button, Input, Surface } from "./ui";

const money = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 2,
});
const count = new Intl.NumberFormat("en");
const selectClass = "min-h-10 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink";
const descriptionClass = "mt-1 text-sm text-ink-muted";

function ReportTable({
  headings,
  rows,
}: {
  headings: string[];
  rows: { key: string | number; cells: ReactNode[] }[];
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-ink-muted">
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col" className="px-2 py-2">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ key, cells }) => (
            <tr key={key}>
              {cells.map((cell, index) => (
                <td key={headings[index]} className="px-2 py-2.5 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesBreakdowns({ statistics }: { statistics: Statistics }) {
  const [leastFirst, setLeastFirst] = useState(false);
  const [productId, setProductId] = useState(0);
  const products = statistics.products;
  const ranked = leastFirst
    ? [...products].sort((a, b) => a.units - b.units || a.product_id - b.product_id)
    : products;
  const chosenProduct = products.find((product) => product.product_id === productId) ?? products[0];
  const demographics = statistics.demographics.filter(
    (row) => row.product_id === chosenProduct?.product_id,
  );
  const summary = statistics.summary;

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <Surface className="min-w-0 p-5">
        <h2 className="font-display text-lg font-bold">Product rankings</h2>
        <p className={descriptionClass}>
          Ranked by units sold in the selected period. Zero means no sales were recorded under these
          filters.
        </p>
        <label className="mt-3 block max-w-56 text-sm font-semibold">
          Sort by units
          <select
            className={selectClass}
            value={leastFirst ? "least" : "most"}
            onChange={(event) => setLeastFirst(event.target.value === "least")}
          >
            <option value="most">Most sold first</option>
            <option value="least">Least sold first</option>
          </select>
        </label>
        <ReportTable
          headings={["Product", "Units", "Net revenue"]}
          rows={ranked.map((product) => ({
            key: product.product_id,
            cells: [
              product.product_name,
              count.format(product.units),
              money.format(Number(product.net)),
            ],
          }))}
        />
      </Surface>
      <Surface className="min-w-0 p-5">
        <h2 className="font-display text-lg font-bold">Product sales by demographic</h2>
        <p className={descriptionClass}>
          {count.format(summary.identified_orders)} of {count.format(summary.orders)} matching
          orders are linked to a customer. Age is known for {count.format(summary.known_age_orders)}{" "}
          orders and gender for {count.format(summary.known_gender_orders)}.
        </p>
        <label className="mt-3 block max-w-xs text-sm font-semibold">
          Product for demographics
          <select
            className={selectClass}
            value={chosenProduct?.product_id ?? ""}
            onChange={(event) => setProductId(Number(event.target.value))}
          >
            {products.map((product) => (
              <option key={product.product_id} value={product.product_id}>
                {product.product_name}
              </option>
            ))}
          </select>
        </label>
        {demographics.length > 0 ? (
          <ReportTable
            headings={["Age group", "Gender", "Units", "Orders", "Known customers"]}
            rows={demographics.map((row) => ({
              key: JSON.stringify([row.age_group, row.gender]),
              cells: [
                row.age_group,
                row.gender,
                count.format(row.units),
                count.format(row.orders),
                count.format(row.unique_identified_customers),
              ],
            }))}
          />
        ) : (
          <p className={descriptionClass}>No matching sales for this product.</p>
        )}
        <p className={descriptionClass}>
          Unknown includes unlinked orders and missing profile fields. Groups reflect the current
          customer profile.
        </p>
      </Surface>
    </div>
  );
}

export function MarketingAnalysis({
  statistics,
  query,
}: {
  statistics: Statistics;
  query: string;
}) {
  const campaigns = statistics.by_campaign ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Surface className="min-w-0 p-5 lg:col-span-2">
        <h2 className="font-display text-lg font-bold">Campaign performance</h2>
        <p className={descriptionClass}>
          Sales include matching items on orders linked to a campaign code. Budget is the planned
          amount for the whole campaign.
        </p>
        {campaigns.length > 0 ? (
          <ReportTable
            headings={[
              "Campaign",
              "Channel",
              "Planned budget",
              "Linked orders",
              "Discounts",
              "Net revenue",
            ]}
            rows={campaigns.map((campaign) => ({
              key: campaign.promocode,
              cells: [
                <span>
                  {campaign.campaign_name}
                  <small className="ml-1.5 text-ink-muted">{campaign.promocode}</small>
                </span>,
                campaign.channel,
                money.format(Number(campaign.budget)),
                count.format(campaign.orders),
                money.format(Number(campaign.discount)),
                money.format(Number(campaign.net)),
              ],
            }))}
          />
        ) : (
          <p className={descriptionClass}>
            No campaigns overlap this period or have linked sales under these filters.
          </p>
        )}
      </Surface>
      <RecommendationPanel />
      <DiscountPanel products={statistics.products} query={query} />
    </div>
  );
}

function RecommendationPanel() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [phone, setPhone] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [result, setResult] = useState<Recommendations | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getCustomers(controller.signal)
      .then((records) => {
        if (!controller.signal.aborted) setCustomers(records);
      })
      .catch((caught: Error) => {
        if (!controller.signal.aborted) setCustomerError(caught.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!phone) return;
    const controller = new AbortController();
    getRecommendations(phone, controller.signal)
      .then((recommendations) => {
        if (!controller.signal.aborted) setResult(recommendations);
      })
      .catch((caught: Error) => {
        if (!controller.signal.aborted) setError(caught.message);
      });
    return () => controller.abort();
  }, [phone]);

  return (
    <Surface className="min-w-0 p-5">
      <h2 className="font-display text-lg font-bold">Customer recommendations</h2>
      <p className={descriptionClass}>
        Uses all purchase history and looks for new items bought by customers with similar
        purchases.
      </p>
      <label className="mt-3 block text-sm font-semibold">
        Customer
        <select
          aria-label="Customer"
          className={selectClass}
          value={phone}
          disabled={!customers?.length}
          onChange={(event) => {
            setPhone(event.target.value);
            setResult(null);
            setError("");
          }}
        >
          <option value="">
            {customerError
              ? "Customers unavailable"
              : !customers
                ? "Loading customers…"
                : customers.length
                  ? "Select a customer"
                  : "No customers available"}
          </option>
          {customers?.map((customer) => (
            <option key={customer.customer_phone} value={customer.customer_phone}>
              {customer.customer_name} · {customer.customer_phone}
            </option>
          ))}
        </select>
      </label>
      {(customerError || error) && (
        <p role="alert" className={descriptionClass}>
          {customerError || error}
        </p>
      )}
      {phone && !result && !error && (
        <p role="status" className={descriptionClass}>
          Finding recommendations…
        </p>
      )}
      {result &&
        (result.items.length > 0 ? (
          <ReportTable
            headings={["Suggested product", "Similar customers"]}
            rows={result.items.map((item) => ({
              key: item.product_id,
              cells: [item.product_name, count.format(item.supporting_customers)],
            }))}
          />
        ) : (
          <p className={descriptionClass}>
            There is too little overlap in this customer’s linked purchase history to suggest a
            product.
          </p>
        ))}
    </Surface>
  );
}

function DiscountPanel({ products, query }: { products: Statistics["products"]; query: string }) {
  const [productId, setProductId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [result, setResult] = useState<DiscountSuggestion | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    setError("");
    try {
      setResult(await evaluateDiscount(query, Number(productId), unitCost));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not calculate the discount.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Surface className="min-w-0 p-5">
      <h2 className="font-display text-lg font-bold">Discount trial calculator</h2>
      <p className={descriptionClass}>
        Check whether a 5% trial discount meets the margin target for a product among the lowest
        sellers under the current filters. The unit cost is used for this calculation.
      </p>
      <form className="mt-3 grid gap-3" onSubmit={submit}>
        <label className="block text-sm font-semibold">
          Product for discount
          <select
            className={selectClass}
            value={productId}
            required
            disabled={pending || !products.length}
            onChange={(event) => {
              setProductId(event.target.value);
              setResult(null);
              setError("");
            }}
          >
            <option value="">Select a product</option>
            {products.map((product) => (
              <option key={product.product_id} value={product.product_id}>
                {product.product_name} · {product.units} sold
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Unit cost (₩)
          <Input
            className="block w-full"
            type="number"
            min="0"
            step="0.01"
            max="99999999.99"
            value={unitCost}
            required
            disabled={pending}
            onChange={(event) => {
              setUnitCost(event.target.value);
              setResult(null);
              setError("");
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending || !productId || unitCost === ""}>
          {pending ? "Calculating…" : "Check trial discount"}
        </Button>
      </form>
      {error && (
        <p role="alert" className={descriptionClass}>
          {error}
        </p>
      )}
      {result && (
        <p role="status" className={descriptionClass}>
          {describeDiscount(result)}
        </p>
      )}
    </Surface>
  );
}

function describeDiscount(result: DiscountSuggestion): string {
  const item = result.item;
  const margin = Math.round(Number(result.minimum_margin) * 100) + "%";
  if (!item) return "This product is outside the lowest-selling group under these filters.";
  if (item.status === "insufficient_sales_history")
    return "Select a period with recorded sales to check a trial discount.";
  if (item.status === "zero_price")
    return "Set a positive selling price before evaluating a discount.";
  if (item.status === "trial_candidate") {
    return (
      "A " +
      item.candidate_discount_percent +
      "% trial gives a unit price of " +
      money.format(Number(item.discounted_unit_price)) +
      " and keeps at least a " +
      margin +
      " gross margin under the supplied cost."
    );
  }
  const maximum = item.maximum_discount_amount_under_assumptions;
  return (
    "A 5% discount would fall below the " +
    margin +
    " margin target at this unit cost." +
    (maximum
      ? " The calculated discount cap is " + money.format(Number(maximum)) + " per unit."
      : "")
  );
}
