import { NextResponse } from 'next/server';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';

// This route is called by Vercel Cron at 23:59 IST (18:29 UTC) every day
// vercel.json: { "crons": [{ "path": "/api/cron/auto-checkout", "schedule": "29 18 * * *" }] }
// Optional secret protection for manual calls
const CRON_SECRET = process.env.CRON_SECRET || '';

export async function GET(req: Request) {
  try {
    // Verify cron secret if set
    if (CRON_SECRET) {
      const authHeader = req.headers.get('authorization');
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    await connectToDatabase();

    // Get today's date in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const todayStr = istNow.toISOString().split('T')[0];

    // End of day time: 23:59:00 IST
    const endOfDayIST = new Date(todayStr + 'T23:59:00.000Z');
    const endOfDayUTC = new Date(endOfDayIST.getTime() - istOffset);

    // Find all attendance records for today that have an open session (no checkout)
    const openRecords = await Attendance.find({ date: todayStr } as any);

    let autoCheckedOut = 0;

    for (const record of openRecords) {
      const lastSession = record.sessions[record.sessions.length - 1];

      // Skip if already checked out or no sessions
      if (!lastSession || lastSession.checkOut) continue;

      // Close any open break first
      const openBreak = record.breaks.find((b: any) => !b.endTime);
      if (openBreak) {
        openBreak.endTime = endOfDayUTC;
        openBreak.durationMins = Math.round(
          (endOfDayUTC.getTime() - new Date(openBreak.startTime).getTime()) / 60000
        );
      }

      // Close the session
      lastSession.checkOut = endOfDayUTC;
      lastSession.durationMins = Math.round(
        (endOfDayUTC.getTime() - new Date(lastSession.checkIn).getTime()) / 60000
      );

      // Recalculate total work mins
      const breakMins = record.breaks.reduce((sum: number, b: any) => sum + (b.durationMins || 0), 0);
      const sessionMins = record.sessions.reduce((sum: number, s: any) => sum + (s.durationMins || 0), 0);
      record.totalWorkMins = Math.max(0, sessionMins - breakMins);

      // Add note
      record.notes = (record.notes || '') + ' | AUTO_CHECKOUT: System auto-checked out at 23:59 IST';

      await record.save();
      autoCheckedOut++;
    }

    console.log(`Auto-checkout completed: ${autoCheckedOut} records closed for ${todayStr}`);

    return NextResponse.json({
      success: true,
      date: todayStr,
      autoCheckedOut,
      message: `Auto-checked out ${autoCheckedOut} employees at 23:59 IST`,
    });

  } catch (error: any) {
    console.error('Auto-checkout cron error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
