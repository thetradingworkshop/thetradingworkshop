import React, { useState } from 'react';
import { Card, Button, Badge } from './Shared';
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Info, ArrowRight } from 'lucide-react';
import { PreTradeChecklist } from '../types';
import { cn } from '@/src/utils';

interface Props {
  onConfirm: (checklist: PreTradeChecklist, isOverride: boolean) => void;
  onCancel: () => void;
  symbol?: string;
}

export default function PreTradeChecklistComponent({ onConfirm, onCancel, symbol }: Props) {
  const [checklist, setChecklist] = useState({
    displacement: false,
    reversal: false,
    imbalance: false,
    pullback: false
  });

  const allChecked = Object.values(checklist).every(v => v);
  const anyChecked = Object.values(checklist).some(v => v);

  const toggleItem = (key: keyof typeof checklist) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleConfirm = (isOverride: boolean = false) => {
    onConfirm({
      ...checklist,
      confirmedAt: new Date().toISOString()
    }, isOverride);
  };

  return (
    <Card className="max-w-md w-full overflow-hidden border-primary/20 shadow-2xl">
      <div className="p-6 border-b border-border/50 bg-primary/5 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-primary/10 rounded-xl">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-lg">Pre-Trade Gate</h3>
            <p className="text-xs text-muted-foreground">Verify setup for {symbol || 'Next Trade'}</p>
          </div>
        </div>
        {!allChecked && anyChecked && (
          <Badge variant="warning" className="animate-pulse">Invalid Setup</Badge>
        )}
        {allChecked && (
          <Badge variant="positive">Valid Setup</Badge>
        )}
      </div>

      <div className="p-6 space-y-4">
        <div className="space-y-3">
          <ChecklistItem 
            label="Displacement Present?" 
            description="Strong directional move (large candle)"
            checked={checklist.displacement}
            onToggle={() => toggleItem('displacement')}
          />
          <ChecklistItem 
            label="Reversal Confirmed?" 
            description="Opposite move engulfs structure"
            checked={checklist.reversal}
            onToggle={() => toggleItem('reversal')}
          />
          <ChecklistItem 
            label="Imbalance Present?" 
            description="Price moved inefficiently (Gap left)"
            checked={checklist.imbalance}
            onToggle={() => toggleItem('imbalance')}
          />
          <ChecklistItem 
            label="Entry After Pullback?" 
            description="Not chasing at the extremes"
            checked={checklist.pullback}
            onToggle={() => toggleItem('pullback')}
          />
        </div>

        {!allChecked && anyChecked && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start space-x-3 text-rose-500">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold">Model Criteria Not Met</p>
              <p className="text-xs opacity-80 leading-relaxed">
                This trade does not meet your defined model criteria. Taking this trade will be logged as a rule violation.
              </p>
            </div>
          </div>
        )}

        {allChecked && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start space-x-3 text-emerald-500">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold">Setup Validated</p>
              <p className="text-xs opacity-80 leading-relaxed">
                All criteria met. This trade follows your trading model.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-6 bg-accent/30 border-t border-border/50 flex flex-col space-y-3">
        {allChecked ? (
          <Button 
            className="w-full h-12 font-bold text-lg rounded-xl"
            onClick={() => handleConfirm(false)}
            icon={ArrowRight}
          >
            Confirm & Log Intent
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button 
              variant="outline" 
              className="h-12 font-bold rounded-xl"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button 
              variant="outline" 
              className="h-12 font-bold rounded-xl border-rose-500/30 text-rose-500 hover:bg-rose-500/10"
              onClick={() => handleConfirm(true)}
              disabled={!anyChecked}
            >
              Force Override
            </Button>
          </div>
        )}
        <p className="text-[10px] text-center text-muted-foreground">
          Overrides are tracked and will impact your session discipline score.
        </p>
      </div>
    </Card>
  );
}

function ChecklistItem({ label, description, checked, onToggle }: { label: string, description: string, checked: boolean, onToggle: () => void }) {
  return (
    <button 
      onClick={onToggle}
      className={cn(
        "w-full p-4 rounded-2xl border flex items-center justify-between transition-all text-left group",
        checked 
          ? "bg-emerald-500/5 border-emerald-500/30 ring-1 ring-emerald-500/20" 
          : "bg-background border-border hover:border-primary/30"
      )}
    >
      <div className="flex items-start space-x-3">
        <div className={cn(
          "w-5 h-5 rounded-md border-2 flex items-center justify-center mt-0.5 transition-colors",
          checked ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30 group-hover:border-primary/50"
        )}>
          {checked && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
        <div>
          <p className={cn("text-sm font-bold", checked ? "text-emerald-500" : "text-foreground")}>{label}</p>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
      {checked ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
      ) : (
        <XCircle className="w-4 h-4 text-muted-foreground/20" />
      )}
    </button>
  );
}
