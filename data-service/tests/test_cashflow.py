"""Independent tests for external cash-flow and account performance accounting."""

from __future__ import annotations

import unittest

from app.cashflow import (
    calculate_xirr,
    cashflow_schedule,
    simulate_account,
    simulate_accounts,
)


DATES = [
    "2020-01-02",
    "2020-01-31",
    "2020-02-03",
    "2020-02-28",
    "2020-03-02",
    "2020-03-31",
]


def account(nav, **overrides):
    options = {
        "initial_capital": 10_000,
        "cashflow_enabled": True,
        "cashflow_amount": 1_000,
        "cashflow_frequency": "monthly",
        "cashflow_direction": "inflow",
        "twr_origin": nav[0],
        **overrides,
    }
    return simulate_account(
        DATES[:len(nav)],
        nav,
        **options,
    )


class CashFlowTests(unittest.TestCase):
    def test_no_cashflow_matches_initial_capital_wealth_index(self):
        result = account(
            [100, 110, 121, 133.1, 146.41, 161.051],
            cashflow_enabled=False,
        )
        self.assertEqual(result["events"], [])
        self.assertAlmostEqual(result["final_value"], 16_105.1)
        self.assertAlmostEqual(result["time_weighted_return_pct"], 61.051)

    def test_initial_capital_only(self):
        result = account([100, 100, 100], cashflow_enabled=False, cashflow_amount=0)
        self.assertEqual(result["balances"], [10_000, 10_000, 10_000])
        self.assertEqual(result["total_inflows"], 0)
        self.assertEqual(result["actual_outflows"], 0)

    def test_monthly_inflow_and_quarterly_inflow(self):
        monthly = account([100] * 6)
        self.assertEqual(
            [event["date"] for event in monthly["events"]],
            ["2020-02-03", "2020-03-02"],
        )
        self.assertAlmostEqual(monthly["final_value"], 12_000)

        quarterly_dates = [
            "2020-01-02",
            "2020-03-31",
            "2020-04-01",
            "2020-06-30",
            "2020-07-01",
        ]
        quarterly = simulate_account(
            quarterly_dates,
            [100] * len(quarterly_dates),
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_000,
            cashflow_frequency="quarterly",
            cashflow_direction="inflow",
            twr_origin=100,
        )
        self.assertEqual(
            [event["date"] for event in quarterly["events"]],
            ["2020-04-01", "2020-07-01"],
        )
        self.assertAlmostEqual(quarterly["final_value"], 12_000)

    def test_monthly_and_quarterly_outflow(self):
        monthly = account([100] * 6, cashflow_direction="outflow")
        self.assertAlmostEqual(monthly["final_value"], 8_000)
        self.assertAlmostEqual(monthly["actual_outflows"], 2_000)
        self.assertEqual(monthly["unpaid_outflows"], 0)

        dates = ["2020-01-02", "2020-03-31", "2020-04-01", "2020-06-30"]
        quarterly = simulate_account(
            dates,
            [100] * len(dates),
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_000,
            cashflow_frequency="quarterly",
            cashflow_direction="outflow",
            twr_origin=100,
        )
        self.assertAlmostEqual(quarterly["final_value"], 9_000)
        self.assertEqual(len(quarterly["events"]), 1)

    def test_inflow_followed_by_outflow(self):
        result = account(
            [100, 100, 100, 100],
            manual_events=[
                {"index": 1, "amount": 1_000, "direction": "inflow"},
                {"index": 2, "amount": 500, "direction": "outflow"},
            ],
            cashflow_direction="inflow",
        )
        self.assertEqual(result["cashflow_direction"], "mixed")
        self.assertAlmostEqual(result["total_inflows"], 1_000)
        self.assertAlmostEqual(result["actual_outflows"], 500)
        self.assertAlmostEqual(result["final_value"], 10_500)

    def test_withdrawal_equal_to_balance_depletes_exactly(self):
        result = account(
            [100, 100, 100],
            cashflow_direction="outflow",
            cashflow_amount=10_000,
        )
        self.assertEqual(result["actual_outflows"], 10_000)
        self.assertEqual(result["unpaid_outflows"], 0)
        self.assertEqual(result["final_value"], 0)

    def test_withdrawal_exceeding_balance_is_capped(self):
        result = account(
            [100, 100, 100],
            cashflow_direction="outflow",
            cashflow_amount=12_000,
        )
        self.assertEqual(result["requested_outflows"], 12_000)
        self.assertEqual(result["actual_outflows"], 10_000)
        self.assertEqual(result["unpaid_outflows"], 2_000)
        self.assertEqual(result["final_value"], 0)

    def test_balance_and_holdings_never_become_negative(self):
        result = account(
            [100, 80, 20, 1, 0.1, 0],
            cashflow_direction="outflow",
            cashflow_amount=2_000,
        )
        self.assertTrue(all(value >= 0 for value in result["balances"]))
        self.assertTrue(all(value >= 0 for value in result["holdings_values"]))
        self.assertTrue(all(value >= 0 for value in result["cash_values"]))
        self.assertTrue(all(value >= 0 for value in result["units"]))

    def test_inflow_after_depletion_can_rebuild_the_account(self):
        result = account(
            [100, 100, 100, 110],
            manual_events=[
                {"index": 1, "amount": 10_000, "direction": "outflow"},
                {"index": 2, "amount": 5_000, "direction": "inflow"},
            ],
        )
        self.assertEqual(result["balances"][1], 0)
        self.assertAlmostEqual(result["balances"][2], 5_000)
        self.assertAlmostEqual(result["final_value"], 5_500)

    def test_time_weighted_return_is_independent_of_contributions(self):
        base = account([100, 110, 121], cashflow_enabled=False)
        with_flows = account([100, 110, 121])
        self.assertAlmostEqual(base["time_weighted_return_pct"], 21.0)
        self.assertAlmostEqual(with_flows["time_weighted_return_pct"], 21.0)
        self.assertGreater(with_flows["final_value"], base["final_value"])

    def test_money_weighted_return_uses_actual_dates(self):
        result = simulate_account(
            ["2020-01-01", "2020-12-31"],
            [100, 110],
            initial_capital=10_000,
            cashflow_enabled=False,
            twr_origin=100,
        )
        self.assertAlmostEqual(result["money_weighted_return_pct"], 10.0, places=4)
        self.assertAlmostEqual(
            calculate_xirr(result["investor_flows"]),
            result["money_weighted_return_pct"],
            places=8,
        )

    def test_strategy_and_benchmarks_receive_the_same_requested_schedule(self):
        simulation = simulate_accounts(
            DATES,
            [100, 100, 100, 100, 100, 100],
            {
                "spy": [100, 110, 110, 121, 121, 133.1],
                "spmo": [100, 90, 90, 100, 100, 110],
            },
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_000,
            cashflow_frequency="monthly",
            cashflow_direction="outflow",
        )
        requested_dates = [
            [event["date"] for event in simulation["accounts"][key]["events"]]
            for key in ("strategy", "spy", "spmo")
        ]
        self.assertEqual(requested_dates[0], requested_dates[1])
        self.assertEqual(requested_dates[1], requested_dates[2])
        self.assertTrue(all(
            event["requested_amount"] == 1_000
            for account_result in simulation["accounts"].values()
            for event in account_result["events"]
        ))

    def test_benchmark_units_are_purchased_and_redeemed_at_each_close(self):
        dates = ["2020-01-02", "2020-01-31", "2020-02-03", "2020-02-28"]
        result = simulate_account(
            dates,
            [100, 110, 110, 121],
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_100,
            cashflow_frequency="monthly",
            cashflow_direction="inflow",
            twr_origin=100,
        )
        self.assertEqual(result["units"][:3], [100, 100, 110])
        self.assertAlmostEqual(result["balances"][2], 12_100)
        self.assertAlmostEqual(result["final_value"], 13_310)

        redeemed = simulate_account(
            dates,
            [100, 110, 110, 121],
            initial_capital=10_000,
            cashflow_enabled=True,
            cashflow_amount=1_100,
            cashflow_frequency="monthly",
            cashflow_direction="outflow",
            twr_origin=100,
        )
        self.assertAlmostEqual(redeemed["units"][2], 90)
        self.assertAlmostEqual(redeemed["balances"][2], 9_900)
        self.assertAlmostEqual(redeemed["final_value"], 10_890)

    def test_chart_values_are_twr_and_balances_reconcile(self):
        result = account([100, 110, 121, 110], cashflow_amount=2_000)
        expected_twr = [
            (value / 100 - 1) * 100
            for value in [100, 110, 121, 110]
        ]
        for actual, expected in zip(result["twr_values"], expected_twr):
            self.assertAlmostEqual(actual, expected)
        for balance, holdings, cash in zip(
            result["balances"],
            result["holdings_values"],
            result["cash_values"],
        ):
            self.assertAlmostEqual(balance, holdings + cash)

    def test_schedule_is_deterministic(self):
        first = cashflow_schedule(
            DATES,
            enabled=True,
            amount=1_000,
            frequency="monthly",
        )
        second = cashflow_schedule(
            DATES,
            enabled=True,
            amount=1_000,
            frequency="monthly",
        )
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
