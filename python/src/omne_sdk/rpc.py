"""Minimal JSON-RPC client for an Omne node (stdlib urllib — no extra deps).

Mirrors the request/wire shapes the TS SDK (sdk/typescript/src/client.ts) and
the Cinchor SDK use:

  * omne_sendTransaction([wire])  — wire carries om1z addresses + a nested
    { signature: { signature, publicKey } }; the node rebuilds the canonical
    hash preimage and verifies the ML-DSA-44 signature.
  * omne_call([{ to, data, from? }]) — read-only; reference-typed returns come
    back as a 0x-hex `returnValue` (decode addresses with address.from_omne_*).
  * omne_blockNumber, omne_getNonce, omne_getTransactionReceipt.
"""

from __future__ import annotations

import json
import time
import urllib.request

from .abi import AbiArgument, encode_contract_call
from .errors import RpcError
from .transaction import DEFAULT_GAS_LIMIT, DEFAULT_GAS_PRICE, build_transaction
from .wallet import WalletAccount


class OmneClient:
    def __init__(self, rpc_url: str, chain_id: int, *, timeout: float = 10.0):
        self.rpc_url = rpc_url
        self.chain_id = chain_id
        self.timeout = timeout
        self._id = 0

    # ── transport ───────────────────────────────────────────────────
    def request(self, method: str, params: list | None = None):
        self._id += 1
        payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params or [], "id": self._id})
        req = urllib.request.Request(
            self.rpc_url,
            data=payload.encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        if body.get("error"):
            err = body["error"]
            raise RpcError(str(err.get("message", err)), code=err.get("code"))
        return body.get("result")

    # ── reads ────────────────────────────────────────────────────────
    def block_number(self) -> int:
        return int(self.request("omne_blockNumber", []))

    def get_nonce(self, address: str) -> int:
        # Devnet note: the node does not yet enforce per-account nonces;
        # omne_getNonce reports 0 even for a busy signer (any nonce accepted).
        try:
            return int(self.request("omne_getNonce", [address]) or 0)
        except RpcError:
            acct = self.request("omne_getAccount", [address]) or {}
            return int(acct.get("nonce", 0))

    def call(self, to: str, data: str, sender: str | None = None) -> dict:
        call_obj = {"to": to, "data": data}
        if sender:
            call_obj["from"] = sender
        return self.request("omne_call", [call_obj])

    def query_contract(self, contract: str, method: str, args: list[AbiArgument] | None = None,
                       sender: str | None = None) -> dict:
        return self.call(contract, encode_contract_call(method, args or []), sender)

    def get_transaction_receipt(self, tx_hash: str):
        return self.request("omne_getTransactionReceipt", [tx_hash])

    # ── writes ───────────────────────────────────────────────────────
    @staticmethod
    def _to_wire(signed: dict) -> dict:
        wire = {
            "from": signed["from"],
            "to": signed["to"],
            "value": signed["value"],
            "gasLimit": signed["gasLimit"],
            "gasPrice": signed["gasPrice"],
            "nonce": signed["nonce"],
            "chainId": signed["chainId"],
            "data": signed.get("data") or "",
            "signature": {"signature": signed["signature"], "publicKey": signed["publicKey"]},
        }
        if signed.get("priority"):
            wire["priority"] = signed["priority"]
        if signed.get("layer"):
            wire["layer"] = signed["layer"]
        return wire

    def send_signed(self, signed: dict) -> str | None:
        result = self.request("omne_sendTransaction", [self._to_wire(signed)])
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            return result.get("transactionHash")
        return None

    def send_contract_call(
        self,
        account: WalletAccount,
        contract: str,
        method: str,
        args: list[AbiArgument] | None = None,
        *,
        value: int | str = 0,
        gas_limit: int = DEFAULT_GAS_LIMIT,
        gas_price: str = DEFAULT_GAS_PRICE,
        nonce: int | None = None,
    ) -> str | None:
        """Build → sign → submit a state-modifying contract call."""
        resolved_nonce = self.get_nonce(account.address) if nonce is None else nonce
        tx = build_transaction(
            sender=account.address,
            to=contract,
            data=encode_contract_call(method, args or []),
            value=value,
            gas_limit=gas_limit,
            gas_price=gas_price,
            nonce=resolved_nonce,
            chain_id=self.chain_id,
        )
        signed = account.sign_transaction(tx, chain_id=self.chain_id)
        return self.send_signed(signed)

    def wait_for_receipt(self, tx_hash: str, timeout: float = 60.0, interval: float = 1.0):
        """Poll for a receipt, tolerating 'not found' while the tx is in mempool."""
        if not tx_hash:
            return None
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                receipt = self.get_transaction_receipt(tx_hash)
                if receipt:
                    return receipt
            except RpcError:
                pass  # receipt not yet available — keep polling
            time.sleep(interval)
        return None
