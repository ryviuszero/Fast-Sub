// Package models implements Go-managed model manifests, stores, and installers.
package models

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// Manifest contains all known downloadable models.
type Manifest struct {
	SchemaVersion int             `json:"schema_version"`
	Models        []ManifestEntry `json:"models"`
}

// ManifestFile describes one required artifact in a directory-style model.
type ManifestFile struct {
	Path      string   `json:"path"`
	SizeBytes int64    `json:"size_bytes"`
	SHA256    string   `json:"sha256"`
	URLs      []string `json:"urls,omitempty"`
}

// ManifestEntry describes a model or binary artifact managed by Go.
type ManifestEntry struct {
	ID                  string         `json:"id"`
	Name                string         `json:"name"`
	Type                string         `json:"type"`
	Backend             string         `json:"backend"`
	ArtifactKind        string         `json:"artifact_kind"`
	CompatibleProviders []string       `json:"compatible_providers"`
	Version             string         `json:"version,omitempty"`
	Revision            string         `json:"revision,omitempty"`
	SizeBytes           int64          `json:"size_bytes"`
	License             string         `json:"license"`
	LicenseURL          string         `json:"license_url,omitempty"`
	URLs                []string       `json:"urls"`
	SHA256              string         `json:"sha256,omitempty"`
	RequiredFiles       []ManifestFile `json:"required_files"`
	DefaultFor          []string       `json:"default_for,omitempty"`
	PrivacyClass        string         `json:"privacy_class"`
	InstallLayout       string         `json:"install_layout"`
	SourceType          string         `json:"source_type"`
	ETag                string         `json:"etag,omitempty"`
	Platforms           []string       `json:"platforms,omitempty"`
	MinDiskFreeBytes    int64          `json:"min_disk_free_bytes,omitempty"`
	EstimatedRAMBytes   int64          `json:"estimated_ram_bytes,omitempty"`
}

// BuiltInManifest returns the static Round 10 model catalog.
func BuiltInManifest() Manifest {
	return Manifest{SchemaVersion: 1, Models: []ManifestEntry{
		{
			ID:                  "whisper-base",
			Name:                "Whisper Base",
			Type:                "asr",
			Backend:             "faster-whisper",
			ArtifactKind:        "model",
			CompatibleProviders: []string{"local-faster-whisper"},
			Revision:            "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
			SizeBytes:           147882941,
			License:             "MIT",
			URLs:                []string{"https://huggingface.co/Systran/faster-whisper-base/resolve/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66/"},
			RequiredFiles: []ManifestFile{
				{Path: "config.json", SizeBytes: 2309, SHA256: "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a"},
				{Path: "model.bin", SizeBytes: 145217532, SHA256: "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9"},
				{Path: "tokenizer.json", SizeBytes: 2203239, SHA256: "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"},
				{Path: "vocabulary.txt", SizeBytes: 459861, SHA256: "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"},
			},
			DefaultFor:        []string{"local-faster-whisper"},
			PrivacyClass:      "local",
			InstallLayout:     "directory",
			SourceType:        "http",
			Platforms:         []string{"all"},
			MinDiskFreeBytes:  155277088,
			EstimatedRAMBytes: 1073741824,
		},
		{
			ID:                  "whisper-small",
			Name:                "Whisper Small",
			Type:                "asr",
			Backend:             "faster-whisper",
			ArtifactKind:        "model",
			CompatibleProviders: []string{"local-faster-whisper"},
			Revision:            "536b0662742c02347bc0e980a01041f333bce120",
			SizeBytes:           486212372,
			License:             "MIT",
			URLs:                []string{"https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/"},
			RequiredFiles: []ManifestFile{
				{Path: "config.json", SizeBytes: 2370, SHA256: "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"},
				{Path: "model.bin", SizeBytes: 483546902, SHA256: "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"},
				{Path: "tokenizer.json", SizeBytes: 2203239, SHA256: "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"},
				{Path: "vocabulary.txt", SizeBytes: 459861, SHA256: "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"},
			},
			PrivacyClass:      "local",
			InstallLayout:     "directory",
			SourceType:        "http",
			Platforms:         []string{"all"},
			MinDiskFreeBytes:  510522990,
			EstimatedRAMBytes: 2147483648,
		},
		{
			ID:                  "whisper-large-v3-turbo",
			Name:                "Whisper Large v3 Turbo",
			Type:                "asr",
			Backend:             "faster-whisper",
			ArtifactKind:        "model",
			CompatibleProviders: []string{"local-faster-whisper"},
			Revision:            "0d50161d23807098c6b7ed53bbb70c7ce02702b9",
			SizeBytes:           1621665983,
			License:             "MIT",
			URLs:                []string{"https://huggingface.co/h2oai/faster-whisper-large-v3-turbo/resolve/0d50161d23807098c6b7ed53bbb70c7ce02702b9/"},
			RequiredFiles: []ManifestFile{
				{Path: "config.json", SizeBytes: 2263, SHA256: "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e"},
				{Path: "model.bin", SizeBytes: 1617884929, SHA256: "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da"},
				{Path: "preprocessor_config.json", SizeBytes: 340, SHA256: "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711"},
				{Path: "tokenizer.json", SizeBytes: 2710337, SHA256: "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd"},
				{Path: "vocabulary.json", SizeBytes: 1068114, SHA256: "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1"},
			},
			PrivacyClass:      "local",
			InstallLayout:     "directory",
			SourceType:        "http",
			Platforms:         []string{"all"},
			MinDiskFreeBytes:  1702749282,
			EstimatedRAMBytes: 4294967296,
		},
		{
			ID:                  "nllb-200-distilled-600m-ct2-int8",
			Name:                "NLLB-200 Distilled 600M CTranslate2 INT8",
			Type:                "translate",
			Backend:             "nllb-ct2",
			ArtifactKind:        "model",
			CompatibleProviders: []string{"local-nllb-ct2"},
			Revision:            "4685875",
			SizeBytes:           630477782,
			License:             "CC-BY-NC-4.0",
			URLs:                []string{"https://huggingface.co/osa911/nllb-200-distilled-600M-ct2-int8/resolve/4685875/"},
			RequiredFiles: []ManifestFile{
				{Path: "config.json", SizeBytes: 223, SHA256: "8f6496adfc930cbfecbe8281112197705c488fab47d34b4829b06d7f478909af"},
				{Path: "model.bin", SizeBytes: 619704329, SHA256: "ca3362e6e81906c0cf9c33bd6917674222c71d69617d0afb18507ce0b6c2e2e8"},
				{Path: "sentencepiece.bpe.model", SizeBytes: 4852054, SHA256: "14bb8dfb35c0ffdea7bc01e56cea38b9e3d5efcdcb9c251d6b40538e1aab555a"},
				{Path: "shared_vocabulary.json", SizeBytes: 5921176, SHA256: "af53bfd0e6f726209e7325e45b87ab3b14e5856f7d42d7b9be91de3287c45267"},
			},
			PrivacyClass:      "local",
			InstallLayout:     "directory",
			SourceType:        "http",
			Platforms:         []string{"all"},
			MinDiskFreeBytes:  662001671,
			EstimatedRAMBytes: 2147483648,
		},
	}}
}

