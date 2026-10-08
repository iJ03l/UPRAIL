package oneclick

// QuoteRequest represents the parameters for requesting a swap quote from 1Click API.
type QuoteRequest struct {
	SwapType        string   `json:"swapType,omitempty"`
	OriginAsset     string   `json:"originAsset"`
	DestinationAsset string  `json:"destinationAsset"`
	Amount          string   `json:"amount"`
	Recipient       string   `json:"recipient"`
	RecipientType   string   `json:"recipientType,omitempty"`
	RefundTo        string   `json:"refundTo,omitempty"`
	RefundType      string   `json:"refundType,omitempty"`
	Confidentiality string   `json:"confidentiality"` // "advanced"
	DepositType     string   `json:"depositType,omitempty"`
	Dry             bool     `json:"dry,omitempty"`
	AppFees         []AppFee `json:"appFees,omitempty"`
}

// AppFee defines fee split configured for application partners.
type AppFee struct {
	Recipient string `json:"recipient"`
	Fee       string `json:"fee"` // e.g. "10" for 10 bps or basis fraction
}

// Route represents an execution route within the quote response.
type Route struct {
	Protocol string `json:"protocol,omitempty"`
	PoolID   string `json:"poolId,omitempty"`
	Percent  int    `json:"percent,omitempty"`
}

// QuoteResponse represents the response received from 1Click quote endpoint.
type QuoteResponse struct {
	DepositAddress  string  `json:"depositAddress"`
	AmountIn        string  `json:"amountIn"`
	AmountOut       string  `json:"amountOut"`
	Expiration      int64   `json:"expiration,omitempty"`
	Confidentiality string  `json:"confidentiality,omitempty"`
	Routes          []Route `json:"routes,omitempty"`
	QuoteID         string  `json:"quoteId,omitempty"`
	MinAmountOut    string  `json:"minAmountOut,omitempty"`
	TimeEstimate    int64   `json:"timeEstimate,omitempty"`
}

// StatusResponse represents the status of a deposit transaction.
type StatusResponse struct {
	Status         string `json:"status"`
	DepositAddress string `json:"depositAddress"`
	TxHash         string `json:"txHash,omitempty"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
	Details        any    `json:"details,omitempty"`
}

// SubmitDepositRequest represents request body for submitting a deposit transaction hash.
type SubmitDepositRequest struct {
	TxHash         string `json:"txHash"`
	DepositAddress string `json:"depositAddress"`
}

// Token represents a token supported by 1Click protocol.
type Token struct {
	Symbol          string `json:"symbol"`
	Blockchain      string `json:"blockchain"`
	Decimals        int    `json:"decimals"`
	AssetID         string `json:"assetId"`
	ContractAddress string `json:"contractAddress"`
	Name            string `json:"name,omitempty"`
	Icon            string `json:"icon,omitempty"`
	Price           string `json:"price,omitempty"`
}
