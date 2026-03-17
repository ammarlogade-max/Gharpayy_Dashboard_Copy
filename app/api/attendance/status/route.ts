import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    if (!userId) return NextResponse.json({ user: null, attendance: null });

// For static admin, create a virtual user
if (userId === 'admin-id-static') {
  return NextResponse.json({
    user: { _id: 'admin-id-static', fullName: 'Administrator', email: decoded.email },
    attendance: null,
    isCheckedIn: false,
    isOnBreak: false,
    openBreak: null,
    lastSession: null,
  });
}

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    await connectToDatabase();

    const [user, attendance] = await Promise.all([
      User.findById(userId).select('-password'),
      Attendance.findOne({ employeeId: userId, date: dateStr }),
    ]);

    const lastSession = attendance?.sessions?.[attendance.sessions.length - 1];
    const isCheckedIn = !!(lastSession && !lastSession.checkOut);
    const openBreak = attendance?.breaks?.find((b: any) => !b.endTime);

    return NextResponse.json({
      user,
      attendance,
      isCheckedIn,
      isOnBreak: !!openBreak,
      openBreak: openBreak || null,
      lastSession: lastSession || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
