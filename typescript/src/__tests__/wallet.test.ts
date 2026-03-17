import { describe, expect, it, jest } from '@jest/globals';
import { Wallet, WalletAccount } from '../wallet';
import { fromOmneAddress, bufferToHex } from '../utils';

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
    expect(account.address.startsWith('omne1')).toBe(true);
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
});
