import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';
import User from '@/models/User';

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

    const records = await Attendance.find({ date }).populate('employeeId', 'fullName email');

    const reports = records.map((r) => {
      const emp = r.employeeId as any;
      const firstSession = r.sessions[0];
      const lastSession = r.sessions[r.sessions.length - 1];
      const timeline = [
        ...(r.sessions.map((s: any) => [
          { time: s.checkIn, event: 'Check In' },
          ...(s.checkOut ? [{ time: s.checkOut, event: 'Check Out' }] : []),
        ]).flat()),
        ...(r.breaks.map((b: any) => [
          { time: b.startTime, event: `${b.type === 'lunch' ? 'Lunch' : 'Short'} Break Start` },
          ...(b.endTime ? [{ time: b.endTime, event: `${b.type === 'lunch' ? 'Lunch' : 'Short'} Break End` }] : []),
        ]).flat()),
      ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

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
      };
    });

    return NextResponse.json(reports);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
