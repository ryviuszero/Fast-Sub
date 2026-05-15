package errors

import (
	"strings"
	"testing"
)

func TestRedactKeepsNonSecretFilenames(t *testing.T) {
	message := `api failed for Secret_20171207_231523.mp4: model returned status 500`

	redacted := Redact(message)

	if redacted != message {
		t.Fatalf("redacted non-secret filename: %q", redacted)
	}
}

func TestRedactMasksSecretValuesWithoutDroppingMessage(t *testing.T) {
	message := `request failed: Authorization: Bearer abcdefghijk api_key=sk-abcdefghijklmnopqrstuvwxyz token=local-token Secret_20171207_231523.mp4`

	redacted := Redact(message)

	for _, leaked := range []string{"abcdefghijk", "sk-abcdefghijklmnopqrstuvwxyz", "local-token"} {
		if strings.Contains(redacted, leaked) {
			t.Fatalf("secret leaked in %q", redacted)
		}
	}
	if !strings.Contains(redacted, "Secret_20171207_231523.mp4") {
		t.Fatalf("non-secret filename was removed: %q", redacted)
	}
	if redacted == "[redacted]" {
		t.Fatalf("message was over-redacted")
	}
}
