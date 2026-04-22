import { describe, expect, it, jest } from '@jest/globals';
import { Wallet, WalletAccount } from '../wallet';
import { fromOmneAddress, bufferToHex } from '../utils';
import type { Transaction } from '../types';

const TEST_MNEMONIC = 'test test test test test test test test test test test ball';
const TEST_PASSWORD = 'P@ssw0rd!';

jest.setTimeout(30000);

describe('Wallet', () => {
  it('derives deterministic accounts from mnemonic', () => {
    const wallet = Wallet.fromMnemonic(TEST_MNEMONIC);
    const account = wallet.getAccount(0);
    const accountAgain = wallet.getAccount(0);

    expect(wallet.getMnemonic()).toBe(TEST_MNEMONIC);
    expect(account.privateKey).toBe(accountAgain.privateKey);
    expect(account.address).toBe(accountAgain.address);
    expect(account.address.startsWith('om1z')).toBe(true);
    // Public key is raw hex, no 0x prefix (Omne convention).
    expect(account.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exports and imports keystore for an account', async () => {
    const wallet = Wallet.fromMnemonic(TEST_MNEMONIC);
    const account = wallet.getAccount(0);

    const keystore = await account.toKeystore(TEST_PASSWORD);
    const restored = await WalletAccount.fromKeystore(keystore, TEST_PASSWORD);

    expect(restored.privateKey).toBe(account.privateKey);
    expect(restored.address).toBe(account.address);
  });

  it('exports wallet with keystores matching derived accounts', async () => {
    const wallet = Wallet.fromMnemonic(TEST_MNEMONIC);
    const derivedAccounts = wallet.getAccounts(5);

    const exported = await wallet.exportWallet(TEST_PASSWORD);

    expect(exported.mnemonic).toBe(TEST_MNEMONIC);
    expect(exported.accounts).toHaveLength(5);

    const expectedFirstAddressHex = bufferToHex(fromOmneAddress(derivedAccounts[0].address));

    expect(exported.accounts[0].address).toBe(expectedFirstAddressHex);
    expect(exported.accounts[0].crypto.cipher).toBe('aes-256-ctr');
  });

  describe('signTransaction chainId handling', () => {
    const wallet = Wallet.fromMnemonic(TEST_MNEMONIC);
    const account = wallet.getAccount(0);
    const recipient = wallet.getAccount(1).address;

    const baseTx = (): Transaction => ({
      from: account.address,
      to: recipient,
      value: '1000000000000000000',
      gasLimit: 21000,
      gasPrice: '1000',
      nonce: 0
    });

    it('throws when chainId is not provided', () => {
      expect(() => account.signTransaction(baseTx())).toThrow(/chainId/);
    });

    it('uses transaction.chainId when set on the tx', () => {
      const signed = account.signTransaction({ ...baseTx(), chainId: 3 });
      expect(signed.chainId).toBe(3);
      expect(signed.signature).toMatch(/^[0-9a-f]{128}$/);
      expect(signed.publicKey).toBe(account.publicKey);
    });

    it('prefers opts.chainId over transaction.chainId', () => {
      const signed = account.signTransaction({ ...baseTx(), chainId: 1 }, { chainId: 3 });
      expect(signed.chainId).toBe(3);
    });

    it('produces different signatures across chainIds', () => {
      const a = account.signTransaction(baseTx(), { chainId: 1 });
      const b = account.signTransaction(baseTx(), { chainId: 3 });
      expect(a.signature).not.toBe(b.signature);
    });

    it('rejects negative and non-integer chainIds', () => {
      expect(() => account.signTransaction(baseTx(), { chainId: -1 })).toThrow(/Invalid chainId/);
      expect(() => account.signTransaction(baseTx(), { chainId: 1.5 })).toThrow(/Invalid chainId/);
    });

    it('Wallet.signTransaction threads opts through to the account', () => {
      const signed = wallet.signTransaction(baseTx(), 0, { chainId: 3 });
      expect(signed.chainId).toBe(3);
      expect(signed.from).toBe(account.address);
    });
  });
});
