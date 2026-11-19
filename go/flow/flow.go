// Package flow is the Go verifier for FLOW revision A1: the signed envelope, the keyring (trust
// policy with quantum-safe root keys) and the unknown-field rules. It is the second, independent
// implementation; both must give the same outcome on every conformance vector.
package flow

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"unicode/utf8"

	"github.com/cloudflare/circl/sign/slhdsa"
)

// Error is a refusal with a stable code.
type Error struct{ Code, Msg string }

func (e *Error) Error() string { return e.Code + ": " + e.Msg }
func refuse(code, format string, a ...any) *Error {
	return &Error{code, fmt.Sprintf(format, a...)}
}

const (
	EnvelopeVersion = 1
	MaxPayload      = 1 << 20
	MaxSigs         = 64
	TypeKeyring     = "flow/keyring"
	TypeRelease     = "flow/release"
)

var (
	typeRE = regexp.MustCompile(`^[a-z0-9][a-z0-9./-]{0,63}$`)
	kidRE  = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	b64RE  = regexp.MustCompile(`^[A-Za-z0-9_-]*$`)
)

// Features this host implements that a document may list in "requires". A1 defines none.
var Features = map[string]bool{}

// ---------- suites ----------

type suite struct {
	quantumSafe bool
	pubBytes    int
	verify      func(sig, msg, pub []byte) bool
}

var Suites = map[string]suite{
	"p256": {false, 65, func(sig, msg, pub []byte) bool {
		if len(sig) != 64 || len(pub) != 65 || pub[0] != 4 {
			return false
		}
		k, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pub)
		if err != nil {
			return false
		}
		h := sha256.Sum256(msg)
		return ecdsa.Verify(k, h[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:]))
	}},
	"slh-dsa-sha2-128s": {true, 32, func(sig, msg, pub []byte) bool {
		if len(sig) != 7856 || len(pub) != 32 {
			return false
		}
		k := slhdsa.PublicKey{ID: slhdsa.SHA2_128s}
		if k.UnmarshalBinary(pub) != nil {
			return false
		}
		return slhdsa.Verify(&k, slhdsa.NewMessage(msg), sig, nil)
	}},
}

