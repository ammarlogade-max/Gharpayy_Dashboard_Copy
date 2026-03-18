import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import connectToDatabase from '@/lib/mongodb';
import Attendance from '@/models/Attendance';
import Notification from '@/models/Notification';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

// BRD spec: Short=10min, Lunch=45min, Personal=15min
const BREAK_LIMITS: Record<string, number> = {
  lunch: 45,
  short: 10,
  personal: 15,
};

function getISTDateStr(): string {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return istNow.toISOString().split('T')[0];
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (userId === 'admin-id-static') {
      return NextResponse.json({ error: 'Please use a real employee account to track breaks' }, { status: 400 });
    }

    const body = await req.json();
    const { action, type = 'short' } = body;

    // Validate break type
    if (!['lunch', 'short', 'personal'].includes(type)) {
      return NextResponse.json({ error: 'Invalid break type. Use lunch, short, or personal.' }, { status: 400 });
    }

    const now = new Date();
    const dateStr = getISTDateStr();

    await connectToDatabase();

    const record = await Attendance.findOne({ employeeId: userId, date: dateStr } as any);
    if (!record) return NextResponse.json({ error: 'No check-in found for today. Please check in first.' }, { status: 400 });

    const lastSession = record.sessions[record.sessions.length - 1];
    if (!lastSession || lastSession.checkOut) {
      return NextResponse.json({ error: 'You are not currently checked in.' }, { status: 400 });
    }

    if (action === 'start') {
      // Block if already on a break
      const openBreak = record.breaks.find((b: any) => !b.endTime);
      if (openBreak) {
        return NextResponse.json({ error: `You are already on a ${openBreak.type} break. End it before starting another.` }, { status: 400 });
      }

      // Lunch: only once per day
      if (type === 'lunch') {
        const completedLunch = record.breaks.filter((b: any) => b.type === 'lunch' && b.endTime);
        if (completedLunch.length >= 1) {
          return NextResponse.json({ error: 'Lunch break already used today.' }, { status: 400 });
        }
      }

      // Short break: check total minutes used today (limit is 10 min total)
      if (type === 'short') {
        const totalShortMins = record.breaks
          .filter((b: any) => b.type === 'short' && b.endTime)
          .reduce((sum: number, b: any) => sum + (b.durationMins || 0), 0);
        if (totalShortMins >= BREAK_LIMITS.short) {
          return NextResponse.json({
            error: `Short break limit reached. You have used ${totalShortMins} of ${BREAK_LIMITS.short} minutes allowed today.`,
          }, { status: 400 });
        }
      }

      // Personal break: only once per day
      if (type === 'personal') {
        const completedPersonal = record.breaks.filter((b: any) => b.type === 'personal' && b.endTime);
        if (completedPersonal.length >= 1) {
          return NextResponse.json({ error: 'Personal break already used today.' }, { status: 400 });
        }
      }

      record.breaks.push({ type, startTime: now });
      await record.save();

      return NextResponse.json({
        success: true,
        record,
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} break started. Limit: ${BREAK_LIMITS[type]} minutes.`,
        limitMins: BREAK_LIMITS[type],
      });

    } else if (action === 'end') {
      const openBreak = record.breaks.find((b: any) => !b.endTime);
      if (!openBreak) {
        return NextResponse.json({ error: 'No break is currently in progress.' }, { status: 400 });
      }

      const durationMins = Math.round((now.getTime() - openBreak.startTime.getTime()) / 60000);
      openBreak.endTime = now;
      openBreak.durationMins = durationMins;

      const limit = BREAK_LIMITS[openBreak.type] || 10;
      const exceeded = durationMins > limit;
      const exceededBy = durationMins - limit;

      if (exceeded) {
        // Write to notes
        record.notes = (record.notes || '') +
          ` | BREAK_EXCEEDED: ${openBreak.type} ${durationMins}min (limit ${limit}min) at ${now.toISOString()}`;

        // Fire notification to all managers/admins — they see it in NotificationBell
        try {
          const user = await User.findById(userId).select('fullName');
          const empName = user?.fullName || 'An employee';

          await Notification.create({
            title: '⚠️ Break Limit Exceeded',
            message: `${empName} took a ${openBreak.type} break of ${durationMins} min (limit: ${limit} min, exceeded by ${exceededBy} min)`,
            type: 'break_violation',
            isRead: false,
            metadata: {
              employeeId: userId,
              employeeName: empName,
              breakType: openBreak.type,
              durationMins,
              limitMins: limit,
              exceededBy,
              date: dateStr,
            },
          });
        } catch (notifErr) {
          // Never fail the break-end just because notification failed
          console.error('Notification creation failed:', notifErr);
        }
      }

      await record.save();

      return NextResponse.json({
        success: true,
        record,
        durationMins,
        limit,
        exceeded,
        warning: exceeded
          ? `⚠️ ${openBreak.type} break exceeded by ${exceededBy} minutes. Manager has been notified.`
          : null,
      });

    } else {
      return NextResponse.json({ error: 'Invalid action. Use start or end.' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('Break route error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
