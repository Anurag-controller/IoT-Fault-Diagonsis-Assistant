"""
Industrial IoT MQTT Subscriber & Diagnostic Engine
Subscribes to topics: plant1/<asset_id>/telemetry
Evaluates incoming telemetry against fault_knowledge.json rules
Persists telemetry, automated diagnosis, and alerts to SQLite (data/plant.db in WAL mode).
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
import paho.mqtt.client as mqtt

DB_PATH = os.path.join("data", "plant.db")
KNOWLEDGE_BASE_PATH = "fault_knowledge.json"


def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.row_factory = sqlite3.Row
    return conn


def load_knowledge_base():
    if os.path.exists(KNOWLEDGE_BASE_PATH):
        with open(KNOWLEDGE_BASE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


KB = load_knowledge_base()
ISO_WATCH_RMS = KB.get("iso_10816_standard", {}).get("watch_threshold_rms", 4.5)
ISO_ALARM_RMS = KB.get("iso_10816_standard", {}).get("alarm_threshold_rms", 7.1)


def diagnose(asset_id: str, tel: dict, asset_spec: dict) -> tuple[str, int, str, str]:
    """
    Evaluates telemetry against rules loaded from fault_knowledge.json.
    Returns: (fault_key, confidence_pct, severity, alert_message)
    """
    rms = tel["rms"]
    kurt = tel["kurtosis"]
    p1 = tel["peak_1x"]
    p2 = tel["peak_2x"]
    temp = tel["temp"]
    curr = tel["current"]
    rpm = tel["rpm"]

    rated_curr = asset_spec.get("rated_current", 100.0)
    rated_rpm = asset_spec.get("rated_rpm", 1500.0)

    # 1. Overload / Impeller Jam
    if (curr / rated_curr) >= 1.15 and rpm <= (rated_rpm * 0.95):
        return ("overload_jam", 96, "ALARM", f"High current draw ({curr:.1f}A) with speed drop ({rpm:.0f}RPM)")

    # 2. Bearing Wear / Spalling
    if kurt >= 3.8 and temp >= 68.0:
        return ("bearing_wear", 92, "ALARM", f"Impulsive shock kurtosis ({kurt:.2f}) and bearing overheating ({temp:.1f}°C)")

    # 3. Unbalance (1X Dominant)
    ratio_12 = (p1 / p2) if p2 > 0.05 else 99.0
    if p1 >= 3.8 and ratio_12 >= 1.8:
        sev = "ALARM" if rms >= ISO_ALARM_RMS else "WATCH"
        return ("unbalance", 94, sev, f"Dominant 1X running frequency vibration ({p1:.2f} mm/s, ratio {ratio_12:.1f})")

    # 4. Misalignment (2X Dominant)
    ratio_21 = (p2 / p1) if p1 > 0.05 else 0.0
    if p2 >= 2.8 and ratio_21 >= 0.8:
        sev = "ALARM" if rms >= ISO_ALARM_RMS else "WATCH"
        return ("misalignment", 90, sev, f"High 2X harmonic coupling vibration ({p2:.2f} mm/s, 2X/1X {ratio_21:.2f})")

    # 5. General ISO 10816 Vibration Alert
    if rms >= ISO_ALARM_RMS:
        return ("unbalance", 85, "ALARM", f"Overall vibration RMS ({rms:.2f} mm/s) crossed ISO 10816 Zone D Alarm limit")
    elif rms >= ISO_WATCH_RMS:
        return ("unbalance", 75, "WATCH", f"Overall vibration RMS ({rms:.2f} mm/s) entered ISO 10816 Zone C Watch zone")

    return ("healthy", 98, "OK", "Machine operating within nominal ISO tolerances")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
        asset_id = payload.get("asset_id")
        ts = payload.get("ts", time.time())
        rms = float(payload.get("rms", 0.0))
        kurtosis = float(payload.get("kurtosis", 3.0))
        peak_1x = float(payload.get("peak_1x", 0.0))
        peak_2x = float(payload.get("peak_2x", 0.0))
        temp = float(payload.get("temp", 25.0))
        current = float(payload.get("current", 0.0))
        rpm = float(payload.get("rpm", 1500.0))

        with get_db() as conn:
            cursor = conn.cursor()
            # 1. Store telemetry
            cursor.execute(
                """
                INSERT INTO telemetry (ts, asset_id, rms, kurtosis, peak_1x, peak_2x, temp, current, rpm)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (ts, asset_id, rms, kurtosis, peak_1x, peak_2x, temp, current, rpm),
            )

            # Get asset specification
            cursor.execute("SELECT rated_rpm, rated_current FROM assets WHERE asset_id = ?", (asset_id,))
            row = cursor.fetchone()
            asset_spec = dict(row) if row else {"rated_rpm": 1500.0, "rated_current": 100.0}

            # 2. Perform automated diagnosis
            fault, conf, sev, alert_msg = diagnose(asset_id, payload, asset_spec)
            cursor.execute(
                """
                INSERT INTO diagnosis (ts, asset_id, fault, confidence, severity)
                VALUES (?, ?, ?, ?, ?)
                """,
                (ts, asset_id, fault, conf, sev),
            )

            # 3. Log alert if severity is WATCH or ALARM
            if sev in ["WATCH", "ALARM"]:
                cursor.execute(
                    """
                    INSERT INTO alerts (ts, asset_id, fault, severity, message, acknowledged)
                    VALUES (?, ?, ?, ?, ?, 0)
                    """,
                    (ts, asset_id, fault, sev, alert_msg),
                )

            conn.commit()
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Telemetry processed for {asset_id}: RMS={rms:.2f}mm/s, State={sev}")

    except Exception as e:
        print(f"Error processing MQTT message: {e}")


def main():
    broker = os.environ.get("MQTT_BROKER", "localhost")
    port = int(os.environ.get("MQTT_PORT", 1883))
    print(f"Starting IoT Subscriber connecting to {broker}:{port}...")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "IoT_Diagnostic_Subscriber")
    client.on_message = on_message

    try:
        client.connect(broker, port, 60)
        client.subscribe("plant1/+/telemetry")
        print("Subscribed to plant1/+/telemetry. Listening...")
        client.loop_forever()
    except Exception as e:
        print(f"MQTT Broker connection failed ({e}). Check if Mosquitto is running or use simulator direct mode.")


if __name__ == "__main__":
    main()
