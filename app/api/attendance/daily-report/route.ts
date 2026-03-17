import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';
import ActivityLog from '@/models/ActivityLog';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    if (!userId || userId === 'admin-id-static') return NextResponse.json([]);

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    await connectToDatabase();

    const records = await Attendance.find({ date } as any).populate('employeeId', 'fullName email');

    const reports = await Promise.all(records.map(async (r) => {
      const emp = r.employeeId as any;
      const firstSession = r.sessions[0];
      const lastSession = r.sessions[r.sessions.length - 1];

      const timeline = [
        ...(r.sessions.map((s: any) => [
          { time: s.checkIn, event: 'Check In' },
          ...(s.checkOut ? [{ time: s.checkOut, event: 'Check Out' }] : []),
        ]).flat()),
        ...(r.breaks.map((b: any) => [
          { time: b.startTime, event: `${b.type === 'lunch' ? 'Lunch' : b.type === 'personal' ? 'Personal' : 'Short'} Break Start` },
          ...(b.endTime ? [{ time: b.endTime, event: `${b.type === 'lunch' ? 'Lunch' : b.type === 'personal' ? 'Personal' : 'Short'} Break End` }] : []),
        ]).flat()),
      ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      // Get CRM activity for this employee today
      const dayStart = new Date(date + 'T00:00:00.000Z');
      const dayEnd = new Date(date + 'T23:59:59.999Z');

      let crmActivity = { leadsContacted: 0, callsMade: 0, visitsScheduled: 0, messagesSent: 0 };

      try {
        const activities = await ActivityLog.find({
          agentId: r.employeeId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
        } as any);

        crmActivity = {
          leadsContacted: activities.filter((a: any) => ['lead_viewed', 'stage_updated', 'note_added'].includes(a.activityType || a.action)).length,
          callsMade: activities.filter((a: any) => (a.activityType || a.action) === 'call_made').length,
          visitsScheduled: activities.filter((a: any) => (a.activityType || a.action) === 'visit_scheduled').length,
          messagesSent: activities.filter((a: any) => (a.activityType || a.action) === 'whatsapp_sent').length,
        };
      } catch { /* ActivityLog may be empty */ }

      // Break summary
      const lunchMins = r.breaks.filter((b: any) => b.type === 'lunch').reduce((s: number, b: any) => s + (b.durationMins || 0), 0);
      const shortMins = r.breaks.filter((b: any) => b.type === 'short').reduce((s: number, b: any) => s + (b.durationMins || 0), 0);
      const personalMins = r.breaks.filter((b: any) => b.type === 'personal').reduce((s: number, b: any) => s + (b.durationMins || 0), 0);

      // Flag exceeded breaks
      const breakFlags = [];
      if (lunchMins > 45) breakFlags.push(`Lunch exceeded by ${lunchMins - 45}min`);
      if (shortMins > 20) breakFlags.push(`Short breaks exceeded by ${shortMins - 20}min`);
      if (personalMins > 15) breakFlags.push(`Personal break exceeded by ${personalMins - 15}min`);

      return {
        employeeId: r.employeeId,
        name: emp?.fullName || 'Unknown',
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
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}