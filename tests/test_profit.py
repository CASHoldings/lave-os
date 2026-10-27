"""Profitability panel: what one order earns at the current settings, and the weekly figures."""
from app.services import profit


def test_contribution_follows_the_cost_figures():
    a = profit.ASSUMPTIONS
    # £30 of items, member: 70% margin, card fee 1.5% + 20p, 75p packaging.
    assert profit.contribution(a, 3000) == 2100 - (45 + 20) - 75
    # Non-member with the £4.95 charge.
    assert profit.contribution(a, 3000, 0, 495) == 2100 + 495 - (52 + 20) - 75
    # A top-up to the minimum has no cleaning cost.
    assert profit.contribution(a, 600, 2400) == 420 + 2400 - (45 + 20) - 75


def test_panel_shows_levers_examples_and_weeks(api, staff_headers):
    r = api.get("/api/staff/profit", headers=staff_headers)
    assert r.status_code == 200
    p = r.json()
    assert p["levers"]["home_minimum_pence"] == 3000 and p["levers"]["dropoff_minimum_pence"] == 2000
    assert p["examples"][0] == {"label": "Smallest home order, member", "items_pence": 3000, "fee_pence": 0, "contribution_pence": 1960}
    assert len(p["weeks"]) == profit.WEEKS and p["weeks"][-1]["current"]
    assert [t["jobs"] for t in p["trip_costs"]] == [8, 12, 16, 26]
    r = api.put("/api/staff/profit/assumptions", headers=staff_headers, json={"margin_pct": 65, "route_day_pence": 12000})
    assert r.json()["assumptions"]["margin_pct"] == 65 and r.json()["trip_costs"][0]["per_job_pence"] == 1500 + 75


def test_minimums_are_set_in_collection_and_delivery(api, staff_headers):
    r = api.put("/api/staff/delivery-settings", headers=staff_headers, json={"home_minimum_pence": 2500, "dropoff_minimum_pence": 1500})
    assert r.json()["home_minimum_pence"] == 2500 and r.json()["dropoff_minimum_pence"] == 1500
    assert "Minimum order £25" in api.get("/atelier/prices/").text
