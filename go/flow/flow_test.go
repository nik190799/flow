package flow

import (
	"encoding/json"
	"os"
	"testing"
)

// A flipped payload byte must break the first keyring in the frozen capsule.
func TestTamperedPayloadRefused(t *testing.T) {
	b, err := os.ReadFile("../../conformance/capsule-a1/01-trust-ok.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Steps []struct {
			Doc map[string]any `json:"doc"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	env := v.Steps[0].Doc
	if _, err := TrustFirstKeyring(env, ""); err != nil {
		t.Fatalf("untouched keyring refused: %v", err)
	}
	p := []byte(env["payload"].(string))
	if p[10] == 'A' {
		p[10] = 'B'
	} else {
		p[10] = 'A'
	}
	env["payload"] = string(p)
	if _, err := TrustFirstKeyring(env, ""); err == nil {
		t.Fatal("tampered keyring accepted")
	}
}

func TestPAE(t *testing.T) {
	if got := string(PAE("flow/keyring", []byte("{}"))); got != "FLOWv1 12 flow/keyring 2 {}" {
		t.Fatalf("PAE = %q", got)
	}
}
