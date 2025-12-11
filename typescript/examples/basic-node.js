#!/usr/bin/env node
/*
 * Basic Omne SDK usage from the compiled CJS bundle.
 * Demonstrates connecting to the devnet, generating a wallet,
 * and reading latest block metrics for investor materials.
 */

const { promises: fs } = require('fs');
const { Wallet, toQuar, fromQuar, ensureSignedCompilerAttachment, buildDeploymentHeaders } = require('../dist/index.cjs.js');

async function main() {
  const rpcUrl = process.env.OMNE_RPC_URL || 'http://127.0.0.1:8545';
  console.log('🚀 Omne TypeScript SDK (Node) Demo');
  console.log('RPC endpoint:', rpcUrl);

  const rpc = async (method, params = []) => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() })
    });

    const payload = await response.json();
    if (payload.error) {
      throw new Error(`RPC ${method} failed: ${payload.error.message}`);
    }
    return payload.result;
  };

  try {
    const info = await rpc('omne_networkInfo');
    console.log('\n📡 Network');
    console.log('  Name:', info.networkName);
    console.log('  Chain ID:', info.chainId);
    console.log('  API Version:', info.apiVersion);

  const wallet = Wallet.generate();
  console.log('\n🔐 Wallet');
  console.log('  Address (omne1):', wallet.address);
  const hexAddress = `0x${wallet.address.slice(5)}`;
  console.log('  Address (hex):', hexAddress);

  const balance = await rpc('omne_getBalance', [hexAddress]);
    console.log('\n💰 Balance');
  const balanceQuar = BigInt(balance.balanceQuar ?? balance.balance ?? 0);
  console.log('  OMC:', fromQuar(balanceQuar.toString()).toString());
  console.log('  Quar:', balanceQuar.toString());

    const gasPrice = await rpc('omne_gasPrice');
    const gasValue = typeof gasPrice === 'object' && gasPrice !== null
      ? (gasPrice.gasPriceQuar || gasPrice.gasPrice || gasPrice.baseFeeQuar || gasPrice)
      : gasPrice;
    const gasQuar = BigInt(gasValue);
    const transferCost = BigInt(21000) * gasQuar;
    console.log('\n⛽ Gas');
    console.log('  Gas price (quar):', gasQuar.toString());
    console.log('  Transfer cost (quar):', transferCost.toString());
    console.log('  Transfer cost (OMC):', fromQuar(transferCost.toString()).toString());

    const latestNumberHex = await rpc('omne_blockNumber');
    const latestBlock = await rpc('omne_getBlockByNumber', [latestNumberHex, false]);
    const blockNumber = parseInt(latestNumberHex, 16);
    console.log('\n📦 Latest Block');
    console.log('  Number:', blockNumber);
    console.log('  Hash:', latestBlock.hash);
    console.log('  Layer:', latestBlock.layer);
    const txCount = Array.isArray(latestBlock.transactions)
      ? latestBlock.transactions.length
      : latestBlock.transactionCount ?? 0;
    console.log('  Tx count:', txCount);

    const planPath = process.env.OMNE_EXECUTION_PLAN;
    if (!planPath) {
      console.log('\n🛡️ Hardened deployment: set OMNE_EXECUTION_PLAN and OMNE_AUTH_TOKEN to submit a plan via the secure endpoint.');
    } else {
      const deploymentUrl = process.env.OMNE_DEPLOYMENT_URL;
      if (!deploymentUrl) {
        console.log('\n🛡️ Hardened deployment skipped - set OMNE_DEPLOYMENT_URL with the /v1/deployments endpoint.');
      } else {
        try {
          const rawPlan = await fs.readFile(planPath, 'utf8');
          const plan = JSON.parse(rawPlan);
          ensureSignedCompilerAttachment(plan);

          const nonce = plan.contract?.deployment_nonce;
          if (!nonce) {
            throw new Error('Execution plan is missing contract.deployment_nonce');
          }

          const headers = buildDeploymentHeaders({
            nonce,
            authToken: process.env.OMNE_AUTH_TOKEN,
          });
          headers['Content-Type'] = 'application/json';

          console.log(`\n🛡️ Submitting hardened deployment to ${deploymentUrl} (nonce ${nonce})`);
          const response = await fetch(deploymentUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(plan)
          });

          const text = await response.text();
          const payload = text ? JSON.parse(text) : {};

          if (response.status === 202) {
            console.log('  ✅ Submission accepted');
            console.log('  Plan ID:', payload.plan_id);
            console.log('  Digest:', payload.digest);
            console.log('  Signer:', payload.signer);
            if (payload.compiler_signer) {
              console.log('  Compiler signer:', payload.compiler_signer);
            }
            console.log('  Nonce provenance:', payload.nonce_provenance);
          } else {
            console.log('  ❌ Submission rejected:', payload.detail || response.statusText);
          }
        } catch (error) {
          console.error('\n❌ Hardened deployment failed:', error);
        }
      }
    }
  } catch (error) {
  console.error('❌ Demo failed:', error);
  }
}

main();
