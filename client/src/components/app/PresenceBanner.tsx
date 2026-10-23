import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useCircle } from '../../contexts/CircleContext';
import { useWebSocketUpdates } from '../../hooks/useWebSocketUpdates';
import { STATE_STYLE, type PresenceState } from '../../lib/hearth';

// Bandeau discret de presence sur le tableau de bord : l'etat Hearth, deja
// filtre par le niveau de partage du proche (GET /api/presence/status).
// Rendu uniquement lorsque le cercle a une regle de veille activee.

interface PresenceStatus {
    state: PresenceState;
    headline: string;
    rule: { enabled: boolean } | null;
}

const PresenceBanner: React.FC = () => {
    const { activeCircle, myRole } = useCircle();
    const [status, setStatus] = useState<PresenceStatus | null>(null);
    const allowed = myRole === 'admin' || myRole === 'family' || myRole === 'viewer';

    const load = useCallback(async () => {
        try {
            const res = await api.get<{ success: boolean; data: PresenceStatus }>('/api/presence/status');
            setStatus(res.success ? res.data : null);
        } catch {
            setStatus(null);
        }
    }, []);

    useEffect(() => {
        if (!activeCircle?.id || !allowed) return;
        void load();
    }, [activeCircle?.id, allowed, load]);

    useWebSocketUpdates('presence', () => {
        if (allowed) void load();
    });

    if (!allowed || !status?.rule?.enabled) return null;
    const style = STATE_STYLE[status.state] ?? STATE_STYLE.insufficient_data;
    const Icon = style.icon;

    return (
        <Link to="/" className={cn('flex items-center gap-2 rounded-input border px-4 py-2.5 text-caption', style.tone)}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-foreground">{status.headline}</span>
        </Link>
    );
};

export default PresenceBanner;
