import React, { useState, useMemo } from 'react';
import { cn } from '@/src/utils';
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
  Group, 
  Lock, 
  History, 
  Search, 
  MoreHorizontal, 
  User, 
  X, 
  Check, 
  AlertTriangle, 
  Trash2, 
  UserPlus, 
  Filter, 
  ChevronRight,
  Settings,
  Eye,
  Edit3,
  UserCheck,
  UserX,
  ShieldCheck,
  LayoutGrid
} from 'lucide-react';

// --- Types ---

type Role = 'Admin' | 'Mentor' | 'Student' | 'Viewer';
type Status = 'Active' | 'Inactive';

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
  mentor: string;
  group: string;
  status: Status;
  permissions: string[]; // List of permission IDs
  lastActive: string;
}

interface AuditLogEntry {
  id: string;
  user: string;
  action: string;
  target: string;
  date: string;
  critical: boolean;
}

// --- Constants ---

const PERMISSIONS: Permission[] = [
  { id: 'imp_csv', name: 'Import CSV', description: 'Allow uploading and processing Tradovate CSV files', category: 'Import' },
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

// --- Mock Data ---

const INITIAL_USERS: UserData[] = [
  { 
    id: '1', 
    name: 'Alex Rivera', 
    email: 'alex@example.com', 
    role: 'Student', 
    mentor: 'Coach Mike', 
    group: 'Morning NQ', 
    status: 'Active',
    permissions: [...ROLE_TEMPLATES.Student],
    lastActive: '2026-03-22 08:30'
  },
  { 
    id: '2', 
    name: 'Coach Mike', 
    email: 'mike@example.com', 
    role: 'Mentor', 
    mentor: '-', 
    group: 'All Groups', 
    status: 'Active',
    permissions: [...ROLE_TEMPLATES.Mentor],
    lastActive: '2026-03-22 09:15'
  },
  { 
    id: '3', 
    name: 'Sarah Chen', 
    email: 'sarah@example.com', 
    role: 'Student', 
    mentor: 'Coach Mike', 
    group: 'Morning NQ', 
    status: 'Active',
    permissions: [...ROLE_TEMPLATES.Student],
    lastActive: '2026-03-21 18:45'
  },
  { 
    id: '4', 
    name: 'Admin Joe', 
    email: 'joe@admin.com', 
    role: 'Admin', 
    mentor: '-', 
    group: 'System', 
    status: 'Active',
    permissions: [...ROLE_TEMPLATES.Admin],
    lastActive: '2026-03-22 10:00'
  },
  { 
    id: '5', 
    name: 'Tom Wilson', 
    email: 'tom@example.com', 
    role: 'Viewer', 
    mentor: '-', 
    group: 'Guest', 
    status: 'Inactive',
    permissions: [...ROLE_TEMPLATES.Viewer],
    lastActive: '2026-02-15 12:00'
  },
];

const INITIAL_LOGS: AuditLogEntry[] = [
  { id: 'L1', user: 'Admin Joe', action: 'Role Changed', target: 'Alex Rivera (Student -> Mentor)', date: '2026-03-22 10:05', critical: true },
  { id: 'L2', user: 'Coach Mike', action: 'Data Exported', target: 'Morning NQ Weekly Report', date: '2026-03-22 09:30', critical: false },
  { id: 'L3', user: 'Admin Joe', action: 'User Deactivated', target: 'Tom Wilson', date: '2026-03-22 08:00', critical: true },
  { id: 'L4', user: 'Sarah Chen', action: 'CSV Imported', target: 'Tradovate_NQ_Mar.csv', date: '2026-03-21 19:00', critical: false },
];

// --- Main Component ---

export default function UsersPermissionsScreen() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState<UserData[]>(INITIAL_USERS);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState<{ type: string; user: UserData | null }>({ type: '', user: null });

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [users, searchQuery]);

  // --- Actions ---

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpdateUser = (updatedUser: UserData) => {
    setUsers(users.map(u => u.id === updatedUser.id ? updatedUser : u));
    setSelectedUser(updatedUser);
    showToast(`User ${updatedUser.name} updated successfully`);
  };

  const handleStatusToggle = (user: UserData) => {
    const newStatus = user.status === 'Active' ? 'Inactive' : 'Active';
    const updatedUser = { ...user, status: newStatus as Status };
    setUsers(users.map(u => u.id === user.id ? updatedUser : u));
    showToast(`User ${user.name} is now ${newStatus}`);
  };

  const handleDeleteUser = (user: UserData) => {
    setUsers(users.filter(u => u.id !== user.id));
    setIsModalOpen(false);
    showToast(`User ${user.name} deleted`, 'error');
  };

  const confirmAction = (type: string, user: UserData) => {
    setModalAction({ type, user });
    setIsModalOpen(true);
  };

  // --- Sub-components ---

  const UserRow = ({ user }: { user: UserData }) => {
    const [showActions, setShowActions] = useState(false);

    return (
      <TableRow 
        className="group cursor-pointer" 
        onClick={() => setSelectedUser(user)}
      >
        <TableCell>
          <div className="flex items-center space-x-3">
            <div className={cn(
              "w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm transition-all group-hover:scale-105",
              user.status === 'Active' ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}>
              {user.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <div className="font-bold flex items-center space-x-2">
                <span className="text-sm">{user.name}</span>
                {user.status === 'Inactive' && <Badge variant="neutral" className="text-[9px] px-1.5 py-0">Inactive</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground">{user.email}</div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge 
            variant={
              user.role === 'Admin' ? 'negative' : 
              user.role === 'Mentor' ? 'warning' : 
              user.role === 'Student' ? 'positive' : 'neutral'
            }
            className="text-[10px]"
          >
            {user.role}
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground text-xs font-medium">{user.mentor}</TableCell>
        <TableCell className="text-muted-foreground text-xs font-medium">{user.group}</TableCell>
        <TableCell>
          <div className="flex items-center space-x-2">
            <div className={cn("w-1.5 h-1.5 rounded-full", user.status === 'Active' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-zinc-500")} />
            <span className="text-xs font-medium">{user.status}</span>
          </div>
        </TableCell>
        <TableCell className="text-right relative">
          <Button 
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
          </Button>
          
          {showActions && (
            <div className="absolute right-4 top-12 z-10 w-48 bg-card border border-border rounded-2xl shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-100">
              <button 
                onClick={(e) => { e.stopPropagation(); setSelectedUser(user); setShowActions(false); }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-accent flex items-center space-x-2 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> <span>Edit Profile</span>
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); handleStatusToggle(user); setShowActions(false); }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-accent flex items-center space-x-2 transition-colors"
              >
                {user.status === 'Active' ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                <span>{user.status === 'Active' ? 'Deactivate' : 'Activate'}</span>
              </button>
              <div className="h-px bg-border my-1" />
              <button 
                onClick={(e) => { e.stopPropagation(); confirmAction('delete', user); setShowActions(false); }}
                className="w-full px-4 py-2 text-left text-xs hover:bg-rose-500/10 text-rose-500 flex items-center space-x-2 transition-colors"
              >
                <Trash2 className="w-3 h-3" /> <span>Delete User</span>
              </button>
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  };

  const PermissionToggle = ({ permission, isChecked, onChange }: { permission: Permission; isChecked: boolean; onChange: (checked: boolean) => void }) => (
    <div className="flex items-start justify-between p-4 bg-accent/20 rounded-2xl border border-transparent hover:border-border/50 transition-all">
      <div className="space-y-1">
        <p className="text-sm font-bold">{permission.name}</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed max-w-[240px]">{permission.description}</p>
      </div>
      <button 
        onClick={() => onChange(!isChecked)}
        className={cn(
          "w-10 h-5 rounded-full relative transition-colors duration-200",
          isChecked ? "bg-primary" : "bg-muted"
        )}
      >
        <div className={cn(
          "absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-200",
          isChecked ? "left-6" : "left-1"
        )} />
      </button>
    </div>
  );

  // --- Render Tabs ---

  const renderUsersTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or email..." 
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="outline" size="sm" icon={Filter} onClick={() => showToast('Filter Users (Simulated)')}>Filter</Button>
          <Button variant="primary" size="sm" icon={UserPlus} onClick={() => showToast('Add User (Simulated)')}>Add User</Button>
        </div>
      </div>

      <Card noPadding>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User Profile</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Mentor</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <tbody>
            {filteredUsers.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );

  const renderRolesTab = () => (
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
            <Button variant="ghost" className="p-2 h-auto"><Settings className="w-4 h-4" /></Button>
          </div>
          <h3 className="text-lg font-bold mb-1">{role}</h3>
          <p className="text-xs text-muted-foreground mb-6">Default template for {role.toLowerCase()} accounts.</p>
          
          <div className="flex-1 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Default Permissions</p>
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
          
          <Button variant="outline" className="w-full mt-8" onClick={() => showToast(`Edit ${role} Template (Simulated)`)}>Edit Template</Button>
        </Card>
      ))}
    </div>
  );

  const renderAccessRulesTab = () => (
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
  );

  const renderAuditLogTab = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search logs..." className="pl-10" />
          </div>
          <Button variant="outline" size="sm" icon={Filter} onClick={() => showToast('Filter Audit Logs (Simulated)')}>All Actions</Button>
        </div>
        <Button variant="ghost" size="sm" icon={History} onClick={() => showToast('Export Audit Log (Simulated)')}>Export Log</Button>
      </div>

      <Card noPadding>
        <div className="divide-y divide-border/50">
          {INITIAL_LOGS.map(log => (
            <div key={log.id} className="p-5 flex items-center justify-between hover:bg-accent/10 transition-colors group">
              <div className="flex items-center space-x-4">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110",
                  log.critical ? "bg-rose-500/10 text-rose-500" : "bg-indigo-500/10 text-indigo-500"
                )}>
                  {log.critical ? <AlertTriangle className="w-5 h-5" /> : <History className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-sm font-bold">
                    <span className="text-primary">{log.user}</span>
                    <span className="text-muted-foreground font-normal mx-2">performed</span>
                    <span className="text-foreground">{log.action}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Target: <span className="font-medium text-foreground">{log.target}</span></p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-mono text-muted-foreground tracking-tighter">{log.date}</p>
                {log.critical && <Badge variant="negative" className="text-[9px] mt-1.5 px-2">Critical Action</Badge>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  // --- Render ---

  return (
    <div className="space-y-8 pb-20">
      <SectionHeader 
        title="Users & Permissions" 
        subtitle="Enterprise-grade control over system access and role definitions"
        rightElement={<Button variant="primary" size="sm" icon={UserPlus} onClick={() => showToast('New User Creation (Simulated)')}>New User</Button>}
      />

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-1 border-b border-border overflow-x-auto no-scrollbar">
        {[
          { id: 'users', label: 'Users', icon: Users },
          { id: 'roles', label: 'Role Templates', icon: Shield },
          { id: 'groups', label: 'Groups', icon: Group },
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
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {activeTab === 'users' && renderUsersTab()}
        {activeTab === 'roles' && renderRolesTab()}
        {activeTab === 'groups' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {['Morning NQ', 'Afternoon ES', 'System', 'Guest'].map(group => (
              <Card key={group} className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Group className="w-5 h-5" />
                  </div>
                  <Badge variant="neutral">{users.filter(u => u.group === group).length} Members</Badge>
                </div>
                <h3 className="font-bold">{group}</h3>
                <p className="text-xs text-muted-foreground mt-1">Standard user group for {group.toLowerCase()} participants.</p>
                <Button variant="outline" className="w-full mt-6" onClick={() => showToast(`Manage ${group} Group (Simulated)`)}>Manage Group</Button>
              </Card>
            ))}
          </div>
        )}
        {activeTab === 'access rules' && renderAccessRulesTab()}
        {activeTab === 'audit log' && renderAuditLogTab()}
      </div>

      {/* User Side Drawer */}
      {selectedUser && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div 
            className="absolute inset-0 bg-background/40 backdrop-blur-[2px] animate-in fade-in duration-300"
            onClick={() => setSelectedUser(null)}
          />
          <div className="relative w-full max-w-xl h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-500 ease-out">
            <div className="p-8 border-b border-border flex items-center justify-between bg-accent/5">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-lg font-bold shadow-sm">
                  {selectedUser.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{selectedUser.name}</h2>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-medium">User Management & Permissions</p>
                </div>
              </div>
              <Button 
                variant="ghost"
                size="icon"
                onClick={() => setSelectedUser(null)} 
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10 no-scrollbar">
              {/* Profile Summary */}
              <section className="grid grid-cols-2 gap-8">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Email Address</label>
                  <p className="text-sm font-medium text-foreground">{selectedUser.email}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last Activity</label>
                  <p className="text-sm font-medium text-foreground">{selectedUser.lastActive}</p>
                </div>
              </section>

              {/* Role & Assignments */}
              <section className="space-y-6">
                <h3 className="text-sm font-bold flex items-center space-x-2 text-foreground">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span>Role & Assignments</span>
                </h3>
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">System Role</label>
                    <select 
                      className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all cursor-pointer hover:bg-accent/30"
                      value={selectedUser.role}
                      onChange={(e) => {
                        const newRole = e.target.value as Role;
                        handleUpdateUser({ 
                          ...selectedUser, 
                          role: newRole,
                          permissions: [...ROLE_TEMPLATES[newRole]]
                        });
                      }}
                    >
                      <option>Admin</option>
                      <option>Mentor</option>
                      <option>Student</option>
                      <option>Viewer</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Assigned Mentor</label>
                    <select 
                      className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm outline-none cursor-pointer hover:bg-accent/30"
                      onChange={(e) => showToast(`Assign Mentor: ${e.target.value}`)}
                    >
                      <option>Coach Mike</option>
                      <option>Coach Sarah</option>
                      <option>-</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">User Group</label>
                    <select 
                      className="w-full bg-accent/20 border border-border rounded-xl px-4 py-2.5 text-sm outline-none cursor-pointer hover:bg-accent/30"
                      onChange={(e) => showToast(`Assign Group: ${e.target.value}`)}
                    >
                      <option>Morning NQ</option>
                      <option>Afternoon ES</option>
                      <option>All Groups</option>
                      <option>Guest</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Account Status</label>
                    <div className="flex items-center space-x-3 h-[42px]">
                      <Button 
                        variant={selectedUser.status === 'Active' ? 'outline' : 'primary'} 
                        className="flex-1 h-full font-bold text-xs"
                        onClick={() => handleStatusToggle(selectedUser)}
                      >
                        {selectedUser.status === 'Active' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Permissions Grid */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold flex items-center space-x-2 text-foreground">
                    <Lock className="w-4 h-4 text-primary" />
                    <span>Granular Permissions</span>
                  </h3>
                  <Button 
                    variant="ghost" 
                    className="text-[10px] h-auto py-1 px-2 hover:bg-primary/5 text-primary"
                    onClick={() => handleUpdateUser({ ...selectedUser, permissions: [...ROLE_TEMPLATES[selectedUser.role]] })}
                  >
                    Reset to Role Default
                  </Button>
                </div>

                <div className="space-y-10">
                  {['Import', 'Data Access', 'Comments', 'Admin'].map(category => (
                    <div key={category} className="space-y-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-2">{category}</p>
                      <div className="grid grid-cols-1 gap-3">
                        {PERMISSIONS.filter(p => p.category === category).map(permission => (
                          <PermissionToggle 
                            key={permission.id}
                            permission={permission}
                            isChecked={selectedUser.permissions.includes(permission.id)}
                            onChange={(checked) => {
                              const newPerms = checked 
                                ? [...selectedUser.permissions, permission.id]
                                : selectedUser.permissions.filter(id => id !== permission.id);
                              handleUpdateUser({ ...selectedUser, permissions: newPerms });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="p-8 border-t border-border bg-accent/5 flex items-center justify-between">
              <Button variant="outline" size="md" onClick={() => setSelectedUser(null)}>Close Panel</Button>
              <div className="flex items-center space-x-3">
                <Button variant="ghost" size="md" className="text-rose-500 hover:bg-rose-500/5" icon={Trash2} onClick={() => confirmAction('delete', selectedUser)}>Delete User</Button>
                <Button variant="primary" size="md" onClick={() => { showToast('All changes saved'); setSelectedUser(null); }}>Save & Exit</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title={modalAction.type === 'delete' ? 'Delete User' : 'Confirm Action'}
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button 
              variant="primary" 
              className="bg-rose-500 hover:bg-rose-600"
              onClick={() => modalAction.user && handleDeleteUser(modalAction.user)}
            >
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
              This will permanently delete <span className="font-bold text-foreground">{modalAction.user?.name}</span>. 
              This action cannot be undone and all associated data will be archived.
            </p>
          </div>
        </div>
      </Modal>

      {/* Toast Notification */}
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type === 'success' ? 'success' : 'error'} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}
