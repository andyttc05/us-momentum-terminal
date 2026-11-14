"""Independent numerical tests for the cashflow-aware account simulation.

Every expectation in this file is hand-calculated from the stated capital, the
stated NAV path and the stated external flows. Nothing is copied from the
implementation, so a broken simulation cannot make its own test pass.

The same scenario table is asserted by ``frontend/tests/backtest-accounting
.test.mjs``. Both suites must agree with these numbers, which is how the Python
service and the browser fallback engine are kept in parity.
"""

from __future__ import annotations

import math
import unittest

from app.cashflow import audit_account, simulate_account, simulate_accounts

# Month-boundary observations so the monthly schedule fires on 2020-02-03 and
# 2020-03-02 (the first observation of each new calendar period).
DATES = [
    "2020-01-02",
    "2020-01-31",
    "2020-02-03",
    "2020-02-28",
    "2020-03-02",
    "2020-03-31",
]

RISING = [100.0, 110.0, 110.0, 121.0, 121.0, 133.1]
FALLING = [100.0, 90.0, 90.0, 81.0, 81.0, 72.9]
FLAT = [100.0] * len(DATES)


def run(nav, *, direction="inflow", amount=1_000.0, enabled=True, capital=10_000.0):
    return simulate_account(
        DATES[: len(nav)],
        nav,
        initial_capital=capital,
        cashflow_enabled=enabled,
        cashflow_amount=amount,
        cashflow_frequency="monthly",
        cashflow_direction=direction,
        twr_origin=nav[0] if nav and nav[0] > 0 else None,
    )


