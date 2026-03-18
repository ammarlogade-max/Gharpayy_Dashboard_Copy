import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

// GET — list all employees (admin only)
export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.userId !== 'admin-id-static') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    await connectToDatabase();
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });

    return NextResponse.json({ users });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// POST — bulk create employees (admin only)
export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.userId !== 'admin-id-static') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { employees } = body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return NextResponse.json({ error: 'employees array is required and must not be empty' }, { status: 400 });
    }

    if (employees.length > 100) {
      return NextResponse.json({ error: 'Maximum 100 employees per batch' }, { status: 400 });
    }

    await connectToDatabase();

    const results: { success: boolean; email: string; name: string; error?: string }[] = [];

    for (const emp of employees) {
      const { fullName, email, password, role } = emp;

      if (!fullName || !email || !password) {
        results.push({ success: false, email: email || '?', name: fullName || '?', error: 'Missing required fields' });
        continue;
      }

      try {
        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) {
          results.push({ success: false, email, name: fullName, error: 'Email already exists' });
          continue;
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const allowedRoles = ['employee', 'manager'];
        const assignedRole = allowedRoles.includes(role) ? role : 'employee';

        await User.create({
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          fullName: fullName.trim(),
          role: assignedRole,
        });

        results.push({ success: true, email, name: fullName });
      } catch (err: any) {
        results.push({ success: false, email, name: fullName, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      message: `Created ${successCount} employees. ${failCount} failed.`,
      successCount,
      failCount,
      results,
    }, { status: 201 });

  } catch (error: any) {
    console.error('Bulk create error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