// KidOf is "sha256:" + hex(SHA-256(suite || 0x00 || pub)).
func KidOf(suiteName string, pub []byte) string {
	h := sha256.New()
	h.Write([]byte(suiteName))
	h.Write([]byte{0})
	h.Write(pub)
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

func b64dec(v any) ([]byte, bool) {
	s, ok := v.(string)
	if !ok || !b64RE.MatchString(s) {
		return nil, false
	}
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	if err != nil || base64.RawURLEncoding.EncodeToString(b) != s {
		return nil, false
	}
	return b, true
}

// ---------- envelope ----------

// PAE is the signed byte string: "FLOWv1" SP len(type) SP type SP len(payload) SP payload.
func PAE(typ string, payload []byte) []byte {
	var b bytes.Buffer
	fmt.Fprintf(&b, "FLOWv1 %d %s %d ", len(typ), typ, len(payload))
	b.Write(payload)
	return b.Bytes()
}

type sigEntry struct {
	kid      string
	sig, pub []byte
}

type unwrapped struct {
	typ     string
	payload []byte
	sigs    []sigEntry
}

func isSafeInt(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || f != math.Trunc(f) || math.Abs(f) > 9007199254740991 {
		return 0, false
	}
	return int64(f), true
}

func unwrap(env map[string]any, expect string) (*unwrapped, error) {
	if env == nil {
		return nil, refuse("malformed", "envelope must be a JSON object")
	}
	if v, ok := isSafeInt(env["flow"]); !ok || v != EnvelopeVersion {
		if ok && v > EnvelopeVersion {
			return nil, refuse("host_too_old", "envelope format %d; this host reads format 1", v)
		}
		return nil, refuse("malformed", "envelope must say flow: 1")
	}
	typ, ok := env["type"].(string)
	if !ok || !typeRE.MatchString(typ) {
		return nil, refuse("malformed", "envelope type is missing or badly formed")
	}
	if expect != "" && typ != expect {
		return nil, refuse("wrong_type", "expected a %s document, got %s", expect, typ)
	}
	payload, ok := b64dec(env["payload"])
	if !ok {
		return nil, refuse("malformed", "payload is not base64url")
	}
	if len(payload) > MaxPayload {
		return nil, refuse("malformed", "payload too large")
	}
	list, ok := env["sigs"].([]any)
	if !ok || len(list) > MaxSigs {
		return nil, refuse("malformed", "sigs must be a list of at most %d", MaxSigs)
	}
	u := &unwrapped{typ: typ, payload: payload}
	for i, raw := range list {
		s, _ := raw.(map[string]any)
		kid, _ := s["kid"].(string)
		if s == nil || !kidRE.MatchString(kid) {
			return nil, refuse("malformed", "sigs[%d] needs a kid", i)
		}
		sig, ok := b64dec(s["sig"])
		if !ok {
			return nil, refuse("malformed", "sigs[%d].sig is not base64url", i)
		}
		e := sigEntry{kid: kid, sig: sig}
		if p, present := s["pub"]; present {
			if e.pub, ok = b64dec(p); !ok {
				return nil, refuse("malformed", "sigs[%d].pub is not base64url", i)
			}
		}
		u.sigs = append(u.sigs, e)
	}
	return u, nil
}

type key struct {
	suite string
	pub   []byte
}

// validSigners returns kid -> suite for every valid signature. extra allows one kid the caller doesn't
// hold (a revealed spare), whose entry must carry a pub matching the kid.
func validSigners(u *unwrapped, lookup func(string) *key, extra map[string]string) map[string]string {
	msg := PAE(u.typ, u.payload)
	ok := map[string]string{}
	for _, s := range u.sigs {
		if _, done := ok[s.kid]; done {
			continue
		}
		k := lookup(s.kid)
		if k == nil {
			if sname, isExtra := extra[s.kid]; isExtra && s.pub != nil && KidOf(sname, s.pub) == s.kid {
				k = &key{sname, s.pub}
			}
		}
		if k == nil {
			continue
		}
		su, impl := Suites[k.suite]
		if !impl {
			continue
		}
		if su.verify(s.sig, msg, k.pub) {
			ok[s.kid] = k.suite
		}
	}
	return ok
}

// ---------- strict JSON ----------

// parseStrict: valid UTF-8, JSON, no repeated key within one object, and an object at the top.
func parseStrict(b []byte, what string) (map[string]any, error) {
	if !utf8.Valid(b) {
		return nil, refuse("malformed", "%s is not valid UTF-8", what)
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, refuse("malformed", "%s is not JSON: %v", what, err)
	}
	if dup := findDup(json.NewDecoder(bytes.NewReader(b))); dup != "" {
		return nil, refuse("malformed", "%s repeats the key %q in one object", what, dup)
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, refuse("malformed", "%s must be a JSON object", what)
	}
	return m, nil
}

func findDup(d *json.Decoder) string {
	var walk func() (string, error)
	walk = func() (string, error) {
		t, err := d.Token()
		if err != nil {
			return "", err
		}
		switch t {
		case json.Delim('{'):
			seen := map[string]bool{}
			for d.More() {
				kt, err := d.Token()
				if err != nil {
					return "", err
				}
				k := kt.(string)
				if seen[k] {
					return k, nil
				}
				seen[k] = true
				if dup, err := walk(); dup != "" || err != nil {
					return dup, err
				}
			}
			_, err = d.Token()
			return "", err
		case json.Delim('['):
			for d.More() {
				if dup, err := walk(); dup != "" || err != nil {
					return dup, err
				}
			}
			_, err = d.Token()
			return "", err
		}
		return "", nil
	}
	dup, err := walk()
	if err != nil && !errors.Is(err, io.EOF) {
		return ""
	}
	return dup
}

// ---------- keyring ----------

type Group struct {
	Suite     string
	Keys      []string
	Threshold int
}

type Keyring struct {
	Number        int64
	App           string
	Keys          map[string]*key
	Roles         map[string][]Group
	SpareSuite    string
	SpareKid      string
	RevealedSpare bool
}

func checkRequires(doc map[string]any, what string) error {
	r, present := doc["requires"]
	if !present {
		return nil
	}
	list, ok := r.([]any)
	if !ok {
		return refuse("malformed", "%s: requires must be a list of feature names", what)
	}
	var missing []string
	for _, x := range list {
		s, ok := x.(string)
		if !ok {
			return refuse("malformed", "%s: requires must be a list of feature names", what)
		}
		if !Features[s] {
			missing = append(missing, s)
		}
	}
	if len(missing) > 0 {
		return refuse("host_too_old", "%s requires %v, which this host doesn't implement", what, missing)
	}
	return nil
}

func readKeyring(doc map[string]any) (*Keyring, error) {
	if err := checkRequires(doc, "keyring"); err != nil {
		return nil, err
	}
	n, ok := isSafeInt(doc["keyring"])
	if !ok || n < 1 {
		return nil, refuse("malformed", "keyring must be a positive integer")
	}
	app, ok := doc["app"].(string)
	if !ok || app == "" {
		return nil, refuse("malformed", "keyring must name its app")
	}
	keysRaw, ok := doc["keys"].(map[string]any)
	if !ok {
		return nil, refuse("malformed", "keyring.keys must be an object")
	}
	kr := &Keyring{Number: n, App: app, Keys: map[string]*key{}, Roles: map[string][]Group{}}
	for kid, raw := range keysRaw {
		k, _ := raw.(map[string]any)
		s, sok := k["suite"].(string)
		if !kidRE.MatchString(kid) || k == nil || !sok {
			return nil, refuse("malformed", "keys.%s is badly formed", kid)
		}
		pub, ok := b64dec(k["pub"])
		if !ok {
			return nil, refuse("malformed", "keys.%s.pub is not base64url", kid)
		}
		if KidOf(s, pub) != kid {
			return nil, refuse("malformed", "keys.%s doesn't match its suite and public key", kid)
		}
		if su, impl := Suites[s]; impl && len(pub) != su.pubBytes {
			return nil, refuse("malformed", "keys.%s has the wrong length", kid)
		}
		kr.Keys[kid] = &key{s, pub}
	}
	rolesRaw, ok := doc["roles"].(map[string]any)
	if !ok {
		return nil, refuse("malformed", "keyring.roles must be an object")
	}
	for role, raw := range rolesRaw {
		groups, ok := raw.([]any)
		if !ok || len(groups) == 0 {
			return nil, refuse("malformed", "roles.%s must be a non-empty list", role)
		}
		for i, graw := range groups {
			g, _ := graw.(map[string]any)
			s, sok := g["suite"].(string)
			ks, kok := g["keys"].([]any)
			if g == nil || !sok || !kok || len(ks) == 0 {
				return nil, refuse("malformed", "roles.%s[%d] must be { suite, keys, threshold }", role, i)
			}
			grp := Group{Suite: s}
			seen := map[string]bool{}
			for _, kraw := range ks {
				kid, _ := kraw.(string)
				if seen[kid] {
					return nil, refuse("malformed", "roles.%s[%d] lists a key twice", role, i)
				}
				seen[kid] = true
				k := kr.Keys[kid]
				if k == nil {
					return nil, refuse("malformed", "roles.%s[%d] names a key that isn't in keys", role, i)
				}
				if k.suite != s {
					return nil, refuse("malformed", "roles.%s[%d] mixes suites", role, i)
				}
				grp.Keys = append(grp.Keys, kid)
			}
			t, ok := isSafeInt(g["threshold"])
			if !ok || t < 1 || t > int64(len(grp.Keys)) {
				return nil, refuse("malformed", "roles.%s[%d].threshold out of range", role, i)
			}
			grp.Threshold = int(t)
			kr.Roles[role] = append(kr.Roles[role], grp)
		}
	}
	for _, r := range []string{"root", "release"} {
		if kr.Roles[r] == nil {
			return nil, refuse("malformed", "keyring must define the %s role", r)
		}
	}
	sp, _ := doc["spare"].(map[string]any)
	ss, sok := sp["suite"].(string)
	sk, kok := sp["kid"].(string)
	if sp == nil || !sok || !kok || !kidRE.MatchString(sk) {
		return nil, refuse("malformed", "keyring must commit to a spare root key")
	}
	if kr.Keys[sk] != nil {
		return nil, refuse("malformed", "the spare root key must not be an active key")
	}
	kr.SpareSuite, kr.SpareKid = ss, sk
	for _, r := range []string{"root", "release"} {
		for _, g := range kr.Roles[r] {
			if _, impl := Suites[g.Suite]; !impl {
				return nil, refuse("host_too_old", "roles.%s uses the %s suite, which this host doesn't implement", r, g.Suite)
			}
		}
	}
	pq := false
	for _, g := range kr.Roles["root"] {
		pq = pq || Suites[g.Suite].quantumSafe
	}
	if !pq {
		return nil, refuse("weak_root", "the root role must include a quantum-safe group")
	}
	return kr, nil
}

// meets: every group reaches its threshold; the spare may stand in for one missing key, once.
func meets(groups []Group, signers map[string]string, spareSuite, spareKid string) (ok, spareUsed bool) {
	ok = true
	for _, g := range groups {
		n := 0
		for _, kid := range g.Keys {
			if signers[kid] == g.Suite {
				n++
			}
		}
		if n < g.Threshold && spareKid != "" && !spareUsed && spareSuite == g.Suite && signers[spareKid] == g.Suite {
			n++
			spareUsed = true
		}
		if n < g.Threshold {
			ok = false
		}
	}
	return
}

func (kr *Keyring) lookup(kid string) *key { return kr.Keys[kid] }

// TrustFirstKeyring accepts the keyring a device ships with (optionally pinned by SHA-256 of its payload).
func TrustFirstKeyring(env map[string]any, pin string) (*Keyring, error) {
	u, err := unwrap(env, TypeKeyring)
	if err != nil {
		return nil, err
	}
	if pin != "" {
		h := sha256.Sum256(u.payload)
		if hex.EncodeToString(h[:]) != pin {
			return nil, refuse("untrusted", "keyring doesn't match the pinned hash")
		}
	}
	doc, err := parseStrict(u.payload, "keyring")
	if err != nil {
		return nil, err
	}
	kr, err := readKeyring(doc)
	if err != nil {
		return nil, err
	}
	if ok, _ := meets(kr.Roles["root"], validSigners(u, kr.lookup, nil), "", ""); !ok {
		return nil, refuse("untrusted", "keyring isn't signed under its own root policy")
	}
	return kr, nil
}

// NextKeyring moves from cur to the keyring in env, or refuses.
func NextKeyring(cur *Keyring, env map[string]any) (*Keyring, error) {
	u, err := unwrap(env, TypeKeyring)
	if err != nil {
		return nil, err
	}
	old, spareUsed := meets(cur.Roles["root"], validSigners(u, cur.lookup, map[string]string{cur.SpareKid: cur.SpareSuite}), cur.SpareSuite, cur.SpareKid)
	if !old {
		return nil, refuse("untrusted", "not signed under the current root policy")
	}
	doc, err := parseStrict(u.payload, "keyring")
	if err != nil {
		return nil, err
	}
	next, err := readKeyring(doc)
	if err != nil {
		return nil, err
	}
	if next.App != cur.App {
		return nil, refuse("wrong_app", "keyring is for another app")
	}
	if next.Number <= cur.Number {
		return nil, refuse("stale", "keyring %d isn't newer than %d", next.Number, cur.Number)
	}
	if ok, _ := meets(next.Roles["root"], validSigners(u, next.lookup, nil), "", ""); !ok {
		return nil, refuse("untrusted", "not signed under its own new root policy")
	}
	if spareUsed && next.SpareKid == cur.SpareKid {
		return nil, refuse("malformed", "the spare was revealed, so the next keyring must commit to a new spare")
	}
	next.RevealedSpare = spareUsed
	return next, nil
}

// Release is a verified release document.
type Release struct {
	App      string
	Manifest map[string]any
}

// VerifyRelease checks a release against the keyring's release role. clockTrusted=false means the
// device has no reliable time: expiry is not judged.
func VerifyRelease(kr *Keyring, env map[string]any, clockTrusted bool, nowMs int64) (*Release, error) {
	u, err := unwrap(env, TypeRelease)
	if err != nil {
		return nil, err
	}
	if ok, _ := meets(kr.Roles["release"], validSigners(u, kr.lookup, nil), "", ""); !ok {
		return nil, refuse("untrusted", "release isn't signed under the release policy")
	}
	doc, err := parseStrict(u.payload, "release")
	if err != nil {
		return nil, err
	}
	if err := checkRequires(doc, "release"); err != nil {
		return nil, err
	}
	app, _ := doc["app"].(string)
	if _, isStr := doc["app"].(string); !isStr || app != kr.App {
		return nil, refuse("wrong_app", "release is for another app")
	}
	m, ok := doc["manifest"].(map[string]any)
	if !ok || m["app"] != app {
		return nil, refuse("malformed", "release.manifest must be an LLP manifest for the same app")
	}
	if e, present := doc["expires"]; present {
		exp, ok := isSafeInt(e)
		if !ok {
			return nil, refuse("malformed", "expires must be milliseconds since 1970")
		}
		if clockTrusted && nowMs > exp {
			return nil, refuse("expired", "release expired at %s", strconv.FormatInt(exp, 10))
		}
	}
	return &Release{App: app, Manifest: m}, nil
}
