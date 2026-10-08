package crypto

import (
	"errors"
	"math/big"
	"strings"
)

const b58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

var b58Indexes [256]int

func init() {
	for i := range b58Indexes {
		b58Indexes[i] = -1
	}
	for i := 0; i < len(b58Alphabet); i++ {
		b58Indexes[b58Alphabet[i]] = i
	}
}

// Base58Encode encodes a byte slice into a Base58 string (Bitcoin alphabet).
func Base58Encode(input []byte) string {
	if len(input) == 0 {
		return ""
	}

	zeroCount := 0
	for zeroCount < len(input) && input[zeroCount] == 0 {
		zeroCount++
	}

	// Convert big-endian bytes to big.Int
	intVal := new(big.Int).SetBytes(input)
	radix := big.NewInt(58)
	mod := new(big.Int)

	var sb strings.Builder
	for intVal.Sign() > 0 {
		intVal.DivMod(intVal, radix, mod)
		sb.WriteByte(b58Alphabet[mod.Int64()])
	}

	// Reverse the output
	runes := []byte(sb.String())
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}

	// Prepend leading '1's corresponding to leading zeroes in input
	result := strings.Repeat("1", zeroCount) + string(runes)
	return result
}

// Base58Decode decodes a Base58 string (Bitcoin alphabet) into a byte slice.
func Base58Decode(input string) ([]byte, error) {
	if len(input) == 0 {
		return []byte{}, nil
	}

	zeroCount := 0
	for zeroCount < len(input) && input[zeroCount] == '1' {
		zeroCount++
	}

	intVal := big.NewInt(0)
	radix := big.NewInt(58)

	for i := 0; i < len(input); i++ {
		char := input[i]
		idx := b58Indexes[char]
		if idx == -1 {
			return nil, errors.New("invalid base58 character")
		}
		intVal.Mul(intVal, radix)
		intVal.Add(intVal, big.NewInt(int64(idx)))
	}

	decodedBytes := intVal.Bytes()
	result := make([]byte, zeroCount+len(decodedBytes))
	copy(result[zeroCount:], decodedBytes)

	return result, nil
}
