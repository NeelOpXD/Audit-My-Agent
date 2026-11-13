import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  MinusCircle,
  XCircle,
} from 'lucide-react';

export function StatusIndicator({ status }: { status: string }) {
  const s = status.toLowerCase();

  if (s === 'passed' || s === 'completed' || s === 'connected' || s === 'enabled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }

  if (s === 'failed' || s === 'observed_failure' || s === 'aborted_limit' || s === 'critical') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap shrink-0">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }

  if (s === 'inconclusive' || s === 'suspected_failure' || s === 'evaluator_uncertainty' || s === 'high') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }

  if (s === 'running' || s === 'queued') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-400 whitespace-nowrap shrink-0">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status}</span>
      </span>
    );
  }

  if (s === 'not_supported' || s === 'unavailable') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
      <MinusCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="capitalize">{status.replace(/_/g, ' ')}</span>
    </span>
  );
}
