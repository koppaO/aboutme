package main

import (
	"log"
	"net/http"
	"os"

	"github.com/koppaO/aboutme/internal/httpserver"
)

func main() {
	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, httpserver.New()); err != nil {
		log.Fatal(err)
	}
}
