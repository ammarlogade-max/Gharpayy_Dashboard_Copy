import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

function isManagerOrAdmin(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    const userRole = decoded.role || 'employee';

    if (!userId) return NextResponse.json([]);

    const { searchParams } = new URL(req.url);
    const week = searchParams.get('week'); // YYYY-WW format

    await connectToDatabase();

    // Build query — admins/managers see all, employees see only themselves
    const query: any = {};

    if (!isManagerOrAdmin(userRole) && userId !== 'admin-id-static') {
      query.employeeId = userId;
    }

    if (week) {
      const [year, weekNum] = week.split('-').map(Number);
      const jan1 = new Date(year, 0, 1);
      const weekStart = new Date(jan1.getTime() + (weekNum - 1) * 7 * 86400000);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
      query.date = {
        $gte: weekStart.toISOString().split('T')[0],
        $lte: weekEnd.toISOString().split('T')[0],
      };
    }

    const records = await Attendance.find(query)
      .populate('employeeId', 'fullName email')
      .sort({ date: 1 });

    const heatmap = records.map((r) => {
      const emp = r.employeeId as any;
      return {
        employeeId: r.employeeId,
        employeeName: emp?.fullName || 'Unknown',
        date: r.date,
        dayStatus: r.dayStatus,
        totalWorkMins: r.totalWorkMins,
        totalWorkHours: r.totalWorkMins > 0 ? parseFloat((r.totalWorkMins / 60).toFixed(1)) : 0,
        checkIn: r.sessions[0]?.checkIn || null,
        checkOut: r.sessions[r.sessions.length - 1]?.checkOut || null,
      };
    });

    return NextResponse.json(heatmap);

  } catch (error: any) {
    console.error('Heatmap route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
