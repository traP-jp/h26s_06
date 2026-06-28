package main

import "testing"

func TestLoadMariaDBConfigRequiresAllNeoShowcaseKeys(t *testing.T) {
	t.Setenv("NS_MARIADB_DATABASE", "app")
	t.Setenv("NS_MARIADB_HOSTNAME", "db")
	t.Setenv("NS_MARIADB_PASSWORD", "")
	t.Setenv("NS_MARIADB_PORT", "3306")
	t.Setenv("NS_MARIADB_USER", "")

	cfg := loadMariaDBConfig()
	if !cfg.incomplete() {
		t.Fatal("MariaDB config was not marked incomplete")
	}
	if cfg.enabled() {
		t.Fatal("incomplete MariaDB config was marked enabled")
	}
}

func TestLoadMariaDBConfigAllowsEmptyPassword(t *testing.T) {
	t.Setenv("NS_MARIADB_DATABASE", "app")
	t.Setenv("NS_MARIADB_HOSTNAME", "db")
	t.Setenv("NS_MARIADB_PASSWORD", "")
	t.Setenv("NS_MARIADB_PORT", "3306")
	t.Setenv("NS_MARIADB_USER", "app")

	cfg := loadMariaDBConfig()
	if !cfg.enabled() {
		t.Fatalf("MariaDB config enabled = false, missing=%v", cfg.missing)
	}
}
