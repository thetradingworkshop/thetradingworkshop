import React from 'react';
import { Card, Badge } from './Shared';
import { Target, AlertCircle, Zap, ShieldCheck } from 'lucide-react';
import { RuleBasedInsight } from '../services/RuleBasedMentorService';

interface RuleBasedMentorProps {
  insight: RuleBasedInsight;
  className?: string;
}

export const RuleBasedMentor: React.FC<RuleBasedMentorProps> = ({ insight, className = "" }) => {
  return (
    <Card className={`p-5 border-slate-800 bg-slate-950 text-slate-200 ${className}`}>
      <div className="flex items-center space-x-2 mb-5 border-b border-slate-800 pb-3">
        <Target className="w-4 h-4 text-indigo-500" />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Hard-Rule Analysis</h3>
      </div>

      <div className="space-y-5">
        {/* Strengths */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500/70">Strengths</span>
            </div>
            <div className="space-y-1">
              {insight.strengths.map((strength, index) => (
                <p key={index} className="text-xs font-medium text-slate-300 leading-tight">
                  {strength}
                </p>
              ))}
            </div>
          </div>

          {/* Weaknesses */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-3 h-3 text-rose-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-rose-500/70">Weaknesses</span>
            </div>
            <div className="space-y-1">
              {insight.weaknesses.map((weakness, index) => (
                <p key={index} className="text-xs font-medium text-slate-300 leading-tight">
                  {weakness}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Next Action */}
        <div className="pt-4 border-t border-slate-800">
          <div className="flex items-center space-x-2 mb-2">
            <Zap className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-500/70">Next Action</span>
          </div>
          <p className="text-sm font-bold text-white leading-snug">
            {insight.nextAction}
          </p>
        </div>
      </div>
    </Card>
  );
};
