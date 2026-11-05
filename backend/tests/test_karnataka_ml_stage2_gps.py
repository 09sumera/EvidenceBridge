"""
Unit and Integration Tests for Stage 2: GPS-Based Nearby Hospital Recommendations.

Covers:
1. Haversine distance formula calculations and verification against known ground-truth distances.
2. Coordinate validation (latitude/longitude out of range, negative/positive bounds).
3. Search radius filtering (rejects/excludes hospitals beyond requested radius_km).
4. Distance sorting (strictly ascending order from user GPS location).
5. Missing or invalid hospital coordinates handling (safely skipped, no crashes).
6. District resolution (accurate determination of Karnataka district from lat/lon and aliases without guessing).
7. Non-Karnataka coordinates handling (identifies coordinates outside Karnataka, reports honest status).
8. Empty results handling (honest empty state when no hospitals exist within radius).
9. External service failure resilience (Render timeout / HTTP 500 triggers local OSM fallback).
10. OpenStreetMap / Overpass supplemental fallback (fills remaining quota when Karnataka ML records are fewer than limit).
11. Duplicate result deduplication (facilities with matching names or coordinate proximity are not duplicated).
12. Direct FastAPI route handlers testing:
    - POST /api/v1/hospital-ml/hospitals/nearby
    - GET /api/v1/hospital-ml/hospitals/nearby
"""

import inspect
import math
import time
from unittest.mock import AsyncMock, MagicMock, patch
import pydantic
import pytest

from app.api.routes import nearby_hospitals_endpoint, nearby_hospitals_get_endpoint
from app.models.schemas import (
    KarnatakaNearbyHospitalRecord,
    KarnatakaNearbyHospitalsRequest,
    KarnatakaNearbyHospitalsResponse,
)
from app.services.karnataka_ml import (
    KARNATAKA_DISTRICTS,
    haversine_distance,
    karnataka_ml_service,
)


def _run_coroutine_with_timeout(coro, timeout_seconds: float = 10.0):
    """
    Drive an async coroutine synchronously to completion without initializing
    Windows Proactor/Selector event loop socketpairs that hang in sandboxed environments.
    """
    start_time = time.time()
    stack = [coro]
    val = None
    exc = None
    while stack:
        if time.time() - start_time > timeout_seconds:
            raise TimeoutError(
                f"Coroutine exceeded {timeout_seconds}s timeout: {coro}"
            )
        curr = stack[-1]
        try:
            if exc is not None:
                sub = curr.throw(exc)
                exc = None
            else:
                sub = curr.send(val)
                val = None
            if inspect.iscoroutine(sub):
                stack.append(sub)
            else:
                val = sub
        except StopIteration as e:
            stack.pop()
            val = e.value
        except Exception as e:
            stack.pop()
            exc = e
            if not stack:
                raise
    return val


# ============================================================================
# 1. Haversine Distance Calculation Tests
# ============================================================================

def test_haversine_distance_zero_distance():
    """Verify zero distance when coordinates are identical."""
    km, miles = haversine_distance(12.9716, 77.5946, 12.9716, 77.5946)
    assert km == 0.0
    assert miles == 0.0


def test_haversine_distance_known_baseline():
    """
    Verify Haversine calculation against known ground-truth:
    Bengaluru (12.9716, 77.5946) to Mysuru (12.2958, 76.6394) is approximately 128 - 130 km straight-line.
    """
    km, miles = haversine_distance(12.9716, 77.5946, 12.2958, 76.6394)
    assert 125.0 <= km <= 135.0
    assert round(km * 0.621371, 2) == miles


def test_haversine_distance_short_distance():
    """
    Verify short distance inside Bengaluru:
    Cubbon Park (12.9763, 77.5929) to Victoria Hospital (12.9644, 77.5756) is ~2.3 km straight-line.
    """
    km, _ = haversine_distance(12.9763, 77.5929, 12.9644, 77.5756)
    assert 1.8 <= km <= 2.8