// LoadManifest returns the built-in manifest or an override JSON manifest path.
func LoadManifest(path string) (Manifest, error) {
	if path == "" {
		path = os.Getenv("FAST_SUB_GO_MODEL_MANIFEST")
	}
	if path == "" {
		return BuiltInManifest(), nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("read model manifest: %w", err)
	}
	var manifest Manifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse model manifest: %w", err)
	}
	return manifest, nil
}

// Get returns a manifest entry by id.
func (m Manifest) Get(id string) (ManifestEntry, bool) {
	for _, entry := range m.Models {
		if entry.ID == id {
			return entry, true
		}
	}
	return ManifestEntry{}, false
}

// SupportedOnCurrentPlatform reports whether this model applies to this OS/arch.
func (e ManifestEntry) SupportedOnCurrentPlatform() bool {
	if len(e.Platforms) == 0 {
		return true
	}
	current := runtime.GOOS + "/" + runtime.GOARCH
	for _, platform := range e.Platforms {
		if platform == "all" || platform == runtime.GOOS || platform == current {
			return true
		}
	}
	return false
}

// ManifestType returns the installed artifact shape.
func (e ManifestEntry) ManifestType() string {
	if e.InstallLayout != "" {
		return e.InstallLayout
	}
	if len(e.RequiredFiles) > 0 {
		return "directory"
	}
	return "file"
}

func (e ManifestEntry) validate() error {
	if e.ID == "" {
		return fmt.Errorf("model id is empty")
	}
	if strings.ContainsAny(e.ID, `/\`) || e.ID == "." || e.ID == ".." {
		return fmt.Errorf("model id must be a single path-safe name")
	}
	if !e.SupportedOnCurrentPlatform() {
		return fmt.Errorf("model %s does not support this platform", e.ID)
	}
	if e.ManifestType() == "directory" && len(e.RequiredFiles) == 0 {
		return fmt.Errorf("model %s has directory layout but no required files", e.ID)
	}
	if e.ManifestType() == "file" && e.SHA256 == "" {
		return fmt.Errorf("model %s is missing sha256", e.ID)
	}
	if e.ManifestType() == "file" && len(e.URLs) == 0 {
		return fmt.Errorf("model %s is missing download URLs", e.ID)
	}
	for _, file := range e.RequiredFiles {
		if err := validateRelativePath(file.Path); err != nil {
			return fmt.Errorf("model %s invalid required file %q: %w", e.ID, file.Path, err)
		}
		if strings.TrimSpace(file.SHA256) == "" {
			return fmt.Errorf("model %s required file %s is missing sha256", e.ID, file.Path)
		}
		if len(file.URLs) == 0 && len(e.URLs) == 0 {
			return fmt.Errorf("model %s required file %s is missing download URLs", e.ID, file.Path)
		}
	}
	return nil
}
