'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import {
  Clock, MapPin, CheckCircle, XCircle, Coffee, Timer,
  Users, Activity, BarChart2, CalendarDays, Utensils,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type DayStatus = 'Early' | 'On Time' | 'Late' | 'Absent';

interface Employee {
  _id: string;
  name: string;
  status: DayStatus;
  checkIn: string | null;
  checkOut: string | null;
  workMins: number;
  isOnBreak: boolean;
}

interface HeatmapRow {
  employeeId: string;
  name: string;
  days: Record<string, { status: DayStatus; hours: number }>;
}

interface DailyReport {
  employeeId: string | { _id: string };
  name: string;
  date: string;
  dayStatus: DayStatus;
  checkIn: string | null;
  checkOut: string | null;
  totalWorkMins: number;
  breaks: any[];
  sessions: any[];
  timeline: { time: string; event: string }[];
  isWithinGeofence: boolean;
  crmActivity?: {
    leadsContacted: number;
    callsMade: number;
    visitsScheduled: number;
    messagesSent: number;
  };
  breakFlags?: string[];
  breakSummary?: { lunchMins: number; shortMins: number; personalMins: number };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<DayStatus, string> = {
  'Early': 'bg-blue-100 text-blue-700',
  'On Time': 'bg-green-100 text-green-700',
  'Late': 'bg-red-100 text-red-700',
  'Absent': 'bg-gray-100 text-gray-500',
};

const HM_COLOR: Record<DayStatus, string> = {
  'Early': '#3B82F6',
  'On Time': '#22C55E',
  'Late': '#EF4444',
  'Absent': '#E5E7EB',
};

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MOCK_EMPS: Employee[] = [
  { _id: 'm1', name: 'Priya Sharma', status: 'On Time', checkIn: '10:02 AM', checkOut: null, workMins: 320, isOnBreak: false },
  { _id: 'm2', name: 'Rahul Verma', status: 'Late', checkIn: '10:45 AM', checkOut: null, workMins: 210, isOnBreak: true },
  { _id: 'm3', name: 'Neha Gupta', status: 'Early', checkIn: '09:45 AM', checkOut: null, workMins: 380, isOnBreak: false },
  { _id: 'm4', name: 'Ankit Kumar', status: 'Absent', checkIn: null, checkOut: null, workMins: 0, isOnBreak: false },
  { _id: 'm5', name: 'Meera Joshi', status: 'On Time', checkIn: '10:10 AM', checkOut: '01:00 PM', workMins: 230, isOnBreak: false },
];

const MOCK_HM: HeatmapRow[] = [
  { employeeId: 'm1', name: 'Priya Sharma', days: { Mon: { status: 'On Time', hours: 8 }, Tue: { status: 'On Time', hours: 8 }, Wed: { status: 'Late', hours: 7 }, Thu: { status: 'On Time', hours: 9 }, Fri: { status: 'Early', hours: 8 }, Sat: { status: 'Absent', hours: 0 } } },
  { employeeId: 'm2', name: 'Rahul Verma', days: { Mon: { status: 'Late', hours: 7 }, Tue: { status: 'On Time', hours: 8 }, Wed: { status: 'On Time', hours: 8 }, Thu: { status: 'Absent', hours: 0 }, Fri: { status: 'On Time', hours: 9 }, Sat: { status: 'Absent', hours: 0 } } },
  { employeeId: 'm3', name: 'Neha Gupta', days: { Mon: { status: 'Early', hours: 9 }, Tue: { status: 'Early', hours: 9 }, Wed: { status: 'On Time', hours: 8 }, Thu: { status: 'On Time', hours: 8 }, Fri: { status: 'On Time', hours: 8 }, Sat: { status: 'On Time', hours: 5 } } },
  { employeeId: 'm4', name: 'Ankit Kumar', days: { Mon: { status: 'Absent', hours: 0 }, Tue: { status: 'Absent', hours: 0 }, Wed: { status: 'On Time', hours: 7 }, Thu: { status: 'Late', hours: 6 }, Fri: { status: 'On Time', hours: 8 }, Sat: { status: 'Absent', hours: 0 } } },
  { employeeId: 'm5', name: 'Meera Joshi', days: { Mon: { status: 'On Time', hours: 8 }, Tue: { status: 'On Time', hours: 8 }, Wed: { status: 'On Time', hours: 8 }, Thu: { status: 'Early', hours: 9 }, Fri: { status: 'Late', hours: 6 }, Sat: { status: 'Absent', hours: 0 } } },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMins(m: number) {
  if (!m) return '0h 0m';
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function getWeekStr(): string {
  const today = new Date();
  const year = today.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const diff = today.getTime() - startOfYear.getTime();
  const weekNum = Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${year}-${String(weekNum).padStart(2, '0')}`;
}

function getISTDateStr(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffset).toISOString().split('T')[0];
}

// FIX: single safe ID extractor used everywhere — never crashes on null
function getEmpId(employeeId: any): string {
  if (!employeeId) return '';
  if (typeof employeeId === 'object') return String(employeeId?._id || '');
  return String(employeeId);
}

// ─── Page shell — splits auth loading from content ────────────────────────────

export default function AttendancePage() {
  const { user, loading: authLoading } = useAuth();

  // FIX: show skeleton while auth loads — prevents ALL null._id crashes
  if (authLoading) {
    return (
      <AppLayout title="Attendance" subtitle="Team presence and time tracking">
        <div className="space-y-3">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!user) return null;

  // FIX: key={user._id || user.id} forces full remount on account switch
  // This is the nuclear fix for role switch stale state
  return <AttendanceContent key={String((user as any)?._id || (user as any)?.id || 'guest')} user={user} />;
}

// ─── Content — only renders when user is guaranteed non-null ──────────────────

function AttendanceContent({ user }: { user: any }) {
  const isManager = user?.role === 'admin' || user?.role === 'manager';

  const [currentTime, setCurrentTime] = useState(new Date());
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [loading, setLoading] = useState(true);
  const [emps, setEmps] = useState<Employee[]>(MOCK_EMPS);
  const [hm, setHm] = useState<HeatmapRow[]>(MOCK_HM);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [myAtt, setMyAtt] = useState<any>(null);
  const [myUid, setMyUid] = useState<string>('');
  const [locLoading, setLocLoading] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [empDetail, setEmpDetail] = useState<DailyReport | null>(null);

  // Ticking clock
  useEffect(() => {
    clockRef.current = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => { if (clockRef.current) clearInterval(clockRef.current); };
  }, []);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const weekStr = getWeekStr();
      const dateStr = getISTDateStr();

      const [statusRes, reportRes, hmRes] = await Promise.allSettled([
        fetch('/api/attendance/status').then(r => r.ok ? r.json() : null),
        fetch(`/api/attendance/daily-report?date=${dateStr}`).then(r => r.ok ? r.json() : []),
        fetch(`/api/attendance?week=${weekStr}`).then(r => r.ok ? r.json() : []),
      ]);

      // My status
      if (statusRes.status === 'fulfilled' && statusRes.value?.user) {
        const att = statusRes.value;
        const realId = getEmpId(att.attendance?.employeeId) || getEmpId(att.user?._id) || String(att.user?.id || '');

        if (realId) {
          setMyUid(realId);
          setMyAtt(att);

          const empEntry: Employee = {
            _id: realId,
            name: att.user?.fullName || att.user?.email || 'Unknown',
            status: att.attendance?.dayStatus || 'Absent',
            checkIn: att.lastSession?.checkIn ? format(new Date(att.lastSession.checkIn), 'hh:mm a') : null,
            checkOut: att.lastSession?.checkOut ? format(new Date(att.lastSession.checkOut), 'hh:mm a') : null,
            workMins: att.attendance?.totalWorkMins || 0,
            isOnBreak: att.isOnBreak || false,
          };

          setEmps(prev => {
            const exists = prev.find(e => e._id === realId);
            if (exists) return prev.map(e => e._id === realId ? empEntry : e);
            return [...prev, empEntry];
          });

          if (att.attendance) {
            const dayIdx = new Date().getDay();
            const todayDay = WEEK_DAYS[dayIdx === 0 ? 6 : dayIdx - 1];
            const hours = parseFloat(((att.attendance.totalWorkMins || 0) / 60).toFixed(1));
            setHm(prev => {
              const exists = prev.find(h => h.employeeId === realId);
              const dayEntry = { status: att.attendance.dayStatus as DayStatus, hours };
              if (exists) return prev.map(h => h.employeeId === realId ? { ...h, days: { ...h.days, [todayDay]: dayEntry } } : h);
              return [...prev, { employeeId: realId, name: att.user?.fullName || '', days: { [todayDay]: dayEntry } }];
            });
          }
        }
      }

      // Daily reports
      if (reportRes.status === 'fulfilled' && Array.isArray(reportRes.value) && reportRes.value.length > 0) {
        setReports(reportRes.value);
        if (isManager) {
          setEmps(prev => {
            const updated = [...prev];
            for (const r of reportRes.value as DailyReport[]) {
              const rid = getEmpId(r.employeeId);
              if (!rid) continue;
              const idx = updated.findIndex(e => e._id === rid);
              const entry: Employee = {
                _id: rid,
                name: r.name || 'Unknown',
                status: r.dayStatus,
                checkIn: r.checkIn ? format(new Date(r.checkIn), 'hh:mm a') : null,
                checkOut: r.checkOut ? format(new Date(r.checkOut), 'hh:mm a') : null,
                workMins: r.totalWorkMins || 0,
                isOnBreak: false,
              };
              if (idx >= 0) updated[idx] = entry;
              else if (!updated.find(e => e._id === rid)) updated.push(entry);
            }
            return updated;
          });
        }
      }

      // Heatmap
      if (hmRes.status === 'fulfilled' && Array.isArray(hmRes.value) && hmRes.value.length > 0) {
        const grouped: Record<string, HeatmapRow> = {};
        for (const entry of hmRes.value as any[]) {
          const eid = getEmpId(entry.employeeId) || String(entry.employeeId || '');
          if (!eid || !entry.date) continue;
          const dayOfWeek = new Date(entry.date).getDay();
          const dayLabel = WEEK_DAYS[dayOfWeek === 0 ? 6 : dayOfWeek - 1];
          if (!grouped[eid]) grouped[eid] = { employeeId: eid, name: entry.employeeName || 'Unknown', days: {} };
          grouped[eid].days[dayLabel] = { status: entry.dayStatus as DayStatus, hours: entry.totalWorkHours || 0 };
        }
        const newHm = Object.values(grouped);
        if (newHm.length > 0) setHm(newHm);
      }

    } catch (err) {
      console.error('fetchAll error:', err);
    } finally {
      setLoading(false);
    }
  }, [isManager]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const getCoords = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
      );
    });

  // FIX: hard guard — cannot auto-fire, only fires on button click with check
  const doCheckin = async () => {
    if (myAtt?.isCheckedIn) { toast.error('Already checked in'); return; }
    setLocLoading(true);
    try {
      const coords = await getCoords();
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords?.lat, lng: coords?.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed');
      toast.success(coords ? '✓ Checked in with location!' : '✓ Checked in');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLocLoading(false);
    }
  };

  // FIX: hard guard — cannot auto-fire
  const doCheckout = async () => {
    if (!myAtt?.isCheckedIn) { toast.error('Not checked in'); return; }
    setLocLoading(true);
    try {
      const coords = await getCoords();
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: coords?.lat, lng: coords?.lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-out failed');
      toast.success('✓ Checked out');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLocLoading(false);
    }
  };

  const doBreak = async (action: 'start' | 'end', type: string = 'short') => {
    try {
      const res = await fetch('/api/attendance/break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, type }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error); return; }
      if (data.warning) toast.warning(data.warning);
      else toast.success(action === 'start' ? `${type} break started` : 'Break ended');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // ─── Drill-down ──────────────────────────────────────────────────────────────

  const openDrillDown = (e: Employee) => {
    setSelectedEmp(e);
    // FIX: safe find
    const report = reports.find(r => r?.employeeId && getEmpId(r.employeeId) === e._id);
    setEmpDetail(report || null);
  };

  const closeDrillDown = () => { setSelectedEmp(null); setEmpDetail(null); };

  // ─── Derived ─────────────────────────────────────────────────────────────────

  // FIX: safe find
  const myReport = reports.find(r => r?.employeeId && myUid && getEmpId(r.employeeId) === myUid);

  const present = emps.filter(e => e.status !== 'Absent').length;
  const late = emps.filter(e => e.status === 'Late').length;
  const onBreak = emps.filter(e => e.isOnBreak).length;
  const isCheckedIn = myAtt?.isCheckedIn || false;
  const isOnBreak = myAtt?.isOnBreak || false;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Attendance" subtitle="Team presence and time tracking">

      {/* Employee — 2 tabs */}
      {!isManager && (
        <Tabs defaultValue="clock" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="clock" className="text-xs gap-1"><Clock size={12} /> Clock In/Out</TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs gap-1"><CalendarDays size={12} /> My Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="clock">
            <ClockTab currentTime={currentTime} myAtt={myAtt} isCheckedIn={isCheckedIn}
              isOnBreak={isOnBreak} locLoading={locLoading}
              doCheckin={doCheckin} doCheckout={doCheckout} doBreak={doBreak} />
          </TabsContent>

          <TabsContent value="timeline">
            <div className="kpi-card">
              <h3 className="font-semibold text-xs mb-4">My Today's Timeline</h3>
              {loading ? <Skeleton className="h-32 rounded-xl" /> :
                myReport && (myReport.timeline?.length || 0) > 0 ? (
                  <div className="space-y-3">
                    {myReport.timeline.map((t, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-16 text-[10px] text-muted-foreground text-right shrink-0">
                          {format(new Date(t.time), 'hh:mm a')}
                        </div>
                        <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                        <div className="text-xs text-foreground">{t.event}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    No events yet today. Check in to start tracking.
                  </p>
                )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Manager/Admin — 5 tabs */}
      {isManager && (
        <Tabs defaultValue="heatmap" className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 h-auto">
            <TabsTrigger value="heatmap" className="text-xs gap-1"><BarChart2 size={12} /> Heatmap</TabsTrigger>
            <TabsTrigger value="live" className="text-xs gap-1"><Activity size={12} /> Live Status</TabsTrigger>
            <TabsTrigger value="summary" className="text-xs gap-1"><Users size={12} /> Daily Summary</TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs gap-1"><CalendarDays size={12} /> Timeline</TabsTrigger>
            <TabsTrigger value="clock" className="text-xs gap-1"><Clock size={12} /> Clock In/Out</TabsTrigger>
          </TabsList>

          {/* Heatmap */}
          <TabsContent value="heatmap">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kpi-card overflow-x-auto">
              <h3 className="font-semibold text-xs text-foreground mb-4">Weekly Attendance Heatmap</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium min-w-[120px]">Employee</th>
                    {WEEK_DAYS.map(d => <th key={d} className="text-center py-2 px-2 font-medium w-16">{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {hm.map((row, i) => (
                    <motion.tr key={row.employeeId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}>
                      <td className="py-2 pr-4 font-medium text-foreground whitespace-nowrap">{row.name}</td>
                      {WEEK_DAYS.map(d => {
                        const day = row.days[d];
                        const s: DayStatus = day?.status || 'Absent';
                        const hrs = day?.hours || 0;
                        return (
                          <td key={d} className="py-2 px-1 text-center">
                            <div className="w-12 h-9 rounded mx-auto flex flex-col items-center justify-center" style={{ background: HM_COLOR[s] }}>
                              {hrs > 0
                                ? <span className="text-[9px] font-bold text-white">{hrs}h</span>
                                : <span className="text-[9px] font-semibold text-white/70">—</span>}
                            </div>
                          </td>
                        );
                      })}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-4 mt-4 flex-wrap">
                {Object.entries(HM_COLOR).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <div className="w-3 h-3 rounded" style={{ background: v }} />{k}
                  </div>
                ))}
              </div>
            </motion.div>
          </TabsContent>

          {/* Live Status */}
          <TabsContent value="live">
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Present', value: present, color: 'text-green-600' },
                { label: 'Late', value: late, color: 'text-red-600' },
                { label: 'On Break', value: onBreak, color: 'text-yellow-600' },
              ].map(s => (
                <div key={s.label} className="kpi-card text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {emps.map((e, i) => (
                <motion.div key={e._id}
                  className="kpi-card cursor-pointer hover:border-accent/40 hover:shadow-sm transition-all"
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  onClick={() => openDrillDown(e)}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-accent">{(e.name || '?')[0]}</span>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">{e.name}</p>
                        {e.isOnBreak && <p className="text-[10px] text-yellow-600">On Break</p>}
                      </div>
                    </div>
                    <Badge className={`text-[10px] ${STATUS_COLOR[e.status]}`}>{e.status}</Badge>
                  </div>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    {e.checkIn && <span className="flex items-center gap-0.5"><Clock size={10} /> {e.checkIn}</span>}
                    {e.checkOut && <span className="flex items-center gap-0.5"><XCircle size={10} /> {e.checkOut}</span>}
                    {e.workMins > 0 && <span className="flex items-center gap-0.5"><Timer size={10} /> {fmtMins(e.workMins)}</span>}
                  </div>
                  <p className="text-[9px] text-accent mt-1.5">Click to view details →</p>
                </motion.div>
              ))}
            </div>
          </TabsContent>

          {/* Daily Summary */}
          <TabsContent value="summary">
            <div className="kpi-card overflow-x-auto">
              <h3 className="font-semibold text-xs mb-4">Today's Attendance Summary</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 px-3">Employee</th>
                    <th className="text-center py-2 px-3">Status</th>
                    <th className="text-center py-2 px-3">Check In</th>
                    <th className="text-center py-2 px-3">Check Out</th>
                    <th className="text-center py-2 px-3">Net Work</th>
                    <th className="text-center py-2 px-3">Leads</th>
                    <th className="text-center py-2 px-3">Calls</th>
                    <th className="text-center py-2 px-3">Visits</th>
                    <th className="text-center py-2 px-3">Geo</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const realIds = new Set(
                      reports.filter(r => r?.employeeId).map(r => getEmpId(r.employeeId)).filter(Boolean)
                    );
                    const mockRows = emps.filter(e => !realIds.has(e._id));
                    const allRows = [
                      ...reports.filter(r => r?.employeeId).map(r => ({ _id: getEmpId(r.employeeId), isReal: true, r })),
                      ...mockRows.map(e => ({ _id: e._id, isReal: false, e })),
                    ].sort((a, b) => (a._id === myUid ? -1 : b._id === myUid ? 1 : 0));

                    return allRows.map(row => {
                      if (row.isReal) {
                        const r = (row as any).r as DailyReport;
                        return (
                          <tr key={row._id} className={`border-b border-border/50 ${row._id === myUid ? 'bg-accent/5' : 'hover:bg-secondary/30'}`}>
                            <td className="py-2.5 px-3 font-medium">
                              {r.name}
                              {row._id === myUid && <span className="text-[9px] text-accent ml-1">(you)</span>}
                              {(r.breakFlags?.length || 0) > 0 && <span className="ml-1 text-[9px] text-red-500">⚠️</span>}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <Badge className={`text-[10px] ${STATUS_COLOR[r.dayStatus]}`}>{r.dayStatus}</Badge>
                            </td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">{r.checkIn ? format(new Date(r.checkIn), 'hh:mm a') : '—'}</td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">{r.checkOut ? format(new Date(r.checkOut), 'hh:mm a') : '—'}</td>
                            <td className="py-2.5 px-3 text-center font-medium">{fmtMins(r.totalWorkMins)}</td>
                            <td className="py-2.5 px-3 text-center font-semibold text-blue-600">{r.crmActivity?.leadsContacted || 0}</td>
                            <td className="py-2.5 px-3 text-center font-semibold text-green-600">{r.crmActivity?.callsMade || 0}</td>
                            <td className="py-2.5 px-3 text-center font-semibold text-purple-600">{r.crmActivity?.visitsScheduled || 0}</td>
                            <td className="py-2.5 px-3 text-center">
                              {r.isWithinGeofence ? <CheckCircle size={13} className="text-green-500 mx-auto" /> : <XCircle size={13} className="text-red-400 mx-auto" />}
                            </td>
                          </tr>
                        );
                      } else {
                        const e = (row as any).e as Employee;
                        return (
                          <tr key={e._id} className="border-b border-border/50 hover:bg-secondary/30">
                            <td className="py-2.5 px-3 font-medium text-muted-foreground">{e.name}</td>
                            <td className="py-2.5 px-3 text-center"><Badge className={`text-[10px] ${STATUS_COLOR[e.status]}`}>{e.status}</Badge></td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">{e.checkIn || '—'}</td>
                            <td className="py-2.5 px-3 text-center text-muted-foreground">{e.checkOut || '—'}</td>
                            <td className="py-2.5 px-3 text-center">{fmtMins(e.workMins)}</td>
                            <td colSpan={4} className="py-2.5 px-3 text-center text-muted-foreground">—</td>
                          </tr>
                        );
                      }
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Timeline */}
          <TabsContent value="timeline">
            <div className="kpi-card">
              <h3 className="font-semibold text-xs mb-4">Today's Timeline</h3>
              {loading ? <Skeleton className="h-32 rounded-xl" /> :
                myReport && (myReport.timeline?.length || 0) > 0 ? (
                  <div className="space-y-3">
                    <p className="text-[10px] text-muted-foreground mb-3">Showing your timeline</p>
                    {myReport.timeline.map((t, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-16 text-[10px] text-muted-foreground text-right shrink-0">{format(new Date(t.time), 'hh:mm a')}</div>
                        <div className="w-2 h-2 rounded-full bg-accent shrink-0" />
                        <div className="text-xs text-foreground">{t.event}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-8">No timeline events yet today.</p>
                )}
            </div>
          </TabsContent>

          {/* Clock */}
          <TabsContent value="clock">
            <ClockTab currentTime={currentTime} myAtt={myAtt} isCheckedIn={isCheckedIn}
              isOnBreak={isOnBreak} locLoading={locLoading}
              doCheckin={doCheckin} doCheckout={doCheckout} doBreak={doBreak} />
          </TabsContent>
        </Tabs>
      )}

      {/* Drill-down modal */}
      {selectedEmp && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={closeDrillDown}>
          <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
            className="bg-card rounded-2xl border border-border p-6 w-full max-w-md max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-accent">{(selectedEmp.name || '?')[0]}</span>
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">{selectedEmp.name}</p>
                  <Badge className={`text-[10px] ${STATUS_COLOR[selectedEmp.status]}`}>{selectedEmp.status}</Badge>
                </div>
              </div>
              <button onClick={closeDrillDown}
                className="text-muted-foreground hover:text-foreground text-lg font-bold w-8 h-8 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                { label: 'Check In', value: selectedEmp.checkIn || '—' },
                { label: 'Check Out', value: selectedEmp.checkOut || 'Active' },
                { label: 'Work Time', value: fmtMins(selectedEmp.workMins), highlight: 'text-green-600' },
                { label: 'On Break', value: selectedEmp.isOnBreak ? '🟡 Yes' : '—' },
              ].map(s => (
                <div key={s.label} className="p-3 rounded-xl bg-secondary/50 text-center">
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className={`text-sm font-semibold ${(s as any).highlight || ''}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {empDetail?.crmActivity && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-foreground mb-2">CRM Activity Today</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg bg-blue-50 text-center">
                    <p className="text-base font-bold text-blue-600">{empDetail.crmActivity.leadsContacted}</p>
                    <p className="text-[9px] text-blue-500">Leads</p>
                  </div>
                  <div className="p-2 rounded-lg bg-green-50 text-center">
                    <p className="text-base font-bold text-green-600">{empDetail.crmActivity.callsMade}</p>
                    <p className="text-[9px] text-green-500">Calls</p>
                  </div>
                  <div className="p-2 rounded-lg bg-purple-50 text-center">
                    <p className="text-base font-bold text-purple-600">{empDetail.crmActivity.visitsScheduled}</p>
                    <p className="text-[9px] text-purple-500">Visits</p>
                  </div>
                </div>
              </div>
            )}

            {(empDetail?.breakFlags?.length || 0) > 0 && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200">
                <p className="text-xs font-semibold text-red-600 mb-1">⚠️ Break Limit Exceeded</p>
                {empDetail!.breakFlags!.map((f, i) => <p key={i} className="text-[11px] text-red-500">{f}</p>)}
              </div>
            )}

            {(empDetail?.breaks?.length || 0) > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-foreground mb-2">Break History</p>
                <div className="space-y-1.5">
                  {empDetail!.breaks.map((b: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-[11px] p-2 rounded-lg bg-secondary/30">
                      <span className="capitalize text-foreground">{b.type} break</span>
                      <span className="text-muted-foreground">
                        {b.startTime ? format(new Date(b.startTime), 'hh:mm a') : '—'}
                        {b.endTime ? ` → ${format(new Date(b.endTime), 'hh:mm a')}` : ' → ongoing'}
                      </span>
                      <span className={`font-semibold ${b.durationMins > (b.type === 'lunch' ? 45 : b.type === 'personal' ? 15 : 10) ? 'text-red-500' : 'text-green-600'}`}>
                        {b.durationMins != null ? `${b.durationMins}m` : '...'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(empDetail?.timeline?.length || 0) > 0 && (
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">Activity Log</p>
                <div className="space-y-2">
                  {empDetail!.timeline.map((t, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-14 text-[10px] text-muted-foreground text-right shrink-0">{format(new Date(t.time), 'hh:mm a')}</div>
                      <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                      <div className="text-[11px] text-foreground">{t.event}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!empDetail && <p className="text-xs text-muted-foreground text-center py-4">No detailed records for this employee today.</p>}
          </motion.div>
        </motion.div>
      )}
    </AppLayout>
  );
}

// ─── Clock Tab ────────────────────────────────────────────────────────────────

function ClockTab({ currentTime, myAtt, isCheckedIn, isOnBreak, locLoading, doCheckin, doCheckout, doBreak }: {
  currentTime: Date; myAtt: any; isCheckedIn: boolean; isOnBreak: boolean;
  locLoading: boolean; doCheckin: () => void; doCheckout: () => void;
  doBreak: (action: 'start' | 'end', type?: string) => void;
}) {
  return (
    <div className="max-w-sm mx-auto space-y-4">
      <div className="kpi-card text-center">
        <p className="text-3xl font-bold text-foreground mb-1 tabular-nums" suppressHydrationWarning>
          {format(currentTime, 'hh:mm:ss a')}
        </p>
        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
          {format(currentTime, 'EEEE, MMMM d yyyy')}
        </p>
      </div>

      {myAtt && (
        <div className="kpi-card space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Status</span>
            <Badge className={`text-[10px] ${
              myAtt.attendance?.dayStatus === 'On Time' ? 'bg-green-100 text-green-700' :
              myAtt.attendance?.dayStatus === 'Early' ? 'bg-blue-100 text-blue-700' :
              myAtt.attendance?.dayStatus === 'Late' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-500'
            }`}>{myAtt.attendance?.dayStatus || 'Not checked in'}</Badge>
          </div>
          {myAtt.lastSession?.checkIn && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Checked in at</span>
              <span className="font-medium">{format(new Date(myAtt.lastSession.checkIn), 'hh:mm a')}</span>
            </div>
          )}
          {(myAtt.attendance?.totalWorkMins || 0) > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Work time</span>
              <span className="font-medium text-green-600">{fmtMins(myAtt.attendance.totalWorkMins)}</span>
            </div>
          )}
          {isOnBreak && myAtt.openBreak?.startTime && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">On break since</span>
              <span className="text-yellow-600 font-medium">
                {formatDistanceToNow(new Date(myAtt.openBreak.startTime), { addSuffix: true })}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={doCheckin} disabled={locLoading || isCheckedIn}
          className="h-14 gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
          <CheckCircle size={18} /> Check In
        </Button>
        <Button onClick={doCheckout} disabled={locLoading || !isCheckedIn}
          variant="outline" className="h-14 gap-2 border-red-400 text-red-600 hover:bg-red-50 disabled:opacity-50">
          <XCircle size={18} /> Check Out
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button onClick={() => isOnBreak ? doBreak('end') : doBreak('start', 'lunch')}
          disabled={locLoading || !isCheckedIn} variant="outline"
          className="h-12 gap-1 text-[11px] flex-col py-1 disabled:opacity-50">
          <Utensils size={14} />
          {isOnBreak ? 'End Break' : 'Lunch'}
          {!isOnBreak && <span className="text-[9px] text-muted-foreground">45 min</span>}
        </Button>
        <Button onClick={() => doBreak('start', 'short')}
          disabled={locLoading || !isCheckedIn || isOnBreak} variant="outline"
          className="h-12 gap-1 text-[11px] flex-col py-1 disabled:opacity-50">
          <Coffee size={14} />
          Short
          <span className="text-[9px] text-muted-foreground">10 min</span>
        </Button>
        <Button onClick={() => doBreak('start', 'personal')}
          disabled={locLoading || !isCheckedIn || isOnBreak} variant="outline"
          className="h-12 gap-1 text-[11px] flex-col py-1 disabled:opacity-50">
          <Timer size={14} />
          Personal
          <span className="text-[9px] text-muted-foreground">15 min</span>
        </Button>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground px-1">
        <MapPin size={11} />
        <span>
          Geo-fence:{' '}
          {myAtt?.attendance?.isWithinGeofence
            ? <span className="text-green-600 font-medium">✓ Within office (100m)</span>
            : <span className="text-muted-foreground">Location not verified</span>}
        </span>
      </div>
    </div>
  );
}