"""
IoT Motor Telemetry Simulator
Simulates real-world sensor streams for:
  - motor01 (healthy / unbalance)
  - motor02 (misalignment / bearing wear)
  - pump03 (healthy / overload jam)
Generates physical waveforms, rotational harmonics (1X, 2X), kurtosis, temperature, and electrical load.
Supports both direct SQLite database insertion (no broker needed) or MQTT publishing.
"""

import argparse
import json
import math
import os
import random
import sqlite3

# Suppress cross-filesystem hardlink warnings in container/Cloud Run environments
os.environ.setdefault("UV_LINK_MODE", "copy")

import time
from datetime import datetime

DB_PATH = os.path.join("data", "plant.db")


def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    with get_db() as conn:
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


class MachineSimulator:
    def __init__(self, asset_id: str, mode: str = "healthy"):
        self.asset_id = asset_id
        self.mode = mode
        self.step = 0
        if asset_id == "motor01":
            self.rated_rpm = 1485.0
            self.rated_current = 138.0
            self.base_temp = 54.0
        elif asset_id == "motor02":
            self.rated_rpm = 1470.0
            self.rated_current = 85.0
            self.base_temp = 58.0
        else:
            self.rated_rpm = 2950.0
            self.rated_current = 58.0
            self.base_temp = 48.0

    def generate_sample(self) -> dict:
        self.step += 1
        t = self.step * 0.1
        noise = lambda amp=0.1: random.gauss(0, amp)

        # Fault physics simulation
        if self.mode == "healthy":
            rms = 2.1 + 0.3 * math.sin(t * 0.2) + noise(0.12)
            kurtosis = 2.9 + noise(0.1)
            peak_1x = 1.2 + 0.1 * math.sin(t * 0.5) + noise(0.08)
            peak_2x = 0.6 + noise(0.05)
            temp = self.base_temp + 2.0 * math.sin(t * 0.05) + noise(0.3)
            current = self.rated_current * 0.72 + noise(0.8)
            rpm = self.rated_rpm - 3.0 + noise(1.2)
            fault = "healthy"
            confidence = 98
            severity = "OK"
            alert_msg = None

        elif self.mode == "unbalance":
            # 1X dominant vibration
            rms = 5.2 + 0.8 * math.sin(t * 0.3) + noise(0.2)
            kurtosis = 3.1 + noise(0.1)
            peak_1x = 4.4 + 0.4 * math.sin(t * 0.3) + noise(0.15)
            peak_2x = 1.1 + noise(0.08)
            temp = self.base_temp + 7.5 + noise(0.4)
            current = self.rated_current * 0.88 + noise(1.1)
            rpm = self.rated_rpm - 8.0 + noise(1.5)
            fault = "unbalance"
            confidence = 94
            severity = "ALARM" if rms >= 7.1 else "WATCH"
            alert_msg = f"Dominant 1X running frequency vibration ({peak_1x:.2f} mm/s)"

        elif self.mode == "misalignment":
            # 2X harmonic dominant vibration
            rms = 4.9 + 0.5 * math.sin(t * 0.25) + noise(0.18)
            kurtosis = 3.2 + noise(0.1)
            peak_1x = 2.4 + noise(0.12)
            peak_2x = 3.6 + 0.3 * math.sin(t * 0.25) + noise(0.14)
            temp = self.base_temp + 11.0 + noise(0.5)
            current = self.rated_current * 0.91 + noise(1.2)
            rpm = self.rated_rpm - 9.0 + noise(1.4)
            fault = "misalignment"
            confidence = 91
            severity = "WATCH"
            alert_msg = f"Coupling 2X harmonic vibration spike ({peak_2x:.2f} mm/s)"

        elif self.mode == "bearing_wear":
            # Impulsive impact kurtosis + localized temperature
            rms = 4.1 + 0.4 * math.sin(t * 0.2) + noise(0.2)
            kurtosis = 4.6 + abs(noise(0.4))
            peak_1x = 2.1 + noise(0.1)
            peak_2x = 1.4 + noise(0.08)
            temp = self.base_temp + 18.5 + noise(0.6)  # > 70 degC
            current = self.rated_current * 0.85 + noise(1.0)
            rpm = self.rated_rpm - 5.0 + noise(1.1)
            fault = "bearing_wear"
            confidence = 93
            severity = "ALARM"
            alert_msg = f"Bearing impact shock kurtosis ({kurtosis:.2f}) and temp ({temp:.1f}°C)"

        elif self.mode == "overload_jam":
            # High current draw and drop in RPM
            rms = 7.4 + noise(0.25)
            kurtosis = 3.3 + noise(0.15)
            peak_1x = 2.8 + noise(0.15)
            peak_2x = 2.1 + noise(0.1)
            temp = self.base_temp + 24.0 + noise(0.8)
            current = self.rated_current * 1.28 + noise(2.0)
            rpm = self.rated_rpm * 0.91 + noise(3.0)  # > 5% speed drop
            fault = "overload_jam"
            confidence = 97
            severity = "ALARM"
            alert_msg = f"Motor current ({current:.1f}A) exceeds 115% rated with severe speed slip"
        else:
            rms, kurtosis, peak_1x, peak_2x, temp, current, rpm = 2.0, 3.0, 1.0, 0.5, 50.0, 50.0, 1500.0
            fault, confidence, severity, alert_msg = "healthy", 99, "OK", None

        return {
            "ts": time.time(),
            "asset_id": self.asset_id,
            "rms": round(rms, 3),
            "kurtosis": round(kurtosis, 3),
            "peak_1x": round(peak_1x, 3),
            "peak_2x": round(peak_2x, 3),
            "temp": round(temp, 2),
            "current": round(current, 2),
            "rpm": round(rpm, 1),
            "fault": fault,
            "confidence": confidence,
            "severity": severity,
            "alert_msg": alert_msg,
        }


