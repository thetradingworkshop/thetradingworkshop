import React, { useState, useMemo, useEffect } from 'react';
import { cn } from '@/src/utils';
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { generateInviteCode } from '../lib/inviteCode';
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
  UserPlus,
  Copy,
  Ban,
  Layers,
  Plus,
  Mail,
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
  groupId?: string; // id of the cohort this user belongs to, if any
  referredBy?: string; // uid of whoever's invite/referral link created this account, if any
  referredByName?: string;
  updatedAt: string; // formatted, or 'Unknown'
}

// invites/{id} — see firestore.rules' isValidInvite() and
// AuthContext.tsx's redemption flow for what actually enforces this.
type InviteStatus = 'active' | 'exhausted' | 'expired' | 'revoked';

interface InviteRow {
  id: string; // == code
  role: Role;
  mentorId?: string;
  groupId?: string;
  label: string;
  createdByName: string;
  createdAt: string;
  expiresAtDate: Date;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revoked: boolean;
  status: InviteStatus;
}

interface GroupRow {
  id: string;
  name: string;
  mentorId?: string;
  createdAt: string;
}

function inviteStatus(revoked: boolean, expiresAtDate: Date, useCount: number, maxUses: number): InviteStatus {
  if (revoked) return 'revoked';
  if (expiresAtDate.getTime() <= Date.now()) return 'expired';
  if (useCount >= maxUses) return 'exhausted';
  return 'active';
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

  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState<{
    role: Role; mentorId: string; groupId: string; label: string; expiresInDays: number; maxUses: number;
  }>({ role: 'Student', mentorId: '', groupId: '', label: '', expiresInDays: 7, maxUses: 1 });
  const [groupForm, setGroupForm] = useState<{ name: string; mentorId: string }>({ name: '', mentorId: '' });

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
          groupId: data.groupId || undefined,
          referredBy: data.referredBy || undefined,
          referredByName: data.referredByName || undefined,
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

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'invites'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setInvites(snapshot.docs.map(d => {
          const data: any = d.data();
          const expiresAtDate = data.expiresAt?.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
          const useCount = data.useCount ?? 0;
          const maxUses = data.maxUses ?? 1;
          const revoked = !!data.revoked;
          return {
            id: d.id,
            role: (data.role as Role) || 'Student',
            mentorId: data.mentorId || undefined,
            groupId: data.groupId || undefined,
            label: data.label || 'Untitled invite',
            createdByName: data.createdByName || 'Unknown',
            createdAt: fmtTimestamp(data.createdAt),
            expiresAtDate,
            expiresAt: fmtTimestamp(data.expiresAt),
            maxUses, useCount, revoked,
            status: inviteStatus(revoked, expiresAtDate, useCount, maxUses),
          };
        }));
      },
      (err) => console.error('invites listener error:', err)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'groups'), orderBy('createdAt', 'desc')),
      (snapshot) => {
        setGroups(snapshot.docs.map(d => {
          const data: any = d.data();
          return {
            id: d.id,
            name: data.name || 'Untitled group',
            mentorId: data.mentorId || undefined,
            createdAt: fmtTimestamp(data.createdAt),
          };
        }));
      },
      (err) => console.error('groups listener error:', err)
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

  const groupMembersOf = useMemo(() => {
    const map = new Map<string, UserData[]>();
    for (const u of users) {
      if (!u.groupId) continue;
      if (!map.has(u.groupId)) map.set(u.groupId, []);
      map.get(u.groupId)!.push(u);
    }
    return map;
  }, [users]);

  const nameOf = (uid?: string) => (uid ? users.find(u => u.id === uid)?.name || uid : null);
  const groupNameOf = (gid?: string) => (gid ? groups.find(g => g.id === gid)?.name || gid : null);

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

  // Purely organizational — see firestore.rules' comment on /groups. This
  // never grants anyone read access; it just labels which cohort a person
  // is in for rostering and bulk-invite purposes.
  const handleGroupAssign = async (user: UserData, groupId: string) => {
    try {
      await updateDoc(doc(db, 'users', user.id), { groupId: groupId || null, updatedAt: serverTimestamp() });
      const groupName = groupId ? (groups.find(g => g.id === groupId)?.name || groupId) : 'Ungrouped';
      await logAudit('Group Assigned', `${user.name} → ${groupName}`, false);
      setSelectedUser(prev => (prev && prev.id === user.id ? { ...prev, groupId: groupId || undefined } : prev));
      showToast(`${user.name} added to ${groupName}`);
    } catch (err: any) {
      showToast(`Failed to assign group: ${err.message}`, 'error');
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

  // Writes the invites/{code} doc directly (see firestore.rules — create is
  // Admin-only). role/mentorId/groupId here are exactly what a redeeming
  // sign-in gets granted; see AuthContext.tsx's tryRedeemPendingInvite.
  const handleCreateInvite = async () => {
    if (!currentUser) return;
    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + inviteForm.expiresInDays * 24 * 60 * 60 * 1000);
    try {
      await setDoc(doc(db, 'invites', code), {
        code,
        role: inviteForm.role,
        mentorId: inviteForm.mentorId || null,
        groupId: inviteForm.groupId || null,
        label: inviteForm.label.trim() || `${inviteForm.role} invite`,
        createdBy: currentUser.uid,
        createdByName: currentUser.displayName || currentUser.email || 'Admin',
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        maxUses: inviteForm.maxUses,
        useCount: 0,
        revoked: false,
      });
      await logAudit('Invite Created', `${inviteForm.role} invite "${inviteForm.label || code}" (max ${inviteForm.maxUses} use${inviteForm.maxUses === 1 ? '' : 's'})`, false);
      setGeneratedLink(`${window.location.origin}${window.location.pathname}?invite=${code}`);
    } catch (err: any) {
      showToast(`Failed to create invite: ${err.message}`, 'error');
    }
  };

  const handleRevokeInvite = async (invite: InviteRow) => {
    try {
      await updateDoc(doc(db, 'invites', invite.id), { revoked: true });
      await logAudit('Invite Revoked', invite.label, true);
      showToast(`"${invite.label}" revoked`);
    } catch (err: any) {
      showToast(`Failed to revoke invite: ${err.message}`, 'error');
    }
  };

  const handleCopyLink = async (code: string) => {
    const link = `${window.location.origin}${window.location.pathname}?invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      showToast('Could not copy — select and copy the link manually.', 'error');
    }
  };

  const handleCreateGroup = async () => {
    if (!currentUser || !groupForm.name.trim()) return;
    try {
      await addDoc(collection(db, 'groups'), {
        name: groupForm.name.trim(),
        mentorId: groupForm.mentorId || null,
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
      });
      await logAudit('Group Created', groupForm.name.trim(), false);
      showToast(`"${groupForm.name.trim()}" created`);
      setGroupForm({ name: '', mentorId: '' });
      setIsGroupModalOpen(false);
    } catch (err: any) {
      showToast(`Failed to create group: ${err.message}`, 'error');
    }
  };

  const handleDeleteGroup = async (group: GroupRow) => {
    const memberCount = (groupMembersOf.get(group.id) || []).length;
    if (memberCount > 0 && !window.confirm(`"${group.name}" has ${memberCount} member${memberCount === 1 ? '' : 's'} — delete the group anyway? They'll stay assigned to this group ID until reassigned individually.`)) {
      return;
    }
    try {
      await deleteDoc(doc(db, 'groups', group.id));
      await logAudit('Group Deleted', group.name, true);
      showToast(`"${group.name}" deleted`);
    } catch (err: any) {
      showToast(`Failed to delete group: ${err.message}`, 'error');
    }
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
          Anyone can sign in with Google and land here as a Student — for a specific role, mentor, or group instead, generate an invite link from the Invites tab.
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

  const InviteStatusBadge = ({ status }: { status: InviteStatus }) => (
    <Badge
      variant={status === 'active' ? 'positive' : status === 'exhausted' ? 'neutral' : 'negative'}
      className="text-[10px] capitalize"
    >
      {status}
    </Badge>
  );

  const renderInvitesTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground italic max-w-lg">
          A generated link grants exactly the role (and optional mentor/group) chosen below to whoever redeems it —
          enforced by firestore.rules, not just this screen. Redeeming an invite is the only way a new sign-in gets
          anything other than a default Student account.
        </p>
        <Button
          icon={UserPlus}
          onClick={() => {
            setInviteForm({ role: 'Student', mentorId: '', groupId: '', label: '', expiresInDays: 7, maxUses: 1 });
            setGeneratedLink(null);
            setIsInviteModalOpen(true);
          }}
        >
          Generate Invite
        </Button>
      </div>

      <Card noPadding>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Mentor</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Uses</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            {invites.length > 0 ? invites.map((invite) => (
              <TableRow key={invite.id}>
                <TableCell>
                  <p className="font-bold text-sm">{invite.label}</p>
                  <p className="text-[10px] text-muted-foreground">by {invite.createdByName}</p>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={invite.role === 'Admin' ? 'negative' : invite.role === 'Mentor' ? 'warning' : invite.role === 'Student' ? 'positive' : 'neutral'}
                    className="text-[10px]"
                  >
                    {invite.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{nameOf(invite.mentorId) || '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{groupNameOf(invite.groupId) || '—'}</TableCell>
                <TableCell className="text-xs font-mono tabular-nums text-muted-foreground">{invite.useCount} / {invite.maxUses}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{invite.expiresAt}</TableCell>
                <TableCell><InviteStatusBadge status={invite.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {invite.status === 'active' && (
                      <>
                        <Button variant="ghost" size="icon" title="Copy invite link" onClick={() => handleCopyLink(invite.id)}>
                          {copiedCode === invite.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                        </Button>
                        <Button variant="ghost" size="icon" title="Revoke" onClick={() => handleRevokeInvite(invite)}>
                          <Ban className="w-4 h-4 text-rose-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground italic">
                  No invites generated yet.
                </TableCell>
              </TableRow>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );

  const renderGroupsTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground italic max-w-lg">
          Groups are an organizational label for cohorts — they don't grant anyone access on their own. Mentor
          assignment (per user, or a group's default mentor at invite time) is what actually controls access.
        </p>
        <Button
          icon={Plus}
          onClick={() => { setGroupForm({ name: '', mentorId: '' }); setIsGroupModalOpen(true); }}
        >
          Create Group
        </Button>
      </div>

      {groups.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground italic text-sm">No groups yet.</Card>
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const members = groupMembersOf.get(group.id) || [];
            const isExpanded = expandedGroupId === group.id;
            return (
              <Card key={group.id} noPadding className="overflow-hidden">
                <button
                  className="w-full p-5 flex items-center justify-between hover:bg-accent/10 transition-colors text-left"
                  onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-sm">{group.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {members.length} member{members.length === 1 ? '' : 's'}
                        {group.mentorId && <> · default mentor {nameOf(group.mentorId)}</>}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon" title="Delete group"
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group); }}
                  >
                    <Trash2 className="w-4 h-4 text-rose-500" />
                  </Button>
                </button>
                {isExpanded && (
                  <div className="border-t border-border divide-y divide-border/50">
                    {members.length === 0 ? (
                      <p className="p-5 text-xs text-muted-foreground italic">No members yet — assign someone to this group from their user profile, or generate an invite for it.</p>
                    ) : members.map(m => (
                      <div key={m.id} className="p-4 px-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center text-[11px] font-bold">
                            {m.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-xs font-bold">{m.name}</p>
                            <p className="text-[10px] text-muted-foreground">{m.email}</p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleGroupAssign(m, '')}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
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
          { id: 'invites', label: 'Invites', icon: Mail },
          { id: 'groups', label: 'Groups', icon: Layers },
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
        {activeTab === 'invites' && renderInvitesTab()}
        {activeTab === 'groups' && renderGroupsTab()}
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

              {selectedUser.referredBy && (
                <section className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Joined Via</label>
                  <p className="text-sm font-medium text-foreground">
                    Referred by {nameOf(selectedUser.referredBy) || selectedUser.referredByName || 'a former user'}
                  </p>
                </section>
              )}

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

              <section className="space-y-3">
                <h3 className="text-sm font-bold flex items-center space-x-2 text-foreground">
                  <Layers className="w-4 h-4 text-primary" />
                  <span>Group</span>
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Organizational only — doesn't grant anyone access, just labels which cohort they're in.
                </p>
                <select
                  className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                  value={selectedUser.groupId || ''}
                  onChange={(e) => handleGroupAssign(selectedUser, e.target.value)}
                >
                  <option value="">Ungrouped</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </section>

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

      <Modal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        title={generatedLink ? 'Invite Ready' : 'Generate Invite'}
        maxWidth="lg"
        footer={
          generatedLink ? (
            <Button onClick={() => setIsInviteModalOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsInviteModalOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateInvite}>Generate Link</Button>
            </>
          )
        }
      >
        {generatedLink ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this link — whoever signs in with it gets the role (and mentor/group, if set) you just chose, automatically.
            </p>
            <div className="flex items-center gap-2 p-3 bg-accent/20 border border-border rounded-xl">
              <code className="flex-1 text-xs font-mono truncate">{generatedLink}</code>
              <Button
                variant="ghost" size="icon"
                onClick={async () => {
                  await navigator.clipboard.writeText(generatedLink);
                  setCopiedCode(generatedLink);
                  setTimeout(() => setCopiedCode(null), 2000);
                }}
              >
                {copiedCode === generatedLink ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Label (your own reference)</label>
              <Input
                placeholder="e.g. Fall Cohort A — Students"
                value={inviteForm.label}
                onChange={(e) => setInviteForm(f => ({ ...f, label: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Role Granted</label>
                <select
                  className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                  value={inviteForm.role}
                  onChange={(e) => {
                    const role = e.target.value as Role;
                    const scoped = role === 'Student' || role === 'Viewer';
                    setInviteForm(f => ({ ...f, role, mentorId: scoped ? f.mentorId : '', groupId: scoped ? f.groupId : '' }));
                  }}
                >
                  <option>Student</option>
                  <option>Viewer</option>
                  <option>Mentor</option>
                  <option>Admin</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Max Uses</label>
                <Input
                  type="number" min={1} max={200}
                  value={inviteForm.maxUses}
                  onChange={(e) => setInviteForm(f => ({ ...f, maxUses: Math.max(1, Math.min(200, Number(e.target.value) || 1)) }))}
                />
              </div>
            </div>

            {(inviteForm.role === 'Student' || inviteForm.role === 'Viewer') && (
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Mentor (optional)</label>
                  <select
                    className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                    value={inviteForm.mentorId}
                    onChange={(e) => setInviteForm(f => ({ ...f, mentorId: e.target.value }))}
                  >
                    <option value="">Unassigned</option>
                    {mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Group (optional)</label>
                  <select
                    className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                    value={inviteForm.groupId}
                    onChange={(e) => setInviteForm(f => ({ ...f, groupId: e.target.value }))}
                  >
                    <option value="">Ungrouped</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Expires In</label>
              <select
                className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                value={inviteForm.expiresInDays}
                onChange={(e) => setInviteForm(f => ({ ...f, expiresInDays: Number(e.target.value) }))}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isGroupModalOpen}
        onClose={() => setIsGroupModalOpen(false)}
        title="Create Group"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsGroupModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateGroup} disabled={!groupForm.name.trim()}>Create</Button>
          </>
        }
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Group Name</label>
            <Input
              placeholder="e.g. Fall 2026 Cohort A"
              value={groupForm.name}
              onChange={(e) => setGroupForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Default Mentor (optional)</label>
            <p className="text-[11px] text-muted-foreground">Pre-fills the Mentor field when generating invites for this group — doesn't apply retroactively to existing members.</p>
            <select
              className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
              value={groupForm.mentorId}
              onChange={(e) => setGroupForm(f => ({ ...f, mentorId: e.target.value }))}
            >
              <option value="">None</option>
              {mentors.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
