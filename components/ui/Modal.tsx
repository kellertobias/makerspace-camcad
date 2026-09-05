'use client';
import { useEffect, type ReactNode } from 'react';

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="cam-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`cam-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="cam-modal-head"><h2>{title}</h2><button type="button" className="clear" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="cam-modal-body">{children}</div>
        {footer && <footer className="cam-modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
