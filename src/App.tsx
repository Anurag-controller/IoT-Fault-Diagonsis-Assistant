import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  Flame,
  HelpCircle,
  Layers,
  Mail,
  MoreVertical,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Sliders,
  Square,
  TrendingUp,
  Wifi,
  X,
  Zap
} from 'lucide-react';

// --- COLOR TOKENS ---
// Deep Forest Green: #1F7A4D
// Sage Green: #6FAE8C
// Soft Lavender: #C9B6F2 / #B8A4E3
// Deep Purple: #7C5CBF
// Text Headings: #2E2740
// Text Muted: #8B849C
// Card Background: #FFFFFF
// Page Background: #F8F7FC

interface SensorItem {
  id: string;
  name: string;
  model: string;
  type: string;
  status: 'healthy' | 'watch' | 'alarm'; // healthy=sage, watch=lavender, alarm=deep purple
  value: string;
  note: string;
}

interface FaultHistoryItem {
  id: string;
  fault: string;
  machine: string;
  description: string;
  timeAgo: string;
  status: 'Resolved' | 'In Progress' | 'Pending';
  statusType: 'healthy' | 'watch' | 'alarm';
  iconType: 'unbalance' | 'misalignment' | 'bearing' | 'jam' | 'healthy' | 'looseness';
}

