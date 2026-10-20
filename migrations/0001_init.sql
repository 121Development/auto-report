-- Editor JSON (TipTap/ProseMirror) is the canonical stored format; Markdown is import/export only.

CREATE TABLE documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  language    TEXT NOT NULL DEFAULT 'sv' CHECK (language IN ('sv', 'en')),
  settings    TEXT NOT NULL DEFAULT '{}',  -- JSON: model choice, image captions, show own changes
  content     TEXT NOT NULL,               -- JSON: editor document, sections carry sectionId
  created_at  INTEGER NOT NULL,            -- epoch ms
  updated_at  INTEGER NOT NULL             -- epoch ms, set by the client that made the change
);

CREATE INDEX documents_updated_at ON documents (updated_at DESC);

CREATE TABLE versions (
  id                 TEXT PRIMARY KEY,
  document_id        TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  parent_version_id  TEXT REFERENCES versions (id),  -- set when this version is a fork
  name               TEXT NOT NULL DEFAULT '',
  kind               TEXT NOT NULL CHECK (kind IN ('manual', 'auto', 'pre-generation')),
  content            TEXT NOT NULL,
  created_at         INTEGER NOT NULL
);

CREATE INDEX versions_document ON versions (document_id, created_at DESC);
