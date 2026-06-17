"""Live-mesh integration proof for the Omne Python SDK.

A Python-derived account (same demo mnemonic as the TS smoke -> parity-matched,
genesis-funded address) builds -> ML-DSA-44 signs -> submits a mint_permission
call to the live cinchor_permissions contract, then reads it back. Proves the
node accepts a Python signature and reference returns decode in Python.

  python live_mint.py <rpc_url> <contract_address> <wallets_json>
"""

import hashlib
import json
import sys
import time

from omne_sdk import Wallet, OmneClient, AbiEncode
from omne_sdk.address import from_omne_address, to_omne_address

RPC = sys.argv[1]
CONTRACT = sys.argv[2]
WALLETS = sys.argv[3]
CHAIN_ID = 3
# pysub contracts export contract-qualified selectors; the ABI method name is
# "<contract>::<method>" (the @omne SDK passes the selector through verbatim).
SEL = "cinchor_permissions::"


def derive_capability_id(principal: str, agent: str, nonce: int, created_at: int) -> str:
    pre = (
        from_omne_address(principal)
        + from_omne_address(agent)
        + nonce.to_bytes(8, "big")
        + created_at.to_bytes(8, "big")
    )
    return to_omne_address(hashlib.sha256(pre).digest())


def decode_ref(rv) -> str:
    """A reference (address) return comes back as 0x-hex; decode to om1z."""
    if isinstance(rv, str) and rv.startswith("0x"):
        return to_omne_address(bytes.fromhex(rv[2:]))
    return str(rv)


def main() -> int:
    w = json.load(open(WALLETS))
    principal = Wallet.from_mnemonic(w["principal"]["mnemonic"]).get_account(0)
    agent = Wallet.from_mnemonic(w["agent"]["mnemonic"]).get_account(0)
    client = OmneClient(RPC, CHAIN_ID)
    print(f"principal: {principal.address}")
    print(f"agent:     {agent.address}")

    # wait until the freshly-deployed contract is callable on this node
    probe = AbiEncode.address(principal.address)
    for _ in range(24):
        try:
            client.query_contract(CONTRACT, SEL + "get_status", [probe])
            break
        except Exception:
            time.sleep(3)
    else:
        print("FAIL: contract not callable")
        return 1

    now = int(time.time())
    cap = derive_capability_id(principal.address, agent.address, 777, now)
    print(f"capabilityId: {cap}")

    # build -> ML-DSA-44 sign -> submit (the node verifies the Python signature)
    tx = client.send_contract_call(
        principal,
        CONTRACT,
        SEL + "mint_permission",
        [
            AbiEncode.address(cap),
            AbiEncode.address(principal.address),
            AbiEncode.address(agent.address),
            AbiEncode.u128(100),          # max_spend
            AbiEncode.u128(now + 3600),   # valid_until
            AbiEncode.u128(0),            # allowlist_enabled
            AbiEncode.u128(now),          # current_time
        ],
    )
    print(f"mint tx: {tx}")
    client.wait_for_receipt(tx, timeout=60)

    # assert the capability is active
    status = None
    for _ in range(15):
        status = client.query_contract(CONTRACT, SEL + "get_status", [AbiEncode.address(cap)]).get("returnValue")
        if str(status) == "1":
            print("PASS: get_status == 1 (active) — node accepted the Python-signed mint")
            break
        time.sleep(2)
    else:
        print(f"FAIL: get_status not active (got {status!r})")
        return 1

    # full reference-return path in Python: get_principal should decode to the principal
    rv = client.query_contract(CONTRACT, SEL + "get_principal", [AbiEncode.address(cap)]).get("returnValue")
    got = decode_ref(rv)
    print(f"get_principal returnValue={rv!r} -> {got}")
    if got == principal.address:
        print("PASS: get_principal decodes to the principal address (reference-return path)")
        return 0
    print("FAIL: get_principal mismatch")
    return 1


if __name__ == "__main__":
    sys.exit(main())
