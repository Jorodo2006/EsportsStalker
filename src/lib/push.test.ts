// Una suscripción hecha con otra clave del servidor (src/lib/push.ts): el navegador la sigue dando por buena, pero el servicio de
// push rechaza todo lo que se le mande. Hay que rehacerla
import { describe, expect, it } from 'vitest';
import { sameKey } from './push';

// Una clave pública VAPID en base64url (65 bytes) y sus bytes
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const key = Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256);
const other = key.map((x, i) => (i === 10 ? (x + 1) % 256 : x));
const sub = (bytes: number[] | null) => ({ options: { applicationServerKey: bytes ? new Uint8Array(bytes).buffer : null, userVisibleOnly: true } }) as Pick<PushSubscription, 'options'>;

describe('sameKey', () => {
  it('la misma clave vale', () => expect(sameKey(sub(key), b64(key))).toBe(true));
  it('otra clave no vale (cambiaron las claves del servidor)', () => expect(sameKey(sub(other), b64(key))).toBe(false));
  it('si el navegador no dice con qué clave se hizo, se da por buena', () => expect(sameKey(sub(null), b64(key))).toBe(true));
});
