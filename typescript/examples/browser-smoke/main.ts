// @ts-nocheck
import { Wallet, WalletAccount } from '@omne/sdk';

const OUTPUT_ROOT_ID = 'omne-sdk-smoke-output';
const PASSWORD = 'demo-browser-password';
const MESSAGE = 'omne browser smoke test';

function render(target: HTMLElement, content: string): void {
  const pre = document.createElement('pre');
  pre.textContent = content;
  target.appendChild(pre);
}

function ensureContainer(): HTMLElement {
  let container = document.getElementById(OUTPUT_ROOT_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = OUTPUT_ROOT_ID;
    container.style.fontFamily = 'monospace';
    container.style.padding = '1rem';
    container.style.background = '#f4f4f4';
    container.style.borderRadius = '8px';
    container.style.margin = '1rem';
    document.body.appendChild(container);
  }
  container.innerHTML = '';
  return container;
}

async function runSmokeTest(): Promise<void> {
  const container = ensureContainer();

  render(container, 'Running Omne SDK browser smoke test...');

  const wallet = Wallet.generate();
  const account = wallet.getAccount(0);

  render(
    container,
    JSON.stringify(
      {
        mnemonic: wallet.getMnemonic(),
        address: account.address,
        publicKey: account.publicKey,
        privateKey: account.privateKey
      },
      null,
      2
    )
  );

  const signature = account.signMessage(MESSAGE);
  render(
    container,
    JSON.stringify(
      {
        message: MESSAGE,
        signature
      },
      null,
      2
    )
  );

  const keystore = await account.toKeystore(PASSWORD);
  const restored = await WalletAccount.fromKeystore(keystore, PASSWORD);

  render(
    container,
    JSON.stringify(
      {
        keystore,
        restoredMatches: restored.privateKey === account.privateKey
      },
      null,
      2
    )
  );

  console.info('[omne-sdk] browser smoke test complete', {
    mnemonic: wallet.getMnemonic(),
    address: account.address,
    signature,
    keystore,
    restoredMatches: restored.privateKey === account.privateKey
  });
}

runSmokeTest().catch((error) => {
  const container = ensureContainer();
  render(container, `Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('[omne-sdk] browser smoke test failed', error);
});
