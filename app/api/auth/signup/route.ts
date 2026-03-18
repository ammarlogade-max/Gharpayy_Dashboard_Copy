import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';

export async function POST(req: Request) {
  try {
    const { email, password, fullName, role } = await req.json();

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'Full name, email and password are required.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    await connectToDatabase();

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Only allow employee/manager roles via signup — admin must be set manually
    const allowedRoles = ['employee', 'manager'];
    const assignedRole = allowedRoles.includes(role) ? role : 'employee';

    const newUser = await User.create({
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      fullName: fullName.trim(),
      role: assignedRole,
    });

    return NextResponse.json({
      message: 'Account created successfully',
      user: { email: newUser.email, fullName: newUser.fullName, role: newUser.role },
    }, { status: 201 });

  } catch (error: any) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
