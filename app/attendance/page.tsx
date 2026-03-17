"use client";

import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { Clock, MapPin, CheckCircle, XCircle, Coffee, Timer, Users, Activity, BarChart2, CalendarDays } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

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
  days: Record<string, DayStatus>;
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
}

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

const MOCK_EMPS: Employee[] = [
  { _id: 'm1', name: 'Priya Sharma', status: 'On Time', checkIn: '09:02 AM', checkOut: null, workMins: 320, isOnBreak: false },
  { _id: 'm2', name: 'Rahul Verma', status: 'Late', checkIn: '09:45 AM', checkOut: null, workMins: 210, isOnBreak: true },
  { _id: 'm3', name: 'Neha Gupta', status: 'Early', checkIn: '08:45 AM', checkOut: null, workMins: 380, isOnBreak: false },
  { _id: 'm4', name: 'Ankit Kumar', status: 'Absent', checkIn: null, checkOut: null, workMins: 0, isOnBreak: false },
  { _id: 'm5', name: 'Meera Joshi', status: 'On Time', checkIn: '09:10 AM', checkOut: '01:00 PM', workMins: 230, isOnBreak: false },
];

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MOCK_HM: HeatmapRow[] = [
  { employeeId: 'm1', name: 'Priya Sharma', days: { Mon: 'On Time', Tue: 'On Time', Wed: 'Late', Thu: 'On Time', Fri: 'Early', Sat: 'Absent' } },
  { employeeId: 'm2', name: 'Rahul Verma', days: { Mon: 'Late', Tue: 'On Time', Wed: 'On Time', Thu: 'Absent', Fri: 'On Time', Sat: 'Absent' } },
  { employeeId: 'm3', name: 'Neha Gupta', days: { Mon: 'Early', Tue: 'Early', Wed: 'On Time', Thu: 'On Time', Fri: 'On Time', Sat: 'On Time' } },
  { employeeId: 'm4', name: 'Ankit Kumar', days: { Mon: 'Absent', Tue: 'Absent', Wed: 'On Time', Thu: 'Late', Fri: 'On Time', Sat: 'Absent' } },
  { employeeId: 'm5', name: 'Meera Joshi', days: { Mon: 'On Time', Tue: 'On Time', Wed: 'On Time', Thu: 'Early', Fri: 'Late', Sat: 'Absent' } },
];

