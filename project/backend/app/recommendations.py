"""Explainable recommendation and promotion-analysis heuristics.

Scores are similarity measures, not probabilities or proven preferences.
"""

from collections import Counter, defaultdict
from decimal import Decimal, ROUND_FLOOR

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


def discount_suggestions(
    snapshot: dict,
    filters,
    costs: dict[int, Decimal],
    minimum_margin: Decimal = Decimal("0.30"),
    max_discount: Decimal = Decimal("0.20"),
) -> dict:
    """Generate cautious discount experiment candidates using externally supplied unit costs.

    Unit costs are supplied for each calculation and are never saved.
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
    cutoff = rankings[max(0, (len(rankings) - 1) // 4)]["units"] if rankings else 0
    suggestions = []

    for product in rankings:
        if product["units"] > cutoff:
            continue
        product_id = product["product_id"]
        price = prices[product_id]
        entry = {
            **product,
            "status": "needs_cost",
            "candidate_discount_percent": None,
            "reason": (
                "Low observed unit sales. First check stock availability, menu exposure "
                "and product age."
            ),
        }
        cost = costs.get(product_id)

        if stats["summary"]["orders"] == 0:
            entry["status"] = "insufficient_sales_history"
        elif cost is not None and price > 0:
            cost_cents = cents(cost)
            ceiling = Decimal(price) - Decimal(cost_cents) / (1 - minimum_margin)
            safe_cents = max(
                0,
                int(
                    min(ceiling, Decimal(price) * max_discount).quantize(
                        Decimal("1"), rounding=ROUND_FLOOR
                    )
                ),
            )
            entry["maximum_discount_amount_under_assumptions"] = amount(safe_cents)
            proposed = int(
                (Decimal(price) * Decimal("0.05")).quantize(
                    Decimal("1"), rounding=ROUND_FLOOR
                )
            )
            if proposed > 0 and proposed <= safe_cents:
                entry.update(
                    status="trial_candidate",
                    candidate_discount_percent=5,
                    candidate_discount_amount=amount(proposed),
                    discounted_unit_price=amount(price - proposed),
                    contribution_per_unit=amount(price - proposed - cost_cents),
                    required_unit_sales_multiplier=round(
                        (price - cost_cents) / (price - proposed - cost_cents), 3
                    ),
                )
            else:
                entry["status"] = "no_5_percent_discount_within_margin"
        elif cost is not None:
            entry["status"] = "zero_price"
        suggestions.append(entry)

    return {
        "items": suggestions,
        "minimum_margin": str(minimum_margin),
        "maximum_discount_fraction": str(max_discount),
        "assumptions": [
            "Costs are supplied for this calculation, not stored in your schema.",
            "Margin means (discounted price - unit cost) / discounted price.",
            "No taxes, fees, waste, stock or demand elasticity are modeled.",
            "A 5% candidate is an experiment, not an optimal or guaranteed profitable promotion.",
            "The current campaign schema applies fixed order-level discounts; product-specific execution needs a product-campaign mapping.",
        ],
    }
