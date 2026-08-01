// buildzip writes a Lambda deployment zip with a single `bootstrap` entry.
// Two jobs a host zip can't do here: (1) set unix mode 0755 on the entry —
// provided.al2023 requires an executable bootstrap, and Windows-built zips
// carry no mode bits; (2) pin the entry timestamp so the zip bytes — and
// terraform's filebase64sha256 — only change when the binary does (the Go
// analog of the learning jar's pinned project.build.outputTimestamp).
package main

import (
	"archive/zip"
	"io"
	"log"
	"os"
	"time"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("usage: buildzip <binary> <out.zip>")
	}
	in, err := os.Open(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	defer in.Close()
	out, err := os.Create(os.Args[2])
	if err != nil {
		log.Fatal(err)
	}
	zw := zip.NewWriter(out)
	hdr := &zip.FileHeader{
		Name:     "bootstrap",
		Method:   zip.Deflate,
		Modified: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	hdr.SetMode(0o755)
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		log.Fatal(err)
	}
	if _, err := io.Copy(w, in); err != nil {
		log.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		log.Fatal(err)
	}
	if err := out.Close(); err != nil {
		log.Fatal(err)
	}
}
