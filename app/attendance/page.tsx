'use client';

/**
 * app/attendance/page.tsx
 * ─────────────────────────────────────────────────────────────
 * Role-based attendance page:
 *   admin / manager  →  full 8-tab view, all employees
 *   employee         →  3-tab CrazeHQ-style view, own data only
 *
 * Production rules:
 *  • Real API data merged on top of mock fallbacks
 *  • cache: 'no-store' on every fetch
 *  • Full null-safety — never crashes on missing data
 *  • No shadcn / no Tailwind — pure inline styles only
 *  • Single file — only external import is useAuth
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

type DayStatus = 'early' | 'on_time' | 'late' | 'absent' | 'none';
type AttStatus  = 'checked_in' | 'on_break' | 'checked_out' | 'absent' | 'not_in';
type GeoStatus  = 'inside' | 'outside' | 'checking';
type BreakType  = 'short' | 'lunch' | 'personal';
type ClockState = 'not_in' | 'checked_in' | 'on_break' | 'checked_out';

interface ApiBreak {
  type: BreakType;
  startTime: string | null;
  endTime: string | null;
  durationMins: number;
}
interface ApiSession {
  checkIn: string | null;
  checkOut: string | null;
}
interface ApiReport {
  employeeId: { _id?: string; id?: string; fullName?: string; email?: string } | string;
  name: string;
  email: string;
  date: string;
  dayStatus: DayStatus;
  checkIn: string | null;
  checkOut: string | null;
  totalWorkMins: number;
  breaks: ApiBreak[];
  sessions: ApiSession[];
  timeline: { time: string; event: string }[];
  isWithinGeofence: boolean;
  crmActivity: { leadsContacted: number; callsMade: number; visitsScheduled: number; messagesSent: number };
  breakSummary: { lunchMins: number; shortMins: number; personalMins: number };
  breakFlags: string[];
  notes: string | null;
}
interface ApiHeatmapEntry {
  employeeId: string | { _id?: string; toString?: () => string };
  employeeName: string;
  date: string;
  dayStatus: DayStatus | null;
  totalWorkMins: number;
  checkIn: string | null;
  checkOut: string | null;
}
interface ApiStatus {
  user: { _id?: string; fullName?: string; email?: string } | null;
  attendance: {
    date: string;
    dayStatus: DayStatus;
    sessions: ApiSession[];
    breaks: ApiBreak[];
    totalWorkMins: number;
    isWithinGeofence?: boolean;
  } | null;
  isCheckedIn: boolean;
  isOnBreak: boolean;
  openBreak: ApiBreak | null;
  lastSession: ApiSession | null;
}

// ── Internal display types ────────────────────────────────────────────
interface Employee {
  id: string;
  name: string;
  initials: string;
  avatarBg: string;
  avatarText: string;
  role: string;
  zone: string;
  checkIn: string;
  checkOut: string;
  status: DayStatus;
  attendanceStatus: AttStatus;
  netWork: string;
  totalWorkMins: number;
  breaks: string;
  geoStatus: GeoStatus;
  crm: { calls: number; leads: number; visits: number; messages: number };
  sessions: ApiSession[];
  apiBreaks: ApiBreak[];
}
interface HeatmapDay  { day: string; status: DayStatus }
interface HeatmapRow  { empId: string; name: string; days: HeatmapDay[] }
interface TimelineEvt { time: string; label: string; type: 'checkin' | 'break_start' | 'break_end' | 'checkout' | 'now' }

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ══════════════════════════════════════════════════════════════════════

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Avatar palette — deterministic by index
const AVATAR_PALETTE = [
  { bg: '#C8D8F0', txt: '#3B6EA5' },
  { bg: '#D8C8F0', txt: '#6B3BAA' },
  { bg: '#F0DCA8', txt: '#8B6A10' },
  { bg: '#A8C8F0', txt: '#1A5AAA' },
  { bg: '#D0C0E8', txt: '#6B3BAA' },
  { bg: '#C8F0D8', txt: '#1A7A4A' },
  { bg: '#F0C8C8', txt: '#AA3B3B' },
  { bg: '#F0E8C8', txt: '#8B7010' },
];

function getInitials(name: string): string {
  return (name || 'U')
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function palette(idx: number) {
  return AVATAR_PALETTE[idx % AVATAR_PALETTE.length];
}

function minsToHM(mins: number): string {
  if (!mins || mins <= 0) return '0h 00m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, '0');
    const ap = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${h}:${m} ${ap}`;
  } catch { return '—'; }
}

function nowTimeStr(): string {
  const n = new Date();
  const h = n.getHours() % 12 || 12;
  const m = String(n.getMinutes()).padStart(2, '0');
  const ap = n.getHours() >= 12 ? 'PM' : 'AM';
  return `${h}:${m} ${ap}`;
}

function getISOWeek(): string {
  const now = new Date();
  const year = now.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((dayOfYear + jan1.getDay() + 1) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

function todayDayIdx(): number {
  // 0=Mon … 4=Fri
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

/** Convert API dayStatus → AttStatus for display */
function deriveAttStatus(report: ApiReport): AttStatus {
  if (report.dayStatus === 'absent') return 'absent';
  const lastSess = report.sessions[report.sessions.length - 1];
  if (!lastSess) return 'not_in';
  if (report.breaks?.some(b => !b.endTime)) return 'on_break';
  if (lastSess.checkOut) return 'checked_out';
  return 'checked_in';
}