# ============================================================================
# 2. Coordinate & Radius Validation Tests
# ============================================================================

def test_coordinate_validation_out_of_bounds():
    """Verify out-of-range coordinates raise Pydantic ValidationError."""
    with pytest.raises(pydantic.ValidationError):
        KarnatakaNearbyHospitalsRequest(
            latitude=105.0,  # Invalid latitude (> 90)
            longitude=77.5,
            radius_km=25.0
        )

    with pytest.raises(pydantic.ValidationError):
        KarnatakaNearbyHospitalsRequest(
            latitude=12.97,
            longitude=205.0,  # Invalid longitude (> 180)
            radius_km=25.0
        )


def test_radius_validation_out_of_bounds():
    """Verify radius > 150 km or < 1 km raises validation error."""
    with pytest.raises(Exception):
        KarnatakaNearbyHospitalsRequest(latitude=12.97, longitude=77.59, radius_km=250.0)

    with pytest.raises(Exception):
        KarnatakaNearbyHospitalsRequest(latitude=12.97, longitude=77.59, radius_km=0.5)


# ============================================================================
# 3. District Resolution Tests
# ============================================================================

def test_district_resolution_from_coordinates():
    """Verify Bengaluru coordinates accurately resolve to Bengaluru Urban."""
    dist, in_kar = karnataka_ml_service.resolve_karnataka_district(12.9716, 77.5946)
    assert dist == "Bengaluru Urban"
    assert in_kar is True


def test_district_resolution_ballari():
    """Verify Ballari coordinates accurately resolve to Ballari."""
    dist, in_kar = karnataka_ml_service.resolve_karnataka_district(15.1394, 76.9214)
    assert dist == "Ballari"
    assert in_kar is True


def test_district_resolution_override_alias():
    """Verify common alias 'Bangalore' maps to 'Bengaluru Urban'."""
    dist, in_kar = karnataka_ml_service.resolve_karnataka_district(12.97, 77.59, override_district="Bangalore")
    assert dist == "Bengaluru Urban"
    assert in_kar is True


def test_district_resolution_outside_karnataka():
    """Verify coordinates outside Karnataka (e.g. Atlanta or Mumbai) return None / in_karnataka=False."""
    dist, in_kar = karnataka_ml_service.resolve_karnataka_district(33.7490, -84.3880)  # Atlanta, GA
    assert in_kar is False
    assert dist is None

    dist_mum, in_kar_mum = karnataka_ml_service.resolve_karnataka_district(19.0760, 72.8777)  # Mumbai
    assert in_kar_mum is False


# ============================================================================
# 4. Radius Filtering & Distance Sorting Tests
# ============================================================================

