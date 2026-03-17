import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { lat, lng } = body;

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    await connectToDatabase();

    const record = await Attendance.findOne({ employeeId: userId, date: dateStr });
    if (!record) return NextResponse.json({ error: 'No check-in found for today' }, { status: 400 });

    const lastSession = record.sessions[record.sessions.length - 1];
    if (!lastSession || lastSession.checkOut) {
      return NextResponse.json({ error: 'Not checked in' }, { status: 400 });
    }

    // Close any open break
    const openBreak = record.breaks.find((b: any) => !b.endTime);
    if (openBreak) {
      openBreak.endTime = now;
      openBreak.durationMins = Math.round((now.getTime() - openBreak.startTime.getTime()) / 60000);
    }

    lastSession.checkOut = now;
    lastSession.checkOutLat = lat;
    lastSession.checkOutLng = lng;
    lastSession.durationMins = Math.round((now.getTime() - lastSession.checkIn.getTime()) / 60000);

    // Recalculate total work mins
    const breakMins = record.breaks.reduce((sum: number, b: any) => sum + (b.durationMins || 0), 0);
    const sessionMins = record.sessions.reduce((sum: number, s: any) => sum + (s.durationMins || 0), 0);
    record.totalWorkMins = Math.max(0, sessionMins - breakMins);

    await record.save();

    return NextResponse.json({ success: true, record });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
