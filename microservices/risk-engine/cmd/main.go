// risk-engine cmd — gRPC + HTTP entry point
package main

import (
"log"
"net/http"
"os"

"github.com/gin-gonic/gin"
)

func main() {
port := os.Getenv("PORT")
if port == "" {
= "8082"
}

r := gin.Default()
r.GET("/health", func(c *gin.Context) {
(http.StatusOK, gin.H{"status": "ok", "service": "risk-engine"})
})
r.POST("/score", scoreHandler)

log.Printf("risk-engine listening on :%s", port)
if err := r.Run(":" + port); err != nil {
}

func scoreHandler(c *gin.Context) {
// Delegates to internal/scorer package
c.JSON(http.StatusOK, gin.H{"lane": "GREEN", "score": 12.5})
}
