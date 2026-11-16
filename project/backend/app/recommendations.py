"""Explainable recommendation and promotion-analysis heuristics.

Scores are similarity measures, not probabilities or proven preferences.
"""

from collections import Counter, defaultdict
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP

from .analytics import amount, analyze, cents


class CustomerNotFoundError(ValueError):
    """Raised when a recommendation is requested for an unknown customer."""


def recommend_products(
    snapshot: dict,
    customer_phone: str,
    min_support: int = 2,
    limit: int = 5,
) -> dict:
    if min_support < 1 or limit < 1:
        raise ValueError("min_support and limit must be positive integers")

    customer_phones = {customer["customer_phone"] for customer in snapshot["customers"]}
    if customer_phone not in customer_phones:
        raise CustomerNotFoundError("Customer does not exist")

    order_customers = {
        order["order_id"]: order["customer_phone"] for order in snapshot["orders"]
    }
    purchases: dict[str, set[int]] = defaultdict(set)
    for line in snapshot["orderItems"]:
        phone = order_customers.get(line["order_id"])
        if phone and phone in customer_phones:
            purchases[phone].add(line["product_id"])

    target_products = purchases[customer_phone]
    product_names = {
        product["product_id"]: product["product_name"]
        for product in snapshot["products"]
    }
    scores: Counter[int] = Counter()
    support: Counter[int] = Counter()

    for phone, products in purchases.items():
        if phone == customer_phone or not target_products.intersection(products):
            continue
        similarity = len(target_products.intersection(products)) / len(
            target_products.union(products)
        )
        for product_id in products - target_products:
            scores[product_id] += similarity
            support[product_id] += 1

    candidates = sorted(
        (
            product_id
            for product_id in scores
            if support[product_id] >= min_support and product_id in product_names
        ),
        key=lambda product_id: (
            -scores[product_id],
            -support[product_id],
            product_id,
        ),
    )[:limit]

    return {
        "method": "customer-purchase Jaccard similarity; exclude already purchased products",
        "items": [
            {
                "product_id": product_id,
                "product_name": product_names[product_id],
                "score": round(scores[product_id], 4),
                "supporting_customers": support[product_id],
            }
            for product_id in candidates
        ],
        "status": "ok" if candidates else "insufficient_overlap",
        "message": (
            "Purchases are evidence of buying, not explicit likes. A score is not a probability. "
            "No personalized result is fabricated when overlap is insufficient."
        ),
    }


# A product selling this far below the typical product, or worse, gets the
# full max_discount. 0.5 means "half the typical units or fewer".
FULL_DISCOUNT_SHORTFALL = Decimal("0.5")


def sales_performance(products: list[dict]) -> dict[int, dict]:
    """Compare each product's units sold with the typical product in the selection.

    "Typical" is the median units among products that sold at least once, so a
    long tail of unsold products does not drag the benchmark down to zero.
    rank 1 is the best seller; products with equal units share a rank.
    """
    selling = sorted(product["units"] for product in products if product["units"] > 0)
    middle = len(selling) // 2
    if not selling:
        typical = Decimal(0)
    elif len(selling) % 2:
        typical = Decimal(selling[middle])
    else:
        typical = Decimal(selling[middle - 1] + selling[middle]) / 2

    performance = {}
    for product in products:
        units = product["units"]
        ratio = Decimal(units) / typical if typical else None
        performance[product["product_id"]] = {
            "rank": 1 + sum(1 for other in products if other["units"] > units),
            "of": len(products),
            "units": units,
            "typical_units": float(typical),
            "ratio": ratio,
        }
    return performance


