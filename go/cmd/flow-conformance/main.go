// flow-conformance runs every FLOW conformance vector against the Go verifier.
// Usage: go run ./cmd/flow-conformance ../conformance
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/nik190799/flow/go/flow"
)

type step struct {
	Op     string         `json:"op"`
	Doc    map[string]any `json:"doc"`
	Pin    string         `json:"pin"`
	Clock  string         `json:"clock"`
	Now    *int64         `json:"now"`
	Expect string         `json:"expect"`
}
type vector struct {
	Name  string `json:"name"`
	Now   int64  `json:"now"`
	Steps []step `json:"steps"`
}

func code(err error) string {
	if err == nil {
		return "ok"
	}
	var fe *flow.Error
	if errors.As(err, &fe) {
		return fe.Code
	}
	panic(err)
}

func run(v vector) []string {
	var kr *flow.Keyring
	var got []string
	for _, s := range v.Steps {
		var err error
		switch s.Op {
		case "trust":
			var k *flow.Keyring
			if k, err = flow.TrustFirstKeyring(s.Doc, s.Pin); err == nil {
				kr = k
			}
		case "keyring":
			var k *flow.Keyring
			if k, err = flow.NextKeyring(kr, s.Doc); err == nil {
				kr = k
			}
		case "release":
			now := v.Now
			if s.Now != nil {
				now = *s.Now
			}
			_, err = flow.VerifyRelease(kr, s.Doc, s.Clock != "untrusted", now)
		default:
			panic("unknown op " + s.Op)
		}
		got = append(got, code(err))
	}
	return got
}

func main() {
	root := "../conformance"
	if len(os.Args) > 1 {
		root = os.Args[1]
	}
	pass, fail := 0, 0
	for _, set := range []string{"capsule-a1", "vectors"} {
		files, _ := filepath.Glob(filepath.Join(root, set, "*.json"))
		sort.Strings(files)
		for _, f := range files {
			if filepath.Base(f) == "LOCK.json" {
				continue
			}
			b, err := os.ReadFile(f)
			if err != nil {
				panic(err)
			}
			var v vector
			if err := json.Unmarshal(b, &v); err != nil {
				panic(fmt.Sprintf("%s: %v", f, err))
			}
			var want []string
			for _, s := range v.Steps {
				want = append(want, s.Expect)
			}
			got := run(v)
			if strings.Join(got, ",") == strings.Join(want, ",") {
				pass++
				fmt.Printf("PASS  %s/%s\n", set, v.Name)
			} else {
				fail++
				fmt.Printf("FAIL  %s/%s  — want %s got %s\n", set, v.Name, strings.Join(want, ","), strings.Join(got, ","))
			}
		}
	}
	fmt.Printf("\nconformance (go): %d/%d vectors passed\n", pass, pass+fail)
	if fail > 0 || pass == 0 {
		os.Exit(1)
	}
}
