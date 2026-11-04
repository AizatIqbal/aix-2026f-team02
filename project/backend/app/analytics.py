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
        if self.start_time.utcoffset() is not None or self.end_time.utcoffset() is not None:
            raise ValueError("Time filters must be local times without a timezone offset")


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


def allocate_discount(lines: list[dict], discount: int) -> list[int]:
    """Allocate order-level discount proportionally using largest remainder.

    The allocated line discounts always sum to the order discount in cents.
    Ties are resolved by order_item_id for deterministic output.
    """
    gross = [cents(item["price"]) * item["quantity"] for item in lines]
    subtotal = sum(gross)
    if discount < 0 or discount > subtotal:
        raise ValueError("Order discount must be between zero and its gross subtotal")
    if subtotal == 0:
        return [0] * len(lines)

    shares = [discount * line_gross // subtotal for line_gross in gross]
    remaining = discount - sum(shares)
    ranking = sorted(
        range(len(lines)),
        key=lambda index: (
            -(discount * gross[index] % subtotal),
            lines[index]["order_item_id"],
        ),
    )
    for index in ranking[:remaining]:
        shares[index] += 1
    return shares


def selected_rows(snapshot: dict, filters: Filters) -> tuple[list[dict], list[int]]:
    products = {product["product_id"]: product for product in snapshot["products"]}
    customers = {customer["customer_phone"]: customer for customer in snapshot["customers"]}
    items_by_order: dict[int, list[dict]] = defaultdict(list)
    for item in snapshot["orderItems"]:
        items_by_order[item["order_id"]].append(item)

    rows: list[dict] = []
    inconsistencies: list[int] = []

    for order in snapshot["orders"]:
        order_date = as_date(order["order_date"])
        order_time = as_time(order["order_time"])
        if not filters.start <= order_date <= filters.end:
            continue
        if filters.weekdays and order_date.weekday() not in filters.weekdays:
            continue

        start_time, end_time = filters.start_time, filters.end_time
        in_time_window = (
            start_time <= order_time <= end_time
            if start_time <= end_time
            else order_time >= start_time or order_time <= end_time
        )
        if not in_time_window:
            continue

        items = sorted(
            items_by_order[order["order_id"]],
            key=lambda item: item["order_item_id"],
        )
        discount_cents = cents(order["discount"])
        allocations = allocate_discount(items, discount_cents)
        calculated_total = (
            sum(cents(item["price"]) * item["quantity"] for item in items)
            - discount_cents
        )
        if calculated_total != cents(order["total"]):
            inconsistencies.append(order["order_id"])

        for item, allocated_discount in zip(items, allocations):
            product = products.get(item["product_id"])
            if product is None:
                raise ValueError("An order item references a missing product")
            if filters.product_ids and product["product_id"] not in filters.product_ids:
                continue
            if filters.category_ids and product["category_id"] not in filters.category_ids:
                continue

            gross = cents(item["price"]) * item["quantity"]
            rows.append(
                {
                    **item,
                    "product_name": product["product_name"],
                    "category_id": product["category_id"],
                    "date": order_date,
                    "time": order_time,
                    "gross": gross,
                    "discount": allocated_discount,
                    "net": gross - allocated_discount,
                    "customer": customers.get(order["customer_phone"]),
                }
            )

    return rows, inconsistencies


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

    def blank() -> dict:
        return {"units": 0, "gross": 0, "discount": 0, "net": 0, "order_ids": set()}

    periods = {key: blank() for key in period_keys}
    product_periods = {
        (product["product_id"], key): blank()
        for product in catalog
        for key in period_keys
    }
    product_totals = {product["product_id"]: blank() for product in catalog}
    demographics: dict[tuple, dict] = {}
    hours = {hour: blank() for hour in range(24)}
    weekdays = {weekday: blank() for weekday in range(7)}
    categories = {product["category_id"]: blank() for product in catalog}
    total = blank()
    identified_orders: set[int] = set()
    known_age_orders: set[int] = set()
    known_gender_orders: set[int] = set()

    for row in rows:
        period = bucket(row["date"], filters.group)
        customer = row["customer"]
        gender = (
            (customer.get("customer_gender") or "").strip() if customer else ""
        ) or "Unknown"
        demographic_key = (row["product_id"], age_group(customer), gender)
        demographic = demographics.setdefault(
            demographic_key,
            {**blank(), "customer_ids": set()},
        )
        if customer:
            demographic["customer_ids"].add(customer["customer_phone"])
            identified_orders.add(row["order_id"])
            if customer.get("customer_age") is not None:
                known_age_orders.add(row["order_id"])
            if gender != "Unknown":
                known_gender_orders.add(row["order_id"])

        targets = (
            total,
            periods[period],
            product_periods[(row["product_id"], period)],
            product_totals[row["product_id"]],
            demographic,
            hours[row["time"].hour],
            weekdays[row["date"].weekday()],
            categories[row["category_id"]],
        )
        for target in targets:
            target["units"] += row["quantity"]
            for field in ("gross", "discount", "net"):
                target[field] += row[field]
            target["order_ids"].add(row["order_id"])

    def result(values: dict) -> dict:
        return money_row(
            {
                **{key: values[key] for key in ("units", "gross", "discount", "net")},
                "orders": len(values["order_ids"]),
            }
        )

    names = {product["product_id"]: product["product_name"] for product in catalog}
    summary = result(total)
    summary["average_order_value"] = (
        amount(
            int(
                (Decimal(total["net"]) / len(total["order_ids"])).quantize(
                    Decimal("1"), rounding=ROUND_HALF_UP
                )
            )
        )
        if total["order_ids"]
        else "0.00"
    )
    summary["identified_orders"] = len(identified_orders)
    summary["known_age_orders"] = len(known_age_orders)
    summary["known_gender_orders"] = len(known_gender_orders)
    summary["demographic_coverage_percent"] = (
        round(100 * len(identified_orders) / len(total["order_ids"]), 2)
        if total["order_ids"]
        else 0
    )

    product_results = [
        {
            "product_id": product["product_id"],
            "product_name": product["product_name"],
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
        "demographics": [
            {
                "product_id": key[0],
                "product_name": names[key[0]],
                "age_group": key[1],
                "gender": key[2],
                "unique_identified_customers": len(values["customer_ids"]),
                **result(values),
            }
            for key, values in sorted(demographics.items())
        ],
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
