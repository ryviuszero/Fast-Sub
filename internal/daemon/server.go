// Package daemon implements the local HTTP REST and SSE API.
package daemon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"fast-sub/internal/contracts"
	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/jobs"
	"fast-sub/internal/providers"
)

type Config struct {
	Host           string
	Port           int
	Token          string
	MaxRunningJobs int
	JobRoot        string
	Version        string
	Runner         jobs.Runner
	Providers      providers.RuntimeConfig
}

type Server struct {
	cfg     Config
	manager *jobs.Manager
	mux     *http.ServeMux
}

func New(cfg Config) (*Server, error) {
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if !loopbackHost(cfg.Host) {
		return nil, fmt.Errorf("daemon host must be loopback-only in this release: %s", cfg.Host)
	}
	cfg.Host = normalizeHost(cfg.Host)
	if cfg.Version == "" {
		cfg.Version = "0.1.0-dev"
	}
	if cfg.Token == "" {
		cfg.Token = newToken()
	}
	manager, err := jobs.NewManager(cfg.JobRoot, cfg.MaxRunningJobs, cfg.Runner)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, manager: manager, mux: http.NewServeMux()}
	s.routes()
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return s.noCORS(s.mux)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.Handler().ServeHTTP(w, r)
}

func (s *Server) ListenAndServe(ctx context.Context) (contracts.Ready, error) {
	listener, err := net.Listen("tcp", net.JoinHostPort(s.cfg.Host, strconv.Itoa(s.cfg.Port)))
	if err != nil {
		return contracts.Ready{}, err
	}
	addr := listener.Addr().(*net.TCPAddr)
	ready := contracts.Ready{
		SchemaVersion: contracts.DaemonSchemaVersion,
		Ready:         true,
		BaseURL:       "http://" + net.JoinHostPort(s.cfg.Host, strconv.Itoa(addr.Port)),
		Token:         s.cfg.Token,
		PID:           os.Getpid(),
	}
	server := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		s.manager.Shutdown()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	go func() {
		_ = server.Serve(listener)
	}()
	return ready, nil
}

func (s *Server) routes() {
	s.mux.HandleFunc("/v1/health", s.handleHealth)
	s.mux.HandleFunc("/v1/version", s.handleVersion)
	s.mux.HandleFunc("/v1/models", s.auth(s.handleModels))
	s.mux.HandleFunc("/v1/providers", s.auth(s.handleProviders))
	s.mux.HandleFunc("/v1/jobs", s.auth(s.handleJobs))
	s.mux.HandleFunc("/v1/jobs/", s.auth(s.handleJob))
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+s.cfg.Token {
			writeError(w, http.StatusUnauthorized, fserrors.New("unauthorized", "auth", "authorization bearer token is required.", "", nil))
			return
		}
		next(w, r)
	}
}

func (s *Server) noCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}

func newToken() string {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(raw[:])
}

func loopbackHost(host string) bool {
	normalized := normalizeHost(host)
	if normalized == "localhost" {
		return true
	}
	ip := net.ParseIP(normalized)
	return ip != nil && ip.IsLoopback()
}

func normalizeHost(host string) string {
	return strings.Trim(strings.TrimSpace(host), "[]")
}
