"""
External Karnataka ML API Integration Service.
Provides robust proxy integration with the deployed Karnataka ML models:
1. Treatment Package Cost Prediction (POST /api/cost/predict)
2. Hospital Directory Anomaly Detection (POST /api/anomaly/predict)
3. Hospital Directory Evidence Assessment (POST /api/evidence/assess)
4. Hospital Recommendations (POST /api/hospitals/recommend)

All calls are routed securely through this backend service to insulate the frontend
from CORS limitations and handle upstream cold starts, timeouts, and error scenarios.
"""

import math
import re
from typing import Any, Optional, Union
import httpx

from app.config import get_settings
from app.models.schemas import (
    GovernmentSchemeDetail,
    GovernmentSchemeHelpline,
    GovernmentSchemeOfficialLink,
    GovernmentSchemesCatalog,
    KarnatakaAnomalyPredictRequest,
    KarnatakaComparableBenchmark,
    KarnatakaCostComparisonCatalog,
    KarnatakaCostPredictRequest,
    KarnatakaEvidenceAssessRequest,
    KarnatakaHospitalRecommendRequest,
    KarnatakaMLResponseEnvelope,
    KarnatakaNearbyHospitalRecord,
    KarnatakaNearbyHospitalsRequest,
    KarnatakaNearbyHospitalsResponse,
    KarnatakaTreatmentPackageInfo,
    SchemeEligibilityEvaluationRequest,
    SchemeEligibilityEvaluationResponse,
)
from app.utils.logger import logger


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> tuple[float, float]:
    """
    Calculate great-circle straight-line distance between two geographic coordinates in km and miles.
    Strictly follows Haversine formula and accurately represents straight-line distance (NOT driving distance).
    """
    earth_radius_km = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    km = round(earth_radius_km * c, 2)
    miles = round(km * 0.621371, 2)
    return km, miles


# Representative centroid coordinates for Karnataka's 31 official revenue districts
KARNATAKA_DISTRICTS: dict[str, tuple[float, float]] = {
    "Bengaluru Urban": (12.9716, 77.5946),
    "Bengaluru Rural": (13.2300, 77.5500),
    "Ballari": (15.1394, 76.9214),
    "Belagavi": (15.8497, 74.4977),
    "Bagalkote": (16.1691, 75.6615),
    "Bidar": (17.9104, 77.5199),
    "Chamarajanagar": (11.9261, 76.9437),
    "Chikkaballapura": (13.4325, 77.7275),
    "Chikkamagaluru": (13.3161, 75.7720),
    "Chitradurga": (14.2251, 76.4019),
    "Dakshina Kannada": (12.8700, 74.8800),  # Mangaluru
    "Davangere": (14.4644, 75.9218),
    "Dharwad": (15.4589, 75.0078),
    "Gadag": (15.4167, 75.6167),
    "Hassan": (13.0072, 76.1029),
    "Haveri": (14.7958, 75.4022),
    "Kalaburagi": (17.3297, 76.8343),
    "Kodagu": (12.4244, 75.7382),  # Madikeri
    "Kolar": (13.1378, 78.1292),
    "Koppal": (15.3444, 76.1556),
    "Mandya": (12.5218, 76.8951),
    "Mysuru": (12.2958, 76.6394),
    "Raichur": (16.2120, 77.3439),
    "Ramanagara": (12.7209, 77.2799),
    "Shivamogga": (13.9299, 75.5681),
    "Tumakuru": (13.3392, 77.1015),
    "Udupi": (13.3409, 74.7421),
    "Uttara Kannada": (14.8135, 74.1297),  # Karwar
    "Vijayanagara": (15.2689, 76.3909),  # Hosapete
    "Vijayapura": (16.8302, 75.7100),
    "Yadgir": (16.7700, 77.1400),
}

DISTRICT_ALIASES: dict[str, str] = {
    "bangalore": "Bengaluru Urban",
    "bangalore urban": "Bengaluru Urban",
    "bengaluru": "Bengaluru Urban",
    "bengaluru urban": "Bengaluru Urban",
    "bangalore rural": "Bengaluru Rural",
    "bengaluru rural": "Bengaluru Rural",
    "bellary": "Ballari",
    "ballari": "Ballari",
    "belgaum": "Belagavi",
    "belagavi": "Belagavi",
    "bagalkot": "Bagalkote",
    "bagalkote": "Bagalkote",
    "gulbarga": "Kalaburagi",
    "kalaburagi": "Kalaburagi",
    "mysore": "Mysuru",
    "mysuru": "Mysuru",
    "mangalore": "Dakshina Kannada",
    "mangaluru": "Dakshina Kannada",
    "dakshina kannada": "Dakshina Kannada",
    "davanagere": "Davangere",
    "davangere": "Davangere",
    "hubli": "Dharwad",
    "hubballi": "Dharwad",
    "dharwad": "Dharwad",
    "hubli-dharwad": "Dharwad",
    "hubballi-dharwad": "Dharwad",
    "bijapur": "Vijayapura",
    "vijayapura": "Vijayapura",
    "shimoga": "Shivamogga",
    "shivamogga": "Shivamogga",
    "tumkur": "Tumakuru",
    "tumakuru": "Tumakuru",
    "chikmagalur": "Chikkamagaluru",
    "chikkamagaluru": "Chikkamagaluru",
    "coorg": "Kodagu",
    "madikeri": "Kodagu",
    "kodagu": "Kodagu",
    "karwar": "Uttara Kannada",
    "uttara kannada": "Uttara Kannada",
    "hospet": "Vijayanagara",
    "hosapete": "Vijayanagara",
    "vijayanagara": "Vijayanagara",
    "chikkaballapur": "Chikkaballapura",
    "chikkaballapura": "Chikkaballapura",
    "chamarajanagara": "Chamarajanagar",
    "chamarajanagar": "Chamarajanagar",
}


# ---------------------------------------------------------------------------
# Stage 3: Sakhii Hospital Published Treatment Packages & Price Benchmarks
# ---------------------------------------------------------------------------

SAKHII_ROOM_CATEGORIES: list[str] = ["Private", "Deluxe", "Suite"]

