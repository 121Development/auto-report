import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { SectionId } from './section-id'
import { TrackChanges, TrackedDocument } from './track-changes'

/** Schema-defining extensions, shared by the editor UI and tests. */
export const baseExtensions = [
  StarterKit.configure({ document: false }),
  TrackedDocument,
  Markdown,
  SectionId,
  TrackChanges,
]