def test_find_nearby_hospitals_filtering_and_sorting():
    """
    Verify nearby hospitals are filtered by radius and sorted by ascending distance.
    Hospitals beyond radius_km must be excluded.
    """
    user_lat, user_lon = 12.9716, 77.5946

    # 3 mock candidates from Karnataka ML dataset:
    # 1. Very close (~1.5 km): Bowring Hospital (12.982, 77.604)
    # 2. Medium (~6 km): Jayadeva Hospital (12.918, 77.593)
    # 3. Far (~45 km): Hospital in Kolar/Ramanagara border (12.6, 77.3)
    mock_candidates = [
        {
            "Hospital_Name": "Far Distance Medical Center",
            "District": "Bengaluru Urban",
            "latitude": 12.55,
            "longitude": 77.25,  # ~59 km away
            "Specialties": "General Medicine",
            "evidence_completeness_percentage": 90.0,
            "completeness_category": "HIGH_COMPLETENESS"
        },
        {
            "Hospital_Name": "Jayadeva Institute of Cardiovascular Sciences",
            "District": "Bengaluru Urban",
            "latitude": 12.918,
            "longitude": 77.593,  # ~5.9 km away
            "Specialties": "Cardiology",
            "evidence_completeness_percentage": 93.33,
            "completeness_category": "HIGH_COMPLETENESS"
        },
        {
            "Hospital_Name": "Bowring & Lady Curzon Hospital",
            "District": "Bengaluru Urban",
            "latitude": 12.982,
            "longitude": 77.604,  # ~1.5 km away
            "Specialties": "General Surgery",
            "evidence_completeness_percentage": 86.67,
            "completeness_category": "HIGH_COMPLETENESS"
        },
    ]

    mock_rec_return = {
        "status": "success",
        "data": {"hospitals": mock_candidates, "count": 3}
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_rec:
        mock_rec.return_value = mock_rec_return

        # Search with 10 km radius: should include Bowring (~1.5km) and Jayadeva (~5.9km),
        # but EXCLUDE Far Distance Center (~59km)
        req = KarnatakaNearbyHospitalsRequest(
            latitude=user_lat,
            longitude=user_lon,
            radius_km=10.0,
            limit=5
        )
        res = _run_coroutine_with_timeout(karnataka_ml_service.find_nearby_hospitals(req))

    assert res.status == "success"
    assert res.radius_km == 10.0
    assert len(res.hospitals) == 2

    # Check ascending distance order
    assert res.hospitals[0].name == "Bowring & Lady Curzon Hospital"
    assert res.hospitals[1].name == "Jayadeva Institute of Cardiovascular Sciences"
    assert res.hospitals[0].distance_km < res.hospitals[1].distance_km
    assert res.hospitals[0].distance_status == "CALCULATED_HAVERSINE"
    assert "google.com/maps/dir" in res.hospitals[0].directions_url


# ============================================================================
# 5. Missing / Invalid Coordinates Handling
# ============================================================================

def test_missing_coordinates_handled_safely():
    """Verify records with missing or non-numeric coordinates are discarded without error."""
    mock_candidates = [
        {
            "Hospital_Name": "Hospital Without Lat",
            "District": "Bengaluru Urban",
            "latitude": None,
            "longitude": 77.59,
        },
        {
            "Hospital_Name": "Hospital With String Lat",
            "District": "Bengaluru Urban",
            "latitude": "InvalidCoord",
            "longitude": "InvalidCoord",
        },
        {
            "Hospital_Name": "Valid Hospital",
            "District": "Bengaluru Urban",
            "latitude": 12.972,
            "longitude": 77.595,
        }
    ]

    mock_rec_return = {
        "status": "success",
        "data": {"hospitals": mock_candidates, "count": 3}
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_rec:
        mock_rec.return_value = mock_rec_return

        req = KarnatakaNearbyHospitalsRequest(
            latitude=12.9716,
            longitude=77.5946,
            radius_km=10.0,
            limit=5
        )
        res = _run_coroutine_with_timeout(karnataka_ml_service.find_nearby_hospitals(req))

    assert res.status == "success"
    assert len(res.hospitals) == 1
    assert res.hospitals[0].name == "Valid Hospital"


# ============================================================================
# 6. Empty Results Handling
# ============================================================================

def test_empty_results_when_none_in_radius():
    """Verify clean response when no facilities exist in requested radius."""
    mock_rec_return = {
        "status": "success",
        "data": {"hospitals": [], "count": 0}
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_rec, \
         patch("app.services.hospital_finder.hospital_finder_service.fetch_osm_facilities", return_value=[]):
        mock_rec.return_value = mock_rec_return

        req = KarnatakaNearbyHospitalsRequest(
            latitude=12.9716,
            longitude=77.5946,
            radius_km=2.0,
            limit=5
        )
        res = _run_coroutine_with_timeout(karnataka_ml_service.find_nearby_hospitals(req))

    assert res.status == "no_hospitals_in_radius"
    assert res.count == 0
    assert len(res.hospitals) == 0
    assert "No hospitals found within 2.0 km" in res.warning


# ============================================================================
# 7. OpenStreetMap Fallback & Deduplication Tests
# ============================================================================

def test_osm_fallback_invoked_when_insufficient_results():
    """Verify OpenStreetMap is queried as supplemental fallback when Karnataka ML dataset returns few records."""
    mock_karnataka_candidates = [
        {
            "Hospital_Name": "Karnataka State District Hospital",
            "District": "Bengaluru Urban",
            "latitude": 12.972,
            "longitude": 77.595,
            "evidence_completeness_percentage": 85.0
        }
    ]

    mock_osm_facilities = [
        {
            "name": "St. Martha's Hospital",
            "lat": 12.973,
            "lon": 77.589,
            "facility_type": "General Hospital",
            "verified_services": ["Emergency", "Inpatient"]
        }
    ]

    mock_rec_return = {
        "status": "success",
        "data": {"hospitals": mock_karnataka_candidates, "count": 1}
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_rec, \
         patch("app.services.hospital_finder.hospital_finder_service.fetch_osm_facilities", return_value=mock_osm_facilities):
        mock_rec.return_value = mock_rec_return

        req = KarnatakaNearbyHospitalsRequest(
            latitude=12.9716,
            longitude=77.5946,
            radius_km=15.0,
            limit=5  # Wants 5, but Karnataka dataset only has 1
        )
        res = _run_coroutine_with_timeout(karnataka_ml_service.find_nearby_hospitals(req))

    assert res.status == "success"
    assert res.count == 2
    assert res.karnataka_dataset_count == 1
    assert res.osm_fallback_count == 1

    sources = [h.data_source for h in res.hospitals]
    assert any("Karnataka Hospital Directory" in s for s in sources)
    assert any("OpenStreetMap" in s for s in sources)


def test_osm_deduplication():
    """Verify an OSM facility matching an already-returned Karnataka hospital is NOT duplicated."""
    mock_karnataka_candidates = [
        {
            "Hospital_Name": "Victoria Hospital",
            "District": "Bengaluru Urban",
            "latitude": 12.9644,
            "longitude": 77.5756,
        }
    ]

    # OSM returns same Victoria Hospital
    mock_osm_facilities = [
        {
            "name": "Victoria Hospital",  # Same name
            "lat": 12.9645,
            "lon": 77.5757,
            "facility_type": "General Hospital"
        },
        {
            "name": "Vanivilas Women & Children Hospital",  # Different facility
            "lat": 12.9620,
            "lon": 77.5760,
            "facility_type": "Pediatric & Children's Specialty Hospital"
        }
    ]

    mock_rec_return = {
        "status": "success",
        "data": {"hospitals": mock_karnataka_candidates, "count": 1}
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_rec, \
         patch("app.services.hospital_finder.hospital_finder_service.fetch_osm_facilities", return_value=mock_osm_facilities):
        mock_rec.return_value = mock_rec_return

        req = KarnatakaNearbyHospitalsRequest(
            latitude=12.9644,
            longitude=77.5756,
            radius_km=5.0,
            limit=5
        )
        res = _run_coroutine_with_timeout(karnataka_ml_service.find_nearby_hospitals(req))

    # Should have 2 unique hospitals, NOT 3 (duplicate Victoria Hospital excluded)
    assert res.count == 2
    names = [h.name for h in res.hospitals]
    assert names.count("Victoria Hospital") == 1
    assert "Vanivilas Women & Children Hospital" in names


# ============================================================================
# 8. External Service Failure Resilience
# ============================================================================

def test_external_service_failure_falls_back_to_osm():
    """Verify that if Render ML service is offline (e.g. 504 timeout), OSM fallback still provides nearby hospitals."""
    mock_osm_facilities = [
        {
            "name": "District Civil Hospital Ballari",
            "lat": 15.145,
            "lon": 76.925,
            "facility_type": "General Hospital"
        }
    ]

    mock_rec_return = {
        "status": "external_service_unavailable",
        "error": "Upstream timeout 504"
    }

    with patch.object(karnataka_ml_service, "recommend_hospitals", new_callable=AsyncMock) as mock_rec, \
         patch("app.services.hospital_finder.hospital_finder_service.fetch_osm_facilities", return_value=mock_osm_facilities):
        mock_rec.return_value = mock_rec_return

        req = KarnatakaNearbyHospitalsRequest(
            latitude=15.1394,
            longitude=76.9214,
            radius_km=15.0,
            limit=5
        )
        res = _run_coroutine_with_timeout(karnataka_ml_service.find_nearby_hospitals(req))

    assert res.status == "success"
    assert res.count == 1
    assert res.hospitals[0].name == "District Civil Hospital Ballari"
    assert "OpenStreetMap" in res.hospitals[0].data_source
    assert res.osm_fallback_count == 1


# ============================================================================
# 9. FastAPI Route Endpoint Tests
# ============================================================================

def test_post_nearby_endpoint_route():
    """Verify POST /api/v1/hospital-ml/hospitals/nearby handler."""
    mock_response = KarnatakaNearbyHospitalsResponse(
        status="success",
        resolved_district="Bengaluru Urban",
        is_in_karnataka=True,
        user_coordinates={"lat": 12.9716, "lon": 77.5946},
        radius_km=10.0,
        count=1,
        hospitals=[
            KarnatakaNearbyHospitalRecord(
                id="kar_12345",
                name="Test Super Specialty Hospital",
                district="Bengaluru Urban",
                lat=12.975,
                lon=77.598,
                distance_km=0.52,
                distance_miles=0.32,
                distance_status="CALCULATED_HAVERSINE",
                data_source="Karnataka Hospital Directory (Validated ML Dataset)"
            )
        ]
    )

    with patch.object(karnataka_ml_service, "find_nearby_hospitals", new_callable=AsyncMock) as mock_find:
        mock_find.return_value = mock_response

        payload = KarnatakaNearbyHospitalsRequest(
            latitude=12.9716,
            longitude=77.5946,
            radius_km=10.0
        )
        res = _run_coroutine_with_timeout(nearby_hospitals_endpoint(payload))

    assert isinstance(res, KarnatakaNearbyHospitalsResponse)
    assert res.status == "success"
    assert res.hospitals[0].distance_km == 0.52


def test_get_nearby_endpoint_route():
    """Verify GET /api/v1/hospital-ml/hospitals/nearby query parameter endpoint handler."""
    mock_response = KarnatakaNearbyHospitalsResponse(
        status="success",
        resolved_district="Ballari",
        is_in_karnataka=True,
        user_coordinates={"lat": 15.1394, "lon": 76.9214},
        radius_km=25.0,
        count=1,
        hospitals=[
            KarnatakaNearbyHospitalRecord(
                id="kar_67890",
                name="Ballari District Hospital",
                district="Ballari",
                lat=15.14,
                lon=76.92,
                distance_km=0.15,
                distance_miles=0.09,
                distance_status="CALCULATED_HAVERSINE",
                data_source="Karnataka Hospital Directory (Validated ML Dataset)"
            )
        ]
    )

    with patch.object(karnataka_ml_service, "find_nearby_hospitals", new_callable=AsyncMock) as mock_find:
        mock_find.return_value = mock_response

        res = _run_coroutine_with_timeout(
            nearby_hospitals_get_endpoint(
                lat=15.1394,
                lon=76.9214,
                radius_km=25.0,
                specialty="General Medicine",
                district="Ballari",
                limit=5
            )
        )

    assert isinstance(res, KarnatakaNearbyHospitalsResponse)
    assert res.status == "success"
    assert res.resolved_district == "Ballari"
    assert res.hospitals[0].name == "Ballari District Hospital"