class AccountScenarioTests(unittest.TestCase):
    """The thirteen market/flow combinations required by the brief."""

    def assert_clean(self, result, dates=None):
        problems = audit_account(result, dates or DATES[: len(result["balances"])])
        self.assertEqual(problems, [], f"accounting identities violated: {problems}")

    def test_01_flat_market_without_cashflows(self):
        result = run(FLAT, enabled=False)
        self.assertEqual(result["balances"], [10_000.0] * len(FLAT))
        self.assertEqual(result["events"], [])
        self.assertEqual(result["time_weighted_return_pct"], 0.0)
        self.assertAlmostEqual(result["money_weighted_return_pct"], 0.0, places=6)
        self.assertEqual(result["balance_drawdown"], [0.0] * len(FLAT))
        self.assert_clean(result)

    def test_02_flat_market_with_regular_inflows(self):
        result = run(FLAT)
        self.assertEqual(result["final_value"], 12_000.0)
        self.assertEqual(result["total_inflows"], 2_000.0)
        self.assertEqual(result["time_weighted_return_pct"], 0.0)
        self.assertEqual(result["net_profit_loss"], 0.0)
        # A deposit is not a return, so MWR is still zero.
        self.assertAlmostEqual(result["money_weighted_return_pct"], 0.0, places=6)
        self.assert_clean(result)

    def test_03_flat_market_with_regular_outflows(self):
        result = run(FLAT, direction="outflow")
        self.assertEqual(result["final_value"], 8_000.0)
        self.assertEqual(result["actual_outflows"], 2_000.0)
        self.assertEqual(result["unpaid_outflows"], 0.0)
        self.assertEqual(result["time_weighted_return_pct"], 0.0)
        self.assertAlmostEqual(result["money_weighted_return_pct"], 0.0, places=6)
        # Withdrawals move the balance, so the account drawdown records them.
        self.assertLess(result["max_balance_drawdown_pct"], -15.0)
        self.assert_clean(result)

    def test_04_positive_market_with_inflows(self):
        result = run(RISING)
        # 10,000 -> 11,000 -> +1,000 -> 12,000 -> x1.1 -> 13,200 -> +1,000 -> 14,200 -> x1.1
        self.assertEqual(
            [round(value, 6) for value in result["balances"]],
            [10_000.0, 11_000.0, 12_000.0, 13_200.0, 14_200.0, 15_620.0],
        )
        self.assertAlmostEqual(result["time_weighted_return_pct"], 33.1, places=6)
        self.assertAlmostEqual(result["net_profit_loss"], 3_620.0, places=6)
        self.assert_clean(result)

    def test_05_positive_market_with_outflows(self):
        result = run(RISING, direction="outflow")
        self.assertEqual(
            [round(value, 6) for value in result["balances"]],
            [10_000.0, 11_000.0, 10_000.0, 11_000.0, 10_000.0, 11_000.0],
        )
        self.assertAlmostEqual(result["time_weighted_return_pct"], 33.1, places=6)
        self.assertEqual(result["actual_outflows"], 2_000.0)
        self.assertEqual(result["net_profit_loss"], 3_000.0)
        self.assert_clean(result)

    def test_06_negative_market_with_inflows(self):
        result = run(FALLING)
        self.assertEqual(
            [round(value, 6) for value in result["balances"]],
            [10_000.0, 9_000.0, 10_000.0, 9_000.0, 10_000.0, 9_000.0],
        )
        self.assertAlmostEqual(result["time_weighted_return_pct"], -27.1, places=6)
        self.assertAlmostEqual(result["net_profit_loss"], -3_000.0, places=6)
        self.assert_clean(result)

    def test_07_negative_market_with_outflows(self):
        result = run(FALLING, direction="outflow")
        self.assertEqual(
            [round(value, 6) for value in result["balances"]],
            [10_000.0, 9_000.0, 8_000.0, 7_200.0, 6_200.0, 5_580.0],
        )
        self.assertAlmostEqual(result["time_weighted_return_pct"], -27.1, places=6)
        self.assertAlmostEqual(result["net_profit_loss"], -2_420.0, places=6)
        self.assert_clean(result)

    def test_08_severe_crash_with_withdrawals(self):
        nav = [100.0, 50.0, 50.0, 25.0, 25.0, 12.5]
        result = run(nav, direction="outflow", amount=6_000.0)
        self.assertEqual(result["balances"][:3], [10_000.0, 5_000.0, 0.0])
        self.assertEqual(result["requested_outflows"], 12_000.0)
        self.assertEqual(result["actual_outflows"], 5_000.0)
        self.assertEqual(result["unpaid_outflows"], 7_000.0)
        self.assertEqual(result["final_value"], 0.0)
        # A 50% loss is the investment drawdown; the depletion is the account one.
        self.assertAlmostEqual(result["max_balance_drawdown_pct"], -100.0, places=6)
        self.assert_clean(result)

    def test_09_outflow_exceeding_the_available_balance(self):
        result = run(FLAT, direction="outflow", amount=12_000.0)
        self.assertEqual(result["requested_outflows"], 24_000.0)
        self.assertEqual(result["actual_outflows"], 10_000.0)
        self.assertEqual(result["unpaid_outflows"], 14_000.0)
        self.assertEqual(result["final_value"], 0.0)
        first_event = result["events"][0]
        self.assertEqual(first_event["requested_amount"], 12_000.0)
        self.assertEqual(first_event["actual_amount"], 10_000.0)
        self.assertEqual(first_event["unpaid_amount"], 2_000.0)
        self.assert_clean(result)

    def test_10_exact_account_depletion(self):
        result = run(FLAT, direction="outflow", amount=10_000.0)
        self.assertEqual(result["requested_outflows"], 20_000.0)
        self.assertEqual(result["actual_outflows"], 10_000.0)
        # The later request cannot be funded, so it is recorded as unpaid.
        self.assertEqual(result["unpaid_outflows"], 10_000.0)
        self.assertEqual(result["final_value"], 0.0)
        self.assertAlmostEqual(result["remaining_units"], 0.0, places=9)
        self.assertEqual(result["ending_holdings_value"], 0.0)
        self.assertEqual(result["ending_cash"], 0.0)
        self.assert_clean(result)

    def test_11_inflow_after_depletion_restarts_investment(self):
        result = simulate_account(
            DATES[:4],
            [100.0, 100.0, 100.0, 110.0],
            initial_capital=10_000.0,
            manual_events=[
                {"index": 1, "amount": 10_000.0, "direction": "outflow"},
                {"index": 2, "amount": 5_000.0, "direction": "inflow"},
            ],
            twr_origin=100.0,
        )
        self.assertEqual(result["balances"][:3], [10_000.0, 0.0, 5_000.0])
        # The rebuilt account earns the next day's 10% on the new capital only.
        self.assertEqual(result["balances"][3], 5_500.0)
        self.assertAlmostEqual(result["time_weighted_return_pct"], 10.0, places=6)
        self.assert_clean(result, DATES[:4])

    def test_12_all_accounts_share_one_cashflow_schedule(self):
        simulation = simulate_accounts(
            DATES,
            RISING,
            {"spy": [100.0, 101.0, 102.0, 103.0, 104.0, 105.0],
             "spmo": [100.0, 99.0, 98.0, 97.0, 96.0, 95.0]},
            initial_capital=10_000.0,
            cashflow_enabled=True,
            cashflow_amount=750.0,
            cashflow_frequency="monthly",
            cashflow_direction="outflow",
        )
        accounts = simulation["accounts"]
        dates = {
            key: [event["date"] for event in accounts[key]["events"]]
            for key in ("strategy", "spy", "spmo")
        }
        self.assertEqual(dates["strategy"], ["2020-02-03", "2020-03-02"])
        self.assertEqual(dates["strategy"], dates["spy"])
        self.assertEqual(dates["spy"], dates["spmo"])
        for key in ("strategy", "spy", "spmo"):
            requested = [event["requested_amount"] for event in accounts[key]["events"]]
            self.assertEqual(requested, [750.0, 750.0], key)
            self.assertEqual(audit_account(accounts[key], DATES), [], key)

    def test_13_different_navs_produce_different_balances(self):
        simulation = simulate_accounts(
            DATES,
            FLAT,
            {"spy": RISING, "spmo": FALLING},
            initial_capital=10_000.0,
            cashflow_enabled=True,
            cashflow_amount=1_000.0,
            cashflow_frequency="monthly",
            cashflow_direction="inflow",
        )
        accounts = simulation["accounts"]
        # Same requested flows, same capital, different investment paths.
        self.assertEqual(accounts["strategy"]["final_value"], 12_000.0)
        # 10,000 -> 11,000 -> +1,000 -> 12,000 -> x1.1 -> 13,200 -> +1,000 -> x1.1
        self.assertAlmostEqual(accounts["spy"]["final_value"], 15_620.0, places=6)
        self.assertGreater(accounts["spy"]["final_value"], accounts["strategy"]["final_value"])
        self.assertLess(accounts["spmo"]["final_value"], accounts["strategy"]["final_value"])
        self.assertNotEqual(accounts["spy"]["balances"], accounts["spmo"]["balances"])


