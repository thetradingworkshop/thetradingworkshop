import React, { useState, useMemo, useEffect } from 'react';
import { cn } from '@/src/utils';
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, updateDoc, deleteDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import {
  SectionHeader,
  Card,
  Button,
  Badge,
  Input,
  Modal,
  Toast,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell
} from '../components/Shared';
import {
  Users,
  Shield,
  Lock,
  History,
  Search,
  MoreHorizontal,
  X,
  Check,
  AlertTriangle,
  Trash2,
  Settings,
  UserCheck,
  UserX,
  ShieldCheck,
} from 'lucide-react';

// This screen used to run entirely on a hardcoded array of five fake
// people (comment literally read "Mock Data") with every action —
// edit, suspend, delete — only mutating local state, never touching the
// real `users` collection AuthContext actually writes to. An admin here
// couldn't see or manage a single real registered user.
//
// Rebuilt on the real `users` collection. What's genuinely persisted:
// role, status (active/inactive), mentor assignment (mentorId — the actual
// access-control mechanism firestore.rules' isAssignedMentor() checks, not
// a cosmetic label), and delete of the Firestore profile doc — plus a real
// audit_logs collection recording who did what. What's deliberately NOT
// claimed as real: per-user granular permission overrides beyond role and
// mentor assignment, group assignment, and creating brand-new accounts —
// none of those have a real backing field or server-side flow anywhere
// in the app, so rather than fake them, this screen says so.

type Role = 'Admin' | 'Mentor' | 'Student' | 'Viewer';

interface Permission {
  id: string;
  name: string;
  description: string;
  category: 'Import' | 'Data Access' | 'Comments' | 'Admin';
}

interface UserData {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'inactive';
  mentorId?: string; // uid of the Mentor-role user this Student is assigned to
  updatedAt: string; // formatted, or 'Unknown'
}

interface AuditLogEntry {
  id: string;
  userName: string;
  action: string;
  target: string;
  createdAt: string;
  critical: boolean;
}

// --- Reference data (documentation of what each role is meant to allow —
// not enforced anywhere beyond sidebar nav visibility in AppShell.tsx, and
// labeled as such below rather than presented as a live permissions engine).

const PERMISSIONS: Permission[] = [
  { id: 'imp_csv', name: 'Import CSV', description: 'Allow uploading and processing broker CSV files', category: 'Import' },
  { id: 'imp_manual', name: 'Manual Entry', description: 'Allow manual entry of trade data', category: 'Import' },

  { id: 'view_all', name: 'View All Data', description: 'Access to all users trading data and reports', category: 'Data Access' },
  { id: 'view_own', name: 'View Own Data', description: 'Access to personal trading data only', category: 'Data Access' },
  { id: 'export_data', name: 'Export Reports', description: 'Allow exporting data to PDF/Excel', category: 'Data Access' },

  { id: 'post_comm', name: 'Post Comments', description: 'Allow commenting on journals and trades', category: 'Comments' },
  { id: 'edit_comm', name: 'Edit Comments', description: 'Allow editing or deleting own comments', category: 'Comments' },
  { id: 'mod_comm', name: 'Moderate Comments', description: 'Allow deleting any user comments', category: 'Comments' },

  { id: 'manage_users', name: 'Manage Users', description: 'Create, edit, and deactivate user accounts', category: 'Admin' },
  { id: 'manage_roles', name: 'Manage Roles', description: 'Modify role templates and global permissions', category: 'Admin' },
  { id: 'view_audit', name: 'View Audit Logs', description: 'Access to system-wide activity logs', category: 'Admin' },
];

const ROLE_TEMPLATES: Record<Role, string[]> = {
  Admin: PERMISSIONS.map(p => p.id),
  Mentor: ['imp_csv', 'view_all', 'export_data', 'post_comm', 'edit_comm', 'mod_comm', 'view_audit'],
  Student: ['imp_csv', 'imp_manual', 'view_own', 'post_comm', 'edit_comm'],
  Viewer: ['view_own'],
};

