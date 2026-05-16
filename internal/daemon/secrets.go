package daemon

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	fserrors "fast-sub/internal/errors"
)

const transientSecretTTL = 5 * time.Minute

type transientSecret struct {
	ProviderID string
	Value      string
	ExpiresAt  time.Time
	Consumed   bool
}

type transientSecretStore struct {
	mu      sync.Mutex
	secrets map[string]transientSecret
}

func newTransientSecretStore() *transientSecretStore {
	return &transientSecretStore{secrets: map[string]transientSecret{}}
}

func (s *transientSecretStore) create(providerID, value string) (string, time.Time) {
	ref := "secretref_" + randomHex(18)
	expiresAt := time.Now().Add(transientSecretTTL)
	s.mu.Lock()
	s.pruneLocked(time.Now())
	s.secrets[ref] = transientSecret{ProviderID: providerID, Value: value, ExpiresAt: expiresAt}
	s.mu.Unlock()
	return ref, expiresAt
}

func (s *transientSecretStore) consume(ref, providerID string) (string, *fserrors.AppError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	secret, ok := s.secrets[ref]
	if !ok {
		return "", fserrors.New("secret_ref_not_found", "secret", "transient secret reference was not found.", "Save the Provider key again and retry.", nil)
	}
	if secret.Consumed {
		return "", fserrors.New("secret_ref_consumed", "secret", "transient secret reference was already used.", "Create a new job or run the Provider check again.", nil)
	}
	if time.Now().After(secret.ExpiresAt) {
		delete(s.secrets, ref)
		return "", fserrors.New("secret_ref_expired", "secret", "transient secret reference expired.", "Create a new job or run the Provider check again.", nil)
	}
	if providerID != "" && secret.ProviderID != "" && secret.ProviderID != providerID {
		return "", fserrors.New("secret_ref_invalid_provider", "secret", "transient secret reference does not match this Provider.", "Save the Provider key again and retry.", nil)
	}
	value := secret.Value
	secret.Consumed = true
	secret.Value = ""
	s.secrets[ref] = secret
	return value, nil
}

func (s *transientSecretStore) pruneLocked(now time.Time) {
	for ref, secret := range s.secrets {
		if secret.Consumed || now.After(secret.ExpiresAt) {
			delete(s.secrets, ref)
		}
	}
}

func randomHex(bytesLen int) string {
	raw := make([]byte, bytesLen)
	if _, err := rand.Read(raw); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(raw)
}