class ReturnMeasurementTests(unittest.TestCase):
    """TWR must stay flow-neutral; MWR must price the actual timing."""

    def test_14_time_weighted_return_has_no_cashflow_jumps(self):
        flows = simulate_account(
            DATES,
            RISING,
            initial_capital=10_000.0,
            cashflow_enabled=True,
            cashflow_amount=5_000.0,
            cashflow_frequency="monthly",
            cashflow_direction="inflow",
            twr_origin=100.0,
        )
        expected = [(value / 100.0 - 1.0) * 100.0 for value in RISING]
        for actual, target in zip(flows["twr_values"], expected):
            self.assertAlmostEqual(actual, target, places=9)
        # The balance chart, by contrast, jumps on every deposit.
        self.assertAlmostEqual(flows["balances"][2] - flows["balances"][1], 5_000.0, places=6)

    def test_15_money_weighted_return_responds_to_cashflow_timing(self):
        early = simulate_account(
            ["2020-01-02", "2020-06-30", "2020-12-31"],
            [100.0, 110.0, 110.0],
            initial_capital=10_000.0,
            cashflow_enabled=False,
            twr_origin=100.0,
        )
        # The same investment outcome, but half the capital arrives after the gain.
        late = simulate_account(
            ["2020-01-02", "2020-06-30", "2020-12-31"],
            [100.0, 110.0, 110.0],
            initial_capital=10_000.0,
            manual_events=[{"index": 1, "amount": 10_000.0, "direction": "inflow"}],
            twr_origin=100.0,
        )
        self.assertAlmostEqual(early["time_weighted_return_pct"], late["time_weighted_return_pct"], places=9)
        self.assertNotAlmostEqual(
            early["money_weighted_return_pct"],
            late["money_weighted_return_pct"],
            places=2,
        )
        # Capital that missed the gain must not earn it.
        self.assertLess(late["money_weighted_return_pct"], early["money_weighted_return_pct"])

    def test_16_investment_drawdown_ignores_external_flows(self):
        nav = [100.0, 120.0, 84.0, 84.0, 84.0, 84.0]
        without = simulate_account(
            DATES, nav, initial_capital=10_000.0, cashflow_enabled=False, twr_origin=100.0
        )
        with_deposit = simulate_account(
            DATES, nav, initial_capital=10_000.0, cashflow_enabled=True,
            cashflow_amount=5_000.0, cashflow_frequency="monthly",
            cashflow_direction="inflow", twr_origin=100.0,
        )
        nav_drawdown = []
        peak = 0.0
        for value in nav:
            peak = max(peak, value)
            nav_drawdown.append((value / peak - 1.0) * 100.0)
        self.assertAlmostEqual(min(nav_drawdown), -30.0, places=6)
        for series in (without, with_deposit):
            # TWR is a return, so its drawdown is measured on the unitized NAV
            # and a deposit cannot change it.
            self.assertAlmostEqual(series["time_weighted_return_pct"], -16.0, places=6)
        # Without flows the balance and the NAV fall together.
        self.assertAlmostEqual(min(without["balance_drawdown"]), -30.0, places=6)
        # A deposit lifts the balance above the old high-water mark, so the
        # account-balance series records no decline at all. Only the unitized
        # NAV admits that the investment fell 30% - which is exactly why the
        # investment drawdown is the risk metric.
        self.assertAlmostEqual(with_deposit["max_balance_drawdown_pct"], 0.0, places=6)


