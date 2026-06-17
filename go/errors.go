package omne

import "fmt"

// RpcError is a JSON-RPC transport or node-returned error.
type RpcError struct {
	Message string
	Code    int
}

func (e *RpcError) Error() string {
	if e.Code != 0 {
		return fmt.Sprintf("rpc error %d: %s", e.Code, e.Message)
	}
	return "rpc error: " + e.Message
}
