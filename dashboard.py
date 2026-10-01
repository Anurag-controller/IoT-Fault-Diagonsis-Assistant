"""
Knowledge-Driven IoT Fault Diagnosis Assistant for Industrial Motors (Simulation-Based)
3rd-Year IoT Mini Project Dashboard
Streamlit Application (Single File: dashboard.py)

Architecture:
- Data Ingestion: SQLite (WAL mode, plant.db) written by MQTT Subscriber
- Knowledge Engine: Dynamic rule evaluation from fault_knowledge.json (ISO 10816-3)
- Real-time UI: Streamlit fragments (@st.fragment) with sub-second polling & Plotly charts
- Explainable AI: Rule evidence matrix (Metric vs Threshold -> PASS/FIRED)
"""

import json
import os
import sqlite3

# Suppress cross-filesystem hardlink warnings in container/Cloud Run environments
os.environ.setdefault("UV_LINK_MODE", "copy")

import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st

# ==============================================================================
# 1. STREAMLIT PAGE CONFIG & GLOBAL STYLING
# ==============================================================================
st.set_page_config(
    page_title="IoT Motor Fault Diagnosis Assistant",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom Industrial Dark-Friendly Theme Styling
st.markdown(
    """
    <style>
    /* Industrial Theme Tweaks */
    .stMetric {
        background-color: #131722;
        padding: 12px 16px;
        border-radius: 8px;
        border: 1px solid #2a2e39;
    }
    .metric-card-delta {
        font-size: 0.85rem;
    }
    .machine-card {
        padding: 14px 18px;
        border-radius: 8px;
        background-color: #1e222d;
        border-left: 5px solid #4a5568;
        margin-bottom: 12px;
        transition: transform 0.15s ease-in-out;
    }
    .machine-card:hover {
        transform: translateY(-2px);
    }
    .status-ok { border-left-color: #10b981; }
    .status-watch { border-left-color: #f59e0b; }
    .status-alarm { border-left-color: #ef4444; }
    .status-offline { border-left-color: #6b7280; opacity: 0.75; }
    
    .status-badge {
        padding: 4px 10px;
        border-radius: 9999px;
        font-weight: 700;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        display: inline-block;
    }
    .badge-ok { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; }
    .badge-watch { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; }
    .badge-alarm { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .badge-offline { background: rgba(107, 114, 128, 0.2); color: #9ca3af; border: 1px solid #6b7280; }
    
    .banner-box {
        padding: 16px 20px;
        border-radius: 8px;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .evidence-pass { color: #10b981; font-weight: bold; }
    .evidence-fired { color: #ef4444; font-weight: bold; background: rgba(239,68,68,0.15); padding: 2px 6px; border-radius: 4px; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ==============================================================================
# 2. DATABASE CONFIGURATION & HELPERS
# ==============================================================================
DB_PATH = os.path.join("data", "plant.db")
KNOWLEDGE_BASE_PATH = "fault_knowledge.json"


def get_db_connection() -> sqlite3.Connection:
    """
    Returns a fresh, short-lived SQLite connection configured with WAL mode.
    Ensures safe concurrent reads while the MQTT subscriber writes data.
    """
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db_if_missing():
    """
    Creates tables if plant.db is fresh or subscriber hasn't created it yet.
    Prevents runtime crashes on initial launch.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS assets (
                asset_id TEXT PRIMARY KEY,
                name TEXT,
                type TEXT,
                location TEXT,
                rated_rpm REAL,
                rated_current REAL
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL,
                asset_id TEXT,
                rms REAL,
                kurtosis REAL,
                peak_1x REAL,
                peak_2x REAL,
                temp REAL,
                current REAL,
                rpm REAL
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS diagnosis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL,
                asset_id TEXT,
                fault TEXT,
                confidence INT,
                severity TEXT
            )
            """
        )
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL,
                asset_id TEXT,
                fault TEXT,
                severity TEXT,
                message TEXT,
                acknowledged INT DEFAULT 0
            )
            """
        )
        # Seed default asset specs if missing
        cursor.execute("SELECT COUNT(*) FROM assets")
        if cursor.fetchone()[0] == 0:
            cursor.executemany(
                """
                INSERT INTO assets (asset_id, name, type, location, rated_rpm, rated_current)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    ("motor01", "Primary Feed Motor 01", "Induction Motor 75kW", "Bay A - Feed Pump", 1485.0, 138.0),
                    ("motor02", "Slurry Agitator Motor 02", "Induction Motor 45kW", "Bay B - Agitation Tank", 1470.0, 85.0),
                    ("pump03", "Chilled Water Pump 03", "Centrifugal Pump 30kW", "Bay C - Cooling Loop", 2950.0, 58.0),
                ],
            )
            conn.commit()


# Ensure database tables exist
init_db_if_missing()

# ==============================================================================
# 3. KNOWLEDGE BASE LOADER (FAULT_KNOWLEDGE.JSON)
# ==============================================================================
@st.cache_data(ttl=60)
def load_knowledge_base() -> Dict[str, Any]:
    """
    Loads fault taxonomy, explainable rule criteria, ISO 10816 thresholds,
    and remediation actions from fault_knowledge.json.
    """
    if os.path.exists(KNOWLEDGE_BASE_PATH):
        try:
            with open(KNOWLEDGE_BASE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            st.error(f"Error reading {KNOWLEDGE_BASE_PATH}: {e}")

    # Fallback knowledge base structure if file is missing
    return {
        "iso_10816_standard": {
            "standard": "ISO 10816-3 (Group 1 / 2 Machines)",
            "watch_threshold_rms": 4.5,
            "alarm_threshold_rms": 7.1,
            "zones": {
                "Zone A/B": {"label": "Good / Acceptable (OK)", "max_rms": 4.5, "color": "#10B981"},
                "Zone C": {"label": "Restricted Continuous (WATCH)", "min_rms": 4.5, "max_rms": 7.1, "color": "#F59E0B"},
                "Zone D": {"label": "Dangerous Vibration (ALARM)", "min_rms": 7.1, "color": "#EF4444"},
            },
        },
        "faults": {
            "healthy": {
                "name": "Healthy Baseline Operation",
                "symptom": "Normal vibration profile (RMS < 4.5 mm/s), stable current draw & thermal signature.",
                "cause": "Mechanical balance, alignment, and lubrication meet ISO tolerances.",
                "recommended_action": "Maintain scheduled routine vibration surveys.",
            },
            "unbalance": {
                "name": "Rotor Dynamic Unbalance",
                "symptom": "Dominant 1X running frequency radial vibration peak (peak_1x >= 3.8 mm/s).",
                "cause": "Uneven mass distribution on rotor/impeller due to buildup, erosion, or loose weight.",
                "recommended_action": "Execute dynamic field balancing; inspect rotor for debris or blade wear.",
            },
            "misalignment": {
                "name": "Shaft / Coupling Misalignment",
                "symptom": "High 2X harmonic vibration (peak_2x >= 2.8 mm/s, ratio 2X/1X >= 0.8), elevated axial vibes.",
                "cause": "Thermal growth distortion, soft foot condition, or angular/parallel coupling offset.",
                "recommended_action": "Perform laser shaft alignment; verify soft foot with dial indicator.",
            },
            "bearing_wear": {
                "name": "Rolling Element Bearing Defect",
                "symptom": "Impulsive impact kurtosis > 3.8, localized bearing temperature rise > 70 °C.",
                "cause": "L10 fatigue spalling on bearing raceways, lack of lubrication, or electrical fluting.",
                "recommended_action": "Inspect grease particulate levels; schedule bearing replacement at next outage.",
            },
            "overload_jam": {
                "name": "Mechanical Overload / Impeller Jam",
                "symptom": "Motor current > 115% rated current, rotor slip RPM drop > 5%, elevated temperature.",
                "cause": "Process-side obstruction, foreign debris trapped in pump volute, high fluid viscosity.",
                "recommended_action": "Immediately de-energize (LOTO); inspect pump suction strainer and rotate shaft manually.",
            },
        },
        "rules": [],
    }


KB = load_knowledge_base()
ISO_WATCH_RMS = KB.get("iso_10816_standard", {}).get("watch_threshold_rms", 4.5)
ISO_ALARM_RMS = KB.get("iso_10816_standard", {}).get("alarm_threshold_rms", 7.1)

# ==============================================================================
# 4. DATA ACCESS LAYER (PARAMETERIZED SQL ONLY)
# ==============================================================================
def fetch_all_assets() -> List[Dict[str, Any]]:
    """Fetches all registered machines from assets table."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT asset_id, name, type, location, rated_rpm, rated_current FROM assets ORDER BY asset_id ASC")
        return [dict(row) for row in cursor.fetchall()]


def fetch_latest_telemetry(asset_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves the single most recent telemetry sample for an asset."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ts, asset_id, rms, kurtosis, peak_1x, peak_2x, temp, current, rpm
            FROM telemetry
            WHERE asset_id = ?
            ORDER BY ts DESC LIMIT 1
            """,
            (asset_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def fetch_previous_telemetry(asset_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves the 2nd most recent telemetry sample to calculate KPI deltas."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ts, asset_id, rms, kurtosis, peak_1x, peak_2x, temp, current, rpm
            FROM telemetry
            WHERE asset_id = ?
            ORDER BY ts DESC LIMIT 1 OFFSET 1
            """,
            (asset_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def fetch_telemetry_history(asset_id: str, limit: int = 120) -> pd.DataFrame:
    """Retrieves the last N telemetry records for timeseries charts."""
    with get_db_connection() as conn:
        query = """
            SELECT ts, rms, kurtosis, peak_1x, peak_2x, temp, current, rpm
            FROM telemetry
            WHERE asset_id = ?
            ORDER BY ts DESC LIMIT ?
        """
        df = pd.read_sql_query(query, conn, params=(asset_id, limit))
        if not df.empty:
            df = df.iloc[::-1].reset_index(drop=True)  # Chronological order
            df["datetime"] = pd.to_datetime(df["ts"], unit="s", utc=True).dt.tz_convert(None)
        return df


def fetch_latest_diagnosis(asset_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves the most recent automated diagnosis from SQLite."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT ts, asset_id, fault, confidence, severity
            FROM diagnosis
            WHERE asset_id = ?
            ORDER BY ts DESC LIMIT 1
            """,
            (asset_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def fetch_recent_alerts(limit: int = 15) -> List[Dict[str, Any]]:
    """Retrieves the latest 15 alerts across all machines."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, ts, asset_id, fault, severity, message, acknowledged
            FROM alerts
            ORDER BY ts DESC LIMIT ?
            """,
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]


def acknowledge_alerts(asset_id: Optional[str] = None):
    """Marks alerts as acknowledged (either all or specific asset)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if asset_id:
            cursor.execute("UPDATE alerts SET acknowledged = 1 WHERE asset_id = ? AND acknowledged = 0", (asset_id,))
        else:
            cursor.execute("UPDATE alerts SET acknowledged = 1 WHERE acknowledged = 0")
        conn.commit()


# ==============================================================================
# 5. KNOWLEDGE-DRIVEN DIAGNOSIS & EXPLAINABILITY ENGINE
# ==============================================================================
def evaluate_explainable_rules(telemetry: Dict[str, Any], asset: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Evaluates condition monitoring telemetry against the expert knowledge base rules.
    Returns an explainable evidence list showing: Rule, Measured Value, Threshold, Status (PASS/FIRED).
    """
    rms = telemetry.get("rms", 0.0)
    kurtosis = telemetry.get("kurtosis", 3.0)
    peak_1x = telemetry.get("peak_1x", 0.0)
    peak_2x = telemetry.get("peak_2x", 0.0)
    temp = telemetry.get("temp", 25.0)
    current = telemetry.get("current", 0.0)
    rpm = telemetry.get("rpm", 1500.0)
    
    rated_current = asset.get("rated_current", 100.0)
    rated_rpm = asset.get("rated_rpm", 1500.0)

    ratio_1x_2x = (peak_1x / peak_2x) if peak_2x > 0.05 else 99.0
    ratio_2x_1x = (peak_2x / peak_1x) if peak_1x > 0.05 else 0.0
    current_ratio = (current / rated_current) if rated_current > 0 else 1.0
    rpm_drop = max(0.0, ((rated_rpm - rpm) / rated_rpm) * 100.0) if rated_rpm > 0 else 0.0

    evidence = [
        {
            "rule": "Dominant 1X Vibration (Unbalance)",
            "metric": "Peak 1X",
            "live_value": f"{peak_1x:.2f} mm/s",
            "threshold": ">= 3.80 mm/s (and 1X/2X >= 1.8)",
            "fired": (peak_1x >= 3.8 and ratio_1x_2x >= 1.8),
            "fault": "unbalance",
        },
        {
            "rule": "Coupling 2X Harmonic (Misalignment)",
            "metric": "Peak 2X & Ratio",
            "live_value": f"{peak_2x:.2f} mm/s (2X/1X: {ratio_2x_1x:.2f})",
            "threshold": ">= 2.80 mm/s (and 2X/1X >= 0.8)",
            "fired": (peak_2x >= 2.8 and ratio_2x_1x >= 0.8),
            "fault": "misalignment",
        },
        {
            "rule": "Impulsive Kurtosis (Bearing Spalling)",
            "metric": "Kurtosis",
            "live_value": f"{kurtosis:.2f}",
            "threshold": ">= 3.80",
            "fired": (kurtosis >= 3.8),
            "fault": "bearing_wear",
        },
        {
            "rule": "Bearing Temperature Rise",
            "metric": "Temp",
            "live_value": f"{temp:.1f} °C",
            "threshold": ">= 70.0 °C",
            "fired": (temp >= 70.0),
            "fault": "bearing_wear",
        },
        {
            "rule": "Current Overload (Motor Current > 115%)",
            "metric": "Current / Rated",
            "live_value": f"{current:.1f} A ({current_ratio*100:.1f}%)",
            "threshold": ">= 115% of rated",
            "fired": (current_ratio >= 1.15),
            "fault": "overload_jam",
        },
        {
            "rule": "Rotor Slip Drop (Heavy Load / Jam)",
            "metric": "RPM Drop %",
            "live_value": f"{rpm_drop:.1f}% ({rpm:.0f} RPM)",
            "threshold": ">= 5.0% below rated",
            "fired": (rpm_drop >= 5.0),
            "fault": "overload_jam",
        },
        {
            "rule": "ISO 10816-3 Zone D Alarm Vibration",
            "metric": "RMS Velocity",
            "live_value": f"{rms:.2f} mm/s",
            "threshold": f">= {ISO_ALARM_RMS:.1f} mm/s",
            "fired": (rms >= ISO_ALARM_RMS),
            "fault": "general_alarm",
        },
    ]
    return evidence


def calculate_time_to_alarm(df: pd.DataFrame, current_rms: float) -> Tuple[str, Optional[float]]:
    """
    Fits a linear polynomial trend line (numpy.polyfit) to the last N RMS points.
    Estimates seconds remaining until the 7.1 mm/s ISO 10816 Alarm threshold is breached.
    """
    if df.empty or len(df) < 5:
        return "Insufficient data for trend fitting", None

    if current_rms >= ISO_ALARM_RMS:
        return "Alarm Threshold ALREADY EXCEEDED (RMS >= 7.1 mm/s)", 0.0

    # Fit linear polynomial y = mx + c where x is time in seconds
    x = (df["ts"] - df["ts"].iloc[0]).values
    y = df["rms"].values

    if len(x) < 5 or np.all(x == x[0]):
        return "Trend: Stable", None

    slope, intercept = np.polyfit(x, y, 1)

    # If slope is negative or negligible (< 0.001 mm/s per sec)
    if slope <= 0.001:
        return "Status: Stable (Vibration rate is flat or decreasing)", None

    seconds_to_alarm = (ISO_ALARM_RMS - current_rms) / slope
    if seconds_to_alarm <= 0:
        return "Critical: Threshold breach imminent", 0.0
    elif seconds_to_alarm > 36000:
        return "Stable / Long-term (> 10 hours)", seconds_to_alarm
    else:
        minutes = seconds_to_alarm / 60.0
        return f"~{minutes:.1f} minutes ({seconds_to_alarm:.0f}s) at current rate (+{slope*60:.2f} mm/s/min)", seconds_to_alarm


# ==============================================================================
# 6. SESSION STATE INITIALIZATION (ALERT TOAST TRACKER)
# ==============================================================================
if "seen_alert_ids" not in st.session_state:
    st.session_state["seen_alert_ids"] = set()
    st.session_state["first_load_done"] = False
if "paused" not in st.session_state:
    st.session_state["paused"] = False

# ==============================================================================
# 7. SIDEBAR CONTROLS
# ==============================================================================
with st.sidebar:
    st.title("⚙️ Control Panel")
    st.markdown("Knowledge-Driven IoT Motor Assistant")
    
    st.divider()
    refresh_seconds = st.slider("🔄 Refresh Interval (seconds)", min_value=1, max_value=5, value=2, step=1)
    window_samples = st.slider("📈 Chart History Window (samples)", min_value=30, max_value=600, value=60, step=10)
    
    st.divider()
    col_pause, col_resume = st.columns(2)
    with col_pause:
        if st.button("⏸️ Pause", use_container_width=True):
            st.session_state["paused"] = True
    with col_resume:
        if st.button("▶️ Resume", use_container_width=True):
            st.session_state["paused"] = False

    st.caption(f"Status: **{'PAUSED' if st.session_state['paused'] else 'RUNNING LIVE'}**")

    st.divider()
    st.markdown("### 🏷️ ISO 10816-3 Vibration Zones")
    st.markdown(
        f"""
        - 🟢 **Zone A/B (OK)**: `< {ISO_WATCH_RMS} mm/s`
        - 🟡 **Zone C (WATCH)**: `{ISO_WATCH_RMS} – {ISO_ALARM_RMS} mm/s`
        - 🔴 **Zone D (ALARM)**: `>= {ISO_ALARM_RMS} mm/s`
        """
    )
    st.caption("Thresholds loaded dynamically from `fault_knowledge.json`.")


# ==============================================================================
# 8. MAIN FRAGMENT FOR REAL-TIME SUB-PAGE REFRESH (STREAMLIT >= 1.37)
# ==============================================================================
effective_interval = 0 if st.session_state["paused"] else refresh_seconds


@st.fragment(run_every=effective_interval)
def render_realtime_dashboard():
    """
    Sub-second fragment updates UI without full-page reloads, preventing flicker.
    """
    now_epoch = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # --------------------------------------------------------------------------
    # 8.1 Header: Project Title, LIVE/PAUSED badge, last update
    # --------------------------------------------------------------------------
    header_col1, header_col2 = st.columns([3, 1])
    with header_col1:
        st.subheader("Knowledge-Driven IoT Fault Diagnosis Assistant for Industrial Motors")
        st.caption("3rd-Year IoT Mini Project • Simulation-Based Predictive Maintenance System")

    with header_col2:
        if st.session_state["paused"]:
            st.markdown(
                f"""
                <div style="text-align: right;">
                    <span class="status-badge" style="background:#4b5563; color:#f3f4f6;">⏸️ PAUSED</span><br>
                    <small style="color:#9ca3af;">Last Snapshot: {now_str}</small>
                </div>
                """,
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                f"""
                <div style="text-align: right;">
                    <span class="status-badge" style="background:#065f46; color:#34d399; animation: pulse 2s infinite;">🟢 LIVE</span><br>
                    <small style="color:#9ca3af;">Updated: {now_str}</small>
                </div>
                """,
                unsafe_allow_html=True,
            )

    st.markdown("---")

    # --------------------------------------------------------------------------
    # 8.2 Plant Overview Row
    # --------------------------------------------------------------------------
    assets = fetch_all_assets()
    if not assets:
        st.warning("⚠️ No machine assets registered in SQLite database. Run subscriber or simulator.")
        return

    # Check health and online status of each machine
    machine_status_list = []
    count_ok = 0
    count_watch = 0
    count_alarm = 0
    count_offline = 0

    for asset in assets:
        aid = asset["asset_id"]
        latest_tel = fetch_latest_telemetry(aid)
        latest_diag = fetch_latest_diagnosis(aid)

        is_offline = True
        status_label = "OFFLINE"
        status_color = "status-offline"
        badge_class = "badge-offline"
        fault_name = "No Data"
        rms_val = 0.0

        if latest_tel:
            time_diff = now_epoch - latest_tel["ts"]
            if time_diff <= 10.0:  # Offline threshold: > 10 s silence
                is_offline = False
                rms_val = latest_tel["rms"]
                
                # Check severity from diagnosis or ISO 10816 thresholds
                severity = latest_diag.get("severity", "OK") if latest_diag else "OK"
                fault_key = latest_diag.get("fault", "healthy") if latest_diag else "healthy"
                fault_meta = KB.get("faults", {}).get(fault_key, {})
                fault_name = fault_meta.get("name", fault_key.replace("_", " ").title())

                if rms_val >= ISO_ALARM_RMS or severity == "ALARM":
                    status_label = "ALARM"
                    status_color = "status-alarm"
                    badge_class = "badge-alarm"
                    count_alarm += 1
                elif rms_val >= ISO_WATCH_RMS or severity == "WATCH":
                    status_label = "WATCH"
                    status_color = "status-watch"
                    badge_class = "badge-watch"
                    count_watch += 1
                else:
                    status_label = "OK"
                    status_color = "status-ok"
                    badge_class = "badge-ok"
                    count_ok += 1
            else:
                count_offline += 1
        else:
            count_offline += 1

        machine_status_list.append(
            {
                "asset": asset,
                "latest_tel": latest_tel,
                "latest_diag": latest_diag,
                "is_offline": is_offline,
                "status_label": status_label,
                "status_color": status_color,
                "badge_class": badge_class,
                "fault_name": fault_name,
                "rms_val": rms_val,
            }
        )

    # Summary Line
    st.markdown(
        f"""
        <div style="font-size: 1.05rem; font-weight: 600; margin-bottom: 12px; color: #e2e8f0;">
            🏭 <b>PLANT OVERVIEW</b> &nbsp;|&nbsp; 
            <span style="color:#cbd5e1;">{len(assets)} machines</span> &nbsp;•&nbsp; 
            <span style="color:#10b981;">{count_ok} OK</span> &nbsp;•&nbsp; 
            <span style="color:#f59e0b;">{count_watch} WATCH</span> &nbsp;•&nbsp; 
            <span style="color:#ef4444;">{count_alarm} ALARM</span> &nbsp;•&nbsp; 
            <span style="color:#9ca3af;">{count_offline} OFFLINE</span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Machine Health Cards Row with Sparklines
    cols = st.columns(len(assets))
    for idx, m in enumerate(machine_status_list):
        aid = m["asset"]["asset_id"]
        aname = m["asset"]["name"]
        with cols[idx]:
            # Fetch last 30 samples for sparkline
            hist_spark = fetch_telemetry_history(aid, limit=30)
            spark_svg = ""
            if not hist_spark.empty and len(hist_spark) > 2:
                rms_series = hist_spark["rms"].tolist()
                min_v, max_v = min(rms_series), max(rms_series)
                range_v = (max_v - min_v) if max_v > min_v else 1.0
                pts = [f"{i * (180 / max(1, len(rms_series) - 1)):.1f},{35 - ((v - min_v) / range_v * 30):.1f}" for i, v in enumerate(rms_series)]
                spark_points = " ".join(pts)
                spark_line_color = "#ef4444" if m["status_label"] == "ALARM" else ("#f59e0b" if m["status_label"] == "WATCH" else "#10b981")
                spark_svg = f"""
                <svg width="100%" height="38" viewBox="0 0 190 38" style="overflow: visible;">
                    <polyline fill="none" stroke="{spark_line_color}" stroke-width="2.2" stroke-linecap="round" points="{spark_points}" />
                </svg>
                """
            else:
                spark_svg = "<div style='color:#6b7280; font-size:0.75rem; padding-top:8px;'>No sparkline data</div>"

            st.markdown(
                f"""
                <div class="machine-card {m['status_color']}">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-weight:700; font-size:1.0rem; color:#f8fafc;">{aname}</span>
                        <span class="status-badge {m['badge_class']}">{m['status_label']}</span>
                    </div>
                    <div style="color:#94a3b8; font-size:0.8rem;">{m['asset']['location']}</div>
                    <div style="margin: 8px 0; display:flex; justify-content:space-between; align-items:baseline;">
                        <span style="font-size:1.25rem; font-weight:700; color:#f1f5f9;">{m['rms_val']:.2f} <small style="font-size:0.8rem; font-weight:normal; color:#94a3b8;">mm/s</small></span>
                        <span style="font-size:0.85rem; color:#cbd5e1;">{m['fault_name']}</span>
                    </div>
                    {spark_svg}
                </div>
                """,
                unsafe_allow_html=True,
            )

    # Machine Selector
    asset_options = {a["asset_id"]: f"{a['name']} ({a['asset_id']})" for a in assets}
    selected_aid = st.selectbox(
        "🔎 Select Active Machine to Inspect Details & Explainable Diagnosis:",
        options=list(asset_options.keys()),
        format_func=lambda x: asset_options[x],
        key="selected_machine_dropdown",
    )

    # --------------------------------------------------------------------------
    # 8.3 Tabbed Layout: Live Monitoring | Fault Knowledge Base | History
    # --------------------------------------------------------------------------
    tab_live, tab_kb, tab_history = st.tabs(["📊 Live Monitoring", "📚 Fault Knowledge Base", "📜 Historical Data"])

    with tab_live:
        selected_asset = next(a for a in assets if a["asset_id"] == selected_aid)
        cur_tel = fetch_latest_telemetry(selected_aid)
        prev_tel = fetch_previous_telemetry(selected_aid)
        cur_diag = fetch_latest_diagnosis(selected_aid)

        if not cur_tel:
            st.info(f"⏳ Waiting for telemetry from **{selected_asset['name']}** ({selected_aid}). Ensure subscriber/simulator is sending data.")
        else:
            # Check offline for selected machine
            is_offline = (now_epoch - cur_tel["ts"]) > 10.0

            # Status Banner
            severity = "OFFLINE" if is_offline else (cur_diag.get("severity", "OK") if cur_diag else "OK")
            fault_key = "offline" if is_offline else (cur_diag.get("fault", "healthy") if cur_diag else "healthy")
            confidence = cur_diag.get("confidence", 95) if cur_diag else 95

            fault_meta = KB.get("faults", {}).get(fault_key, {})
            fault_display_name = "Sensor Inactive / Offline" if is_offline else fault_meta.get("name", fault_key.replace("_", " ").title())

            banner_bg = "#374151" if is_offline else ("#7f1d1d" if severity == "ALARM" else ("#78350f" if severity == "WATCH" else "#064e3b"))
            banner_border = "#6b7280" if is_offline else ("#ef4444" if severity == "ALARM" else ("#f59e0b" if severity == "WATCH" else "#10b981"))
            banner_icon = "⚠️" if severity in ["WATCH", "ALARM"] else ("🟢" if severity == "OK" else "⚪")

            st.markdown(
                f"""
                <div class="banner-box" style="background:{banner_bg}; border:1px solid {banner_border}; color:#ffffff;">
                    <div>
                        <div style="font-size:1.15rem; font-weight:800; letter-spacing:0.02em;">
                            {banner_icon} STATE: {severity} — {fault_display_name}
                        </div>
                        <div style="font-size:0.85rem; color:#e2e8f0; margin-top:4px;">
                            Asset ID: <code>{selected_aid}</code> &bull; Rated: {selected_asset['rated_rpm']} RPM / {selected_asset['rated_current']} A
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:1.4rem; font-weight:900;">{confidence}%</span><br>
                        <span style="font-size:0.75rem; text-transform:uppercase; color:#cbd5e1;">Rule Confidence</span>
                    </div>
                </div>
                """,
                unsafe_allow_html=True,
            )

            # KPI Cards Row with Deltas vs Previous Sample
            kpi_cols = st.columns(5)
            rms_delta = (cur_tel["rms"] - prev_tel["rms"]) if prev_tel else 0.0
            temp_delta = (cur_tel["temp"] - prev_tel["temp"]) if prev_tel else 0.0
            current_delta = (cur_tel["current"] - prev_tel["current"]) if prev_tel else 0.0
            rpm_delta = (cur_tel["rpm"] - prev_tel["rpm"]) if prev_tel else 0.0
            kurt_delta = (cur_tel["kurtosis"] - prev_tel["kurtosis"]) if prev_tel else 0.0

            kpi_cols[0].metric(
                label="Vibration RMS",
                value=f"{cur_tel['rms']:.2f} mm/s",
                delta=f"{rms_delta:+.2f} mm/s",
                delta_color="inverse",
            )
            kpi_cols[1].metric(
                label="Bearing Temp",
                value=f"{cur_tel['temp']:.1f} °C",
                delta=f"{temp_delta:+.1f} °C",
                delta_color="inverse",
            )
            kpi_cols[2].metric(
                label="Motor Current",
                value=f"{cur_tel['current']:.1f} A",
                delta=f"{current_delta:+.1f} A",
                delta_color="inverse",
            )
            kpi_cols[3].metric(
                label="Rotational Speed",
                value=f"{cur_tel['rpm']:.0f} RPM",
                delta=f"{rpm_delta:+.0f} RPM",
            )
            kpi_cols[4].metric(
                label="Kurtosis (Impact)",
                value=f"{cur_tel['kurtosis']:.2f}",
                delta=f"{kurt_delta:+.2f}",
                delta_color="inverse",
            )

            st.markdown("<br>", unsafe_allow_html=True)

            # ------------------------------------------------------------------
            # Real-Time Plotly Charts (2-Column Grid)
            # ------------------------------------------------------------------
            df_hist = fetch_telemetry_history(selected_aid, limit=window_samples)

            if not df_hist.empty:
                chart_col1, chart_col2 = st.columns(2)

                # Chart 1: Vibration Velocity RMS with ISO 10816 Watch/Alarm lines
                with chart_col1:
                    fig_rms = go.Figure()
                    fig_rms.add_trace(
                        go.Scatter(
                            x=df_hist["datetime"],
                            y=df_hist["rms"],
                            mode="lines+markers",
                            name="RMS Velocity",
                            line=dict(color="#38bdf8", width=2.5),
                            marker=dict(size=4),
                        )
                    )
                    # Dashed Watch and Alarm Threshold Lines
                    fig_rms.add_hline(
                        y=ISO_WATCH_RMS,
                        line_dash="dash",
                        line_color="#f59e0b",
                        annotation_text=f"Watch Zone C ({ISO_WATCH_RMS} mm/s)",
                        annotation_position="top left",
                    )
                    fig_rms.add_hline(
                        y=ISO_ALARM_RMS,
                        line_dash="dash",
                        line_color="#ef4444",
                        annotation_text=f"Alarm Zone D ({ISO_ALARM_RMS} mm/s)",
                        annotation_position="top left",
                    )
                    fig_rms.update_layout(
                        title=f"📈 Vibration RMS (ISO 10816-3) - {selected_asset['name']}",
                        xaxis_title="Time",
                        yaxis_title="Velocity RMS (mm/s)",
                        template="plotly_dark",
                        height=290,
                        margin=dict(l=40, r=20, t=40, b=30),
                        legend=dict(orientation="h", y=1.1),
                    )
                    st.plotly_chart(fig_rms, use_container_width=True, key=f"rms_chart_{selected_aid}")

                # Chart 2: Bearing Temperature
                with chart_col2:
                    fig_temp = go.Figure()
                    fig_temp.add_trace(
                        go.Scatter(
                            x=df_hist["datetime"],
                            y=df_hist["temp"],
                            mode="lines",
                            name="Bearing Temp",
                            line=dict(color="#f97316", width=2.5),
                            fill="tozeroy",
                            fillcolor="rgba(249, 115, 22, 0.1)",
                        )
                    )
                    fig_temp.add_hline(
                        y=70.0,
                        line_dash="dot",
                        line_color="#ef4444",
                        annotation_text="Hot Limit 70 °C",
                        annotation_position="bottom left",
                    )
                    fig_temp.update_layout(
                        title="🌡️ Bearing Housing Temperature",
                        xaxis_title="Time",
                        yaxis_title="Temperature (°C)",
                        template="plotly_dark",
                        height=290,
                        margin=dict(l=40, r=20, t=40, b=30),
                    )
                    st.plotly_chart(fig_temp, use_container_width=True, key=f"temp_chart_{selected_aid}")

                # Chart 3: Motor Current vs Rated Current Line
                with chart_col1:
                    fig_curr = go.Figure()
                    fig_curr.add_trace(
                        go.Scatter(
                            x=df_hist["datetime"],
                            y=df_hist["current"],
                            mode="lines",
                            name="Current Draw",
                            line=dict(color="#a855f7", width=2.2),
                        )
                    )
                    fig_curr.add_hline(
                        y=selected_asset["rated_current"],
                        line_dash="dash",
                        line_color="#94a3b8",
                        annotation_text=f"Rated: {selected_asset['rated_current']} A",
                    )
                    fig_curr.add_hline(
                        y=selected_asset["rated_current"] * 1.15,
                        line_dash="dot",
                        line_color="#ef4444",
                        annotation_text="Overload Jam: 115%",
                    )
                    fig_curr.update_layout(
                        title="⚡ Stator Current vs Rated Capacity",
                        xaxis_title="Time",
                        yaxis_title="Current (A)",
                        template="plotly_dark",
                        height=290,
                        margin=dict(l=40, r=20, t=40, b=30),
                    )
                    st.plotly_chart(fig_curr, use_container_width=True, key=f"curr_chart_{selected_aid}")

                # Chart 4: Kurtosis (Impulsive Impact Faults)
                with chart_col2:
                    fig_kurt = go.Figure()
                    fig_kurt.add_trace(
                        go.Scatter(
                            x=df_hist["datetime"],
                            y=df_hist["kurtosis"],
                            mode="lines+markers",
                            name="Kurtosis",
                            line=dict(color="#10b981", width=2.0),
                            marker=dict(size=4),
                        )
                    )
                    fig_kurt.add_hline(
                        y=3.8,
                        line_dash="dash",
                        line_color="#f59e0b",
                        annotation_text="Bearing Defect Threshold (3.8)",
                    )
                    fig_kurt.update_layout(
                        title="💥 Kurtosis (Impact Shock Indicator)",
                        xaxis_title="Time",
                        yaxis_title="Kurtosis Value",
                        template="plotly_dark",
                        height=290,
                        margin=dict(l=40, r=20, t=40, b=30),
                    )
                    st.plotly_chart(fig_kurt, use_container_width=True, key=f"kurt_chart_{selected_aid}")

                # Chart 5: 1X vs 2X Harmonic Comparison (Critical for Unbalance vs Misalignment)
                st.markdown("#### 🔬 Harmonic Frequency Spectrum Analysis (1X vs 2X)")
                fig_harm = go.Figure()
                fig_harm.add_trace(
                    go.Scatter(
                        x=df_hist["datetime"],
                        y=df_hist["peak_1x"],
                        name="1X Rotational Peak (Unbalance signature)",
                        line=dict(color="#3b82f6", width=2.2),
                    )
                )
                fig_harm.add_trace(
                    go.Scatter(
                        x=df_hist["datetime"],
                        y=df_hist["peak_2x"],
                        name="2X Harmonic Peak (Misalignment signature)",
                        line=dict(color="#ec4899", width=2.2),
                    )
                )
                fig_harm.update_layout(
                    title="1X vs 2X Harmonic Velocity Amplitude Over Time",
                    xaxis_title="Time",
                    yaxis_title="Velocity Amplitude (mm/s)",
                    template="plotly_dark",
                    height=260,
                    margin=dict(l=40, r=20, t=40, b=30),
                    legend=dict(orientation="h", y=1.15),
                )
                st.plotly_chart(fig_harm, use_container_width=True, key=f"harm_chart_{selected_aid}")

            # ------------------------------------------------------------------
            # Diagnosis Panel & Explainable AI Evidence Table
            # ------------------------------------------------------------------
            st.markdown("---")
            st.markdown("### 🧠 Explainable Diagnosis & Knowledge-Base Reasoning")
            
            diag_col1, diag_col2 = st.columns([1, 1])
            with diag_col1:
                st.markdown(
                    f"""
                    <div style="background:#1e293b; padding:16px 20px; border-radius:8px; border-left:4px solid #38bdf8;">
                        <h4 style="margin:0 0 8px 0; color:#38bdf8;">Root Cause Hypothesis</h4>
                        <p style="margin:0 0 12px 0; font-size:0.95rem; color:#e2e8f0;">
                            <b>Identified Fault:</b> {fault_display_name}<br>
                            <b>Cause:</b> {fault_meta.get('cause', 'Nominal parameters.')}
                        </p>
                        <h4 style="margin:0 0 8px 0; color:#10b981;">Recommended Action Plan</h4>
                        <p style="margin:0; font-size:0.95rem; color:#cbd5e1;">
                            {fault_meta.get('recommended_action', 'Continue standard routine operations.')}
                        </p>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

                # Predictive Trend (Time to Alarm)
                time_alarm_msg, sec_left = calculate_time_to_alarm(df_hist, cur_tel["rms"])
                trend_color = "#ef4444" if (sec_left is not None and sec_left < 300) else ("#f59e0b" if sec_left else "#10b981")
                st.markdown(
                    f"""
                    <div style="background:#0f172a; padding:14px 18px; border-radius:8px; margin-top:12px; border:1px solid #334155;">
                        <span style="font-weight:700; color:#94a3b8; font-size:0.85rem;">⏱️ ESTIMATED TIME TO ALARM (7.1 mm/s):</span><br>
                        <span style="font-size:1.05rem; font-weight:800; color:{trend_color};">{time_alarm_msg}</span>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )

            with diag_col2:
                st.markdown("#### 📋 Diagnostic Evidence Matrix (Rule Evaluation)")
                evidence_rules = evaluate_explainable_rules(cur_tel, selected_asset)
                
                # Format dataframe for clean table rendering
                evidence_rows = []
                for r in evidence_rules:
                    status_text = "🔥 FIRED" if r["fired"] else "✅ PASS"
                    evidence_rows.append(
                        {
                            "Diagnostic Rule": r["rule"],
                            "Metric": r["metric"],
                            "Live Reading": r["live_value"],
                            "Rule Threshold": r["threshold"],
                            "Status": status_text,
                        }
                    )
                df_evidence = pd.DataFrame(evidence_rows)
                st.dataframe(df_evidence, use_container_width=True, hide_index=True)
                st.caption("Each telemetry frame is matched against forward-chaining expert rules for transparent explainability.")

    # --------------------------------------------------------------------------
    # 8.4 Fault Knowledge Base Tab
    # --------------------------------------------------------------------------
    with tab_kb:
        st.markdown("### 📚 Industrial Motor Fault Taxonomy & Diagnostic Criteria")
        st.markdown(
            """
            This knowledge base encapsulates domain vibration engineering principles derived from **ISO 10816-3**
            and rotating machinery electrical signature analysis (MCSA).
            """
        )

        for f_key, f_data in KB.get("faults", {}).items():
            st.markdown(
                f"""
                <div style="background:#1e293b; border-radius:8px; padding:16px 20px; margin-bottom:14px; border-left:4px solid #6366f1;">
                    <h3 style="margin:0 0 6px 0; color:#a5b4fc;">{f_data.get('name', f_key)}</h3>
                    <p style="margin:0 0 8px 0; font-size:0.9rem; color:#cbd5e1;"><b>Symptoms:</b> {f_data.get('symptom', '')}</p>
                    <p style="margin:0 0 8px 0; font-size:0.9rem; color:#cbd5e1;"><b>Root Cause:</b> {f_data.get('cause', '')}</p>
                    <p style="margin:0 0 8px 0; font-size:0.9rem; color:#34d399;"><b>Corrective Maintenance Action:</b> {f_data.get('recommended_action', '')}</p>
                </div>
                """,
                unsafe_allow_html=True,
            )

    # --------------------------------------------------------------------------
    # 8.5 Historical Data & CSV Download Tab
    # --------------------------------------------------------------------------
    with tab_history:
        st.markdown("### 📜 Historical Telemetry Query & Export")
        h_col1, h_col2, h_col3 = st.columns([2, 1, 1])
        with h_col1:
            hist_aid = st.selectbox(
                "Filter Machine:",
                options=[a["asset_id"] for a in assets],
                format_func=lambda x: f"{next(a['name'] for a in assets if a['asset_id'] == x)} ({x})",
                key="history_asset_select",
            )
        with h_col2:
            hist_limit = st.selectbox("Sample Count:", [50, 100, 250, 500, 1000], index=1)
        with h_col3:
            st.markdown("<div style='height:28px;'></div>", unsafe_allow_html=True)
            export_df = fetch_telemetry_history(hist_aid, limit=hist_limit)
            csv_data = export_df.to_csv(index=False).encode("utf-8") if not export_df.empty else b""
            st.download_button(
                label="📥 Download CSV",
                data=csv_data,
                file_name=f"telemetry_{hist_aid}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                disabled=export_df.empty,
                use_container_width=True,
            )

        if not export_df.empty:
            st.dataframe(export_df, use_container_width=True, hide_index=True)
        else:
            st.info("No historical records found for this asset.")

    # --------------------------------------------------------------------------
    # 8.6 Alert Log (All Machines)
    # --------------------------------------------------------------------------
    st.markdown("---")
    st.markdown("### 🚨 Central Industrial Alert Log")

    alerts = fetch_recent_alerts(limit=15)

    # Trigger st.toast for NEW alerts (excluding first load to prevent flooding)
    if alerts:
        current_alert_ids = {a["id"] for a in alerts}
        if st.session_state["first_load_done"]:
            new_alert_ids = current_alert_ids - st.session_state["seen_alert_ids"]
            for a in alerts:
                if a["id"] in new_alert_ids:
                    toast_icon = "🚨" if a["severity"] == "ALARM" else "⚠️"
                    st.toast(f"{toast_icon} {a['asset_id'].upper()}: {a['message']}", icon=toast_icon)
        else:
            st.session_state["first_load_done"] = True
        st.session_state["seen_alert_ids"] = current_alert_ids

    # Acknowledge Actions Row
    ack_col1, ack_col2, ack_col3 = st.columns([2, 1, 1])
    with ack_col2:
        if st.button("✅ Acknowledge All Alerts", use_container_width=True):
            acknowledge_alerts(None)
            st.rerun()
    with ack_col3:
        if st.button(f"Acknowledge for {selected_aid}", use_container_width=True):
            acknowledge_alerts(selected_aid)
            st.rerun()

    if not alerts:
        st.success("No alerts recorded. All systems operating within normal parameters.")
    else:
        # Display Alerts Table with highlighted unacknowledged alarms
        alert_rows = []
        for a in alerts:
            ts_dt = datetime.fromtimestamp(a["ts"], tz=timezone.utc).strftime("%H:%M:%S")
            is_unack_alarm = (a["severity"] == "ALARM" and a["acknowledged"] == 0)
            status_symbol = "🔴 UNACKNOWLEDGED" if is_unack_alarm else ("⚠️ WATCH" if a["acknowledged"] == 0 else "✅ ACKNOWLEDGED")
            
            alert_rows.append(
                {
                    "Time": ts_dt,
                    "Machine": a["asset_id"],
                    "Severity": a["severity"],
                    "Fault": a["fault"],
                    "Message": a["message"],
                    "Status": status_symbol,
                }
            )

        df_alerts = pd.DataFrame(alert_rows)
        st.dataframe(df_alerts, use_container_width=True, hide_index=True)


# Execute real-time rendering fragment
render_realtime_dashboard()
