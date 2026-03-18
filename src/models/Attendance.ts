import mongoose, { Schema, Document } from 'mongoose';

export interface IBreak {
  type: 'lunch' | 'short' | 'personal';
  startTime: Date;
  endTime?: Date;
  durationMins?: number;
}

export interface ISession {
  checkIn: Date;
  checkOut?: Date;
  checkInLat?: number;
  checkInLng?: number;
  checkOutLat?: number;
  checkOutLng?: number;
  durationMins?: number;
}

export interface IAttendance extends Document {
  employeeId: mongoose.Types.ObjectId;
  date: string;
  sessions: ISession[];
  breaks: IBreak[];
  totalWorkMins: number;
  dayStatus: 'Early' | 'On Time' | 'Late' | 'Absent';
  isWithinGeofence: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BreakSchema = new Schema<IBreak>({
  type: { type: String, enum: ['lunch', 'short', 'personal'], required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  durationMins: { type: Number },
}, { _id: false });

const SessionSchema = new Schema<ISession>({
  checkIn: { type: Date, required: true },
  checkOut: { type: Date },
  checkInLat: { type: Number },
  checkInLng: { type: Number },
  checkOutLat: { type: Number },
  checkOutLng: { type: Number },
  durationMins: { type: Number },
}, { _id: false });

const AttendanceSchema = new Schema<IAttendance>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  sessions: [SessionSchema],
  breaks: [BreakSchema],
  totalWorkMins: { type: Number, default: 0 },
  dayStatus: { type: String, enum: ['Early', 'On Time', 'Late', 'Absent'], default: 'Absent' },
  isWithinGeofence: { type: Boolean, default: false },
  notes: { type: String },
}, { timestamps: true });

AttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

export default mongoose.models.Attendance || mongoose.model<IAttendance>('Attendance', AttendanceSchema);