def performance_discount_percent(ratio: Decimal | None, max_discount: Decimal) -> int:
    """Whole-percent discount that grows the further a product sells below typical.

    At or above the typical product: 0. Below it the discount rises in a
    straight line and reaches max_discount when the product sells
    FULL_DISCOUNT_SHORTFALL (half) below typical or worse.
    """
    if ratio is None or ratio >= 1:
        return 0
    shortfall = min(Decimal(1), (1 - ratio) / FULL_DISCOUNT_SHORTFALL)
    return int((max_discount * 100 * shortfall).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def discount_suggestions(
    snapshot: dict,
    filters,
    costs: dict[int, Decimal],
    minimum_margin: Decimal = Decimal("0.30"),
    max_discount: Decimal = Decimal("0.20"),
) -> dict:
    """Suggest a discount percentage for every product from its sales performance.

    The further a product sells below the typical product in the selection,
    the larger the suggested discount (up to max_discount). A unit cost is
    optional: with one, the suggestion is lowered so the discounted price still
    keeps minimum_margin; without one, the suggestion rests on sales alone and
    is marked margin_checked=False. Unit costs are never saved.
    """
    if not Decimal("0") <= minimum_margin < Decimal("1"):
        raise ValueError("minimum_margin must be between zero (inclusive) and one (exclusive)")
    if not Decimal("0") <= max_discount <= Decimal("1"):
        raise ValueError("max_discount must be between zero and one")

    stats = analyze(snapshot, filters)
    rankings = sorted(
        stats["products"], key=lambda product: (product["units"], product["product_id"])
    )
    prices = {
        product["product_id"]: cents(product["price"])
        for product in snapshot["products"]
    }
    performance = sales_performance(rankings)
    has_sales = stats["summary"]["orders"] > 0
    suggestions = []

    for product in rankings:
        product_id = product["product_id"]
        price = prices[product_id]
        standing = performance[product_id]
        ratio = standing["ratio"]
        wanted = performance_discount_percent(ratio, max_discount)
        entry = {
            **product,
            "status": "needs_cost",
            "performance": {
                "rank": standing["rank"],
                "of": standing["of"],
                "units": standing["units"],
                "typical_units": standing["typical_units"],
                # 100 = sells exactly as much as the typical product.
                "percent_of_typical": None if ratio is None else round(float(ratio) * 100),
            },
            # What sales performance alone asks for, before the margin check.
            "performance_discount_percent": wanted,
            "candidate_discount_percent": None,
            "limited_by": None,
            # True only when a unit cost was supplied and the margin was verified.
            "margin_checked": False,
        }
        cost = costs.get(product_id)

        if not has_sales:
            entry["status"] = "insufficient_sales_history"
        elif standing["of"] < 2:
            entry["status"] = "no_comparison"
        elif wanted == 0:
            entry["status"] = "selling_well"
            entry["candidate_discount_percent"] = 0
        elif price <= 0:
            entry["status"] = "zero_price"
        elif cost is None:
            # No unit cost: suggest from sales alone, with the new price.
            reduction = price * wanted // 100
            entry.update(
                status="trial_candidate",
                candidate_discount_percent=wanted,
                limited_by="performance",
                candidate_discount_amount=amount(reduction),
                discounted_unit_price=amount(price - reduction),
            )
        else:
            cost_cents = cents(cost)
            entry["margin_checked"] = True
            # Largest price cut that still leaves minimum_margin on the new price.
            ceiling = Decimal(price) - Decimal(cost_cents) / (1 - minimum_margin)
            safe_cents = max(0, int(ceiling.quantize(Decimal("1"), rounding=ROUND_FLOOR)))
            affordable = safe_cents * 100 // price  # whole percent, rounded down
            percent = min(wanted, affordable)
            entry["maximum_discount_amount_under_assumptions"] = amount(safe_cents)
            entry["maximum_discount_percent"] = affordable
            if percent >= 1:
                reduction = price * percent // 100
                contribution = price - reduction - cost_cents
                entry.update(
                    status="trial_candidate",
                    candidate_discount_percent=percent,
                    limited_by="margin" if percent < wanted else "performance",
                    candidate_discount_amount=amount(reduction),
                    discounted_unit_price=amount(price - reduction),
                    contribution_per_unit=amount(contribution),
                    # Units to sell, per unit sold today, to earn the same gross profit.
                    required_unit_sales_multiplier=(
                        round((price - cost_cents) / contribution, 3) if contribution > 0 else None
                    ),
                )
            else:
                entry["status"] = "no_discount_within_margin"
        suggestions.append(entry)

    return {
        "items": suggestions,
        "minimum_margin": str(minimum_margin),
        "maximum_discount_fraction": str(max_discount),
        "method": (
            "Each product's units sold are compared with the typical (median) selling "
            "product in the selection. At or above typical: no discount. Below it the "
            "suggested percentage rises steadily, reaching the maximum when the product "
            "sells half as much as typical or less. When a unit cost is supplied, it is "
            "then lowered if needed to keep the minimum margin."
        ),
        "assumptions": [
            "Costs are supplied for this calculation, not stored in your schema.",
            "Without a unit cost the margin is not checked.",
            "Margin means (discounted price - unit cost) / discounted price.",
            "No taxes, fees, waste, stock or demand elasticity are modeled.",
            "Low sales can have causes a discount will not fix: stock, menu placement or a new product.",
            "A suggested percentage is a starting point for a trial, not a guaranteed profitable promotion.",
            "The current campaign schema applies fixed order-level discounts; product-specific execution needs a product-campaign mapping.",
        ],
    }