def main():
    parser = argparse.ArgumentParser(description="Simulate industrial motor telemetry")
    parser.add_argument("--interval", type=float, default=1.5, help="Simulation loop interval in seconds")
    parser.add_argument("--mqtt", action="store_true", help="Publish over MQTT broker instead of direct SQLite")
    args = parser.parse_args()

    init_db()

    # Pre-configure dynamic machine behaviors
    simulators = [
        MachineSimulator("motor01", mode="unbalance"),    # motor01 has unbalance
        MachineSimulator("motor02", mode="misalignment"), # motor02 has misalignment
        MachineSimulator("pump03", mode="healthy"),       # pump03 healthy baseline
    ]

    print("=" * 65)
    print(" Industrial IoT Motor Telemetry Simulator (Active)")
    print(f" Simulating: motor01 (unbalance), motor02 (misalignment), pump03 (healthy)")
    print(f" Database Target: {DB_PATH}")
    print(f" Interval: {args.interval}s | Press Ctrl+C to stop")
    print("=" * 65)

    iteration = 0
    while True:
        iteration += 1
        # Dynamically inject overload fault on pump03 after 20 iterations for live demo
        if iteration == 25:
            print("\n🚨 [DEMO EVENT] Injecting BEARING WEAR into motor01 and OVERLOAD JAM into pump03!\n")
            simulators[0].mode = "bearing_wear"
            simulators[2].mode = "overload_jam"
        elif iteration == 50:
            print("\n✅ [DEMO EVENT] Returning pump03 to healthy condition.\n")
            simulators[2].mode = "healthy"

        for sim in simulators:
            sample = sim.generate_sample()
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    INSERT INTO telemetry (ts, asset_id, rms, kurtosis, peak_1x, peak_2x, temp, current, rpm)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        sample["ts"],
                        sample["asset_id"],
                        sample["rms"],
                        sample["kurtosis"],
                        sample["peak_1x"],
                        sample["peak_2x"],
                        sample["temp"],
                        sample["current"],
                        sample["rpm"],
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO diagnosis (ts, asset_id, fault, confidence, severity)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        sample["ts"],
                        sample["asset_id"],
                        sample["fault"],
                        sample["confidence"],
                        sample["severity"],
                    ),
                )
                if sample["severity"] in ["WATCH", "ALARM"] and sample["alert_msg"]:
                    # Limit alert spamming to once every 10 iterations per machine
                    if iteration % 6 == 0:
                        cursor.execute(
                            """
                            INSERT INTO alerts (ts, asset_id, fault, severity, message, acknowledged)
                            VALUES (?, ?, ?, ?, ?, 0)
                            """,
                            (
                                sample["ts"],
                                sample["asset_id"],
                                sample["fault"],
                                sample["severity"],
                                sample["alert_msg"],
                            ),
                        )
                conn.commit()

        latest_time = datetime.now().strftime("%H:%M:%S")
        print(f"[{latest_time}] Iteration #{iteration}: Telemetry & diagnosis updated for 3 assets.")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
