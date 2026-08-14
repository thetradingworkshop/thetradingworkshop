import React from 'react';
import { 
  LayoutDashboard, 
  Upload, 
  Calendar, 
  BarChart3, 
  BookOpen, 
  Target, 
  Users, 
  FileText, 
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  Zap,
  ClipboardCheck,
  Rocket,
  CalendarDays,
  PieChart
} from 'lucide-react';
import { cn } from '@/src/utils';
import { Role } from '@/src/types';
import { useAuth } from '../context/AuthContext';
import { useTheme } from './ThemeProvider';
import { Sun, Moon, Bell, User } from 'lucide-react';
import { Toast, Button } from './Shared';
import { LogIntentModal } from './LogIntentModal';
import { SupportChatWidget } from './SupportChatWidget';
import { useUnreadSupportCount } from '../hooks/useSupportChat';

// Exported so App.tsx can enforce the same role list at the route level —
// this list used to only ever filter the sidebar, which hid pages from the
// nav but didn't stop activePage from rendering one directly if reached any
// other way (e.g. a button elsewhere calling setActivePage on a page a
// Viewer isn't supposed to see).
export const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['Admin', 'Mentor', 'Student', 'Viewer'] },
  { id: 'connections', label: 'Broker Connections', icon: Zap, roles: ['Admin', 'Student'] },
  { id: 'import', label: 'Import Orders', icon: Upload, roles: ['Admin', 'Student'] },
  { id: 'sessions', label: 'Sessions', icon: Calendar, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'dayview', label: 'Day View', icon: CalendarDays, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'trades', label: 'Trades', icon: BarChart3, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'journal', label: 'Journal', icon: BookOpen, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'range', label: 'Range Analysis', icon: Target, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'strategies', label: 'Strategies', icon: Rocket, roles: ['Admin', 'Mentor', 'Student'] },
  // Distinct id from 'reports' below on purpose — that one is
  // WeeklyReportsScreen (generated weekly PDF-style reports), an unrelated
  // existing feature. This is the TradeZella-style analytics drill-downs
  // (Symbol / Day & Time / Tags).
  { id: 'trade-reports', label: 'Reports', icon: PieChart, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'mentor', label: 'Mentor', icon: Users, roles: ['Admin', 'Mentor'] },
  { id: 'reports', label: 'Weekly Reports', icon: FileText, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'settings', label: 'Settings', icon: Settings, roles: ['Admin', 'Mentor', 'Student'] },
  { id: 'admin', label: 'Users & Permissions', icon: Users, roles: ['Admin'] },
];

import { GlobalDateRangePicker } from './DateRangePicker';
import { FiltersDropdown } from './FiltersDropdown';
import { AccountFilterDropdown } from './AccountFilterDropdown';
import { useTrades } from '../context/TradeContext';

// Filters + Accounts only make sense where trades are actually shown.
const TRADE_SCOPED_PAGES = ['dashboard', 'trades', 'sessions', 'dayview', 'trade-reports', 'range', 'strategies', 'reports'];

