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
    const { action, type = 'short' } = body; // action: 'start' | 'end'

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    await connectToDatabase();

    const record = await Attendance.findOne({ employeeId: userId, date: dateStr } as any);
    if (!record) return NextResponse.json({ error: 'No check-in found for today' }, { status: 400 });

    const lastSession = record.sessions[record.sessions.length - 1];
    if (!lastSession || lastSession.checkOut) {
      return NextResponse.json({ error: 'Not checked in' }, { status: 400 });
    }

    if (action === 'start') {
      const openBreak = record.breaks.find((b: any) => !b.endTime);
      if (openBreak) return NextResponse.json({ error: 'Break already in progress' }, { status: 400 });

      // Lunch: only once per day
      if (type === 'lunch') {
        const completedLunch = record.breaks.filter((b: any) => b.type === 'lunch' && b.endTime);
        if (completedLunch.length >= 1) return NextResponse.json({ error: 'Lunch break already used today' }, { status: 400 });
      }

      record.breaks.push({ type, startTime: now });
    } else if (action === 'end') {
      const openBreak = record.breaks.find((b: any) => !b.endTime);
      if (!openBreak) return NextResponse.json({ error: 'No break in progress' }, { status: 400 });
      openBreak.endTime = now;
      openBreak.durationMins = Math.round((now.getTime() - openBreak.startTime.getTime()) / 60000);
    }

    await record.save();

    return NextResponse.json({ success: true, record });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