function fmtTimestamp(v: any): string {
  if (!v) return 'Unknown';
  const d = v.toDate ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function UsersPermissionsScreen() {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState<UserData[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<UserData | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const docs: UserData[] = snapshot.docs.map(d => {
        const data: any = d.data();
        return {
          id: d.id,
          name: data.name || data.email || 'Unnamed user',
          email: data.email || '',
          role: (data.role as Role) || 'Student',
          status: data.status === 'inactive' ? 'inactive' : 'active',
          mentorId: data.mentorId || undefined,
          updatedAt: fmtTimestamp(data.updatedAt),
        };
      });
      setUsers(docs);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc'), limit(50)),
      (snapshot) => {
        setAuditLogs(snapshot.docs.map(d => {
          const data: any = d.data();
          return {
            id: d.id,
            userName: data.userName || 'Unknown',
            action: data.action || '',
            target: data.target || '',
            createdAt: fmtTimestamp(data.createdAt),
            critical: !!data.critical,
          };
        }));
      },
      (err) => console.error('audit_logs listener error:', err)
    );
    return () => unsubscribe();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter(u =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [users, searchQuery]);

  const mentors = useMemo(() => users.filter(u => u.role === 'Mentor'), [users]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const logAudit = async (action: string, target: string, critical: boolean) => {
    try {
      await addDoc(collection(db, 'audit_logs'), {
        userName: currentUser?.displayName || currentUser?.email || 'Unknown',
        actorId: currentUser?.uid || null,
        action, target, critical,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  };

  const handleRoleChange = async (user: UserData, newRole: Role) => {
    try {
      await updateDoc(doc(db, 'users', user.id), { role: newRole, updatedAt: serverTimestamp() });
      await logAudit('Role Changed', `${user.name} (${user.role} → ${newRole})`, true);
      setSelectedUser(prev => (prev && prev.id === user.id ? { ...prev, role: newRole } : prev));
      showToast(`${user.name}'s role changed to ${newRole}`);
    } catch (err: any) {
      showToast(`Failed to update role: ${err.message}`, 'error');
    }
  };

  const handleStatusToggle = async (user: UserData) => {
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await updateDoc(doc(db, 'users', user.id), { status: newStatus, updatedAt: serverTimestamp() });
      await logAudit(newStatus === 'active' ? 'User Activated' : 'User Deactivated', user.name, true);
      setSelectedUser(prev => (prev && prev.id === user.id ? { ...prev, status: newStatus } : prev));
      showToast(`${user.name} is now ${newStatus}`);
    } catch (err: any) {
      showToast(`Failed to update status: ${err.message}`, 'error');
    }
  };

  // The real scoping mechanism behind Mentor Dashboard's per-mentor roster
  // and firestore.rules' isAssignedMentor() — a Student's mentorId here is
  // the only thing that lets a Mentor account read that student's trades
  // and journals at all (see firestore.rules), so this is a real access
  // grant, not a cosmetic label.
  const handleMentorAssign = async (user: UserData, mentorId: string) => {
    try {
      await updateDoc(doc(db, 'users', user.id), { mentorId: mentorId || null, updatedAt: serverTimestamp() });
      const mentorName = mentorId ? (users.find(u => u.id === mentorId)?.name || mentorId) : 'Unassigned';
      await logAudit('Mentor Assigned', `${user.name} → ${mentorName}`, true);
      setSelectedUser(prev => (prev && prev.id === user.id ? { ...prev, mentorId: mentorId || undefined } : prev));
      showToast(`${user.name} assigned to ${mentorName}`);
    } catch (err: any) {
      showToast(`Failed to assign mentor: ${err.message}`, 'error');
    }
  };

  const handleDeleteUser = async (user: UserData) => {
    try {
      await deleteDoc(doc(db, 'users', user.id));
      await logAudit('User Profile Deleted', user.name, true);
      setIsModalOpen(false);
      setPendingDelete(null);
      if (selectedUser?.id === user.id) setSelectedUser(null);
      showToast(`${user.name}'s profile deleted`, 'error');
    } catch (err: any) {
      showToast(`Failed to delete: ${err.message}`, 'error');
    }
  };

  const confirmDelete = (user: UserData) => {
    setPendingDelete(user);
    setIsModalOpen(true);
  };

  // --- Sub-components ---

  const UserRow = ({ user }: { user: UserData }) => {
    const [showActions, setShowActions] = useState(false);
    return (
      <TableRow className="group cursor-pointer" onClick={() => setSelectedUser(user)}>
        <TableCell>
          <div className="flex items-center space-x-3">
            <div className={cn(
              "w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm transition-all group-hover:scale-105",
              user.status === 'active' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}>
              {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="font-bold flex items-center space-x-2">
                <span className="text-sm">{user.name}</span>
                {user.status === 'inactive' && <Badge variant="neutral" className="text-[9px] px-1.5 py-0">Inactive</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground">{user.email}</div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge
            variant={user.role === 'Admin' ? 'negative' : user.role === 'Mentor' ? 'warning' : user.role === 'Student' ? 'positive' : 'neutral'}
            className="text-[10px]"
          >
            {user.role}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground text-xs font-medium">{user.updatedAt}</TableCell>
        <TableCell>
          <div className="flex items-center space-x-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", user.status === 'active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-zinc-500")} />
            <span className="text-xs font-medium capitalize">{user.status}</span>
          </div>
        </TableCell>
        <TableCell className="text-right relative">
          <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }} className="opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
          </Button>
          {showActions && (
            <div className="absolute right-4 top-12 z-10 w-48 bg-card border border-border rounded-2xl shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-100">
              <button onClick={(e) => { e.stopPropagation(); setSelectedUser(user); setShowActions(false); }} className="w-full px-4 py-2 text-left text-xs hover:bg-accent flex items-center space-x-2 transition-colors">
                <Settings className="w-3 h-3" /> <span>Manage User</span>
              </button>
              <button onClick={(e) => { e.stopPropagation(); handleStatusToggle(user); setShowActions(false); }} className="w-full px-4 py-2 text-left text-xs hover:bg-accent flex items-center space-x-2 transition-colors">
                {user.status === 'active' ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                <span>{user.status === 'active' ? 'Deactivate' : 'Activate'}</span>
              </button>
              <div className="h-px bg-border my-1" />
              <button onClick={(e) => { e.stopPropagation(); confirmDelete(user); setShowActions(false); }} className="w-full px-4 py-2 text-left text-xs hover:bg-rose-500/10 text-rose-500 flex items-center space-x-2 transition-colors">
                <Trash2 className="w-3 h-3" /> <span>Delete Profile</span>
              </button>
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  };

  // --- Tabs ---

  const renderUsersTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or email..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground italic max-w-xs text-right">
          New accounts are created by signing in with Google — invite someone by sharing the app URL, then set their role here.
        </p>
      </div>

      <Card noPadding>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User Profile</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            {filteredUsers.length > 0 ? filteredUsers.map((user) => (
              <UserRow key={user.id} user={user} />
            )) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground italic">
                  {users.length === 0 ? 'No registered users yet.' : 'No users match your search.'}
                </TableCell>
              </TableRow>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );

  const renderRolesTab = () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground italic">Reference only — what each role is meant to allow. Not yet enforced beyond which pages appear in navigation.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {(Object.keys(ROLE_TEMPLATES) as Role[]).map(role => (
          <Card key={role} className="p-6 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center",
                role === 'Admin' ? "bg-rose-500/10 text-rose-500" :
                role === 'Mentor' ? "bg-amber-500/10 text-amber-500" :
                role === 'Student' ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-500"
              )}>
                <Shield className="w-6 h-6" />
              </div>
            </div>
            <h3 className="text-lg font-bold mb-1">{role}</h3>
            <p className="text-xs text-muted-foreground mb-6">Reference template for {role.toLowerCase()} accounts.</p>
            <div className="flex-1 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Intended Permissions</p>
              <div className="space-y-2">
                {ROLE_TEMPLATES[role].slice(0, 4).map(pid => {
                  const p = PERMISSIONS.find(perm => perm.id === pid);
                  return (
                    <div key={pid} className="flex items-center space-x-2 text-xs">
                      <Check className="w-3 h-3 text-emerald-500" />
                      <span>{p?.name}</span>
                    </div>
                  );
                })}
                {ROLE_TEMPLATES[role].length > 4 && (
                  <p className="text-[10px] text-muted-foreground font-medium pl-5">+{ROLE_TEMPLATES[role].length - 4} more...</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderAccessRulesTab = () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground italic">Reference only — not a live permissions engine yet.</p>
      <Card noPadding className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[240px]">Permission</TableHead>
              {(Object.keys(ROLE_TEMPLATES) as Role[]).map(role => (
                <TableHead key={role} className="text-center">{role}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <tbody>
            {PERMISSIONS.map(p => (
              <TableRow key={p.id} className="hover:bg-accent/10 transition-colors">
                <TableCell>
                  <p className="font-bold text-sm">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground">{p.description}</p>
                </TableCell>
                {(Object.keys(ROLE_TEMPLATES) as Role[]).map(role => (
                  <TableCell key={role} className="text-center">
                    {ROLE_TEMPLATES[role].includes(p.id) ? (
                      <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted/40 text-muted-foreground/30">
                        <X className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );

  const renderAuditLogTab = () => (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground italic">Real actions taken from this screen — role changes, activate/deactivate, profile deletion.</p>
      <Card noPadding>
        {auditLogs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground italic text-sm">No actions logged yet.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {auditLogs.map(log => (
              <div key={log.id} className="p-5 flex items-center justify-between hover:bg-accent/10 transition-colors group">
                <div className="flex items-center space-x-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110", log.critical ? "bg-rose-500/10 text-rose-500" : "bg-indigo-500/10 text-indigo-500")}>
                    {log.critical ? <AlertTriangle className="w-5 h-5" /> : <History className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-bold">
                      <span className="text-primary">{log.userName}</span>
                      <span className="text-muted-foreground font-normal mx-2">performed</span>
                      <span className="text-foreground">{log.action}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Target: <span className="font-medium text-foreground">{log.target}</span></p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-mono text-muted-foreground tracking-tighter">{log.createdAt}</p>
                  {log.critical && <Badge variant="negative" className="text-[9px] mt-1.5 px-2">Critical Action</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );

  return (
    <div className="space-y-8 pb-20">
      <SectionHeader
        title="Users & Permissions"
        subtitle="Manage who has access and what role they hold"
      />

      <div className="flex items-center space-x-1 border-b border-border overflow-x-auto no-scrollbar">
        {[
          { id: 'users', label: 'Users', icon: Users },
          { id: 'roles', label: 'Role Templates', icon: Shield },
          { id: 'access rules', label: 'Access Rules', icon: Lock },
          { id: 'audit log', label: 'Audit Log', icon: History },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-6 py-4 text-sm font-bold capitalize transition-all relative flex items-center space-x-2 whitespace-nowrap",
              activeTab === tab.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className={cn("w-4 h-4 transition-transform", activeTab === tab.id && "scale-110")} />
            <span>{tab.label}</span>
            {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />}
          </button>
        ))}
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {activeTab === 'users' && renderUsersTab()}
        {activeTab === 'roles' && renderRolesTab()}
        {activeTab === 'access rules' && renderAccessRulesTab()}
        {activeTab === 'audit log' && renderAuditLogTab()}
      </div>

      {/* User Side Drawer */}
      {selectedUser && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px] animate-in fade-in duration-300" onClick={() => setSelectedUser(null)} />
          <div className="relative w-full max-w-xl h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-500 ease-out">
            <div className="p-8 border-b border-border flex items-center justify-between bg-accent/5">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-lg font-bold shadow-sm">
                  {selectedUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{selectedUser.name}</h2>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-medium">{selectedUser.email}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedUser(null)}><X className="w-5 h-5" /></Button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10 no-scrollbar">
              <section className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last Updated</label>
                <p className="text-sm font-medium text-foreground">{selectedUser.updatedAt}</p>
              </section>

              <section className="space-y-6">
                <h3 className="text-sm font-bold flex items-center space-x-2 text-foreground">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span>Role &amp; Status</span>
                </h3>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">System Role</label>
                    <select
                      className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                      value={selectedUser.role}
                      onChange={(e) => handleRoleChange(selectedUser, e.target.value as Role)}
                    >
                      <option>Admin</option>
                      <option>Mentor</option>
                      <option>Student</option>
                      <option>Viewer</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Account Status</label>
                    <div className="flex items-center space-x-3 h-[42px]">
                      <Button
                        variant={selectedUser.status === 'active' ? 'outline' : 'primary'}
                        className="flex-1 h-full font-bold text-xs"
                        onClick={() => handleStatusToggle(selectedUser)}
                      >
                        {selectedUser.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              {selectedUser.role === 'Student' && (
                <section className="space-y-3">
                  <h3 className="text-sm font-bold flex items-center space-x-2 text-foreground">
                    <UserCheck className="w-4 h-4 text-primary" />
                    <span>Mentor Assignment</span>
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    This is what actually grants access — the assigned mentor is the only Mentor-role account
                    that can read this student's trades and journal notes (see Mentor Dashboard).
                  </p>
                  <select
                    className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                    value={selectedUser.mentorId || ''}
                    onChange={(e) => handleMentorAssign(selectedUser, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {mentors.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  {mentors.length === 0 && (
                    <p className="text-[11px] text-amber-500 italic">No Mentor-role accounts exist yet — set a user's role to Mentor above first.</p>
                  )}
                </section>
              )}

              <section className="space-y-4">
                <h3 className="text-sm font-bold flex items-center space-x-2 text-foreground">
                  <Lock className="w-4 h-4 text-primary" />
                  <span>Permissions for {selectedUser.role}</span>
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Reference only, based on their role — per-user overrides aren't built yet.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {ROLE_TEMPLATES[selectedUser.role].map(pid => {
                    const p = PERMISSIONS.find(perm => perm.id === pid);
                    if (!p) return null;
                    return (
                      <div key={pid} className="flex items-center justify-between p-3 bg-accent/20 rounded-xl">
                        <div>
                          <p className="text-xs font-bold">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground">{p.description}</p>
                        </div>
                        <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="p-8 border-t border-border bg-accent/5 flex items-center justify-between">
              <Button variant="outline" size="md" onClick={() => setSelectedUser(null)}>Close Panel</Button>
              <Button variant="ghost" size="md" className="text-rose-500 hover:bg-rose-500/5" icon={Trash2} onClick={() => confirmDelete(selectedUser)}>Delete Profile</Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Delete User Profile"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button variant="primary" className="bg-rose-500 hover:bg-rose-600" onClick={() => pendingDelete && handleDeleteUser(pendingDelete)}>
              Confirm Delete
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-500">
            <Trash2 className="w-8 h-8" />
          </div>
          <div>
            <p className="font-bold text-lg">Are you absolutely sure?</p>
            <p className="text-sm text-muted-foreground mt-2">
              This deletes <span className="font-bold text-foreground">{pendingDelete?.name}</span>'s app profile — their role, status, and access to this app.
              It does <span className="font-bold">not</span> delete their Google/Firebase sign-in account or their trades; they could sign in again and get a fresh profile.
            </p>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