export function AppShell({ 
  children, 
  activePage, 
  setActivePage,
  userRole = 'Admin' 
}: { 
  children: React.ReactNode; 
  activePage: string; 
  setActivePage: (id: string) => void;
  userRole?: Role;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);
  const { theme, toggleTheme } = useTheme();
  const [toast, setToast] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isLogIntentOpen, setIsLogIntentOpen] = React.useState(false);
  const { filters, setFilters, filterOptions, accountOptions, accountFilter, setAccountFilter } = useTrades();
  const { user, logout } = useAuth();
  const showTradeControls = TRADE_SCOPED_PAGES.includes(activePage);
  const unreadSupportCount = useUnreadSupportCount(userRole === 'Admin');

  // This used to be a hardcoded "Jean Paul" regardless of who was actually
  // signed in — real name/initials from the authenticated Firebase user.
  const displayName = user?.displayName || user?.email || 'User';
  const initials = displayName.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';

  const filteredNav = navItems.filter(item => item.roles.includes(userRole));

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 bg-card border-r border-border transition-all duration-300 flex flex-col",
        isSidebarOpen ? "w-[272px]" : "w-20"
      )}>
        <div className="h-[72px] flex items-center px-6 border-b border-border">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center mr-3">
            <BarChart3 className="text-primary-foreground w-5 h-5" />
          </div>
          {isSidebarOpen && <span className="font-bold text-lg tracking-tight">TRADING OS</span>}
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          {filteredNav.map((item) => (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={cn(
                "w-full flex items-center px-3 py-2.5 rounded-xl transition-colors group",
                activePage === item.id 
                  ? "bg-primary text-primary-foreground" 
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className={cn("w-5 h-5", isSidebarOpen ? "mr-3" : "mx-auto")} />
              {isSidebarOpen && <span className="font-medium text-sm">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className={cn(
            "flex items-center p-2 rounded-2xl bg-accent/50",
            !isSidebarOpen && "justify-center"
          )}>
            <div className="w-10 h-10 shrink-0 rounded-xl bg-zinc-800 flex items-center justify-center text-white font-bold">
              {initials}
            </div>
            {isSidebarOpen && (
              <>
                <div className="ml-3 overflow-hidden flex-1">
                  <p className="text-sm font-bold truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{userRole}</p>
                </div>
                <button
                  onClick={logout}
                  title="Sign out"
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-rose-500 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
        
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute -right-3 top-20 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center shadow-sm z-50 hover:bg-accent"
        >
          {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main Content */}
      <main className={cn(
        "flex-1 transition-all duration-300",
        isSidebarOpen ? "ml-[272px]" : "ml-20"
      )}>
        {/* Header */}
        <header className="h-[72px] border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-40 px-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold capitalize">{activePage.replace('-', ' ')}</h1>
          </div>

          <div className="flex items-center space-x-4">
            {showTradeControls && (
              <>
                <FiltersDropdown filters={filters} setFilters={setFilters} filterOptions={filterOptions} />
                <AccountFilterDropdown accountOptions={accountOptions} accountFilter={accountFilter} setAccountFilter={setAccountFilter} />
              </>
            )}
            <GlobalDateRangePicker />

            {/* Global, not tied to any one screen — a trader needs to log a
                setup within 5 minutes of entry (see the matching window in
                SessionBuilder.ts) regardless of what page they're on when
                they're about to place the trade. */}
            <Button variant="primary" size="sm" icon={ClipboardCheck} onClick={() => setIsLogIntentOpen(true)}>
              Log Setup
            </Button>

            <button
              onClick={toggleTheme}
              className="w-10 h-10 rounded-xl border border-border flex items-center justify-center hover:bg-accent transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
 
            {/* Real for Admin only so far: live unread count from
                support_threads (see Users & Permissions → Support).
                Everyone else still gets the disabled placeholder — no
                notification surface exists for them yet. */}
            {userRole === 'Admin' ? (
              <button
                onClick={() => setActivePage('admin')}
                title={unreadSupportCount > 0 ? `${unreadSupportCount} unread support message${unreadSupportCount === 1 ? '' : 's'}` : 'No unread support messages'}
                className="relative w-10 h-10 rounded-xl border border-border flex items-center justify-center hover:bg-accent transition-colors"
              >
                <Bell className="w-5 h-5" />
                {unreadSupportCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadSupportCount > 9 ? '9+' : unreadSupportCount}
                  </span>
                )}
              </button>
            ) : (
              <button
                disabled
                title="Notifications aren't built yet"
                className="w-10 h-10 rounded-xl border border-border flex items-center justify-center text-muted-foreground/40 cursor-not-allowed"
              >
                <Bell className="w-5 h-5" />
              </button>
            )}

            <button
              onClick={() => setActivePage('settings')}
              title="Account settings"
              className="w-10 h-10 rounded-xl border border-border flex items-center justify-center hover:bg-accent transition-colors"
            >
              <User className="w-5 h-5" />
            </button>
          </div>
        </header>
 
        <div className="max-w-[1600px] mx-auto p-6 space-y-6">
          {children}
        </div>

        {/* Toast Notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </main>

      <LogIntentModal
        isOpen={isLogIntentOpen}
        onClose={() => setIsLogIntentOpen(false)}
        onSuccess={() => {
          setIsLogIntentOpen(false);
          setToast({ message: 'Setup logged — it will auto-match to your next trade on that symbol.', type: 'success' });
        }}
      />

      {/* Admin gets the inbox (Users & Permissions → Support) instead of a
          widget that would just be them messaging themselves. */}
      {userRole !== 'Admin' && <SupportChatWidget />}
    </div>
  );
}
