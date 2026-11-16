/*
 * The server names its RSA public key's fingerprint in its first answer (resPQ) and the
 * client picks the key by it. A deployment's own server has a key of its own, which the
 * client has to know - `VITE_MTPROTO_RSA_KEYS` (comma-separated `modulus[:exponent]` hex).
 */

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {createHash} from 'crypto';
import bytesFromHex from '@helpers/bytes/bytesFromHex';
import bytesToHex from '@helpers/bytes/bytesToHex';
import bigInt from 'big-integer';
import {TLSerialization} from '@lib/mtproto/tl_utils';
import {RSAKeysManager} from '@lib/mtproto/rsaKeysManager';

vi.mock('@lib/crypto/cryptoMessagePort', () => ({
  default: {
    invokeCrypto: async(_method: string, bytes: Uint8Array | ArrayBuffer) => {
      const {createHash: hash} = await import('crypto');
      return new Uint8Array(hash('sha1').update(new Uint8Array(bytes)).digest());
    }
  }
}));

// a deployment's own `.env` must not decide what the tests see
beforeEach(() => {
  vi.stubEnv('VITE_MTPROTO_RSA_KEYS', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const MODULUS = 'abcd'.repeat(64);

/** The fingerprint the manager derives from a key: sha1 over the TL-serialized key, last 8 bytes reversed */
function fingerprintOf(modulus: string, exponent = '010001') {
  const serialized = new TLSerialization();
  serialized.storeBytes(bytesFromHex(modulus), 'n');
  serialized.storeBytes(bytesFromHex(exponent), 'e');
  const sha1 = new Uint8Array(createHash('sha1').update(new Uint8Array(serialized.getBuffer())).digest());
  const last8 = sha1.slice(-8).reverse();
  return bigInt(bytesToHex(last8), 16).toString();
}

describe('rsaKeysManager', () => {
  test('picks a `VITE_MTPROTO_RSA_KEYS` key by its fingerprint', async() => {
    vi.stubEnv('VITE_MTPROTO_RSA_KEYS', MODULUS + ':010001');
    const manager = new RSAKeysManager();

    const key = await manager.select([fingerprintOf(MODULUS)]);

    expect(key.modulus).toBe(MODULUS);
    expect(key.exponent).toBe('010001');
  });

  test('replaces the built-in keys, not adds to them', async() => {
    const manager = new RSAKeysManager();

    // with an empty `VITE_MTPROTO_RSA_KEYS` only the official keys are known - a
    // fingerprint of any other key selects nothing
    expect(await manager.select([fingerprintOf(MODULUS)])).toBeUndefined();
  });
});
