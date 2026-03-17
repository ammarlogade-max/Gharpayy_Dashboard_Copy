import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';
import { isWithinGeofence, getDayStatus, GEO_FENCE_HARD_BLOCK } from '@/lib/geo';

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

    const withinFence = lat && lng ? isWithinGeofence(lat, lng) : false;

    if (GEO_FENCE_HARD_BLOCK && !withinFence) {
      return NextResponse.json({ error: 'You are not within the office geo-fence' }, { status: 403 });
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    await connectToDatabase();

    let record = await Attendance.findOne({ employeeId: userId, date: dateStr });

    if (!record) {
      record = new Attendance({
        employeeId: userId,
        date: dateStr,
        sessions: [],
        breaks: [],
        totalWorkMins: 0,
        dayStatus: getDayStatus(now),
        isWithinGeofence: withinFence,
      });
    }

    // Check not already checked in (last session has no checkout)
    const lastSession = record.sessions[record.sessions.length - 1];
    if (lastSession && !lastSession.checkOut) {
      return NextResponse.json({ error: 'Already checked in' }, { status: 400 });
    }

    record.sessions.push({
      checkIn: now,
      checkInLat: lat,
      checkInLng: lng,
    });

    if (record.sessions.length === 1) {
      record.dayStatus = getDayStatus(now);
      record.isWithinGeofence = withinFence;
    }

    await record.save();

    return NextResponse.json({ success: true, record });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
