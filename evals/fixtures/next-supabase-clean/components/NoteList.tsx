'use client';

export default function NoteList({ notes }: { notes: { id: string; title: string }[] }) {
  return <ul>{notes.map((n) => <li key={n.id}>{n.title}</li>)}</ul>;
}
