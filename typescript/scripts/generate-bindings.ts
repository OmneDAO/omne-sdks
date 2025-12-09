// Placeholder codegen script (ABI/WASM -> TS bindings).
// TODO: wire to your contract ABI format or wasm metadata and generate typed wrappers.
// This script is a scaffold to be extended with real codegen (e.g., use json-schema -> ts or custom templates)

import * as fs from 'fs';
import * as path from 'path';

const outDir = path.resolve(__dirname, '..', 'src', 'bindings');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function generateStub(contractName: string) {
  const content = `// Auto-generated stub for ${contractName}
// TODO: Replace with generated methods that call RPC provider or use low-level OmneClient
export class ${contractName} {
  constructor(private provider: any, private contractAddress: string) {}
  // Example view wrapper
  async name(): Promise<string> {
    return await this.provider.callRpc('contract_call', [this.contractAddress, 'name', []]);
  }
}
`;
  fs.writeFileSync(path.join(outDir, `${contractName}.ts`), content, 'utf8');
}

generateStub('BXTToken');
console.log('Generated stub bindings in', outDir);