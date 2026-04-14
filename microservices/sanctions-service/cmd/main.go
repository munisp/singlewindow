// sanctions-service — HTTP screening endpoint
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
= "8086"
}

r := gin.Default()
r.GET("/health", func(c *gin.Context) {
(http.StatusOK, gin.H{"status": "ok", "service": "sanctions-service"})
})
r.POST("/screen", func(c *gin.Context) {
req struct {
ame string `json:"name"`
err := c.ShouldBindJSON(&req); err != nil {
(http.StatusBadRequest, gin.H{"error": err.Error()})

In production: call internal/screener.Screen with loaded lists
(http.StatusOK, gin.H{"hit": false, "score": 0.0, "name": req.Name})
})

log.Printf("sanctions-service listening on :%s", port)
if err := r.Run(":" + port); err != nil {
}