function fmtMins(m: number) {
  if (!m) return '0h 0m';
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function AttendancePage() {
  const [loading, setLoading] = useState(true);
  const [emps, setEmps] = useState<Employee[]>(MOCK_EMPS);
  const [hm, setHm] = useState<HeatmapRow[]>(MOCK_HM);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [myAtt, setMyAtt] = useState<any>(null);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [locLoading, setLocLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      const year = today.getFullYear();
      const startOfYear = new Date(year, 0, 1);
      const weekNum = Math.ceil(((today.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekStr = `${year}-${String(weekNum).padStart(2, '0')}`;
      const dateStr = today.toISOString().split('T')[0];

      const [empRes, hmRes, statusRes, reportRes] = await Promise.allSettled([
        fetch('/api/employees').then(r => r.ok ? r.json() : []),
        fetch(`/api/attendance?week=${weekStr}`).then(r => r.ok ? r.json() : []),
        fetch('/api/attendance/status').then(r => r.ok ? r.json() : null),
        fetch(`/api/attendance/daily-report?date=${dateStr}`).then(r => r.ok ? r.json() : []),
      ]);

      // Process status (my own)
      if (statusRes.status === 'fulfilled' && statusRes.value?.user) {
        const att = statusRes.value;
        const rawId = att.attendance?.employeeId;
        const realId = rawId?._id || rawId || att.user?._id;
        if (realId) {
          setMyUid(String(realId));
          setMyAtt(att);

          // Inject my real data into emps
          const empFromStatus: Employee = {
            _id: String(realId),
            name: att.user.fullName || att.user.email,
            status: att.attendance?.dayStatus || 'Absent',
            checkIn: att.lastSession?.checkIn ? format(new Date(att.lastSession.checkIn), 'hh:mm a') : null,
            checkOut: att.lastSession?.checkOut ? format(new Date(att.lastSession.checkOut), 'hh:mm a') : null,
            workMins: att.attendance?.totalWorkMins || 0,
            isOnBreak: att.isOnBreak || false,
          };
          setEmps(prev => {
            const exists = prev.find(e => e._id === String(realId));
            if (exists) return prev.map(e => e._id === String(realId) ? empFromStatus : e);
            return [...prev, empFromStatus];
          });

          // Inject into heatmap
          if (att.attendance) {
            const today = new Date();
            const dayName = WEEK_DAYS[today.getDay() === 0 ? 6 : today.getDay() - 1];
            setHm(prev => {
              const exists = prev.find(h => h.employeeId === String(realId));
              const newRow: HeatmapRow = exists
                ? { ...exists, days: { ...exists.days, [dayName]: att.attendance.dayStatus as DayStatus } }
                : { employeeId: String(realId), name: att.user.fullName, days: { [dayName]: att.attendance.dayStatus as DayStatus } };
              if (exists) return prev.map(h => h.employeeId === String(realId) ? newRow : h);
              return [...prev, newRow];
            });
          }
        }
      }

      // Merge real employees
      if (empRes.status === 'fulfilled' && Array.isArray(empRes.value)) {
        setEmps(prev => {
          const newEmps = [...prev];
          for (const e of empRes.value) {
            const id = e._id || e.id;
            if (!newEmps.find(x => x._id === id)) {
              newEmps.push({ _id: id, name: e.fullName || e.name || e.email, status: 'Absent', checkIn: null, checkOut: null, workMins: 0, isOnBreak: false });
            }
          }
          return newEmps;
        });
      }

      // Merge real reports
      if (reportRes.status === 'fulfilled' && Array.isArray(reportRes.value)) {
        setReports(reportRes.value);
      }

    } catch (err) {
      console.error('fetchAll error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const doCheckin = async () => {
    setLocLoading(true);
    try {
      let lat: number | undefined, lng: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* geo not available */ }

      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-in failed');
      toast.success('Checked in successfully!');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLocLoading(false);
    }
  };

  const doCheckout = async () => {
    setLocLoading(true);
    try {
      let lat: number | undefined, lng: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* geo not available */ }

      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check-out failed');
      toast.success('Checked out successfully!');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLocLoading(false);
    }
  };

  const doBreak = async (action: 'start' | 'end', type = 'short') => {
    const res = await fetch('/api/attendance/break', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, type }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(action === 'start' ? 'Break started' : 'Break ended');
    fetchAll();
  };

  const myReport = reports.find(r => {
    const id = typeof r.employeeId === 'object' ? r.employeeId._id : r.employeeId;
    return String(id) === myUid;
  });

  const present = emps.filter(e => e.status !== 'Absent').length;
  const late = emps.filter(e => e.status === 'Late').length;
  const onBreak = emps.filter(e => e.isOnBreak).length;

  return (
    <AppLayout title="Attendance" subtitle="Team presence and time tracking">
      <Tabs defaultValue="heatmap" className="space-y-4">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="heatmap" className="text-xs gap-1"><BarChart2 size={12} /> Heatmap</TabsTrigger>
          <TabsTrigger value="live" className="text-xs gap-1"><Activity size={12} /> Live Status</TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs gap-1"><CalendarDays size={12} /> Timeline</TabsTrigger>
          <TabsTrigger value="summary" className="text-xs gap-1"><Users size={12} /> Daily Summary</TabsTrigger>
          <TabsTrigger value="clock" className="text-xs gap-1"><Clock size={12} /> Clock In/Out</TabsTrigger>
        </TabsList>

        {/* HEATMAP */}
        <TabsContent value="heatmap">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kpi-card overflow-x-auto">
            <h3 className="font-semibold text-xs text-foreground mb-4">Weekly Attendance Heatmap</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Employee</th>
                  {WEEK_DAYS.map(d => <th key={d} className="text-center py-2 px-2 font-medium w-16">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {hm.map((row, i) => (
                  <motion.tr key={row.employeeId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}>
                    <td className="py-2 pr-4 font-medium text-foreground whitespace-nowrap">{row.name}</td>
                    {WEEK_DAYS.map(d => {
                      const s = row.days[d] || 'Absent';
                      return (
                        <td key={d} className="py-2 px-1 text-center">
                          <div className="w-10 h-8 rounded mx-auto flex items-center justify-center text-[9px] font-semibold text-white"
                            style={{ background: HM_COLOR[s as DayStatus] }}>
                            {s === 'Absent' ? '—' : s === 'On Time' ? 'OK' : s === 'Early' ? 'E' : 'L'}
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
                  <div className="w-3 h-3 rounded" style={{ background: v }} />
                  {k}
                </div>
              ))}
            </div>
          </motion.div>
        </TabsContent>

        {/* LIVE STATUS */}
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
              <motion.div key={e._id} className="kpi-card" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                      <span className="text-xs font-bold text-accent">{e.name[0]}</span>
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
              </motion.div>
            ))}
          </div>
        </TabsContent>

        {/* TIMELINE */}
        <TabsContent value="timeline">
          <div className="kpi-card">
            <h3 className="font-semibold text-xs mb-4">My Today's Timeline</h3>
            {loading ? <Skeleton className="h-32 rounded-xl" /> : myReport ? (
              <div className="space-y-3">
                {myReport.timeline.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-16 text-[10px] text-muted-foreground text-right">{format(new Date(t.time), 'hh:mm a')}</div>
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    <div className="text-xs text-foreground">{t.event}</div>
                  </div>
                ))}
                {myReport.timeline.length === 0 && <p className="text-xs text-muted-foreground">No events yet today</p>}
              </div>
            ) : (
              <div className="space-y-3">
                {[{ time: '09:02 AM', event: 'Check In' }, { time: '01:00 PM', event: 'Lunch Break Start' }, { time: '02:00 PM', event: 'Lunch Break End' }].map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-16 text-[10px] text-muted-foreground text-right">{t.time}</div>
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    <div className="text-xs text-foreground">{t.event}</div>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground mt-2">← Sample data. Log in and check in to see your real timeline.</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* DAILY SUMMARY */}
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
                  <th className="text-center py-2 px-3">Work Time</th>
                  <th className="text-center py-2 px-3">Geo</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Merge mock + real, real user on top
                  const realIds = new Set(reports.map(r => {
                    const id = typeof r.employeeId === 'object' ? r.employeeId._id : r.employeeId;
                    return String(id);
                  }));
                  const mockRows = emps.filter(e => !realIds.has(e._id));
                  const allRows = [
                    ...reports.map(r => {
                      const id = typeof r.employeeId === 'object' ? r.employeeId._id : r.employeeId;
                      return { _id: String(id), isReal: true, r };
                    }),
                    ...mockRows.map(e => ({ _id: e._id, isReal: false, e })),
                  ].sort((a, b) => {
                    if (a._id === myUid) return -1;
                    if (b._id === myUid) return 1;
                    return 0;
                  });

                  return allRows.map((row, i) => {
                    if (row.isReal) {
                      const r = (row as any).r as DailyReport;
                      return (
                        <tr key={row._id} className={`border-b border-border/50 ${row._id === myUid ? 'bg-accent/5' : 'hover:bg-secondary/30'}`}>
                          <td className="py-2.5 px-3 font-medium">{r.name} {row._id === myUid && <span className="text-[9px] text-accent ml-1">(you)</span>}</td>
                          <td className="py-2.5 px-3 text-center"><Badge className={`text-[10px] ${STATUS_COLOR[r.dayStatus]}`}>{r.dayStatus}</Badge></td>
                          <td className="py-2.5 px-3 text-center text-muted-foreground">{r.checkIn ? format(new Date(r.checkIn), 'hh:mm a') : '—'}</td>
                          <td className="py-2.5 px-3 text-center text-muted-foreground">{r.checkOut ? format(new Date(r.checkOut), 'hh:mm a') : '—'}</td>
                          <td className="py-2.5 px-3 text-center">{fmtMins(r.totalWorkMins)}</td>
                          <td className="py-2.5 px-3 text-center">{r.isWithinGeofence ? <CheckCircle size={13} className="text-green-500 mx-auto" /> : <XCircle size={13} className="text-red-400 mx-auto" />}</td>
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
                          <td className="py-2.5 px-3 text-center text-muted-foreground">—</td>
                        </tr>
                      );
                    }
                  });
                })()}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* CLOCK IN/OUT */}
        <TabsContent value="clock">
          <div className="max-w-sm mx-auto space-y-4">
            <div className="kpi-card text-center">
              <p className="text-3xl font-bold text-foreground mb-1">{format(new Date(), 'hh:mm a')}</p>
              <p className="text-xs text-muted-foreground">{format(new Date(), 'EEEE, MMMM d yyyy')}</p>
            </div>

            {myAtt && (
              <div className="kpi-card space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className={`text-[10px] ${STATUS_COLOR[myAtt.attendance?.dayStatus || 'Absent']}`}>
                    {myAtt.attendance?.dayStatus || 'Not checked in'}
                  </Badge>
                </div>
                {myAtt.lastSession?.checkIn && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Checked in</span>
                    <span>{format(new Date(myAtt.lastSession.checkIn), 'hh:mm a')}</span>
                  </div>
                )}
                {myAtt.attendance?.totalWorkMins > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Work time</span>
                    <span>{fmtMins(myAtt.attendance.totalWorkMins)}</span>
                  </div>
                )}
                {myAtt.isOnBreak && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">On break since</span>
                    <span className="text-yellow-600">{myAtt.openBreak?.startTime ? formatDistanceToNow(new Date(myAtt.openBreak.startTime), { addSuffix: true }) : 'Now'}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={doCheckin} disabled={locLoading || myAtt?.isCheckedIn} className="h-14 gap-2 bg-green-600 hover:bg-green-700 text-white">
                <CheckCircle size={18} /> Check In
              </Button>
              <Button onClick={doCheckout} disabled={locLoading || !myAtt?.isCheckedIn} variant="outline" className="h-14 gap-2 border-red-400 text-red-600 hover:bg-red-50">
                <XCircle size={18} /> Check Out
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => myAtt?.isOnBreak ? doBreak('end') : doBreak('start', 'lunch')}
                disabled={locLoading || !myAtt?.isCheckedIn}
                variant="outline" className="h-12 gap-2 text-xs">
                <Coffee size={15} /> {myAtt?.isOnBreak ? 'End Break' : 'Lunch Break'}
              </Button>
              <Button onClick={() => doBreak('start', 'short')}
                disabled={locLoading || !myAtt?.isCheckedIn || myAtt?.isOnBreak}
                variant="outline" className="h-12 gap-2 text-xs">
                <Timer size={15} /> Short Break
              </Button>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <MapPin size={11} />
              <span>Geo-fence: {myAtt?.attendance?.isWithinGeofence ? '✓ Within office' : 'Location not verified'}</span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
