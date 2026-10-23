import { Router, Request, Response } from 'express';
import { query } from '../db';
import { authMiddleware } from '../middleware/auth';
import { circleMiddleware, requireAdmin, CircleRequest } from '../middleware/circle';
import { broadcastToCircle } from '../lib/broadcaster';
import logger from '../lib/logger';
import { RingApiError, ingestRingWebhook, syncFromRing, verifyRingSignature } from '../lib/hearth/ring';
import { memberActor, pool, recordLedger } from '../lib/hearth/store';

// Ring Partner API as a presence source. Mounted on /api/ring.
const router = Router();

// PUBLIC: Ring's signed webhook. Must answer within 5 s. Ring does not retry
// 4xx and disables an endpoint after repeated 4xx, so an event Hearth chooses
// to ignore (unknown account, vehicle, doorbell press) is still a 200.
router.post('/webhook', async (req: Request & { rawBody?: Buffer }, res: Response) => {
    const key = process.env.RING_HMAC_SIGNING_KEY || '';
    if (!key) return res.status(404).json({ success: false, error: 'Not found' });
    if (!verifyRingSignature(req.rawBody, req.get('X-Signature'), key)) {
        return res.status(401).json({ success: false, error: 'Invalid signature' });
    }
    try {
        const result = await ingestRingWebhook(req.body);
        if (result?.stored) await broadcastToCircle(result.circleId, { type: 'update', entity: 'presence', action: 'created' });
        res.json({ success: true, stored: Boolean(result?.stored) });
    } catch (error) {
        logger.error('ring.webhook_error', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ success: false, error: 'Internal server error' }); // 5xx: Ring retries
    }
});

router.use(authMiddleware);
router.use(circleMiddleware);

// GET /api/ring/status (admin): what is connected, never a token.
router.get('/status', requireAdmin, async (req: CircleRequest, res: Response) => {
    const { rows } = await query(`SELECT settings->'ring' AS ring FROM care_circles WHERE id = $1`, [req.circleId]);
    const ring = rows[0]?.ring ?? null;
    res.json({
        success: true,
        data: ring && {
            devices: Object.values(ring.devices ?? {}),
            account_linked: Boolean(ring.account_id),
            playground: Boolean(ring.playground),
            synced_at: ring.synced_at ?? null,
            webhooks_enabled: Boolean(process.env.RING_HMAC_SIGNING_KEY),
        },
    });
});

// POST /api/ring/sync (admin): import door rhythm with a short-lived token.
router.post('/sync', requireAdmin, async (req: CircleRequest, res: Response) => {
    const token = typeof req.body?.access_token === 'string' ? req.body.access_token.trim() : '';
    if (token.length < 20 || token.length > 4096 || /\s/.test(token)) {
        return res.status(400).json({ success: false, error: 'access_token is required' });
    }
    const playground = req.body?.playground === true;
    try {
        const result = await syncFromRing(req.circleId!, token, playground);
        const actor = await memberActor(req.userId!, req.memberId!, req.circleRole!);
        await recordLedger(pool, req.circleId!, actor, {
            action: 'ring_sync', category: 'setup',
            detail: { devices: result.devices.length, imported: result.imported, playground },
        });
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'presence', action: 'synced' });
        res.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof RingApiError) {
            const msg = error.status === 401 || error.status === 403
                ? 'Ring refused the token. Playground tokens expire after about 30 minutes: copy a new one.'
                : error.status === 406 ? 'Ring blocked the request from this server (406). Ring support must allow its IP.'
                : `Ring answered ${error.status}.`;
            return res.status(502).json({ success: false, error: msg });
        }
        logger.error('ring.sync_error', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