SAKHII_TREATMENT_PACKAGES: list[dict[str, Any]] = [
    {
        "package_name": "Normal Delivery",
        "category": "Obstetrics & Maternity",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 66400.0, "Deluxe": 74200.0, "Suite": 88000.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "LSCS",
        "category": "Obstetrics & Maternity (Cesarean Section)",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 91800.0, "Deluxe": 99500.0, "Suite": 116600.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "LSCS + Tubectomy",
        "category": "Obstetrics & Maternity (Cesarean + Sterilization)",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 106800.0, "Deluxe": 117500.0, "Suite": 136600.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "D & C",
        "category": "Gynecological Daycare Procedure",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 30600.0, "Deluxe": 37400.0, "Suite": 44400.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Hysteroscopic Polypectomy, D&C",
        "category": "Minimally Invasive Gynecological Surgery",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 50200.0, "Deluxe": 57300.0, "Suite": 61400.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Open Ruptured Ectopic Pregnancy",
        "category": "Gynecological Emergency Surgery",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 92900.0, "Deluxe": 117400.0, "Suite": 122600.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Laparoscopic Ectopic Pregnancy",
        "category": "Minimally Invasive Gynecological Surgery",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 113200.0, "Deluxe": 126300.0, "Suite": 145400.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Diagnostic",
        "category": "Diagnostic Laparoscopy & Assessment",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 77200.0, "Deluxe": 90500.0, "Suite": 104400.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Open Myomectomy",
        "category": "Gynecological Surgery (Fibroid Removal)",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 95400.0, "Deluxe": 119400.0, "Suite": 130800.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Laparoscopic Myomectomy",
        "category": "Minimally Invasive Gynecological Surgery",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 117200.0, "Deluxe": 127400.0, "Suite": 136600.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Open Ovarian Cystectomy",
        "category": "Gynecological Surgery (Cyst Excision)",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 103900.0, "Deluxe": 118200.0, "Suite": 124600.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Laparoscopic Ovarian Cystectomy Endometriosis",
        "category": "Minimally Invasive Gynecological Surgery",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 118400.0, "Deluxe": 130500.0, "Suite": 144200.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Vaginal Hysterectomy",
        "category": "Gynecological Surgery (Uterine Removal)",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 108400.0, "Deluxe": 126500.0, "Suite": 138200.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Pelvic Floor Repair (Vaginal Hysterectomy)",
        "category": "Gynecological Reconstructive Surgery",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 120400.0, "Deluxe": 134300.0, "Suite": 148600.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
    {
        "package_name": "Open Hysterectomy (BSO)",
        "category": "Gynecological Surgery (Total Hysterectomy + BSO)",
        "available_rooms": ["Private", "Deluxe", "Suite"],
        "hospital_name": "Sakhii Hospital",
        "district": "Bengaluru",
        "published_prices_inr": {"Private": 112000.0, "Deluxe": 130500.0, "Suite": 136200.0},
        "price_type": "Published hospital package tariff",
        "model_status": "Experimental",
        "karnataka_wide_prediction": False,
        "package_scope_verified": False,
        "scope_note": "Experimental RandomForestRegressor trained on Sakhii Hospital (Bengaluru) tariff data only. Scope pending audit validation.",
    },
]

COMPARABLE_BENCHMARKS_CATALOG: list[dict[str, Any]] = [
    {
        "id": "bench_mat_01",
        "service_or_procedure": "Normal Delivery & Postnatal Care (General Ward)",
        "category": "Maternity & Obstetrics",
        "hospital_or_source": "Vanivilas Women & Children Hospital (BMCRI), Bengaluru",
        "price_display": "₹20 OPD (Universal Free Inpatient under JSSK / AB-ArK)",
        "min_price_inr": 0.0,
        "max_price_inr": 20.0,
        "typical_price_inr": 20.0,
        "currency": "INR",
        "price_type": "Government Subsidized OPD Tariff",
        "data_source": "Government of Karnataka Health & Family Welfare Universal OPD Tariff & JSSK Scheme",
        "last_updated": "2026-01-01",
        "relevance_tag": "Normal Delivery",
    },
    {
        "id": "bench_mat_02",
        "service_or_procedure": "Cesarean Section (LSCS) Inpatient Care",
        "category": "Maternity & Obstetrics",
        "hospital_or_source": "Victoria Hospital & Vanivilas Hospital (BMCRI), Bengaluru",
        "price_display": "Subsidized (Covered under AB-ArK / JSSK)",
        "min_price_inr": 0.0,
        "max_price_inr": 500.0,
        "typical_price_inr": 20.0,
        "currency": "INR",
        "price_type": "Government Subsidized OPD Tariff",
        "data_source": "BMCRI Hospital Directory Tariff Schedule",
        "last_updated": "2026-01-01",
        "relevance_tag": "LSCS",
    },
    {
        "id": "bench_opd_01",
        "service_or_procedure": "General Outpatient Consultation & Vital Check",
        "category": "Outpatient Consultation Tariff",
        "hospital_or_source": "Victoria Hospital (BMCRI), Bengaluru",
        "price_display": "₹20 (Subsidized OPD)",
        "min_price_inr": 20.0,
        "max_price_inr": 20.0,
        "typical_price_inr": 20.0,
        "currency": "INR",
        "price_type": "Government Subsidized OPD Tariff",
        "data_source": "Government of Karnataka Health & Family Welfare Subsidized OPD Schedule",
        "last_updated": "2026-01-01",
        "relevance_tag": "OPD",
    },
    {
        "id": "bench_opd_02",
        "service_or_procedure": "Specialist OPD Consultation",
        "category": "Outpatient Consultation Tariff",
        "hospital_or_source": "Narayana Health (Mazumdar Shaw Medical Center), Bengaluru",
        "price_display": "₹450",
        "min_price_inr": 450.0,
        "max_price_inr": 450.0,
        "typical_price_inr": 450.0,
        "currency": "INR",
        "price_type": "Official Published Benchmark",
        "data_source": "Narayana Health Affordable Quality Care Published Tariff 2026",
        "last_updated": "2026-01-01",
        "relevance_tag": "OPD",
    },
    {
        "id": "bench_opd_03",
        "service_or_procedure": "Comprehensive Specialist Consultation",
        "category": "Outpatient Consultation Tariff",
        "hospital_or_source": "Manipal Hospital (HAL Airport Road), Bengaluru",
        "price_display": "₹850",
        "min_price_inr": 850.0,
        "max_price_inr": 850.0,
        "typical_price_inr": 850.0,
        "currency": "INR",
        "price_type": "Official Published Benchmark",
        "data_source": "Manipal Health Enterprises Published OPD Tariff Schedule 2026",
        "last_updated": "2026-01-10",
        "relevance_tag": "OPD",
    },
    {
        "id": "bench_diag_01",
        "service_or_procedure": "Complete Blood Count with Differential (CPT 85025)",
        "category": "Pathology & Blood Tests",
        "hospital_or_source": "CGHS & NABL National Diagnostic Schedule",
        "price_display": "₹150 – ₹450",
        "min_price_inr": 150.0,
        "max_price_inr": 450.0,
        "typical_price_inr": 250.0,
        "currency": "INR",
        "price_type": "Standard Diagnostic Benchmark",
        "data_source": "CGHS Diagnostic Rates & NABL National Benchmark 2026",
        "last_updated": "2026-02-01",
        "relevance_tag": "Diagnostic",
    },
    {
        "id": "bench_diag_02",
        "service_or_procedure": "Chest X-Ray 2 Views (CPT 71046)",
        "category": "Diagnostic Imaging",
        "hospital_or_source": "CGHS Radiology Schedule",
        "price_display": "₹250 – ₹600",
        "min_price_inr": 250.0,
        "max_price_inr": 600.0,
        "typical_price_inr": 350.0,
        "currency": "INR",
        "price_type": "Standard Diagnostic Benchmark",
        "data_source": "CGHS Radiology Schedule & State Health Insurance Tariff 2026",
        "last_updated": "2026-02-01",
        "relevance_tag": "Diagnostic",
    },
    {
        "id": "bench_diag_03",
        "service_or_procedure": "MRI Brain without contrast (CPT 70551)",
        "category": "Diagnostic Imaging",
        "hospital_or_source": "CGHS / PMJAY Diagnostic Tariff",
        "price_display": "₹3,500 – ₹8,500",
        "min_price_inr": 3500.0,
        "max_price_inr": 8500.0,
        "typical_price_inr": 5000.0,
        "currency": "INR",
        "price_type": "Standard Diagnostic Benchmark",
        "data_source": "CGHS / PMJAY Diagnostic Tariff 2026",
        "last_updated": "2026-02-01",
        "relevance_tag": "Diagnostic",
    },
    {
        "id": "bench_diag_04",
        "service_or_procedure": "MRI Brain without contrast (Private Tertiary)",
        "category": "Diagnostic Imaging",
        "hospital_or_source": "Manipal Hospital, Bengaluru",
        "price_display": "₹7,500 – ₹9,500",
        "min_price_inr": 7500.0,
        "max_price_inr": 9500.0,
        "typical_price_inr": 8500.0,
        "currency": "INR",
        "price_type": "Official Published Benchmark",
        "data_source": "Manipal Diagnostic Imaging Tariff List 2026",
        "last_updated": "2026-01-20",
        "relevance_tag": "Diagnostic",
    },
    {
        "id": "bench_med_01",
        "service_or_procedure": "0.9% Sodium Chloride (Normal Saline) 1,000 mL IV",
        "category": "Essential Inpatient Consumables",
        "hospital_or_source": "National Pharmaceutical Pricing Authority (NPPA)",
        "price_display": "₹35 – ₹105 (Ceiling ₹105.00 incl. 5% GST)",
        "min_price_inr": 35.0,
        "max_price_inr": 105.0,
        "typical_price_inr": 105.0,
        "currency": "INR",
        "price_type": "National Statutory Ceiling (NPPA)",
        "data_source": "NPPA DPCO National Ceiling Price Schedule (S.O. 1499(E) / S.O. 1290(E))",
        "last_updated": "2026-01-01",
        "relevance_tag": "Consumable",
    },
    {
        "id": "bench_med_02",
        "service_or_procedure": "Paracetamol 500mg Oral Tablet",
        "category": "Essential Inpatient Consumables",
        "hospital_or_source": "NPPA / Pradhan Mantri Jan Aushadhi",
        "price_display": "₹1.00 – ₹5.00 per tablet",
        "min_price_inr": 1.0,
        "max_price_inr": 5.0,
        "typical_price_inr": 2.0,
        "currency": "INR",
        "price_type": "National Statutory Ceiling (NPPA)",
        "data_source": "NPPA / Jan Aushadhi Generic Medicine Pricing Schedule 2026",
        "last_updated": "2026-01-01",
        "relevance_tag": "Drug",
    },
    {
        "id": "bench_emer_01",
        "service_or_procedure": "Emergency Department Visit Level 5 (CPT 99285)",
        "category": "Emergency Visit",
        "hospital_or_source": "Indian Medical Council & CGHS",
        "price_display": "₹500 – ₹2,500",
        "min_price_inr": 500.0,
        "max_price_inr": 2500.0,
        "typical_price_inr": 1200.0,
        "currency": "INR",
        "price_type": "Standard Diagnostic Benchmark",
        "data_source": "Indian Medical Council & CGHS Emergency Service Tariff 2026",
        "last_updated": "2026-02-01",
        "relevance_tag": "Emergency",
    },
]


class KarnatakaMLService:
    """
    Client service for communicating with the external Karnataka ML API.
    Handles network timeouts, Render cold starts, payload formatting,
    and structured error responses.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[float] = None
    ):
        settings = get_settings()
        self.base_url = (base_url or settings.KARNATAKA_ML_BASE_URL).rstrip("/")
        self.timeout_seconds = timeout_seconds or settings.KARNATAKA_ML_TIMEOUT_SECONDS

    async def _post_upstream(
        self,
        endpoint: str,
        payload: dict[str, Any],
        service_name: str
    ) -> dict[str, Any]:
        """
        Executes a POST request to the external Karnataka ML API with structured
        error handling and resilience for timeouts and cold starts.
        """
        target_url = f"{self.base_url}{endpoint}"
        logger.info(
            f"[KarnatakaML] Calling {service_name} at {target_url} (timeout: {self.timeout_seconds}s)"
        )

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    target_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

            # Try to decode JSON payload
            try:
                body = response.json()
            except Exception:
                logger.warning(
                    f"[KarnatakaML] Non-JSON response from {target_url} (status={response.status_code})"
                )
                return {
                    "status": "invalid_external_response",
                    "data": None,
                    "error": (
                        f"Upstream service returned invalid non-JSON response "
                        f"(HTTP {response.status_code}): {response.text[:200]}"
                    ),
                    "warning": None,
                    "upstream_status_code": response.status_code,
                    "service_name": service_name,
                }

            # Handle HTTP 200 OK
            if response.status_code == 200:
                is_success = body.get("success", True)
                if not is_success:
                    return {
                        "status": "validation_error",
                        "data": body.get("data"),
                        "error": body.get("error", "Upstream operation failed"),
                        "warning": body.get("warning"),
                        "upstream_status_code": 200,
                        "service_name": service_name,
                    }

                # Extract main data and warning/scope annotations
                raw_data = body.get("data")
                warning = body.get("warning") or body.get("assessment_scope")
                if not warning and isinstance(raw_data, dict):
                    warning = raw_data.get("warning")

                # If the endpoint is recommendation, body contains count, filters, data
                if endpoint.endswith("/recommend"):
                    formatted_data = {
                        "hospitals": raw_data if isinstance(raw_data, list) else [],
                        "count": body.get("count", len(raw_data) if isinstance(raw_data, list) else 0),
                        "filters": body.get("filters", {}),
                    }
                else:
                    formatted_data = raw_data

                return {
                    "status": "success",
                    "data": formatted_data,
                    "error": None,
                    "warning": warning,
                    "upstream_status_code": 200,
                    "service_name": service_name,
                }

            # Handle HTTP 4xx Client/Validation Error
            elif 400 <= response.status_code < 500:
                error_msg = body.get("error") if isinstance(body, dict) else f"HTTP {response.status_code}"
                if isinstance(body, dict) and "missing_features" in body:
                    error_msg = f"{error_msg}: missing {body['missing_features']}"
                elif isinstance(body, dict) and "missing_fields" in body:
                    error_msg = f"{error_msg}: missing {body['missing_fields']}"

                logger.warning(
                    f"[KarnatakaML] Validation error from {service_name}: {error_msg} (status={response.status_code})"
                )
                return {
                    "status": "validation_error",
                    "data": body.get("data") if isinstance(body, dict) else None,
                    "error": error_msg,
                    "warning": body.get("warning") if isinstance(body, dict) else None,
                    "upstream_status_code": response.status_code,
                    "service_name": service_name,
                }

            # Handle HTTP 5xx Server Error
            else:
                error_msg = body.get("error") if isinstance(body, dict) else f"Internal upstream server error (HTTP {response.status_code})"
                logger.error(
                    f"[KarnatakaML] Upstream server error from {service_name}: {error_msg} (status={response.status_code})"
                )
                return {
                    "status": "external_service_unavailable",
                    "data": None,
                    "error": f"Upstream Karnataka ML service error: {error_msg}",
                    "warning": "The external ML server encountered an internal failure.",
                    "upstream_status_code": response.status_code,
                    "service_name": service_name,
                }

        except httpx.TimeoutException as exc:
            logger.warning(
                f"[KarnatakaML] Request timeout calling {service_name} ({target_url}): {exc}"
            )
            return {
                "status": "external_service_unavailable",
                "data": None,
                "error": (
                    f"External Karnataka ML service timed out after {self.timeout_seconds}s. "
                    "The upstream Render host may be undergoing a cold start."
                ),
                "warning": "Service temporarily unreachable due to network latency or cold start.",
                "upstream_status_code": 504,
                "service_name": service_name,
            }

        except (httpx.ConnectError, httpx.NetworkError) as exc:
            logger.warning(
                f"[KarnatakaML] Network connection failure calling {service_name} ({target_url}): {exc}"
            )
            return {
                "status": "external_service_unavailable",
                "data": None,
                "error": f"Unable to establish connection to Karnataka ML service at {self.base_url}.",
                "warning": "External host is offline or unreachable.",
                "upstream_status_code": 503,
                "service_name": service_name,
            }

        except Exception as exc:
            logger.error(
                f"[KarnatakaML] Unexpected error communicating with {service_name}: {exc}"
            )
            return {
                "status": "external_service_unavailable",
                "data": None,
                "error": f"Unexpected error during external ML communication: {str(exc)}",
                "warning": None,
                "upstream_status_code": 500,
                "service_name": service_name,
            }

    async def predict_treatment_cost(
        self,
        payload: Union[KarnatakaCostPredictRequest, dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Call Treatment Package Cost Prediction model.
        Endpoint: POST /api/cost/predict
        """
        body = payload.model_dump() if isinstance(payload, KarnatakaCostPredictRequest) else payload
        result = await self._post_upstream(
            endpoint="/api/cost/predict",
            payload=body,
            service_name="Treatment Package Cost Prediction"
        )
        if result["status"] == "success" and not result.get("warning"):
            result["warning"] = "Experimental package price model trained on Sakhii Hospital (Bengaluru) data only."
        return result

    def get_cost_comparison_catalog(self) -> KarnatakaCostComparisonCatalog:
        """
        Return the catalog of supported treatment packages for Sakhii Hospital,
        available room categories ('Private', 'Deluxe', 'Suite'), and comparable
        EvidenceBridge pricing benchmarks from verified hospitals and statutory schedules.
        """
        packages = [
            KarnatakaTreatmentPackageInfo(**pkg)
            for pkg in SAKHII_TREATMENT_PACKAGES
        ]
        benchmarks = [
            KarnatakaComparableBenchmark(**b)
            for b in COMPARABLE_BENCHMARKS_CATALOG
        ]
        return KarnatakaCostComparisonCatalog(
            status="success",
            hospital_name="Sakhii Hospital",
            district="Bengaluru",
            model_algorithm="RandomForestRegressor",
            supported_packages=packages,
            available_room_categories=list(SAKHII_ROOM_CATEGORIES),
            comparable_benchmarks=benchmarks,
            disclaimer=(
                "Cost predictions are generated by an experimental RandomForestRegressor "
                "trained solely on Sakhii Hospital (Bengaluru) tariff data. They must NOT be attributed "
                "to or extrapolated to other medical facilities. Published benchmarks reflect official public "
                "filings and statutory price ceilings."
            )
        )


    async def predict_hospital_anomaly(
        self,
        payload: Union[KarnatakaAnomalyPredictRequest, dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Call Hospital Directory Anomaly Detection model (IsolationForest on 11 directory features).
        Endpoint: POST /api/anomaly/predict
        """
        body = payload.model_dump() if isinstance(payload, KarnatakaAnomalyPredictRequest) else payload
        return await self._post_upstream(
            endpoint="/api/anomaly/predict",
            payload=body,
            service_name="Hospital Anomaly Detection"
        )

    async def assess_hospital_evidence(
        self,
        payload: Union[KarnatakaEvidenceAssessRequest, dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Call Hospital Directory Evidence Completeness Assessment (15 directory features).
        Endpoint: POST /api/evidence/assess
        """
        body = payload.model_dump() if isinstance(payload, KarnatakaEvidenceAssessRequest) else payload
        return await self._post_upstream(
            endpoint="/api/evidence/assess",
            payload=body,
            service_name="Hospital Directory Evidence Assessment"
        )

    async def recommend_hospitals(
        self,
        payload: Union[KarnatakaHospitalRecommendRequest, dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Call Hospital Recommendation candidate selection.
        Endpoint: POST /api/hospitals/recommend

        Note: The external model operates on directory records and filters by
        district, specialty, limit, and require_coordinates. It does not calculate
        GPS distance or filter by coordinates radius.
        """
        body = payload.model_dump() if isinstance(payload, KarnatakaHospitalRecommendRequest) else payload
        # Ensure only supported parameters are transmitted to the external model
        sanitized_body = {
            "limit": body.get("limit", 10),
            "require_coordinates": bool(body.get("require_coordinates", False)),
        }
        if body.get("district") is not None:
            sanitized_body["district"] = body["district"]
        if body.get("specialty") is not None:
            sanitized_body["specialty"] = body["specialty"]

        return await self._post_upstream(
            endpoint="/api/hospitals/recommend",
            payload=sanitized_body,
            service_name="Hospital Recommendation"
        )

    def resolve_karnataka_district(
        self,
        lat: float,
        lon: float,
        override_district: Optional[str] = None
    ) -> tuple[Optional[str], bool]:
        """
        Determines the relevant Karnataka district using trusted coordinates and aliases.
        Returns:
            (resolved_district_name: Optional[str], is_in_karnataka: bool)
        """
        # 1. If override district provided, normalize and validate
        if override_district and override_district.strip():
            clean = override_district.strip().lower()
            if clean in DISTRICT_ALIASES:
                return DISTRICT_ALIASES[clean], True
            for alias_key, canonical in DISTRICT_ALIASES.items():
                if alias_key in clean or clean in alias_key:
                    return canonical, True
            for dist in KARNATAKA_DISTRICTS:
                if dist.lower() in clean or clean in dist.lower():
                    return dist, True

        # 2. Check Karnataka territory bounding box (lat ~ 11.4 - 18.6, lon ~ 74.0 - 78.8)
        is_in_kar_bbox = (11.4 <= lat <= 18.6) and (74.0 <= lon <= 78.8)
        if not is_in_kar_bbox:
            return None, False

        # 3. Find closest district centroid among Karnataka's 31 official revenue districts
        closest_district = None
        min_dist_km = float("inf")
        for dist_name, (d_lat, d_lon) in KARNATAKA_DISTRICTS.items():
            dist_km, _ = haversine_distance(lat, lon, d_lat, d_lon)
            if dist_km < min_dist_km:
                min_dist_km = dist_km
                closest_district = dist_name

        # If within 120 km of a Karnataka district centroid and inside bounding box
        if closest_district and min_dist_km <= 120.0:
            return closest_district, True

        return closest_district, is_in_kar_bbox

    async def find_nearby_hospitals(
        self,
        req: KarnatakaNearbyHospitalsRequest
    ) -> KarnatakaNearbyHospitalsResponse:
        """
        GPS-Based Nearby Hospital Recommendations (Stage 2).
        1. Validates coordinate ranges and radius.
        2. Resolves relevant Karnataka district without guessing.
        3. Calls external recommendation service via Stage 1 proxy (using only supported fields: district, specialty, limit=50, require_coordinates=True).
        4. Calculates straight-line Haversine distance for all returned candidates.
        5. Filters hospitals within requested radius_km and sorts by ascending distance.
        6. Falls back to OpenStreetMap / Overpass if insufficient results or upstream unavailable.
        7. Returns normalized results with source attribution and calculated distances.
        """
        # Coordinate bounds validation
        if not (-90.0 <= req.latitude <= 90.0 and -180.0 <= req.longitude <= 180.0):
            return KarnatakaNearbyHospitalsResponse(
                status="validation_error",
                resolved_district=None,
                is_in_karnataka=False,
                user_coordinates={"lat": req.latitude, "lon": req.longitude},
                radius_km=req.radius_km,
                count=0,
                hospitals=[],
                warning="Latitude must be between -90 and 90, Longitude between -180 and 180."
            )

        if not (1.0 <= req.radius_km <= 150.0):
            return KarnatakaNearbyHospitalsResponse(
                status="validation_error",
                resolved_district=None,
                is_in_karnataka=False,
                user_coordinates={"lat": req.latitude, "lon": req.longitude},
                radius_km=req.radius_km,
                count=0,
                hospitals=[],
                warning="Search radius must be between 1.0 km and 150.0 km."
            )

        resolved_district, is_in_karnataka = self.resolve_karnataka_district(
            req.latitude, req.longitude, req.district
        )

        matched_hospitals: list[KarnatakaNearbyHospitalRecord] = []
        karnataka_count = 0
        osm_count = 0
        warning_notes: list[str] = []

        # If resolved district exists, query the external recommendation service via Stage 1 client
        if resolved_district:
            try:
                rec_result = await self.recommend_hospitals({
                    "district": resolved_district,
                    "specialty": req.specialty,
                    "limit": 50,
                    "require_coordinates": True
                })

                if rec_result.get("status") == "success":
                    candidates = rec_result.get("data", {}).get("hospitals", [])
                    for cand in candidates:
                        lat_val = cand.get("latitude")
                        lon_val = cand.get("longitude")
                        if lat_val is None or lon_val is None:
                            continue

                        try:
                            h_lat = float(lat_val)
                            h_lon = float(lon_val)
                        except (ValueError, TypeError):
                            continue

                        # Check if coordinate is physically valid
                        if not (-90.0 <= h_lat <= 90.0 and -180.0 <= h_lon <= 180.0):
                            continue

                        # Calculate straight-line Haversine distance
                        dist_km, dist_mi = haversine_distance(
                            req.latitude, req.longitude, h_lat, h_lon
                        )

                        # Filter by requested travel radius
                        if dist_km <= req.radius_km:
                            h_name = cand.get("Hospital_Name") or "Hospital"
                            h_id = f"kar_{abs(hash(h_name) % 1000000)}"

                            # Extract and clean specialties
                            raw_specs = cand.get("Specialties")
                            specs_list = []
                            if raw_specs and str(raw_specs).lower() not in ("nan", "none", "null", ""):
                                specs_list = [s.strip() for s in str(raw_specs).split(",") if s.strip()]

                            # Extract and clean facilities
                            raw_facs = cand.get("Facilities")
                            facs_list = []
                            if raw_facs and str(raw_facs).lower() not in ("nan", "none", "null", ""):
                                facs_list = [f.strip() for f in str(raw_facs).split(",") if f.strip()]

                            pincode = str(cand.get("Pincode")) if cand.get("Pincode") and str(cand.get("Pincode")).lower() not in ("nan", "none", "null", "") else None
                            phone = str(cand.get("Telephone")) if cand.get("Telephone") and str(cand.get("Telephone")).lower() not in ("nan", "none", "null", "0", "0.0") else None
                            mobile = str(cand.get("Mobile_Number")) if cand.get("Mobile_Number") and str(cand.get("Mobile_Number")).lower() not in ("nan", "none", "null", "0", "0.0") else None
                            email = str(cand.get("Hospital_Primary_Email_Id")) if cand.get("Hospital_Primary_Email_Id") and str(cand.get("Hospital_Primary_Email_Id")).lower() not in ("nan", "none", "null") else None
                            website = str(cand.get("Website")) if cand.get("Website") and str(cand.get("Website")).lower() not in ("nan", "none", "null") else None
                            emergency = str(cand.get("Emergency_Services")) if cand.get("Emergency_Services") and str(cand.get("Emergency_Services")).lower() not in ("nan", "none", "null") else None
                            est_year = str(cand.get("Establised_Year")) if cand.get("Establised_Year") and str(cand.get("Establised_Year")).lower() not in ("nan", "none", "null", "0") else None

                            record = KarnatakaNearbyHospitalRecord(
                                id=h_id,
                                name=h_name,
                                district=cand.get("District") or resolved_district,
                                lat=h_lat,
                                lon=h_lon,
                                distance_km=dist_km,
                                distance_miles=dist_mi,
                                distance_status="CALCULATED_HAVERSINE",
                                data_source="Karnataka Hospital Directory (Validated ML Dataset)",
                                address=cand.get("Location_Coordinates") or cand.get("District"),
                                pincode=pincode,
                                category=cand.get("Hospital_Category"),
                                care_type=cand.get("Hospital_Care_Type"),
                                specialties=specs_list,
                                facilities=facs_list,
                                phone=phone,
                                mobile=mobile,
                                email=email,
                                website=website,
                                emergency_services=emergency,
                                established_year=est_year,
                                evidence_completeness_percentage=cand.get("evidence_completeness_percentage"),
                                completeness_category=cand.get("completeness_category"),
                                directions_url=f"https://www.google.com/maps/dir/?api=1&destination={h_lat},{h_lon}",
                                source_warning="Candidate from validated Karnataka hospital directory dataset."
                            )
                            matched_hospitals.append(record)
                    karnataka_count = len(matched_hospitals)
                else:
                    warning_notes.append(
                        f"External Karnataka ML service returned: {rec_result.get('error', 'unavailable')}. Using local OpenStreetMap directory fallback."
                    )
            except Exception as e:
                logger.warning(f"[KarnatakaML] External recommendation failed: {e}")
                warning_notes.append(f"External service connection notice: {e}")
        else:
            if not is_in_karnataka:
                warning_notes.append(
                    "Search coordinates are outside Karnataka. The Karnataka ML Directory contains Karnataka facilities only. Showing OpenStreetMap nearby medical facilities."
                )

        # Sort Karnataka matches by distance ascending
        matched_hospitals.sort(key=lambda h: h.distance_km)

        # Fallback to OpenStreetMap / Overpass if insufficient results
        if len(matched_hospitals) < req.limit:
            try:
                from app.services.hospital_finder import hospital_finder_service

                osm_facilities = hospital_finder_service.fetch_osm_facilities(
                    search_lat=req.latitude,
                    search_lon=req.longitude,
                    max_dist_km=req.radius_km,
                    city_query=resolved_district or "",
                    country_code="IN" if is_in_karnataka else "OTHER"
                )

                existing_names = {h.name.lower().strip() for h in matched_hospitals}

                for fac in osm_facilities:
                    f_lat = fac.get("lat")
                    f_lon = fac.get("lon")
                    if f_lat is None or f_lon is None:
                        continue

                    f_name = (fac.get("name") or fac.get("tags", {}).get("name") or "Medical Facility").strip()
                    f_name_lower = f_name.lower()

                    # Deduplication check: name or exact coordinate proximity (<= 100 meters)
                    if f_name_lower in existing_names:
                        continue
                    if any(abs(h.lat - f_lat) < 0.001 and abs(h.lon - f_lon) < 0.001 for h in matched_hospitals):
                        continue

                    d_km, d_mi = haversine_distance(req.latitude, req.longitude, f_lat, f_lon)
                    if d_km <= req.radius_km:
                        existing_names.add(f_name_lower)
                        osm_rec = KarnatakaNearbyHospitalRecord(
                            id=f"osm_{abs(hash(f_name) % 1000000)}",
                            name=f_name,
                            district=resolved_district or "Local Area",
                            lat=f_lat,
                            lon=f_lon,
                            distance_km=d_km,
                            distance_miles=d_mi,
                            distance_status="CALCULATED_HAVERSINE",
                            data_source="OpenStreetMap / Overpass API (Supplemental Fallback)",
                            care_type=fac.get("facility_type") or "General Medical Facility",
                            specialties=fac.get("verified_services", []),
                            directions_url=f"https://www.google.com/maps/dir/?api=1&destination={f_lat},{f_lon}",
                            source_warning="OpenStreetMap crowdsourced cartography; not registered in Karnataka state dataset."
                        )
                        matched_hospitals.append(osm_rec)
                        osm_count += 1
                        if len(matched_hospitals) >= req.limit:
                            break

            except Exception as e:
                logger.debug(f"[KarnatakaML] OSM fallback exception: {e}")

        # Final sort by distance ascending
        matched_hospitals.sort(key=lambda h: h.distance_km)
        final_list = matched_hospitals[: req.limit]

        final_warning = " ".join(warning_notes) if warning_notes else None
        if not final_list:
            final_warning = (
                final_warning or
                f"No hospitals found within {req.radius_km} km of coordinates ({req.latitude:.4f}, {req.longitude:.4f}). Try expanding search radius up to 75-100 km."
            )

        return KarnatakaNearbyHospitalsResponse(
            status="success" if final_list else "no_hospitals_in_radius",
            resolved_district=resolved_district,
            is_in_karnataka=is_in_karnataka,
            user_coordinates={"lat": req.latitude, "lon": req.longitude},
            radius_km=req.radius_km,
            count=len(final_list),
            hospitals=final_list,
            karnataka_dataset_count=karnataka_count,
            osm_fallback_count=osm_count,
            warning=final_warning
        )


    def get_government_schemes_catalog(self) -> GovernmentSchemesCatalog:
        """
        Retrieves verified catalog of government healthcare assistance schemes in Karnataka.
        Includes PM-JAY, Ayushman Bharat — Arogya Karnataka (AB-ArK), and Karnataka CMRF.
        Official sources:
        - https://pmjay.gov.in/
        - https://beneficiary.nha.gov.in/
        - https://hospitals.pmjay.gov.in/
        - https://sast.karnataka.gov.in/
        - https://arogya.karnataka.gov.in/
        - https://cmrf.karnataka.gov.in/
        - https://sevasindhuservices.karnataka.gov.in/
        """
        helpline_pmjay_primary = GovernmentSchemeHelpline(
            name="NHA PM-JAY National Call Centre",
            number="14555",
            description="24x7 Multilingual National Toll-Free Helpline",
            tel_uri="tel:14555"
        )
        helpline_pmjay_alt = GovernmentSchemeHelpline(
            name="PM-JAY Alternate Toll-Free",
            number="1800-111-565",
            description="National Citizen Assistance & Grievance Line",
            tel_uri="tel:1800111565"
        )
        helpline_sast = GovernmentSchemeHelpline(
            name="Suvarna Arogya Suraksha Trust (SAST)",
            number="1800-425-8330",
            description="Karnataka State Arogya Karnataka Toll-Free Helpdesk",
            tel_uri="tel:18004258330"
        )
        helpline_health_104 = GovernmentSchemeHelpline(
            name="Karnataka State Health Helpline",
            number="104",
            description="24x7 Medical Advice, Grievances, and Scheme Information",
            tel_uri="tel:104"
        )
        helpline_sevasindhu = GovernmentSchemeHelpline(
            name="Seva Sindhu Citizen Services",
            number="080-22230282",
            description="Karnataka Online Services & CMRF Application Support",
            tel_uri="tel:08022230282"
        )
        helpline_cmrf = GovernmentSchemeHelpline(
            name="CMRF Secretariat Cell (Vidhana Soudha)",
            number="080-22033528",
            description="Chief Minister's Medical Relief Processing Desk",
            tel_uri="tel:08022033528"
        )
        helpline_emergency = GovernmentSchemeHelpline(
            name="National Emergency Unified Response",
            number="112",
            description="Ambulance, Police & Fire Emergency Services",
            tel_uri="tel:112"
        )

        pmjay = GovernmentSchemeDetail(
            scheme_id="pmjay",
            name="Ayushman Bharat — Pradhan Mantri Jan Arogya Yojana (AB-PMJAY)",
            short_name="PM-JAY",
            administering_body="National Health Authority (NHA), Ministry of Health and Family Welfare, Government of India",
            official_portal_url="https://pmjay.gov.in/",
            beneficiary_portal_url="https://beneficiary.nha.gov.in/",
            hospital_search_portal_url="https://hospitals.pmjay.gov.in/",
            helplines=[helpline_pmjay_primary, helpline_pmjay_alt],
            coverage_ceiling_inr=500000.0,
            coverage_display="₹5,00,000 / family / year (Floater)",
            coverage_description="Cashless and paperless inpatient secondary and tertiary hospital care at public and empanelled private hospitals nationwide (National Portability).",
            nature_of_scheme="Statutory National Health Protection Entitlement",
            bpl_benefit="100% cashless hospitalization up to ₹5,00,000 per year for households meeting SECC 2011 deprivation criteria or Priority Household (PHH/AAY) lists.",
            apl_benefit="Not directly covered under central PM-JAY independently unless covered under state integrated scheme (Arogya Karnataka) or qualifying under the Senior Citizen (70+) expansion.",
            referral_required_for_private=False,
            emergency_referral_exempt=True,
            mandatory_documents=[
                "Aadhaar Card (Patient and Household Head)",
                "Ration Card (PHH / AAY) or PM-JAY Family ID",
                "Active Mobile Number for OTP / Biometric e-KYC"
            ],
            conditional_documents=[
                "Ayushman Bharat Card printout (if already generated at beneficiary.nha.gov.in)",
                "Age verification document showing age 70+ for Ayushman Vay Vandana Card (Universal ₹5 Lakh Cover)"
            ],
            exclusions=[
                "Outpatient (OPD) doctor consultations and standalone retail pharmacy bills",
                "Elective cosmetic surgery and non-essential aesthetic procedures",
                "Organ harvesting from donors without prior NHA package pre-authorization",
                "Non-empanelled private hospital admissions"
            ],
            limitations_and_disclaimers=[
                "Tertiary surgical interventions require mandatory pre-authorization approved by State Health Agency.",
                "Senior Citizen (70+) coverage applies as a distinct ₹5 Lakh top-up pool under the Ayushman Vay Vandana Card regardless of income."
            ],
            official_links=[
                GovernmentSchemeOfficialLink(
                    title="PM-JAY Official Portal",
                    url="https://pmjay.gov.in/",
                    purpose="National scheme guidelines and announcements"
                ),
                GovernmentSchemeOfficialLink(
                    title="Beneficiary Portal (Check Eligibility & Ayushman Card)",
                    url="https://beneficiary.nha.gov.in/",
                    purpose="Verify eligibility and generate Ayushman Card via Aadhaar OTP"
                ),
                GovernmentSchemeOfficialLink(
                    title="Empanelled Hospital Directory",
                    url="https://hospitals.pmjay.gov.in/",
                    purpose="Official list of verified network hospitals and active specialties"
                )
            ],
            is_discretionary=False,
            status="active"
        )

        ab_ark = GovernmentSchemeDetail(
            scheme_id="ab_ark",
            name="Ayushman Bharat — Arogya Karnataka (AB-ArK)",
            short_name="Arogya Karnataka",
            administering_body="Suvarna Arogya Suraksha Trust (SAST), Department of Health & Family Welfare, Government of Karnataka",
            official_portal_url="https://sast.karnataka.gov.in/",
            beneficiary_portal_url="https://arogya.karnataka.gov.in/",
            hospital_search_portal_url="https://sast.karnataka.gov.in/",
            helplines=[helpline_sast, helpline_health_104],
            coverage_ceiling_inr=500000.0,
            coverage_display="₹5,00,000 / year (BPL) | ₹1,50,000 / year (APL 30% Co-Pay)",
            coverage_description="Integrated state-central health scheme providing 100% cashless treatment for BPL and 30% financial assistance for APL, with defined public-to-private referral rules.",
            nature_of_scheme="Integrated State Health Protection & Co-Payment Scheme",
            bpl_benefit="Eligible Category (BPL / NFSA PHH & AAY cardholders): 100% cashless treatment up to ₹5,00,000 per family per year on a family floater basis.",
            apl_benefit="General Category (APL / Non-BPL Karnataka residents): 30% financial assistance from the state (capped at ₹1,50,000 per family per year); patient pays 70% co-payment.",
            referral_required_for_private=True,
            emergency_referral_exempt=True,
            mandatory_documents=[
                "Aadhaar Card (Patient and Household Head)",
                "Karnataka Ration Card (BPL/PHH/AAY or APL/NPHH)",
                "Government Hospital Online Referral Slip (ORS) (Mandatory for private planned care; exempt for emergencies)"
            ],
            conditional_documents=[
                "Arogya Karnataka / Ayushman Card (issued at public hospital or Karnataka One / Bangalore One)",
                "Treating Doctor Clinical Summary & Diagnostic Reports"
            ],
            exclusions=[
                "Direct walk-in to private empanelled hospitals for elective/planned procedures without a prior government referral",
                "Simple secondary procedures in private hospitals (reserved for Government Public Health Institutions)",
                "Cosmetic procedures, fertility treatments, and unverified alternative therapies"
            ],
            limitations_and_disclaimers=[
                "Emergency Exception: 171 defined acute emergency procedures (e.g. poly-trauma, heart attack, acute stroke) do NOT require an advance referral.",
                "Planned Private Care Rule: For planned complex secondary or tertiary care, you MUST first obtain a referral from a public hospital (PHC, CHC, Taluk, or District Hospital). Unreferred planned care is billed privately."
            ],
            official_links=[
                GovernmentSchemeOfficialLink(
                    title="Suvarna Arogya Suraksha Trust (SAST)",
                    url="https://sast.karnataka.gov.in/",
                    purpose="Official Karnataka scheme portal, guidelines, and hospital search"
                ),
                GovernmentSchemeOfficialLink(
                    title="Department of Health & Family Welfare Karnataka",
                    url="https://arogya.karnataka.gov.in/",
                    purpose="State health department announcements and beneficiary guidelines"
                )
            ],
            is_discretionary=False,
            status="active"
        )

        cmrf = GovernmentSchemeDetail(
            scheme_id="cmrf",
            name="Karnataka Chief Minister's Relief Fund (CMRF — Medical Relief)",
            short_name="Karnataka CMRF",
            administering_body="Chief Minister's Secretariat / Relief Fund Section, Vidhana Soudha, Government of Karnataka",
            official_portal_url="https://cmrf.karnataka.gov.in/",
            beneficiary_portal_url="https://sevasindhuservices.karnataka.gov.in/",
            hospital_search_portal_url="https://cmrf.karnataka.gov.in/",
            helplines=[helpline_sevasindhu, helpline_cmrf],
            coverage_ceiling_inr=150000.0,
            coverage_display="Discretionary Grant (Typically ₹25,000 to ₹1,50,000)",
            coverage_description="Discretionary financial relief sanctioned directly by the Chief Minister's Office for catastrophic illnesses (cancer, heart surgery, neurosurgery, organ failure) paid directly to the treating hospital.",
            nature_of_scheme="Discretionary Ex-Gratia Financial Relief (Not Guaranteed)",
            bpl_benefit="Priority consideration for indigent and BPL families whose catastrophic medical expenses exceed family means or exhaust insurance limits.",
            apl_benefit="May be considered if the family suffers catastrophic financial hardship and presents a Tahsildar-certified low income certificate, subject to CMO scrutiny.",
            referral_required_for_private=False,
            emergency_referral_exempt=True,
            mandatory_documents=[
                "Formal Application Form addressed to the Hon'ble Chief Minister of Karnataka",
                "Recommendation Letter from Sitting Local MLA, MLC, or MP",
                "Original Medical Cost Estimate Certificate signed by Treating Specialist and Medical Superintendent with Hospital Seal",
                "BPL Ration Card or Tahsildar Income Certificate (proving annual income <₹1,00,000)",
                "Aadhaar Card and Voter ID of Patient and Applicant",
                "Treating Hospital Bank Mandate (Cancelled Cheque / Bank Letter with IFSC and Account Number for direct RTGS disbursement)"
            ],
            conditional_documents=[
                "Discharge Summary and Final Bills (if applying for post-treatment reimbursement consideration)",
                "Relevant Diagnostic Pathology / Radiology Reports (e.g. Biopsy, Angiogram, MRI)"
            ],
            exclusions=[
                "Beneficiaries enrolled in employer medical reimbursement schemes (CGHS, ESI, Armed Forces ECHS)",
                "Elective cosmetic surgeries, minor illnesses, or unapproved hospital facilities",
                "Direct cash payment to the patient (funds are legally disbursed ONLY to the treating hospital account)"
            ],
            limitations_and_disclaimers=[
                "DISCRETIONARY ASSISTANCE NOTICE: The Chief Minister's Relief Fund is an ex-gratia grant, NOT an entitlement or insurance scheme. Sanction is subject to the Chief Minister's discretion, fund availability, and administrative scrutiny. Financial assistance is never guaranteed.",
                "Processing Turnaround: Administrative review and file movement typically take 3 to 8 weeks; urgent cases can be expedited via the CMO or Seva Sindhu helpdesk."
            ],
            official_links=[
                GovernmentSchemeOfficialLink(
                    title="Karnataka CMRF Official Portal",
                    url="https://cmrf.karnataka.gov.in/",
                    purpose="Guidelines, application status tracking, and orders"
                ),
                GovernmentSchemeOfficialLink(
                    title="Seva Sindhu Online Medical Relief Service",
                    url="https://sevasindhuservices.karnataka.gov.in/",
                    purpose="Digital submission under Major Ailments Assistance Application Service"
                )
            ],
            is_discretionary=True,
            status="active"
        )

        return GovernmentSchemesCatalog(
            status="success",
            schemes=[pmjay, ab_ark, cmrf],
            emergency_helplines=[
                helpline_pmjay_primary,
                helpline_sast,
                helpline_health_104,
                helpline_sevasindhu,
                helpline_emergency
            ],
            disclaimer=(
                "Official scheme policies, coverage schedules, and empanelment rosters are determined solely by government authorities. "
                "EvidenceBridge provides informational guidance and does not authorize or determine scheme approvals. "
                "Final eligibility decisions rest solely with the National Health Authority (NHA), Suvarna Arogya Suraksha Trust (SAST), "
                "or the Chief Minister's Relief Fund committee."
            ),
            last_verified="2026-11-04"
        )

    def evaluate_scheme_eligibility(
        self, req: SchemeEligibilityEvaluationRequest
    ) -> SchemeEligibilityEvaluationResponse:
        """
        Evaluates potential government healthcare scheme pathways using verified deterministic rules.
        Does NOT collect or store PII. Does NOT approve claims or guarantee coverage.
        Provides transparent rule-based guidance and actionable steps.
        """
        is_emergency = req.care_type == "EMERGENCY"
        is_karnataka = req.is_karnataka_resident
        ration = req.ration_card_type
        age = req.patient_age
        cost = req.estimated_cost_inr

        # Senior citizen expansion (Age 70+)
        is_senior_70_plus = age is not None and age >= 70

        # Base document lists
        mandatory_docs: list[str] = ["Aadhaar Card (Patient and Family Head)"]
        conditional_docs: list[str] = [
            "Ayushman Bharat / Arogya Karnataka ID Card (if already generated)",
            "Treating Doctor Prescription and Diagnostic Reports"
        ]

        actionable_steps: list[str] = []
        eligible_schemes: list[str] = []
        primary_id: Optional[str] = None
        primary_name: Optional[str] = None
        coverage_summary: str = ""
        copay_status: str = ""
        referral_required: bool = False
        referral_guidance: str = ""
        emergency_exemption: bool = is_emergency
        cmrf_applicable: bool = False
        cmrf_note: Optional[str] = None

        # 1. Referral guidance based on care urgency
        if is_emergency:
            referral_required = False
            emergency_exemption = True
            referral_guidance = (
                "Emergency Health Care Exemption: For defined acute emergencies (e.g., polytrauma, acute heart attack, "
                "acute ischemic stroke, respiratory distress), direct admission to any empanelled public or private hospital "
                "is permitted WITHOUT an advance government referral."
            )
            actionable_steps.append(
                "1. Seek immediate emergency admission at the nearest hospital emergency department. Referral is waived for acute emergencies."
            )
            actionable_steps.append(
                "2. Present patient Aadhaar and Ration Card at the hospital Ayushman / Arogya Mitra desk within 24 hours of admission."
            )
        else:
            referral_required = True
            emergency_exemption = False
            referral_guidance = (
                "Online Referral System (ORS) Rule: For planned complex secondary and tertiary procedures at private empanelled hospitals, "
                "an advance referral slip from a Government Public Health Institution (Taluk or District Hospital) is strictly mandatory. "
                "Direct walk-ins to private hospitals for planned care are billed at regular private hospital charges."
            )
            actionable_steps.append(
                "1. For planned/elective care, visit a Government Public Health Institution (PHC, CHC, Taluk, or District Hospital) first to obtain an Online Referral Slip (ORS)."
            )
            actionable_steps.append(
                "2. Confirm that the private hospital is actively empanelled for your specific specialty at hospitals.pmjay.gov.in or sast.karnataka.gov.in."
            )
            actionable_steps.append(
                "3. Present Aadhaar Card, Ration Card, and the Government Referral Slip at the empanelled hospital's Arogya Mitra desk prior to admission."
            )

        # 2. Scheme matching by residency and ration card
        if not is_karnataka:
            primary_id = "pmjay"
            primary_name = "Ayushman Bharat — PM-JAY (National Portability)"
            eligible_schemes = ["pmjay"]
            copay_status = "100% Cashless Coverage (up to ₹5,00,000/yr for eligible SECC/NFSA beneficiaries)"
            coverage_summary = (
                "Ayushman Bharat PM-JAY National Portability pathway. Non-Karnataka residents enrolled under PM-JAY in their home state "
                "can access cashless inpatient care at PM-JAY empanelled hospitals across Karnataka. "
                "State-specific Arogya Karnataka (AB-ArK) co-payment subsidies are reserved for Karnataka permanent residents."
            )
            mandatory_docs.append("Home State Ration Card or PM-JAY Beneficiary ID")
        else:
            # Karnataka Resident
            cmrf_applicable = True
            cmrf_note = (
                "Karnataka Chief Minister's Relief Fund (CMRF) is available as discretionary ex-gratia financial relief "
                "(typically ₹25,000 to ₹1,50,000) disbursed directly to the treating hospital for catastrophic illnesses. "
                "Financial assistance is discretionary and subject to CMO review, not guaranteed."
            )

            if ration == "BPL_PHH_AAY":
                primary_id = "ab_ark"
                primary_name = "Ayushman Bharat — Arogya Karnataka (Eligible / BPL Category)"
                eligible_schemes = ["ab_ark", "pmjay"]
                copay_status = "100% Cashless Coverage (₹0 Patient Co-Payment for approved package rates up to ₹5,00,000/yr)"
                coverage_summary = (
                    "Eligible Category (BPL / NFSA PHH & AAY Cardholders): 100% cashless hospitalization up to ₹5,00,000 per family per year "
                    "on a family floater basis across all empanelled network hospitals under integrated AB-ArK / PM-JAY."
                )
                mandatory_docs.append("Valid Karnataka BPL Ration Card (PHH / AAY)")
                if not is_emergency:
                    mandatory_docs.append("Government Public Health Institution Online Referral Slip (ORS)")

            elif ration == "APL_NPHH":
                primary_id = "ab_ark"
                primary_name = "Ayushman Bharat — Arogya Karnataka (General / APL Category)"
                eligible_schemes = ["ab_ark"]
                copay_status = "30% State Financial Assistance (Capped at ₹1,50,000/yr); 70% Patient Co-Payment"
                coverage_summary = (
                    "General Category (APL / Non-BPL Karnataka Residents): Co-payment model. The state government covers 30% of the notified package tariff "
                    "up to a maximum ceiling of ₹1,50,000 per family per year; the patient/family pays the remaining 70% balance directly to the hospital."
                )
                mandatory_docs.append("Karnataka APL Ration Card (NPHH) or Voter ID proving Karnataka residence")
                if not is_emergency:
                    mandatory_docs.append("Government Public Health Institution Online Referral Slip (ORS)")
                actionable_steps.append(
                    "Be prepared to settle 70% of the package rate directly with the hospital, as state coverage is a 30% co-payment up to ₹1.5 Lakh."
                )

            else:  # NONE (No ration card)
                if is_senior_70_plus:
                    primary_id = "pmjay"
                    primary_name = "Ayushman Bharat — PM-JAY (Ayushman Vay Vandana Card for 70+)"
                    eligible_schemes = ["pmjay"]
                    copay_status = "100% Cashless Coverage for Senior Citizens 70+ (up to ₹5,00,000/yr)"
                    coverage_summary = (
                        "Senior Citizen Universal Expansion (Ayushman Vay Vandana Card): All individuals aged 70 and above qualify for ₹5,00,000 annual top-up coverage "
                        "under PM-JAY regardless of household income or ration card tier."
                    )
                    mandatory_docs.append("Aadhaar Card proving patient age 70+")
                else:
                    primary_id = None
                    primary_name = "Standard Public Hospital Subsidized Care / Discretionary Relief"
                    eligible_schemes = []
                    copay_status = "General Private Tariff / Direct Public Hospital Rates"
                    coverage_summary = (
                        "Standard PM-JAY and AB-ArK entitlements require a valid BPL/PHH/AAY or APL ration card. "
                        "Citizens without a ration card may seek care at Government Public Hospitals (e.g. Victoria Hospital, Bowring, KC General) "
                        "at subsidized government rates (e.g. ₹20 OPD ticket) or apply for discretionary CMRF relief with a Tahsildar Income Certificate."
                    )
                    mandatory_docs.append("Government Hospital OPD Registration Slip")
                    conditional_docs.append("Tahsildar Income Certificate (<₹1,00,000/yr) if applying for CMRF")

        # 3. Senior Citizen (70+) note
        if is_senior_70_plus:
            actionable_steps.append(
                "Senior Citizen Expansion (Ayushman Vay Vandana Card): Since the patient is aged 70 or older, they qualify for ₹5 Lakh annual top-up coverage under PM-JAY irrespective of income. Register using Aadhaar e-KYC on beneficiary.nha.gov.in."
            )

        # 4. High estimated cost and CMRF guidance
        if is_karnataka and cost and cost > 150000:
            actionable_steps.append(
                f"High Estimated Cost Notice (₹{cost:,.0f}): If package limits or private co-payment leave a catastrophic funding gap, compile an application for the Karnataka Chief Minister's Relief Fund via Seva Sindhu or your local MLA."
            )
            conditional_docs.extend([
                "Formal Application addressed to the Hon'ble Chief Minister of Karnataka",
                "Recommendation Letter from Sitting Local MLA, MLC, or MP",
                "Original Medical Cost Estimate signed by Treating Doctor and Medical Superintendent with hospital seal",
                "Treating Hospital Bank Mandate form (cancelled cheque / IFSC letter)"
            ])

        official_verification_links = [
            GovernmentSchemeOfficialLink(
                title="PM-JAY Beneficiary Portal (Verify Eligibility & Ayushman Card)",
                url="https://beneficiary.nha.gov.in/",
                purpose="Verify eligibility and generate Ayushman Card via Aadhaar OTP"
            ),
            GovernmentSchemeOfficialLink(
                title="PM-JAY Empanelled Hospital Directory",
                url="https://hospitals.pmjay.gov.in/",
                purpose="Official searchable directory of network hospitals by state and district"
            ),
            GovernmentSchemeOfficialLink(
                title="Suvarna Arogya Suraksha Trust (SAST Karnataka)",
                url="https://sast.karnataka.gov.in/",
                purpose="Karnataka state health schemes, guidelines, and network hospital directory"
            ),
            GovernmentSchemeOfficialLink(
                title="Karnataka Chief Minister's Relief Fund Portal",
                url="https://cmrf.karnataka.gov.in/",
                purpose="Official CMRF guidelines and application status tracking"
            ),
            GovernmentSchemeOfficialLink(
                title="Seva Sindhu Online Medical Relief Application",
                url="https://sevasindhuservices.karnataka.gov.in/",
                purpose="Digital application under Major Ailments Assistance Application Service"
            )
        ]

        helplines = [
            GovernmentSchemeHelpline(
                name="PM-JAY National Call Centre",
                number="14555",
                description="24x7 Multilingual National Toll-Free Helpline",
                tel_uri="tel:14555"
            ),
            GovernmentSchemeHelpline(
                name="Arogya Karnataka SAST Helpline",
                number="1800-425-8330",
                description="Karnataka State Arogya Karnataka Toll-Free Helpdesk",
                tel_uri="tel:18004258330"
            ),
            GovernmentSchemeHelpline(
                name="Karnataka Health Helpline",
                number="104",
                description="24x7 Medical Advice and Scheme Information",
                tel_uri="tel:104"
            ),
            GovernmentSchemeHelpline(
                name="Seva Sindhu Helpdesk",
                number="080-22230282",
                description="Karnataka Citizen Services & CMRF Online Support",
                tel_uri="tel:08022230282"
            )
        ]

        return SchemeEligibilityEvaluationResponse(
            status="success",
            pathway_headline="Potential scheme pathway — confirm with the official authority.",
            primary_scheme_id=primary_id,
            primary_scheme_name=primary_name,
            eligible_schemes=eligible_schemes,
            coverage_summary=coverage_summary,
            copay_status=copay_status,
            referral_required=referral_required,
            referral_guidance=referral_guidance,
            emergency_exemption=emergency_exemption,
            senior_citizen_expansion=is_senior_70_plus,
            cmrf_applicable=cmrf_applicable,
            cmrf_status_note=cmrf_note,
            actionable_steps=actionable_steps,
            mandatory_documents=mandatory_docs,
            conditional_documents=conditional_docs,
            official_verification_links=official_verification_links,
            helpline_numbers=helplines,
            disclaimer=(
                "Potential scheme pathway — confirm with the official authority. EvidenceBridge does not determine eligibility or approve medical treatments. "
                "All official eligibility, pre-authorizations, and coverage decisions are made solely by the National Health Authority (NHA), "
                "Suvarna Arogya Suraksha Trust (SAST), or the Chief Minister's Relief Fund committee."
            )
        )


    async def check_health(self) -> dict[str, Any]:
        """
        Probes the external Karnataka ML API root endpoint to check operational status.
        """
        try:
            async with httpx.AsyncClient(timeout=min(self.timeout_seconds, 10.0)) as client:
                resp = await client.get(f"{self.base_url}/")
                if resp.status_code == 200:
                    try:
                        info = resp.json()
                    except Exception:
                        info = {"raw": resp.text[:100]}
                    return {
                        "status": "online",
                        "base_url": self.base_url,
                        "upstream_status_code": 200,
                        "details": info
                    }
                else:
                    return {
                        "status": "degraded",
                        "base_url": self.base_url,
                        "upstream_status_code": resp.status_code,
                    }
        except Exception as exc:
            return {
                "status": "offline",
                "base_url": self.base_url,
                "error": str(exc)
            }


karnataka_ml_service = KarnatakaMLService()