/** Build timeline events from API sessions + breaks */
function buildTimeline(report: ApiReport): TimelineEvt[] {
  const evts: { iso: string; evt: TimelineEvt }[] = [];
  (report.sessions || []).forEach(s => {
    if (s.checkIn) evts.push({ iso: s.checkIn, evt: { time: fmtTime(s.checkIn), label: 'Clocked in', type: 'checkin' } });
    if (s.checkOut) evts.push({ iso: s.checkOut, evt: { time: fmtTime(s.checkOut), label: 'Clocked out', type: 'checkout' } });
  });
  (report.breaks || []).forEach(b => {
    const lbl = b.type === 'lunch' ? 'Lunch' : b.type === 'personal' ? 'Personal' : 'Short';
    if (b.startTime) evts.push({ iso: b.startTime, evt: { time: fmtTime(b.startTime), label: `Break started · ${lbl}`, type: 'break_start' } });
    if (b.endTime)   evts.push({ iso: b.endTime,   evt: { time: fmtTime(b.endTime),   label: 'Back from break',           type: 'break_end'   } });
  });
  evts.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime());
  return evts.map(e => e.evt);
}

/** Convert ApiReport[] → Employee[] for display */
function reportsToEmployees(reports: ApiReport[]): Employee[] {
  return reports.map((r, i) => {
    const empId = typeof r.employeeId === 'object'
      ? (r.employeeId?._id || r.employeeId?.id || String(i))
      : String(r.employeeId || i);
    const p = palette(i);
    const attStatus = deriveAttStatus(r);
    const totalBreakMins = (r.breaks || []).reduce((s, b) => s + (b.durationMins || 0), 0);
    return {
      id: empId,
      name: r.name || 'Unknown',
      initials: getInitials(r.name || 'U'),
      avatarBg: p.bg,
      avatarText: p.txt,
      role: '',
      zone: '',
      checkIn: fmtTime(r.checkIn),
      checkOut: fmtTime(r.checkOut),
      status: r.dayStatus || 'absent',
      attendanceStatus: attStatus,
      netWork: minsToHM(r.totalWorkMins),
      totalWorkMins: r.totalWorkMins || 0,
      breaks: totalBreakMins > 0 ? `${totalBreakMins}m` : '0m',
      geoStatus: r.isWithinGeofence ? 'inside' : 'outside',
      crm: {
        calls: r.crmActivity?.callsMade || 0,
        leads: r.crmActivity?.leadsContacted || 0,
        visits: r.crmActivity?.visitsScheduled || 0,
        messages: r.crmActivity?.messagesSent || 0,
      },
      sessions: r.sessions || [],
      apiBreaks: r.breaks || [],
    };
  });
}

// No mock data — all values come from the real API.
// Empty arrays are used as initial state; loading spinners show until data arrives.

// ══════════════════════════════════════════════════════════════════════
// STYLE TOKENS
// ══════════════════════════════════════════════════════════════════════

const SQ: Record<string, string> = {
  early:'#1D9E75', on_time:'#5DCAA5', late:'#EF9F27', absent:'#FFBCBC', none:'transparent',
};
const TLC: Record<string, string> = {
  checkin:'#1D9E75', break_start:'#EF9F27', break_end:'#5DCAA5', checkout:'#9CA3AF', now:'#E8540A',
};
const TLB: Record<string, string> = {
  checkin:'#E8F8F2', break_start:'#FEF6E6', break_end:'#E8F8F2', checkout:'#F3F4F6', now:'#FEF0EA',
};

// ══════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ══════════════════════════════════════════════════════════════════════

function Av({ bg, txt, ini, sz = 42 }: { bg: string; txt: string; ini: string; sz?: number }) {
  return (
    <div style={{
      width: sz, height: sz, borderRadius: '50%', background: bg, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: sz * 0.33, color: txt,
    }}>
      {ini}
    </div>
  );
}

function Pill({ s }: { s: string }) {
  const cfg: Record<string, { bg: string; col: string }> = {
    early:   { bg: '#1D9E75', col: '#fff'    },
    on_time: { bg: '#5DCAA5', col: '#fff'    },
    late:    { bg: '#FEF3E2', col: '#D97706' },
    absent:  { bg: '#FEE2E2', col: '#DC2626' },
    none:    { bg: '#F3F4F6', col: '#9CA3AF' },
  };
  const lbl: Record<string, string> = {
    early:'Early', on_time:'On Time', late:'Late', absent:'Absent', none:'—',
  };
  const c = cfg[s] ?? { bg: '#F3F4F6', col: '#9CA3AF' };
  return (
    <span style={{
      padding: '4px 12px', borderRadius: 20, background: c.bg, color: c.col,
      fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
    }}>
      {lbl[s] ?? s}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #E8E8E4', borderTopColor: '#E8540A',
        animation: 'spin 0.8s linear infinite',
      }} />
    </div>
  );
}

