// Live-mesh integration proof for the Omne Go SDK.
//
// A Go-derived account (same demo mnemonic as the TS/Python smokes -> the
// parity-matched, genesis-funded address) builds -> ML-DSA-44 signs -> submits
// a mint_permission call to the live cinchor_permissions contract, then reads
// it back. Proves the node accepts a Go signature and reference returns decode
// in Go.
//
//	go run . <rpc_url> <contract_address> <wallets_json>
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	omne "github.com/OmneDAO/omne-sdks/sdk/go"
)

const (
	chainID = 3
	sel     = "cinchor_permissions::" // pysub contract-qualified ABI selector prefix
)

func u64be(v uint64) []byte {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, v)
	return b
}

func deriveCapabilityID(principal, agent string, nonce, createdAt uint64) (string, error) {
	p, err := omne.FromOmneAddress(principal)
	if err != nil {
		return "", err
	}
	a, err := omne.FromOmneAddress(agent)
	if err != nil {
		return "", err
	}
	pre := make([]byte, 0, 32+32+16)
	pre = append(pre, p...)
	pre = append(pre, a...)
	pre = append(pre, u64be(nonce)...)
	pre = append(pre, u64be(createdAt)...)
	h := sha256.Sum256(pre)
	return omne.ToOmneAddress(h[:])
}

func mustAddr(addr string) omne.AbiArgument {
	a, err := omne.ArgAddress(addr)
	if err != nil {
		panic(err)
	}
	return a
}

func decodeRef(rv any) string {
	if s, ok := rv.(string); ok && strings.HasPrefix(s, "0x") {
		b, err := omne.FromHex(s)
		if err == nil {
			if addr, err := omne.ToOmneAddress(b); err == nil {
				return addr
			}
		}
	}
	return fmt.Sprintf("%v", rv)
}

func main() {
	if len(os.Args) < 4 {
		fmt.Println("usage: go run . <rpc_url> <contract_address> <wallets_json>")
		os.Exit(2)
	}
	rpc, contract, walletsPath := os.Args[1], os.Args[2], os.Args[3]

	raw, err := os.ReadFile(walletsPath)
	if err != nil {
		fmt.Println("read wallets:", err)
		os.Exit(1)
	}
	var w struct {
		Principal struct {
			Mnemonic string `json:"mnemonic"`
		} `json:"principal"`
		Agent struct {
			Mnemonic string `json:"mnemonic"`
		} `json:"agent"`
	}
	if err := json.Unmarshal(raw, &w); err != nil {
		fmt.Println("parse wallets:", err)
		os.Exit(1)
	}

	pw, _ := omne.WalletFromMnemonic(w.Principal.Mnemonic, "")
	aw, _ := omne.WalletFromMnemonic(w.Agent.Mnemonic, "")
	principal, _ := pw.Account(0)
	agent, _ := aw.Account(0)
	client := omne.NewOmneClient(rpc, chainID)
	fmt.Println("principal:", principal.Address)
	fmt.Println("agent:    ", agent.Address)

	// wait until the freshly-deployed contract is callable on this node
	probe := mustAddr(principal.Address)
	callable := false
	for i := 0; i < 24; i++ {
		if _, err := client.QueryContract(contract, sel+"get_status", []omne.AbiArgument{probe}, ""); err == nil {
			callable = true
			break
		}
		time.Sleep(3 * time.Second)
	}
	if !callable {
		fmt.Println("FAIL: contract not callable")
		os.Exit(1)
	}

	now := uint64(time.Now().Unix())
	cap, err := deriveCapabilityID(principal.Address, agent.Address, 888, now)
	if err != nil {
		fmt.Println("derive cap:", err)
		os.Exit(1)
	}
	fmt.Println("capabilityId:", cap)

	// build -> ML-DSA-44 sign -> submit (the node verifies the Go signature)
	tx, err := client.SendContractCall(principal, contract, sel+"mint_permission",
		[]omne.AbiArgument{
			mustAddr(cap),
			mustAddr(principal.Address),
			mustAddr(agent.Address),
			omne.ArgU128FromUint(100),       // max_spend
			omne.ArgU128FromUint(now + 3600), // valid_until
			omne.ArgU128FromUint(0),         // allowlist_enabled
			omne.ArgU128FromUint(now),       // current_time
		}, big.NewInt(0), 0, "", nil)
	if err != nil {
		fmt.Println("mint:", err)
		os.Exit(1)
	}
	fmt.Println("mint tx:", tx)
	client.WaitForReceipt(tx, 60*time.Second, time.Second)

	// assert active
	active := false
	for i := 0; i < 15; i++ {
		res, err := client.QueryContract(contract, sel+"get_status", []omne.AbiArgument{mustAddr(cap)}, "")
		if err == nil && fmt.Sprintf("%v", res["returnValue"]) == "1" {
			fmt.Println("PASS: get_status == 1 (active) — node accepted the Go-signed mint")
			active = true
			break
		}
		time.Sleep(2 * time.Second)
	}
	if !active {
		fmt.Println("FAIL: get_status not active")
		os.Exit(1)
	}

	// full reference-return path in Go: get_principal decodes to the principal
	res, err := client.QueryContract(contract, sel+"get_principal", []omne.AbiArgument{mustAddr(cap)}, "")
	if err != nil {
		fmt.Println("get_principal:", err)
		os.Exit(1)
	}
	got := decodeRef(res["returnValue"])
	fmt.Printf("get_principal returnValue=%v -> %s\n", res["returnValue"], got)
	if got == principal.Address {
		fmt.Println("PASS: get_principal decodes to the principal address (reference-return path)")
		os.Exit(0)
	}
	fmt.Println("FAIL: get_principal mismatch")
	os.Exit(1)
}
