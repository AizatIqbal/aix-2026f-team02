"""Explainable heuristics. Scores are not probabilities or proven preferences."""
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_FLOOR
from .analytics import cents, amount, analyze


def recommend_products(snapshot, customer_phone, min_support=2, limit=5):
    customers = {c['customer_phone'] for c in snapshot['customers']}
    if customer_phone not in customers:
        raise ValueError('Customer does not exist')
    phones = {o['order_id']: o['customer_phone'] for o in snapshot['orders']}
    bought = defaultdict(set)
    for line in snapshot['orderItems']:
        phone = phones.get(line['order_id'])
        if phone and phone in customers:
            bought[phone].add(line['product_id'])
    target = bought[customer_phone]
    names = {p['product_id']: p['product_name'] for p in snapshot['products']}
    scores, support = Counter(), Counter()
    for phone, products in bought.items():
        if phone == customer_phone or not target & products:
            continue
        similarity = len(target & products) / len(target | products)
        for pid in products - target:
            scores[pid] += similarity
            support[pid] += 1
    candidates = sorted((pid for pid in scores if support[pid] >= min_support and pid in names), key=lambda pid: (-scores[pid], -support[pid], pid))[:limit]
    return {'method': 'customer-purchase Jaccard similarity; exclude already purchased products',
            'items': [{'product_id': p, 'product_name': names[p], 'score': round(scores[p], 4), 'supporting_customers': support[p]} for p in candidates],
            'status': 'ok' if candidates else 'insufficient_overlap',
            'message': 'Purchases are evidence of buying, not explicit likes. A score is not a probability. No personalized result is fabricated when overlap is insufficient.'}


def discount_suggestions(snapshot, filters, costs, minimum_margin=Decimal('0.30'), max_discount=Decimal('0.20')):
    stats = analyze(snapshot, filters)
    rankings = sorted(stats['products'], key=lambda p: (p['units'], p['product_id']))
    prices = {p['product_id']: cents(p['price']) for p in snapshot['products']}
    # Bottom quartile by units, including ties. No promotion is automatically activated.
    cutoff = rankings[max(0, (len(rankings) - 1) // 4)]['units'] if rankings else 0
    result = []
    for p in rankings:
        if p['units'] > cutoff: continue
        pid, price = p['product_id'], prices[p['product_id']]
        entry = {**p, 'status': 'needs_cost', 'candidate_discount_percent': None,
                 'reason': 'Low observed unit sales. First check stock availability, menu exposure and product age.'}
        cost = costs.get(pid)
        if stats['summary']['orders'] == 0:
            entry['status'] = 'insufficient_sales_history'
        elif cost is not None and price > 0:
            cost_cents = cents(cost)
            ceiling = Decimal(price) - Decimal(cost_cents) / (1 - minimum_margin)
            safe_cents = max(0, int(min(ceiling, Decimal(price) * max_discount).quantize(Decimal('1'), rounding=ROUND_FLOOR)))
            entry['maximum_discount_amount_under_assumptions'] = amount(safe_cents)
            # A small 5% test candidate, not an asserted optimum. Round the amount down.
            proposed = int((Decimal(price) * Decimal('0.05')).quantize(Decimal('1'), rounding=ROUND_FLOOR))
            if proposed > 0 and proposed <= safe_cents:
                entry.update(status='trial_candidate', candidate_discount_percent=5,
                             candidate_discount_amount=amount(proposed), discounted_unit_price=amount(price-proposed),
                             contribution_per_unit=amount(price-proposed-cost_cents),
                             required_unit_sales_multiplier=round((price-cost_cents)/(price-proposed-cost_cents), 3))
            else:
                entry['status'] = 'no_5_percent_discount_within_margin'
        elif cost is not None:
            entry['status'] = 'zero_price'
        result.append(entry)
    return {'items': result, 'minimum_margin': str(minimum_margin), 'maximum_discount_fraction': str(max_discount),
            'assumptions': ['Costs are supplied for this calculation, not stored in your schema.',
                            'Margin means (discounted price - unit cost) / discounted price.',
                            'No taxes, fees, waste, stock or demand elasticity are modeled.',
                            'A 5% candidate is an experiment, not an optimal or guaranteed profitable promotion.',
                            'Current campaign schema applies fixed order-level discounts; product-specific execution needs a product-campaign mapping.']}
