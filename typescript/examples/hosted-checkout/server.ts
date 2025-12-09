// Minimal hosted-checkout example server using the SDK pieces above
import express from 'express';
import { RpcProvider } from '../../src/provider';
import { TxBuilder } from '../../src/tx-builder';
import { Wallet, WalletAccount } from '../../src/wallet';
import { WalletAccountSigner } from '../../src/signer';

const app = express();
app.use(express.json());

const provider = new RpcProvider({ url: process.env.OMNE_RPC ?? 'http://localhost:8545' });
const txBuilder = new TxBuilder(provider);

// Example "merchant" server signer (DEV only)
const wallet = Wallet.generate();
const serverAccount = wallet.getAccount(0);
const serverSigner = new WalletAccountSigner(serverAccount);

app.post('/create-session', async (req, res) => {
  const { merchantId, amount } = req.body;
  // Create payment session in DB (omitted)
  // For demo: create a pre-funded contract or send a small tx to record session metadata
  const tx = await txBuilder.signAndSend({
    from: serverAccount.address,
    to: serverAccount.address,
    valueOMC: amount
  }, serverSigner);

  res.json({ sessionId: 'stub-session', txHash: tx.transactionHash, redirectUrl: `https://hosted.example/checkout/stub-session` });
});

app.listen(8080, () => console.log('Hosted checkout example listening on :8080'));