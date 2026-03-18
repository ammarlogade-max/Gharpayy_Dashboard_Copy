import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import connectToDatabase from '@/lib/mongodb';
import User from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'gharpayy@123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin!123admin@123admin';

// In-memory rate limiter — max 5 failed attempts per IP per 15 minutes
// This resets on server restart which is fine for Vercel serverless
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function checkRateLimit(ip: string): { blocked: boolean; remaining: number } {
  const now = Date.now();
  const entry = failedAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    return { blocked: false, remaining: MAX_ATTEMPTS };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { blocked: true, remaining: 0 };
  }

  return { blocked: false, remaining: MAX_ATTEMPTS - entry.count };
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearFailures(ip: string): void {
  failedAttempts.delete(ip);
}

export async function POST(req: Request) {
  try {
    const ip = getClientIP(req);
    const { blocked } = checkRateLimit(ip);

    if (blocked) {
      return NextResponse.json(
        { error: 'Too many failed login attempts. Please try again in 15 minutes.' },
        { status: 429 }
      );
    }

    const { email: rawEmail, password } = await req.json();
    const email = rawEmail?.trim();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    // Static admin check via env vars
    if (email === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      clearFailures(ip);
      const token = jwt.sign(
        { userId: 'admin-id-static', email: ADMIN_USERNAME, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      const cookieStore = await cookies();
      cookieStore.set('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });

      return NextResponse.json({
        message: 'Logged in successfully',
        user: { id: 'admin-id-static', email: ADMIN_USERNAME, fullName: 'Administrator', role: 'admin' },
      });
    }

    // Database login
    await connectToDatabase();
    const user = await User.findOne({ email });

    if (!user || !user.password) {
      recordFailure(ip);
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      recordFailure(ip);
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    // Successful login — clear failed attempts
    clearFailures(ip);

    // Normalize legacy 'user' role to 'employee'
    const role = user.role === 'user' ? 'employee' : user.role;

    const token = jwt.sign(
      { userId: user._id, email: user.email, role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const cookieStore = await cookies();
    cookieStore.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });

    return NextResponse.json({
      message: 'Logged in successfully',
      user: { id: user._id, email: user.email, fullName: user.fullName, role },
    });

  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