export default function App() {
  // Navigation State
  const [activeMenu, setActiveMenu] = useState<string>('Dashboard');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Live Monitoring Counter & State
  const [isLiveRunning, setIsLiveRunning] = useState<boolean>(true);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(16094); // ~04h 28m 14s
  const [liveRms, setLiveRms] = useState<number>(3.84);
  const [liveTemp, setLiveTemp] = useState<number>(64.2);

  // Chart View Toggle
  const [chartMetric, setChartMetric] = useState<'rms' | 'temp'>('rms');
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  // Machine Diagram Schematic State
  // Sequence: Motor -> Bearing A -> Coupling -> Bearing B -> Rotor
  const [diagramViewMode, setDiagramViewMode] = useState<'3d' | '2d'>('3d');
  const [schematicActivePart, setSchematicActivePart] = useState<'motor' | 'bearingA' | 'coupling' | 'bearingB' | 'rotor' | 'none'>('bearingB');
  const [schematicSeverity, setSchematicSeverity] = useState<'watch' | 'alarm' | 'healthy'>('alarm');
  const [schematicFaultLabel, setSchematicFaultLabel] = useState<string>('Bearing Wear - 88% (Housing B)');

  const handleSelectSchematicFault = (
    part: 'motor' | 'bearingA' | 'coupling' | 'bearingB' | 'rotor' | 'none',
    severity: 'watch' | 'alarm' | 'healthy',
    label: string
  ) => {
    setSchematicActivePart(part);
    setSchematicSeverity(severity);
    setSchematicFaultLabel(label);
    if (severity === 'healthy') {
      triggerToast('Machine State: Healthy Baseline (All components nominal)');
    } else {
      triggerToast(`Fault isolated to ${part.toUpperCase()}: ${label}`);
    }
  };

  // Modals
  const [showNewReadingModal, setShowNewReadingModal] = useState<boolean>(false);
  const [showDiagnosisModal, setShowDiagnosisModal] = useState<boolean>(false);
  const [showEsp32Modal, setShowEsp32Modal] = useState<boolean>(false);
  const [showAddSensorModal, setShowAddSensorModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Ticking live timer & simulated sensor fluctuation
  useEffect(() => {
    if (!isLiveRunning) return;

    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);

      // Gentle realistic sensor fluctuation
      setLiveRms((prev) => {
        const delta = (Math.random() - 0.48) * 0.08;
        return Number(Math.max(2.1, Math.min(6.9, prev + delta)).toFixed(2));
      });

      setLiveTemp((prev) => {
        const delta = (Math.random() - 0.49) * 0.12;
        return Number(Math.max(55.0, Math.min(78.5, prev + delta)).toFixed(1));
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLiveRunning]);

  // Format Elapsed Seconds to HHh MMm SSs
  const formattedElapsedTime = useMemo(() => {
    const hrs = Math.floor(elapsedSeconds / 3600);
    const mins = Math.floor((elapsedSeconds % 3600) / 60);
    const secs = elapsedSeconds % 60;
    return `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }, [elapsedSeconds]);

  // Toast helper
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Static Sensor Status Data
  const sensors: SensorItem[] = [
    {
      id: 'sen-1',
      name: 'Vibration Sensor',
      model: 'ADXL345 3-Axis',
      type: 'Piezo/MEMS',
      status: 'watch',
      value: `${liveRms} mm/s`,
      note: 'ISO Zone C Watch threshold',
    },
    {
      id: 'sen-2',
      name: 'Temp Sensor',
      model: 'DS18B20 1-Wire',
      type: 'Thermal Probe',
      status: 'healthy',
      value: `${liveTemp} °C`,
      note: 'Bearing housing nominal',
    },
    {
      id: 'sen-3',
      name: 'Current Sensor',
      model: 'ACS712 Hall-Effect',
      type: 'Hall Current',
      status: 'healthy',
      value: '42.8 A',
      note: '74% of full load rating',
    },
    {
      id: 'sen-4',
      name: 'RPM Optical Sensor',
      model: 'TCRT5000 IR Tach',
      type: 'Optical Speed',
      status: 'alarm',
      value: 'Offline',
      note: 'Signal timeout > 15s',
    },
  ];

  // Fault History List Data
  const faultHistory: FaultHistoryItem[] = [
    {
      id: 'fh-1',
      fault: 'Rotor Dynamic Unbalance',
      machine: 'Primary Feed Motor 01',
      description: 'Dominant 1X running frequency spike (4.8 mm/s radial)',
      timeAgo: '14 mins ago',
      status: 'In Progress',
      statusType: 'watch',
      iconType: 'unbalance',
    },
    {
      id: 'fh-2',
      fault: 'Shaft Misalignment',
      machine: 'Slurry Agitator Motor 02',
      description: 'High 2X harmonic coupling vibration (3.6 mm/s)',
      timeAgo: '2 hrs ago',
      status: 'Resolved',
      statusType: 'healthy',
      iconType: 'misalignment',
    },
    {
      id: 'fh-3',
      fault: 'Bearing Raceway Wear',
      machine: 'Chilled Water Pump 03',
      description: 'Impulsive shock kurtosis (4.2) & thermal elevation',
      timeAgo: 'Yesterday',
      status: 'Pending',
      statusType: 'alarm',
      iconType: 'bearing',
    },
    {
      id: 'fh-4',
      fault: 'Mechanical Looseness',
      machine: 'Cooling Tower Fan 01',
      description: 'Sub-synchronous 0.5X harmonics on baseplate foundation',
      timeAgo: '2 days ago',
      status: 'Resolved',
      statusType: 'healthy',
      iconType: 'looseness',
    },
  ];

  // Chart Time Series Data (7 intervals over 24h)
  const chartPoints = [
    { time: '00:00', rms: 2.3, temp: 58.2, label: '00:00' },
    { time: '04:00', rms: 2.5, temp: 59.5, label: '04:00' },
    { time: '08:00', rms: 3.1, temp: 61.8, label: '08:00' },
    { time: '12:00', rms: 4.8, temp: 67.4, label: '12:00' },
    { time: '16:00', rms: 4.2, temp: 65.1, label: '16:00' },
    { time: '20:00', rms: 3.9, temp: 63.7, label: '20:00' },
    { time: 'Now', rms: liveRms, temp: liveTemp, label: 'Live' },
  ];

  // SVG Chart Dimensions & Calculations
  const svgWidth = 560;
  const svgHeight = 220;
  const paddingX = 40;
  const paddingY = 25;

  const currentValues = chartMetric === 'rms' ? chartPoints.map((p) => p.rms) : chartPoints.map((p) => p.temp);
  const minVal = chartMetric === 'rms' ? 1.5 : 50;
  const maxVal = chartMetric === 'rms' ? 6.5 : 75;

  const coordinates = chartPoints.map((point, index) => {
    const val = chartMetric === 'rms' ? point.rms : point.temp;
    const x = paddingX + (index / (chartPoints.length - 1)) * (svgWidth - paddingX * 2);
    const y = svgHeight - paddingY - ((val - minVal) / (maxVal - minVal)) * (svgHeight - paddingY * 2);
    return { x, y, point };
  });

  const pathD = coordinates.reduce((acc, curr, idx, arr) => {
    if (idx === 0) return `M ${curr.x},${curr.y}`;
    const prev = arr[idx - 1];
    const cp1x = prev.x + (curr.x - prev.x) / 2;
    const cp1y = prev.y;
    const cp2x = prev.x + (curr.x - prev.x) / 2;
    const cp2y = curr.y;
    return `${acc} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${curr.x},${curr.y}`;
  }, '');

  const areaD = `${pathD} L ${coordinates[coordinates.length - 1].x},${svgHeight - paddingY} L ${coordinates[0].x},${svgHeight - paddingY} Z`;

  // Helper to compute visual styles and heartbeat pulse animation per schematic part
  const getPartVisualProps = (part: 'motor' | 'bearingA' | 'coupling' | 'bearingB' | 'rotor') => {
    const isTarget = schematicActivePart === part;
    if (!isTarget || schematicSeverity === 'healthy') {
      return {
        fill: '#EDE8F5',
        stroke: '#C9B6F2',
        strokeWidth: 2,
        className: 'transition-all duration-300 cursor-pointer hover:opacity-80',
        isPulsing: false,
      };
    }

    if (schematicSeverity === 'watch') {
      return {
        fill: 'rgba(59, 130, 246, 0.3)',
        stroke: '#3B82F6',
        strokeWidth: 2.5,
        className: 'schematic-pulse-watch cursor-pointer',
        isPulsing: true,
      };
    }

    // alarm severity: red-red heartbeat pulse
    return {
      fill: 'rgba(239, 68, 68, 0.35)',
      stroke: '#EF4444',
      strokeWidth: 3,
      className: 'schematic-pulse-alarm cursor-pointer',
      isPulsing: true,
    };
  };

  return (
    <div className="min-h-screen bg-[#F8F7FC] text-[#2E2740] flex font-sans selection:bg-[#C9B6F2]/30">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-[#2E2740] text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2.5 text-sm border border-[#7C5CBF]/40 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="w-2 h-2 rounded-full bg-[#6FAE8C] animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* LEFT SIDEBAR (~220px, light background) */}
      {/* ==================================================================== */}
      <aside className="w-[230px] shrink-0 bg-white border-r border-[#EDE8F5] flex flex-col justify-between p-4 sticky top-0 h-screen z-30">
        <div>
          {/* Logo & App Name */}
          <div className="flex items-center gap-2.5 px-3 py-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-gradient-brand flex items-center justify-center text-white shadow-md shadow-[#7C5CBF]/20">
              <Zap className="w-5 h-5 fill-white/20 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight text-[#2E2740] flex items-center gap-1">
                Fault<span className="text-[#1F7A4D]">Sense</span>
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#8B849C]">
                IoT Assistant
              </span>
            </div>
          </div>

          {/* MENU SECTION */}
          <div className="mb-6">
            <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-[#8B849C] mb-2">
              Menu
            </div>
            <nav className="space-y-1">
              {[
                { name: 'Dashboard', icon: Layers },
                { name: 'Readings', icon: Activity },
                { name: 'Fault Log', icon: ShieldAlert },
                { name: 'Knowledge Base', icon: Cpu },
                { name: 'Settings', icon: Settings },
              ].map((item) => {
                const Icon = item.icon;
                const isActive = activeMenu === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => {
                      setActiveMenu(item.name);
                      if (item.name !== 'Dashboard') {
                        triggerToast(`Switched view to ${item.name}`);
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative ${
                      isActive
                        ? 'text-[#2E2740] bg-[#F4F1FA] font-semibold'
                        : 'text-[#8B849C] hover:text-[#2E2740] hover:bg-[#FAF9FD]'
                    }`}
                  >
                    {/* Gradient left-accent bar for active menu item */}
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r-full bg-gradient-brand" />
                    )}
                    <Icon
                      className={`w-4 h-4 ${
                        isActive ? 'text-[#7C5CBF]' : 'text-[#8B849C]'
                      }`}
                    />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* GENERAL SECTION */}
          <div>
            <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-[#8B849C] mb-2">
              General
            </div>
            <nav className="space-y-1">
              <button
                onClick={() => {
                  setActiveMenu('Alerts');
                  triggerToast('3 Active alerts in system');
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeMenu === 'Alerts'
                    ? 'text-[#2E2740] bg-[#F4F1FA] font-semibold'
                    : 'text-[#8B849C] hover:text-[#2E2740] hover:bg-[#FAF9FD]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-[#8B849C]" />
                  <span>Alerts</span>
                </div>
                <span className="w-5 h-5 rounded-full bg-[#7C5CBF] text-white text-[10px] font-bold flex items-center justify-center">
                  3
                </span>
              </button>

              <button
                onClick={() => triggerToast('Opening documentation & help center')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-[#8B849C] hover:text-[#2E2740] hover:bg-[#FAF9FD] transition-all"
              >
                <HelpCircle className="w-4 h-4 text-[#8B849C]" />
                <span>Help & Guides</span>
              </button>
            </nav>
          </div>
        </div>

        {/* PROMOTIONAL CARD PINNED NEAR BOTTOM */}
        <div className="rounded-2xl p-4 bg-gradient-to-br from-[#F4F9F6] via-[#F8F5FE] to-[#F1EDFB] border border-[#EDE8F5] relative overflow-hidden mt-4">
          <div className="w-8 h-8 rounded-lg bg-white shadow-sm flex items-center justify-center text-[#1F7A4D] mb-2.5">
            <Wifi className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-bold text-[#2E2740] leading-snug">
            Connect your ESP32
          </h4>
          <p className="text-[11px] text-[#8B849C] mt-1 leading-normal mb-3">
            Stream high-rate accelerometer and temp telemetry via MQTT.
          </p>
          <button
            onClick={() => setShowEsp32Modal(true)}
            className="w-full py-2 px-3 rounded-xl bg-gradient-brand text-white font-semibold text-xs shadow-md shadow-[#7C5CBF]/15 hover:opacity-95 transition-all flex items-center justify-center gap-1.5"
          >
            <span>Setup Device</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* MAIN CONTAINER */}
      {/* ==================================================================== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* TOP BAR */}
        <header className="h-18 px-8 bg-white border-b border-[#EDE8F5] flex items-center justify-between sticky top-0 z-20">
          {/* Search Bar on Left */}
          <div className="relative w-80">
            <Search className="w-4 h-4 text-[#8B849C] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search fault, sensor, log..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl pl-10 pr-4 py-2 text-xs text-[#2E2740] placeholder-[#8B849C] focus:outline-none focus:border-[#7C5CBF] focus:ring-2 focus:ring-[#C9B6F2]/30 transition"
            />
          </div>

          {/* Right Action Icons & User Avatar */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => triggerToast('No new unread messages')}
              className="w-9 h-9 rounded-xl border border-[#EDE8F5] flex items-center justify-center text-[#8B849C] hover:text-[#2E2740] hover:bg-[#F8F7FC] transition"
            >
              <Mail className="w-4 h-4" />
            </button>

            <button
              onClick={() => triggerToast('You have 3 active motor alerts')}
              className="w-9 h-9 rounded-xl border border-[#EDE8F5] flex items-center justify-center text-[#8B849C] hover:text-[#2E2740] hover:bg-[#F8F7FC] transition relative"
            >
              <Bell className="w-4 h-4" />
              <span className="w-2 h-2 rounded-full bg-[#7C5CBF] absolute top-2 right-2 border-2 border-white" />
            </button>

            <div className="h-6 w-[1px] bg-[#EDE8F5]" />

            {/* Industrial Plant Gateway Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F4F9F6] border border-[#1F7A4D]/25 text-[11px] font-semibold text-[#1F7A4D]">
              <span className="w-2 h-2 rounded-full bg-[#1F7A4D] animate-pulse" />
              <span>Gateway Online</span>
            </div>
          </div>
        </header>

        {/* PAGE CONTENT */}
        <main className="p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* PAGE HEADER */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-[#2E2740]">
                Dashboard
              </h2>
              <p className="text-xs text-[#8B849C] mt-1">
                Monitor machine health and diagnose faults in real time
              </p>
            </div>

            {/* Pill-Shaped Buttons on Top-Right */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowExportModal(true)}
                className="px-4 py-2 rounded-full border border-[#EDE8F5] bg-white text-xs font-semibold text-[#2E2740] hover:bg-[#FAF9FD] hover:border-[#7C5CBF]/40 shadow-sm transition-all flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#8B849C]" />
                <span>Export Report</span>
              </button>

              <button
                onClick={() => setShowNewReadingModal(true)}
                className="px-5 py-2 rounded-full bg-gradient-brand text-white text-xs font-semibold shadow-md shadow-[#7C5CBF]/20 hover:opacity-95 transition-all flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ New Reading</span>
              </button>
            </div>
          </div>

          {/* ================================================================ */}
          {/* ROW OF 4 STAT CARDS (rounded-2xl, soft shadow) */}
          {/* ================================================================ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: Total Readings */}
            <div className="bg-white rounded-2xl p-5 card-shadow card-shadow-hover border border-[#EDE8F5]/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8B849C]">
                  Total Readings
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#F4F9F6] text-[#1F7A4D] flex items-center justify-center">
                  <Activity className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-4">
                <div className="text-2xl font-extrabold text-[#2E2740] tracking-tight">
                  128,490
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#F4F9F6] text-[#1F7A4D] border border-[#1F7A4D]/20 flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" /> +12% today
                  </span>
                  <span className="text-[11px] text-[#8B849C]">vs yesterday</span>
                </div>
              </div>
            </div>

            {/* Card 2: Faults Detected */}
            <div className="bg-white rounded-2xl p-5 card-shadow card-shadow-hover border border-[#EDE8F5]/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8B849C]">
                  Faults Detected
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#F8F5FE] text-[#7C5CBF] flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-4">
                <div className="text-2xl font-extrabold text-[#2E2740] tracking-tight">
                  14
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#F8F5FE] text-[#7C5CBF] border border-[#7C5CBF]/20">
                    -3 vs last week
                  </span>
                  <span className="text-[11px] text-[#8B849C]">2 unresolved</span>
                </div>
              </div>
            </div>

            {/* Card 3: Healthy Uptime */}
            <div className="bg-white rounded-2xl p-5 card-shadow card-shadow-hover border border-[#EDE8F5]/80 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8B849C]">
                  Healthy Uptime
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#F4F9F6] text-[#6FAE8C] flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-4">
                <div className="text-2xl font-extrabold text-[#2E2740] tracking-tight">
                  94.8%
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#F4F9F6] text-[#6FAE8C] border border-[#6FAE8C]/20 flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" /> +0.4%
                  </span>
                  <span className="text-[11px] text-[#8B849C]">ISO 10816 Zone A</span>
                </div>
              </div>
            </div>

            {/* Card 4: Active Alerts (Visual Anchor, Solid Gradient Card) */}
            <div className="rounded-2xl p-5 bg-gradient-brand text-white card-shadow card-shadow-hover relative overflow-hidden flex flex-col justify-between">
              {/* Subtle background decorative shapes */}
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full bg-white/10 blur-xl pointer-events-none" />
              <div className="flex items-center justify-between relative z-10">
                <span className="text-xs font-semibold text-white/80">
                  Active Alerts
                </span>
                <span className="w-8 h-8 rounded-xl bg-white/20 backdrop-blur-sm text-white flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-4 relative z-10">
                <div className="text-2xl font-extrabold text-white tracking-tight flex items-baseline gap-2">
                  <span>3</span>
                  <span className="text-xs font-normal text-white/80">Immediate Action</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-sm border border-white/20">
                    2 Watch &bull; 1 Alarm
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ================================================================ */}
          {/* 3D ISOMETRIC MACHINE DIAGRAM PANEL */}
          {/* Motor -> Shaft & Coupling -> Bearing A -> Bearing B -> Rotor */}
          {/* ================================================================ */}
          <div className="bg-white rounded-2xl p-6 card-shadow border border-[#EDE8F5]/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#F8F5FE] text-[#7C5CBF] flex items-center justify-center shadow-xs">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#2E2740]">
                      3D Isometric Machine Diagram
                    </h3>
                    <span
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border transition-all ${
                        schematicSeverity === 'alarm'
                          ? 'bg-[#F8F5FE] text-[#7C5CBF] border-[#7C5CBF]/30'
                          : schematicSeverity === 'watch'
                          ? 'bg-[#FAF8FE] text-[#B8A4E3] border-[#B8A4E3]/30'
                          : 'bg-[#F4F9F6] text-[#1F7A4D] border-[#1F7A4D]/25'
                      }`}
                    >
                      {schematicSeverity === 'healthy'
                        ? 'HEALTHY (NO ANOMALIES)'
                        : `${schematicSeverity.toUpperCase()}: ${schematicActivePart.toUpperCase()}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8B849C] mt-0.5">
                    Industrial rotating train digital twin in soft isometric 3D product render
                  </p>
                </div>
              </div>

              {/* View Switcher & Fault Simulator */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 3D vs 2D Mode Switch */}
                <div className="flex bg-[#F8F7FC] border border-[#EDE8F5] p-1 rounded-xl text-[11px]">
                  <button
                    onClick={() => setDiagramViewMode('3d')}
                    className={`px-3 py-1 rounded-lg font-semibold transition ${
                      diagramViewMode === '3d'
                        ? 'bg-white text-[#7C5CBF] shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    🧊 3D Isometric View
                  </button>
                  <button
                    onClick={() => setDiagramViewMode('2d')}
                    className={`px-3 py-1 rounded-lg font-semibold transition ${
                      diagramViewMode === '2d'
                        ? 'bg-white text-[#7C5CBF] shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    📐 2D Flow Schematic
                  </button>
                </div>

                {/* Fault Isolate Switcher */}
                <div className="flex flex-wrap items-center gap-1.5 bg-[#F8F7FC] border border-[#EDE8F5] p-1 rounded-xl text-[11px]">
                  <span className="text-[#8B849C] px-2 font-medium">Fault:</span>
                  <button
                    onClick={() =>
                      handleSelectSchematicFault('bearingB', 'alarm', 'Bearing Wear - 88% (Housing B)')
                    }
                    className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                      schematicActivePart === 'bearingB'
                        ? 'bg-[#7C5CBF] text-white shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    Bearing B (Alarm)
                  </button>
                  <button
                    onClick={() =>
                      handleSelectSchematicFault('rotor', 'alarm', 'Rotor Dynamic Unbalance')
                    }
                    className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                      schematicActivePart === 'rotor'
                        ? 'bg-[#7C5CBF] text-white shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    Rotor (Alarm)
                  </button>
                  <button
                    onClick={() =>
                      handleSelectSchematicFault('coupling', 'watch', 'Coupling Misalignment')
                    }
                    className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                      schematicActivePart === 'coupling'
                        ? 'bg-[#B8A4E3] text-white shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    Coupling (Watch)
                  </button>
                  <button
                    onClick={() =>
                      handleSelectSchematicFault('none', 'healthy', 'Nominal Baseline')
                    }
                    className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                      schematicSeverity === 'healthy'
                        ? 'bg-[#1F7A4D] text-white shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    Healthy
                  </button>
                </div>
              </div>
            </div>

            {/* VIEW 1: 3D ISOMETRIC PRODUCT RENDER */}
            {diagramViewMode === '3d' ? (
              <div className="relative w-full rounded-2xl overflow-hidden bg-gradient-to-b from-[#FBFBFE] via-[#F4F1FA] to-[#EDE7F6] border border-[#EDE8F5] shadow-inner select-none">
                {/* 3D Render Image */}
                <div className="relative w-full overflow-hidden flex items-center justify-center">
                  <img
                    src="/src/assets/images/isometric_machine_diagram_1790830836630.jpg"
                    alt="3D Isometric Industrial Machine Diagram"
                    className="w-full h-auto object-cover max-h-[440px] mix-blend-multiply transition-all duration-500"
                    referrerPolicy="no-referrer"
                  />

                  {/* Radiating Glow Aura around Second Bearing Housing (Alarm State) */}
                  {schematicActivePart === 'bearingB' && schematicSeverity !== 'healthy' && (
                    <>
                      <div className="absolute top-[52%] left-[64%] -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full bg-gradient-to-r from-[#DC2626]/40 to-[#EF4444]/40 blur-xl aura-pulse pointer-events-none" />
                      <div className="absolute top-[52%] left-[64%] -translate-x-1/2 -translate-y-1/2 w-18 h-18 rounded-full border-2 border-[#EF4444] shadow-[0_0_24px_rgba(239,68,68,0.95)] animate-pulse pointer-events-none" />
                      <div className="absolute top-[52%] left-[64%] -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full border border-[#EF4444]/50 animate-ping pointer-events-none opacity-60" />
                    </>
                  )}

                  {/* Radiating Glow for other simulated components */}
                  {schematicActivePart === 'coupling' && schematicSeverity === 'watch' && (
                    <div className="absolute top-[52%] left-[44%] -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-[#3B82F6]/30 blur-lg aura-pulse pointer-events-none border-2 border-[#3B82F6] shadow-[0_0_20px_rgba(59,130,246,0.9)]" />
                  )}

                  {schematicActivePart === 'rotor' && schematicSeverity !== 'healthy' && (
                    <div className="absolute top-[48%] left-[82%] -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-[#EF4444]/35 blur-lg aura-pulse pointer-events-none border-2 border-[#EF4444] shadow-[0_0_20px_rgba(239,68,68,0.9)]" />
                  )}

                  {/* Floating Pill Label Reading "Bearing Wear - 88%" */}
                  {schematicActivePart === 'bearingB' && schematicSeverity !== 'healthy' && (
                    <div className="absolute top-[26%] left-[64%] -translate-x-1/2 flex flex-col items-center z-10 transition-all duration-300">
                      <div className="px-3.5 py-1.5 rounded-full bg-[#2E2740]/95 backdrop-blur-md text-white font-bold text-xs shadow-xl border border-[#EF4444] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse shadow-[0_0_8px_#EF4444]" />
                        <span>Bearing Wear - 88%</span>
                      </div>
                      <div className="w-px h-9 bg-gradient-to-b from-[#EF4444] to-[#DC2626] shadow-[0_0_6px_#EF4444]" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#EF4444] border-2 border-white shadow-[0_0_8px_#EF4444]" />
                    </div>
                  )}

                  {/* Floating Pill Label for Rotor */}
                  {schematicActivePart === 'rotor' && schematicSeverity !== 'healthy' && (
                    <div className="absolute top-[22%] left-[82%] -translate-x-1/2 flex flex-col items-center z-10">
                      <div className="px-3.5 py-1.5 rounded-full bg-[#2E2740]/95 backdrop-blur-md text-white font-bold text-xs shadow-xl border border-[#EF4444] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse shadow-[0_0_8px_#EF4444]" />
                        <span>Rotor Unbalance - 94%</span>
                      </div>
                      <div className="w-px h-8 bg-gradient-to-b from-[#EF4444] to-transparent" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#EF4444] border-2 border-white shadow-[0_0_8px_#EF4444]" />
                    </div>
                  )}

                  {/* Floating Pill Label for Coupling */}
                  {schematicActivePart === 'coupling' && schematicSeverity === 'watch' && (
                    <div className="absolute top-[26%] left-[44%] -translate-x-1/2 flex flex-col items-center z-10">
                      <div className="px-3.5 py-1.5 rounded-full bg-[#2E2740]/95 backdrop-blur-md text-white font-bold text-xs shadow-xl border border-[#3B82F6] flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse shadow-[0_0_8px_#3B82F6]" />
                        <span>Coupling Misalignment - Watch</span>
                      </div>
                      <div className="w-px h-8 bg-gradient-to-b from-[#3B82F6] to-transparent" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] border-2 border-white shadow-[0_0_8px_#3B82F6]" />
                    </div>
                  )}

                  {/* Component Architecture Indicators along bottom */}
                  <div className="absolute bottom-3 left-4 flex flex-wrap items-center gap-2 text-[10px] text-[#2E2740] z-10">
                    <span className="px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-xs border border-[#EDE8F5] shadow-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#1F7A4D]" /> Motor Housing (Deep Forest Green)
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-xs border border-[#EDE8F5] shadow-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#8B849C]" /> Shaft & Coupling (Neutral Gray-Lavender)
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-xs border border-[#EDE8F5] shadow-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#6FAE8C]" /> Bearing Housings (Light Sage)
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-xs border border-[#EDE8F5] shadow-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#C9B6F2]" /> Rotor Assembly (Lavender-Gray)
                    </span>
                  </div>

                  {/* Floating Corner Status Legend: Pinned to the corner with a frosted-glass card */}
                  <div className="absolute bottom-3 right-4 bg-white/85 backdrop-blur-md border border-white/70 rounded-2xl p-3.5 shadow-xl text-[11px] text-[#2E2740] space-y-2 z-20">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#8B849C] pb-1 border-b border-[#EDE8F5]/80 flex items-center justify-between gap-3">
                      <span>Floating Corner Status Legend</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-ping" />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shadow-[0_0_8px_#10B981]" />
                      <span className="font-medium text-[#2E2740]">green glow = healthy</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] shadow-[0_0_8px_#3B82F6]" />
                      <span className="font-medium text-[#2E2740]">blue glow = watch</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444] shadow-[0_0_8px_#EF4444]" />
                      <span className="font-semibold text-[#DC2626]">red-red glow = alarm</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* VIEW 2: 2D FLOW SCHEMATIC */
              <div className="w-full bg-[#FAF9FD] rounded-xl p-4 border border-[#EDE8F5] relative overflow-hidden select-none">
                <svg
                  className="w-full h-44 overflow-visible"
                  viewBox="0 0 920 170"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <line x1="55" y1="70" x2="865" y2="70" stroke="#D6CEE8" strokeWidth="8" strokeLinecap="round" />
                  <line x1="45" y1="70" x2="875" y2="70" stroke="#8B849C" strokeWidth="1.2" strokeDasharray="8,5" opacity="0.5" />

                  <g fill="#B8A4E3" opacity="0.8">
                    <polygon points="212,66 222,70 212,74" />
                    <polygon points="340,66 350,70 340,74" />
                    <polygon points="488,66 498,70 488,74" />
                    <polygon points="616,66 626,70 616,74" />
                  </g>

                  {/* Motor */}
                  {(() => {
                    const p = getPartVisualProps('motor');
                    return (
                      <g onClick={() => handleSelectSchematicFault('motor', 'alarm', 'Motor Overload')} className={p.className}>
                        <rect x="105" y="12" width="60" height="14" rx="4" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <rect x="70" y="24" width="130" height="92" rx="14" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <text x="135" y="136" textAnchor="middle" fill={p.isPulsing ? p.stroke : '#2E2740'} fontSize="12" fontWeight="700">Motor</text>
                        <text x="135" y="150" textAnchor="middle" fill="#8B849C" fontSize="10">Deep Forest Green</text>
                      </g>
                    );
                  })()}

                  {/* Bearing A */}
                  {(() => {
                    const p = getPartVisualProps('bearingA');
                    return (
                      <g onClick={() => handleSelectSchematicFault('bearingA', 'alarm', 'Bearing A Defect')} className={p.className}>
                        <rect x="240" y="98" width="68" height="10" rx="3" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <rect x="244" y="38" width="60" height="64" rx="12" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <circle cx="274" cy="70" r="18" fill="#FFFFFF" fillOpacity="0.45" stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <text x="274" y="136" textAnchor="middle" fill={p.isPulsing ? p.stroke : '#2E2740'} fontSize="12" fontWeight="700">Bearing A</text>
                        <text x="274" y="150" textAnchor="middle" fill="#8B849C" fontSize="10">Light Sage Tone</text>
                      </g>
                    );
                  })()}

                  {/* Coupling */}
                  {(() => {
                    const p = getPartVisualProps('coupling');
                    return (
                      <g onClick={() => handleSelectSchematicFault('coupling', 'watch', 'Coupling Misalignment')} className={p.className}>
                        <rect x="372" y="34" width="30" height="72" rx="7" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <rect x="404" y="40" width="12" height="60" rx="3" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <rect x="418" y="34" width="30" height="72" rx="7" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <text x="410" y="136" textAnchor="middle" fill={p.isPulsing ? p.stroke : '#2E2740'} fontSize="12" fontWeight="700">Coupling</text>
                        <text x="410" y="150" textAnchor="middle" fill="#8B849C" fontSize="10">Neutral Gray-Lavender</text>
                      </g>
                    );
                  })()}

                  {/* Bearing B */}
                  {(() => {
                    const p = getPartVisualProps('bearingB');
                    return (
                      <g onClick={() => handleSelectSchematicFault('bearingB', 'alarm', 'Bearing Wear - 88%')} className={p.className}>
                        <rect x="512" y="98" width="68" height="10" rx="3" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <rect x="516" y="38" width="60" height="64" rx="12" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <circle cx="546" cy="70" r="18" fill="#FFFFFF" fillOpacity="0.45" stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <text x="546" y="136" textAnchor="middle" fill={p.isPulsing ? p.stroke : '#2E2740'} fontSize="12" fontWeight="700">Bearing B</text>
                        <text x="546" y="150" textAnchor="middle" fill="#8B849C" fontSize="10">Fault Focus</text>
                      </g>
                    );
                  })()}

                  {/* Rotor */}
                  {(() => {
                    const p = getPartVisualProps('rotor');
                    return (
                      <g onClick={() => handleSelectSchematicFault('rotor', 'alarm', 'Rotor Unbalance')} className={p.className}>
                        <rect x="648" y="22" width="164" height="96" rx="16" fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <circle cx="730" cy="70" r="30" fill="#FFFFFF" fillOpacity="0.35" stroke={p.stroke} strokeWidth={p.strokeWidth} />
                        <text x="730" y="136" textAnchor="middle" fill={p.isPulsing ? p.stroke : '#2E2740'} fontSize="12" fontWeight="700">Rotor</text>
                        <text x="730" y="150" textAnchor="middle" fill="#8B849C" fontSize="10">Fan Assembly</text>
                      </g>
                    );
                  })()}
                </svg>
              </div>
            )}

            {/* Bottom Status Banner */}
            <div className="flex flex-wrap items-center justify-between text-xs pt-3 mt-1 text-[#8B849C] border-t border-[#EDE8F5]/80">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#2E2740]">Fault Isolation:</span>
                <span className="font-medium text-[#2E2740]">{schematicFaultLabel}</span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="text-emerald-700 font-medium">&bull; Ambient Soft Shading</span>
                <span className="text-purple-700 font-medium">&bull; Isometric SaaS Geometry</span>
                <span className="text-slate-500">&bull; Click components to isolate</span>
              </div>
            </div>
          </div>

          {/* ================================================================ */}
          {/* MIDDLE 3-COLUMN-ISH GRID OF PANELS */}
          {/* ================================================================ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Panel: Vibration & Temperature Trend (Col span 6) */}
            <div className="lg:col-span-6 bg-white rounded-2xl p-6 card-shadow border border-[#EDE8F5]/80 flex flex-col justify-between">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-[#2E2740]">
                    Vibration & Temperature Trend
                  </h3>
                  <p className="text-[11px] text-[#8B849C] mt-0.5">
                    ISO 10816 velocity RMS & bearing thermal progression
                  </p>
                </div>

                {/* Metric toggle pills */}
                <div className="flex bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-1 text-[11px]">
                  <button
                    onClick={() => setChartMetric('rms')}
                    className={`px-3 py-1 rounded-lg font-semibold transition ${
                      chartMetric === 'rms'
                        ? 'bg-white text-[#1F7A4D] shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    RMS (mm/s)
                  </button>
                  <button
                    onClick={() => setChartMetric('temp')}
                    className={`px-3 py-1 rounded-lg font-semibold transition ${
                      chartMetric === 'temp'
                        ? 'bg-white text-[#7C5CBF] shadow-xs'
                        : 'text-[#8B849C] hover:text-[#2E2740]'
                    }`}
                  >
                    Temp (°C)
                  </button>
                </div>
              </div>

              {/* Interactive SVG Area Chart */}
              <div className="w-full relative select-none">
                <svg
                  className="w-full h-56 overflow-visible"
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    {/* Soft green-to-purple gradient fill under the line */}
                    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6FAE8C" stopOpacity="0.35" />
                      <stop offset="60%" stopColor="#C9B6F2" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#7C5CBF" stopOpacity="0.02" />
                    </linearGradient>

                    {/* Gradient for stroke */}
                    <linearGradient id="strokeGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#1F7A4D" />
                      <stop offset="50%" stopColor="#6FAE8C" />
                      <stop offset="85%" stopColor="#C9B6F2" />
                      <stop offset="100%" stopColor="#7C5CBF" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Light Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                    const y = paddingY + pct * (svgHeight - paddingY * 2);
                    return (
                      <line
                        key={i}
                        x1={paddingX}
                        y1={y}
                        x2={svgWidth - paddingX}
                        y2={y}
                        stroke="#EDE8F5"
                        strokeWidth="1"
                        strokeDasharray={pct === 0.5 ? '4,4' : undefined}
                      />
                    );
                  })}

                  {/* Area fill */}
                  <path d={areaD} fill="url(#areaGradient)" />

                  {/* Stroke path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="url(#strokeGradient)"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />

                  {/* Plot Data Points */}
                  {coordinates.map((coord, idx) => (
                    <g
                      key={idx}
                      onMouseEnter={() => setHoveredPointIndex(idx)}
                      onMouseLeave={() => setHoveredPointIndex(null)}
                      className="cursor-pointer"
                    >
                      <circle
                        cx={coord.x}
                        cy={coord.y}
                        r={hoveredPointIndex === idx ? 6 : 4}
                        fill="#FFFFFF"
                        stroke={idx === coordinates.length - 1 ? '#7C5CBF' : '#6FAE8C'}
                        strokeWidth="2.5"
                        className="transition-all"
                      />
                    </g>
                  ))}

                  {/* X-axis labels */}
                  {coordinates.map((coord, idx) => (
                    <text
                      key={idx}
                      x={coord.x}
                      y={svgHeight - 6}
                      textAnchor="middle"
                      fill="#8B849C"
                      fontSize="10"
                      fontFamily="inherit"
                      fontWeight="500"
                    >
                      {coord.point.label}
                    </text>
                  ))}
                </svg>

                {/* Floating tooltip for hovered point */}
                {hoveredPointIndex !== null && (
                  <div
                    className="absolute bg-[#2E2740] text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg pointer-events-none -translate-x-1/2 -translate-y-full mb-2 z-10"
                    style={{
                      left: `${(coordinates[hoveredPointIndex].x / svgWidth) * 100}%`,
                      top: `${(coordinates[hoveredPointIndex].y / svgHeight) * 100}%`,
                    }}
                  >
                    <div className="font-bold">
                      {chartMetric === 'rms'
                        ? `${coordinates[hoveredPointIndex].point.rms} mm/s RMS`
                        : `${coordinates[hoveredPointIndex].point.temp} °C Temp`}
                    </div>
                    <div className="text-[9px] text-[#C9B6F2]">
                      Time: {coordinates[hoveredPointIndex].point.time}
                    </div>
                  </div>
                )}
              </div>

              {/* Chart Legend / Notes */}
              <div className="flex items-center justify-between text-[11px] text-[#8B849C] pt-3 border-t border-[#EDE8F5]/80 mt-2">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#6FAE8C]" /> Baseline: 2.5 mm/s
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#B8A4E3]" /> Watch: 4.5 mm/s
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#7C5CBF]" /> Alarm: 7.1 mm/s
                </span>
              </div>
            </div>

            {/* Middle Panel: Active Alert (Reminder card style, Col span 3) */}
            <div className="lg:col-span-3 bg-white rounded-2xl p-5 card-shadow border border-[#EDE8F5]/80 flex flex-col justify-between relative overflow-hidden">
              {/* Subtle top-right accent */}
              <div className="absolute top-0 right-0 w-28 h-28 bg-[#C9B6F2]/10 rounded-full blur-2xl pointer-events-none" />

              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B849C] flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-[#7C5CBF]" /> Current Anomaly
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F8F5FE] text-[#7C5CBF] border border-[#7C5CBF]/30">
                    ALARM
                  </span>
                </div>

                <div className="space-y-1.5 mt-2">
                  <h4 className="text-base font-bold text-[#2E2740] leading-snug">
                    Rotor Dynamic Unbalance
                  </h4>
                  <p className="text-xs text-[#8B849C]">
                    Asset: <b className="text-[#2E2740]">Primary Feed Motor 01</b>
                  </p>
                </div>

                <div className="my-4 bg-[#F8F7FC] rounded-xl p-3 border border-[#EDE8F5] space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#8B849C]">Peak 1X Harmonic:</span>
                    <span className="font-bold text-[#7C5CBF]">4.28 mm/s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B849C]">Harmonic Ratio 1X/2X:</span>
                    <span className="font-bold text-[#1F7A4D]">3.8x (Dominant)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#8B849C]">First Detected:</span>
                    <span className="text-[#2E2740]">14 minutes ago</span>
                  </div>
                </div>

                <p className="text-[11px] text-[#8B849C] leading-relaxed">
                  Radial vibration amplitude scales with rotor RPM². Balancing correction required.
                </p>
              </div>

              {/* Action Button */}
              <button
                onClick={() => setShowDiagnosisModal(true)}
                className="w-full mt-4 py-2.5 px-4 rounded-xl bg-gradient-brand text-white font-semibold text-xs shadow-md shadow-[#7C5CBF]/20 hover:opacity-95 transition-all flex items-center justify-center gap-1.5"
              >
                <span>View Diagnosis</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Right Panel: Sensor Status List (Col span 3) */}
            <div className="lg:col-span-3 bg-white rounded-2xl p-5 card-shadow border border-[#EDE8F5]/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-[#2E2740]">
                    Sensor Status
                  </h3>
                  {/* "+ New" Pill button in corner */}
                  <button
                    onClick={() => setShowAddSensorModal(true)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#F4F1FA] text-[#7C5CBF] hover:bg-[#EDE8F5] transition"
                  >
                    + New
                  </button>
                </div>

                {/* Rows of Sensors */}
                <div className="space-y-3 mt-3">
                  {sensors.map((sensor) => {
                    const dotColor =
                      sensor.status === 'healthy'
                        ? 'bg-[#6FAE8C]'
                        : sensor.status === 'watch'
                        ? 'bg-[#B8A4E3]'
                        : 'bg-[#7C5CBF]';

                    return (
                      <div
                        key={sensor.id}
                        className="p-2.5 rounded-xl bg-[#F8F7FC] border border-[#EDE8F5] hover:border-[#C9B6F2]/60 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {/* Status dot */}
                            <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                            <span className="text-xs font-bold text-[#2E2740]">
                              {sensor.name}
                            </span>
                          </div>
                          <span className="text-xs font-bold font-mono text-[#2E2740]">
                            {sensor.value}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-[#8B849C] mt-1 pl-4.5">
                          <span>{sensor.model}</span>
                          <span>{sensor.note}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Sensor Health Summary */}
              <div className="pt-3 border-t border-[#EDE8F5] mt-3 flex items-center justify-between text-[11px] text-[#8B849C]">
                <span>3 of 4 Active</span>
                <span className="text-[#6FAE8C] font-semibold">Mesh OK</span>
              </div>
            </div>
          </div>

          {/* ================================================================ */}
          {/* BOTTOM ROW (3 PANELS) */}
          {/* ================================================================ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Panel 1: Fault History List (Col span 5) */}
            <div className="lg:col-span-5 bg-white rounded-2xl p-5 card-shadow border border-[#EDE8F5]/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#2E2740]">
                      Fault History
                    </h3>
                    <p className="text-[11px] text-[#8B849C]">
                      Recent automated condition triggers & resolution states
                    </p>
                  </div>
                  <button
                    onClick={() => triggerToast('Opening full audit logs')}
                    className="text-xs text-[#7C5CBF] font-semibold hover:underline"
                  >
                    View All
                  </button>
                </div>

                <div className="space-y-3">
                  {faultHistory.map((item) => {
                    const statusBadgeClass =
                      item.status === 'Resolved'
                        ? 'bg-[#F4F9F6] text-[#1F7A4D] border-[#1F7A4D]/20'
                        : item.status === 'In Progress'
                        ? 'bg-[#F8F5FE] text-[#7C5CBF] border-[#7C5CBF]/20'
                        : 'bg-[#FAF8FE] text-[#8B849C] border-[#EDE8F5]';

                    const avatarBg =
                      item.statusType === 'healthy'
                        ? 'bg-[#F4F9F6] text-[#1F7A4D]'
                        : item.statusType === 'watch'
                        ? 'bg-[#F8F5FE] text-[#7C5CBF]'
                        : 'bg-[#F1EDFB] text-[#7C5CBF]';

                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-[#F8F7FC] transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Avatar-style icon */}
                          <div
                            className={`w-9 h-9 rounded-xl ${avatarBg} shrink-0 flex items-center justify-center font-bold text-xs`}
                          >
                            {item.fault.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#2E2740] truncate">
                              {item.fault}
                            </div>
                            <div className="text-[11px] text-[#8B849C] truncate">
                              {item.description}
                            </div>
                          </div>
                        </div>

                        {/* Status Pill */}
                        <div className="shrink-0 text-right">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadgeClass}`}
                          >
                            {item.status}
                          </span>
                          <div className="text-[10px] text-[#8B849C] mt-0.5">
                            {item.timeAgo}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Panel 2: Machine Health Circular Progress Gauge (Col span 4) */}
            <div className="lg:col-span-4 bg-white rounded-2xl p-5 card-shadow border border-[#EDE8F5]/80 flex flex-col justify-between items-center text-center">
              <div className="w-full flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-[#2E2740]">
                  Machine Health
                </h3>
                <span className="text-[11px] text-[#8B849C]">Fleet Overall</span>
              </div>

              {/* Donut Progress Gauge (82% Healthy) */}
              <div className="relative w-40 h-40 my-3 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  {/* Background track circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#EDE8F5"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  {/* Alarm section (8%) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#7C5CBF"
                    strokeWidth="10"
                    fill="transparent"
                    strokeDasharray="251.2"
                    strokeDashoffset="231"
                    strokeLinecap="round"
                  />
                  {/* Watch section (10%) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#B8A4E3"
                    strokeWidth="10"
                    fill="transparent"
                    strokeDasharray="251.2"
                    strokeDashoffset="225"
                    transform="rotate(28 50 50)"
                  />
                  {/* Healthy main arc (82%) */}
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="#6FAE8C"
                    strokeWidth="10"
                    fill="transparent"
                    strokeDasharray="251.2"
                    strokeDashoffset="45"
                    strokeLinecap="round"
                    transform="rotate(65 50 50)"
                  />
                </svg>

                {/* Center Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-[#2E2740] tracking-tight">
                    82%
                  </span>
                  <span className="text-[11px] font-semibold text-[#6FAE8C]">
                    Healthy
                  </span>
                </div>
              </div>

              {/* Legend with Green, Lavender, and Deep Purple Dots */}
              <div className="w-full flex items-center justify-center gap-4 text-xs text-[#8B849C] pt-2 border-t border-[#EDE8F5]/80">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#6FAE8C]" />
                  <span>Healthy (82%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#B8A4E3]" />
                  <span>Watch (10%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#7C5CBF]" />
                  <span>Alarm (8%)</span>
                </div>
              </div>
            </div>

            {/* Panel 3: Live Monitoring Card (Solid Gradient Filled, Col span 3) */}
            <div className="lg:col-span-3 rounded-2xl p-5 bg-gradient-brand text-white card-shadow card-shadow-hover flex flex-col justify-between relative overflow-hidden">
              {/* Decorative soft glow circles */}
              <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10 blur-xl pointer-events-none" />

              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/80 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C9B6F2]" /> Live Monitoring
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isLiveRunning ? 'bg-[#C9B6F2] animate-ping' : 'bg-white/40'
                    }`}
                  />
                </div>

                <div className="mt-4">
                  <span className="text-[11px] uppercase tracking-wider text-white/70 block">
                    Elapsed Monitoring Time
                  </span>
                  <div className="text-2xl font-black font-mono tracking-tight text-white mt-1">
                    {formattedElapsedTime}
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-xl bg-white/15 backdrop-blur-md border border-white/20">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-white/80">Live RMS Velocity:</span>
                    <span className="font-extrabold font-mono text-white text-sm">
                      {liveRms} mm/s
                    </span>
                  </div>
                  <div className="text-[10px] text-white/70 mt-1">
                    ISO 10816 Zone B &bull; Synchronous 1485 RPM
                  </div>
                </div>
              </div>

              {/* Pause / Play / Stop Button Pair */}
              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={() => {
                    setIsLiveRunning((prev) => !prev);
                    triggerToast(isLiveRunning ? 'Live stream paused' : 'Live stream resumed');
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/30 text-white font-semibold text-xs transition flex items-center justify-center gap-1.5"
                >
                  {isLiveRunning ? (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-white" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-white" /> Resume
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    setElapsedSeconds(0);
                    triggerToast('Monitoring session reset');
                  }}
                  className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 text-white flex items-center justify-center transition"
                  title="Reset Counter"
                >
                  <Square className="w-3.5 h-3.5 fill-white" />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ==================================================================== */}
      {/* MODAL 1: VIEW DIAGNOSIS (Root Cause & Explainable Rule Sheet) */}
      {/* ==================================================================== */}
      {showDiagnosisModal && (
        <div className="fixed inset-0 z-50 bg-[#2E2740]/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 card-shadow border border-[#EDE8F5] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDE8F5]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-brand text-white flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#2E2740]">
                    Diagnosis Report: Rotor Unbalance
                  </h3>
                  <p className="text-[11px] text-[#8B849C]">
                    Rule Engine ISO 10816-3 Forward Chaining
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDiagnosisModal(false)}
                className="w-8 h-8 rounded-full text-[#8B849C] hover:bg-[#F8F7FC] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 my-4 text-xs">
              <div className="bg-[#F8F5FE] border border-[#7C5CBF]/20 rounded-2xl p-4">
                <div className="font-bold text-[#7C5CBF] mb-1">
                  Root Cause Hypothesis:
                </div>
                <p className="text-[#2E2740] leading-relaxed">
                  Heavy particulate accumulation detected on cooling fan blades, producing a centrifugal radial mass imbalance proportional to rotor RPM².
                </p>
              </div>

              <div className="space-y-2">
                <div className="font-bold text-[#2E2740]">Rule Evaluation Evidence:</div>
                <div className="rounded-xl border border-[#EDE8F5] overflow-hidden">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#F8F7FC] text-[#8B849C]">
                      <tr>
                        <th className="p-2">Condition</th>
                        <th className="p-2">Live</th>
                        <th className="p-2">Threshold</th>
                        <th className="p-2 text-right">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EDE8F5]">
                      <tr>
                        <td className="p-2">Peak 1X Radial</td>
                        <td className="p-2 font-mono">4.28 mm/s</td>
                        <td className="p-2 text-[#8B849C]">&ge; 3.8 mm/s</td>
                        <td className="p-2 text-right font-bold text-[#7C5CBF]">FIRED</td>
                      </tr>
                      <tr>
                        <td className="p-2">Harmonic Ratio 1X/2X</td>
                        <td className="p-2 font-mono">3.80</td>
                        <td className="p-2 text-[#8B849C]">&ge; 1.80</td>
                        <td className="p-2 text-right font-bold text-[#7C5CBF]">FIRED</td>
                      </tr>
                      <tr>
                        <td className="p-2">Impact Kurtosis</td>
                        <td className="p-2 font-mono">2.94</td>
                        <td className="p-2 text-[#8B849C]">&lt; 3.80</td>
                        <td className="p-2 text-right font-bold text-[#1F7A4D]">PASS</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-[#F4F9F6] border border-[#1F7A4D]/20 rounded-2xl p-4">
                <div className="font-bold text-[#1F7A4D] mb-1">
                  Recommended Maintenance Action:
                </div>
                <p className="text-[#2E2740] leading-relaxed">
                  Perform dual-plane dynamic field balancing using laser strobe. Inspect impeller blades for dirt erosion or loose counterweights.
                </p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowDiagnosisModal(false);
                  triggerToast('Alert acknowledged');
                }}
                className="flex-1 py-2.5 rounded-xl bg-gradient-brand text-white font-semibold text-xs shadow-md shadow-[#7C5CBF]/20"
              >
                Acknowledge Alert
              </button>
              <button
                onClick={() => setShowDiagnosisModal(false)}
                className="px-4 py-2.5 rounded-xl border border-[#EDE8F5] text-xs font-semibold text-[#8B849C] hover:bg-[#F8F7FC]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: NEW READING / RUN DIAGNOSIS */}
      {/* ==================================================================== */}
      {showNewReadingModal && (
        <div className="fixed inset-0 z-50 bg-[#2E2740]/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 card-shadow border border-[#EDE8F5] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDE8F5]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#F4F9F6] text-[#1F7A4D] flex items-center justify-center">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#2E2740]">
                    Capture Manual Reading
                  </h3>
                  <p className="text-[11px] text-[#8B849C]">
                    Log portable vibration analyzer measurement
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowNewReadingModal(false)}
                className="w-8 h-8 rounded-full text-[#8B849C] hover:bg-[#F8F7FC] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 my-4 text-xs">
              <div>
                <label className="block text-[#8B849C] font-semibold mb-1">
                  Machine Asset
                </label>
                <select className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2 text-[#2E2740] font-medium focus:outline-none focus:border-[#7C5CBF]">
                  <option>Primary Feed Motor 01 (Bay A)</option>
                  <option>Slurry Agitator Motor 02 (Bay B)</option>
                  <option>Chilled Water Pump 03 (Bay C)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8B849C] font-semibold mb-1">
                    Vibration RMS (mm/s)
                  </label>
                  <input
                    type="number"
                    defaultValue="3.45"
                    step="0.05"
                    className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2 text-[#2E2740] font-mono focus:outline-none focus:border-[#7C5CBF]"
                  />
                </div>
                <div>
                  <label className="block text-[#8B849C] font-semibold mb-1">
                    Bearing Temp (°C)
                  </label>
                  <input
                    type="number"
                    defaultValue="62.5"
                    step="0.5"
                    className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2 text-[#2E2740] font-mono focus:outline-none focus:border-[#7C5CBF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8B849C] font-semibold mb-1">
                    Peak 1X (mm/s)
                  </label>
                  <input
                    type="number"
                    defaultValue="1.45"
                    className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2 text-[#2E2740] font-mono focus:outline-none focus:border-[#7C5CBF]"
                  />
                </div>
                <div>
                  <label className="block text-[#8B849C] font-semibold mb-1">
                    Peak 2X (mm/s)
                  </label>
                  <input
                    type="number"
                    defaultValue="0.82"
                    className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2 text-[#2E2740] font-mono focus:outline-none focus:border-[#7C5CBF]"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowNewReadingModal(false);
                  triggerToast('Manual telemetry reading ingested successfully!');
                }}
                className="flex-1 py-2.5 rounded-xl bg-gradient-brand text-white font-semibold text-xs shadow-md shadow-[#7C5CBF]/20"
              >
                Save & Run Diagnosis
              </button>
              <button
                onClick={() => setShowNewReadingModal(false)}
                className="px-4 py-2.5 rounded-xl border border-[#EDE8F5] text-xs font-semibold text-[#8B849C] hover:bg-[#F8F7FC]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: ESP32 MQTT CONFIGURATION */}
      {/* ==================================================================== */}
      {showEsp32Modal && (
        <div className="fixed inset-0 z-50 bg-[#2E2740]/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 card-shadow border border-[#EDE8F5] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-[#EDE8F5]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-brand text-white flex items-center justify-center">
                  <Wifi className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#2E2740]">
                    ESP32 Device Provisioning
                  </h3>
                  <p className="text-[11px] text-[#8B849C]">
                    MQTT broker connection details
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEsp32Modal(false)}
                className="w-8 h-8 rounded-full text-[#8B849C] hover:bg-[#F8F7FC] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <p className="text-[#8B849C]">
                Flash your NodeMCU / ESP32 with PubSubClient and publish JSON telemetry frames to the broker topic below:
              </p>

              <div className="bg-[#2E2740] text-[#C9B6F2] p-3 rounded-xl font-mono text-[11px] space-y-1">
                <div><span className="text-white/60"># MQTT Broker:</span> broker.faultsense.local:1883</div>
                <div><span className="text-white/60"># Topic:</span> plant1/motor01/telemetry</div>
                <div><span className="text-white/60"># Payload:</span> {`{"rms": 3.42, "temp": 61.5, "rpm": 1485}`}</div>
              </div>
            </div>

            <button
              onClick={() => {
                setShowEsp32Modal(false);
                triggerToast('Copied MQTT configuration credentials');
              }}
              className="w-full py-2.5 rounded-xl bg-gradient-brand text-white font-semibold text-xs shadow-md shadow-[#7C5CBF]/20"
            >
              Done & Verify Ping
            </button>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4: ADD NEW SENSOR */}
      {/* ==================================================================== */}
      {showAddSensorModal && (
        <div className="fixed inset-0 z-50 bg-[#2E2740]/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 card-shadow border border-[#EDE8F5]">
            <h3 className="text-sm font-bold text-[#2E2740] mb-3">Register Sensor</h3>
            <div className="space-y-3 text-xs">
              <input
                type="text"
                placeholder="Sensor Name (e.g. Axial Accel)"
                className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2.5 text-[#2E2740]"
              />
              <input
                type="text"
                placeholder="Model (e.g. MPU-6050)"
                className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2.5 text-[#2E2740]"
              />
              <select className="w-full bg-[#F8F7FC] border border-[#EDE8F5] rounded-xl p-2.5 text-[#2E2740]">
                <option>Assigned to: Feed Motor 01</option>
                <option>Assigned to: Agitator 02</option>
                <option>Assigned to: Pump 03</option>
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowAddSensorModal(false);
                  triggerToast('New sensor enrolled into telemetry pipeline');
                }}
                className="flex-1 py-2 rounded-xl bg-gradient-brand text-white text-xs font-semibold"
              >
                Add Sensor
              </button>
              <button
                onClick={() => setShowAddSensorModal(false)}
                className="px-3 py-2 rounded-xl border border-[#EDE8F5] text-xs font-semibold text-[#8B849C]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 5: EXPORT REPORT */}
      {/* ==================================================================== */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-[#2E2740]/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 card-shadow border border-[#EDE8F5]">
            <h3 className="text-sm font-bold text-[#2E2740] mb-2">Export Health Audit</h3>
            <p className="text-xs text-[#8B849C] mb-4">
              Download complete vibration spectral data, alarms, and ISO 10816 compliance logs.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setShowExportModal(false);
                  triggerToast('Generating CSV report with 128,490 samples...');
                }}
                className="w-full py-2.5 px-3 rounded-xl border border-[#EDE8F5] hover:bg-[#F8F7FC] text-left text-xs font-semibold text-[#2E2740] flex items-center justify-between"
              >
                <span>Raw Telemetry CSV (.csv)</span>
                <Download className="w-4 h-4 text-[#8B849C]" />
              </button>
              <button
                onClick={() => {
                  setShowExportModal(false);
                  triggerToast('Compiling executive maintenance PDF summary...');
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-brand text-white text-left text-xs font-semibold flex items-center justify-between shadow-sm"
              >
                <span>Executive ISO 10816 Audit (PDF)</span>
                <Download className="w-4 h-4 text-white" />
              </button>
            </div>
            <button
              onClick={() => setShowExportModal(false)}
              className="w-full mt-3 py-2 text-xs font-semibold text-[#8B849C] hover:text-[#2E2740]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
