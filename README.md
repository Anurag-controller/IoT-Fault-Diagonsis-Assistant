# Knowledge-Driven IoT Fault Diagnosis Assistant for Industrial Motors (Simulation-Based)
## 3rd-Year IoT Mini Project

A complete, production-grade condition monitoring and explainable predictive maintenance dashboard for industrial electric motors and pumps. Built with **Streamlit (>= 1.37)**, **SQLite (WAL mode)**, **Plotly**, and **MQTT**.

---

## ⚡ Quick Start: Exact Run Commands

### 1. Install Dependencies
Open your terminal in the project directory:
```bash
pip install -r requirements.txt
```

### 2. Start the Telemetry Simulator
The simulator generates live physics-based telemetry (RMS, harmonics 1X/2X, kurtosis, temperature, current, RPM) and automated diagnostics for **motor01**, **motor02**, and **pump03**:
```bash
python simulator.py
```
*(Optionally, if using an external MQTT broker like Mosquitto, run `python subscriber.py` alongside your MQTT publisher)*.

### 3. Launch the Streamlit Dashboard
In a second terminal window:
```bash
streamlit run dashboard.py
```
The dashboard will open automatically in your browser at `http://localhost:8501`.

---

## 🏗️ System Architecture

```
[ IoT Simulator / Real Sensors ]
            │
            ▼ (MQTT Topic: plant1/<asset_id>/telemetry)
[ MQTT Subscriber / Diagnostic Engine ]
            │
            ▼ (WAL Mode SQLite Writes)
    ┌─────────────────┐
    │  data/plant.db  │ ◄─── assets, telemetry, diagnosis, alerts
    └─────────────────┘
            │
            ▲ (Concurrent WAL Reads with @st.fragment)
[ Streamlit Real-Time Dashboard (dashboard.py) ]
            │
            ├── ISO 10816-3 Threshold Engine (fault_knowledge.json)
            ├── Real-time Plotly FFT Harmonic & Vibration Curves
            ├── Explainable Diagnostic Evidence Matrix (PASS / FIRED)
            └── Linear Polynomial Trend Estimator (Time-to-Alarm)
```

---

## 📂 Project Files

| File | Description |
|---|---|
| `dashboard.py` | Complete single-file Streamlit monitoring dashboard with real-time `@st.fragment` sub-second updates, Plotly graphs, alert toasts, and explainable AI matrix. |
| `fault_knowledge.json` | Dynamic expert knowledge base containing ISO 10816-3 thresholds, fault symptoms, root causes, rules, and maintenance recommendations. |
| `simulator.py` | Realistic physical sensor simulator producing harmonic frequencies, kurtosis spikes, and dynamic fault injection. |
| `subscriber.py` | MQTT subscriber that consumes MQTT telemetry topics and executes rule-based diagnosis into SQLite. |
| `requirements.txt` | Python package dependencies (`streamlit`, `pandas`, `plotly`, `numpy`, `paho-mqtt`). |

---

## 🔬 Domain Knowledge & Viva Preparation

### 1. What is ISO 10816-3?
ISO 10816-3 is the international standard for evaluating mechanical vibration severity of industrial machines (15 kW to 300 kW):
- **Zone A/B (Green / OK)**: RMS `< 4.5 mm/s` (Newly commissioned and unrestricted continuous operation)
- **Zone C (Amber / WATCH)**: `4.5 mm/s <= RMS < 7.1 mm/s` (Restricted operation; plan maintenance)
- **Zone D (Red / ALARM)**: `RMS >= 7.1 mm/s` (Dangerous vibration; immediate shutdown recommended)

### 2. How are faults distinguished?
- **Rotor Dynamic Unbalance**: Characterized by a dominant **1X running speed harmonic** (`peak_1x >= 3.8 mm/s` and `1X / 2X >= 1.8`).
- **Shaft Misalignment**: Characterized by a high **2X rotational harmonic** (`peak_2x >= 2.8 mm/s` and `2X / 1X >= 0.8`), along with elevated coupling temperatures.
- **Bearing Wear (Spalling)**: Characterized by impulsive **Kurtosis > 3.8** (high fourth standardized moment indicating shock spikes from bearing raceway pitting) and bearing housing heating (`> 70 °C`).
- **Mechanical Overload / Jam**: Stator current rises beyond **115% of rated current**, accompanied by a drop in rotor RPM (excessive motor slip).

### 3. Why SQLite with WAL Mode?
SQLite in `WAL` (Write-Ahead Logging) mode allows concurrent reads and writes. The background subscriber/simulator writes telemetry continuously while Streamlit reads concurrently without database lock errors (`database is locked`).

### 4. How does the Explainability Matrix work?
Unlike "black-box" machine learning, this system uses forward-chaining expert rules loaded from `fault_knowledge.json`. Every telemetry sample is matched against specific thresholds, producing an **Evidence Table** (Rule, Metric, Live Reading, Threshold, `PASS` vs `FIRED`) so plant engineers understand *why* an alert was generated.
