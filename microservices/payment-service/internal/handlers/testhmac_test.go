package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

func computeTestHMAC(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
