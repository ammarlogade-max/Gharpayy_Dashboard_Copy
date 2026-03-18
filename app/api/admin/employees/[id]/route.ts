import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

// PATCH — reset an employee's password (admin only)
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.userId !== 'admin-id-static') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { newPassword, role } = await req.json();

    await connectToDatabase();

    const user = await User.findById(params.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const updates: any = {};

    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }
      updates.password = await bcrypt.hash(newPassword, 12);
    }

    if (role) {
      const allowedRoles = ['employee', 'manager', 'admin'];
      if (!allowedRoles.includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
      }
      updates.role = role;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Provide newPassword or role to update' }, { status: 400 });
    }

    await User.findByIdAndUpdate(params.id, updates);

    return NextResponse.json({ message: 'Updated successfully' });

  } catch (error: any) {
    console.error('Password reset error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE — remove an employee account (admin only)
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params;
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.userId !== 'admin-id-static') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    await connectToDatabase();
    const user = await User.findByIdAndDelete(params.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({ message: 'User deleted successfully' });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
