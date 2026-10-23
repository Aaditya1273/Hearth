import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DoorOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui';
import { intlLocale } from '../../i18n/format';
import { formatWhen } from '../../lib/hearth';

interface RingStatus { devices: string[]; account_linked: boolean; playground: boolean; synced_at: string | null; webhooks_enabled: boolean }
interface SyncResult { imported: number; seen: number; devices: Array<{ name: string }> }

/** Admin: import the front-door rhythm from Ring. The token is sent once and never stored. */
const RingConnect: React.FC<{ who: string }> = ({ who }) => {
    const { t } = useTranslation('hearth');
    const [status, setStatus] = useState<RingStatus | null>(null);
    const [token, setToken] = useState('');
    const [playground, setPlayground] = useState(true);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        api.get<{ success: boolean; data: RingStatus | null }>('/api/ring/status').then((r) => setStatus(r.data ?? null)).catch(() => setStatus(null));
    }, []);
    useEffect(load, [load]);

    const sync = async () => {
        setBusy(true); setError(null); setResult(null);
        try {
            const r = await api.post<{ success: boolean; data: SyncResult }>('/api/ring/sync', { access_token: token.trim(), playground });
            setResult(r.data ?? null);
            setToken('');
            load();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rounded-card border border-border bg-card p-5 shadow-surface" aria-labelledby="ring-title">
            <h2 id="ring-title" className="mb-1 flex items-center gap-2 text-h2 text-foreground"><DoorOpen className="h-5 w-5 text-primary" aria-hidden="true" />{t('ring.title')}</h2>
            <p className="mb-3 text-caption text-muted-foreground">{t('ring.intro', { name: who })}</p>
            {status && (
                <p className="mb-3 text-caption text-foreground">
                    {t('ring.connected', { devices: status.devices.join(', ') || '—' })}
                    {status.synced_at && ` · ${t('ring.syncedAt', { date: formatWhen(status.synced_at, intlLocale()) })}`}
                    {status.playground && ` · ${t('ring.playgroundBadge')}`}
                    {` · ${status.webhooks_enabled && status.account_linked ? t('ring.webhooksOn') : t('ring.webhooksOff')}`}
                </p>
            )}
            <label className="block text-caption font-medium text-foreground" htmlFor="ring-token">{t('ring.tokenLabel')}</label>
            <input
                id="ring-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
                className="mt-1 w-full rounded-input border border-border bg-surface px-3 py-2 text-caption"
                placeholder={t('ring.tokenPlaceholder')}
            />
            <label className="mt-3 flex items-center gap-2 text-caption text-foreground">
                <input type="checkbox" checked={playground} onChange={(e) => setPlayground(e.target.checked)} />
                {t('ring.playground')}
            </label>
            <Button size="sm" className="mt-3" disabled={busy || token.trim().length < 20} onClick={() => void sync()}>{busy ? t('ring.syncing') : t('ring.sync')}</Button>
            {result && <p className="mt-3 text-caption text-foreground" role="status">{t('ring.result', { imported: result.imported, seen: result.seen, devices: result.devices.length })}</p>}
            {error && <p className="mt-3 text-caption text-danger" role="alert">{error}</p>}
            <p className="mt-3 text-micro text-muted-foreground">{t('ring.privacy')}</p>
        </section>
    );
};

export default RingConnect;
