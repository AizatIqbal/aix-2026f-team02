
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getCampaigns,
  getOrders,
  addCampaign,
  updateCampaign,
  type Campaign,
  type Order,
} from "./data-access";
import { Button, Input, Surface } from "./ui";

const money = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const today = new Date().toISOString().slice(0, 10);

function emptyCampaign(): Campaign {
  const end = new Date();
  end.setDate(end.getDate() + 30);

  return {
    promocode: "",
    campaign_name: "",
    channel: "In-store",
    start_date: today,
    end_date: end.toISOString().slice(0, 10),
    budget: 0,
    discount_value: 0,
  };
}

export function MarketingCampaigns({
  onOpenAnalysis,
}: {
  onOpenAnalysis: () => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [finished, setFinished] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [linkedCampaign, setLinkedCampaign] = useState<Campaign | null>(null);
  const [linkedOrders, setLinkedOrders] = useState<Order[]>([]);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedError, setLinkedError] = useState("");

  const reload = () =>
    getCampaigns()
      .then(setCampaigns)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
  }, []);

  const active = useMemo(
    () => campaigns.filter(
      c => c.start_date <= today && c.end_date >= today
    ),
    [campaigns]
  );

  const completed = useMemo(
    () => campaigns.filter(c => c.end_date < today),
    [campaigns]
  );

  const list = finished ? completed : active;

  async function showLinkedOrders(campaign: Campaign) {
    setLinkedCampaign(campaign);
    setLinkedOrders([]);
    setLinkedError("");
    setLinkedLoading(true);

    try {
      const allOrders = await getOrders();

      setLinkedOrders(
        allOrders.filter(
          order =>
            (order.promocode || "").toUpperCase() ===
            campaign.promocode.toUpperCase()
        )
      );
    } catch (caught) {
      setLinkedError(
        caught instanceof Error
          ? caught.message
          : "Could not load linked orders."
      );
    } finally {
      setLinkedLoading(false);
    }
  }

  function beginEdit(c: Campaign) {
    setEditing(c);
    setDraft({ ...c });
    setIsCreating(false);
    setError("");
  }

  function beginCreate() {
    setEditing(null);
    setDraft(emptyCampaign());
    setIsCreating(true);
    setError("");
  }

  function closeForm() {
    setEditing(null);
    setDraft(null);
    setIsCreating(false);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;

    if (draft.end_date < draft.start_date) {
      setError("End date cannot be earlier than start date.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        ...draft,
        promocode: draft.promocode.trim().toUpperCase(),
        campaign_name: draft.campaign_name.trim(),
        channel: draft.channel.trim(),
      };

      const saved = isCreating
        ? await addCampaign(payload)
        : await updateCampaign(payload.promocode, payload);

      setCampaigns(items =>
        isCreating
          ? [...items, saved]
          : items.map(c =>
              c.promocode === saved.promocode ? saved : c
            )
      );

      closeForm();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save campaign"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">
            Marketing campaigns
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Manage promotions and review their performance in Marketing analysis.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onOpenAnalysis}>
            View campaign analytics ↗
          </Button>

          <Button variant="primary" onClick={beginCreate}>
            + Add campaign
          </Button>
        </div>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Campaign status">
        <Button
          variant={!finished ? "primary" : "secondary"}
          aria-pressed={!finished}
          onClick={() => setFinished(false)}
        >
          Running ({active.length})
        </Button>

        <Button
          variant={finished ? "primary" : "secondary"}
          aria-pressed={finished}
          onClick={() => setFinished(true)}
        >
          Finished ({completed.length})
        </Button>
      </div>

      {loading ? (
        <Surface className="p-8 text-center text-ink-muted">
          Loading campaigns…
        </Surface>
      ) : list.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map(c => (
            <Surface
              key={c.promocode}
              className="flex flex-col gap-4 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-strong">
                    {c.channel}
                  </span>

                  <h2 className="mt-3 font-display text-lg font-bold">
                    {c.campaign_name}
                  </h2>

                  <p className="text-xs text-ink-muted">
                    {c.promocode}
                  </p>
                </div>

                <span className="rounded-full bg-surface-strong px-2 py-1 text-xs">
                  {finished ? "Finished" : "Running"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-ink-muted">Campaign period</p>
                  <p className="mt-1 font-semibold">
                    {c.start_date} – {c.end_date}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-ink-muted">Budget</p>
                  <p className="mt-1 font-semibold">
                    {money.format(Number(c.budget))}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-ink-muted">Discount</p>
                  <p className="mt-1 font-semibold">
                    {money.format(Number(c.discount_value))}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                <Button
                  variant="secondary"
                  onClick={() => void showLinkedOrders(c)}
                >
                  View linked orders
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => beginEdit(c)}
                >
                  Edit campaign
                </Button>
              </div>
            </Surface>
          ))}
        </div>
      ) : (
        <Surface className="p-10 text-center">
          <h2 className="font-semibold">
            No {finished ? "finished" : "running"} campaigns
          </h2>

          <p className="mt-1 text-sm text-ink-muted">
            Campaigns will appear here based on their start and end dates.
          </p>
        </Surface>
      )}

      {error && !draft && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {linkedCampaign && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setLinkedCampaign(null);
            }
          }}
        >
          <Surface className="my-auto max-h-[85vh] w-full max-w-3xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold">
                  Linked orders
                </h2>

                <p className="mt-1 text-sm text-ink-muted">
                  {linkedCampaign.campaign_name} · {linkedCampaign.promocode}
                </p>
              </div>

              <Button
                variant="ghost"
                onClick={() => setLinkedCampaign(null)}
              >
                Close
              </Button>
            </div>

            {linkedLoading ? (
              <p className="py-8 text-center text-sm text-ink-muted">
                Loading linked orders…
              </p>
            ) : linkedError ? (
              <p role="alert" className="py-6 text-sm text-danger">
                {linkedError}
              </p>
            ) : linkedOrders.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-ink-muted">
                    <tr>
                      <th className="p-2">Order</th>
                      <th className="p-2">Date</th>
                      <th className="p-2">Customer</th>
                      <th className="p-2 text-right">Total</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-line">
                    {linkedOrders.map(order => (
                      <tr key={order.order_id}>
                        <td className="p-2 font-semibold">
                          ORD-{String(order.order_id).padStart(4, "0")}
                        </td>

                        <td className="p-2">
                          {order.order_date}
                        </td>

                        <td className="p-2">
                          {order.customer_name || order.customer_phone || "Walk-in"}
                        </td>

                        <td className="p-2 text-right tabular-nums">
                          {money.format(Number(order.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-ink-muted">
                No orders have used this campaign code yet.
              </p>
            )}
          </Surface>
        </div>
      )}

      {(editing || isCreating) && draft && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <Surface className="my-auto max-h-[90vh] w-full max-w-xl overflow-y-auto p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-bold">
                {isCreating ? "Add campaign" : "Edit campaign"}
              </h2>

              <Button
                variant="ghost"
                type="button"
                onClick={closeForm}
              >
                Close
              </Button>
            </div>

            <form
              className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"
              onSubmit={save}
            >
              <label className="block min-w-0 text-sm font-semibold sm:col-span-2">
                Campaign name

                <Input
                  className="mt-1 block w-full min-w-0"
                  required
                  value={draft.campaign_name}
                  onChange={e =>
                    setDraft({ ...draft, campaign_name: e.target.value })
                  }
                />
              </label>

              <label className="block min-w-0 text-sm font-semibold">
                Channel

                <Input
                  className="mt-1 block w-full min-w-0"
                  required
                  value={draft.channel}
                  onChange={e =>
                    setDraft({ ...draft, channel: e.target.value })
                  }
                />
              </label>

              <label className="block min-w-0 text-sm font-semibold">
                Promo code

                <Input
                  className="mt-1 block w-full min-w-0"
                  required
                  maxLength={30}
                  disabled={!isCreating}
                  value={draft.promocode}
                  onChange={e =>
                    setDraft({
                      ...draft,
                      promocode: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>

              <label className="block min-w-0 text-sm font-semibold">
                Start date

                <Input
                  className="mt-1 block w-full min-w-0"
                  type="date"
                  required
                  value={draft.start_date.slice(0, 10)}
                  onChange={e =>
                    setDraft({ ...draft, start_date: e.target.value })
                  }
                />
              </label>

              <label className="block min-w-0 text-sm font-semibold">
                End date

                <Input
                  className="mt-1 block w-full min-w-0"
                  type="date"
                  required
                  value={draft.end_date.slice(0, 10)}
                  onChange={e =>
                    setDraft({ ...draft, end_date: e.target.value })
                  }
                />
              </label>

              <label className="block min-w-0 text-sm font-semibold">
                Budget (₩)

                <Input
                  className="mt-1 block w-full min-w-0"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={draft.budget}
                  onChange={e =>
                    setDraft({ ...draft, budget: Number(e.target.value) })
                  }
                />
              </label>

              <label className="block min-w-0 text-sm font-semibold">
                Discount (₩)

                <Input
                  className="mt-1 block w-full min-w-0"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={draft.discount_value}
                  onChange={e =>
                    setDraft({
                      ...draft,
                      discount_value: Number(e.target.value),
                    })
                  }
                />
              </label>

              {error && (
                <p role="alert" className="sm:col-span-2 text-sm text-danger">
                  {error}
                </p>
              )}

              <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={closeForm}
                >
                  Cancel
                </Button>

                <Button type="submit" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : isCreating
                      ? "Create campaign"
                      : "Save changes"}
                </Button>
              </div>
            </form>
          </Surface>
        </div>
      )}
    </section>
  );
}
