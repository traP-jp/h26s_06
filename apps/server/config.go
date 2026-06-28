package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	addr                  string
	appOrigin             string
	traqBaseURL           string
	oauthClientID         string
	oauthRedirectURL      string
	oauthScope            string
	traqBotAccessToken    string
	allowedTraqIDs        map[string]bool
	syncInterval          time.Duration
	viewerPollInterval    time.Duration
	viewerChannelsPerTick int
	mariaDB               mariaDBConfig
}

type mariaDBConfig struct {
	database string
	hostname string
	password string
	port     string
	user     string
	missing  []string
	present  bool
}

func loadConfig() config {
	return config{
		addr:                  envString("SERVER_ADDR", ":8080"),
		appOrigin:             envString("APP_ORIGIN", "http://localhost:5173"),
		traqBaseURL:           strings.TrimRight(envString("TRAQ_BASE_URL", "https://q.trap.jp"), "/"),
		oauthClientID:         os.Getenv("TRAQ_CLIENT_ID"),
		oauthRedirectURL:      envString("TRAQ_REDIRECT_URL", "http://localhost:5173/oauth/callback"),
		oauthScope:            envString("OAUTH_SCOPE", "read"),
		traqBotAccessToken:    os.Getenv("TRAQ_BOT_ACCESS_TOKEN"),
		allowedTraqIDs:        envStringSet("ALLOWED_TRAQ_IDS"),
		syncInterval:          envDuration("SYNC_INTERVAL", 30*time.Second),
		viewerPollInterval:    envDuration("VIEWER_POLL_INTERVAL", 20*time.Second),
		viewerChannelsPerTick: envInt("VIEWER_POLL_CHANNELS", 40),
		mariaDB:               loadMariaDBConfig(),
	}
}

func loadMariaDBConfig() mariaDBConfig {
	keys := []string{
		"NS_MARIADB_DATABASE",
		"NS_MARIADB_HOSTNAME",
		"NS_MARIADB_PASSWORD",
		"NS_MARIADB_PORT",
		"NS_MARIADB_USER",
	}
	values := map[string]string{}
	present := false
	missing := []string{}
	for _, key := range keys {
		value, ok := os.LookupEnv(key)
		if ok {
			present = true
			values[key] = value
		}
		if !ok || (key != "NS_MARIADB_PASSWORD" && strings.TrimSpace(value) == "") {
			missing = append(missing, key)
		}
	}
	if !present {
		return mariaDBConfig{}
	}
	return mariaDBConfig{
		database: values["NS_MARIADB_DATABASE"],
		hostname: values["NS_MARIADB_HOSTNAME"],
		password: values["NS_MARIADB_PASSWORD"],
		port:     values["NS_MARIADB_PORT"],
		user:     values["NS_MARIADB_USER"],
		missing:  missing,
		present:  true,
	}
}

func (cfg mariaDBConfig) enabled() bool {
	return cfg.present && len(cfg.missing) == 0
}

func (cfg mariaDBConfig) incomplete() bool {
	return cfg.present && len(cfg.missing) > 0
}

func envString(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envStringSet(key string) map[string]bool {
	raw := os.Getenv(key)
	if raw == "" {
		return nil
	}
	set := map[string]bool{}
	for _, id := range strings.Split(raw, ",") {
		id = strings.TrimSpace(id)
		if id != "" {
			set[id] = true
		}
	}
	if len(set) == 0 {
		return nil
	}
	return set
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		traqLogWarn("invalid config %s=%q; using %s", key, raw, fallback)
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		traqLogWarn("invalid config %s=%q; using %d", key, raw, fallback)
		return fallback
	}
	return value
}

func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key != "" {
			_ = os.Setenv(key, value)
		}
	}
}
