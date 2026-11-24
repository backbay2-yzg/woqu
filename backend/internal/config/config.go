package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Config holds runtime configuration for the Woqu server.
type Config struct {
	Port             string
	DataDir          string
	DBPath           string
	UploadsDir       string
	JWTSecret        []byte
	MasterKey        []byte
	InitialPassword  string
	DevMode          bool
	AllowPrivateClip bool
}

type persistedSecrets struct {
	JWTSecretHex string `json:"jwt_secret_hex"`
	MasterKeyHex string `json:"master_key_hex"`
}

// Load reads configuration from environment variables and ensures persistent secrets exist.
func Load() (*Config, error) {
	port := strings.TrimSpace(os.Getenv("WOQU_PORT"))
	if port == "" {
		port = "8080"
	}

	dataDir := strings.TrimSpace(os.Getenv("WOQU_DATA_DIR"))
	if dataDir == "" {
		dataDir = "./data"
	}
	absDataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, err
	}

	uploadsDir := filepath.Join(absDataDir, "uploads")
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		return nil, err
	}

	secrets, err := loadOrCreateSecrets(filepath.Join(absDataDir, ".secrets.json"))
	if err != nil {
		return nil, err
	}

	jwtSecret := secrets.jwtSecret
	if envJWT := os.Getenv("WOQU_JWT_SECRET"); envJWT != "" {
		sum := sha256.Sum256([]byte(envJWT))
		jwtSecret = sum[:]
	}

	masterKey := secrets.masterKey
	if envKey := os.Getenv("WOQU_MASTER_KEY"); envKey != "" {
		masterKey = deriveKey32(envKey)
	}

	return &Config{
		Port:             port,
		DataDir:          absDataDir,
		DBPath:           filepath.Join(absDataDir, "woqu.db"),
		UploadsDir:       uploadsDir,
		JWTSecret:        jwtSecret,
		MasterKey:        masterKey,
		InitialPassword:  os.Getenv("WOQU_INITIAL_PASSWORD"),
		DevMode:          parseBoolEnv("WOQU_DEV"),
		AllowPrivateClip: parseBoolEnv("WOQU_ALLOW_PRIVATE_CLIP"),
	}, nil
}

type rawSecrets struct {
	jwtSecret []byte
	masterKey []byte
}

func loadOrCreateSecrets(path string) (*rawSecrets, error) {
	if data, err := os.ReadFile(path); err == nil {
		var p persistedSecrets
		if err := json.Unmarshal(data, &p); err == nil {
			jwtBytes, err1 := hex.DecodeString(p.JWTSecretHex)
			keyBytes, err2 := hex.DecodeString(p.MasterKeyHex)
			if err1 == nil && err2 == nil && len(jwtBytes) >= 32 && len(keyBytes) == 32 {
				return &rawSecrets{
					jwtSecret: jwtBytes,
					masterKey: keyBytes,
				}, nil
			}
		}
	}

	jwtBytes := make([]byte, 32)
	if _, err := rand.Read(jwtBytes); err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, err
	}

	p := persistedSecrets{
		JWTSecretHex: hex.EncodeToString(jwtBytes),
		MasterKeyHex: hex.EncodeToString(keyBytes),
	}
	encoded, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return nil, err
	}
	return &rawSecrets{
		jwtSecret: jwtBytes,
		masterKey: keyBytes,
	}, nil
}

func deriveKey32(input string) []byte {
	trimmed := strings.TrimSpace(input)
	if len(trimmed) == 64 {
		if decoded, err := hex.DecodeString(trimmed); err == nil && len(decoded) == 32 {
			return decoded
		}
	}
	sum := sha256.Sum256([]byte(trimmed))
	return sum[:]
}

func parseBoolEnv(name string) bool {
	val := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	return val == "1" || val == "true" || val == "yes"
}
