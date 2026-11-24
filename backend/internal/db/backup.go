package db

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// CreateBackupZip creates a hot consistent backup of the SQLite database via VACUUM INTO
// together with the uploads directory, streaming the result as a zip archive.
func CreateBackupZip(store *Store, dataDir string, w io.Writer) error {
	tmpFile, err := os.CreateTemp("", "woqu-backup-*.db")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	_ = tmpFile.Close()
	_ = os.Remove(tmpPath)
	defer os.Remove(tmpPath)

	escaped := strings.ReplaceAll(tmpPath, `'`, `''`)
	if _, err := store.DB().Exec(fmt.Sprintf("VACUUM INTO '%s';", escaped)); err != nil {
		return fmt.Errorf("vacuum into backup failed: %w", err)
	}

	zw := zip.NewWriter(w)
	defer zw.Close()

	dbReader, err := os.Open(tmpPath)
	if err != nil {
		return err
	}
	dbEntry, err := zw.Create("woqu.db")
	if err != nil {
		_ = dbReader.Close()
		return err
	}
	if _, err := io.Copy(dbEntry, dbReader); err != nil {
		_ = dbReader.Close()
		return err
	}
	_ = dbReader.Close()

	uploadsDir := filepath.Join(dataDir, "uploads")
	if info, err := os.Stat(uploadsDir); err == nil && info.IsDir() {
		err = filepath.WalkDir(uploadsDir, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(uploadsDir, path)
			if err != nil {
				return err
			}
			zipPath := filepath.ToSlash(filepath.Join("uploads", rel))
			entry, err := zw.Create(zipPath)
			if err != nil {
				return err
			}
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			_, err = io.Copy(entry, f)
			return err
		})
		if err != nil {
			return err
		}
	}

	return zw.Close()
}

// RestoreBackupZip validates and restores a full backup zip into dataDir, hot-swapping the active Store.
func RestoreBackupZip(store *Store, dataDir string, r io.ReaderAt, size int64) error {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return fmt.Errorf("invalid zip archive: %w", err)
	}

	stagingDir, err := os.MkdirTemp("", "woqu-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stagingDir)

	var foundDB bool
	stagingUploads := filepath.Join(stagingDir, "uploads")
	if err := os.MkdirAll(stagingUploads, 0o755); err != nil {
		return err
	}

	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		cleanName := filepath.ToSlash(filepath.Clean(f.Name))
		if strings.HasPrefix(cleanName, "../") || strings.Contains(cleanName, "/../") || filepath.IsAbs(cleanName) {
			return errors.New("unsafe zip entry path detected")
		}

		var destPath string
		if cleanName == "woqu.db" {
			destPath = filepath.Join(stagingDir, "woqu.db")
			foundDB = true
		} else if strings.HasPrefix(cleanName, "uploads/") {
			rel := strings.TrimPrefix(cleanName, "uploads/")
			destPath = filepath.Join(stagingUploads, filepath.FromSlash(rel))
		} else {
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(destPath)
		if err != nil {
			_ = rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, io.LimitReader(rc, 512*1024*1024))
		_ = out.Close()
		_ = rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}

	if !foundDB {
		return errors.New("backup archive does not contain woqu.db")
	}

	stagedDBPath := filepath.Join(stagingDir, "woqu.db")
	if err := validateSQLiteFile(stagedDBPath); err != nil {
		return err
	}

	return store.WithWriteLock(func(currentDB **sql.DB) error {
		if *currentDB != nil {
			_ = (*currentDB).Close()
			*currentDB = nil
		}

		dbPath := store.DBPath()
		_ = os.Remove(dbPath + "-wal")
		_ = os.Remove(dbPath + "-shm")
		_ = os.Remove(dbPath)

		if err := copyFile(stagedDBPath, dbPath); err != nil {
			return err
		}

		targetUploads := filepath.Join(dataDir, "uploads")
		_ = os.RemoveAll(targetUploads)
		if err := copyDir(stagingUploads, targetUploads); err != nil {
			return err
		}

		return store.Reopen()
	})
}

func validateSQLiteFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	header := make([]byte, 16)
	_, err = io.ReadFull(f, header)
	_ = f.Close()
	if err != nil || !bytes.Equal(header, []byte("SQLite format 3\x00")) {
		return errors.New("invalid SQLite database file in backup")
	}
	conn, err := openConn(path)
	if err != nil {
		return fmt.Errorf("failed to open restored db: %w", err)
	}
	defer conn.Close()
	var count int
	if err := conn.QueryRow("SELECT count(*) FROM pages").Scan(&count); err != nil {
		return fmt.Errorf("restored db missing core schema: %w", err)
	}
	return nil
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}