class CriticalScenarioTests(unittest.TestCase):
    """Initial 10,000 -> 12,000 -> withdraw 12,000."""

    def setUp(self):
        self.result = simulate_account(
            ["2020-01-02", "2020-02-03", "2020-03-02", "2020-04-01", "2020-05-01"],
            [100.0, 120.0, 120.0, 120.0, 120.0],
            initial_capital=10_000.0,
            cashflow_enabled=True,
            cashflow_amount=12_000.0,
            cashflow_frequency="monthly",
            cashflow_direction="outflow",
            twr_origin=100.0,
        )

    def test_withdrawal_is_executed_in_full_and_depletes_the_account(self):
        first = self.result["events"][0]
        self.assertEqual(first["date"], "2020-02-03")
        self.assertEqual(first["actual_amount"], 12_000.0)
        self.assertEqual(first["unpaid_amount"], 0.0)
        self.assertEqual(first["balance_after"], 0.0)
        self.assertEqual(self.result["final_value"], 0.0)
        self.assertEqual(self.result["remaining_units"], 0.0)

    def test_no_negative_holdings_and_no_phantom_growth(self):
        self.assertTrue(all(value >= 0 for value in self.result["balances"]))
        self.assertTrue(all(value >= 0 for value in self.result["holdings_values"]))
        self.assertEqual(self.result["balances"][1:], [0.0, 0.0, 0.0, 0.0])

    def test_returns_are_still_correct(self):
        # TWR is the investment performance up to the withdrawal.
        self.assertAlmostEqual(self.result["time_weighted_return_pct"], 20.0, places=6)
        # The investor turned 10,000 into 12,000 between the two dated flows.
        from datetime import date

        days = (date(2020, 2, 3) - date(2020, 1, 2)).days
        expected = ((12_000.0 / 10_000.0) ** (365.0 / days) - 1.0) * 100.0
        self.assertAlmostEqual(
            self.result["money_weighted_return_pct"], expected, delta=abs(expected) * 0.01
        )
        self.assertEqual(self.result["net_profit_loss"], 2_000.0)

    def test_account_drawdown_reflects_the_depletion(self):
        self.assertAlmostEqual(self.result["max_balance_drawdown_pct"], -100.0, places=6)
        self.assertEqual(audit_account(self.result, ["2020-01-02", "2020-02-03", "2020-03-02",
                                                     "2020-04-01", "2020-05-01"]), [])


class AuditTests(unittest.TestCase):
    def test_audit_accepts_every_scenario(self):
        for direction in ("inflow", "outflow"):
            for nav in (FLAT, RISING, FALLING):
                result = run(nav, direction=direction)
                self.assertEqual(audit_account(result, DATES), [])

    def test_audit_rejects_a_broken_balance(self):
        result = run(FLAT, enabled=False)
        result["balances"] = [10_000.0, 12_345.0, *result["balances"][2:]]
        problems = audit_account(result, DATES)
        self.assertTrue(any("balance" in problem for problem in problems), problems)

    def test_audit_rejects_a_broken_profit_identity(self):
        result = run(FLAT)
        result["net_profit_loss"] = 999.0
        problems = audit_account(result, DATES)
        self.assertTrue(any("net_profit_loss" in problem for problem in problems), problems)

    def test_every_scalar_is_finite(self):
        for direction in ("inflow", "outflow"):
            result = run(RISING, direction=direction)
            for key in (
                "final_value",
                "net_profit_loss",
                "time_weighted_return_pct",
                "money_weighted_return_pct",
                "max_balance_drawdown_pct",
            ):
                value = result[key]
                self.assertIsNotNone(value, key)
                self.assertTrue(math.isfinite(value), key)


if __name__ == "__main__":
    unittest.main()
