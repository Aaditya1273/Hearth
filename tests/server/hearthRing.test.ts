import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { signalFromHistory, signalFromWebhook, verifyRingSignature } from '../../server/src/lib/hearth/ring';

const key = 'test-signing-key';
const sign = (body: string) => `sha256=${crypto.createHmac('sha256', key).update(body).digest('hex')}`;
const hook = (type: string, attrs: Record<string, unknown> = {}) => ({
    meta: { version: '1.1', request_id: `req-${type}`, account_id: 'ava1.ring.account.A' },
    data: { id: 'x', type, attributes: { source: 'dev1', source_type: 'devices', timestamp: 1771027372393, ...attrs } },
});

describe('Ring webhook signature', () => {
    const body = JSON.stringify(hook('motion_detected', { sub_type: 'human' }));
    it('accepts the exact signed bytes, with or without the sha256= prefix', () => {
        expect(verifyRingSignature(Buffer.from(body), sign(body), key)).toBe(true);
        expect(verifyRingSignature(Buffer.from(body), sign(body).slice(7), key)).toBe(true);
    });
    it('rejects re-serialized or tampered bodies, wrong keys and garbage', () => {
        expect(verifyRingSignature(Buffer.from(JSON.stringify(JSON.parse(body), null, 1)), sign(body), key)).toBe(false);
        expect(verifyRingSignature(Buffer.from(body), sign(body), 'other-key')).toBe(false);
        expect(verifyRingSignature(Buffer.from(body), 'sha256=zz', key)).toBe(false);
        expect(verifyRingSignature(Buffer.from(body), undefined, key)).toBe(false);
        expect(verifyRingSignature(undefined, sign(body), key)).toBe(false);
    });
});

describe('Ring events Hearth keeps', () => {
    it('person motion and an opened door; never vehicles, deliveries or the doorbell button', () => {
        expect(signalFromWebhook(hook('motion_detected', { sub_type: 'human' }), { dev1: 'Front Door' }))
            .toMatchObject({ kind: 'motion', source: 'Ring Front Door', confidence: 0.8, simulated: false, provenance: 'ring' });
        expect(signalFromWebhook(hook('motion_detected', { sub_type: 'motion' }))).toMatchObject({ kind: 'motion', confidence: null });
        expect(signalFromWebhook(hook('motion_detected'))).toMatchObject({ kind: 'motion' }); // missing sub_type = plain motion
        expect(signalFromWebhook(hook('contact_sensor_faulted'))).toMatchObject({ kind: 'door' });
        for (const ignored of [hook('motion_detected', { sub_type: 'vehicle' }), hook('motion_detected', { sub_type: 'package_delivery' }),
            hook('button_press'), hook('contact_sensor_cleared'), hook('device_offline'), { meta: {}, data: {} }]) {
            expect(signalFromWebhook(ignored)).toBeNull();
        }
    });
    it('the same delivery always maps to the same id (Ring retries)', () => {
        expect(signalFromWebhook(hook('motion_detected'))!.external_id).toBe(signalFromWebhook(hook('motion_detected'))!.external_id);
        expect(signalFromWebhook(hook('motion_detected'))!.external_id.length).toBeLessThanOrEqual(100);
    });
    it('Playground live-view events count only in Playground mode, and are marked simulated', () => {
        const ev = (event_type: string) => ({ id: `e-${event_type}`, attributes: { event_type, start: 1771027372393 } });
        expect(signalFromHistory(ev('on_demand'), 'Doorbell', false)).toBeNull();
        expect(signalFromHistory(ev('on_demand'), 'Doorbell', true)).toMatchObject({ kind: 'motion', simulated: true, provenance: 'ring_playground' });
        expect(signalFromHistory(ev('motion'), 'Doorbell', false)).toMatchObject({ simulated: false, provenance: 'ring' });
        expect(signalFromHistory(ev('ding'), 'Doorbell', true)).toBeNull();
    });
});
