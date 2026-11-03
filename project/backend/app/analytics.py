"""Pure analytics: no SQL, HTTP or UI dependencies. Money is integer cents."""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal


def cents(value):
    return int((Decimal(str(value)) * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))


def amount(value):
    return f'{Decimal(value) / 100:.2f}'


@dataclass(frozen=True)
class Filters:
    start: date
    end: date
    group: Literal['day', 'week', 'month', 'year'] = 'day'
    product_ids: tuple = ()
    category_ids: tuple = ()
    weekdays: tuple = ()  # Monday=0
    start_time: time = time(0, 0)
    end_time: time = time(23, 59, 59)

    def __post_init__(self):
        if self.end < self.start:
            raise ValueError('end must be on or after start')
        if (self.end - self.start).days > 3660:
            raise ValueError('Select at most 3661 calendar days')
        if self.group not in ('day', 'week', 'month', 'year'):
            raise ValueError('group must be day, week, month or year')
        if any(d not in range(7) for d in self.weekdays):
            raise ValueError('weekday must be 0 (Monday) to 6 (Sunday)')


def as_date(value):
    return value if type(value) is date else date.fromisoformat(str(value)[:10])


def as_time(value):
    if isinstance(value, time):
        return value
    if isinstance(value, timedelta):
        seconds = int(value.total_seconds())
        return time(seconds // 3600, seconds // 60 % 60, seconds % 60)
    return time.fromisoformat(str(value))


def bucket(d, group):
    if group == 'week':
        return (d - timedelta(days=d.weekday())).isoformat()
    if group == 'month':
        return d.strftime('%Y-%m')
    if group == 'year':
        return str(d.year)
    return d.isoformat()


def money_row(row):
    return {k: amount(v) if k in ('gross', 'discount', 'net') else v for k, v in row.items()}


def allocate_discount(lines, discount):
    """Largest remainder allocation; line cents always sum to the order discount."""
    gross = [cents(i['price']) * i['quantity'] for i in lines]
    subtotal = sum(gross)
    if discount < 0 or discount > subtotal:
        raise ValueError('Order discount must be between zero and its gross subtotal')
    if not subtotal:
        return [0] * len(lines)
    shares = [discount * g // subtotal for g in gross]
    remaining = discount - sum(shares)
    ranking = sorted(range(len(lines)), key=lambda i: (-(discount * gross[i] % subtotal), lines[i]['order_item_id']))
    for i in ranking[:remaining]:
        shares[i] += 1
    return shares


def selected_rows(snapshot, filters):
    products = {p['product_id']: p for p in snapshot['products']}
    customers = {p['customer_phone']: p for p in snapshot['customers']}
    grouped = defaultdict(list)
    for item in snapshot['orderItems']:
        grouped[item['order_id']].append(item)
    rows, inconsistencies = [], []
    for order in snapshot['orders']:
        d, t = as_date(order['order_date']), as_time(order['order_time'])
        if not filters.start <= d <= filters.end:
            continue
        if filters.weekdays and d.weekday() not in filters.weekdays:
            continue
        # Overnight time filter selects late/early times on each selected calendar date.
        a, b = filters.start_time, filters.end_time
        if not ((a <= t <= b) if a <= b else (t >= a or t <= b)):
            continue
        items = sorted(grouped[order['order_id']], key=lambda x: x['order_item_id'])
        allocations = allocate_discount(items, cents(order['discount']))
        calculated = sum(cents(i['price']) * i['quantity'] for i in items) - cents(order['discount'])
        if calculated != cents(order['total']):
            inconsistencies.append(order['order_id'])
        for item, allocated in zip(items, allocations):
            product = products.get(item['product_id'])
            if not product:
                raise ValueError('An order item references a missing product')
            if filters.product_ids and product['product_id'] not in filters.product_ids:
                continue
            if filters.category_ids and product['category_id'] not in filters.category_ids:
                continue
            gross = cents(item['price']) * item['quantity']
            rows.append({**item, 'product_name': product['product_name'], 'category_id': product['category_id'],
                         'date': d, 'time': t, 'gross': gross, 'discount': allocated, 'net': gross - allocated,
                         'customer': customers.get(order['customer_phone'])})
    return rows, inconsistencies


def age_group(customer):
    age = customer.get('customer_age') if customer else None
    if age is None:
        return 'Unknown'
    if age < 18: return 'Under 18'
    if age < 25: return '18-24'
    if age < 35: return '25-34'
    if age < 45: return '35-44'
    if age < 55: return '45-54'
    if age < 65: return '55-64'
    return '65+'


def analyze(snapshot, filters):
    rows, inconsistencies = selected_rows(snapshot, filters)
    catalog = [p for p in snapshot['products']
               if (not filters.product_ids or p['product_id'] in filters.product_ids)
               and (not filters.category_ids or p['category_id'] in filters.category_ids)]
    keys = sorted({bucket(filters.start + timedelta(days=i), filters.group)
                   for i in range((filters.end - filters.start).days + 1)})
    # Bound dense product x date output to keep a malformed request from exhausting memory.
    if len(keys) * len(catalog) > 100000:
        raise ValueError('Too many product-period combinations; select fewer products or a coarser grouping')
    blank = lambda: {'units': 0, 'gross': 0, 'discount': 0, 'net': 0, 'order_ids': set()}
    periods = {k: blank() for k in keys}
    product_periods = {(p['product_id'], k): blank() for p in catalog for k in keys}
    product_totals = {p['product_id']: blank() for p in catalog}
    demographics, hours, weekdays = {}, {i: blank() for i in range(24)}, {i: blank() for i in range(7)}
    categories = {p['category_id']: blank() for p in catalog}
    total = blank()
    linked_orders, known_age_orders, known_gender_orders = set(), set(), set()
    for row in rows:
        key = bucket(row['date'], filters.group)
        customer = row['customer']
        gender = ((customer.get('customer_gender') or '').strip() if customer else '') or 'Unknown'
        demographic_key = (row['product_id'], age_group(customer), gender)
        demo = demographics.setdefault(demographic_key, {**blank(), 'customer_ids': set()})
        if customer:
            demo['customer_ids'].add(customer['customer_phone'])
            linked_orders.add(row['order_id'])
            if customer.get('customer_age') is not None: known_age_orders.add(row['order_id'])
            if gender != 'Unknown': known_gender_orders.add(row['order_id'])
        for target in (total, periods[key], product_periods[row['product_id'], key],
                       product_totals[row['product_id']], demo, hours[row['time'].hour],
                       weekdays[row['date'].weekday()], categories[row['category_id']]):
            target['units'] += row['quantity']
            for field in ('gross', 'discount', 'net'): target[field] += row[field]
            target['order_ids'].add(row['order_id'])
    def result(v):
        return money_row({**{k: v[k] for k in ('units', 'gross', 'discount', 'net')}, 'orders': len(v['order_ids'])})
    names = {p['product_id']: p['product_name'] for p in catalog}
    summary = result(total)
    summary['average_order_value'] = amount(int((Decimal(total['net']) / len(total['order_ids'])).quantize(Decimal('1'), rounding=ROUND_HALF_UP))) if total['order_ids'] else '0.00'
    summary['identified_orders'] = len(linked_orders)
    summary['known_age_orders'] = len(known_age_orders)
    summary['known_gender_orders'] = len(known_gender_orders)
    summary['demographic_coverage_percent'] = round(100 * len(linked_orders) / len(total['order_ids']), 2) if total['order_ids'] else 0
    products = [{'product_id': p['product_id'], 'product_name': p['product_name'], **result(product_totals[p['product_id']])} for p in catalog]
    return {'summary': summary, 'group': filters.group, 'start': filters.start.isoformat(), 'end': filters.end.isoformat(),
            'periods': [{'period': k, **result(v)} for k, v in periods.items()],
            'product_series': [{'product_id': p['product_id'], 'product_name': p['product_name'],
                                'points': [{'period': k, **result(product_periods[p['product_id'], k])} for k in keys]} for p in catalog],
            'products': sorted(products, key=lambda p: (-p['units'], p['product_id'])),
            'by_hour': [{'hour': k, **result(v)} for k, v in hours.items()],
            'by_weekday': [{'weekday': k, **result(v)} for k, v in weekdays.items()],
            'by_category': [{'category_id': k, **result(v)} for k, v in categories.items()],
            'demographics': [{'product_id': k[0], 'product_name': names[k[0]], 'age_group': k[1], 'gender': k[2],
                              'unique_identified_customers': len(v['customer_ids']), **result(v)}
                             for k, v in sorted(demographics.items())],
            'warnings': ([f'{len(inconsistencies)} order totals disagree with item subtotals minus discounts; analytics uses item amounts minus allocated discounts.'] if inconsistencies else []),
            'definitions': {'net': 'gross minus allocated order discount; not profit',
                            'week': 'Monday start; first/last periods may be partial',
                            'average_order_value': 'selected-item net revenue / orders containing selected items',
                            'demographics': 'Customer profile at query time, not demographics at the historical sale date',
                            'zero_sales': 'No recorded sales in this selection; not proof of unpopularity or availability'}}
