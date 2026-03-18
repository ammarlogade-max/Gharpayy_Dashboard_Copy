'use client';

import { useState, useEffect, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Upload, Download, Plus, Key, Trash2, Users, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface Employee {
  _id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
}

interface CSVRow {
  fullName: string;
  email: string;
  password: string;
  role: string;
  _valid: boolean;
  _error?: string;
}

const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-purple-100 text-purple-700',
  employee: 'bg-green-100 text-green-700',
  user: 'bg-gray-100 text-gray-600',
};

export default function AdminEmployeesPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fetching, setFetching] = useState(true);
  const [csvRows, setCsvRows] = useState<CSVRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<any[] | null>(null);

  // Single add form
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ fullName: '', email: '', password: '', role: 'employee' });
  const [addLoading, setAddLoading] = useState(false);

  // Password reset
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Role change
  const [roleChanging, setRoleChanging] = useState<string | null>(null);

  // Redirect non-admins
  useEffect(() => {
    if (!loading && user && user.role !== 'admin') {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  const fetchEmployees = async () => {
    setFetching(true);
    try {
      const res = await fetch('/api/admin/employees');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setEmployees(data.users || []);
    } catch {
      toast.error('Failed to load employees');
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'admin') fetchEmployees();
  }, [user]);

  // Download sample CSV
  const downloadSample = () => {
    const csv = [
      'Full Name,Email,Password,Role',
      'Rahul Sharma,rahul@gharpayy.com,Pass@1234,employee',
      'Priya Singh,priya@gharpayy.com,Pass@1234,manager',
      'Neha Gupta,neha@gharpayy.com,Pass@1234,employee',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gharpayy_employees_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Parse uploaded CSV
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split('\n').filter(l => l.trim());

      // Skip header row
      const dataLines = lines[0].toLowerCase().includes('full name') ? lines.slice(1) : lines;

      const rows: CSVRow[] = dataLines.map((line) => {
        const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        const [fullName, email, password, role] = parts;

        let _error = '';
        if (!fullName) _error = 'Missing full name';
        else if (!email || !email.includes('@')) _error = 'Invalid email';
        else if (!password || password.length < 6) _error = 'Password too short (min 6 chars)';

        const validRoles = ['employee', 'manager'];
        const normalizedRole = validRoles.includes(role?.toLowerCase()) ? role.toLowerCase() : 'employee';

        return {
          fullName: fullName || '',
          email: email || '',
          password: password || '',
          role: normalizedRole,
          _valid: !_error,
          _error,
        };
      });

      setCsvRows(rows);
      setImportResults(null);
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  // Bulk import
  const handleBulkImport = async () => {
    const validRows = csvRows.filter(r => r._valid);
    if (validRows.length === 0) {
      toast.error('No valid rows to import');
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employees: validRows.map(r => ({
            fullName: r.fullName,
            email: r.email,
            password: r.password,
            role: r.role,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setImportResults(data.results);
      toast.success(`${data.successCount} employees created! ${data.failCount > 0 ? `${data.failCount} failed.` : ''}`);
      setCsvRows([]);
      fetchEmployees();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Single add
  const handleAddSingle = async () => {
    if (!addForm.fullName || !addForm.email || !addForm.password) {
      toast.error('All fields are required');
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employees: [addForm] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.results?.[0]?.error) throw new Error(data.results[0].error);

      toast.success('Employee created successfully');
      setAddOpen(false);
      setAddForm({ fullName: '', email: '', password: '', role: 'employee' });
      fetchEmployees();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAddLoading(false);
    }
  };

  // Password reset
  const handlePasswordReset = async () => {
    if (!resetTarget || !newPassword) return;
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setResetLoading(true);
    try {
      const res = await fetch(`/api/admin/employees/${resetTarget._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Password reset for ${resetTarget.fullName}`);
      setResetOpen(false);
      setNewPassword('');
      setResetTarget(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResetLoading(false);
    }
  };

  // Role change
  const handleRoleChange = async (empId: string, newRole: string) => {
    setRoleChanging(empId);
    try {
      const res = await fetch(`/api/admin/employees/${empId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Role updated');
      setEmployees(prev => prev.map(e => e._id === empId ? { ...e, role: newRole } : e));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRoleChanging(null);
    }
  };

  // Delete employee
  const handleDelete = async (emp: Employee) => {
    if (!confirm(`Delete ${emp.fullName}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/employees/${emp._id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Employee deleted');
      setEmployees(prev => prev.filter(e => e._id !== emp._id));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) return null;
  if (user?.role !== 'admin') return null;

  const validCount = csvRows.filter(r => r._valid).length;
  const invalidCount = csvRows.filter(r => !r._valid).length;

  return (
    <AppLayout title="Manage Employees" subtitle="Bulk onboard and manage team members">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Employees', value: employees.length, color: 'text-foreground' },
          { label: 'Admins', value: employees.filter(e => e.role === 'admin').length, color: 'text-red-600' },
          { label: 'Managers', value: employees.filter(e => e.role === 'manager').length, color: 'text-purple-600' },
          { label: 'Employees', value: employees.filter(e => e.role === 'employee' || e.role === 'user').length, color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="kpi-card text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Actions row */}
      <div className="flex flex-wrap gap-3 mb-6">
        <Button onClick={() => setAddOpen(true)} className="gap-2 bg-accent hover:bg-accent/90 text-white">
          <Plus size={15} /> Add Single Employee
        </Button>
        <Button variant="outline" onClick={downloadSample} className="gap-2">
          <Download size={15} /> Download CSV Template
        </Button>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
          <Upload size={15} /> Upload CSV
        </Button>
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
        <Button variant="outline" onClick={fetchEmployees} className="gap-2">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {/* CSV Preview */}
      {csvRows.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="kpi-card mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-xs text-foreground">CSV Preview</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {validCount} valid · {invalidCount} invalid
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCsvRows([])} className="text-xs h-8">
                Clear
              </Button>
              <Button
                size="sm"
                onClick={handleBulkImport}
                disabled={importing || validCount === 0}
                className="gap-1.5 text-xs h-8 bg-accent hover:bg-accent/90 text-white"
              >
                {importing ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
                Import {validCount} Employees
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Full Name</th>
                  <th className="text-left py-2 px-3">Email</th>
                  <th className="text-left py-2 px-3">Role</th>
                  <th className="text-left py-2 px-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, i) => (
                  <tr key={i} className={`border-b border-border/50 ${!row._valid ? 'bg-red-50' : ''}`}>
                    <td className="py-2 px-3">
                      {row._valid
                        ? <CheckCircle size={13} className="text-green-500" />
                        : <XCircle size={13} className="text-red-500" />}
                    </td>
                    <td className="py-2 px-3 font-medium">{row.fullName || '—'}</td>
                    <td className="py-2 px-3 text-muted-foreground">{row.email || '—'}</td>
                    <td className="py-2 px-3">
                      <Badge className={`text-[10px] ${ROLE_COLOR[row.role] || ''}`}>{row.role}</Badge>
                    </td>
                    <td className="py-2 px-3 text-red-500 text-[10px]">{row._error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Import results */}
      {importResults && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="kpi-card mb-6">
          <h3 className="font-semibold text-xs text-foreground mb-3">Import Results</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {importResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                {r.success
                  ? <CheckCircle size={12} className="text-green-500 shrink-0" />
                  : <XCircle size={12} className="text-red-500 shrink-0" />}
                <span className={r.success ? 'text-foreground' : 'text-red-600'}>
                  {r.name} ({r.email}){r.error ? ` — ${r.error}` : ' — Created'}
                </span>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setImportResults(null)}>
            Dismiss
          </Button>
        </motion.div>
      )}

      {/* Employee list */}
      <div className="kpi-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-xs text-foreground">All Employees ({employees.length})</h3>
        </div>

        {fetching ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-secondary/50 animate-pulse" />
            ))}
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-12">
            <Users size={32} className="text-muted-foreground mx-auto mb-3" />
            <p className="text-xs text-muted-foreground">No employees yet. Add some above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Name</th>
                  <th className="text-left py-2 px-3">Email</th>
                  <th className="text-center py-2 px-3">Role</th>
                  <th className="text-center py-2 px-3">Change Role</th>
                  <th className="text-center py-2 px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <motion.tr
                    key={emp._id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-b border-border/50 hover:bg-secondary/30"
                  >
                    <td className="py-2.5 px-3 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-accent">{(emp.fullName || '?').charAt(0)}</span>
                        </div>
                        {emp.fullName || 'Unknown'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{emp.email}</td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge className={`text-[10px] ${ROLE_COLOR[emp.role] || 'bg-gray-100 text-gray-600'}`}>
                        {emp.role}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <Select
                        value={emp.role}
                        onValueChange={(val) => handleRoleChange(emp._id, val)}
                        disabled={roleChanging === emp._id}
                      >
                        <SelectTrigger className="h-7 w-32 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="manager">Manager</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[10px] gap-1"
                          onClick={() => { setResetTarget(emp); setResetOpen(true); }}
                        >
                          <Key size={11} /> Reset Password
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(emp)}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Single Employee Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Full Name</label>
              <Input
                placeholder="Rahul Sharma"
                value={addForm.fullName}
                onChange={e => setAddForm(f => ({ ...f, fullName: e.target.value }))}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <Input
                type="email"
                placeholder="rahul@gharpayy.com"
                value={addForm.email}
                onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Password</label>
              <Input
                type="password"
                placeholder="Min 6 characters"
                value={addForm.password}
                onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Role</label>
              <Select value={addForm.role} onValueChange={val => setAddForm(f => ({ ...f, role: val }))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleAddSingle}
              disabled={addLoading}
              className="w-full h-9 text-xs bg-accent hover:bg-accent/90 text-white"
            >
              {addLoading ? 'Creating...' : 'Create Employee'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Reset Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Setting new password for <span className="font-semibold text-foreground">{resetTarget?.fullName}</span>
            </p>
            <Input
              type="password"
              placeholder="New password (min 6 characters)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="h-9 text-xs"
            />
            <Button
              onClick={handlePasswordReset}
              disabled={resetLoading || newPassword.length < 6}
              className="w-full h-9 text-xs bg-accent hover:bg-accent/90 text-white"
            >
              {resetLoading ? 'Resetting...' : 'Reset Password'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