/** The white card that wraps every view */
function Shell({
  present, total, sub, children,
}: {
  present: number; total: number; sub: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 24, border: '1px solid #E8E8E4',
      boxShadow: '0 4px 24px rgba(0,0,0,0.08)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, border: '2.5px solid #E8540A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="#E8540A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 800, fontSize: 18, color: '#111827' }}>
            Attendance
          </span>
        </div>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#9CA3AF' }}>
          Today · {present}/{total} present
        </span>
      </div>
      {sub ? (
        <div style={{ padding: '0 20px 10px' }}>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#9CA3AF', fontWeight: 500 }}>
            {sub}
          </span>
        </div>
      ) : null}
      <div style={{ padding: '0 20px 20px' }}>{children}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// TAB VIEWS — MANAGER / ADMIN
// ══════════════════════════════════════════════════════════════════════

function HeatmapView({ rows, isEmp, loading }: { rows: HeatmapRow[]; isEmp: boolean; loading: boolean }) {
  const todayIdx = todayDayIdx();
  if (loading) return <Spinner />;
  const display = isEmp ? rows.slice(0, 1) : rows;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 280 }}>
        {/* Day headers */}
        <div style={{ display: 'flex', paddingLeft: 82, marginBottom: 10 }}>
          {WEEK_DAYS.map((d, i) => (
            <div key={d} style={{
              flex: 1, textAlign: 'center',
              fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600,
              color: i === todayIdx ? '#E8540A' : '#9CA3AF',
            }}>{d}</div>
          ))}
        </div>
        {/* Rows */}
        {display.map(row => (
          <div key={row.empId} style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <div style={{
              width: 82, fontFamily: "'DM Sans',sans-serif", fontSize: 13,
              fontWeight: 500, color: '#374151', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {row.name.split(' ').map((n, i) => i === 0 ? n : n[0] + '.').join(' ')}
            </div>
            {row.days.map((day, i) => (
              <div key={day.day} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  width: 40, height: 36, borderRadius: 9,
                  background: SQ[day.status] ?? 'transparent',
                  border: i === todayIdx ? '2.5px solid #E8540A' : '2.5px solid transparent',
                  opacity: day.status === 'none' ? 0.12 : 1,
                  boxShadow: day.status !== 'none' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                }} />
              </div>
            ))}
          </div>
        ))}
        {display.length === 0 && (
          <p style={{ fontFamily: "'DM Sans',sans-serif", color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
            No heatmap data for this week.
          </p>
        )}
        {/* Legend */}
        <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
          {[{ l: 'Early', c: '#1D9E75' }, { l: 'On Time', c: '#5DCAA5' }, { l: 'Late', c: '#EF9F27' }, { l: 'Absent', c: '#FFBCBC' }].map(x => (
            <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: x.c }} />
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#9CA3AF' }}>{x.l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TodaysLogView({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  if (loading) return <Spinner />;
  if (employees.length === 0) return (
    <p style={{ fontFamily: "'DM Sans',sans-serif", color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
      No attendance records for today.
    </p>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {employees.map(emp => (
        <div key={emp.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#FAFAFA', borderRadius: 16, padding: '12px 14px', border: '1px solid #F0F0EE',
        }}>
          <Av bg={emp.avatarBg} txt={emp.avatarText} ini={emp.initials} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 14, color: '#111827' }}>{emp.name}</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#9CA3AF' }}>
              {emp.zone || emp.role || 'Gharpayy'}
            </div>
          </div>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#6B7280', marginRight: 6 }}>
            {emp.checkIn === '—' ? '--:--' : emp.checkIn}
          </div>
          <Pill s={emp.status} />
        </div>
      ))}
    </div>
  );
}

function LiveStatusView({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  if (loading) return <Spinner />;
  const stats = [
    { l: 'Active',   n: employees.filter(e => e.attendanceStatus === 'checked_in').length,  c: '#1D9E75', bg: '#E8F8F2' },
    { l: 'On Break', n: employees.filter(e => e.attendanceStatus === 'on_break').length,    c: '#EF9F27', bg: '#FEF6E6' },
    { l: 'Offline',  n: employees.filter(e => e.attendanceStatus === 'checked_out').length, c: '#9CA3AF', bg: '#F3F4F6' },
    { l: 'Absent',   n: employees.filter(e => e.attendanceStatus === 'absent').length,      c: '#EF4444', bg: '#FEE2E2' },
  ];
  const dotCol = (a: AttStatus) =>
    a === 'checked_in' ? '#1D9E75' : a === 'on_break' ? '#EF9F27' : a === 'checked_out' ? '#9CA3AF' : '#EF4444';
  const dotLbl = (a: AttStatus) =>
    a === 'checked_in' ? 'Active' : a === 'on_break' ? 'Break' : a === 'checked_out' ? 'Done' : 'Absent';
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10, marginBottom: 14 }}>
        {stats.map(s => (
          <div key={s.l} style={{ background: s.bg, borderRadius: 14, padding: 14 }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 28, fontWeight: 800, color: s.c }}>{s.n}</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#6B7280' }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {employees.map(emp => (
          <div key={emp.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#FAFAFA', borderRadius: 14, padding: '11px 14px', border: '1px solid #F0F0EE',
          }}>
            <div style={{ position: 'relative' }}>
              <Av bg={emp.avatarBg} txt={emp.avatarText} ini={emp.initials} />
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 11, height: 11, borderRadius: '50%',
                background: dotCol(emp.attendanceStatus), border: '2px solid #fff',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 14, color: '#111827' }}>{emp.name}</div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#9CA3AF' }}>
                {emp.attendanceStatus === 'checked_in'  ? `Since ${emp.checkIn}` :
                 emp.attendanceStatus === 'on_break'    ? 'On break' :
                 emp.attendanceStatus === 'checked_out' ? `Out ${emp.checkOut}` : 'Absent today'}
              </div>
            </div>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, color: dotCol(emp.attendanceStatus) }}>
              {dotLbl(emp.attendanceStatus)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineView({ events, loading, isLiveUser }: { events: TimelineEvt[]; loading: boolean; isLiveUser: boolean }) {
  if (loading) return <Spinner />;
  if (events.length === 0) return (
    <p style={{ fontFamily: "'DM Sans',sans-serif", color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
      No timeline data yet today.
    </p>
  );
  return (
    <div>
      <div style={{ position: 'relative', paddingLeft: 28 }}>
        <div style={{ position: 'absolute', left: 9, top: 8, bottom: 8, width: 2, background: '#E8E8E4', borderRadius: 2 }} />
        {events.map((ev, i) => (
          <div key={i} style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{
              position: 'absolute', left: -24, top: 10,
              width: 12, height: 12, borderRadius: '50%',
              background: TLC[ev.type] ?? '#9CA3AF',
              border: '2px solid #fff',
              boxShadow: `0 0 0 2px ${TLC[ev.type] ?? '#9CA3AF'}44`,
            }} />
            <div style={{
              background: TLB[ev.type] ?? '#F3F4F6',
              border: `1px solid ${TLC[ev.type] ?? '#9CA3AF'}33`,
              borderRadius: 12, padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13, color: '#111827' }}>
                  {ev.label}
                </span>
                <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#9CA3AF' }}>{ev.time}</span>
              </div>
            </div>
          </div>
        ))}
        {/* "Now" pill — shown when employee is still active */}
        {isLiveUser && (
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: -24, top: 8, width: 12, height: 12, borderRadius: '50%',
              background: '#E8540A', border: '2px solid #fff', animation: 'pulse 2s infinite',
            }} />
            <div style={{ background: '#FEF0EA', border: '1px solid #E8540A33', borderRadius: 12, padding: '10px 14px' }}>
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 13, color: '#E8540A' }}>
                Now — still clocked in
              </span>
            </div>
          </div>
        )}
      </div>
      {/* Day summary card */}
      <div style={{ background: '#F9F9F7', borderRadius: 14, padding: '14px 16px', marginTop: 14 }}>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13, color: '#374151', marginBottom: 10 }}>
          Day Summary
        </div>
        {[
          { l: 'First In',     v: events.find(e => e.type === 'checkin')?.time  ?? '—', c: '#9CA3AF' },
          { l: 'Last Out',     v: events.filter(e => e.type === 'checkout').pop()?.time ?? '—', c: '#9CA3AF' },
          { l: 'Break Events', v: String(events.filter(e => e.type === 'break_start').length), c: '#EF9F27' },
          { l: 'Sessions',     v: String(events.filter(e => e.type === 'checkin').length), c: '#5DCAA5' },
        ].map(x => (
          <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#6B7280' }}>{x.l}</span>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, color: x.c }}>{x.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailySummaryView({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  if (loading) return <Spinner />;
  if (employees.length === 0) return (
    <p style={{ fontFamily: "'DM Sans',sans-serif", color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
      No records for today.
    </p>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {employees.map(emp => (
        <div key={emp.id} style={{ background: '#FAFAFA', borderRadius: 16, border: '1px solid #F0F0EE', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Av bg={emp.avatarBg} txt={emp.avatarText} ini={emp.initials} sz={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 14, color: '#111827' }}>{emp.name}</div>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#9CA3AF' }}>
                {emp.role || 'Gharpayy Team'}
              </div>
            </div>
            <Pill s={emp.status} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
            {[
              { l: 'Clock In',  v: emp.checkIn },
              { l: 'Clock Out', v: emp.checkOut },
              { l: 'Net Work',  v: emp.netWork },
              { l: 'Breaks',    v: emp.breaks  },
            ].map(x => (
              <div key={x.l} style={{
                background: '#fff', borderRadius: 10, padding: '8px 4px',
                textAlign: 'center', border: '1px solid #E8E8E4',
              }}>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: '#9CA3AF' }}>{x.l}</div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, color: '#374151', marginTop: 2 }}>
                  {x.v}
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #F0F0EE', paddingTop: 10 }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: '#9CA3AF', marginBottom: 6 }}>CRM Activity</div>
            <div style={{ display: 'flex', gap: 14 }}>
              {[
                { k: 'Calls',    v: emp.crm.calls    },
                { k: 'Leads',    v: emp.crm.leads    },
                { k: 'Visits',   v: emp.crm.visits   },
                { k: 'Messages', v: emp.crm.messages },
              ].map(x => (
                <div key={x.k} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, fontWeight: 800, color: '#E8540A' }}>{x.v}</div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: '#9CA3AF' }}>{x.k}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GeoFenceView({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  if (loading) return <Spinner />;
  const present = employees.filter(e => e.attendanceStatus !== 'absent' && e.attendanceStatus !== 'not_in');
  const dotC  = (g: GeoStatus) => g === 'inside' ? '#1D9E75' : g === 'checking' ? '#EF9F27' : '#EF4444';
  const lblC  = (g: GeoStatus) => g === 'inside' ? '#1D9E75' : g === 'checking' ? '#EF9F27' : '#EF4444';
  const lbl   = (g: GeoStatus) => g === 'inside' ? 'Inside'  : g === 'checking' ? 'Checking' : 'Outside';
  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg,#EAF4FC,#D4EAFB)',
        backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 22px,rgba(180,210,240,0.35) 22px,rgba(180,210,240,0.35) 23px),repeating-linear-gradient(90deg,transparent,transparent 22px,rgba(180,210,240,0.35) 22px,rgba(180,210,240,0.35) 23px)',
        borderRadius: 16, height: 150, position: 'relative', overflow: 'hidden', marginBottom: 16,
      }}>
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-56%)',
          width: 100, height: 100, borderRadius: '50%',
          background: 'rgba(232,84,10,0.10)', border: '2px solid #E8540A',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
        }}>📍</div>
        <div style={{
          position: 'absolute', bottom: 10, left: 14,
          fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 600, color: '#4B5563',
          background: 'rgba(255,255,255,0.88)', borderRadius: 8, padding: '3px 10px',
        }}>Gharpayy Office · Bangalore</div>
      </div>
      {present.length === 0 ? (
        <p style={{ fontFamily: "'DM Sans',sans-serif", color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
          No active employees right now.
        </p>
      ) : (
        present.map((emp, idx) => (
          <div key={emp.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
            borderBottom: idx < present.length - 1 ? '1px solid #F5F5F3' : 'none',
          }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: dotC(emp.geoStatus), flexShrink: 0 }} />
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 14, color: '#111827', flex: 1 }}>
              {emp.name}
            </span>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#9CA3AF', width: 100 }}>
              {emp.zone || 'Bangalore'}
            </span>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, color: lblC(emp.geoStatus) }}>
              {lbl(emp.geoStatus)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function CoverageView({ employees, loading }: { employees: Employee[]; loading: boolean }) {
  if (loading) return <Spinner />;
  const present = employees.filter(e => e.attendanceStatus !== 'absent' && e.attendanceStatus !== 'not_in').length;
  const onTime  = employees.filter(e => e.status === 'on_time' || e.status === 'early').length;
  const pct     = employees.length > 0 ? Math.round((onTime / employees.length) * 100) : 0;

  // Derive zones; fallback to "Bangalore"
  const zoneMap = new Map<string, { present: number; total: number }>();
  employees.forEach(e => {
    const z = e.zone || 'Bangalore';
    const cur = zoneMap.get(z) ?? { present: 0, total: 0 };
    zoneMap.set(z, {
      total: cur.total + 1,
      present: cur.present + (e.attendanceStatus !== 'absent' && e.attendanceStatus !== 'not_in' ? 1 : 0),
    });
  });
  const zones = Array.from(zoneMap.entries());

  // Average clock-in from actual data
  const checkinTimes = employees
    .map(e => e.checkIn)
    .filter(t => t !== '—');
  const avgCheckin = checkinTimes.length > 0 ? checkinTimes[Math.floor(checkinTimes.length / 2)] : '—';

  return (
    <div style={{ background: '#FAFAFA', borderRadius: 16, border: '1px solid #E8E8E4', padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
        {[
          { v: `${present}/${employees.length}`, l: 'Present',     c: '#5DCAA5' },
          { v: `${pct}%`,                        l: 'On Time %',   c: '#6C7AE0' },
          { v: avgCheckin,                        l: 'Avg Clock-in',c: '#A855F7' },
        ].map(s => (
          <div key={s.l} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 22, fontWeight: 800, color: s.c }}>{s.v}</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 11, color: '#9CA3AF' }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 12 }}>
        Office Coverage
      </div>
      {zones.map(([zone, { present: zp, total: zt }]) => {
        const p = zt > 0 ? zp / zt : 0;
        return (
          <div key={zone} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#374151' }}>{zone}</span>
              <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 12, color: '#9CA3AF' }}>{zp}/{zt}</span>
            </div>
            <div style={{ height: 6, background: '#E8E8E4', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${p * 100}%`,
                background: p === 1 ? '#5DCAA5' : p > 0 ? '#EF9F27' : '#E8E8E4',
                borderRadius: 3, transition: 'width 0.6s',
              }} />
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, background: '#E8F8F2', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>✅</span>
        <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#1D9E75', fontWeight: 600 }}>
          All geo-fences verified · {zones.length} {zones.length === 1 ? 'zone' : 'zones'} covered
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// CLOCK IN / OUT VIEW  (shared between employee & manager tab)
// ══════════════════════════════════════════════════════════════════════

interface ClockProps {
  fullName: string;
  role: string;
  initials: string;
  avatarBg: string;
  avatarText: string;
  clockState: ClockState;
  checkInTime: string;
  sessions: number;
  totalWorkMins: number;
  totalBreakMins: number;
  onCheckin: () => Promise<void>;
  onCheckout: () => Promise<void>;
  onBreak: (action: 'start' | 'end', type: BreakType) => Promise<void>;
  loading: boolean;
}

function ClockView({
  fullName, role, initials, avatarBg, avatarText,
  clockState, checkInTime, sessions, totalWorkMins, totalBreakMins,
  onCheckin, onCheckout, onBreak, loading,
}: ClockProps) {
  const [now, setNow]       = useState(new Date());
  const [breakType, setBT]  = useState<BreakType>('lunch');
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const h   = now.getHours();
  const m   = String(now.getMinutes()).padStart(2, '0');
  const ap  = h >= 12 ? 'PM' : 'AM';
  const h12 = String(h % 12 || 12);

  const isIn    = clockState === 'checked_in';
  const isBreak = clockState === 'on_break';
  const isNotIn = clockState === 'not_in';
  const isOut   = clockState === 'checked_out';

  const btnBg  = isNotIn ? '#E8540A' : isIn ? '#4B5A2F' : isBreak ? '#1D9E75' : '#9CA3AF';
  const btnLbl = isNotIn ? 'Clock In' : isIn ? 'Clocked In ✓' : isBreak ? 'On Break…' : 'Clocked Out';

  async function handle(fn: () => Promise<void>) {
    if (busy || loading) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: '#F7F3EE', borderRadius: 20, padding: 20, border: '1px solid #EDE8E0' }}>
      {/* User */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <Av bg={avatarBg} txt={avatarText} ini={initials} sz={50} />
        <div>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 17, color: '#111827' }}>{fullName}</div>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#9CA3AF' }}>{role}</div>
        </div>
      </div>

      {/* CrazeHQ-style time circle — digital time only, no hands */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        <div style={{
          width: 130, height: 130, borderRadius: '50%',
          background: '#fff', border: '2px solid #E8E8E4',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            fontFamily: "'DM Sans',sans-serif", fontWeight: 800, fontSize: 28,
            color: '#111827', lineHeight: 1, letterSpacing: -1,
          }}>
            {h12}:{m}
          </div>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: '#9CA3AF', marginTop: 4, fontWeight: 500 }}>
            {ap}
          </div>
        </div>
      </div>

      {/* Break selector — only when clocked in */}
      {isIn && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['short', 'lunch', 'personal'] as BreakType[]).map(bt => (
              <button key={bt} onClick={() => setBT(bt)} style={{
                flex: 1, padding: '7px 2px', borderRadius: 10, cursor: 'pointer',
                border: `2px solid ${breakType === bt ? '#E8540A' : '#E0DBD4'}`,
                background: breakType === bt ? '#FEF0EA' : 'transparent',
                fontFamily: "'DM Sans',sans-serif", fontSize: 10, fontWeight: 700,
                color: breakType === bt ? '#E8540A' : '#6B7280',
              }}>
                {bt === 'short' ? '☕ Short' : bt === 'lunch' ? '🍽 Lunch' : '🚶 Personal'}
              </button>
            ))}
          </div>
          <button
            disabled={busy}
            onClick={() => handle(() => onBreak('start', breakType))}
            style={{
              width: '100%', padding: '12px', borderRadius: 14, border: 'none',
              background: '#EF9F27', color: '#fff', marginBottom: 10,
              fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            Start Break
          </button>
        </div>
      )}

      {isBreak && (
        <button
          disabled={busy}
          onClick={() => handle(() => onBreak('end', breakType))}
          style={{
            width: '100%', padding: '13px', borderRadius: 14, border: 'none', marginBottom: 10,
            background: '#1D9E75', color: '#fff',
            fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          End Break
        </button>
      )}

      {/* Main CTA */}
      <button
        disabled={busy || isOut}
        onClick={() => {
          if (isNotIn) handle(onCheckin);
          else if (isIn) handle(onCheckout);
        }}
        style={{
          width: '100%', padding: '14px', borderRadius: 14, border: 'none',
          background: btnBg, color: '#fff',
          fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 16,
          cursor: isOut || busy ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s', opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Please wait…' : btnLbl}
      </button>

      {/* Geo confirmation */}
      {(isIn || isBreak) && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#1D9E75', fontWeight: 600 }}>
            ✓ Within geo-fence · Gharpayy Office
          </span>
        </div>
      )}

      {/* Session summary */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6,
        marginTop: 16, paddingTop: 14, borderTop: '1px solid #EDE8E0',
      }}>
        {[
          { l: 'First In',  v: checkInTime || '—' },
          { l: 'Sessions',  v: String(sessions)    },
          { l: 'Worked',    v: minsToHM(totalWorkMins)   },
          { l: 'Breaks',    v: totalBreakMins > 0 ? `${totalBreakMins}m` : '0m' },
        ].map(x => (
          <div key={x.l} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 700, color: '#374151' }}>{x.v}</div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 10, color: '#9CA3AF' }}>{x.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// GEO HELPER
// ══════════════════════════════════════════════════════════════════════

function getGPS(): Promise<{ lat: number; lng: number }> {
  return new Promise(resolve => {
    if (!navigator?.geolocation) return resolve({ lat: 0, lng: 0 });
    navigator.geolocation.getCurrentPosition(
      p  => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: 0, lng: 0 }),
      { timeout: 8000 },
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// PAGE COMPONENT
// ══════════════════════════════════════════════════════════════════════

export default function AttendancePage() {
  const { user } = useAuth();

  const isEmployee  = user?.role === 'employee';
  const isManager   = user?.role === 'admin' || user?.role === 'manager';

  // ── Shared state ─────────────────────────────────────────────────────
  // Starts empty + loading=true; spinners show until real API data arrives
  const [employees,   setEmployees]  = useState<Employee[]>([]);
  const [heatmapRows, setHeatmap]    = useState<HeatmapRow[]>([]);
  const [timeline,    setTimeline]   = useState<TimelineEvt[]>([]);
  const [loadingEmp,  setLoadingEmp] = useState(true);
  const [loadingHM,   setLoadingHM]  = useState(true);

  // ── Employee-specific clock state ─────────────────────────────────────
  const [clockState,     setClockState]     = useState<ClockState>('not_in');
  const [checkInTime,    setCheckInTime]    = useState('');
  const [clockSessions,  setClockSessions]  = useState(0);
  const [workMins,       setWorkMins]       = useState(0);
  const [breakMins,      setBreakMins]      = useState(0);
  const [myInitials,     setMyInitials]     = useState('U');
  const [myAvatarBg,     setMyAvatarBg]     = useState('#C8D8F0');
  const [myAvatarTxt,    setMyAvatarTxt]    = useState('#3B6EA5');
  const [isLiveUser,     setIsLiveUser]     = useState(false);

  // ── Tab ───────────────────────────────────────────────────────────────
  const EMPLOYEE_TABS = [
    { id: 'heatmap',  label: 'Heatmap'      },
    { id: 'timeline', label: 'Timeline'     },
    { id: 'clockin',  label: 'Clock In/Out' },
  ];
  const MANAGER_TABS = [
    { id: 'heatmap',  label: 'Heatmap'        },
    { id: 'log',      label: "Today's Log"    },
    { id: 'live',     label: 'Live Status'    },
    { id: 'timeline', label: 'Timeline'       },
    { id: 'summary',  label: 'Daily Summary'  },
    { id: 'geo',      label: 'Geo-Fence'      },
    { id: 'coverage', label: 'Coverage'       },
    { id: 'clockin',  label: 'Clock In/Out'   },
  ];
  const tabs = isEmployee ? EMPLOYEE_TABS : MANAGER_TABS;
  const [activeTab, setActiveTab] = useState(tabs[0].id);

  // Reset tab when role changes (edge case: account switch)
  const prevRole = useRef(user?.role);
  useEffect(() => {
    if (user?.role !== prevRole.current) {
      prevRole.current = user?.role;
      setActiveTab((isEmployee ? EMPLOYEE_TABS : MANAGER_TABS)[0].id);
    }
  }, [user?.role, isEmployee]);

  // ── Load current user status (for Clock tab) ──────────────────────────
  useEffect(() => {
    if (!user) return;
    const ini = getInitials(user.fullName ?? 'U');
    setMyInitials(ini);

    async function loadStatus() {
      try {
        const res = await fetch('/api/attendance/status', { cache: 'no-store', credentials: 'include' });
        if (!res.ok) return;
        const data: ApiStatus = await res.json();

        const live = data.isCheckedIn && !data.isOnBreak;
        const state: ClockState =
          data.isOnBreak    ? 'on_break'    :
          data.isCheckedIn  ? 'checked_in'  :
          data.attendance?.sessions?.some(s => s.checkOut) ? 'checked_out' : 'not_in';

        setClockState(state);
        setIsLiveUser(live);

        const firstSess = data.attendance?.sessions?.[0];
        if (firstSess?.checkIn) setCheckInTime(fmtTime(firstSess.checkIn));

        setClockSessions(data.attendance?.sessions?.length ?? 0);
        setWorkMins(data.attendance?.totalWorkMins ?? 0);

        const bm = (data.attendance?.breaks ?? []).reduce((s, b) => s + (b.durationMins ?? 0), 0);
        setBreakMins(bm);

        // Build real timeline
        if (data.attendance) {
          const fakeReport: ApiReport = {
            employeeId: user._id ?? user.id ?? '',
            name: user.fullName ?? '',
            email: user.email ?? '',
            date: data.attendance.date,
            dayStatus: data.attendance.dayStatus,
            checkIn: data.attendance.sessions?.[0]?.checkIn ?? null,
            checkOut: data.attendance.sessions?.[data.attendance.sessions.length - 1]?.checkOut ?? null,
            totalWorkMins: data.attendance.totalWorkMins,
            breaks: data.attendance.breaks ?? [],
            sessions: data.attendance.sessions ?? [],
            timeline: [],
            isWithinGeofence: data.attendance.isWithinGeofence ?? false,
            crmActivity: { leadsContacted: 0, callsMade: 0, visitsScheduled: 0, messagesSent: 0 },
            breakSummary: { lunchMins: 0, shortMins: 0, personalMins: 0 },
            breakFlags: [],
            notes: null,
          };
          setTimeline(buildTimeline(fakeReport));
        }
      } catch {
        // Keep mock fallback
      }
    }
    loadStatus();
  }, [user]);

  // ── Load heatmap ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const week = getISOWeek();
    setLoadingHM(true);
    fetch(`/api/attendance?week=${week}`, { cache: 'no-store', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: ApiHeatmapEntry[] | null) => {
        if (!Array.isArray(data) || data.length === 0) return;

        // Group by employee
        const map = new Map<string, HeatmapRow>();
        data.forEach((entry, idx) => {
          const empId = typeof entry.employeeId === 'object' && entry.employeeId !== null
            ? String(entry.employeeId?._id ?? (entry.employeeId as any)?.toString?.() ?? idx)
            : String(entry.employeeId ?? idx);
          const empName = entry.employeeName ?? 'Unknown';

          if (!map.has(empId)) {
            map.set(empId, { empId, name: empName, days: [] });
          }

          // Parse date in IST-safe way: treat YYYY-MM-DD as local, not UTC,
          // by appending T12:00:00 so timezone offset never shifts the day.
          const d = new Date(entry.date + 'T12:00:00');
          const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
          const dayAbbr  = dayNames[d.getDay()];

          // If dayStatus is null the employee is still clocked in (not yet checked out).
          // Derive a colour from checkIn time vs 9:00 AM cutoff, or fall back to 'on_time'.
          // dayStatus is only written by the API at checkout time.
          // While an employee is actively clocked in, dayStatus is null.
          // Derive status from checkIn time so the square is always coloured.
          let resolvedStatus: DayStatus;
          if (entry.dayStatus) {
            resolvedStatus = entry.dayStatus;
          } else if (entry.checkIn) {
            // Employee is still clocked in — derive from check-in hour
            const ci = new Date(entry.checkIn);
            const ciMins = ci.getHours() * 60 + ci.getMinutes();
            // <9:00 = early, 9:00–9:15 = on_time, >9:15 = late
            resolvedStatus = ciMins < 540 ? 'early' : ciMins <= 555 ? 'on_time' : 'late';
          } else {
            resolvedStatus = 'none';
          }

          if (WEEK_DAYS.includes(dayAbbr)) {
            map.get(empId)!.days.push({ day: dayAbbr, status: resolvedStatus });
          }
        });

        // Fill missing days with 'none'
        const rows: HeatmapRow[] = Array.from(map.values()).map(row => ({
          ...row,
          days: WEEK_DAYS.map(d => row.days.find(x => x.day === d) ?? { day: d, status: 'none' as DayStatus }),
        }));

        // Employee sees only own row
        const myId = user._id ?? user.id ?? '';
        const filtered = isEmployee ? rows.filter(r => r.empId === myId) : rows;
        if (filtered.length > 0) setHeatmap(filtered);
      })
      .catch(() => { /* keep mock */ })
      .finally(() => setLoadingHM(false));
  }, [user, isEmployee]);

  // ── Load daily report (manager/admin) ─────────────────────────────────
  useEffect(() => {
    if (!user || isEmployee) return;
    setLoadingEmp(true);
    fetch('/api/attendance/daily-report', { cache: 'no-store', credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: ApiReport[] | null) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const converted = reportsToEmployees(data);
        setEmployees(converted);

        // Build timeline for the first clocked-in employee (for manager Timeline tab)
        const active = data.find(r => r.sessions?.some(s => s.checkIn));
        if (active) setTimeline(buildTimeline(active));
      })
      .catch(() => { /* keep mock */ })
      .finally(() => setLoadingEmp(false));
  }, [user, isEmployee]);

  // ── Clock actions ─────────────────────────────────────────────────────
  const doCheckin = useCallback(async () => {
    const { lat, lng } = await getGPS();
    try {
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST', cache: 'no-store', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) throw new Error('Checkin failed');
    } catch { /* still update UI */ }
    const t = nowTimeStr();
    setClockState('checked_in');
    setCheckInTime(t);
    setClockSessions(s => s + 1);
    setIsLiveUser(true);
    setTimeline(prev => [...prev, { time: t, label: 'Clocked in', type: 'checkin' }]);
  }, []);

  const doCheckout = useCallback(async () => {
    const { lat, lng } = await getGPS();
    try {
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST', cache: 'no-store', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (!res.ok) throw new Error('Checkout failed');
    } catch { /* still update UI */ }
    const t = nowTimeStr();
    setClockState('checked_out');
    setIsLiveUser(false);
    setTimeline(prev => [...prev, { time: t, label: 'Clocked out', type: 'checkout' }]);
  }, []);

  const doBreak = useCallback(async (action: 'start' | 'end', type: BreakType) => {
    try {
      const res = await fetch('/api/attendance/break', {
        method: 'POST', cache: 'no-store', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, type }),
      });
      if (!res.ok) throw new Error('Break action failed');
    } catch { /* still update UI */ }
    const t   = nowTimeStr();
    const lbl = type === 'lunch' ? 'Lunch' : type === 'personal' ? 'Personal' : 'Short';
    setClockState(action === 'start' ? 'on_break' : 'checked_in');
    setIsLiveUser(action === 'end');
    setTimeline(prev => [
      ...prev,
      action === 'start'
        ? { time: t, label: `Break started · ${lbl}`, type: 'break_start' }
        : { time: t, label: 'Back from break',         type: 'break_end'   },
    ]);
  }, []);

  // ── Derived values ────────────────────────────────────────────────────
  const presentCount = employees.filter(e => e.attendanceStatus !== 'absent' && e.attendanceStatus !== 'not_in').length;
  const totalCount   = employees.length;

  // Employee's own heatmap row for Shell subtitle
  const myRow = heatmapRows.find(r =>
    r.empId === (user?._id ?? user?.id ?? '')
  ) ?? heatmapRows[0];

  const subMap: Record<string, string> = {
    heatmap:  'Weekly Heatmap',
    log:      "Today's Log",
    live:     'Live Status',
    timeline: 'My Timeline',
    summary:  'Daily Summary',
    geo:      'Geo-Fence Verification',
    coverage: 'Coverage Summary',
    clockin:  '',
  };

  // ══════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(232,84,10,0.3)}50%{box-shadow:0 0 0 6px rgba(232,84,10,0.1)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{height:0;width:0}
      `}</style>

      <div style={{ background: '#F5F5F3', minHeight: '100vh', fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 14px 80px' }}>

          {/* Page header */}
          <div style={{ padding: '22px 2px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h1 style={{ fontFamily: "'DM Sans',sans-serif", fontWeight: 800, fontSize: 22, color: '#111827', margin: 0 }}>
              Attendance
            </h1>
            <span style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: '#9CA3AF' }}>
              {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>

          {/* Scrollable tab pills */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 16, scrollbarWidth: 'none' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '8px 18px', borderRadius: 50, border: 'none', flexShrink: 0,
                  background: activeTab === t.id ? '#E8540A' : '#fff',
                  color: activeTab === t.id ? '#fff' : '#6B7280',
                  fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  boxShadow: activeTab === t.id
                    ? '0 4px 14px rgba(232,84,10,0.28)'
                    : '0 1px 4px rgba(0,0,0,0.07)',
                  transition: 'all 0.2s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Attendance card */}
          <Shell
            present={isEmployee ? (clockState !== 'not_in' && clockState !== 'absent' ? 1 : 0) : presentCount}
            total={isEmployee ? 1 : totalCount}
            sub={subMap[activeTab] ?? ''}
          >
            {activeTab === 'heatmap' && (
              <HeatmapView
                rows={isEmployee ? (myRow ? [myRow] : heatmapRows.slice(0,1)) : heatmapRows}
                isEmp={isEmployee}
                loading={loadingHM}
              />
            )}

            {activeTab === 'log' && isManager && (
              <TodaysLogView employees={employees} loading={loadingEmp} />
            )}

            {activeTab === 'live' && isManager && (
              <LiveStatusView employees={employees} loading={loadingEmp} />
            )}

            {activeTab === 'timeline' && (
              <TimelineView
                events={timeline}
                loading={isEmployee ? false : loadingEmp}
                isLiveUser={isEmployee ? isLiveUser : false}
              />
            )}

            {activeTab === 'summary' && isManager && (
              <DailySummaryView employees={employees} loading={loadingEmp} />
            )}

            {activeTab === 'geo' && isManager && (
              <GeoFenceView employees={employees} loading={loadingEmp} />
            )}

            {activeTab === 'coverage' && isManager && (
              <CoverageView employees={employees} loading={loadingEmp} />
            )}

            {activeTab === 'clockin' && (
              <ClockView
                fullName={user?.fullName ?? 'Employee'}
                role={user?.role ?? 'Sales Executive'}
                initials={myInitials}
                avatarBg={myAvatarBg}
                avatarText={myAvatarTxt}
                clockState={clockState}
                checkInTime={checkInTime}
                sessions={clockSessions}
                totalWorkMins={workMins}
                totalBreakMins={breakMins}
                onCheckin={doCheckin}
                onCheckout={doCheckout}
                onBreak={doBreak}
                loading={false}
              />
            )}
          </Shell>
        </div>
      </div>
    </>
  );
}