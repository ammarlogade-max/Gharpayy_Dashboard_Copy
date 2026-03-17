import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';

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
    const week = searchParams.get('week'); // YYYY-WW

    await connectToDatabase();

    let query: any = { employeeId: userId };

    if (week) {
      const [year, weekNum] = week.split('-').map(Number);
      const jan1 = new Date(year, 0, 1);
      const weekStart = new Date(jan1.getTime() + (weekNum - 1) * 7 * 86400000);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
      const startStr = weekStart.toISOString().split('T')[0];
      const endStr = weekEnd.toISOString().split('T')[0];
      query.date = { $gte: startStr, $lte: endStr };
    }

    const records = await Attendance.find(query).sort({ date: 1 });

    const heatmap = records.map((r) => ({
      employeeId: r.employeeId,
      date: r.date,
      dayStatus: r.dayStatus,
      totalWorkMins: r.totalWorkMins,
      checkIn: r.sessions[0]?.checkIn || null,
      checkOut: r.sessions[r.sessions.length - 1]?.checkOut || null,
    }));

    return NextResponse.json(heatmap);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
