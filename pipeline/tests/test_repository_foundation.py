from __future__ import annotations

import datetime as dt
import re
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_NOTES_ROOT = REPOSITORY_ROOT / "sample-notes"
EXPECTED_THEMES = {"work", "learning", "ideas", "journal"}
FRONT_MATTER_PATTERN = re.compile(
    r"\A---\n(?P<metadata>.*?)\n---\n(?P<body>.*)\Z",
    flags=re.DOTALL,
)
SCALAR_PATTERN = re.compile(r"^(?P<key>[a-z_]+):\s*(?P<value>.+)$", flags=re.MULTILINE)
TAG_BLOCK_PATTERN = re.compile(
    r"^tags:\s*\n(?P<items>(?:  - [^\n]+\n?)+)",
    flags=re.MULTILINE,
)
WIKI_LINK_PATTERN = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")


@dataclass(frozen=True)
class SampleNote:
    path: Path
    title: str
    date: dt.date
    theme: str
    tags: tuple[str, ...]
    body: str

    @property
    def wiki_links(self) -> set[str]:
        return {target.strip() for target in WIKI_LINK_PATTERN.findall(self.body)}


def load_sample_note(path: Path) -> SampleNote:
    content = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_PATTERN.fullmatch(content)
    if match is None:
        raise AssertionError(f"{path}: expected YAML front matter bounded by ---")

    metadata = match.group("metadata")
    scalars = {
        item.group("key"): item.group("value").strip().strip("\"'")
        for item in SCALAR_PATTERN.finditer(metadata)
    }
    required_scalars = {"title", "date", "theme", "sample"}
    missing = required_scalars.difference(scalars)
    if missing:
        raise AssertionError(f"{path}: missing front matter fields {sorted(missing)}")

    tag_block = TAG_BLOCK_PATTERN.search(metadata)
    if tag_block is None:
        raise AssertionError(f"{path}: expected a block-style tags list")

    tags = tuple(
        line.removeprefix("  - ").strip() for line in tag_block.group("items").splitlines()
    )

    return SampleNote(
        path=path,
        title=scalars["title"],
        date=dt.date.fromisoformat(scalars["date"]),
        theme=scalars["theme"],
        tags=tags,
        body=match.group("body"),
    )


class RepositoryFoundationTests(unittest.TestCase):
    notes: ClassVar[tuple[SampleNote, ...]]

    @classmethod
    def setUpClass(cls) -> None:
        paths = sorted(SAMPLE_NOTES_ROOT.glob("*/*.md"))
        cls.notes = tuple(load_sample_note(path) for path in paths)

    def test_sample_corpus_covers_the_parser_inputs(self) -> None:
        notes_by_theme = {
            theme: [note for note in self.notes if note.theme == theme] for theme in EXPECTED_THEMES
        }

        self.assertEqual({note.path.parent.name for note in self.notes}, EXPECTED_THEMES)
        self.assertEqual({note.theme for note in self.notes}, EXPECTED_THEMES)
        self.assertTrue(all(len(notes) >= 2 for notes in notes_by_theme.values()))

        for note in self.notes:
            content = note.path.read_text(encoding="utf-8")
            self.assertEqual(note.theme, note.path.parent.name, note.path)
            self.assertIn("sample: true", content, note.path)
            self.assertRegex(note.body, rf"(?m)^# {re.escape(note.title)}$")
            self.assertRegex(note.body, r"(?m)^## .+$")
            self.assertGreaterEqual(len(note.tags), 2, note.path)
            self.assertGreaterEqual(len(note.body.split()), 60, note.path)
            self.assertTrue(note.wiki_links, note.path)
            self.assertNotIn("lorem ipsum", content.lower(), note.path)

        self.assertTrue(
            any(re.search(r"\[[^\]]+\]\([^)]+\)", note.body) for note in self.notes),
            "the corpus should exercise standard Markdown links",
        )

    def test_wiki_links_are_resolvable_and_connect_the_corpus(self) -> None:
        notes_by_title = {note.title: note for note in self.notes}
        self.assertEqual(len(notes_by_title), len(self.notes), "sample note titles must be unique")

        unresolved = {
            target
            for note in self.notes
            for target in note.wiki_links
            if target not in notes_by_title
        }
        self.assertEqual(unresolved, set())

        pending = [self.notes[0].title]
        visited: set[str] = set()
        while pending:
            title = pending.pop()
            if title in visited:
                continue
            visited.add(title)
            pending.extend(notes_by_title[title].wiki_links - visited)

        self.assertEqual(
            visited, set(notes_by_title), "wiki links should form one connected corpus"
        )

    def test_readme_and_ignore_rules_describe_the_privacy_contract(self) -> None:
        readme = (REPOSITORY_ROOT / "README.md").read_text(encoding="utf-8")
        gitignore = (REPOSITORY_ROOT / ".gitignore").read_text(encoding="utf-8")

        for phrase in (
            "local-first",
            "make install",
            "make test",
            "make dev",
            "private-notes/",
            "sample: true",
        ):
            self.assertIn(phrase, readme)

        for rule in (
            "private-notes/",
            "pipeline/.cache/",
            "apps/web/public/data/private-*",
            ".env",
        ):
            self.assertIn(rule, gitignore)


if __name__ == "__main__":
    unittest.main()
