/// <reference types="node" />

/**
 * Pre-signed transaction submission — split-actor flow.
 *
 * The "customer" signs a transaction locally (on their own device, under a
 * passkey-gated key). The "relayer" (a merchant backend, in the Blox Pay
 * case) receives the signed payload and submits it to Ignis. The relayer
 * never sees the customer's private key; the node reconstructs the canonical
 * hash preimage from the wire payload and verifies the ed25519 signature
 * against it before mempool admission.
 *
 * Usage:
 *   OMNE_RPC_URL=http://rpc.ignis.omnechain.network \
 *     npx ts-node examples/send-raw-transaction.ts
 */

import {
  Wallet,
  createClient,
  toQuar,
  type Transaction,
} from '../src/index';

async function main() {
  const rpcUrl = process.env.OMNE_RPC_URL || 'http://127.0.0.1:8545';
  const chainId = Number(process.env.OMNE_CHAIN_ID ?? 3); // Ignis devnet = 3

  // === Customer side (offline, on a user device) =========================
  // In production, this is a passkey-derived key unlocked in a sandboxed
  // iframe. Here we use a random ephemeral wallet for the demo.
  const customerWallet = Wallet.create();
  const customer = customerWallet.getDefaultAccount();

  const recipient = Wallet.create().getDefaultAccount();

  // Customer's client only needs nonce + gas hints. Nonce comes from the
  // node; for a real deploy the merchant backend surfaces the suggested
  // nonce to the customer over an authenticated API.
  const client = createClient(rpcUrl);
  await client.connect().catch(() => {
    console.warn('⚠️  RPC unreachable — example will fail at submission.');
  });

  const nonce = await client.getTransactionCount(customer.address).catch(() => 0);

  const unsigned: Transaction = {
    from: customer.address,
    to: recipient.address,
    value: toQuar('0.5'),
    gasLimit: 21_000,
    gasPrice: '1000',
    nonce,
  };

  const signed = customer.signTransaction(unsigned, { chainId });
  console.log('🔐 Customer signed transaction:', {
    from: signed.from,
    to: signed.to,
    chainId: signed.chainId,
    nonce: signed.nonce,
    signatureHead: signed.signature.slice(0, 16) + '…',
  });

  // === Relayer side (merchant backend) ====================================
  // The relayer receives `signed` as JSON over HTTPS and forwards it to
  // Ignis without re-signing. sendRawTransaction re-packages the flat
  // {signature, publicKey} fields into the nested wire shape the node
  // expects, then awaits confirmation.
  const receipt = await client.sendRawTransaction(signed);
  console.log('✅ Relayed transaction confirmed:', {
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    status: receipt.status,
  });

  await client.disconnect();
}

main().catch((err) => {
  console.error('❌ send-raw-transaction example failed:', err);
  process.exit(1);
});
