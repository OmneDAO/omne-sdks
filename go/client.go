package omne

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Client represents an Omne blockchain client
type Client struct {
	url        string
	httpClient *http.Client
	wsConn     *websocket.Conn
	wsURL      string
	wsConnMu   sync.RWMutex

	// Secure request ID generation
	idGenerator *SecureIDGenerator

	// Request tracking
	pendingRequests sync.Map

	// Subscription tracking
	subscriptions sync.Map

	// Connection state
	isConnected bool
	connMu      sync.RWMutex

	// Security configuration
	secureConfig *SecureClientConfig
}

// NewClient creates a new Omne client
func NewClient(nodeURL string) (*Client, error) {
	return NewClientWithConfig(nodeURL, DefaultSecureConfig())
}

// NewClientWithConfig creates a new Omne client with custom security configuration
func NewClientWithConfig(nodeURL string, config *SecureClientConfig) (*Client, error) {
	parsedURL, err := url.Parse(nodeURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	client := &Client{
		url:          nodeURL,
		httpClient:   config.CreateSecureHTTPClient(),
		idGenerator:  NewSecureIDGenerator(),
		secureConfig: config,
	}

	// Set WebSocket URL for subscription support
	if parsedURL.Scheme == "http" || parsedURL.Scheme == "https" {
		// Convert HTTP to WebSocket
		wsScheme := "ws"
		if parsedURL.Scheme == "https" {
			wsScheme = "wss"
		}
		client.wsURL = fmt.Sprintf("%s://%s%s", wsScheme, parsedURL.Host, parsedURL.Path)
	} else {
		client.wsURL = nodeURL
	}

	return client, nil
}

// RPCRequest represents a JSON-RPC request
type RPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      int64       `json:"id"`
}

// RPCResponse represents a JSON-RPC response
type RPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
	ID      int64           `json:"id"`
}

// RPCError represents a JSON-RPC error
type RPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	return fmt.Sprintf("RPC error %d: %s", e.Code, e.Message)
}

// NetworkInfo represents network information
type NetworkInfo struct {
	ChainID     int64             `json:"chainId"`
	NetworkType string            `json:"networkType"`
	LatestBlock int64             `json:"latestBlock"`
	GasPrice    map[string]string `json:"gasPrice"`
	Features    NetworkFeatures   `json:"features"`
}

// NetworkFeatures represents network capability flags
type NetworkFeatures struct {
	DualLayerConsensus         bool `json:"dualLayerConsensus"`
	MicroscopicFees            bool `json:"microscopicFees"`
	InstantFinality            bool `json:"instantFinality"`
	ComputationalOrchestration bool `json:"computationalOrchestration"`
}

// Transaction represents an Omne transaction
type Transaction struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Value    string `json:"value"` // Value in quar
	GasLimit uint64 `json:"gasLimit"`
	GasPrice string `json:"gasPrice"` // Gas price in quar
	Data     string `json:"data,omitempty"`
	Nonce    uint64 `json:"nonce"`
	Priority string `json:"priority,omitempty"` // "commerce", "standard", "compute"
}

// TransactionReceipt represents a transaction receipt
type TransactionReceipt struct {
	TransactionHash  string `json:"transactionHash"`
	BlockNumber      int64  `json:"blockNumber"`
	BlockHash        string `json:"blockHash"`
	TransactionIndex int    `json:"transactionIndex"`
	From             string `json:"from"`
	To               string `json:"to"`
	GasUsed          uint64 `json:"gasUsed"`
	Status           int    `json:"status"` // 1 for success, 0 for failure
	Logs             []Log  `json:"logs"`
	ConfirmationTime int64  `json:"confirmationTime"` // Time in milliseconds
}

// Log represents a transaction log
type Log struct {
	Address string   `json:"address"`
	Topics  []string `json:"topics"`
	Data    string   `json:"data"`
}

// Balance represents an account balance
type Balance struct {
	Address     string `json:"address"`
	BalanceOMC  string `json:"balanceOMC"`  // Balance in OMC
	BalanceQuar string `json:"balanceQuar"` // Balance in quar
}

// ORC20Token represents an ORC-20 token
type ORC20Token struct {
	Address     string                 `json:"address"`
	Name        string                 `json:"name"`
	Symbol      string                 `json:"symbol"`
	Decimals    int                    `json:"decimals"`
	TotalSupply string                 `json:"totalSupply"`
	Config      map[string]interface{} `json:"config"`
}

// ComputationalJob represents a computational job submission
type ComputationalJob struct {
	JobID       string                 `json:"jobId"`
	JobType     string                 `json:"jobType"`
	Parameters  map[string]interface{} `json:"parameters"`
	Status      string                 `json:"status"`
	Progress    float64                `json:"progress"`
	Result      interface{}            `json:"result,omitempty"`
	CostOMC     string                 `json:"costOMC"`
	SubmittedAt time.Time              `json:"submittedAt"`
	CompletedAt *time.Time             `json:"completedAt,omitempty"`
}

