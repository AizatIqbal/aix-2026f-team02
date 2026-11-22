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
import { usePreferences } from "./preferences";

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
  const { t, productName, formatMoney } = usePreferences();
  const [leastFirst, setLeastFirst] = useState(false);
  const [productId, setProductId] = useState(0);
  const products = statistics.products;
  // Rank 1 is always the best seller, whichever way the list is sorted.
  const ranked = products.map((product, index) => ({ ...product, rank: index + 1 }));
  if (leastFirst) ranked.reverse();
  const mostUnits = Math.max(1, ...products.map((product) => product.units));
  const chosenProduct = products.find((product) => product.product_id === productId) ?? products[0];
  const demographics = statistics.demographics.filter(
    (row) => row.product_id === chosenProduct?.product_id,
  );
  const summary = statistics.summary;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Surface className="min-w-0 p-5">
        <h2 className="font-display text-lg font-bold">{t("Product rankings")}</h2>
        <p className={descriptionClass}>
          {t("Ranked by units sold in the selected period. Zero means no sales were recorded under these filters.")}
        </p>
        <label className="mt-3 block max-w-56 text-sm font-semibold">
          {t("Sort by units")}
          <select
            className={selectClass}
            value={leastFirst ? "least" : "most"}
            onChange={(event) => setLeastFirst(event.target.value === "least")}
          >
            <option value="most">{t("Most sold first")}</option>
            <option value="least">{t("Least sold first")}</option>
          </select>
        </label>
        <p className="mt-3 text-xs font-semibold text-ink-muted">
          {count.format(ranked.length)} {t("products · scroll for the full list")}
        </p>
        <div
          role="region"
          aria-label={t("Product rankings")}
          tabIndex={0}
          className="mt-2 max-h-[26rem] overflow-y-auto overscroll-contain rounded-xl border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-3 py-2 text-xs font-semibold text-ink-muted">
            <span className="w-8 text-center">{t("Rank")}</span>
            <span className="min-w-0 flex-1">{t("Product")}</span>
            <span className="text-right">{t("Units · Net revenue")}</span>
          </div>
          <ol className="divide-y divide-line">
            {ranked.map((product) => (
              <li key={product.product_id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                    product.rank <= 3 && product.units > 0
                      ? "bg-accent text-white"
                      : "bg-surface-strong text-ink-muted"
                  }`}
                >
                  {product.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{productName(product.product_id, product.product_name)}</div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-strong">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(100 * product.units) / mostUnits}%` }}
                    />
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="font-semibold">{count.format(product.units)}</div>
                  <div className="text-xs text-ink-muted">{formatMoney(Number(product.net))}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Surface>
      <Surface className="min-w-0 p-5">
        <h2 className="font-display text-lg font-bold">{t("Product sales by demographic")}</h2>
        <p className={descriptionClass}>
          {t("{identified} of {orders} matching orders are linked to a customer. Age is known for {ageOrders} orders and gender for {genderOrders}.")
            .replace("{identified}", count.format(summary.identified_orders))
            .replace("{orders}", count.format(summary.orders))
            .replace("{ageOrders}", count.format(summary.known_age_orders))
            .replace("{genderOrders}", count.format(summary.known_gender_orders))}
        </p>
        <label className="mt-3 block max-w-xs text-sm font-semibold">
          {t("Product for demographics")}
          <select
            className={selectClass}
            value={chosenProduct?.product_id ?? ""}
            onChange={(event) => setProductId(Number(event.target.value))}
          >
            {products.map((product) => (
              <option key={product.product_id} value={product.product_id}>
                {productName(product.product_id, product.product_name)}
              </option>
            ))}
          </select>
        </label>
        {demographics.length > 0 ? (
          <ReportTable
            headings={[t("Age group"), t("Gender"), t("Units"), t("Orders"), t("Known customers")]}
            rows={demographics.map((row) => ({
              key: JSON.stringify([row.age_group, row.gender]),
              cells: [
                t(row.age_group),
                t(row.gender),
                count.format(row.units),
                count.format(row.orders),
                count.format(row.unique_identified_customers),
              ],
            }))}
          />
        ) : (
          <p className={descriptionClass}>{t("No matching sales for this product.")}</p>
        )}
        <p className={descriptionClass}>
          {t("Unknown includes unlinked orders and missing profile fields. Groups reflect the current customer profile.")}
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
  const { t, formatMoney, campaignName, ensureTranslations } = usePreferences();
  const campaigns = statistics.by_campaign ?? [];
  useEffect(() => {
    if (campaigns.length) {
      void ensureTranslations(campaigns.map((item) => ({ source_text: item.campaign_name, context: "campaign" as const })));
    }
  }, [campaigns, ensureTranslations]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Surface className="min-w-0 p-5 lg:col-span-2">
        <h2 className="font-display text-lg font-bold">{t("Campaign performance")}</h2>
        <p className={descriptionClass}>
          {t("Sales include matching items on orders linked to a campaign code. Budget is the planned amount for the whole campaign.")}
        </p>
        {campaigns.length > 0 ? (
          <>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {[{ title: t("Orders by campaign"), key: "orders" as const, format: (v: number) => count.format(v) }, { title: t("Net revenue by campaign"), key: "net" as const, format: (v: number) => formatMoney(v) }].map(chart => {
                const max = Math.max(1, ...campaigns.map(c => Number(c[chart.key])));
                return <div key={chart.key} className="rounded-xl border border-line p-4">
                  <h3 className="text-sm font-bold">{chart.title}</h3>
                  <div className="mt-4 space-y-3">{campaigns.map(c => {
                    const value = Number(c[chart.key]);
                    return <div key={c.promocode}>
                      <div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate font-medium">{campaignName(c.campaign_name)}</span><span className="shrink-0 tabular-nums">{chart.format(value)}</span></div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface-strong"><div className="h-full rounded-full bg-accent" style={{ width: `${(value / max) * 100}%` }} /></div>
                    </div>;
                  })}</div>
                </div>;
              })}
            </div>
            <ReportTable
            headings={[
              t("Campaign"),
              t("Channel"),
              t("Planned budget"),
              t("Linked orders"),
              t("Discounts"),
              t("Net revenue"),
            ]}
            rows={campaigns.map((campaign) => ({
              key: campaign.promocode,
              cells: [
                <span>
                  {campaignName(campaign.campaign_name)}
                  <small className="ml-1.5 text-ink-muted">{campaign.promocode}</small>
                </span>,
                campaign.channel,
                formatMoney(Number(campaign.budget)),
                count.format(campaign.orders),
                formatMoney(Number(campaign.discount)),
                formatMoney(Number(campaign.net)),
              ],
            }))}
          />
          </>
        ) : (
          <p className={descriptionClass}>
            {t("No campaigns overlap this period or have linked sales under these filters.")}
          </p>
        )}
      </Surface>
      <RecommendationPanel />
      <DiscountPanel products={statistics.products} query={query} />
    </div>
  );
}

