import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';
import ActivityLog from '@/models/ActivityLog';
import Agent from '@/models/Agent';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

function isManagerOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

function getISTDateStr(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return istNow.toISOString().split('T')[0];
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    const userRole = decoded.role || 'employee';

    if (!userId || userId === 'admin-id-static') {
      // Static admin: treat as manager, return all today
      if (userId === 'admin-id-static') {
        // Fall through with manager access
      } else {
        return NextResponse.json([]);
      }
    }

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || getISTDateStr();

    await connectToDatabase();

    // Role-based query: managers/admins see all, employees see only themselves
    const query: any = { date };
    if (!isManagerOrAdmin(userRole) && userId !== 'admin-id-static') {
      query.employeeId = userId;
    }

    const records = await Attendance.find(query as any).populate('employeeId', 'fullName email role');

    const reports = await Promise.all(records.map(async (r) => {
      const emp = r.employeeId as any;
      const firstSession = r.sessions[0];
      const lastSession = r.sessions[r.sessions.length - 1];

      // Build timeline from sessions + breaks, sorted by time
      const timeline: { time: Date; event: string }[] = [];

      r.sessions.forEach((s: any) => {
        timeline.push({ time: s.checkIn, event: 'Check In' });
        if (s.checkOut) timeline.push({ time: s.checkOut, event: 'Check Out' });
      });

      r.breaks.forEach((b: any) => {
        const label = b.type === 'lunch' ? 'Lunch' : b.type === 'personal' ? 'Personal' : 'Short';
        timeline.push({ time: b.startTime, event: `${label} Break Start` });
        if (b.endTime) timeline.push({ time: b.endTime, event: `${label} Break End` });
      });

      timeline.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      // CRM activity — Option B: look up Agent by matching email with User email
      // This fixes the agentId (Agent._id) vs employeeId (User._id) mismatch
      let crmActivity = { leadsContacted: 0, callsMade: 0, visitsScheduled: 0, messagesSent: 0 };

      try {
        const empEmail = emp?.email;
        if (empEmail) {
          // Find the Agent whose email matches this User's email
          const matchingAgent = await Agent.findOne({ email: empEmail }).select('_id').lean();

          if (matchingAgent) {
            const dayStart = new Date(date + 'T00:00:00.000Z');
            const dayEnd = new Date(date + 'T23:59:59.999Z');

            const activities = await ActivityLog.find({
              agentId: matchingAgent._id,
              createdAt: { $gte: dayStart, $lte: dayEnd },
            } as any).lean();

            crmActivity = {
              leadsContacted: activities.filter((a: any) =>
                ['lead_viewed', 'stage_updated', 'note_added', 'contacted'].includes(a.activityType)
              ).length,
              callsMade: activities.filter((a: any) => a.activityType === 'call_made').length,
              visitsScheduled: activities.filter((a: any) => a.activityType === 'visit_scheduled').length,
              messagesSent: activities.filter((a: any) => a.activityType === 'whatsapp_sent').length,
            };
          }
        }
      } catch (crmErr) {
        // CRM lookup failure should never break the attendance report
        console.error('CRM activity lookup failed:', crmErr);
      }

      // Break summary
      const lunchMins = r.breaks
        .filter((b: any) => b.type === 'lunch')
        .reduce((s: number, b: any) => s + (b.durationMins || 0), 0);
      const shortMins = r.breaks
        .filter((b: any) => b.type === 'short')
        .reduce((s: number, b: any) => s + (b.durationMins || 0), 0);
      const personalMins = r.breaks
        .filter((b: any) => b.type === 'personal')
        .reduce((s: number, b: any) => s + (b.durationMins || 0), 0);

      // Break limit flags
      const breakFlags: string[] = [];
      if (lunchMins > 45) breakFlags.push(`Lunch exceeded by ${lunchMins - 45}min`);
      if (shortMins > 10) breakFlags.push(`Short breaks exceeded by ${shortMins - 10}min`);
      if (personalMins > 15) breakFlags.push(`Personal break exceeded by ${personalMins - 15}min`);

      return {
        employeeId: r.employeeId,
        name: emp?.fullName || 'Unknown',
        email: emp?.email || '',
        date: r.date,
        dayStatus: r.dayStatus,
        checkIn: firstSession?.checkIn || null,
        checkOut: lastSession?.checkOut || null,
        totalWorkMins: r.totalWorkMins,
        breaks: r.breaks,
        sessions: r.sessions,
        timeline,
        isWithinGeofence: r.isWithinGeofence,
        crmActivity,
        breakSummary: { lunchMins, shortMins, personalMins },
        breakFlags,
        notes: r.notes || null,
      };
    }));

    return NextResponse.json(reports);

  } catch (error: any) {
    console.error('Daily report error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
