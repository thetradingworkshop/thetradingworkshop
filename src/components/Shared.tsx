import React from 'react';
import { cn } from '@/src/utils';
import { X, CheckCircle2, AlertCircle, Info, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export function Card({ children, className, noPadding }: { children: React.ReactNode; className?: string; noPadding?: boolean }) {
  return (
    <div className={cn(
      "bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md",
      !noPadding && "p-6",
      className
    )}>
      {children}
    </div>
  );
}

export function Scorecard({ label, value, secondary, trend, className }: { 
  label: string; 
  value: string | number; 
  secondary?: string;
  trend?: { value: number; label: string; positive: boolean };
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col justify-between min-h-[140px] hover:border-border/80 transition-all", className)}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">{label}</p>
          {trend && (
            <div className={cn(
              "flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full",
              trend.positive ? "text-emerald-600 bg-emerald-500/10" : "text-rose-600 bg-rose-500/10"
            )}>
              {trend.positive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
              {trend.value}%
            </div>
          )}
        </div>
        <h3 className="text-3xl font-bold tracking-tight text-foreground">{value}</h3>
      </div>
      {(secondary || trend) && (
        <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
          {secondary && <p className="text-[12px] font-medium text-muted-foreground/80 leading-none">{secondary}</p>}
          {trend && <p className="text-[11px] text-muted-foreground/60 font-medium ml-auto">{trend.label}</p>}
        </div>
      )}
    </Card>
  );
}

export function SectionHeader({ title, subtitle, rightElement, icon: Icon }: { title: string; subtitle?: string; rightElement?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 shrink-0">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{subtitle}</p>}
        </div>
      </div>
      {rightElement && <div className="flex items-center gap-3">{rightElement}</div>}
    </div>
  );
}

export function Badge({ children, variant = 'neutral', className, onClick }: { 
  children: React.ReactNode; 
  variant?: 'positive' | 'negative' | 'neutral' | 'warning' | 'info'; 
  className?: string;
  onClick?: () => void;
}) {
  const variants = {
    positive: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    negative: "bg-rose-500/10 text-rose-600 border-rose-500/20",
    neutral: "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    info: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  };
  return (
    <span 
      onClick={onClick}
      className={cn(
        "text-[11px] font-bold px-2.5 py-0.5 rounded-full border uppercase tracking-wider", 
        variants[variant], 
        onClick && "cursor-pointer hover:brightness-95 active:scale-95 transition-all",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Button({ children, onClick, variant = 'primary', className, icon: Icon, disabled, size = 'md' }: { 
  children?: React.ReactNode; 
  onClick?: (e: React.MouseEvent) => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  className?: string;
  icon?: any;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'icon';
}) {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm active:scale-[0.98]",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]",
    outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
    ghost: "hover:bg-accent hover:text-accent-foreground active:scale-[0.98]",
    destructive: "bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.98]",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs rounded-lg",
    md: "h-10 px-4 py-2 text-sm rounded-xl",
    lg: "h-12 px-6 text-base rounded-xl",
    icon: "h-10 w-10 rounded-xl p-0",
  };
  
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {Icon && <Icon className={cn("h-4 w-4", children ? "mr-2" : "")} />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-background px-4 py-2 text-sm ring-offset-background transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-auto", className)}>
      <table className="w-full text-sm border-collapse">
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children }: { children: React.ReactNode }) {
  return (
    <thead className="bg-muted/30 border-b border-border/60">
      {children}
    </thead>
  );
}

export function TableRow({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <tr 
      onClick={onClick}
      className={cn(
        "border-b border-border/40 transition-colors hover:bg-muted/20", 
        onClick && "cursor-pointer",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function TableHead({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("p-4 text-left font-bold text-muted-foreground text-[11px] uppercase tracking-wider", className)}>
      {children}
    </th>
  );
}

export function TableCell({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td className={cn("p-4 align-middle", className)} colSpan={colSpan}>
      {children}
    </td>
  );
}

export function Modal({ isOpen, onClose, title, children, footer, maxWidth = 'md' }: { 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}) {
  if (!isOpen) return null;

  const maxWidths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };
  
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className={cn("bg-card border border-border/60 rounded-3xl shadow-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300", maxWidths[maxWidth])}>
        <div className="px-8 py-6 border-b border-border/40 flex items-center justify-between shrink-0">
          <h3 className="text-2xl font-bold tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-xl transition-all text-muted-foreground hover:text-foreground active:scale-90">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-8 py-8 overflow-y-auto flex-1 min-h-0">
          {children}
        </div>
        {footer && (
          <div className="px-8 py-6 border-t border-border/40 bg-muted/10 flex items-center justify-end gap-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Toast({ message, type = 'success', onClose }: { 
  message: string; 
  type?: 'success' | 'error' | 'info'; 
  onClose: () => void;
}) {
  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
    error: <AlertCircle className="w-5 h-5 text-rose-500" />,
    info: <Info className="w-5 h-5 text-indigo-500" />,
  };
  
  return (
    <div className="fixed bottom-8 right-8 z-[110] flex items-center space-x-3 bg-card border border-border rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-10 duration-300">
      {icons[type]}
      <p className="text-sm font-medium">{message}</p>
      <button onClick={onClose} className="p-1 hover:bg-accent rounded-lg transition-colors">
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
    </div>
  );
}
