'use client';
import dynamic from 'next/dynamic';

const AppShell = dynamic(() => import('@/components/shell/AppShell').then((m) => m.AppShell), { ssr: false, loading: () => <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div> });

export default function Page() {
  return <AppShell />;
}
