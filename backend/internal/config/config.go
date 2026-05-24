package config

import (
	"bufio"
	"os"
	"strings"
)

type Config struct {
	DBHost     string
	DBPort     string
	DBUser     string
	DBPassword string
	DBName     string
	DBTLS      string // "true" to require TLS (TiDB Cloud, PlanetScale, etc.)
	JWTSecret  string
	ServerPort string
}

func Load() *Config {
	loadEnvFile(".env")

	return &Config{
		DBHost:     getEnv("DB_HOST", "localhost"),
		DBPort:     getEnv("DB_PORT", "3307"),
		DBUser:     getEnv("DB_USER", "root"),
		DBPassword: getEnv("DB_PASSWORD", ""),
		DBName:     getEnv("DB_NAME", "share_management"),
		DBTLS:      getEnv("DB_TLS", "false"),
		JWTSecret:  getEnv("JWT_SECRET", "share-admin-secret-key-2024"),
		ServerPort: getEnv("SERVER_PORT", "8080"),
	}
}

func (c *Config) DSN() string {
	dsn := c.DBUser + ":" + c.DBPassword + "@tcp(" + c.DBHost + ":" + c.DBPort + ")/" + c.DBName + "?charset=utf8mb4&parseTime=True&loc=Local"
	if c.DBTLS == "true" {
		// TiDB Cloud / PlanetScale / Aiven all need TLS. The mysql driver
		// validates the cert against the host in the DSN using the system
		// cert pool (ca-certificates is in the Alpine image).
		dsn += "&tls=true"
	}
	return dsn
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
	}
}
