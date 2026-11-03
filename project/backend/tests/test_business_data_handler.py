"""Data conversion/service tests. These do not require a running MySQL server."""

import unittest
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal

from app.analytics import Filters
from app.business_data_service import BusinessDataService
from app.db.business_data_handler import MySQLBusinessDataHandler


class FakeTransaction:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.started = True
        return self

    def __exit__(self, kind, value, traceback):
        if kind is None:
            self.connection.committed = True
        else:
            self.connection.rolled_back = True


class FakeConnection:
    def __init__(self, database):
        self.database = database
        self.started = self.committed = self.rolled_back = False

    def execution_options(self, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def begin(self):
        return FakeTransaction(self)

    def execute(self, query):
        rows = self.database.fetch_all(str(query))
        class Result:
            def mappings(self):
                return self
            def all(self):
                return rows
        return Result()


class FakeEngine:
    def __init__(self, database):
        self.database = database

    def connect(self):
        return self.database.connection


class FakeDatabase:
    def __init__(self):
        self.connection = FakeConnection(self)
        self.engine = FakeEngine(self)
        self.fail_on = None
        # Rows have the aliases specified by the handler's SELECT queries.
        self.tables = {
            "product": [{"product_id": 1, "category_id": 1,
                         "product_name": "Cola", "price": Decimal("1980.500000")}],
            "customer": [{"customer_phone": "test-customer", "customer_age": 25,
                          "customer_gender": "Male"}],
            "orders": [{"order_id": 1, "customer_phone": "test-customer",
                        "order_date": date(2026, 11, 1),
                        "order_time": timedelta(hours=17, minutes=30),
                        "discount": Decimal("14259.60"), "total": Decimal("80804.400000")}],
            "order_item": [{"order_item_id": 1, "order_id": 1, "product_id": 1,
                            "quantity": 48, "price": Decimal("1980.500000")}],
        }

    def connect(self):
        pass

    def fetch_all(self, query, params=None):
        for table, rows in self.tables.items():
            if f"FROM {table} " in query:
                if table == self.fail_on:
                    raise RuntimeError("Simulated database read failure")
                return deepcopy(rows)
        raise AssertionError("Unexpected query")


class BusinessDataHandlerTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.handler = MySQLBusinessDataHandler(self.db)
        self.filters = Filters(date(2026, 11, 1), date(2026, 11, 2))

    def statistics(self):
        return BusinessDataService(self.handler).get_statistics(self.filters)

    def test_corrected_mysql_sample_reaches_existing_analytics(self):
        result = self.statistics()
        self.assertEqual(result["summary"]["units"], 48)
        self.assertEqual(result["summary"]["gross"], "95064.00")
        self.assertEqual(result["summary"]["discount"], "14259.60")
        self.assertEqual(result["summary"]["net"], "80804.40")
        self.assertEqual(result["summary"]["orders"], 1)
        self.assertEqual(result["periods"][1]["units"], 0)
        self.assertEqual(result["warnings"], [])

    def test_stored_total_mismatch_remains_visible(self):
        self.db.tables["orders"][0]["total"] = Decimal("1683.425000")
        result = self.statistics()
        self.assertEqual(result["summary"]["net"], "80804.40")
        self.assertEqual(len(result["warnings"]), 1)
        self.assertEqual(self.db.tables["orders"][0]["total"], Decimal("1683.425000"))

    def test_plain_numeric_discount_is_an_amount(self):
        self.db.tables["orders"][0].update(discount="10.00", total=Decimal("95054.00"))
        result = self.statistics()
        self.assertEqual(result["summary"]["discount"], "10.00")
        self.assertEqual(result["summary"]["net"], "95054.00")
        self.assertEqual(result["warnings"], [])

    def test_fifteen_is_money_not_fifteen_percent(self):
        self.db.tables["orders"][0].update(discount=Decimal("15.00"), total=Decimal("95049.00"))
        result = self.statistics()
        self.assertEqual(result["summary"]["discount"], "15.00")
        self.assertEqual(result["summary"]["net"], "95049.00")
        self.assertEqual(result["warnings"], [])

    def test_zero_discount_is_supported(self):
        self.db.tables["orders"][0].update(discount=Decimal("0.00"), total=Decimal("95064.00"))
        self.assertEqual(self.statistics()["summary"]["net"], "95064.00")

    def test_blank_and_null_discounts_are_rejected(self):
        for raw in (None, "", "  "):
            with self.subTest(discount=raw):
                self.db.tables["orders"][0].update(discount=raw, total=Decimal("95064.00"))
                with self.assertRaises(ValueError):
                    self.handler.get_analysis_records()

    def test_invalid_discounts_are_rejected(self):
        for raw in ("bad", "15%", "15%%", "101%", "-1%", "-5", "NaN", "Infinity", "999999"):
            with self.subTest(discount=raw):
                self.db.tables["orders"][0]["discount"] = raw
                with self.assertRaises(ValueError):
                    self.handler.get_analysis_records()

    def test_order_discount_is_counted_once_across_multiple_items(self):
        self.db.tables["order_item"].append({"order_item_id": 2, "order_id": 1,
                                            "product_id": 1, "quantity": 1,
                                            "price": Decimal("10.00")})
        self.db.tables["orders"][0].update(discount=Decimal("14261.10"), total=Decimal("80812.90"))
        result = self.statistics()
        self.assertEqual(result["summary"]["units"], 49)
        self.assertEqual(result["summary"]["gross"], "95074.00")
        self.assertEqual(result["summary"]["discount"], "14261.10")
        self.assertEqual(result["summary"]["net"], "80812.90")
        self.assertEqual(result["warnings"], [])

    def test_rounding_matches_existing_analytics(self):
        self.db.tables["order_item"][0].update(price=Decimal("1.005"), quantity=2)
        self.db.tables["orders"][0].update(discount=Decimal("0.20"), total=Decimal("1.82"))
        result = self.statistics()
        self.assertEqual(result["summary"]["gross"], "2.02")
        self.assertEqual(result["summary"]["discount"], "0.20")
        self.assertEqual(result["summary"]["net"], "1.82")
        self.assertEqual(result["warnings"], [])

    def test_empty_database_has_zero_statistics(self):
        self.db.tables = {table: [] for table in self.db.tables}
        result = self.statistics()
        self.assertEqual(result["summary"]["units"], 0)
        self.assertEqual(result["summary"]["net"], "0.00")

    def test_read_failure_ends_transaction_and_propagates_error(self):
        self.db.fail_on = "orders"
        with self.assertRaises(RuntimeError):
            self.handler.get_analysis_records()
        self.assertTrue(self.db.connection.rolled_back)
        self.assertFalse(self.db.connection.committed)

    def test_single_customer_does_not_fabricate_recommendations(self):
        result = BusinessDataService(self.handler).get_recommendations("test-customer")
        self.assertEqual(result["items"], [])
        self.assertEqual(result["status"], "insufficient_overlap")


if __name__ == "__main__":
    unittest.main()
