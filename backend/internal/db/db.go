package db

import (
	"database/sql"
	"strings"
	"sync"
	"unicode"

	_ "modernc.org/sqlite"
)

// Store manages the active SQLite database connection and supports safe hot-swapping during backup restore.
type Store struct {
	mu     sync.RWMutex
	db     *sql.DB
	dbPath string
}

// Open opens and configures a SQLite database with WAL mode, foreign keys, and single writer connection.
func Open(dbPath string) (*Store, error) {
	conn, err := openConn(dbPath)
	if err != nil {
		return nil, err
	}
	if err := RunMigrations(conn); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return &Store{
		db:     conn,
		dbPath: dbPath,
	}, nil
}

func openConn(dbPath string) (*sql.DB, error) {
	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)
	conn.SetMaxIdleConns(1)

	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA synchronous = NORMAL;",
	}
	for _, p := range pragmas {
		if _, err := conn.Exec(p); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	return conn, nil
}

// DB returns the underlying *sql.DB safely.
func (s *Store) DB() *sql.DB {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db
}

// DBPath returns the path to the SQLite database file.
func (s *Store) DBPath() string {
	return s.dbPath
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		err := s.db.Close()
		s.db = nil
		return err
	}
	return nil
}

// WithWriteLock executes fn while holding an exclusive lock on the Store connection lifecycle.
func (s *Store) WithWriteLock(fn func(currentDB **sql.DB) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return fn(&s.db)
}

// Reopen opens the database at dbPath and runs migrations. Used after restoring backups.
func (s *Store) Reopen() error {
	conn, err := openConn(s.dbPath)
	if err != nil {
		return err
	}
	if err := RunMigrations(conn); err != nil {
		_ = conn.Close()
		return err
	}
	s.db = conn
	return nil
}

// isCJK reports whether r belongs to Han, Hiragana, Katakana, or Hangul Unicode scripts.
func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) ||
		unicode.Is(unicode.Hiragana, r) ||
		unicode.Is(unicode.Katakana, r) ||
		unicode.Is(unicode.Hangul, r)
}

// SegmentCJK isolates every CJK character with spaces while preserving ASCII/Latin words intact.
// Writing and querying FTS5 symmetrically with this function ensures 1-2 character Chinese searches hit reliably.
func SegmentCJK(text string) string {
	if text == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(text) + len(text)/2)
	prevSpace := true
	for _, r := range text {
		if isCJK(r) {
			if !prevSpace {
				b.WriteByte(' ')
			}
			b.WriteRune(r)
			b.WriteByte(' ')
			prevSpace = true
		} else if unicode.IsSpace(r) {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		} else {
			b.WriteRune(r)
			prevSpace = false
		}
	}
	return strings.TrimSpace(b.String())
}

// BuildFTSQuery sanitizes user input, segments CJK characters, and wraps tokens in FTS5 double quotes
// so punctuation or reserved keywords never trigger FTS5 syntax errors.
func BuildFTSQuery(raw string) string {
	seg := SegmentCJK(raw)
	if seg == "" {
		return ""
	}
	fields := strings.Fields(seg)
	var terms []string
	for _, f := range fields {
		cleaned := strings.TrimFunc(f, func(r rune) bool {
			return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_'
		})
		if cleaned == "" {
			continue
		}
		escaped := strings.ReplaceAll(cleaned, `"`, `""`)
		terms = append(terms, `"`+escaped+`"`)
	}
	return strings.Join(terms, " ")
}