function RecommendationPanel() {
  const { t, productName } = usePreferences();
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
      <h2 className="font-display text-lg font-bold">{t("Customer recommendations")}</h2>
      <p className={descriptionClass}>
        {t("Uses all purchase history and looks for new items bought by customers with similar purchases.")}
      </p>
      <label className="mt-3 block text-sm font-semibold">
        {t("Customer")}
        <select
          aria-label={t("Customer")}
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
              ? t("Customers unavailable")
              : !customers
                ? t("Loading customers…")
                : customers.length
                  ? t("Select a customer")
                  : t("No customers available")}
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
          {t("Finding recommendations…")}
        </p>
      )}
      {result &&
        (result.items.length > 0 ? (
          <ReportTable
            headings={[t("Suggested product"), t("Similar customers")]}
            rows={result.items.map((item) => ({
              key: item.product_id,
              cells: [productName(item.product_id, item.product_name), count.format(item.supporting_customers)],
            }))}
          />
        ) : (
          <p className={descriptionClass}>
            {t("There is too little overlap in this customer’s linked purchase history to suggest a product.")}
          </p>
        ))}
    </Surface>
  );
}

function DiscountPanel({ products, query }: { products: Statistics["products"]; query: string }) {
  const { t, productName } = usePreferences();
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
      <h2 className="font-display text-lg font-bold">{t("Discount calculator")}</h2>
      <p className={descriptionClass}>
        {t("Suggests a discount percentage from how the product is selling under the current filters: the further it sells below the typical product, the larger the discount. Add the unit cost to also keep the suggestion inside the margin target; it is not saved.")}
      </p>
      <form className="mt-3 grid gap-3" onSubmit={submit}>
        <label className="block text-sm font-semibold">
          {t("Product for discount")}
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
            <option value="">{t("Select a product")}</option>
            {products.map((product) => (
              <option key={product.product_id} value={product.product_id}>
                {productName(product.product_id, product.product_name)} · {product.units} {t("sold")}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          {t("Unit cost (₩), optional")}
          <Input
            className="block w-full"
            type="number"
            min="0"
            step="0.01"
            max="99999999.99"
            value={unitCost}
            placeholder={t("Leave empty to skip the margin check")}
            disabled={pending}
            onChange={(event) => {
              setUnitCost(event.target.value);
              setResult(null);
              setError("");
            }}
          />
        </label>
        <Button type="submit" variant="primary" disabled={pending || !productId}>
          {pending ? t("Calculating…") : t("Suggest a discount")}
        </Button>
      </form>
      {error && (
        <p role="alert" className={descriptionClass}>
          {error}
        </p>
      )}
      {result && <DiscountResult result={result} />}
    </Surface>
  );
}

function DiscountResult({ result }: { result: DiscountSuggestion }) {
  const { t, language, formatMoney } = usePreferences();
  const item = result.item;
  const margin = Math.round(Number(result.minimum_margin) * 100) + "%";
  const wanted = item?.performance_discount_percent ?? 0;
  const standing = item?.performance;
  const suggested = item?.status === "trial_candidate";

  let headline = t("No discount suggested");
  const lines: string[] = [];

  if (!item) {
    lines.push(t("This product is not part of the current filters."));
  } else if (item.status === "insufficient_sales_history") {
    lines.push(t("Select a period with recorded sales to get a suggestion."));
  } else if (item.status === "no_comparison") {
    lines.push(t("There are no other products in this selection to compare sales against."));
  } else if (item.status === "zero_price") {
    lines.push(t("Set a positive selling price before evaluating a discount."));
  } else if (suggested) {
    headline = language === "ko" ? `${item.candidate_discount_percent}% 할인` : `${item.candidate_discount_percent}% off`;
    lines.push(
      language === "ko"
        ? `새 단가 ${formatMoney(Number(item.discounted_unit_price))}, 개당 ${formatMoney(Number(item.candidate_discount_amount))} 할인됩니다.`
        : `New unit price ${formatMoney(Number(item.discounted_unit_price))}, ${formatMoney(Number(item.candidate_discount_amount))} less per unit.`,
    );
    if (item.margin_checked === false) {
      lines.push(
        language === "ko"
          ? `판매 실적만을 기준으로 계산했습니다. 단가를 입력하면 매출총이익률 ${margin} 이상을 유지하는지 확인할 수 있습니다.`
          : `Based on sales only. Enter the unit cost to check that this keeps at least a ${margin} gross margin.`,
      );
    }
    if (item.limited_by === "margin") {
      lines.push(
        language === "ko"
          ? `판매 실적만 보면 ${wanted}% 할인이 적절하지만, 입력한 단가에서 매출총이익률 ${margin} 이상을 유지하도록 할인율을 낮췄습니다.`
          : `Sales alone point to ${wanted}%. It is lowered so the price keeps at least a ${margin} gross margin at this unit cost.`,
      );
    }
    if (item.required_unit_sales_multiplier) {
      lines.push(
        language === "ko"
          ? `동일한 매출총이익을 내려면 판매 수량이 현재의 약 ${item.required_unit_sales_multiplier.toFixed(2)}배가 되어야 합니다.`
          : `To earn the same gross profit, unit sales need to reach about ${item.required_unit_sales_multiplier.toFixed(2)}× today's.`,
      );
    }
  } else if (item.status === "selling_well") {
    lines.push(t("This product sells as well as or better than the typical product."));
  } else {
    headline = t("No discount fits the margin");
    lines.push(
      language === "ko"
        ? `판매 실적은 ${wanted}% 할인을 가리키지만, 현재 단가에서는 1% 할인만 적용해도 목표 매출총이익률 ${margin} 아래로 떨어집니다.`
        : `Sales point to ${wanted}%, but at this unit cost even a 1% discount would fall below the ${margin} gross margin target.`,
    );
  }

  return (
    <div
      role="status"
      className={`mt-4 rounded-xl border p-4 ${
        suggested ? "border-accent/20 bg-accent-soft" : "border-line bg-surface-strong"
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t("Suggested discount")}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{headline}</div>
      {standing && standing.percent_of_typical !== null && (
        <p className="mt-2 text-sm">
          {language === "ko"
            ? `${count.format(standing.units)}개 판매 · 일반 상품 대비 ${standing.percent_of_typical}% (${count.format(standing.typical_units)}개) · ${standing.of}개 중 ${standing.rank}위`
            : `Sold ${count.format(standing.units)} units · ${standing.percent_of_typical}% of typical (${count.format(standing.typical_units)} units) · Rank ${standing.rank} of ${standing.of}.`}
        </p>
      )}
      {lines.map((line) => (
        <p key={line} className="mt-1 text-sm text-ink-muted">
          {line}
        </p>
      ))}
    </div>
  );
}
