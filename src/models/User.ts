import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  password?: string;
  fullName: string;
  role: 'admin' | 'manager' | 'employee' | 'user'; // 'user' kept for backward compat
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: false },
    fullName: { type: String, required: true },
    role: { type: String, enum: ['admin', 'manager', 'employee', 'user'], default: 'employee' },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
