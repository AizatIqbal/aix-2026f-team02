"""Pure analytics functions. No SQL, HTTP, or UI dependencies.

All monetary aggregation is performed in integer cents to avoid floating-point
rounding drift. The input snapshot shape is supplied by the data handler.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

CENT = Decimal("0.01")


def cents(value: object) -> int:
    """Convert a decimal-like amount to integer cents, using half-up rounding."""
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def amount(value: int) -> str:
    """Format integer cents as a fixed two-decimal string."""
    return f"{Decimal(value) / 100:.2f}"


@dataclass(frozen=True)
class Filters:
    start: date
    end: date
    group: Literal["day", "week", "month", "year"] = "day"
    product_ids: tuple[int, ...] = ()
    category_ids: tuple[int, ...] = ()
    weekdays: tuple[int, ...] = ()  # Monday=0 ... Sunday=6
    start_time: time = time(0, 0)
    end_time: time = time(23, 59, 59)

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise ValueError("end must be on or after start")
        if (self.end - self.start).days > 3660:
            raise ValueError("Select at most 3661 calendar days")
        if self.group not in ("day", "week", "month", "year"):
            raise ValueError("group must be day, week, month or year")
        if any(type(value) is not int or value <= 0 for value in self.product_ids):
            raise ValueError("product_ids must contain positive integers")
        if any(type(value) is not int or value <= 0 for value in self.category_ids):
            raise ValueError("category_ids must contain positive integers")
        if any(type(day) is not int or day not in range(7) for day in self.weekdays):
            raise ValueError("weekdays must contain integers from 0 (Monday) to 6 (Sunday)")
        if not isinstance(self.start_time, time) or not isinstance(self.end_time, time):
            raise ValueError("start_time and end_time must be time values")
        if self.start_time.tzinfo is not None or self.end_time.tzinfo is not None:
            raise ValueError("start_time and end_time must use local times without a timezone")


def as_date(value: object) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def as_time(value: object) -> time:
    if isinstance(value, time):
        return value
    # Some database drivers represent SQL TIME values as timedelta.
    if isinstance(value, timedelta):
        seconds = int(value.total_seconds()) % (24 * 60 * 60)
        return time(seconds // 3600, (seconds // 60) % 60, seconds % 60)
    return time.fromisoformat(str(value))


def bucket(day: date, group: str) -> str:
    if group == "week":
        return (day - timedelta(days=day.weekday())).isoformat()
    if group == "month":
        return day.strftime("%Y-%m")
    if group == "year":
        return str(day.year)
    return day.isoformat()


def money_row(row: dict) -> dict:
    return {
        key: amount(value) if key in ("gross", "discount", "net") else value
        for key, value in row.items()
    }


def _allocate(gross: list[int], item_ids: list, discount: int) -> list[int]:
    """Largest-remainder split of ``discount`` over lines with ``gross`` cents."""
    subtotal = sum(gross)
    if discount < 0 or discount > subtotal:
        raise ValueError("Order discount must be between zero and its gross subtotal")
    if subtotal == 0 or discount == 0:
        return [0] * len(gross)

    shares = [discount * line_gross // subtotal for line_gross in gross]
    remaining = discount - sum(shares)
    ranking = sorted(
        range(len(gross)),
        key=lambda index: (-(discount * gross[index] % subtotal), item_ids[index]),
    )
    for index in ranking[:remaining]:
        shares[index] += 1
    return shares


def allocate_discount(lines: list[dict], discount: int) -> list[int]:
    """Allocate order-level discount proportionally using largest remainder.

    The allocated line discounts always sum to the order discount in cents.
    Ties are resolved by order_item_id for deterministic output.
    """
    return _allocate(
        [cents(item["price"]) * item["quantity"] for item in lines],
        [item["order_item_id"] for item in lines],
        discount,
    )


def selected_rows(snapshot: dict, filters: Filters) -> tuple[list[dict], list[int]]:
    """Return one row per selected order item, grouped order by order.

    Rows of the same order are contiguous; ``analyze`` relies on that to count
    distinct orders without building a set per bucket.
    """
    products = {product["product_id"]: product for product in snapshot["products"]}
    customers = {customer["customer_phone"]: customer for customer in snapshot["customers"]}
    product_filter = frozenset(filters.product_ids)
    category_filter = frozenset(filters.category_ids)
    weekday_filter = frozenset(filters.weekdays)
    start, end = filters.start, filters.end
    start_time, end_time = filters.start_time, filters.end_time
    overnight = start_time > end_time

    # Prices and discounts repeat heavily, so convert each distinct value once.
    cents_cache: dict = {}

    def to_cents(value) -> int:
        try:
            return cents_cache[value]
        except KeyError:
            result = cents_cache[value] = cents(value)
            return result

    # Pass 1: pick the orders, so items of other orders are never touched.
    selected: dict = {}
    for order in snapshot["orders"]:
        order_date = as_date(order["order_date"])
        if not start <= order_date <= end:
            continue
        if weekday_filter and order_date.weekday() not in weekday_filter:
            continue
        order_time = as_time(order["order_time"])
        in_time_window = (
            (order_time >= start_time or order_time <= end_time)
            if overnight
            else start_time <= order_time <= end_time
        )
        if not in_time_window:
            continue
        selected[order["order_id"]] = (order, order_date, order_time, [])

    # Pass 2: attach items to their selected order.
    for item in snapshot["orderItems"]:
        entry = selected.get(item["order_id"])
        if entry is not None:
            entry[3].append(item)

    rows: list[dict] = []
    inconsistencies: list[int] = []

    for order_id, (order, order_date, order_time, items) in selected.items():
        if len(items) > 1:
            items.sort(key=lambda item: item["order_item_id"])
        gross = [to_cents(item["price"]) * item["quantity"] for item in items]
        discount_cents = to_cents(order["discount"])
        allocations = _allocate(
            gross, [item["order_item_id"] for item in items], discount_cents
        )
        if sum(gross) - discount_cents != to_cents(order["total"]):
            inconsistencies.append(order_id)

        customer = customers.get(order["customer_phone"])
        promocode = order.get("promocode")
        for item, line_gross, allocated_discount in zip(items, gross, allocations):
            product = products.get(item["product_id"])
            if product is None:
                raise ValueError("An order item references a missing product")
            if product_filter and product["product_id"] not in product_filter:
                continue
            if category_filter and product["category_id"] not in category_filter:
                continue

            rows.append(
                {
                    **item,
                    "product_name": product["product_name"],
                    "category_id": product["category_id"],
                    "date": order_date,
                    "time": order_time,
                    "gross": line_gross,
                    "discount": allocated_discount,
                    "net": line_gross - allocated_discount,
                    "customer": customer,
                    "promocode": promocode,
                }
            )

    return rows, inconsistencies


AGE_GROUPS = ("Under 18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+")


def age_group(customer: dict | None) -> str:
    age = customer.get("customer_age") if customer else None
    if age is None:
        return "Unknown"
    if age < 18:
        return "Under 18"
    if age < 25:
        return "18-24"
    if age < 35:
        return "25-34"
    if age < 45:
        return "35-44"
    if age < 55:
        return "45-54"
    if age < 65:
        return "55-64"
    return "65+"


def analyze(snapshot: dict, filters: Filters) -> dict:
    rows, inconsistencies = selected_rows(snapshot, filters)
    catalog = [
        product
        for product in snapshot["products"]
        if (not filters.product_ids or product["product_id"] in filters.product_ids)
        and (not filters.category_ids or product["category_id"] in filters.category_ids)
    ]

    period_keys = sorted(
        {
            bucket(filters.start + timedelta(days=offset), filters.group)
            for offset in range((filters.end - filters.start).days + 1)
        }
    )
    if len(period_keys) * len(catalog) > 100_000:
        raise ValueError(
            "Too many product-period combinations; select fewer products or a coarser grouping"
        )

    # One bucket = [units, gross, discount, net, orders, last order counted].
    # Rows arrive order by order, so "last order counted" gives an exact
    # distinct-order count without keeping a set of order ids per bucket.
    UNITS, GROSS, DISCOUNT, NET, ORDERS, LAST = range(6)

    def blank() -> list:
        return [0, 0, 0, 0, 0, None]

    periods = {key: blank() for key in period_keys}
    product_periods = {
        (product["product_id"], key): blank()
        for product in catalog
        for key in period_keys
    }
    product_totals = {product["product_id"]: blank() for product in catalog}
    demographics: dict[tuple, list] = {}
    demographic_customers: dict[tuple, set] = {}
    hours = {hour: blank() for hour in range(24)}
    weekdays = {weekday: blank() for weekday in range(7)}
    categories = {product["category_id"]: blank() for product in catalog}
    campaigns = snapshot.get("campaigns", [])
    campaign_totals = {campaign["promocode"]: blank() for campaign in campaigns}
    total = blank()
    # Customer groups: totals per age group, per gender and per (age, gender).
    # A group holds [bucket, customer phones, units per product].
    age_totals: dict[str, list] = {}
    gender_totals: dict[str, list] = {}
    age_gender_totals: dict[tuple, list] = {}
    identified_customers: set = set()
    identified_orders = known_age_orders = known_gender_orders = 0
    last_identified = last_known_age = last_known_gender = None
    period_of: dict[date, str] = {}
    group = filters.group

    for row in rows:
        order_id = row["order_id"]
        day = row["date"]
        period = period_of.get(day)
        if period is None:
            period = period_of[day] = bucket(day, group)
        customer = row["customer"]
        gender = (
            (customer.get("customer_gender") or "").strip() if customer else ""
        ) or "Unknown"
        demographic_key = (row["product_id"], age_group(customer), gender)
        demographic = demographics.get(demographic_key)
        if demographic is None:
            demographic = demographics[demographic_key] = blank()
            demographic_customers[demographic_key] = set()
        if customer:
            demographic_customers[demographic_key].add(customer["customer_phone"])
            if last_identified != order_id:
                identified_orders += 1
                last_identified = order_id
            if customer.get("customer_age") is not None and last_known_age != order_id:
                known_age_orders += 1
                last_known_age = order_id
            if gender != "Unknown" and last_known_gender != order_id:
                known_gender_orders += 1
                last_known_gender = order_id

        units, gross, discount, net = row["quantity"], row["gross"], row["discount"], row["net"]
        targets = [
            total,
            periods[period],
            product_periods[(row["product_id"], period)],
            product_totals[row["product_id"]],
            demographic,
            hours[row["time"].hour],
            weekdays[day.weekday()],
            categories[row["category_id"]],
        ]
        campaign_total = campaign_totals.get(row["promocode"])
        if campaign_total is not None:
            targets.append(campaign_total)
        if customer:
            phone = customer["customer_phone"]
            identified_customers.add(phone)
            age = demographic_key[1]
            memberships = []
            if age != "Unknown":
                memberships.append((age_totals, age))
            if gender != "Unknown":
                memberships.append((gender_totals, gender))
            if age != "Unknown" and gender != "Unknown":
                memberships.append((age_gender_totals, (age, gender)))
            for groups, key in memberships:
                entry = groups.get(key)
                if entry is None:
                    entry = groups[key] = [blank(), set(), defaultdict(int)]
                entry[1].add(phone)
                entry[2][row["product_id"]] += units
                targets.append(entry[0])
        for target in targets:
            target[UNITS] += units
            target[GROSS] += gross
            target[DISCOUNT] += discount
            target[NET] += net
            if target[LAST] != order_id:
                target[ORDERS] += 1
                target[LAST] = order_id

    def result(values: list) -> dict:
        return {
            "units": values[UNITS],
            "gross": amount(values[GROSS]),
            "discount": amount(values[DISCOUNT]),
            "net": amount(values[NET]),
            "orders": values[ORDERS],
        }

    names = {product["product_id"]: product["product_name"] for product in catalog}

    def group_result(entry: list) -> dict:
        values, phones, product_units = entry
        favourites = sorted(product_units.items(), key=lambda item: (-item[1], item[0]))[:3]
        return {
            "customers": len(phones),
            **result(values),
            "top_products": [
                {"product_id": product_id, "product_name": names[product_id], "units": sold}
                for product_id, sold in favourites
            ],
        }
    summary = result(total)
    order_count = total[ORDERS]
    summary["average_order_value"] = (
        amount(
            int(
                (Decimal(total[NET]) / order_count).quantize(
                    Decimal("1"), rounding=ROUND_HALF_UP
                )
            )
        )
        if order_count
        else "0.00"
    )
    summary["identified_orders"] = identified_orders
    summary["known_age_orders"] = known_age_orders
    summary["known_gender_orders"] = known_gender_orders
    summary["demographic_coverage_percent"] = (
        round(100 * identified_orders / order_count, 2) if order_count else 0
    )

    product_results = [
        {
            "product_id": product["product_id"],
            "product_name": product["product_name"],
            "category_id": product["category_id"],
            **result(product_totals[product["product_id"]]),
        }
        for product in catalog
    ]

    return {
        "summary": summary,
        "group": filters.group,
        "start": filters.start.isoformat(),
        "end": filters.end.isoformat(),
        "periods": [
            {"period": key, **result(values)} for key, values in periods.items()
        ],
        "product_series": [
            {
                "product_id": product["product_id"],
                "product_name": product["product_name"],
                "points": [
                    {
                        "period": key,
                        **result(product_periods[(product["product_id"], key)]),
                    }
                    for key in period_keys
                ],
            }
            for product in catalog
        ],
        "products": sorted(
            product_results,
            key=lambda product: (-product["units"], product["product_id"]),
        ),
        "by_hour": [
            {"hour": hour, **result(values)} for hour, values in hours.items()
        ],
        "by_weekday": [
            {"weekday": weekday, **result(values)}
            for weekday, values in weekdays.items()
        ],
        "by_category": [
            {"category_id": category_id, **result(values)}
            for category_id, values in sorted(categories.items())
        ],
        "by_campaign": [
            {
                **campaign,
                "start_date": as_date(campaign["start_date"]).isoformat(),
                "end_date": as_date(campaign["end_date"]).isoformat(),
                "budget": amount(cents(campaign["budget"])),
                **result(campaign_totals[campaign["promocode"]]),
            }
            for campaign in campaigns
            if (
                as_date(campaign["start_date"]) <= filters.end
                and as_date(campaign["end_date"]) >= filters.start
            ) or campaign_totals[campaign["promocode"]][ORDERS]
        ],
        "demographics": [
            {
                "product_id": key[0],
                "product_name": names[key[0]],
                "age_group": key[1],
                "gender": key[2],
                "unique_identified_customers": len(demographic_customers[key]),
                **result(values),
            }
            for key, values in sorted(demographics.items())
        ],
        # Only orders linked to a customer whose age (or gender) is on file.
        "customer_groups": {
            "customers": len(identified_customers),
            "orders": identified_orders,
            "age_groups": [
                {"age_group": age, **group_result(age_totals[age])}
                for age in AGE_GROUPS
                if age in age_totals
            ],
            "genders": [
                {"gender": gender, **group_result(entry)}
                for gender, entry in sorted(gender_totals.items())
            ],
            "age_gender": [
                {"age_group": age, "gender": gender, **group_result(age_gender_totals[(age, gender)])}
                for age in AGE_GROUPS
                for gender in sorted(gender_totals)
                if (age, gender) in age_gender_totals
            ],
        },
        "warnings": (
            [
                f"{len(inconsistencies)} order totals disagree with item subtotals minus discounts; "
                "analytics uses item amounts minus allocated discounts."
            ]
            if inconsistencies
            else []
        ),
        "definitions": {
            "net": "gross minus allocated order discount; not profit",
            "week": "Monday start; first/last periods may be partial",
            "average_order_value": "selected-item net revenue / orders containing selected items",
            "demographics": "Customer profile at query time, not demographics at the historical sale date",
            "zero_sales": "No recorded sales in this selection; not proof of unpopularity or availability",
        },
    }