// GetNetworkInfo retrieves network information
func (c *Client) GetNetworkInfo(ctx context.Context) (*NetworkInfo, error) {
	var result NetworkInfo
	err := c.Call(ctx, "omne_getNetworkInfo", nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// GetBalance retrieves the balance for an address
func (c *Client) GetBalance(ctx context.Context, address string) (*Balance, error) {
	if !IsValidAddress(address) {
		return nil, fmt.Errorf("invalid address: %s", address)
	}

	var result Balance
	err := c.Call(ctx, "omne_getBalance", []interface{}{address}, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// SendTransaction sends a transaction to the network
func (c *Client) SendTransaction(ctx context.Context, tx *Transaction) (*TransactionReceipt, error) {
	if err := c.validateTransaction(tx); err != nil {
		return nil, err
	}

	var result TransactionReceipt
	err := c.Call(ctx, "omne_sendTransaction", tx, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// Transfer sends OMC from one address to another
func (c *Client) Transfer(ctx context.Context, from, to string, valueOMC string, priority string) (*TransactionReceipt, error) {
	// Convert OMC to quar
	valueQuar, err := ToQuarFromOMC(valueOMC)
	if err != nil {
		return nil, fmt.Errorf("invalid value: %w", err)
	}

	// Get nonce
	nonce, err := c.GetNonce(ctx, from)
	if err != nil {
		return nil, fmt.Errorf("failed to get nonce: %w", err)
	}

	// Estimate gas
	gasLimit := EstimateGas("transfer", false)

	// Get gas price
	gasPrice := NewQuar(big.NewInt(1000)) // Default 1000 quar per gas

	tx := &Transaction{
		From:     from,
		To:       to,
		Value:    valueQuar.String(),
		GasLimit: gasLimit,
		GasPrice: gasPrice.String(),
		Nonce:    nonce,
		Priority: priority,
	}

	return c.SendTransaction(ctx, tx)
}

// GetNonce retrieves the nonce for an address
func (c *Client) GetNonce(ctx context.Context, address string) (uint64, error) {
	var result string
	err := c.Call(ctx, "omne_getTransactionCount", []interface{}{address, "latest"}, &result)
	if err != nil {
		return 0, err
	}

	// Parse hex string to uint64
	nonce := new(big.Int)
	nonce.SetString(result[2:], 16) // Remove 0x prefix and parse as hex
	return nonce.Uint64(), nil
}

// DeployORC20Token deploys a new ORC-20 token
func (c *Client) DeployORC20Token(ctx context.Context, name, symbol, totalSupply string, config map[string]interface{}) (*ORC20Token, error) {
	params := map[string]interface{}{
		"name":        name,
		"symbol":      symbol,
		"totalSupply": totalSupply,
		"config":      config,
	}

	var result ORC20Token
	err := c.Call(ctx, "omne_deployORC20Token", params, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// SubmitComputationalJob submits a job to the Omne Orchestration Network
func (c *Client) SubmitComputationalJob(ctx context.Context, jobType string, parameters map[string]interface{}, maxCostOMC string) (*ComputationalJob, error) {
	params := map[string]interface{}{
		"jobType":    jobType,
		"parameters": parameters,
		"maxCostOMC": maxCostOMC,
	}

	var result ComputationalJob
	err := c.Call(ctx, "omne_submitComputationalJob", params, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// GetJobStatus retrieves the status of a computational job
func (c *Client) GetJobStatus(ctx context.Context, jobID string) (*ComputationalJob, error) {
	var result ComputationalJob
	err := c.Call(ctx, "omne_getJobStatus", []interface{}{jobID}, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// Call executes a JSON-RPC call
func (c *Client) Call(ctx context.Context, method string, params interface{}, result interface{}) error {
	requestID, err := c.idGenerator.NextID()
	if err != nil {
		return fmt.Errorf("failed to generate secure request ID: %w", err)
	}

	request := &RPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      requestID,
	}

	requestBody, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.url, bytes.NewBuffer(requestBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	var rpcResponse RPCResponse
	err = json.Unmarshal(responseBody, &rpcResponse)
	if err != nil {
		return fmt.Errorf("failed to unmarshal response: %w", err)
	}

	if rpcResponse.Error != nil {
		return rpcResponse.Error
	}

	if result != nil && len(rpcResponse.Result) > 0 {
		err = json.Unmarshal(rpcResponse.Result, result)
		if err != nil {
			return fmt.Errorf("failed to unmarshal result: %w", err)
		}
	}

	return nil
}

// validateTransaction validates a transaction before sending
func (c *Client) validateTransaction(tx *Transaction) error {
	if !IsValidAddress(tx.From) {
		return fmt.Errorf("invalid from address: %s", tx.From)
	}

	if !IsValidAddress(tx.To) {
		return fmt.Errorf("invalid to address: %s", tx.To)
	}

	// Validate value is a valid quar amount
	_, err := NewQuarFromString(tx.Value)
	if err != nil {
		return fmt.Errorf("invalid value: %w", err)
	}

	// Validate gas price is a valid quar amount
	_, err = NewQuarFromString(tx.GasPrice)
	if err != nil {
		return fmt.Errorf("invalid gas price: %w", err)
	}

	if tx.GasLimit == 0 {
		return fmt.Errorf("gas limit must be greater than 0")
	}

	return nil
}

// Close closes the client and any open connections
func (c *Client) Close() error {
	c.wsConnMu.Lock()
	defer c.wsConnMu.Unlock()

	if c.wsConn != nil {
		return c.wsConn.Close()
	}

	return nil
}
