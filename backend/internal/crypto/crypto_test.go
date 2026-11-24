package crypto

import (
	"bytes"
	"testing"
	"time"
)

func TestEncryptDecrypt(t *testing.T) {
	key := bytes.Repeat([]byte{0x42}, 32)
	plain := "sk-proj-secret-1234567890-中文测试"

	enc, err := Encrypt(plain, key)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	if enc == plain || enc == "" {
		t.Fatalf("expected encrypted output, got %q", enc)
	}

	dec, err := Decrypt(enc, key)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}
	if dec != plain {
		t.Fatalf("expected %q, got %q", plain, dec)
	}

	wrongKey := bytes.Repeat([]byte{0x99}, 32)
	if _, err := Decrypt(enc, wrongKey); err == nil {
		t.Fatalf("expected decryption error with wrong key")
	}
}

func TestPasswordAndJWT(t *testing.T) {
	hash, err := HashPassword("my-strong-pass")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if !CheckPassword("my-strong-pass", hash) {
		t.Fatal("expected password to match")
	}
	if CheckPassword("wrong", hash) {
		t.Fatal("expected wrong password to fail")
	}

	secret := []byte("super-secret-signing-key-32-bytes!!")
	tok, err := GenerateJWT(secret, "owner", time.Hour)
	if err != nil {
		t.Fatalf("GenerateJWT failed: %v", err)
	}
	sub, err := VerifyJWT(secret, tok)
	if err != nil || sub != "owner" {
		t.Fatalf("VerifyJWT failed: sub=%q err=%v", sub, err)
	}
}

func TestMaskSecret(t *testing.T) {
	if got := MaskSecret("sk-1234567890abcdef"); got != "sk-****cdef" {
		t.Fatalf("unexpected mask: %s", got)
	}
	if got := MaskSecret("short"); got != "****" {
		t.Fatalf("unexpected short mask: %s", got)
	}
}
