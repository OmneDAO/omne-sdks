package omne

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"time"
)

// OmneClient is a minimal JSON-RPC client for an Omne node. It mirrors the
// request/wire shapes of the TS/Python SDKs:
//   - omne_sendTransaction([wire]) with om1z addresses + nested
//     { signature: { signature, publicKey } }
//   - omne_call([{ to, data, from? }]) — reference returns come back as 0x-hex
//   - omne_blockNumber, omne_getNonce, omne_getTransactionReceipt
type OmneClient struct {
	RPCURL  string
	ChainID int
	HTTP    *http.Client
	id      int
}

func NewOmneClient(rpcURL string, chainID int) *OmneClient {
	return &OmneClient{RPCURL: rpcURL, ChainID: chainID, HTTP: &http.Client{Timeout: 10 * time.Second}}
}

func (c *OmneClient) Request(method string, params []any) (json.RawMessage, error) {
	c.id++
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": method, "params": params, "id": c.id})
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Post(c.RPCURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
			Code    int    `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if out.Error != nil {
		return nil, &RpcError{Message: out.Error.Message, Code: out.Error.Code}
	}
	return out.Result, nil
}

// ── reads ────────────────────────────────────────────────────────────
func (c *OmneClient) BlockNumber() (int, error) {
	res, err := c.Request("omne_blockNumber", []any{})
	if err != nil {
		return 0, err
	}
	var n int
	if err := json.Unmarshal(res, &n); err != nil {
		return 0, err
	}
	return n, nil
}

// GetNonce returns the signer's next nonce. Devnet note: the node does not yet
// enforce per-account nonces — omne_getNonce reports 0 even for a busy signer.
func (c *OmneClient) GetNonce(address string) (uint64, error) {
	res, err := c.Request("omne_getNonce", []any{address})
	if err != nil {
		return 0, err
	}
	var n uint64
	if err := json.Unmarshal(res, &n); err != nil {
		return 0, nil // tolerate null/odd shapes -> 0
	}
	return n, nil
}

// Call performs a read-only omne_call. The result is returned as a decoded map
// (notably "returnValue").
func (c *OmneClient) Call(to, data, sender string) (map[string]any, error) {
	callObj := map[string]any{"to": to, "data": data}
	if sender != "" {
		callObj["from"] = sender
	}
	res, err := c.Request("omne_call", []any{callObj})
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(res, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// QueryContract encodes a read-only call. `method` is the ABI selector — for
// pysub contracts the contract-qualified form "<contract>::<method>" (e.g.
// "cinchor_permissions::get_status"). Reference (address/bytes) returns come
// back as a 0x-hex returnValue (decode with FromOmneAddress on the bytes).
func (c *OmneClient) QueryContract(contract, method string, args []AbiArgument, sender string) (map[string]any, error) {
	data, err := EncodeContractCall(method, args)
	if err != nil {
		return nil, err
	}
	return c.Call(contract, data, sender)
}

func (c *OmneClient) GetTransactionReceipt(txHash string) (json.RawMessage, error) {
	return c.Request("omne_getTransactionReceipt", []any{txHash})
}

// ── writes ───────────────────────────────────────────────────────────
func wireValue(v *big.Int) string {
	if v == nil {
		return "0"
	}
	return v.String()
}

// SendSigned submits a signed transaction via omne_sendTransaction and returns
// the transaction hash.
func (c *OmneClient) SendSigned(signed SignedTransaction) (string, error) {
	wire := map[string]any{
		"from":     signed.From,
		"to":       signed.To,
		"value":    wireValue(signed.Value),
		"gasLimit": signed.GasLimit,
		"gasPrice": signed.GasPrice,
		"nonce":    signed.Nonce,
		"chainId":  signed.ChainID,
		"data":     signed.Data,
		"signature": map[string]any{
			"signature": signed.Signature,
			"publicKey": signed.PublicKey,
		},
	}
	res, err := c.Request("omne_sendTransaction", []any{wire})
	if err != nil {
		return "", err
	}
	var s string
	if json.Unmarshal(res, &s) == nil {
		return s, nil
	}
	var obj struct {
		TransactionHash string `json:"transactionHash"`
	}
	if json.Unmarshal(res, &obj) == nil {
		return obj.TransactionHash, nil
	}
	return "", fmt.Errorf("unexpected omne_sendTransaction result: %s", string(res))
}

// SendContractCall builds → ML-DSA-44 signs → submits a state-modifying call.
// If nonce is nil, it is fetched from the node. value nil == 0.
func (c *OmneClient) SendContractCall(
	account *WalletAccount,
	contract, method string,
	args []AbiArgument,
	value *big.Int,
	gasLimit uint64,
	gasPrice string,
	nonce *uint64,
) (string, error) {
	data, err := EncodeContractCall(method, args)
	if err != nil {
		return "", err
	}
	var n uint64
	if nonce != nil {
		n = *nonce
	} else if n, err = c.GetNonce(account.Address); err != nil {
		return "", err
	}
	if gasLimit == 0 {
		gasLimit = DefaultGasLimit
	}
	if gasPrice == "" {
		gasPrice = DefaultGasPrice
	}
	signed, err := account.SignTransaction(Transaction{
		From:     account.Address,
		To:       contract,
		Value:    value,
		GasLimit: gasLimit,
		GasPrice: gasPrice,
		Nonce:    n,
		ChainID:  c.ChainID,
		Data:     data,
	})
	if err != nil {
		return "", err
	}
	return c.SendSigned(signed)
}

// WaitForReceipt polls for a receipt, tolerating "not found" while the tx is in
// the mempool. Returns (nil, nil) on timeout.
func (c *OmneClient) WaitForReceipt(txHash string, timeout, interval time.Duration) (json.RawMessage, error) {
	if txHash == "" {
		return nil, nil
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		res, err := c.GetTransactionReceipt(txHash)
		if err == nil && res != nil && string(res) != "null" {
			return res, nil
		}
		time.Sleep(interval)
	}
	return nil, nil
}
