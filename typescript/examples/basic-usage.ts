/// <reference types="node" />

/**
 * Basic usage example for Omne TypeScript SDK
 * 
 * Demonstrates core functionality including wallet creation,
 * transactions, and quar-precision calculations.
 */

import { 
  Wallet, 
  toQuar, 
  fromQuar, 
  formatBalance,
  createClient 
} from '../src/index';

async function basicUsageExample() {
  console.log('🚀 Omne TypeScript SDK - Basic Usage Example');
  console.log('=============================================\n');

  // 1. Create client connection
  console.log('📡 Connecting to Omne network...');
  const rpcUrl = process.env.OMNE_RPC_URL || 'http://127.0.0.1:8545';
  const client = createClient(rpcUrl);
  
  try {
    await client.connect();
    console.log(`✅ Connected to Omne network at ${rpcUrl}\n`);
  } catch (error) {
    console.log(`⚠️ Connection failed for ${rpcUrl}`);
    console.log('📝 Falling back to offline demonstrations...\n');
  }

  // 2. Wallet operations
  console.log('💰 Wallet Operations');
  console.log('--------------------');

  // Generate new wallet
  const wallet = Wallet.generate();
  console.log(`Mnemonic: ${wallet.getMnemonic()}`);
  console.log(`Address: ${wallet.address}\n`);

  // Derive multiple accounts
  const accounts = wallet.getAccounts(3);
  accounts.forEach((account, index) => {
    console.log(`Account ${index}: ${account.address}`);
  });
  console.log();

  // 3. Quar precision calculations
  console.log('🔢 Quar Precision Demonstrations');
  console.log('--------------------------------');

  const amounts = [1.0, 0.5, 0.001, 10.5, 0.0001];
  amounts.forEach(amount => {
    const quar = toQuar(amount);
    const omc = fromQuar(quar);
    console.log(`${amount} OMC = ${quar} quar = ${omc.toString()} OMC`);
  });
  console.log();

  // 4. Commerce scenarios
  console.log('🏪 Commerce Transaction Examples');
  console.log('--------------------------------');

  const commerceScenarios = [
    { name: 'Coffee', price: 0.003 },
    { name: 'Digital download', price: 0.15 },
    { name: 'Subscription', price: 9.99 },
    { name: 'Microtransaction', price: 0.0001 }
  ];

  commerceScenarios.forEach(scenario => {
    const valueQuar = toQuar(scenario.price);
    const gasQuar = 21000 * 1000; // 21k gas * 1000 quar/gas
    const totalQuar = BigInt(valueQuar) + BigInt(gasQuar);
    const totalOMC = fromQuar(totalQuar.toString());
    
    console.log(`${scenario.name}: ${scenario.price} OMC + gas = ${totalOMC.toString()} OMC total`);
  });
  console.log();

  // 5. Transaction creation (offline)
  console.log('📝 Transaction Creation');
  console.log('----------------------');

  const account = wallet.getAccount(0);
  const transaction = {
    from: account.address,
    to: '0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e',
    value: toQuar(0.001), // 0.001 OMC
    gasLimit: 21000,
    gasPrice: '1000', // 1000 quar per gas
    nonce: 0,
    priority: 'commerce' as const
  };

  try {
    const signedTx = account.signTransaction(transaction);
    console.log(`Transaction hash: ${signedTx.hash || 'Generated offline'}`);
    console.log(`From: ${signedTx.from}`);
    console.log(`To: ${signedTx.to}`);
    console.log(`Value: ${formatBalance(signedTx.value)}`);
    console.log(`Priority: ${signedTx.priority}`);
    console.log(`Signature: ${signedTx.signature ? signedTx.signature.substring(0, 20) + '...' : 'N/A'}`);
  } catch (error) {
    console.log('⚠️ Transaction signing failed (expected without crypto dependencies)');
    console.log('📋 Transaction details:');
    console.log(`From: ${transaction.from}`);
    console.log(`To: ${transaction.to}`);
    console.log(`Value: ${formatBalance(transaction.value)}`);
  }
  console.log();

  // 6. SDK capabilities
  console.log('✨ SDK Feature Overview');
  console.log('----------------------');
  console.log('🔗 Blockchain Integration: Full dual-layer PoVERA support');
  console.log('💰 Microscopic Fees: Quar-precision gas calculations');
  console.log('🪙 ORC-20 Tokens: Deploy and manage application tokens');
  console.log('🤖 AI/ML Services: Submit computational jobs to OON');
  console.log('🔐 Wallet Management: BIP39 HD wallets with signing');
  console.log('⚡ Async/Await: Modern JavaScript async patterns');
  console.log('🔒 Type Safety: Full TypeScript type definitions');
  console.log();

  console.log('🎉 Omne TypeScript SDK demonstration complete!');
  
  // Cleanup
  await client.disconnect();
}

// Run example if called directly
if (require.main === module) {
  basicUsageExample().catch(console.error);
}

export { basicUsageExample };
